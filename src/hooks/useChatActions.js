import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChatCompletion } from '../lib/stream.js';
import {
  getTextParts, getImageParts, createTextContent, createId,
  createConversation, buildConversationTitle, buildCopyText, normalizeMessage,
} from '../lib/utils.js';
import { fetchConversation } from '../lib/auth.js';
import { COST_CHAT } from '../lib/constants.js';
import { useChatImages } from './useChatImages.js';

/**
 * 聊天核心逻辑：发送消息、会话管理、选择模式、图片上传
 * 自包含聊天相关 state/refs
 */
export function useChatActions({
  settings,
  authState,
  balance,
  markCloudDirty,
  setBalance,
  setErrorText,
  setStatusText,
  setRechargeDialogOpen,
}) {
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showCompleteHint, setShowCompleteHint] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [visibleMessageCount, setVisibleMessageCount] = useState(50);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState(new Set());
  const [loadingConversationId, setLoadingConversationId] = useState(null);
  const [deleteConversationTarget, setDeleteConversationTarget] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('history');

  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);

  const abortControllerRef = useRef(null);
  const composerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);
  const conversationsRef = useRef(conversations);
  const loadingConversationIdsRef = useRef(new Set());

  conversationsRef.current = conversations;

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const activeMessages = activeConversation?.messages || [];
  const convLoading = loadingConversationId === activeConversationId;

  // 图片上传/处理
  const images = useChatImages({ authState, setErrorText, setStatusText });
  const { pendingImages, setPendingImages, imageProcessing, fileInputRef } = images;

  const updateConversation = useCallback((conversationId, updater) => {
    markCloudDirty({ conversationId });
    setConversations((current) =>
      current.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const nextConversation = updater(conversation);
        const msgs = nextConversation.messages || [];
        return {
          ...nextConversation,
          messagesLoaded: true,
          title: buildConversationTitle(msgs),
          updatedAt: Date.now(),
          messageCount: msgs.length,
        };
      }),
    );
  }, [markCloudDirty]);

  const loadConversationMessages = useCallback(async (conversationId) => {
    const conv = conversationsRef.current.find((c) => c.id === conversationId);
    if (!conv || conv.messagesLoaded) return;
    if ((conv.messageCount || 0) === 0) {
      setConversations((current) => current.map((item) => (
        item.id === conversationId ? { ...item, messages: [], messagesLoaded: true } : item
      )));
      return;
    }
    if (loadingConversationIdsRef.current.has(conversationId)) return;
    loadingConversationIdsRef.current.add(conversationId);
    setLoadingConversationId(conversationId);
    try {
      const data = await fetchConversation(conversationId);
      if (Array.isArray(data.messages)) {
        const normalizedMessages = data.messages.map((m) => normalizeMessage(m, data.updatedAt));
        setConversations((current) =>
          current.map((c) =>
            c.id === conversationId
              ? { ...c, messages: normalizedMessages, messagesLoaded: true, title: data.title || c.title, updatedAt: data.updatedAt || c.updatedAt, messageCount: normalizedMessages.length }
              : c,
          ),
        );
      }
    } catch {
      setErrorText('加载对话失败，请重试');
    } finally {
      loadingConversationIdsRef.current.delete(conversationId);
      setLoadingConversationId((current) => (current === conversationId ? null : current));
    }
  }, [setErrorText]);

  const switchConversation = useCallback((conversationId) => {
    setActiveConversationId(conversationId);
    setVisibleMessageCount(50);
    const conv = conversationsRef.current.find((c) => c.id === conversationId);
    if (conv && !conv.messagesLoaded) {
      loadConversationMessages(conversationId);
    }
  }, [loadConversationMessages]);

  const createNewConversation = useCallback(() => {
    const conversation = createConversation();
    markCloudDirty({ conversationId: conversation.id });
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setDraft('');
    setPendingImages([]);
    setErrorText('');
    setStatusText('已创建新对话');
    setDrawerOpen(false);
  }, [markCloudDirty, setErrorText, setStatusText]);

  const removeConversation = useCallback((conversationId) => {
    const remaining = conversationsRef.current.filter((item) => item.id !== conversationId);
    if (remaining.length) {
      markCloudDirty();
      setConversations(remaining);
      if (conversationId === activeConversationId) {
        const nextActive = remaining[0];
        setActiveConversationId(nextActive.id);
        if (!nextActive.messagesLoaded) {
          loadConversationMessages(nextActive.id);
        }
      }
      return;
    }
    const fallback = createConversation();
    markCloudDirty({ conversationId: fallback.id });
    setConversations([fallback]);
    setActiveConversationId(fallback.id);
  }, [markCloudDirty, activeConversationId, loadConversationMessages]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
    setStatusText('已停止生成');
  }, [setStatusText]);

  const openDrawer = useCallback((tab) => {
    setDrawerTab(tab);
    setDrawerOpen(true);
  }, []);

  const sendMessage = useCallback(async (customContent) => {
    const content =
      customContent ||
      [
        ...(draft.trim() ? [{ type: 'text', text: draft.trim() }] : []),
        ...pendingImages.map((img) => ({ type: 'image_url', image_url: { url: img.url } })),
      ];
    const textContent = getTextParts(content).trim();
    const hasImage = getImageParts(content).length > 0;

    if ((!textContent && !hasImage) || isSending || convLoading || !activeConversation?.messagesLoaded || authState !== 'authenticated') {
      return;
    }

    if (balance !== null && balance < COST_CHAT - 0.0001) {
      setErrorText(`余额不足，聊天需要 ${COST_CHAT} 元，当前余额 ${balance.toFixed(2)} 元`);
      setRechargeDialogOpen(true);
      return;
    }

    const now = Date.now();
    const userMessage = { id: createId(), role: 'user', content, createdAt: now };
    const assistantMessage = { id: createId(), role: 'assistant', content: createTextContent(''), createdAt: now };
    const nextMessages = [...activeConversation.messages, userMessage, assistantMessage];
    setDraft('');
    setPendingImages([]);
    setErrorText('');
    setIsSending(true);
    setStatusText('正在回复');
    composerRef.current?.blur();

    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: nextMessages,
    }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await streamChatCompletion({
        settings,
        messages: nextMessages.filter((m) => m.role !== 'assistant' || m.id !== assistantMessage.id),
        signal: controller.signal,
        onText: (text) => {
          updateConversation(activeConversation.id, (conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: createTextContent(`${getTextParts(message.content)}${text}`) }
                : message,
            ),
          }));
        },
      });

      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistantMessage.id && !getTextParts(message.content).trim()
            ? { ...message, content: createTextContent('接口已连接，但没有返回可显示的文本内容。') }
            : message,
        ),
      }));
      setStatusText('回答完成');
    } catch (error) {
      if (error.name === 'AbortError') {
        updateConversation(activeConversation.id, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantMessage.id && !getTextParts(message.content).trim()
              ? { ...message, content: createTextContent('本次回答已停止。') }
              : message,
          ),
        }));
      } else {
        const nextErrorText = error.message || '请求失败，请检查接口地址或密钥。';
        setErrorText(nextErrorText);
        setStatusText('请求失败');
        if (error.code === 'INSUFFICIENT_BALANCE' || error.status === 402) {
          try { const r = await import('../lib/auth.js').then(m => m.fetchBalance()); setBalance(r.balance); } catch {}
          setRechargeDialogOpen(true);
        }
        updateConversation(activeConversation.id, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantMessage.id && !getTextParts(message.content).trim()
              ? { ...message, content: createTextContent(`出错了：${nextErrorText}`) }
              : message,
          ),
        }));
      }
    } finally {
      abortControllerRef.current = null;
      setIsSending(false);
      try { const r = await import('../lib/auth.js').then(m => m.fetchBalance()); setBalance(r.balance); } catch {}
      setShowCompleteHint(true);
      setTimeout(() => setShowCompleteHint(false), 3000);
    }
  }, [draft, pendingImages, isSending, convLoading, activeConversation, authState, balance, settings, updateConversation, setErrorText, setStatusText, setRechargeDialogOpen, setBalance]);

  const handleComposerKeyDown = useCallback((event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const quickFill = useCallback((text) => {
    setDraft(text);
    composerRef.current?.focus();
  }, []);

  const retryMessage = useCallback((message) => {
    const messageIndex = activeMessages.findIndex((m) => m.id === message.id);
    if (messageIndex < 1) return;
    const userMessage = activeMessages[messageIndex - 1];
    if (userMessage?.role !== 'user') return;
    const userText = getTextParts(userMessage.content).trim();
    if (!userText) return;
    setDraft(userText);
    composerRef.current?.focus();
  }, [activeMessages]);

  const copyMessage = useCallback(async (message) => {
    const text = buildCopyText(message);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(message.id);
    } catch {
      setErrorText('复制失败，请检查浏览器权限。');
    }
  }, [setErrorText]);

  // 选择模式
  const enterSelectMode = useCallback((preselectId) => {
    setSelectMode(true);
    setSelectedMessageIds(preselectId ? new Set([preselectId]) : new Set());
  }, []);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedMessageIds(new Set());
  }, []);
  const toggleMessageSelection = useCallback((messageId) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
      return next;
    });
  }, []);
  const selectAllUserMessages = useCallback(() => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeMessages.forEach((m) => { if (m.role === 'user') next.add(m.id); });
      return next;
    });
  }, [activeMessages]);
  const selectAllAssistantMessages = useCallback(() => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeMessages.forEach((m) => { if (m.role === 'assistant') next.add(m.id); });
      return next;
    });
  }, [activeMessages]);
  const deleteSelectedMessages = useCallback(() => {
    if (selectedMessageIds.size === 0 || !activeConversation) return;
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: conversation.messages.filter((m) => !selectedMessageIds.has(m.id)),
    }));
    exitSelectMode();
  }, [selectedMessageIds, activeConversation, updateConversation, exitSelectMode]);

  // abort 清理
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // copiedMessageId 自动清除
  useEffect(() => {
    if (!copiedMessageId) return undefined;
    const timer = window.setTimeout(() => setCopiedMessageId(''), 1500);
    return () => window.clearTimeout(timer);
  }, [copiedMessageId]);

  return {
    // state
    draft, setDraft, isSending,
    showCompleteHint, copiedMessageId, visibleMessageCount, setVisibleMessageCount,
    selectMode, selectedMessageIds, loadingConversationId, deleteConversationTarget,
    setDeleteConversationTarget, drawerOpen, setDrawerOpen, drawerTab, setDrawerTab,
    conversations, setConversations, activeConversationId, setActiveConversationId,
    // refs
    composerRef, messagesEndRef, messageListRef, conversationsRef,
    // derived
    activeConversation, activeMessages, convLoading,
    // functions
    updateConversation, loadConversationMessages, switchConversation,
    createNewConversation, removeConversation, stopStreaming, openDrawer,
    sendMessage, handleComposerKeyDown, quickFill, retryMessage, copyMessage,
    enterSelectMode, exitSelectMode, toggleMessageSelection,
    selectAllUserMessages, selectAllAssistantMessages, deleteSelectedMessages,
    // 图片上传/处理
    ...images,
  };
}
