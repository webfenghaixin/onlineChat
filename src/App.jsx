import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { streamChatCompletion, generateImage, pollDrawTask } from './lib/stream';
import { register, login, saveToCloud, loadFromCloud, getToken, clearToken, getStoredUsername } from './lib/auth';

const STORAGE_KEY = 'online-chat-h5-state-v7';
const VITE_INVITE_CODE = import.meta.env.VITE_INVITE_CODE || '';
const MAX_COMPOSER_HEIGHT = 140;
const FONT_SIZE_OPTIONS = [
  { value: 'md', label: '标准' },
  { value: 'lg', label: '大字' },
  { value: 'xl', label: '超大' },
];

const SOURCE_OPTIONS = [
  { value: 'luxee', label: 'Luxee' },
  { value: 'rightcode', label: 'RightCode' },
];

const RIGHTCODE_PRICING_OPTIONS = [
  { value: 'regular', label: '正价' },
  { value: 'daily', label: '日抛' },
];

const MODEL_OPTIONS = [
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-medium', label: 'GPT-5.4-Medium' },
  { value: 'gpt-5.4-high', label: 'GPT-5.4-High' },
];

const DRAW_SIZE_OPTIONS = [
  { value: '1024x1024', label: '1:1 方图' },
  { value: '1024x1536', label: '2:3 竖图' },
  { value: '1536x1024', label: '3:2 横图' },
];

const DRAW_QUALITY_OPTIONS = [
  { value: 'low', label: '快速' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '高清' },
];

const DRAW_API_MODE_OPTIONS = [
  { value: 'images', label: 'Images API' },
  { value: 'chat', label: 'Chat API' },
];

marked.setOptions({
  breaks: true,
  gfm: true,
});

const markdownCache = new Map();
const MARKDOWN_CACHE_MAX = 200;

function renderMarkdown(text) {
  if (!text) return '';
  const cached = markdownCache.get(text);
  if (cached !== undefined) return cached;
  const html = marked.parse(text);
  if (markdownCache.size >= MARKDOWN_CACHE_MAX) {
    const firstKey = markdownCache.keys().next().value;
    markdownCache.delete(firstKey);
  }
  markdownCache.set(text, html);
  return html;
}

const defaultSettings = {
  source: 'rightcode',
  rightcodePricing: 'regular',
  endpoint: '',
  apiKey: '',
  model: 'gpt-5.4',
  requestMode: 'chat',
  systemPrompt: '你是一位耐心、清晰、友好的 AI 助手。请优先用简洁易懂的中文回答。',
  temperature: 0.7,
  maxOutputTokens: 8192,
  stream: true,
  useProxy: true,
  proxyPath: '/api/proxy',
  fontSize: 'lg',
  drawSize: '1024x1024',
  drawQuality: 'medium',
  drawApiMode: 'images',
};

const DRAW_REFERENCE_MAX_DIMENSION = 1536;
const DRAW_REFERENCE_MAX_BYTES = 1.5 * 1024 * 1024;
const DRAW_REFERENCE_MIN_QUALITY = 0.55;

function getTextParts(content) {
  if (Array.isArray(content)) {
    return content
      .filter((item) => item?.type === 'text' && item.text)
      .map((item) => item.text)
      .join('\n');
  }

  return typeof content === 'string' ? content : '';
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('参考图读取失败'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('参考图解析失败'));
    image.src = src;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('参考图压缩失败'));
    }, type, quality);
  });
}

async function prepareDrawReferenceImage(file) {
  const originalDataUrl = await readAsDataUrl(file);
  const image = await loadImageElement(originalDataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const maxEdge = Math.max(sourceWidth, sourceHeight);
  const scale = maxEdge > DRAW_REFERENCE_MAX_DIMENSION
    ? DRAW_REFERENCE_MAX_DIMENSION / maxEdge
    : 1;

  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('参考图处理失败，请更换浏览器后重试。');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  let quality = 0.86;
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality);

  while (blob.size > DRAW_REFERENCE_MAX_BYTES && quality > DRAW_REFERENCE_MIN_QUALITY) {
    quality = Math.max(DRAW_REFERENCE_MIN_QUALITY, quality - 0.08);
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  }

  if (blob.size > DRAW_REFERENCE_MAX_BYTES) {
    throw new Error('参考图仍然过大，请先裁剪后再上传。');
  }

  return readAsDataUrl(blob);
}

function getImageParts(content) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter((item) => item?.type === 'image_url' && item.image_url?.url);
}

function createTextContent(text) {
  return [
    {
      type: 'text',
      text,
    },
  ];
}

function createConversation() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '新的对话',
    updatedAt: now,
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: createTextContent('你好，直接把问题发给我就行。我会尽量用清楚、好读的方式回答。'),
        createdAt: now,
      },
    ],
  };
}

function createDrawConversation() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '新的画图',
    updatedAt: now,
    messages: [],
  };
}

function normalizeMessage(message, fallbackTimestamp) {
  const rawContent = Array.isArray(message?.content)
    ? message.content
    : createTextContent(typeof message?.content === 'string' ? message.content : '');

  return {
    ...message,
    content: rawContent,
    createdAt: message?.createdAt || fallbackTimestamp || Date.now(),
  };
}

function normalizeState(parsed) {
  const initialConversation = createConversation();
  const conversations =
    Array.isArray(parsed?.conversations) && parsed.conversations.length
      ? parsed.conversations.map((conversation) => ({
          ...conversation,
          messages: (conversation.messages || []).map((message) =>
            normalizeMessage(message, conversation.updatedAt),
          ),
        }))
      : [initialConversation];

  const drawConversations =
    Array.isArray(parsed?.drawConversations) && parsed.drawConversations.length
      ? parsed.drawConversations
      : [];

  return {
    settings: {
      ...defaultSettings,
      ...(parsed?.settings || {}),
    },
    conversations,
    activeConversationId: parsed?.activeConversationId || conversations[0].id,
    drawConversations,
    activeDrawConversationId: parsed?.activeDrawConversationId || (drawConversations[0]?.id ?? null),
  };
}

function loadState() {
  try {
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    if (currentRaw) {
      return normalizeState(JSON.parse(currentRaw));
    }
  } catch (error) {
    return normalizeState(null);
  }

  return normalizeState(null);
}

function saveState(state) {
  try {
    // 过滤掉画图消息中的 referenceImage（base64 数据过大，且仅临时使用）
    const cleanedDrawConversations = state.drawConversations.map((conv) => ({
      ...conv,
      messages: conv.messages.map((msg) => {
        if (msg.referenceImage) {
          const { referenceImage, ...rest } = msg;
          return rest;
        }
        return msg;
      }),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, drawConversations: cleanedDrawConversations }));
  } catch {
    // localStorage 可能已满，忽略写入错误
  }
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function resolveDrawDurationSeconds(taskTiming, fallbackStartedAt) {
  const createdAt = Number(taskTiming?.createdAt || fallbackStartedAt || 0);
  const completedAt = Number(taskTiming?.completedAt || Date.now());
  if (!createdAt || !completedAt || completedAt < createdAt) {
    return 0;
  }

  return Math.max(0, Math.round((completedAt - createdAt) / 1000));
}

function buildConversationTitle(messages) {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) {
    return '新的对话';
  }

  const titleSource = getTextParts(firstUserMessage.content);
  return titleSource.slice(0, 18) || '新的对话';
}

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function buildCopyText(message) {
  const text = getTextParts(message.content).trim();
  if (!text) {
    return '';
  }

  return `${message.role === 'assistant' ? 'AI' : '我'}：${text}`;
}

function Scrollbar({ scrollRef }) {
  const [thumbState, setThumbState] = useState({ top: 0, height: 0, visible: false });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ y: 0, scrollTop: 0 });
  const fadeTimer = useRef(null);
  const [showThumb, setShowThumb] = useState(false);

  const updateThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const trackHeight = clientHeight;
    const canScroll = scrollHeight > clientHeight;
    const thumbHeight = Math.max(36, (clientHeight / scrollHeight) * trackHeight);
    const maxThumbTop = trackHeight - thumbHeight;
    const maxScrollTop = scrollHeight - clientHeight;
    const top = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;
    setThumbState({ top, height: thumbHeight, visible: canScroll });
    setShowThumb(true);
    clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      if (!dragging) setShowThumb(false);
    }, 1500);
  }, [scrollRef, dragging]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateThumb();
    el.addEventListener('scroll', updateThumb);
    const ro = new ResizeObserver(updateThumb);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateThumb);
      ro.disconnect();
    };
  }, [scrollRef, updateThumb]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const delta = clientY - dragStart.current.y;
      const el = scrollRef.current;
      if (!el) return;
      const { scrollHeight, clientHeight } = el;
      const trackHeight = clientHeight;
      const thumbHeight = Math.max(36, (clientHeight / scrollHeight) * trackHeight);
      const maxThumbTop = trackHeight - thumbHeight;
      const maxScrollTop = scrollHeight - clientHeight;
      const scrollDelta = maxThumbTop > 0 ? (delta / maxThumbTop) * maxScrollTop : 0;
      el.scrollTop = dragStart.current.scrollTop + scrollDelta;
    };
    const onUp = () => {
      setDragging(false);
      setShowThumb(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging, scrollRef]);

  function handleThumbDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStart.current = { y: clientY, scrollTop: scrollRef.current?.scrollTop || 0 };
    setDragging(true);
    setShowThumb(true);
  }

  function handleTrackClick(e) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const { scrollHeight, clientHeight } = el;
    const ratio = clickY / rect.height;
    el.scrollTop = ratio * (scrollHeight - clientHeight);
  }

  if (!thumbState.visible) return null;

  return (
    <div
      className={classNames('custom-scrollbar-track', showThumb && 'custom-scrollbar-track-visible')}
      onClick={handleTrackClick}
    >
      <div
        className={classNames('custom-scrollbar-thumb', dragging && 'custom-scrollbar-thumb-active')}
        style={{ top: thumbState.top, height: thumbState.height }}
        onMouseDown={handleThumbDown}
        onTouchStart={handleThumbDown}
      />
    </div>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  isLatestAssistant,
  isSending,
  copiedMessageId,
  onCopy,
  onRetry,
  selectMode,
  selected,
  onToggleSelect,
}) {
  const images = getImageParts(message.content);
  const text = getTextParts(message.content);
  const isAssistant = message.role === 'assistant';

  return (
    <article
      className={classNames(
        'message-row',
        message.role === 'user' ? 'message-user' : 'message-assistant',
        selectMode && 'message-row-selectable',
        selectMode && selected && 'message-row-selected',
      )}
      onClick={selectMode ? () => onToggleSelect(message.id) : undefined}
    >
      {selectMode && (
        <div className={classNames('message-checkbox', selected && 'message-checkbox-checked')}>
          {selected ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
          )}
        </div>
      )}
      <div className="message-content-col">
        <div className="message-meta">
          {isAssistant && <img className="message-avatar" src="/logo-2.png" alt="" />}
          <span>{message.role === 'user' ? '我' : 'AI'}</span>
          <time>{formatTime(message.createdAt || Date.now())}</time>
        </div>

        <div className="message-bubble">
          {images.length > 0 && (
            <div className="message-images">
              {images.map((image) => (
                <img
                  key={image.image_url.url}
                  className="message-image"
                  src={image.image_url.url}
                  alt="上传图片"
                />
              ))}
            </div>
          )}

          {isAssistant ? (
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(text || (isLatestAssistant ? '正在思考...' : '')),
              }}
            />
          ) : (
            text
          )}
          {isLatestAssistant && <span className="typing-cursor" />}
        </div>

        {!selectMode && (
          <div className={classNames('message-tools', message.role === 'user' && 'message-tools-user')}>
            {isAssistant && text.startsWith('出错了') && !isSending && (
              <button
                type="button"
                className="tool-button tool-button-retry"
                onClick={() => onRetry(message)}
              >
                重新提问
              </button>
            )}
            <button
              type="button"
              className={classNames('tool-button tool-button-icon', copiedMessageId === message.id && 'tool-button-copied', message.role === 'user' && 'tool-button-user')}
              onClick={() => onCopy(message)}
              aria-label="复制"
            >
              {copiedMessageId === message.id ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" /></svg>
              )}
            </button>
          </div>
        )}
      </div>
    </article>
  );
});

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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState(new Set());
  const [drawSelectMode, setDrawSelectMode] = useState(false);
  const [drawSelectedMessageIds, setDrawSelectedMessageIds] = useState(new Set());

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
  const drawImageCount = drawConversations.reduce(
    (sum, c) => sum + c.messages.filter((m) => m.role === 'assistant' && m.imageUrl).length,
    0,
  );

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
    loadFromCloud()
      .then((data) => {
        if (cancelled) return;
        if (data.settings) {
          const normalized = normalizeState(data);
          setSettings(normalized.settings);
          setConversations(normalized.conversations);
          setActiveConversationId(normalized.activeConversationId);
          setDrawConversations(normalized.drawConversations);
          setActiveDrawConversationId(normalized.activeDrawConversationId);
        }
        setAuthState('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        clearToken();
        setAuthState('auth-form');
      });
    return () => { cancelled = true; };
  }, [authState]);

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
      for (const message of conversation.messages || []) {
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
            messages: conv.messages.map((message) =>
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
          messages: conv.messages.map((message) =>
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
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [draft]);

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
        return {
          ...nextConversation,
          title: buildConversationTitle(nextConversation.messages),
          updatedAt: Date.now(),
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
          setActiveConversationId(remaining[0].id);
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
    // If no active draw conversation, create one
    if (!activeDrawConversationId || !drawConversations.find((c) => c.id === activeDrawConversationId)) {
      const conv = createDrawConversation();
      setDrawConversations([conv]);
      setActiveDrawConversationId(conv.id);
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
          setActiveDrawConversationId(remaining[0].id);
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
        return { ...next, updatedAt: Date.now() };
      }),
    );
  }

  function enforceDrawLimit() {
    setDrawConversations((current) => {
      let totalImages = current.reduce(
        (sum, c) => sum + c.messages.filter((m) => m.role === 'assistant' && m.imageUrl).length,
        0,
      );
      if (totalImages <= 20) return current;

      // Need to remove oldest images
      const result = current.map((c) => ({ ...c, messages: [...c.messages] }));

      while (totalImages > 20 && result.length > 0) {
        // Find the conversation with the oldest assistant image message
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

        // Remove the oldest image message and its preceding user message
        const conv = result[oldestConvIdx];
        const removedMsg = conv.messages[oldestMsgIdx];
        conv.messages.splice(oldestMsgIdx, 1);
        // Also remove the user prompt right before it
        if (oldestMsgIdx > 0 && conv.messages[oldestMsgIdx - 1].role === 'user') {
          conv.messages.splice(oldestMsgIdx - 1, 1);
        }
        totalImages--;
      }

      // Remove empty conversations
      return result.filter((c) => c.messages.length > 0);
    });
  }

  async function handleDraw() {
    const prompt = drawPrompt.trim();
    if (!prompt || isGenerating || authState !== 'authenticated') {
      return;
    }

    // Check limit
    if (drawImageCount >= 20) {
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
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      referenceImage: drawPendingImage?.url || null,
      size: settings.drawSize || '1024x1024',
      quality: settings.drawQuality || 'medium',
      createdAt: now,
    };

    const assistantMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      imageUrl: null,
      prompt,
      size: settings.drawSize || '1024x1024',
      quality: settings.drawQuality || 'medium',
      createdAt: now + 1,
    };

    updateDrawConversation(targetConvId, (conv) => ({
      ...conv,
      title: conv.messages.length === 0 ? prompt.slice(0, 18) : conv.title,
      messages: [...conv.messages, userMessage, assistantMessage],
    }));

    setDrawPrompt('');
    setDrawPendingImage(null);

    const controller = new AbortController();
    drawAbortControllerRef.current = controller;
    let currentTaskId = '';

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
          conversationTitle: activeDrawConversation?.id === targetConvId
            ? activeDrawConversation.title
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
            messages: conv.messages.map((m) =>
              m.id === assistantMessage.id ? { ...m, taskId } : m,
            ),
          }));
        },
        onImage: (imageUrl, taskTiming) => {
          const durationSeconds = resolveDrawDurationSeconds(taskTiming, now);
          updateDrawConversation(targetConvId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === assistantMessage.id ? { ...m, imageUrl, durationSeconds, error: undefined } : m,
            ),
          }));
          // Enforce 20 image limit (auto-replace oldest)
          enforceDrawLimit();
        },
      });

      setStatusText('图片生成完成');
    } catch (error) {
      if (error.name !== 'AbortError') {
        const nextErrorText = error.message || '图片生成失败，请重试。';
        setErrorText(nextErrorText);
        setStatusText('图片生成失败');
        // Update the assistant message with error
        updateDrawConversation(targetConvId, (conv) => ({
          ...conv,
          messages: conv.messages.map((m) =>
            m.id === assistantMessage.id ? { ...m, error: nextErrorText } : m,
          ),
        }));
      } else {
        setStatusText('图片生成已停止');
        // Remove the incomplete messages
        updateDrawConversation(targetConvId, (conv) => ({
          ...conv,
          messages: conv.messages.filter((m) => m.id !== userMessage.id && m.id !== assistantMessage.id),
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
          text: '请选择“保存图片”或“存储到相册”。',
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
      window.alert('已打开图片，请长按图片选择“保存到相册”。');
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
      const idx = conv.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return conv;
      const newMessages = [...conv.messages];
      // If this is an assistant message, also remove the preceding user message
      if (newMessages[idx].role === 'assistant' && idx > 0 && newMessages[idx - 1].role === 'user') {
        newMessages.splice(idx - 1, 2);
      } else if (newMessages[idx].role === 'user' && idx + 1 < newMessages.length && newMessages[idx + 1].role === 'assistant') {
        newMessages.splice(idx, 2);
      } else {
        newMessages.splice(idx, 1);
      }
      return { ...conv, messages: newMessages };
    });
    // Clean up empty conversations
    setDrawConversations((current) => current.filter((c) => c.messages.length > 0));
    setDeleteDrawTarget(null);
  }

  function retryMessage(message) {
    const messageIndex = activeMessages.findIndex((m) => m.id === message.id);
    if (messageIndex < 1) return;
    const userMessage = activeMessages[messageIndex - 1];
    if (userMessage?.role !== 'user') return;
    const userText = getTextParts(userMessage.content).trim();
    const userImages = getImageParts(userMessage.content);
    if (!userText && !userImages.length) return;

    // 移除失败的 assistant 消息和对应的 user 消息
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: conversation.messages.filter((m) => m.id !== message.id && m.id !== userMessage.id),
    }));

    // 用原始内容重新发送
    sendMessage(userMessage.content);
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

    const now = Date.now();
    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: now,
    };

    const assistantMessage = {
      id: crypto.randomUUID(),
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
      // 回答完成提示
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

  function enterSelectMode() {
    setSelectMode(true);
    setSelectedMessageIds(new Set());
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
      conversation.messages.forEach((message, index) => {
        if (!drawSelectedMessageIds.has(message.id)) return;

        if (message.role === 'user') {
          const nextMessage = conversation.messages[index + 1];
          if (nextMessage?.role === 'assistant') {
            removableIds.add(nextMessage.id);
          }
        }

        if (message.role === 'assistant') {
          const previousMessage = conversation.messages[index - 1];
          if (previousMessage?.role === 'user') {
            removableIds.add(previousMessage.id);
          }
        }
      });

      const remainingMessages = conversation.messages.filter((message) => !removableIds.has(message.id));
      return {
        ...conversation,
        title: remainingMessages.length ? conversation.title : '新的画图',
        messages: remainingMessages,
      };
    });

    exitDrawSelectMode();
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError('');

    if (authTab === 'register') {
      if (VITE_INVITE_CODE && authForm.inviteCode !== VITE_INVITE_CODE) {
        setAuthError('邀请码不正确');
        return;
      }
    }

    setAuthLoading(true);

    try {
      if (authTab === 'register') {
        await register(authForm.username, authForm.password, authForm.inviteCode);
      } else {
        await login(authForm.username, authForm.password);
      }
      setCurrentUser(authForm.username);
      setAuthForm({ username: '', password: '', inviteCode: '' });
      setAuthState('loading');
    } catch (error) {
      setAuthError(error.message || '操作失败');
    } finally {
      setAuthLoading(false);
    }
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

  if (authState === 'loading') {
    return (
      <div className="gate-shell">
        <section className="gate-card">
          <img className="gate-logo" src="/logo-2.png" alt="" />
          {/* <h1>lightChat</h1> */}
          <p>loading...</p>
        </section>
      </div>
    );
  }

  if (authState === 'auth-form') {
    return (
      <div className="gate-shell">
        <section className="gate-card">
          <img className="gate-logo pc-only" src="/logo-2.png" alt="" />
          <h1 className="pc-only" style={{ textAlign: 'center', marginBottom: 24 }}>lightChat</h1>

          <div className="auth-tabs" role="tablist">
            <button
              className={classNames('tab-button', authTab === 'login' && 'tab-button-active')}
              type="button"
              onClick={() => { setAuthTab('login'); setAuthError(''); }}
            >
              登录
            </button>
            <button
              className={classNames('tab-button', authTab === 'register' && 'tab-button-active')}
              type="button"
              onClick={() => { setAuthTab('register'); setAuthError(''); }}
            >
              注册
            </button>
          </div>

          <form className="gate-form" onSubmit={handleAuthSubmit}>
            <input
              className="gate-input"
              type="text"
              value={authForm.username}
              onChange={(e) => setAuthForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="用户名"
              autoComplete="username"
              required
            />
            <input
              className="gate-input"
              type="password"
              value={authForm.password}
              onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="密码"
              autoComplete={authTab === 'register' ? 'new-password' : 'current-password'}
              required
            />
            {authTab === 'register' && (
              <input
                className="gate-input"
                type="text"
                value={authForm.inviteCode}
                onChange={(e) => setAuthForm((f) => ({ ...f, inviteCode: e.target.value }))}
                placeholder="邀请码"
                required
              />
            )}
            <button className="gate-button" type="submit" disabled={authLoading}>
              {authLoading ? '请稍候...' : authTab === 'login' ? '登录' : '注册'}
            </button>
          </form>

          {authError && <div className="gate-error">{authError}</div>}
        </section>
      </div>
    );
  }

  return (
    <div className={classNames('chat-app', `font-scale-${settings.fontSize || 'md'}`)}>
      <aside className={classNames('drawer', drawerOpen && 'drawer-open')}>
        <div className="drawer-header">
          <div className="drawer-brand">
            <img className="drawer-logo" src="/logo-2.png" alt="" />
            <div>
              <div className="drawer-kicker">lightChat</div>
              <div className="drawer-title">{drawerTab === 'history' ? '对话记录' : '接口设置'}</div>
            </div>
          </div>
          <button className="plain-icon-button" type="button" onClick={() => setDrawerOpen(false)}>
            关闭
          </button>
        </div>

        <div className="drawer-tabs" role="tablist">
          <button
            className={classNames('tab-button', drawerTab === 'history' && 'tab-button-active')}
            type="button"
            onClick={() => setDrawerTab('history')}
          >
            对话
          </button>
          <button
            className={classNames('tab-button', drawerTab === 'settings' && 'tab-button-active')}
            type="button"
            onClick={() => setDrawerTab('settings')}
          >
            设置
          </button>
        </div>

        {drawerTab === 'history' ? (
          <div className="history-pane">
            <button className="primary-button wide-button" type="button" onClick={createNewConversation}>
              新建对话
            </button>

            <div className="history-list">
              {conversations
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((conversation) => (
                  <div
                    key={conversation.id}
                    className={classNames(
                      'history-card',
                      conversation.id === activeConversationId && 'history-card-active',
                    )}
                  >
                    <button
                      className="history-main"
                      type="button"
                      onClick={() => {
                        setActiveConversationId(conversation.id);
                        setDrawerOpen(false);
                      }}
                    >
                      <span className="history-title">{conversation.title}</span>
                      <span className="history-time">
                        {conversation.messages.length} 条消息 · {formatDateTime(conversation.updatedAt)}
                      </span>
                    </button>
                    <button
                      className="history-delete"
                      type="button"
                      aria-label="删除对话"
                      onClick={() => removeConversation(conversation.id)}
                    >
                      删除
                    </button>
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <div className="settings-form">
            <label className="field">
              <span className="field-label">字体大小</span>
              <select
                className="field-input"
                value={settings.fontSize}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, fontSize: event.target.value }))
                }
              >
                {FONT_SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">接口来源</span>
              <select
                className="field-input"
                value={settings.source}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, source: event.target.value }))
                }
              >
                {SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {settings.source === 'rightcode' && (
              <label className="field">
                <span className="field-label">计费方式</span>
                <select
                  className="field-input"
                  value={settings.rightcodePricing || 'regular'}
                  onChange={(event) => {
                    const pricing = event.target.value;
                    setSettings((current) => ({
                      ...current,
                      rightcodePricing: pricing,
                    }));
                  }}
                >
                  {RIGHTCODE_PRICING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!settings.useProxy && (
              <>
                <label className="field">
                  <span className="field-label">请求地址</span>
                  <input
                    className="field-input"
                    value={settings.endpoint}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, endpoint: event.target.value }))
                    }
                    placeholder="请输入真实上游接口地址"
                  />
                </label>

                <label className="field">
                  <span className="field-label">密钥</span>
                  <input
                    className="field-input"
                    value={settings.apiKey}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, apiKey: event.target.value }))
                    }
                    placeholder="请输入 API Key"
                  />
                </label>
              </>
            )}

            <label className="field">
              <span className="field-label">模型名</span>
              <select
                className="field-input"
                value={settings.model}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, model: event.target.value }))
                }
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">系统提示词</span>
              <textarea
                className="field-input field-textarea"
                value={settings.systemPrompt}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, systemPrompt: event.target.value }))
                }
                placeholder="可用来固定助手风格"
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span className="field-label">温度</span>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.temperature}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      temperature: Number(event.target.value),
                    }))
                  }
                />
              </label>

              <label className="field">
                <span className="field-label">最大输出</span>
                <input
                  className="field-input"
                  type="number"
                  min="256"
                  step="128"
                  value={settings.maxOutputTokens}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      maxOutputTokens: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </div>

            <label className="check-field">
              <input
                type="checkbox"
                checked={settings.stream}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, stream: event.target.checked }))
                }
              />
              <span>启用流式输出</span>
            </label>

            <label className="check-field">
              <input
                type="checkbox"
                checked={settings.useProxy}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, useProxy: event.target.checked }))
                }
              />
              <span>通过代理请求</span>
            </label>

            <label className="field">
              <span className="field-label">代理地址</span>
              <input
                className="field-input"
                value={settings.proxyPath}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, proxyPath: event.target.value }))
                }
                placeholder="/api/proxy 或 https://你的代理地址"
              />
            </label>

            <button className="secondary-button wide-button" type="button" onClick={handleLogout}>
              退出登录
            </button>
          </div>
        )}
      </aside>

      {drawerOpen && (
        <button
          className="drawer-backdrop"
          type="button"
          aria-label="关闭面板"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <main className="phone-shell">
        <header className={classNames('chat-header', selectMode ? 'chat-header-select' : 'chat-header-3col')}>
          {selectMode ? (
            <>
              <button className="header-button header-button-text" type="button" onClick={exitSelectMode}>
                取消
              </button>
              <div className="chat-title">
                <h1>已选 {selectedMessageIds.size} 条</h1>
              </div>
              <button className="header-button header-button-icon" type="button" onClick={deleteSelectedMessages} disabled={selectedMessageIds.size === 0} aria-label="删除">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
              </button>
            </>
          ) : (
            <>
              <button className="header-button header-button-icon" type="button" onClick={() => openDrawer('history')}>
                <span aria-hidden="true">☰</span>
              </button>

              <div className="chat-title">
                <img className="header-logo" src="/logo-2.png" alt="" />
                <h1>{activeConversation?.title || 'lightChat'}</h1>
                <p>
                  <span className={classNames('status-dot', isSending && 'status-dot-live')} />
                  {statusText}
                </p>
              </div>

              <button className="header-button header-button-icon draw-header-button" type="button" onClick={openDrawMode} aria-label="画图">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
              </button>
            </>
          )}
        </header>

        <div className="message-list-wrapper">
          <section className="message-list" ref={messageListRef} aria-live="polite">
            {hasMoreMessages && (
              <div className="load-more-bar">
                <button
                  type="button"
                  className="load-more-button"
                  onClick={() => setVisibleMessageCount((c) => c + 50)}
                >
                  加载更早消息（还有 {activeMessages.length - visibleMessageCount} 条）
                </button>
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
              />
            ))}
            <div ref={messagesEndRef} />
          </section>
          <Scrollbar scrollRef={messageListRef} />
          {showScrollToBottom && (
            <button
              type="button"
              className="scroll-to-bottom-button"
              onClick={scrollToBottom}
              aria-label="滚动到底部"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 10 17 15 12" /><line x1="10" y1="3" x2="10" y2="17" /></svg>
            </button>
          )}
        </div>

        <footer className="composer-panel">
          {selectMode ? (
            <div className="select-action-bar">
              <button className="select-action-btn select-action-btn-user" type="button" onClick={selectAllUserMessages}>
                全选用户
              </button>
              <button className="select-action-btn select-action-btn-ai" type="button" onClick={selectAllAssistantMessages}>
                全选AI
              </button>
              <button
                className="select-action-btn select-action-btn-delete"
                type="button"
                onClick={deleteSelectedMessages}
                disabled={selectedMessageIds.size === 0}
              >
                删除({selectedMessageIds.size})
              </button>
            </div>
          ) : (
            <>
              {showCompleteHint && !isSending && (
                <div className="complete-hint">回答完成</div>
              )}
              {errorText && <div className="error-banner">{errorText}</div>}

              {pendingImage && (
                <div className="pending-image-card">
                  <img className="pending-image-preview" src={pendingImage.url} alt="待发送图片" />
                  <div className="pending-image-info">
                    <div className="pending-image-title">已添加图片</div>
                    <div className="pending-image-name">{pendingImage.name}</div>
                  </div>
                  <button className="pending-image-remove" type="button" onClick={clearPendingImage}>
                    移除
                  </button>
                </div>
              )}

              {activeMessages.length > 0 && !isSending && (
                <div className="composer-top-actions">
                  <button
                    className="manage-button"
                    type="button"
                    onClick={enterSelectMode}
                    aria-label="管理消息"
                  >
                    管理
                  </button>
                </div>
              )}

              <div className="composer-box">
                <button className="upload-button" type="button" onClick={handleUploadClick} aria-label="上传图片">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </button>

                <textarea
                  ref={composerRef}
                  className="composer-input"
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="输入消息..."
                />

                {isSending ? (
                  <button className="send-button stop-button" type="button" onClick={stopStreaming}>
                    停止
                  </button>
                ) : (
                  <button
                    className="send-button"
                    type="button"
                    disabled={!canSend}
                    onClick={() => sendMessage()}
                  >
                    发送
                  </button>
                )}
              </div>
            </>
          )}

          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
          />
        </footer>
      </main>

      {drawMode && (
        <div className="draw-page">
          {/* Draw drawer (conversation list) */}
          <aside className={classNames('drawer', drawDrawerOpen && 'drawer-open')}>
            <div className="drawer-header">
              <div className="drawer-brand">
                <img className="drawer-logo" src="/logo-2.png" alt="" />
                <div>
                  <div className="drawer-kicker">lightDraw</div>
                  <div className="drawer-title">画图记录</div>
                </div>
              </div>
              <button className="plain-icon-button" type="button" onClick={() => setDrawDrawerOpen(false)}>
                关闭
              </button>
            </div>

            <div className="history-pane">
              <button className="primary-button wide-button" type="button" onClick={createNewDrawConversation}>
                新建画图
              </button>

              <div className="history-list">
                {drawConversations
                  .slice()
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((conv) => (
                    <div
                      key={conv.id}
                      className={classNames(
                        'history-card',
                        conv.id === activeDrawConversationId && 'history-card-active',
                      )}
                    >
                      <button
                        className="history-main"
                        type="button"
                        onClick={() => {
                          setActiveDrawConversationId(conv.id);
                          setErrorText('');
                          setDrawSelectMode(false);
                          setDrawSelectedMessageIds(new Set());
                          setDrawDrawerOpen(false);
                        }}
                      >
                        <span className="history-title">{conv.title}</span>
                        <span className="history-time">
                          {conv.messages.filter((m) => m.imageUrl).length} 张图 · {formatDateTime(conv.updatedAt)}
                        </span>
                      </button>
                      <button
                        className="history-delete"
                        type="button"
                        aria-label="删除画图记录"
                        onClick={() => removeDrawConversation(conv.id)}
                      >
                        删除
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          </aside>

          {drawDrawerOpen && (
            <button
              className="drawer-backdrop"
              type="button"
              aria-label="关闭面板"
              onClick={() => setDrawDrawerOpen(false)}
            />
          )}

          {/* Draw main page */}
          <main className="phone-shell">
            <header className={classNames('chat-header', drawSelectMode ? 'chat-header-select' : 'chat-header-3col')}>
              {drawSelectMode ? (
                <>
                  <button className="header-button header-button-text" type="button" onClick={exitDrawSelectMode}>
                    取消
                  </button>
                  <div className="chat-title">
                    <h1>已选 {drawSelectedMessageIds.size} 条</h1>
                  </div>
                  <button
                    className="header-button header-button-icon"
                    type="button"
                    onClick={deleteSelectedDrawMessages}
                    disabled={drawSelectedMessageIds.size === 0}
                    aria-label="删除"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                  </button>
                </>
              ) : (
                <>
                  <button className="header-button header-button-icon" type="button" onClick={() => setDrawDrawerOpen(true)}>
                    <span aria-hidden="true">☰</span>
                  </button>

                  <div className="chat-title">
                    <img className="header-logo" src="/logo-2.png" alt="" />
                    <h1>{activeDrawConversation?.title || 'AI 画图'}</h1>
                    <p>
                      <span className={classNames('status-dot', isGenerating && 'status-dot-live')} />
                      {isGenerating ? `生成中 ${formatDuration(drawElapsedSeconds)}` : `已存 ${drawImageCount}/20 张`}
                    </p>
                  </div>

                  <button className="header-button header-button-icon" type="button" onClick={closeDrawMode} aria-label="返回聊天">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </button>
                </>
              )}
            </header>

            <div className="message-list-wrapper">
              <section className="message-list" aria-live="polite">
                {drawLimitWarning && (
                  <div className="draw-limit-banner">
                    已存满 20 张图，新图片将自动替换最早的图片
                    <button type="button" onClick={() => setDrawLimitWarning(false)}>知道了</button>
                  </div>
                )}
                {errorText && <div className="error-banner">{errorText}</div>}

                {activeDrawConversation?.messages.length === 0 && !isGenerating && (
                  <div className="draw-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                    <p>输入描述，AI 为你生成图片</p>
                  </div>
                )}

                {activeDrawConversation?.messages.map((msg) => {
                  if (msg.role === 'user') {
                    return (
                      <article
                        key={msg.id}
                        className={classNames(
                          'message-row',
                          'message-user',
                          drawSelectMode && 'message-row-selectable',
                          drawSelectMode && drawSelectedMessageIds.has(msg.id) && 'message-row-selected',
                        )}
                        onClick={drawSelectMode ? () => toggleDrawMessageSelection(msg.id) : undefined}
                      >
                        {drawSelectMode && (
                          <div className={classNames('message-checkbox', drawSelectedMessageIds.has(msg.id) && 'message-checkbox-checked')}>
                            {drawSelectedMessageIds.has(msg.id) ? (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
                            )}
                          </div>
                        )}
                        <div className="message-content-col">
                          <div className="message-meta">
                            <span>我</span>
                            <time>{formatTime(msg.createdAt)}</time>
                          </div>
                          <div className="message-bubble">
                            {msg.referenceImage && (
                              <img className="draw-ref-image" src={msg.referenceImage} alt="参考图" />
                            )}
                            {msg.content}
                            <span className="draw-msg-config">{DRAW_SIZE_OPTIONS.find(o => o.value === msg.size)?.label} · {DRAW_QUALITY_OPTIONS.find(o => o.value === msg.quality)?.label}{msg.referenceImage ? ' · 图生图' : ''}</span>
                          </div>
                        </div>
                      </article>
                    );
                  }

                  // assistant message
                  if (msg.imageUrl) {
                    return (
                      <article
                        key={msg.id}
                        className={classNames(
                          'message-row',
                          'message-assistant',
                          drawSelectMode && 'message-row-selectable',
                          drawSelectMode && drawSelectedMessageIds.has(msg.id) && 'message-row-selected',
                        )}
                        onClick={drawSelectMode ? () => toggleDrawMessageSelection(msg.id) : undefined}
                      >
                        {drawSelectMode && (
                          <div className={classNames('message-checkbox', drawSelectedMessageIds.has(msg.id) && 'message-checkbox-checked')}>
                            {drawSelectedMessageIds.has(msg.id) ? (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
                            )}
                          </div>
                        )}
                        <div className="message-content-col">
                          <div className="message-meta">
                            <img className="message-avatar" src="/logo-2.png" alt="" />
                            <span>AI</span>
                            <time>{formatTime(msg.createdAt)}</time>
                          </div>
                          <div className="message-bubble">
                            <img className="draw-result-image" src={msg.imageUrl} alt={msg.prompt} />
                            {typeof msg.durationSeconds === 'number' && (
                              <div className="draw-result-meta">生成用时 {formatDuration(msg.durationSeconds)}</div>
                            )}
                            {!drawSelectMode && (
                              <div className="draw-result-actions">
                                <button className="tool-button" type="button" onClick={() => downloadImage(msg.imageUrl, msg.prompt)}>
                                  保存到相册
                                </button>
                                <button className="tool-button tool-button-retry" type="button" onClick={() => requestDeleteDrawMessage(activeDrawConversation.id, msg.id)}>
                                  删除
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  }

                  if (msg.error) {
                    return (
                      <article
                        key={msg.id}
                        className={classNames(
                          'message-row',
                          'message-assistant',
                          drawSelectMode && 'message-row-selectable',
                          drawSelectMode && drawSelectedMessageIds.has(msg.id) && 'message-row-selected',
                        )}
                        onClick={drawSelectMode ? () => toggleDrawMessageSelection(msg.id) : undefined}
                      >
                        {drawSelectMode && (
                          <div className={classNames('message-checkbox', drawSelectedMessageIds.has(msg.id) && 'message-checkbox-checked')}>
                            {drawSelectedMessageIds.has(msg.id) ? (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
                            )}
                          </div>
                        )}
                        <div className="message-content-col">
                          <div className="message-meta">
                            <img className="message-avatar" src="/logo-2.png" alt="" />
                            <span>AI</span>
                          </div>
                          <div className="message-bubble">
                            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(`出错了：${msg.error}`) }} />
                          </div>
                        </div>
                      </article>
                    );
                  }

                  // Still generating (no imageUrl yet)
                  if (isGenerating) {
                    return (
                      <article
                        key={msg.id}
                        className={classNames(
                          'message-row',
                          'message-assistant',
                          drawSelectMode && 'message-row-selectable',
                          drawSelectMode && drawSelectedMessageIds.has(msg.id) && 'message-row-selected',
                        )}
                        onClick={drawSelectMode ? () => toggleDrawMessageSelection(msg.id) : undefined}
                      >
                        {drawSelectMode && (
                          <div className={classNames('message-checkbox', drawSelectedMessageIds.has(msg.id) && 'message-checkbox-checked')}>
                            {drawSelectedMessageIds.has(msg.id) ? (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
                            )}
                          </div>
                        )}
                        <div className="message-content-col">
                          <div className="message-meta">
                            <img className="message-avatar" src="/logo-2.png" alt="" />
                            <span>AI</span>
                          </div>
                          <div className="message-bubble">
                            <div className="draw-loading-inline">
                              <div className="draw-loading-spinner" />
                              <span>正在生成图片，已等待 {formatDuration(drawElapsedSeconds)}</span>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  }

                  return null;
                })}
              </section>
            </div>

            <footer className="composer-panel">
              {drawSelectMode ? (
                <div className="select-action-bar">
                  <button className="select-action-btn select-action-btn-user" type="button" onClick={selectAllDrawUserMessages}>
                    全选用户
                  </button>
                  <button className="select-action-btn select-action-btn-ai" type="button" onClick={selectAllDrawAssistantMessages}>
                    全选AI
                  </button>
                  <button
                    className="select-action-btn select-action-btn-delete"
                    type="button"
                    onClick={deleteSelectedDrawMessages}
                    disabled={drawSelectedMessageIds.size === 0}
                  >
                    删除({drawSelectedMessageIds.size})
                  </button>
                </div>
              ) : (
                <>
                  {isGenerating && (
                    <div className="draw-waiting-bar">
                      <span className="draw-waiting-dot" />
                      <span>正在生成，已等待 {formatDuration(drawElapsedSeconds)}</span>
                    </div>
                  )}
                  {drawPendingImage && (
                    <div className="pending-image-card">
                      <img className="pending-image-preview" src={drawPendingImage.url} alt="参考图" />
                      <div className="pending-image-info">
                        <div className="pending-image-title">参考图（图生图）</div>
                        <div className="pending-image-name">{drawPendingImage.name}</div>
                      </div>
                      <button className="pending-image-remove" type="button" onClick={() => setDrawPendingImage(null)}>
                        移除
                      </button>
                    </div>
                  )}
                  {activeDrawMessages.length > 0 && !isGenerating && (
                    <div className="composer-top-actions">
                      <button
                        className="manage-button"
                        type="button"
                        onClick={enterDrawSelectMode}
                        aria-label="管理画图记录"
                      >
                        管理
                      </button>
                    </div>
                  )}
                  <div className="draw-config">
                    <label className="draw-config-item">
                      <span>模式</span>
                      <select
                        className="draw-config-select"
                        value={settings.drawApiMode || 'images'}
                        onChange={(e) => setSettings((s) => ({ ...s, drawApiMode: e.target.value }))}
                      >
                        {DRAW_API_MODE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="draw-config-item">
                      <span>尺寸</span>
                      <select
                        className="draw-config-select"
                        value={settings.drawSize || '1024x1024'}
                        onChange={(e) => setSettings((s) => ({ ...s, drawSize: e.target.value }))}
                      >
                        {DRAW_SIZE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="draw-config-item">
                      <span>质量</span>
                      <select
                        className="draw-config-select"
                        value={settings.drawQuality || 'medium'}
                        onChange={(e) => setSettings((s) => ({ ...s, drawQuality: e.target.value }))}
                      >
                        {DRAW_QUALITY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="draw-input-row">
                    <button className="upload-button" type="button" onClick={() => drawFileInputRef.current?.click()} aria-label="上传参考图">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </button>
                    <textarea
                      className="draw-input"
                      rows={1}
                      value={drawPrompt}
                      onChange={(e) => setDrawPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleDraw();
                        }
                      }}
                      placeholder="描述你想要的图片..."
                      disabled={isGenerating}
                    />
                    {isGenerating ? (
                      <button className="send-button stop-button" type="button" onClick={stopDrawGeneration}>
                        停止
                      </button>
                    ) : (
                      <button
                        className="send-button draw-send-button"
                        type="button"
                        disabled={!drawPrompt.trim() || isGenerating || authState !== 'authenticated'}
                        onClick={handleDraw}
                      >
                        生成
                      </button>
                    )}
                  </div>
                </>
              )}
              <input
                ref={drawFileInputRef}
                className="hidden-input"
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (!file.type.startsWith('image/')) {
                    setErrorText('只能上传图片文件。');
                    e.target.value = '';
                    return;
                  }

                  try {
                    const optimizedImageUrl = await prepareDrawReferenceImage(file);
                    setDrawPendingImage({
                      name: file.name,
                      url: optimizedImageUrl,
                    });
                    setErrorText('');
                  } catch (error) {
                    setErrorText(error.message || '参考图处理失败');
                  }
                  e.target.value = '';
                }}
              />
            </footer>
          </main>

          {deleteDrawTarget && (
            <div className="confirm-layer" role="dialog" aria-modal="true" aria-labelledby="delete-draw-title">
              <button
                className="confirm-backdrop"
                type="button"
                aria-label="取消删除"
                onClick={cancelDeleteDrawMessage}
              />
              <div className="confirm-dialog">
                <h2 id="delete-draw-title">删除这张图片？</h2>
                <p>对应的提示词记录也会一起删除，此操作不可撤销。</p>
                <div className="confirm-actions">
                  <button className="confirm-button confirm-button-secondary" type="button" onClick={cancelDeleteDrawMessage}>
                    取消
                  </button>
                  <button className="confirm-button confirm-button-danger" type="button" onClick={confirmDeleteDrawMessage}>
                    删除
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
