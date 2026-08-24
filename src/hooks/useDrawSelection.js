import { useCallback, useState } from 'react';
import { deleteRefImages } from '../lib/ref-image-store.js';

/**
 * 制图选择模式 + 消息删除逻辑（从 useDrawActions 拆分）
 */
export function useDrawSelection({
  activeDrawConversation,
  activeDrawMessages,
  drawConversationsRef,
  updateDrawConversation,
  setDrawConversations,
  setErrorText,
}) {
  const [drawSelectMode, setDrawSelectMode] = useState(false);
  const [drawSelectedMessageIds, setDrawSelectedMessageIds] = useState(new Set());
  const [deleteDrawTarget, setDeleteDrawTarget] = useState(null);

  const requestDeleteDrawMessage = useCallback((conversationId, messageId) => {
    setDeleteDrawTarget({ conversationId, messageId });
  }, []);
  const cancelDeleteDrawMessage = useCallback(() => setDeleteDrawTarget(null), []);
  const confirmDeleteDrawMessage = useCallback(() => {
    if (!deleteDrawTarget) return;
    const { conversationId, messageId } = deleteDrawTarget;
    // updater 是渲染期才执行，不能在里面收集 refId；改为提交删除前从当前快照同步收集
    const snapshotConv = activeDrawConversation?.id === conversationId
      ? activeDrawConversation
      : drawConversationsRef.current.find((c) => c.id === conversationId);
    const snapshotMessages = snapshotConv?.messages || [];
    const removedRefIds = [];
    const collectRefIds = (message) => {
      if (message?.role === 'user' && Array.isArray(message.referenceMeta)) {
        message.referenceMeta.forEach((meta) => {
          if (meta?.refId && !removedRefIds.includes(meta.refId)) removedRefIds.push(meta.refId);
        });
      }
    };
    // 先按与 updater 相同的规则确定将被删除的消息并收集 refId
    const idx = snapshotMessages.findIndex((m) => m.id === messageId);
    if (idx >= 0) {
      const targetMessage = snapshotMessages[idx];
      if (targetMessage.batchId) {
        snapshotMessages.forEach((m) => {
          if (m.batchId === targetMessage.batchId) collectRefIds(m);
        });
      } else if (targetMessage.role === 'assistant' && idx > 0 && snapshotMessages[idx - 1].role === 'user') {
        collectRefIds(snapshotMessages[idx - 1]);
      } else if (targetMessage.role === 'user' && idx + 1 < snapshotMessages.length && snapshotMessages[idx + 1].role === 'assistant') {
        collectRefIds(snapshotMessages[idx]);
      } else {
        collectRefIds(targetMessage);
      }
    }
    updateDrawConversation(conversationId, (conv) => {
      const msgs = conv.messages || [];
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx < 0) return conv;
      const targetMessage = msgs[idx];
      if (targetMessage.batchId) {
        return { ...conv, messages: msgs.filter((m) => m.batchId !== targetMessage.batchId) };
      }
      const newMessages = [...msgs];
      if (newMessages[idx].role === 'assistant' && idx > 0 && newMessages[idx - 1].role === 'user') {
        newMessages.splice(idx - 1, 2);
      } else if (newMessages[idx].role === 'user' && idx + 1 < newMessages.length && newMessages[idx + 1].role === 'assistant') {
        newMessages.splice(idx, 2);
      } else {
        newMessages.splice(idx, 1);
      }
      return { ...conv, messages: newMessages };
    });
    if (removedRefIds.length > 0) {
      // refId 为随机 UUID 不复用，被删消息引用的图直接本地删除
      void deleteRefImages(removedRefIds);
    }
    setDrawConversations((current) => current.filter((c) => (
      c.id !== conversationId || !c.messagesLoaded || (c.messages || []).length > 0
    )));
    setDeleteDrawTarget(null);
  }, [deleteDrawTarget, activeDrawConversation, drawConversationsRef, updateDrawConversation, setDrawConversations]);

  const enterDrawSelectMode = useCallback(() => {
    setDrawSelectMode(true); setDrawSelectedMessageIds(new Set()); setErrorText('');
  }, [setErrorText]);
  const exitDrawSelectMode = useCallback(() => {
    setDrawSelectMode(false); setDrawSelectedMessageIds(new Set());
  }, []);
  const toggleDrawMessageSelection = useCallback((messageId) => {
    setDrawSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
      return next;
    });
  }, []);
  const selectAllDrawUserMessages = useCallback(() => {
    setDrawSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeDrawMessages.forEach((m) => { if (m.role === 'user') next.add(m.id); });
      return next;
    });
  }, [activeDrawMessages]);
  const selectAllDrawAssistantMessages = useCallback(() => {
    setDrawSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeDrawMessages.forEach((m) => { if (m.role === 'assistant') next.add(m.id); });
      return next;
    });
  }, [activeDrawMessages]);
  const deleteSelectedDrawMessages = useCallback(() => {
    if (!activeDrawConversation || drawSelectedMessageIds.size === 0) return;
    // updater 是渲染期才执行，不能在里面收集 refId；改为提交删除前从当前快照同步收集
    const snapshotMessages = activeDrawConversation.messages || [];
    const removedRefIds = [];
    // 先按与 updater 相同的规则确定将被删除的消息并收集 refId
    const removableIds = new Set(drawSelectedMessageIds);
    snapshotMessages.forEach((message, index) => {
      if (!drawSelectedMessageIds.has(message.id)) return;
      if (message.batchId) {
        snapshotMessages.forEach((batchMessage) => {
          if (batchMessage.batchId === message.batchId) removableIds.add(batchMessage.id);
        });
        return;
      }
      if (message.role === 'user') {
        const nextMessage = snapshotMessages[index + 1];
        if (nextMessage?.role === 'assistant') removableIds.add(nextMessage.id);
      }
      if (message.role === 'assistant') {
        const previousMessage = snapshotMessages[index - 1];
        if (previousMessage?.role === 'user') removableIds.add(previousMessage.id);
      }
    });
    snapshotMessages.forEach((m) => {
      if (removableIds.has(m.id) && m.role === 'user' && Array.isArray(m.referenceMeta)) {
        m.referenceMeta.forEach((meta) => {
          if (meta?.refId && !removedRefIds.includes(meta.refId)) removedRefIds.push(meta.refId);
        });
      }
    });
    updateDrawConversation(activeDrawConversation.id, (conversation) => {
      const msgs = conversation.messages || [];
      const remainingMessages = msgs.filter((m) => !removableIds.has(m.id));
      return { ...conversation, title: remainingMessages.length ? conversation.title : '新的画图', messages: remainingMessages };
    });
    if (removedRefIds.length > 0) {
      // refId 为随机 UUID 不复用，被删消息引用的图直接本地删除
      void deleteRefImages(removedRefIds);
    }
    exitDrawSelectMode();
  }, [activeDrawConversation, drawSelectedMessageIds, updateDrawConversation, exitDrawSelectMode]);

  return {
    drawSelectMode, drawSelectedMessageIds,
    deleteDrawTarget, setDeleteDrawTarget,
    requestDeleteDrawMessage, cancelDeleteDrawMessage, confirmDeleteDrawMessage,
    enterDrawSelectMode, exitDrawSelectMode, toggleDrawMessageSelection,
    selectAllDrawUserMessages, selectAllDrawAssistantMessages, deleteSelectedDrawMessages,
  };
}
