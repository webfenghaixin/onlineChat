import { Suspense, useCallback, useEffect, useMemo, useRef, useState, lazy } from 'react';
import { streamChatCompletion, generateImageBatch, pollDrawTask } from './lib/stream';
import { register, login, saveToCloud, loadFromCloud, getToken, clearToken, getStoredUsername, fetchBalance, rechargeBalance, fetchConversation, fetchDrawConversation } from './lib/auth';
import {
  DRAW_MAX_IMAGES,
  DRAW_MIN_BATCH_COUNT,
  DRAW_MAX_BATCH_COUNT,
  CHAT_MAX_IMAGES,
  COST_CHAT,
  COST_DRAW,
  BALANCE_RECHARGE_PRESETS,
} from './lib/constants';
import { prepareChatImage } from './lib/image-utils';
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
  if (!cloudData) {
    return localData;
  }

  const hasCloudConversations = Array.isArray(cloudData.conversations) && cloudData.conversations.length > 0;
  const hasCloudDrawConversations = Array.isArray(cloudData.drawConversations) && cloudData.drawConversations.length > 0;
  const normalized = normalizeState({
    settings: cloudData.settings || localData.settings,
    conversations: hasCloudConversations ? cloudData.conversations : [createConversation()],
    activeConversationId: hasCloudConversations ? cloudData.activeConversationId : null,
    drawConversations: hasCloudDrawConversations ? cloudData.drawConversations : [],
    activeDrawConversationId: hasCloudDrawConversations ? cloudData.activeDrawConversationId : null,
  });

  const conversations = normalized.conversations.map((conversation) => {
    if (!hasCloudConversations) return conversation;
    return {
      ...conversation,
      messages: [],
      messagesLoaded: (conversation.messageCount || 0) === 0,
    };
  });

  const drawConversations = normalized.drawConversations.map((conversation) => ({
    ...conversation,
    messages: [],
    messagesLoaded: (conversation.messageCount || 0) === 0,
  }));

  const activeConversationId = conversations.some((conversation) => conversation.id === normalized.activeConversationId)
    ? normalized.activeConversationId
    : conversations[0]?.id || null;
  const activeDrawConversationId = drawConversations.some((conversation) => conversation.id === normalized.activeDrawConversationId)
    ? normalized.activeDrawConversationId
    : drawConversations[0]?.id || null;

  return {
    settings: normalized.settings,
    conversations,
    activeConversationId,
    drawConversations,
    activeDrawConversationId,
  };
}

function buildCloudSaveConversations(items, dirtyVersions, targetVersion, isDraw = false) {
  return items.map((conversation) => {
    const messagesLoaded = (dirtyVersions.get(conversation.id) || 0) <= targetVersion
      && dirtyVersions.has(conversation.id);
    const summary = {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messageCount || 0,
      messagesLoaded,
      messages: messagesLoaded ? (conversation.messages || []) : [],
    };
    if (isDraw) {
      summary.imageCount = conversation.imageCount || 0;
    } else {
      summary.lastPreview = conversation.lastPreview || '';
    }
    return summary;
  });
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
  const [pendingImages, setPendingImages] = useState([]);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawPrompt, setDrawPrompt] = useState('');
  const [isDrawSubmitting, setIsDrawSubmitting] = useState(false);
  const [drawConversations, setDrawConversations] = useState(loadedState.drawConversations);
  const [activeDrawConversationId, setActiveDrawConversationId] = useState(loadedState.activeDrawConversationId);
  const [drawDrawerOpen, setDrawDrawerOpen] = useState(false);
  const [drawLimitWarning, setDrawLimitWarning] = useState(false);
  const [drawPendingImages, setDrawPendingImages] = useState([]);
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
  const [loadingConversationId, setLoadingConversationId] = useState(null);
  const [loadingDrawConversationId, setLoadingDrawConversationId] = useState(null);
  const [cloudDirtyVersion, setCloudDirtyVersion] = useState(0);
  const [cloudSaveRetryTick, setCloudSaveRetryTick] = useState(0);

  const abortControllerRef = useRef(null);
  const drawTaskControllersRef = useRef(new Map());
  const drawSubmissionRef = useRef(null);
  const composerRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatImageProcessingRef = useRef(false);
  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);
  const cloudSaveTimerRef = useRef(null);
  const programmaticScrollRef = useRef(false);
  const cloudSavingRef = useRef(null);
  const cloudLoadingRef = useRef(false);
  const cloudSessionRef = useRef(0);
  const cloudDirtyVersionRef = useRef(0);
  const cloudSavedVersionRef = useRef(0);
  const cloudWasBusyRef = useRef(false);
  const dirtyConversationVersionsRef = useRef(new Map());
  const dirtyDrawConversationVersionsRef = useRef(new Map());
  const drawFileInputRef = useRef(null);
  const resumedDrawTasksRef = useRef(new Set());
  const activeDrawTaskIdsRef = useRef(new Set());
  const loadingConversationIdsRef = useRef(new Set());
  const loadingDrawConversationIdsRef = useRef(new Set());
  const newDrawConvRef = useRef(new Set());
  const conversationsRef = useRef(conversations);
  const drawConversationsRef = useRef(drawConversations);
  const activeDrawConversationIdRef = useRef(activeDrawConversationId);

  conversationsRef.current = conversations;
  drawConversationsRef.current = drawConversations;
  activeDrawConversationIdRef.current = activeDrawConversationId;

  const convLoading = loadingConversationId === activeConversationId;
  const drawConvLoading = loadingDrawConversationId === activeDrawConversationId;

  const markCloudDirty = useCallback(({ conversationId, conversationIds, drawConversationId, drawConversationIds } = {}) => {
    const nextVersion = cloudDirtyVersionRef.current + 1;
    cloudDirtyVersionRef.current = nextVersion;
    if (conversationId) dirtyConversationVersionsRef.current.set(conversationId, nextVersion);
    for (const id of (conversationIds || [])) {
      if (id) dirtyConversationVersionsRef.current.set(id, nextVersion);
    }
    if (drawConversationId) dirtyDrawConversationVersionsRef.current.set(drawConversationId, nextVersion);
    for (const id of (drawConversationIds || [])) {
      if (id) dirtyDrawConversationVersionsRef.current.set(id, nextVersion);
    }
    setCloudDirtyVersion(nextVersion);
  }, []);

  const resetCloudDirtyState = useCallback(() => {
    clearTimeout(cloudSaveTimerRef.current);
    cloudSessionRef.current += 1;
    cloudSavingRef.current = null;
    cloudDirtyVersionRef.current = 0;
    cloudSavedVersionRef.current = 0;
    cloudWasBusyRef.current = false;
    dirtyConversationVersionsRef.current.clear();
    dirtyDrawConversationVersionsRef.current.clear();
    setCloudDirtyVersion(0);
  }, []);

  const updateSettings = useCallback((updater) => {
    setSettings((current) => (typeof updater === 'function' ? updater(current) : updater));
    markCloudDirty();
  }, [markCloudDirty]);

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const activeMessages = activeConversation?.messages || [];
  const hasUserMessages = activeMessages.some((message) => message.role === 'user');
  const draftHasText = draft.trim().length > 0;
  const canSend = Boolean(activeConversation?.messagesLoaded)
    && !convLoading
    && (draftHasText || pendingImages.length > 0)
    && !isSending
    && authState === 'authenticated';

  const activeDrawConversation = drawConversations.find(
    (c) => c.id === activeDrawConversationId,
  ) || drawConversations[0] || null;
  const activeDrawMessages = activeDrawConversation?.messages || [];
  const pendingDrawTaskCount = useMemo(() => {
    let count = 0;
    for (const conversation of drawConversations) {
      for (const message of (conversation.messages || [])) {
        if (
          message.role === 'assistant' &&
          !message.imageUrl &&
          !message.error &&
          (message.pending || message.taskId)
        ) {
          count += 1;
        }
      }
    }
    return count;
  }, [drawConversations]);
  const isGenerating = pendingDrawTaskCount > 0;
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
  }, []);

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
        const normalizedMessages = data.messages.map((m) => normalizeMessage(m, data.updatedAt));
        setDrawConversations((current) =>
          current.map((c) =>
            c.id === conversationId
              ? { ...c, messages: normalizedMessages, messagesLoaded: true, title: data.title || c.title, updatedAt: data.updatedAt || c.updatedAt, messageCount: normalizedMessages.length, imageCount: normalizedMessages.filter((m) => m.role === 'assistant' && m.imageUrl).length }
              : c,
          ),
        );
      }
    } catch {
      setErrorText('加载画图记录失败，请重试');
    } finally {
      loadingDrawConversationIdsRef.current.delete(conversationId);
      setLoadingDrawConversationId((current) => (current === conversationId ? null : current));
    }
  }, []);

  // 强制刷新绘图会话消息（绕过 messagesLoaded 检查），用于页面切回时同步后端最新状态
  const refreshDrawConversationMessages = useCallback(async (conversationId) => {
    if (!conversationId) return;
    if (loadingDrawConversationIdsRef.current.has(conversationId)) return;
    loadingDrawConversationIdsRef.current.add(conversationId);
    setLoadingDrawConversationId(conversationId);
    try {
      const data = await fetchDrawConversation(conversationId);
      if (Array.isArray(data.messages)) {
        const normalizedMessages = data.messages.map((m) => normalizeMessage(m, data.updatedAt));
        setDrawConversations((current) =>
          current.map((c) =>
            c.id === conversationId
              ? { ...c, messages: normalizedMessages, messagesLoaded: true, title: data.title || c.title, updatedAt: data.updatedAt || c.updatedAt, messageCount: normalizedMessages.length, imageCount: normalizedMessages.filter((m) => m.role === 'assistant' && m.imageUrl).length }
              : c,
          ),
        );
      }
    } catch {
      // 静默失败，不影响用户体验
    } finally {
      loadingDrawConversationIdsRef.current.delete(conversationId);
      setLoadingDrawConversationId((current) => (current === conversationId ? null : current));
    }
  }, []);

  const switchConversation = useCallback((conversationId) => {
    if (conversationId !== activeConversationId) {
      setActiveConversationId(conversationId);
      markCloudDirty();
    }
    setDrawerOpen(false);
    loadConversationMessages(conversationId);
  }, [activeConversationId, loadConversationMessages, markCloudDirty]);

  const switchDrawConversation = useCallback((conversationId) => {
    if (conversationId !== activeDrawConversationId) {
      setActiveDrawConversationId(conversationId);
      markCloudDirty();
    }
    setDrawDrawerOpen(false);
    setErrorText('');
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
    loadDrawConversationMessages(conversationId);
  }, [activeDrawConversationId, loadDrawConversationMessages, markCloudDirty]);

  // 修正 activeDrawConversationId 如果指向的对话已被删除
  useEffect(() => {
    if (drawConversations.length > 0 && !drawConversations.find((c) => c.id === activeDrawConversationId)) {
      setActiveDrawConversationId(drawConversations[0].id);
    } else if (drawConversations.length === 0 && activeDrawConversationId) {
      setActiveDrawConversationId(null);
    }
  }, [drawConversations, activeDrawConversationId]);

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
    saveState({
      settings,
      conversations,
      activeConversationId,
      drawConversations,
      activeDrawConversationId,
    });
  }, [settings, conversations, activeConversationId, drawConversations, activeDrawConversationId]);

  useEffect(() => {
    const isBusy = isSending || isGenerating;
    const wasBusy = cloudWasBusyRef.current;
    cloudWasBusyRef.current = isBusy;
    clearTimeout(cloudSaveTimerRef.current);
    if (
      authState !== 'authenticated'
      || isBusy
      || cloudDirtyVersionRef.current <= cloudSavedVersionRef.current
    ) {
      return undefined;
    }

    const targetVersion = cloudDirtyVersionRef.current;
    const saveSession = cloudSessionRef.current;
    const conversationVersions = new Map(dirtyConversationVersionsRef.current);
    const drawConversationVersions = new Map(dirtyDrawConversationVersionsRef.current);
    const payload = {
      settings,
      conversations: buildCloudSaveConversations(conversations, conversationVersions, targetVersion),
      activeConversationId,
      drawConversations: buildCloudSaveConversations(drawConversations, drawConversationVersions, targetVersion, true),
      activeDrawConversationId,
    };
    const delay = wasBusy ? 2000 : 8000;

    cloudSaveTimerRef.current = window.setTimeout(() => {
      if (cloudSavingRef.current === saveSession) return;
      cloudSavingRef.current = saveSession;
      let saveSucceeded = false;
      saveToCloud(payload)
        .then(() => {
          if (cloudSessionRef.current !== saveSession) return;
          saveSucceeded = true;
          cloudSavedVersionRef.current = Math.max(cloudSavedVersionRef.current, targetVersion);
          for (const [id, version] of conversationVersions) {
            if (dirtyConversationVersionsRef.current.get(id) === version) {
              dirtyConversationVersionsRef.current.delete(id);
            }
          }
          for (const [id, version] of drawConversationVersions) {
            if (dirtyDrawConversationVersionsRef.current.get(id) === version) {
              dirtyDrawConversationVersionsRef.current.delete(id);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          if (cloudSavingRef.current === saveSession) {
            cloudSavingRef.current = null;
          }
          const hasUnsavedFollowUp = saveSucceeded
            ? cloudDirtyVersionRef.current > cloudSavedVersionRef.current
            : cloudDirtyVersionRef.current > targetVersion;
          if (cloudSessionRef.current === saveSession && hasUnsavedFollowUp) {
            setCloudSaveRetryTick((current) => current + 1);
          }
        });
    }, delay);

    return () => clearTimeout(cloudSaveTimerRef.current);
  }, [
    authState,
    isSending,
    isGenerating,
    cloudDirtyVersion,
    cloudSaveRetryTick,
    settings,
    conversations,
    activeConversationId,
    drawConversations,
    activeDrawConversationId,
  ]);

  useEffect(() => {
    if (authState !== 'loading') {
      // 离开 loading 状态，重置标记，允许下次登录重新加载
      cloudLoadingRef.current = false;
      return;
    }
    // 用 ref 去重，避免 StrictMode 双挂载导致 loadFromCloud 被调用两次
    if (cloudLoadingRef.current) return;
    cloudLoadingRef.current = true;
    resetCloudDirtyState();

    let settleTimer = null;
    setAuthLoadingActive(true);
    loadFromCloud()
      .then((data) => {
        const merged = mergeCloudData(loadedState, data);
        conversationsRef.current = merged.conversations;
        drawConversationsRef.current = merged.drawConversations;
        setSettings(merged.settings);
        setConversations(merged.conversations);
        setActiveConversationId(merged.activeConversationId);
        setDrawConversations(merged.drawConversations);
        setActiveDrawConversationId(merged.activeDrawConversationId);
        if ((!Array.isArray(data.conversations) || data.conversations.length === 0) && merged.activeConversationId) {
          // 新账号的默认对话不在登录时立即保存，但在之后第一次真实变更时一并持久化。
          dirtyConversationVersionsRef.current.set(merged.activeConversationId, 1);
        }
        if (merged.activeConversationId) {
          loadConversationMessages(merged.activeConversationId);
        }
        setAuthLoadingActive(false);
        settleTimer = window.setTimeout(() => {
          setAuthState('authenticated');
        }, 900);
        fetchBalance()
          .then((r) => setBalance(r.balance))
          .catch(() => {});
      })
      .catch(() => {
        clearToken();
        setAuthLoadingActive(false);
        settleTimer = window.setTimeout(() => {
          setAuthState('auth-form');
        }, 900);
      });
    return () => {
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [authState]); // eslint-disable-line react-hooks/exhaustive-deps

  // 页面切回时：abort 旧轮询，清理 refs，刷新消息，让恢复 useEffect 重新扫描 pending 任务
  useEffect(() => {
    if (authState !== 'authenticated') return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;

      // abort 所有正在进行的轮询（旧循环可能已超时或 fetch 被中断）
      for (const controller of drawTaskControllersRef.current.values()) {
        controller.abort();
      }
      drawTaskControllersRef.current.clear();
      // 清理 refs，允许恢复 useEffect 重新扫描 pending 任务
      activeDrawTaskIdsRef.current.clear();
      resumedDrawTasksRef.current.clear();

      // 强制刷新当前活跃会话的消息（从 Redis 获取最新状态）
      const activeConvId = activeDrawConversationIdRef.current;
      if (activeConvId) {
        refreshDrawConversationMessages(activeConvId);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [authState, refreshDrawConversationMessages]);

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
      drawTaskControllersRef.current.set(task.messageId, controller);

      pollDrawTask({
        settings,
        taskId: task.taskId,
        startedAt: Date.now(),
        signal: controller.signal,
        onImage: (imageUrl, taskTiming) => {
          const durationSeconds = resolveDrawDurationSeconds(taskTiming, task.createdAt);
          updateDrawConversation(task.conversationId, (conv) => ({
            ...conv,
            messages: (conv.messages || []).map((message) =>
              message.id === task.messageId
                ? { ...message, imageUrl, error: undefined, pending: false, durationSeconds }
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
              ? { ...message, error: error.message || '图片生成失败，请稍后重试。', pending: false }
              : message,
          ),
        }));
      }).finally(() => {
        if (drawTaskControllersRef.current.get(task.messageId) === controller) {
          drawTaskControllersRef.current.delete(task.messageId);
        }
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
      for (const controller of drawTaskControllersRef.current.values()) {
        controller.abort();
      }
      drawTaskControllersRef.current.clear();
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
    markCloudDirty({ conversationId });
    setConversations((current) =>
      current.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

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
  }

  function openDrawer(tab) {
    setDrawerTab(tab);
    setDrawerOpen(true);
  }

  function createNewConversation() {
    const conversation = createConversation();
    markCloudDirty({ conversationId: conversation.id });
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setDraft('');
    setPendingImages([]);
    setErrorText('');
    setStatusText('已创建新对话');
    setDrawerOpen(false);
  }

  function removeConversation(conversationId) {
    const remaining = conversations.filter((item) => item.id !== conversationId);
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
    setDrawPendingImages([]);
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
    if (!activeDrawConversationId || !drawConversations.find((c) => c.id === activeDrawConversationId)) {
      const conv = createDrawConversation();
      markCloudDirty({ drawConversationId: conv.id });
      setDrawConversations([conv]);
      setActiveDrawConversationId(conv.id);
    } else {
      const conv = drawConversations.find((c) => c.id === activeDrawConversationId);
      if (conv && !conv.messagesLoaded) {
        loadDrawConversationMessages(activeDrawConversationId);
      }
    }
  }

  function closeDrawMode() {
    setDrawMode(false);
    setErrorText('');
    setDrawDrawerOpen(false);
    setDrawLimitWarning(false);
    setDrawPendingImages([]);
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
    setStatusText('已就绪');
  }

  function createNewDrawConversation() {
    const conv = createDrawConversation();
    newDrawConvRef.current.add(conv.id);
    markCloudDirty({ drawConversationId: conv.id });
    setDrawConversations((prev) => [conv, ...prev]);
    setActiveDrawConversationId(conv.id);
    setDrawPrompt('');
    setErrorText('');
    setDrawLimitWarning(false);
    setDrawPendingImages([]);
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
    setDrawDrawerOpen(false);
  }

  function removeDrawConversation(conversationId) {
    newDrawConvRef.current.delete(conversationId);
    markCloudDirty();
    setDrawConversations((current) => {
      const remaining = current.filter((item) => item.id !== conversationId);
      if (remaining.length) {
        if (conversationId === activeDrawConversationId) {
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
    if (conversationId === activeDrawConversationId) {
      setDrawPrompt('');
    }
    setErrorText('');
    setDrawSelectMode(false);
    setDrawSelectedMessageIds(new Set());
  }

  function updateDrawConversation(conversationId, updater) {
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
  }

  function enforceDrawLimit() {
    markCloudDirty({
      drawConversationIds: drawConversations
        .filter((conversation) => conversation.messagesLoaded)
        .map((conversation) => conversation.id),
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
        const oldestMessage = conv.messages[oldestMsgIdx];
        if (oldestMessage.batchId) {
          const removedImageCount = conv.messages.filter(
            (message) => message.batchId === oldestMessage.batchId && message.role === 'assistant' && message.imageUrl,
          ).length;
          conv.messages = conv.messages.filter((message) => message.batchId !== oldestMessage.batchId);
          totalImages -= removedImageCount;
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
    if (!prompt || drawSubmissionRef.current || drawConvLoading || !activeDrawConversation?.messagesLoaded || authState !== 'authenticated') {
      return;
    }

    const referenceImages = drawPendingImages.map((img) => img.url).filter(Boolean);
    const imageCount = Math.min(
      DRAW_MAX_BATCH_COUNT,
      Math.max(DRAW_MIN_BATCH_COUNT, Number(settings.drawImageCount) || 1),
    );
    await _executeDraw({
      prompt,
      referenceImages,
      targetConvId: activeDrawConversationId,
      model: settings.drawModel || 'gpt-image-2',
      size: settings.drawSize || '1024x1024',
      quality: settings.drawQuality || 'medium',
      imageCount,
    });
  }

  async function retryDraw(userMessageId) {
    const conv = drawConversations.find((c) => c.id === activeDrawConversationId);
    if (!conv || !conv.messages) return;

    const userMsg = conv.messages.find((m) => m.id === userMessageId);
    if (!userMsg) return;

    const referenceImages = Array.isArray(userMsg.referenceImages) && userMsg.referenceImages.length > 0
      ? userMsg.referenceImages
      : userMsg.referenceImage
        ? [userMsg.referenceImage]
        : [];

    await _executeDraw({
      prompt: getTextParts(userMsg.content),
      referenceImages,
      targetConvId: conv.id,
      model: userMsg.model || settings.drawModel || 'gpt-image-2',
      size: userMsg.size || settings.drawSize || '1024x1024',
      quality: userMsg.quality || settings.drawQuality || 'medium',
      imageCount: userMsg.imageCount || 1,
    });
  }

  function editDrawMessage(userMessageId) {
    const conv = drawConversations.find((c) => c.id === activeDrawConversationId);
    if (!conv || !conv.messages) return;

    const userMsg = conv.messages.find((m) => m.id === userMessageId);
    if (!userMsg) return;

    setDrawPrompt(getTextParts(userMsg.content));

    const referenceImages = Array.isArray(userMsg.referenceImages) && userMsg.referenceImages.length > 0
      ? userMsg.referenceImages
      : userMsg.referenceImage
        ? [userMsg.referenceImage]
        : [];

    setDrawPendingImages(referenceImages.map((url, i) => ({ name: `参考图${i + 1}`, url })));
    updateSettings((current) => ({
      ...current,
      drawModel: userMsg.model || current.drawModel,
      drawSize: userMsg.size || current.drawSize,
      drawQuality: userMsg.quality || current.drawQuality,
      drawImageCount: Math.min(
        DRAW_MAX_BATCH_COUNT,
        Math.max(DRAW_MIN_BATCH_COUNT, Number(userMsg.imageCount) || 1),
      ),
    }));
  }

  async function _executeDraw({ prompt, referenceImages, targetConvId, model, size, quality, imageCount = 1 }) {
    if (!prompt || drawSubmissionRef.current || authState !== 'authenticated') return;

    const requestedCount = Math.min(
      DRAW_MAX_BATCH_COUNT,
      Math.max(DRAW_MIN_BATCH_COUNT, Number(imageCount) || 1),
    );
    const totalCost = Number((COST_DRAW * requestedCount).toFixed(2));

    if (balance !== null && balance < totalCost - 0.0001) {
      setErrorText(`余额不足，生成 ${requestedCount} 张图需要 ${totalCost.toFixed(2)} 元，当前余额 ${balance.toFixed(2)} 元`);
      setRechargeDialogOpen(true);
      return;
    }

    const submissionId = createId();
    drawSubmissionRef.current = submissionId;
    setIsDrawSubmitting(true);
    const releaseSubmission = () => {
      if (drawSubmissionRef.current !== submissionId) return;
      drawSubmissionRef.current = null;
      setIsDrawSubmitting(false);
    };

    if (drawImageCount + requestedCount > DRAW_MAX_IMAGES) setDrawLimitWarning(true);

    setErrorText('');
    setStatusText('正在提交图片任务');

    if (!targetConvId || !drawConversations.find((c) => c.id === targetConvId)) {
      const conv = createDrawConversation();
      markCloudDirty({ drawConversationId: conv.id });
      setDrawConversations((prev) => [conv, ...prev]);
      setActiveDrawConversationId(conv.id);
      targetConvId = conv.id;
    }

    const now = Date.now();
    const batchId = createId();
    const userMessage = {
      id: createId(),
      role: 'user',
      content: prompt,
      referenceImage: referenceImages[0] || null,
      referenceImages: referenceImages.length > 0 ? referenceImages : null,
      model,
      size,
      quality,
      batchId,
      imageCount: requestedCount,
      createdAt: now,
    };

    const assistantMessages = Array.from({ length: requestedCount }, (_, index) => ({
      id: createId(),
      role: 'assistant',
      imageUrl: null,
      prompt,
      model,
      size,
      quality,
      batchId,
      batchIndex: index,
      imageCount: requestedCount,
      pending: true,
      createdAt: now + index + 1,
    }));

    updateDrawConversation(targetConvId, (conv) => ({
      ...conv,
      title: (conv.messages || []).length === 0 ? prompt.slice(0, 18) : conv.title,
      messages: [...(conv.messages || []), userMessage, ...assistantMessages],
    }));

    setDrawPrompt('');
    setDrawPendingImages([]);

    const activeConv = drawConversations.find((c) => c.id === targetConvId);
    const batchController = new AbortController();
    const taskIdToMessageId = new Map();
    let startedTaskCount = 0;

    try {
      const results = await generateImageBatch({
        settings,
        prompt,
        referenceImages,
        size,
        quality,
        count: requestedCount,
        signal: batchController.signal,
        taskMetadata: {
          conversationId: targetConvId,
          conversationTitle: activeConv?.id === targetConvId ? activeConv.title : prompt.slice(0, 18),
          activeDrawConversationId: targetConvId,
          userMessage,
          assistantMessages,
        },
        onTasksCreated: () => {
          // batch 请求返回后立即释放提交锁，不等轮询完成，用户可继续提交
          releaseSubmission();
        },
        onTaskStart: (taskId, messageId) => {
          startedTaskCount += 1;
          taskIdToMessageId.set(taskId, messageId);
          activeDrawTaskIdsRef.current.add(taskId);
          drawTaskControllersRef.current.set(messageId, batchController);
          updateDrawConversation(targetConvId, (conv) => ({
            ...conv,
            messages: (conv.messages || []).map((message) =>
              message.id === messageId ? { ...message, taskId, pending: true } : message,
            ),
          }));
          setStatusText(`已提交 ${startedTaskCount}/${requestedCount} 个图片任务`);
        },
        onImage: (imageUrl, taskTiming, taskId) => {
          const messageId = taskIdToMessageId.get(taskId);
          if (!messageId) return;
          const durationSeconds = resolveDrawDurationSeconds(taskTiming, now);
          updateDrawConversation(targetConvId, (conv) => ({
            ...conv,
            messages: (conv.messages || []).map((message) =>
              message.id === messageId
                ? { ...message, imageUrl, durationSeconds, error: undefined, pending: false }
                : message,
            ),
          }));
          enforceDrawLimit();
        },
      });

      // results 是 generateImageBatch 返回的数组，每项 { messageId, ok, error? }
      const successCount = results.filter((result) => result.ok).length;
      const failedResults = results.filter((result) => !result.ok);

      // 标记失败任务为 error
      for (const result of failedResults) {
        updateDrawConversation(targetConvId, (conv) => ({
          ...conv,
          messages: (conv.messages || []).map((message) =>
            message.id === result.messageId
              ? { ...message, error: result.error, pending: false }
              : message,
          ),
        }));
      }

      if (successCount === requestedCount) {
        setStatusText(`${requestedCount} 张图片生成完成`);
      } else if (successCount > 0) {
        setStatusText(`已完成 ${successCount}/${requestedCount} 张图片`);
        setErrorText(`有 ${failedResults.length} 张图片生成失败，可在结果中查看。`);
      } else if (failedResults.length > 0) {
        setStatusText('图片生成失败');
        setErrorText(failedResults[0].error);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        // AbortError：保持 pending 状态，不标记 error，不移除消息
        // 页面切回时 visibilitychange 会刷新消息并重新恢复轮询
        setStatusText('图片生成已暂停');
      } else if (error instanceof TypeError) {
        // 网络错误：保持 pending 状态，不标记 error
        // 后端任务可能仍在运行，切回时会重新查询
        setStatusText('网络中断，任务在后端继续执行');
      } else {
        const nextErrorText = error.message || '图片生成失败，请重试。';
        // 批量接口整体失败：标记所有未完成的 assistantMessage 为 error
        updateDrawConversation(targetConvId, (conv) => ({
          ...conv,
          messages: (conv.messages || []).map((message) =>
            message.batchId === batchId && message.role === 'assistant' && !message.imageUrl
              ? { ...message, error: nextErrorText, pending: false }
              : message,
          ),
        }));
        if (error.code === 'INSUFFICIENT_BALANCE' || error.status === 402) {
          setRechargeDialogOpen(true);
        }
        setStatusText('图片生成失败');
        setErrorText(nextErrorText);
      }
    } finally {
      releaseSubmission();
      refreshBalance();
      // 只清理本批次设置的 controllers 和 activeTaskIds，不影响恢复轮询的任务
      for (const messageId of taskIdToMessageId.values()) {
        if (drawTaskControllersRef.current.get(messageId) === batchController) {
          drawTaskControllersRef.current.delete(messageId);
        }
      }
      for (const taskId of taskIdToMessageId.keys()) {
        activeDrawTaskIdsRef.current.delete(taskId);
      }
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
      const targetMessage = msgs[idx];
      if (targetMessage.batchId) {
        return {
          ...conv,
          messages: msgs.filter((message) => message.batchId !== targetMessage.batchId),
        };
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
    setDrawConversations((current) => current.filter((c) => (
      c.id !== conversationId || !c.messagesLoaded || (c.messages || []).length > 0
    )));
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
        ...pendingImages.map((img) => ({
          type: 'image_url',
          image_url: {
            url: img.url,
          },
        })),
      ];
    const textContent = getTextParts(content).trim();
    const hasImage = getImageParts(content).length > 0;

    if (
      (!textContent && !hasImage)
      || isSending
      || convLoading
      || !activeConversation?.messagesLoaded
      || authState !== 'authenticated'
    ) {
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

        if (message.batchId) {
          msgs.forEach((batchMessage) => {
            if (batchMessage.batchId === message.batchId) removableIds.add(batchMessage.id);
          });
          return;
        }

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
    resetCloudDirtyState();
    setCurrentUser('');
    setAuthState('auth-form');
    setDrawerOpen(false);
    setStatusText('已退出登录');
  }

  // 监听 401 事件，自动跳回登录页
  useEffect(() => {
    function onUnauthorized() {
      resetCloudDirtyState();
      setCurrentUser('');
      setAuthState('auth-form');
      setDrawerOpen(false);
      setDrawMode(false);
      setErrorText('登录已过期，请重新登录');
    }
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, [resetCloudDirtyState]);

  function handleUploadClick() {
    if (authState !== 'authenticated') {
      return;
    }
    fileInputRef.current?.click();
  }

  async function processChatImageFiles(files) {
    if (authState !== 'authenticated') return;
    if (chatImageProcessingRef.current) {
      setErrorText('图片正在处理中，请稍候。');
      return;
    }

    const normalizedFiles = Array.from(files || []);
    if (normalizedFiles.length === 0) {
      return;
    }

    const imageFiles = normalizedFiles.filter((file) => file?.type?.startsWith('image/'));
    if (imageFiles.length === 0) {
      setErrorText('只能上传图片文件。');
      return;
    }

    const remainingSlots = CHAT_MAX_IMAGES - pendingImages.length;
    if (remainingSlots <= 0) {
      setErrorText(`最多只能上传 ${CHAT_MAX_IMAGES} 张图片。`);
      return;
    }

    const filesToProcess = imageFiles.slice(0, remainingSlots);
    if (imageFiles.length > remainingSlots) {
      setErrorText(`最多只能上传 ${CHAT_MAX_IMAGES} 张图片，已添加前 ${remainingSlots} 张。`);
    } else {
      setErrorText('');
    }

    chatImageProcessingRef.current = true;
    setImageProcessing(true);
    setStatusText('正在处理图片');
    try {
      const results = await Promise.all(
        filesToProcess.map(async (file) => {
          const optimizedUrl = await prepareChatImage(file);
          return { name: file.name || `clipboard-image-${Date.now()}`, url: optimizedUrl };
        }),
      );
      setPendingImages((prev) => [...prev, ...results]);
      setStatusText('已就绪');
    } catch (error) {
      setErrorText(error.message || '图片处理失败，请重试。');
      setStatusText('图片处理失败');
    } finally {
      chatImageProcessingRef.current = false;
      setImageProcessing(false);
    }
  }

  function handleFileChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void processChatImageFiles(files);
  }

  function handleComposerPaste(event) {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const itemImages = Array.from(clipboardData.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    const fileImages = Array.from(clipboardData.files || [])
      .filter((file) => file?.type?.startsWith('image/'));
    const imageFiles = itemImages.length > 0 ? itemImages : fileImages;

    if (imageFiles.length === 0) return;
    event.preventDefault();
    void processChatImageFiles(imageFiles);
  }

  function removePendingImage(index) {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }

  function clearPendingImages() {
    setPendingImages([]);
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
        setSettings={updateSettings}
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
          pendingImages={pendingImages}
          removePendingImage={removePendingImage}
          clearPendingImages={clearPendingImages}
          handleUploadClick={handleUploadClick}
          imageProcessing={imageProcessing}
          composerRef={composerRef}
          fileInputRef={fileInputRef}
          handleFileChange={handleFileChange}
          handleComposerPaste={handleComposerPaste}
        />
      </main>

      {drawMode && (
        <Suspense
          fallback={
            <div className="draw-page draw-page-skeleton">
              <Loading active />
            </div>
          }
        >
          <DrawPage
            settings={settings}
            setSettings={updateSettings}
            drawConversations={drawConversations}
            activeDrawConversationId={activeDrawConversationId}
            switchDrawConversation={switchDrawConversation}
            activeDrawConversation={activeDrawConversation}
            activeDrawMessages={activeDrawMessages}
            drawImageCount={drawImageCount}
            isGenerating={isGenerating}
            pendingDrawTaskCount={pendingDrawTaskCount}
            isDrawSubmitting={isDrawSubmitting}
            drawPrompt={drawPrompt}
            setDrawPrompt={setDrawPrompt}
            drawPendingImages={drawPendingImages}
            setDrawPendingImages={setDrawPendingImages}
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
            retryDraw={retryDraw}
            editDrawMessage={editDrawMessage}
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
