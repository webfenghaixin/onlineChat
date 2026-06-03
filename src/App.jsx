import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { streamChatCompletion } from './lib/stream';
import { register, login, saveToCloud, loadFromCloud, getToken, clearToken, getStoredUsername } from './lib/auth';

const STORAGE_KEY = 'online-chat-h5-state-v6';
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

marked.setOptions({
  breaks: true,
  gfm: true,
});

function renderMarkdown(text) {
  if (!text) return '';
  return marked.parse(text);
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
};

function getTextParts(content) {
  if (Array.isArray(content)) {
    return content
      .filter((item) => item?.type === 'text' && item.text)
      .map((item) => item.text)
      .join('\n');
  }

  return typeof content === 'string' ? content : '';
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

  return {
    settings: {
      ...defaultSettings,
      ...(parsed?.settings || {}),
    },
    conversations,
    activeConversationId: parsed?.activeConversationId || conversations[0].id,
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  const [authState, setAuthState] = useState(() => (getToken() ? 'loading' : 'auth-form'));
  const [authTab, setAuthTab] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '', inviteCode: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => getStoredUsername());
  const [pendingImage, setPendingImage] = useState(null);

  const abortControllerRef = useRef(null);
  const composerRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);
  const cloudSaveTimerRef = useRef(null);

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const activeMessages = activeConversation?.messages || [];
  const hasUserMessages = activeMessages.some((message) => message.role === 'user');
  const draftHasText = draft.trim().length > 0;
  const canSend = (draftHasText || Boolean(pendingImage)) && !isSending && authState === 'authenticated';

  useEffect(() => {
    saveState({
      settings,
      conversations,
      activeConversationId,
    });
    if (authState !== 'authenticated') return;
    clearTimeout(cloudSaveTimerRef.current);
    cloudSaveTimerRef.current = setTimeout(() => {
      saveToCloud({ settings, conversations, activeConversationId }).catch(() => {});
    }, 3000);
  }, [settings, conversations, activeConversationId, authState]);

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeMessages, drawerOpen, drawerTab]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
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
      if (!draft.trim()) {
        setDraft('请结合这张图片回答。');
      }
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
          {/* <img className="gate-logo" src="/logo-2.png" alt="" />
          <h1>lightChat</h1> */}
          <p>正在加载你的数据...</p>
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
        <header className="chat-header">
          <button className="header-button" type="button" onClick={() => openDrawer('history')}>
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
        </header>

        <div className="message-list-wrapper">
          <section className="message-list" ref={messageListRef} aria-live="polite">
            {activeMessages.map((message) => {
              const isLatestAssistant =
                isSending &&
                message.role === 'assistant' &&
                message === activeMessages[activeMessages.length - 1];
              const images = getImageParts(message.content);
              const text = getTextParts(message.content);
              const isAssistant = message.role === 'assistant';

              return (
                <article
                  key={message.id}
                  className={classNames(
                    'message-row',
                    message.role === 'user' ? 'message-user' : 'message-assistant',
                  )}
                >
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

                  {isAssistant && (
                    <div className="message-tools">
                      <button
                        type="button"
                        className={classNames('tool-button', copiedMessageId === message.id && 'tool-button-copied')}
                        onClick={() => copyMessage(message)}
                      >
                        {copiedMessageId === message.id ? '已复制 ✓' : '复制'}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            <div ref={messagesEndRef} />
          </section>
          <Scrollbar scrollRef={messageListRef} />
        </div>

        <footer className="composer-panel">
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

          <div className="composer-box">
            <button className="upload-button" type="button" onClick={handleUploadClick} aria-label="上传图片">
              图片
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

          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
          />
        </footer>
      </main>
    </div>
  );
}
