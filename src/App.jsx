import { Suspense, useCallback, useEffect, useMemo, useRef, useState, lazy } from 'react';
import { streamChatCompletion, generateImage, pollDrawTask } from './lib/stream';
import { register, login, saveToCloud, loadFromCloud, getToken, clearToken, getStoredUsername, fetchBalance, rechargeBalance, fetchConversation, fetchDrawConversation } from './lib/auth';
import { DRAW_MAX_IMAGES, COST_CHAT, COST_DRAW, BALANCE_RECHARGE_PRESETS } from './lib/constants';
import {
  classNames,
  loadState,
  saveState,
  normalizeState,
  normalizeModelSettings,
  getTextParts,
  getImageParts,
  createTextContent,
  createId,
  createConversation,
  createDrawConversation,
  buildConversationTitle,
  buildCopyText,
  resolveDrawDurationSeconds,
  normalizeMessage,
} from './lib/utils';

import AuthLoading from './components/AuthLoading';
import Drawer from './components/Drawer';
import ChatHeader from './components/ChatHeader';
import MessageRow from './components/MessageRow';
import Scrollbar from './components/Scrollbar';
import Composer from './components/Composer';
import ConfirmDialog from './components/ConfirmDialog';
import BalanceBar from './components/BalanceBar';
import { Button, Card, Divider, Footer, Loading, Title } from 'animal-island-ui';

const AuthForm = lazy(() => import('./components/AuthForm'));
const DrawPage = lazy(() => import('./components/DrawPage'));
const RechargeDialog = lazy(() => import('./components/RechargeDialog'));

function mergeCloudData(localData, cloudData) {
  if (!cloudData || !cloudData.settings) {
    return localData;
  }

  const normalized = normalizeState(cloudData);
  const localConvsById = new Map((localData.conversations || []).map((c) => [c.id, c]));

  const mergedConversations = normalized.conversations.map((cloudConv) => {
    if (cloudConv.messages && cloudConv.messages.length > 0) {
      return cloudConv;
    }
    const localConv = localConvsById.get(cloudConv.id);
    if (localConv && localConv.messages && localConv.messages.length > 0) {
      return {
        ...cloudConv,
        messages: localConv.messages,
        messageCount: Math.max(cloudConv.messageCount || 0, localConv.messages.length),
      };
    }
    return cloudConv;
  });

  const localDrawConvsById = new Map((localData.drawConversations || []).map((c) => [c.id, c]));

  const mergedDrawConversations = normalized.drawConversations.map((cloudConv) => {
    if (cloudConv.messages && cloudConv.messages.length > 0) {
      return cloudConv;
    }
    const localConv = localDrawConvsById.get(cloudConv.id);
    if (localConv && localConv.messages && localConv.messages.length > 0) {
      return {
        ...cloudConv,
        messages: localConv.messages,
        messageCount: Math.max(cloudConv.messageCount || 0, localConv.messages.length),
        imageCount: Math.max(cloudConv.imageCount || 0, localConv.messages.filter((m) => m.role === 'assistant' && m.imageUrl).length),
      };
    }
    return cloudConv;
  });

  const localConvIds = new Set((localData.conversations || []).map((c) => c.id));
  const newConversations = mergedConversations.filter((c) => localConvIds.has(c.id) || c.messages.length > 0);
  const localOnlyConvs = (localData.conversations || []).filter((c) => !localConvIds.has(c.id));

  return {
    settings: normalized.settings,
    conversations: newConversations,
    activeConversationId: normalized.activeConversationId,
    drawConversations: mergedDrawConversations,
    activeDrawConversationId: normalized.activeDrawConversationId,
  };
}

export default function App() {
  const loadedState = useMemo(() => loadState(), []);
  const [settings, setSettings] = useState(loadedState.settings);
  const [conversations, setConversations] = useState(loadedState.conversations);
  const [activeConversationId, setActiveConversationId] = useState(loadedState.activeConversationId);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [statusText, setStatusText] = useState('已就绪');
  const [errorText, setErrorText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('history');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [visibleMessageCount, setVisibleMessageCount] = useState(50);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showCompleteHint, setShowCompleteHint] = useState(false);
  const [authState, setAuthState] = useState(() => (getToken() ? 'loading' : 'auth-form'));
  const [authLoadingActive, setAuthLoadingActive] = useState(true);
  const [authTab, setAuthTab] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '', inviteCode: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => getStoredUsername());
  const [pendingImage, setPendingImage] = useState(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawPrompt, setDrawPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [drawConversations, setDrawConversations] = useState(loadedState.drawConversations);
  const [activeDrawConversationId, setActiveDrawConversationId] = useState(loadedState.activeDrawConversationId);
  const [drawDrawerOpen, setDrawDrawerOpen] = useState(false);
  const [drawLimitWarning, setDrawLimitWarning] = useState(false);
  const [drawPendingImage, setDrawPendingImage] = useState(null);
  const [drawElapsedSeconds, setDrawElapsedSeconds] = useState(0);
  const [deleteDrawTarget, setDeleteDrawTarget] = useState(null);
  const [deleteDrawConversationTarget, setDeleteDrawConversationTarget] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState(new Set());
  const [drawSelectMode, setDrawSelectMode] = useState(false);
  const [drawSelectedMessageIds, setDrawSelectedMessageIds] = useState(new Set());
  const [deleteConversationTarget, setDeleteConversationTarget] = useState(null);
  const [balance, setBalance] = useState(null);
  const [rechargeDialogOpen, setRechargeDialogOpen] = useState(false);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [convLoading, setConvLoading] = useState(false);
  const [drawConvLoading, setDrawConvLoading] = useState(false);

  const abortControllerRef = useRef(null);
  const drawAbortControllerRef = useRef(null);
  const composerRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);
  const cloudSaveTimerRef = useRef(null);
  const programmaticScrollRef = useRef(false);
  const cloudSavingRef = useRef(false);
  const drawFileInputRef = useRef(null);
  const resumedDrawTasksRef = useRef(new Set());
  const activeDrawTaskIdsRef = useRef(new Set());
  const loadingConvRef = useRef(null);

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const activeMessages = activeConversation?.messages || [];
  const hasUserMessages = activeMessages.some((message) => message.role === 'user');
  const draftHasText = draft.trim().length > 0;
  const canSend = (draftHasText || Boolean(pendingImage)) && !isSending && authState === 'authenticated';

  const activeDrawConversation = drawConversations.find(
    (c) => c.id === activeDrawConversationId,
  ) || drawConversations[0] || null;
  const activeDrawMessages = activeDrawConversation?.messages || [];
  const drawImageCount = useMemo(() => {
    let count = 0;
    for (const c of drawConversations) {
      if (typeof c.imageCount === 'number' && c.messages.length === 0) {
        count += c.imageCount;
      } else {
        count += c.messages.filter((m) => m.role === 'assistant' && m.imageUrl).length;
      }
    }
    return count;
  }, [drawConversations]);

  const loadConversationMessages = useCallback(async (conversationId) => {
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv && conv.messages && conv.messages.length > 0) {
      return;
    }
    if (loadingConvRef.current === conversationId) return;
    loadingConvRef.current = conversationId;
    setConvLoading(true);
    try {
      const data = await fetchConversation(conversationId);
      if (data.messages) {
        const normalizedMessages = data.messages.map((m) => normalizeMessage(m, data.updatedAt));
        setConversations((current) =>
          current.map((c) =>
            c.id === conversationId
              ? { ...c, messages: normalizedMessages, title: data.title || c.title, updatedAt: data.updatedAt || c.updatedAt, messageCount: normalizedMessages.length }
              : c,
          ),
        );
      }
    } catch {
      setErrorText('加载对话失败，请重试');
    } finally {
      setConvLoading(false);
      loadingConvRef.current = null;
    }
  }, [conversations]);

  const loadDrawConversationMessages = useCallback(async (conversationId) => {
    const conv = drawConversations.find((c) => c.id === conversationId);
    if (conv && conv.messages && conv.messages.length > 0) {
      return;
    }
    setDrawConvLoading(true);
    try {
      const data = await fetchDrawConversation(conversationId);
      if (data.messages) {
        const normalizedMessages = data.messages.map((m) => normalizeMessage(m, data.updatedAt));
        setDrawConversations((current) =>
          current.map((c) =>
            c.id === conversationId
              ? { ...c, messages: normalizedMessages, title: data.title || c.title, updatedAt: data.updatedAt || c.updatedAt, messageCount: normalizedMessages.length, imageCount: normalizedMessages.filter((m) => m.role === 'assistant' && m.imageUrl).length }
              : c,
          ),
        );
      }
    } catch {
      setErrorText('加载画图记录失败，请重试');
    } finally {
      setDrawConvLoading(false);
    }
  }, [drawConversations]);

  const switchConversation = useCallback((conversationId) => {
    setActiveConversationId(conversationId);
    setDrawerOpen(false);
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv && (!conv.messages || conv.messages.length === 0)) {
      loadConversationMessages(conversationId);
    }
  }, [conversations, loadConversationMessages]);

  const switchDrawConversation = useCallback((conversationId) => {
    setActiveDrawConversationId(conversationId);
    setDrawDrawerOpen(false);
    setErrorText('');
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
    const conv = drawConversations.find((c) => c.id === conversationId);
    if (conv && (!conv.messages || conv.messages.length === 0)) {
      loadDrawConversationMessages(conversationId);
    }
  }, [drawConversations, loadDrawConversationMessages]);

  // 修正 activeDrawConversationId 如果指向的对话已被删除
  useEffect(() => {
    if (drawConversations.length > 0 && !drawConversations.find((c) => c.id === activeDrawConversationId)) {
      setActiveDrawConversationId(drawConversations[0].id);
    } else if (drawConversations.length === 0 && activeDrawConversationId) {
      setActiveDrawConversationId(null);
    }
  }, [drawConversations, activeDrawConversationId]);

  useEffect(() => {
    if (drawConversations.length > 0 && activeDrawConversationId) {
      const conv = drawConversations.find((c) => c.id === activeDrawConversationId);
      if (conv && (!conv.messages || conv.messages.length === 0) && !drawConvLoading) {
        loadDrawConversationMessages(activeDrawConversationId);
      }
    }
  }, [activeDrawConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 切换对话时重置可见消息数
  useEffect(() => {
    setVisibleMessageCount(50);
    setSelectMode(false);
    setSelectedMessageIds(new Set());
  }, [activeConversationId]);

  useEffect(() => {
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
  }, [activeDrawConversationId]);

  // 实际渲染的消息：取最后 visibleMessageCount 条
  const visibleMessages = useMemo(() => {
    if (activeMessages.length <= visibleMessageCount) return activeMessages;
    return activeMessages.slice(-visibleMessageCount);
  }, [activeMessages, visibleMessageCount]);
  const hasMoreMessages = activeMessages.length > visibleMessageCount;
  const latestMessageRenderKey = useMemo(() => {
    const latestMessage = activeMessages[activeMessages.length - 1];
    if (!latestMessage) return 'empty';
    return [
      activeMessages.length,
      latestMessage.id,
      getTextParts(latestMessage.content).length,
      getImageParts(latestMessage.content).length,
    ].join(':');
  }, [activeMessages]);

  useEffect(() => {
    // 始终同步到 localStorage（即时、无网络开销）
    saveState({
      settings,
      conversations,
      activeConversationId,
      drawConversations,
      activeDrawConversationId,
    });

    // 云端同步条件：已登录 + 非流式输出中 + 无正在进行的同步
    if (authState !== 'authenticated' || isSending || isGenerating || cloudSavingRef.current) return;

    clearTimeout(cloudSaveTimerRef.current);
    cloudSaveTimerRef.current = setTimeout(() => {
      if (cloudSavingRef.current) return;
      cloudSavingRef.current = true;
      saveToCloud({ settings, conversations, activeConversationId, drawConversations, activeDrawConversationId })
        .catch(() => {})
        .finally(() => { cloudSavingRef.current = false; });
    }, 8000);
  }, [
    settings,
    conversations,
    activeConversationId,
    drawConversations,
    activeDrawConversationId,
    authState,
    isSending,
    isGenerating,
  ]);

  // 流式输出结束后立即触发一次云端同步
  useEffect(() => {
    if (!isSending && !isGenerating && authState === 'authenticated') {
      clearTimeout(cloudSaveTimerRef.current);
      cloudSaveTimerRef.current = setTimeout(() => {
        if (cloudSavingRef.current) return;
        cloudSavingRef.current = true;
        saveToCloud({ settings, conversations, activeConversationId, drawConversations, activeDrawConversationId })
          .catch(() => {})
          .finally(() => { cloudSavingRef.current = false; });
      }, 2000);
    }
  }, [
    isSending,
    isGenerating,
    authState,
    settings,
    conversations,
    activeConversationId,
    drawConversations,
    activeDrawConversationId,
  ]);

  useEffect(() => {
    if (authState !== 'loading') return;
    let cancelled = false;
    let settleTimer = null;
    setAuthLoadingActive(true);
    loadFromCloud()
      .then((data) => {
        if (cancelled) return;
        if (data.settings) {
          const merged = mergeCloudData(loadedState, data);
          setSettings(merged.settings);
          setConversations(merged.conversations);
          setActiveConversationId(merged.activeConversationId);
          setDrawConversations(merged.drawConversations);
          setActiveDrawConversationId(merged.activeDrawConversationId);
        }
        setAuthLoadingActive(false);
        settleTimer = window.setTimeout(() => {
          if (cancelled) return;
          setAuthState('authenticated');
        }, 900);
        fetchBalance()
          .then((r) => { if (!cancelled) setBalance(r.balance); })
          .catch(() => {});
      })
      .catch(() => {
        if (cancelled) return;
        clearToken();
        setAuthLoadingActive(false);
        settleTimer = window.setTimeout(() => {
          if (cancelled) return;
          setAuthState('auth-form');
        }, 900);
      });
    return () => {
      cancelled = true;
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [authState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isGenerating) {
      setDrawElapsedSeconds(0);
      return undefined;
    }

    setDrawElapsedSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setDrawElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    if (authState !== 'authenticated') return undefined;

    const pendingTasks = [];
    for (const conversation of drawConversations) {
      if (!conversation.messages || conversation.messages.length === 0) continue;
      for (const message of conversation.messages) {
        if (
          message.role === 'assistant' &&
          message.taskId &&
          !message.imageUrl &&
          !message.error &&
          !activeDrawTaskIdsRef.current.has(message.taskId) &&
          !resumedDrawTasksRef.current.has(message.taskId)
        ) {
          pendingTasks.push({
            conversationId: conversation.id,
            messageId: message.id,
            taskId: message.taskId,
            createdAt: message.createdAt,
          });
        }
      }
    }

    if (!pendingTasks.length) return undefined;

    pendingTasks.forEach((task) => {
      resumedDrawTasksRef.current.add(task.taskId);
      activeDrawTaskIdsRef.current.add(task.taskId);
      const controller = new AbortController();

      pollDrawTask({
        settings,
        taskId: task.taskId,
        startedAt: task.createdAt,
        signal: controller.signal,
        onImage: (imageUrl, taskTiming) => {
          const durationSeconds = resolveDrawDurationSeconds(taskTiming, task.createdAt);
          updateDrawConversation(task.conversationId, (conv) => ({
            ...conv,
            messages: (conv.messages || []).map((message) =>
              message.id === task.messageId
                ? { ...message, imageUrl, error: undefined, durationSeconds }
                : message,
            ),
          }));
        },
      }).catch((error) => {
        if (error.name === 'AbortError') return;
        updateDrawConversation(task.conversationId, (conv) => ({
          ...conv,
          messages: (conv.messages || []).map((message) =>
            message.id === task.messageId
              ? { ...message, error: error.message || '图片生成失败，请稍后重试。' }
              : message,
          ),
        }));
      }).finally(() => {
        activeDrawTaskIdsRef.current.delete(task.taskId);
      });

    });
    return undefined;
  }, [authState, drawConversations, settings]);

  // 判断是否在底部（阈值 80px）
  const checkIsAtBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // 滚动到底部（用户点击按钮时调用）
  const scrollToBottom = useCallback(() => {
    const el = messageListRef.current;
    if (el) {
      programmaticScrollRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      setShowScrollToBottom(false);
      setTimeout(() => { programmaticScrollRef.current = false; }, 500);
    }
  }, []);

  // 程序主动滚到底部（登录完成、切换对话等）
  const forceScrollToBottom = useCallback(() => {
    const el = messageListRef.current;
    if (el) {
      programmaticScrollRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      setShowScrollToBottom(false);
      setTimeout(() => { programmaticScrollRef.current = false; }, 500);
    }
  }, []);

  // 监听用户滚动：只在非程序滚动时更新按钮状态
  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      setShowScrollToBottom(!checkIsAtBottom());
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [checkIsAtBottom, authState]);

  useEffect(() => {
    if (authState !== 'authenticated') return undefined;

    const rafId = requestAnimationFrame(() => {
      if (programmaticScrollRef.current) return;
      setShowScrollToBottom(!checkIsAtBottom());
    });

    return () => cancelAnimationFrame(rafId);
  }, [latestMessageRenderKey, visibleMessageCount, checkIsAtBottom, authState]);

  // 登录完成后滚到底一次
  useEffect(() => {
    if (authState === 'authenticated') {
      forceScrollToBottom();
    }
  }, [authState, forceScrollToBottom]);

  // 切换对话时滚到底一次
  useEffect(() => {
    if (authState === 'authenticated') {
      forceScrollToBottom();
    }
  }, [activeConversationId, authState, forceScrollToBottom]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      drawAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    let rafId = null;
    let stableWidth = window.innerWidth || document.documentElement.clientWidth;
    let stableHeight = window.innerHeight || document.documentElement.clientHeight;

    function applyStableHeight() {
      document.documentElement.style.setProperty('--app-height', `${Math.max(320, Math.round(stableHeight))}px`);
    }

    function applyKeyboardOffset() {
      if (!vv) {
        document.documentElement.style.setProperty('--keyboard-offset', '0px');
        return;
      }

      const keyboardOffset = Math.max(0, stableHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty(
        '--keyboard-offset',
        `${Math.round(keyboardOffset > 80 ? keyboardOffset : 0)}px`,
      );
    }

    function onViewportChange() {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const nextWidth = window.innerWidth || document.documentElement.clientWidth;
        const nextHeight = window.innerHeight || document.documentElement.clientHeight;
        const widthChanged = Math.abs(nextWidth - stableWidth) > 24;

        if (widthChanged) {
          stableWidth = nextWidth;
          stableHeight = nextHeight;
        } else if (nextHeight > stableHeight) {
          stableHeight = nextHeight;
        }

        applyStableHeight();
        applyKeyboardOffset();
        window.scrollTo(0, 0);
      });
    }

    applyStableHeight();
    applyKeyboardOffset();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    window.addEventListener('focusin', onViewportChange);
    window.addEventListener('focusout', onViewportChange);
    vv?.addEventListener('resize', onViewportChange);
    vv?.addEventListener('scroll', onViewportChange);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      window.removeEventListener('focusin', onViewportChange);
      window.removeEventListener('focusout', onViewportChange);
      vv?.removeEventListener('resize', onViewportChange);
      vv?.removeEventListener('scroll', onViewportChange);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (!copiedMessageId) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCopiedMessageId('');
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [copiedMessageId]);

  function updateConversation(conversationId, updater) {
    setConversations((current) =>
      current.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

        const nextConversation = updater(conversation);
        const msgs = nextConversation.messages || [];
        return {
          ...nextConversation,
          title: buildConversationTitle(msgs),
          updatedAt: Date.now(),
          messageCount: msgs.length,
        };
      }),
    );
  }

  function openDrawer(tab) {
    setDrawerTab(tab);
    setDrawerOpen(true);
  }

  function createNewConversation() {
    const conversation = createConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setDraft('');
    setPendingImage(null);
    setErrorText('');
    setStatusText('已创建新对话');
    setDrawerOpen(false);
  }

  function removeConversation(conversationId) {
    setConversations((current) => {
      const remaining = current.filter((item) => item.id !== conversationId);
      if (remaining.length) {
        if (conversationId === activeConversationId) {
          const nextActive = remaining[0];
          setActiveConversationId(nextActive.id);
          if (!nextActive.messages || nextActive.messages.length === 0) {
            loadConversationMessages(nextActive.id);
          }
        }
        return remaining;
      }

      const fallback = createConversation();
      setActiveConversationId(fallback.id);
      return [fallback];
    });
  }

  function stopStreaming() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
    setStatusText('已停止生成');
  }

  function openDrawMode() {
    setDrawMode(true);
    setDrawPrompt('');
    setErrorText('');
    setDrawLimitWarning(false);
    setDrawPendingImage(null);
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
    if (!activeDrawConversationId || !drawConversations.find((c) => c.id === activeDrawConversationId)) {
      const conv = createDrawConversation();
      setDrawConversations([conv]);
      setActiveDrawConversationId(conv.id);
    } else {
      const conv = drawConversations.find((c) => c.id === activeDrawConversationId);
      if (conv && (!conv.messages || conv.messages.length === 0)) {
        loadDrawConversationMessages(activeDrawConversationId);
      }
    }
  }

  function closeDrawMode() {
    setDrawMode(false);
    setErrorText('');
    setDrawDrawerOpen(false);
    setDrawLimitWarning(false);
    setDrawPendingImage(null);
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
    setStatusText('已就绪');
  }

  function stopDrawGeneration() {
    drawAbortControllerRef.current?.abort();
    drawAbortControllerRef.current = null;
    setIsGenerating(false);
    setDrawElapsedSeconds(0);
    setStatusText('图片生成已停止');
  }

  function createNewDrawConversation() {
    const conv = createDrawConversation();
    setDrawConversations((prev) => [conv, ...prev]);
    setActiveDrawConversationId(conv.id);
    setDrawPrompt('');
    setErrorText('');
    setDrawLimitWarning(false);
    setDrawPendingImage(null);
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
    setDrawElapsedSeconds(0);
    setDrawDrawerOpen(false);
  }

  function removeDrawConversation(conversationId) {
    setDrawConversations((current) => {
      const remaining = current.filter((item) => item.id !== conversationId);
      if (remaining.length) {
        if (conversationId === activeDrawConversationId) {
          const nextActive = remaining[0];
          setActiveDrawConversationId(nextActive.id);
          if (!nextActive.messages || nextActive.messages.length === 0) {
            loadDrawConversationMessages(nextActive.id);
          }
        }
        return remaining;
      }
      return [];
    });
    if (conversationId === activeDrawConversationId) {
      setDrawPrompt('');
    }
    setErrorText('');
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
  }

  function updateDrawConversation(conversationId, updater) {
    setDrawConversations((current) =>
      current.map((conv) => {
        if (conv.id !== conversationId) return conv;
        const next = updater(conv);
        const msgs = next.messages || [];
        return {
          ...next,
          updatedAt: Date.now(),
          messageCount: msgs.length,
          imageCount: msgs.filter((m) => m.role === 'assistant' && m.imageUrl).length,
        };
      }),
    );
  }

  function enforceDrawLimit() {
    setDrawConversations((current) => {
      let totalImages = 0;
      for (const c of current) {
        if (typeof c.imageCount === 'number' && (!c.messages || c.messages.length === 0)) {
          totalImages += c.imageCount;
        } else {
          totalImages += (c.messages || []).filter((m) => m.role === 'assistant' && m.imageUrl).length;
        }
      }
      if (totalImages <= 20) return current;

      const result = current.map((c) => ({ ...c, messages: [...(c.messages || [])] }));

      while (totalImages > 20 && result.length > 0) {
        let oldestConvIdx = -1;
        let oldestMsgIdx = -1;
        let oldestTime = Infinity;

        for (let ci = result.length - 1; ci >= 0; ci--) {
          const msgs = result[ci].messages;
          for (let mi = 0; mi < msgs.length; mi++) {
            if (msgs[mi].role === 'assistant' && msgs[mi].imageUrl && msgs[mi].createdAt < oldestTime) {
              oldestTime = msgs[mi].createdAt;
              oldestConvIdx = ci;
              oldestMsgIdx = mi;
            }
          }
        }

        if (oldestConvIdx < 0) break;

        const conv = result[oldestConvIdx];
        conv.messages.splice(oldestMsgIdx, 1);
        if (oldestMsgIdx > 0 && conv.messages[oldestMsgIdx - 1].role === 'user') {
          conv.messages.splice(oldestMsgIdx - 1, 1);
        }
        totalImages--;
      }

      return result.filter((c) => (c.messages || []).length > 0);
    });
  }

  async function refreshBalance() {
    try {
      const r = await fetchBalance();
      setBalance(r.balance);
    } catch {}
  }

  async function handleRecharge(amount) {
    setRechargeLoading(true);
    try {
      const r = await rechargeBalance(amount);
      setBalance(r.balance);
      setRechargeDialogOpen(false);
    } catch (error) {
      setErrorText(error.message || '充值失败');
    } finally {
      setRechargeLoading(false);
    }
  }

  async function handleDraw() {
    const prompt = drawPrompt.trim();
    if (!prompt || isGenerating || authState !== 'authenticated') {
      return;
    }

    if (balance !== null && balance < COST_DRAW - 0.0001) {
      setErrorText(`余额不足，制图需要 ${COST_DRAW} 元，当前余额 ${balance.toFixed(2)} 元`);
      setRechargeDialogOpen(true);
      return;
    }

    if (drawImageCount >= DRAW_MAX_IMAGES) {
      setDrawLimitWarning(true);
    }

    setErrorText('');
    setIsGenerating(true);
    setDrawElapsedSeconds(0);
    setStatusText('正在生成图片');

    let targetConvId = activeDrawConversationId;
    if (!targetConvId || !drawConversations.find((c) => c.id === targetConvId)) {
      const conv = createDrawConversation();
      setDrawConversations((prev) => [conv, ...prev]);
      setActiveDrawConversationId(conv.id);
      targetConvId = conv.id;
    }

    const now = Date.now();
    const userMessage = {
      id: createId(),
      role: 'user',
      content: prompt,
      referenceImage: drawPendingImage?.url || null,
      model: settings.drawModel || 'gpt-image-2',
      size: settings.drawSize || '1024x1024',
      quality: settings.drawQuality || 'medium',
      createdAt: now,
    };

    const assistantMessage = {
      id: createId(),
      role: 'assistant',
      imageUrl: null,
      prompt,
      model: settings.drawModel || 'gpt-image-2',
      size: settings.drawSize || '1024x1024',
      quality: settings.drawQuality || 'medium',
      createdAt: now + 1,
    };

    updateDrawConversation(targetConvId, (conv) => ({
      ...conv,
      title: (conv.messages || []).length === 0 ? prompt.slice(0, 18) : conv.title,
      messages: [...(conv.messages || []), userMessage, assistantMessage],
    }));

    setDrawPrompt('');
    setDrawPendingImage(null);

    const controller = new AbortController();
    drawAbortControllerRef.current = controller;
    let currentTaskId = '';

    const activeConv = drawConversations.find((c) => c.id === targetConvId);

    try {
      await generateImage({
        settings,
        prompt,
        referenceImage: userMessage.referenceImage,
        size: settings.drawSize || '1024x1024',
        quality: settings.drawQuality || 'medium',
        signal: controller.signal,
        taskMetadata: {
          conversationId: targetConvId,
          conversationTitle: activeConv?.id === targetConvId
            ? activeConv.title
            : prompt.slice(0, 18),
          activeDrawConversationId: targetConvId,
          userMessage: userMessage.referenceImage
            ? { ...userMessage, referenceImage: undefined }
            : userMessage,
          assistantMessage,
        },
        onTaskStart: (taskId) => {
          currentTaskId = taskId;
          activeDrawTaskIdsRef.current.add(taskId);
          updateDrawConversation(targetConvId, (conv) => ({
            ...conv,
            messages: (conv.messages || []).map((m) =>
              m.id === assistantMessage.id ? { ...m, taskId } : m,
            ),
          }));
        },
        onImage: (imageUrl, taskTiming) => {
          const durationSeconds = resolveDrawDurationSeconds(taskTiming, now);
          updateDrawConversation(targetConvId, (conv) => ({
            ...conv,
            messages: (conv.messages || []).map((m) =>
              m.id === assistantMessage.id ? { ...m, imageUrl, durationSeconds, error: undefined } : m,
            ),
          }));
          enforceDrawLimit();
        },
      });

      setStatusText('图片生成完成');
    } catch (error) {
      if (error.name !== 'AbortError') {
        const nextErrorText = error.message || '图片生成失败，请重试。';
        setErrorText(nextErrorText);
        setStatusText('图片生成失败');
        if (error.code === 'INSUFFICIENT_BALANCE' || error.status === 402) {
          refreshBalance();
          setRechargeDialogOpen(true);
        }
        updateDrawConversation(targetConvId, (conv) => ({
          ...conv,
          messages: (conv.messages || []).map((m) =>
            m.id === assistantMessage.id ? { ...m, error: nextErrorText } : m,
          ),
        }));
      } else {
        setStatusText('图片生成已停止');
        updateDrawConversation(targetConvId, (conv) => ({
          ...conv,
          messages: (conv.messages || []).filter((m) => m.id !== userMessage.id && m.id !== assistantMessage.id),
        }));
      }
    } finally {
      if (drawAbortControllerRef.current === controller) {
        drawAbortControllerRef.current = null;
      }
      if (currentTaskId) {
        activeDrawTaskIdsRef.current.delete(currentTaskId);
      }
      setIsGenerating(false);
      refreshBalance();
    }
  }

  async function downloadImage(imageUrl, prompt) {
    const fileName = `draw_${prompt.slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${Date.now()}.png`;

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: blob.type || 'image/png' });

      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          files: [file],
          title: '保存图片',
          text: '请选择"保存图片"或"存储到相册"。',
        });
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.alert('已触发下载。如果手机没有自动保存到相册，请在下载记录中打开图片并保存到相册。');
    } catch {
      window.open(imageUrl, '_blank');
      window.alert('已打开图片，请长按图片选择"保存到相册"。');
    }
  }

  function requestDeleteDrawMessage(conversationId, messageId) {
    setDeleteDrawTarget({ conversationId, messageId });
  }

  function cancelDeleteDrawMessage() {
    setDeleteDrawTarget(null);
  }

  function confirmDeleteDrawMessage() {
    if (!deleteDrawTarget) return;
    const { conversationId, messageId } = deleteDrawTarget;
    updateDrawConversation(conversationId, (conv) => {
      const msgs = conv.messages || [];
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx < 0) return conv;
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
    setDrawConversations((current) => current.filter((c) => (c.messages || []).length > 0));
    setDeleteDrawTarget(null);
  }

  function retryMessage(message) {
    const messageIndex = activeMessages.findIndex((m) => m.id === message.id);
    if (messageIndex < 1) return;
    const userMessage = activeMessages[messageIndex - 1];
    if (userMessage?.role !== 'user') return;
    const userText = getTextParts(userMessage.content).trim();
    if (!userText) return;

    setDraft(userText);
    composerRef.current?.focus();
  }

  async function copyMessage(message) {
    const text = buildCopyText(message);
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(message.id);
    } catch (error) {
      setErrorText('复制失败，请检查浏览器权限。');
    }
  }

  async function sendMessage(customContent) {
    const content =
      customContent ||
      [
        ...(draft.trim()
          ? [
              {
                type: 'text',
                text: draft.trim(),
              },
            ]
          : []),
        ...(pendingImage
          ? [
              {
                type: 'image_url',
                image_url: {
                  url: pendingImage.url,
                },
              },
            ]
          : []),
      ];
    const textContent = getTextParts(content).trim();
    const hasImage = getImageParts(content).length > 0;

    if ((!textContent && !hasImage) || isSending || !activeConversation || authState !== 'authenticated') {
      return;
    }

    if (balance !== null && balance < COST_CHAT - 0.0001) {
      setErrorText(`余额不足，聊天需要 ${COST_CHAT} 元，当前余额 ${balance.toFixed(2)} 元`);
      setRechargeDialogOpen(true);
      return;
    }

    const now = Date.now();
    const userMessage = {
      id: createId(),
      role: 'user',
      content,
      createdAt: now,
    };

    const assistantMessage = {
      id: createId(),
      role: 'assistant',
      content: createTextContent(''),
      createdAt: now,
    };

    const nextMessages = [...activeConversation.messages, userMessage, assistantMessage];
    setDraft('');
    setPendingImage(null);
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
        messages: nextMessages.filter(
          (message) => message.role !== 'assistant' || message.id !== assistantMessage.id,
        ),
        signal: controller.signal,
        onText: (text) => {
          updateConversation(activeConversation.id, (conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === assistantMessage.id
                ? {
                    ...message,
                    content: createTextContent(`${getTextParts(message.content)}${text}`),
                  }
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
          refreshBalance();
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
      refreshBalance();
      setShowCompleteHint(true);
      setTimeout(() => setShowCompleteHint(false), 3000);
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function quickFill(text) {
    setDraft(text);
    composerRef.current?.focus();
  }

  function enterSelectMode(preselectId) {
    setSelectMode(true);
    if (preselectId) {
      setSelectedMessageIds(new Set([preselectId]));
    } else {
      setSelectedMessageIds(new Set());
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedMessageIds(new Set());
  }

  function toggleMessageSelection(messageId) {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }

  function selectAllUserMessages() {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeMessages.forEach((m) => {
        if (m.role === 'user') next.add(m.id);
      });
      return next;
    });
  }

  function selectAllAssistantMessages() {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeMessages.forEach((m) => {
        if (m.role === 'assistant') next.add(m.id);
      });
      return next;
    });
  }

  function deleteSelectedMessages() {
    if (selectedMessageIds.size === 0 || !activeConversation) return;
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: conversation.messages.filter((m) => !selectedMessageIds.has(m.id)),
    }));
    exitSelectMode();
  }

  function enterDrawSelectMode() {
    setDrawSelectMode(true);
    setDrawSelectedMessageIds(new Set());
    setErrorText('');
  }

  function exitDrawSelectMode() {
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
  }

  function toggleDrawMessageSelection(messageId) {
    setDrawSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }

  function selectAllDrawUserMessages() {
    setDrawSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeDrawMessages.forEach((message) => {
        if (message.role === 'user') {
          next.add(message.id);
        }
      });
      return next;
    });
  }

  function selectAllDrawAssistantMessages() {
    setDrawSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeDrawMessages.forEach((message) => {
        if (message.role === 'assistant') {
          next.add(message.id);
        }
      });
      return next;
    });
  }

  function deleteSelectedDrawMessages() {
    if (!activeDrawConversation || drawSelectedMessageIds.size === 0) return;

    updateDrawConversation(activeDrawConversation.id, (conversation) => {
      const removableIds = new Set(drawSelectedMessageIds);
      const msgs = conversation.messages || [];
      msgs.forEach((message, index) => {
        if (!drawSelectedMessageIds.has(message.id)) return;

        if (message.role === 'user') {
          const nextMessage = msgs[index + 1];
          if (nextMessage?.role === 'assistant') {
            removableIds.add(nextMessage.id);
          }
        }

        if (message.role === 'assistant') {
          const previousMessage = msgs[index - 1];
          if (previousMessage?.role === 'user') {
            removableIds.add(previousMessage.id);
          }
        }
      });

      const remainingMessages = msgs.filter((message) => !removableIds.has(message.id));
      return {
        ...conversation,
        title: remainingMessages.length ? conversation.title : '新的画图',
        messages: remainingMessages,
      };
    });

    exitDrawSelectMode();
  }

  function handleLogout() {
    clearToken();
    setCurrentUser('');
    setAuthState('auth-form');
    setDrawerOpen(false);
    setStatusText('已退出登录');
  }

  function handleUploadClick() {
    if (authState !== 'authenticated') {
      return;
    }
    fileInputRef.current?.click();
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setErrorText('只能上传图片文件。');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setPendingImage({
        name: file.name,
        url: result,
      });
      setErrorText('');
    };
    reader.onerror = () => {
      setErrorText('图片读取失败，请重试。');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function clearPendingImage() {
    setPendingImage(null);
  }

  if (authState === 'auth-form') {
    return (
      <Suspense fallback={<div className="auth-loading-overlay"><div className="auth-loading-fill"><Loading active /></div></div>}>
        <AuthForm
          authTab={authTab}
          setAuthTab={setAuthTab}
          authForm={authForm}
          setAuthForm={setAuthForm}
          authError={authError}
          setAuthError={setAuthError}
          authLoading={authLoading}
          setAuthLoading={setAuthLoading}
          setAuthState={setAuthState}
          setAuthLoadingActive={setAuthLoadingActive}
          setCurrentUser={setCurrentUser}
        />
      </Suspense>
    );
  }

  return (
    <div className={classNames('chat-app', `font-scale-${settings.fontSize || 'md'}`)}>
      <div className="scene-glow scene-glow-left" aria-hidden="true" />
      <div className="scene-glow scene-glow-right" aria-hidden="true" />
      <div className="scene-hills" aria-hidden="true" />
      <Footer type="tree" className="scene-footer scene-footer-tree pc-only" />
      <Footer type="sea" seamless className="scene-footer scene-footer-sea pc-only" />

      <Drawer
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        drawerTab={drawerTab}
        setDrawerTab={setDrawerTab}
        conversations={conversations}
        activeConversationId={activeConversationId}
        switchConversation={switchConversation}
        setDeleteConversationTarget={setDeleteConversationTarget}
        createNewConversation={createNewConversation}
        settings={settings}
        setSettings={setSettings}
        handleLogout={handleLogout}
      />

      <ConfirmDialog
        visible={Boolean(deleteConversationTarget)}
        title="删除这条对话？"
        description="对话中的所有消息都会被删除，此操作不可撤销。"
        titleId="delete-conversation-title"
        onCancel={() => setDeleteConversationTarget(null)}
        onConfirm={() => { removeConversation(deleteConversationTarget); setDeleteConversationTarget(null); }}
      />

      <main className="phone-shell chat-shell">
        <ChatHeader
          selectMode={selectMode}
          selectedMessageIds={selectedMessageIds}
          exitSelectMode={exitSelectMode}
          deleteSelectedMessages={deleteSelectedMessages}
          selectAllUserMessages={selectAllUserMessages}
          selectAllAssistantMessages={selectAllAssistantMessages}
          openDrawer={openDrawer}
          activeConversation={activeConversation}
          isSending={isSending}
          statusText={statusText}
          openDrawMode={openDrawMode}
        />
        {!drawMode && (
          <BalanceBar
            balance={balance}
            cost={COST_CHAT}
            onRecharge={() => setRechargeDialogOpen(true)}
          />
        )}

        <div className="message-list-wrapper">
          <section className="message-list" ref={messageListRef} aria-live="polite">
            {convLoading && visibleMessages.length === 0 && (
              <div className="conv-loading-hint">
                <Loading active />
                <span>加载对话中...</span>
              </div>
            )}
            {hasMoreMessages && (
              <div className="load-more-bar">
                <Button
                  type="dashed"
                  size="small"
                  onClick={() => setVisibleMessageCount((c) => c + 50)}
                >
                  加载更早消息（还有 {activeMessages.length - visibleMessageCount} 条）
                </Button>
              </div>
            )}
            {visibleMessages.length === 0 && !isSending && !convLoading && (
              <div className="empty-state">
                <Card className="welcome-panel" type="dashed" pattern="default">
                  <div className="welcome-label">岛上广播</div>
                  <Title size="large" color="app-yellow">开始一段新对话</Title>
                  <p>在下方输入你的问题，或者先点一个常用方向，让这次对话更快进入状态。</p>
                  <Divider type="wave-yellow" className="welcome-divider" />
                  <div className="suggestions">
                    <button type="button" onClick={() => quickFill('帮我把这段中文文案润色得更自然、更口语一些')}>
                      润色文案
                    </button>
                    <button type="button" onClick={() => quickFill('帮我整理一个本周工作计划，按优先级和时间块输出')}>
                      整理计划
                    </button>
                    <button type="button" onClick={() => quickFill('请把这段内容总结成 5 条重点，并补充一个执行建议')}>
                      总结重点
                    </button>
                    <button type="button" onClick={() => quickFill('我想做一个 H5 页面，请先帮我梳理结构、文案和视觉方向')}>
                      页面策划
                    </button>
                  </div>
                </Card>
              </div>
            )}
            {visibleMessages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                isLatestAssistant={
                  isSending &&
                  message.role === 'assistant' &&
                  message === activeMessages[activeMessages.length - 1]
                }
                isSending={isSending}
                copiedMessageId={copiedMessageId}
                onCopy={copyMessage}
                onRetry={retryMessage}
                selectMode={selectMode}
                selected={selectedMessageIds.has(message.id)}
                onToggleSelect={toggleMessageSelection}
                onEnterSelectMode={enterSelectMode}
              />
            ))}
            <div ref={messagesEndRef} />
          </section>
          <Scrollbar scrollRef={messageListRef} />
          {showScrollToBottom && (
            <Button
              type="default"
              size="small"
              className="scroll-to-bottom-button"
              onClick={scrollToBottom}
              aria-label="滚动到底部"
              icon={
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 10 17 15 12" /><line x1="10" y1="3" x2="10" y2="17" /></svg>
              }
            />
          )}
        </div>

        <Composer
          draft={draft}
          setDraft={setDraft}
          isSending={isSending}
          canSend={canSend}
          sendMessage={sendMessage}
          stopStreaming={stopStreaming}
          handleComposerKeyDown={handleComposerKeyDown}
          selectMode={selectMode}
          selectedMessageIds={selectedMessageIds}
          exitSelectMode={exitSelectMode}
          selectAllUserMessages={selectAllUserMessages}
          selectAllAssistantMessages={selectAllAssistantMessages}
          deleteSelectedMessages={deleteSelectedMessages}
          showCompleteHint={showCompleteHint}
          errorText={errorText}
          pendingImage={pendingImage}
          clearPendingImage={clearPendingImage}
          handleUploadClick={handleUploadClick}
          composerRef={composerRef}
          fileInputRef={fileInputRef}
          handleFileChange={handleFileChange}
        />
      </main>

      {drawMode && (
        <Suspense fallback={null}>
          <DrawPage
            settings={settings}
            setSettings={setSettings}
            drawConversations={drawConversations}
            activeDrawConversationId={activeDrawConversationId}
            switchDrawConversation={switchDrawConversation}
            activeDrawConversation={activeDrawConversation}
            activeDrawMessages={activeDrawMessages}
            drawImageCount={drawImageCount}
            isGenerating={isGenerating}
            drawElapsedSeconds={drawElapsedSeconds}
            drawPrompt={drawPrompt}
            setDrawPrompt={setDrawPrompt}
            drawPendingImage={drawPendingImage}
            setDrawPendingImage={setDrawPendingImage}
            drawDrawerOpen={drawDrawerOpen}
            setDrawDrawerOpen={setDrawDrawerOpen}
            drawSelectMode={drawSelectMode}
            drawSelectedMessageIds={drawSelectedMessageIds}
            errorText={errorText}
            setErrorText={setErrorText}
            drawLimitWarning={drawLimitWarning}
            setDrawLimitWarning={setDrawLimitWarning}
            deleteDrawTarget={deleteDrawTarget}
            setDeleteDrawTarget={setDeleteDrawTarget}
            deleteDrawConversationTarget={deleteDrawConversationTarget}
            setDeleteDrawConversationTarget={setDeleteDrawConversationTarget}
            closeDrawMode={closeDrawMode}
            createNewDrawConversation={createNewDrawConversation}
            removeDrawConversation={removeDrawConversation}
            stopDrawGeneration={stopDrawGeneration}
            handleDraw={handleDraw}
            downloadImage={downloadImage}
            requestDeleteDrawMessage={requestDeleteDrawMessage}
            cancelDeleteDrawMessage={cancelDeleteDrawMessage}
            confirmDeleteDrawMessage={confirmDeleteDrawMessage}
            exitDrawSelectMode={exitDrawSelectMode}
            enterDrawSelectMode={enterDrawSelectMode}
            toggleDrawMessageSelection={toggleDrawMessageSelection}
            selectAllDrawUserMessages={selectAllDrawUserMessages}
            selectAllDrawAssistantMessages={selectAllDrawAssistantMessages}
            deleteSelectedDrawMessages={deleteSelectedDrawMessages}
            drawFileInputRef={drawFileInputRef}
            authState={authState}
            balance={balance}
            onRecharge={() => setRechargeDialogOpen(true)}
            drawConvLoading={drawConvLoading}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <RechargeDialog
          visible={rechargeDialogOpen}
          balance={balance}
          loading={rechargeLoading}
          onRecharge={handleRecharge}
          onCancel={() => setRechargeDialogOpen(false)}
        />
      </Suspense>

      {authState === 'loading' && <AuthLoading active={authLoadingActive} />}
    </div>
  );
}
