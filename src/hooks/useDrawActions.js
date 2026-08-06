import { useCallback, useRef, useState } from 'react';
import {
  createDrawConversation, normalizeMessage,
} from '../lib/utils.js';
import { fetchDrawConversation } from '../lib/auth.js';
import { DRAW_MAX_IMAGES } from '../lib/constants.js';
import { useDrawSelection } from './useDrawSelection.js';
import { useDrawExecution } from './useDrawExecution.js';

/**
 * 制图核心逻辑：会话管理、模式切换
 * 执行逻辑见 useDrawExecution，选择/删除见 useDrawSelection
 */
export function useDrawActions({
  settings,
  authState,
  balance,
  markCloudDirty,
  setBalance,
  setErrorText,
  setStatusText,
  setRechargeDialogOpen,
}) {
  const [drawMode, setDrawMode] = useState(false);
  const [drawPrompt, setDrawPrompt] = useState('');
  const [drawConversations, setDrawConversations] = useState([]);
  const [activeDrawConversationId, setActiveDrawConversationId] = useState(null);
  const [drawDrawerOpen, setDrawDrawerOpen] = useState(false);
  const [drawLimitWarning, setDrawLimitWarning] = useState(false);
  const [drawPendingImages, setDrawPendingImages] = useState([]);
  const [deleteDrawConversationTarget, setDeleteDrawConversationTarget] = useState(null);
  const [loadingDrawConversationId, setLoadingDrawConversationId] = useState(null);

  const drawFileInputRef = useRef(null);
  const newDrawConvRef = useRef(new Set());
  const loadingDrawConversationIdsRef = useRef(new Set());
  const drawConversationsRef = useRef(drawConversations);
  const activeDrawConversationIdRef = useRef(activeDrawConversationId);

  drawConversationsRef.current = drawConversations;
  activeDrawConversationIdRef.current = activeDrawConversationId;

  const activeDrawConversation = drawConversations.find((c) => c.id === activeDrawConversationId) || drawConversations[0] || null;
  const activeDrawMessages = activeDrawConversation?.messages || [];
  const drawConvLoading = loadingDrawConversationId === activeDrawConversationId;

  const pendingDrawTaskCount = (() => {
    let count = 0;
    for (const conversation of drawConversations) {
      for (const message of (conversation.messages || [])) {
        if (message.role === 'assistant' && !message.imageUrl && !message.error && (message.pending || message.taskId)) {
          count += 1;
        }
      }
    }
    return count;
  })();
  const isGenerating = pendingDrawTaskCount > 0;

  const drawImageCount = (() => {
    let count = 0;
    for (const c of drawConversations) {
      if (typeof c.imageCount === 'number' && c.messages.length === 0) {
        count += c.imageCount;
      } else {
        count += c.messages.filter((m) => m.role === 'assistant' && m.imageUrl).length;
      }
    }
    return count;
  })();

  const updateDrawConversation = useCallback((conversationId, updater) => {
    markCloudDirty({ drawConversationId: conversationId });
    setDrawConversations((current) =>
      current.map((conv) => {
        if (conv.id !== conversationId) return conv;
        const next = updater(conv);
        const msgs = next.messages || [];
        return {
          ...next,
          messagesLoaded: true,
          updatedAt: Date.now(),
          messageCount: msgs.length,
          imageCount: msgs.filter((m) => m.role === 'assistant' && m.imageUrl).length,
        };
      }),
    );
  }, [markCloudDirty]);

  const enforceDrawLimit = useCallback(() => {
    markCloudDirty({
      drawConversationIds: drawConversationsRef.current
        .filter((c) => c.messagesLoaded)
        .map((c) => c.id),
    });
    setDrawConversations((current) => {
      let totalImages = 0;
      for (const c of current) {
        if (typeof c.imageCount === 'number' && (!c.messages || c.messages.length === 0)) {
          totalImages += c.imageCount;
        } else {
          totalImages += (c.messages || []).filter((m) => m.role === 'assistant' && m.imageUrl).length;
        }
      }
      if (totalImages <= DRAW_MAX_IMAGES) return current;
      const result = current.map((c) => ({ ...c, messages: [...(c.messages || [])] }));
      while (totalImages > DRAW_MAX_IMAGES && result.length > 0) {
        let oldestConvIdx = -1, oldestMsgIdx = -1, oldestTime = Infinity;
        for (let ci = result.length - 1; ci >= 0; ci--) {
          const msgs = result[ci].messages;
          for (let mi = 0; mi < msgs.length; mi++) {
            if (msgs[mi].role === 'assistant' && msgs[mi].imageUrl && msgs[mi].createdAt < oldestTime) {
              oldestTime = msgs[mi].createdAt; oldestConvIdx = ci; oldestMsgIdx = mi;
            }
          }
        }
        if (oldestConvIdx < 0) break;
        const conv = result[oldestConvIdx];
        const oldestMessage = conv.messages[oldestMsgIdx];
        if (oldestMessage.batchId) {
          const removed = conv.messages.filter((m) => m.batchId === oldestMessage.batchId && m.role === 'assistant' && m.imageUrl).length;
          conv.messages = conv.messages.filter((m) => m.batchId !== oldestMessage.batchId);
          totalImages -= removed;
          continue;
        }
        conv.messages.splice(oldestMsgIdx, 1);
        if (oldestMsgIdx > 0 && conv.messages[oldestMsgIdx - 1].role === 'user') {
          conv.messages.splice(oldestMsgIdx - 1, 1);
        }
        totalImages--;
      }
      return result.filter((c) => !c.messagesLoaded || (c.messages || []).length > 0);
    });
  }, [markCloudDirty]);

  // 选择模式 + 消息删除
  const selection = useDrawSelection({
    activeDrawConversation,
    activeDrawMessages,
    updateDrawConversation,
    setDrawConversations,
    setErrorText,
  });
  const { exitDrawSelectMode } = selection;

  // 云端消息合并到本地时，保留本地消息的 taskId：
  // 部分旧数据云端未持久化 taskId，直接整体替换会导致前端无法恢复轮询，
  // 消息即使后端已成功也一直卡在"制图中"。
  const mergeDrawMessages = useCallback((conversationId, cloudMessages, { title, updatedAt } = {}) => {
    const normalized = cloudMessages.map((m) => normalizeMessage(m, updatedAt));
    setDrawConversations((current) => {
      const localMessages = current.find((c) => c.id === conversationId)?.messages || [];
      const localByMessageId = new Map(localMessages.map((m) => [m.id, m]));
      const mergedMessages = normalized.map((m) => {
        if (m.taskId) return m;
        const localTaskId = localByMessageId.get(m.id)?.taskId;
        return localTaskId ? { ...m, taskId: localTaskId } : m;
      });
      return current.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: mergedMessages,
              messagesLoaded: true,
              title: title || c.title,
              updatedAt: updatedAt || c.updatedAt,
              messageCount: mergedMessages.length,
              imageCount: mergedMessages.filter((msg) => msg.role === 'assistant' && msg.imageUrl).length,
            }
          : c,
      );
    });
  }, [setDrawConversations]);

  const loadDrawConversationMessages = useCallback(async (conversationId) => {
    const conv = drawConversationsRef.current.find((c) => c.id === conversationId);
    if (!conv || conv.messagesLoaded || newDrawConvRef.current.has(conversationId)) return;
    if ((conv.messageCount || 0) === 0) {
      setDrawConversations((current) => current.map((item) => (
        item.id === conversationId ? { ...item, messages: [], messagesLoaded: true } : item
      )));
      return;
    }
    if (loadingDrawConversationIdsRef.current.has(conversationId)) return;
    loadingDrawConversationIdsRef.current.add(conversationId);
    setLoadingDrawConversationId(conversationId);
    try {
      const data = await fetchDrawConversation(conversationId);
      if (Array.isArray(data.messages)) {
        mergeDrawMessages(conversationId, data.messages, { title: data.title, updatedAt: data.updatedAt });
      }
    } catch {
      setErrorText('加载画图记录失败');
    } finally {
      loadingDrawConversationIdsRef.current.delete(conversationId);
      setLoadingDrawConversationId((current) => (current === conversationId ? null : current));
    }
  }, [setErrorText, mergeDrawMessages]);

  const refreshDrawConversationMessages = useCallback(async (conversationId) => {
    if (loadingDrawConversationIdsRef.current.has(conversationId)) return;
    loadingDrawConversationIdsRef.current.add(conversationId);
    setLoadingDrawConversationId(conversationId);
    try {
      const data = await fetchDrawConversation(conversationId);
      if (Array.isArray(data.messages)) {
        mergeDrawMessages(conversationId, data.messages, { title: data.title, updatedAt: data.updatedAt });
      }
    } catch {
      // 静默
    } finally {
      loadingDrawConversationIdsRef.current.delete(conversationId);
      setLoadingDrawConversationId((current) => (current === conversationId ? null : current));
    }
  }, [mergeDrawMessages]);

  const switchDrawConversation = useCallback((conversationId) => {
    setActiveDrawConversationId(conversationId);
    setDrawDrawerOpen(false);
    const conv = drawConversationsRef.current.find((c) => c.id === conversationId);
    if (conv && !conv.messagesLoaded) {
      loadDrawConversationMessages(conversationId);
    }
  }, [loadDrawConversationMessages]);

  const openDrawMode = useCallback(() => {
    setDrawMode(true);
    setDrawPrompt('');
    setErrorText('');
    setDrawLimitWarning(false);
    setDrawPendingImages([]);
    exitDrawSelectMode();
    if (!activeDrawConversationId || !drawConversationsRef.current.find((c) => c.id === activeDrawConversationId)) {
      const conv = createDrawConversation();
      markCloudDirty({ drawConversationId: conv.id });
      setDrawConversations([conv]);
      setActiveDrawConversationId(conv.id);
    } else {
      const conv = drawConversationsRef.current.find((c) => c.id === activeDrawConversationId);
      if (conv && !conv.messagesLoaded) {
        loadDrawConversationMessages(activeDrawConversationId);
      }
    }
  }, [activeDrawConversationId, markCloudDirty, setErrorText, loadDrawConversationMessages, exitDrawSelectMode]);

  const closeDrawMode = useCallback(() => {
    setDrawMode(false);
    setErrorText('');
    setDrawDrawerOpen(false);
    setDrawLimitWarning(false);
    setDrawPendingImages([]);
    exitDrawSelectMode();
    setStatusText('已就绪');
  }, [setErrorText, setStatusText, exitDrawSelectMode]);

  const createNewDrawConversation = useCallback(() => {
    const conv = createDrawConversation();
    newDrawConvRef.current.add(conv.id);
    markCloudDirty({ drawConversationId: conv.id });
    setDrawConversations((prev) => [conv, ...prev]);
    setActiveDrawConversationId(conv.id);
    setDrawPrompt('');
    setErrorText('');
    setDrawLimitWarning(false);
    setDrawPendingImages([]);
    exitDrawSelectMode();
    setDrawDrawerOpen(false);
  }, [markCloudDirty, setErrorText, exitDrawSelectMode]);

  const removeDrawConversation = useCallback((conversationId) => {
    newDrawConvRef.current.delete(conversationId);
    markCloudDirty();
    setDrawConversations((current) => {
      const remaining = current.filter((item) => item.id !== conversationId);
      if (remaining.length) {
        if (conversationId === activeDrawConversationIdRef.current) {
          const nextActive = remaining[0];
          setActiveDrawConversationId(nextActive.id);
          if (!nextActive.messagesLoaded) {
            loadDrawConversationMessages(nextActive.id);
          }
        }
        return remaining;
      }
      return [];
    });
    if (conversationId === activeDrawConversationIdRef.current) {
      setDrawPrompt('');
    }
    setErrorText('');
    exitDrawSelectMode();
  }, [markCloudDirty, loadDrawConversationMessages, setErrorText, exitDrawSelectMode]);

  // 任务执行 + 轮询恢复
  const execution = useDrawExecution({
    settings, authState, balance, markCloudDirty,
    drawConversations, drawConversationsRef,
    activeDrawConversationId, activeDrawConversationIdRef,
    activeDrawConversation, drawConvLoading,
    drawPrompt, drawPendingImages, drawImageCount,
    updateDrawConversation, enforceDrawLimit,
    refreshDrawConversationMessages,
    setErrorText, setStatusText, setRechargeDialogOpen, setBalance,
    setDrawLimitWarning, setDrawPrompt, setDrawPendingImages,
    setDrawConversations, setActiveDrawConversationId,
  });

  return {
    drawMode, setDrawMode, drawPrompt, setDrawPrompt,
    drawConversations, setDrawConversations, activeDrawConversationId, setActiveDrawConversationId,
    drawDrawerOpen, setDrawDrawerOpen, drawLimitWarning, setDrawLimitWarning,
    drawPendingImages, setDrawPendingImages,
    deleteDrawConversationTarget, setDeleteDrawConversationTarget,
    loadingDrawConversationId,
    drawFileInputRef, drawConversationsRef,
    activeDrawConversation, activeDrawMessages, drawConvLoading,
    pendingDrawTaskCount, isGenerating, drawImageCount,
    updateDrawConversation, loadDrawConversationMessages, refreshDrawConversationMessages,
    switchDrawConversation, openDrawMode, closeDrawMode, createNewDrawConversation,
    removeDrawConversation,
    ...execution,
    ...selection,
  };
}
