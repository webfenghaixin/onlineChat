import { useEffect, useMemo, useRef, useState } from 'react';
import { streamChatCompletion } from './lib/stream';

const STORAGE_KEY = 'online-chat-h5-state-v4';
const LEGACY_STORAGE_KEYS = ['online-chat-h5-state-v3', 'online-chat-h5-state-v2', 'online-chat-h5-state-v1'];
const ACCESS_KEY = 'online-chat-h5-access';
const ACCESS_PASSWORD = import.meta.env.VITE_ACCESS_PASSWORD || '';
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

const defaultSettings = {
  source: 'rightcode',
  endpoint: '',
  apiKey: '',
  model: 'gpt-5.4-medium',
  requestMode: 'responses',
  systemPrompt: '你是一位耐心、清晰、友好的 AI 助手。请优先用简洁易懂的中文回答。',
  temperature: 0.7,
  maxOutputTokens: 2048,
  stream: true,
  useProxy: true,
  proxyPath: '/api/proxy',
  fontSize: 'xl',
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

    for (const key of LEGACY_STORAGE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) {
        return normalizeState(JSON.parse(raw));
      }
    }
  } catch (error) {
    return normalizeState(null);
  }

  return normalizeState(null);
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadAccessGranted() {
  try {
    return localStorage.getItem(ACCESS_KEY) === 'granted';
  } catch (error) {
    return false;
  }
}

function saveAccessGranted(granted) {
  localStorage.setItem(ACCESS_KEY, granted ? 'granted' : 'locked');
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
  const [accessGranted, setAccessGranted] = useState(loadAccessGranted);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [pendingImage, setPendingImage] = useState(null);

  const abortControllerRef = useRef(null);
  const composerRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const activeMessages = activeConversation?.messages || [];
  const hasUserMessages = activeMessages.some((message) => message.role === 'user');
  const draftHasText = draft.trim().length > 0;
  const canSend = (draftHasText || Boolean(pendingImage)) && !isSending && accessGranted;

  useEffect(() => {
    saveState({
      settings,
      conversations,
      activeConversationId,
    });
  }, [settings, conversations, activeConversationId]);

  useEffect(() => {
    saveAccessGranted(accessGranted);
  }, [accessGranted]);

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

    if ((!textContent && !hasImage) || isSending || !activeConversation || !accessGranted) {
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

  function handlePasswordSubmit(event) {
    event.preventDefault();

    if (passwordInput === ACCESS_PASSWORD) {
      setAccessGranted(true);
      setPasswordError('');
      setPasswordInput('');
      return;
    }

    setPasswordError('密码不正确');
  }

  function handleLogout() {
    setAccessGranted(false);
    setDrawerOpen(false);
    setStatusText('请先输入密码');
  }

  function handleUploadClick() {
    if (!accessGranted) {
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

  if (!accessGranted) {
    return (
      <div className="gate-shell">
        <section className="gate-card">
          <div className="gate-badge">访问验证</div>
          <h1>请输入密码</h1>
          <p>输入正确密码后，才能使用聊天、上传图片和设置等全部功能。</p>

          <form className="gate-form" onSubmit={handlePasswordSubmit}>
            <input
              className="gate-input"
              type="password"
              inputMode="numeric"
              value={passwordInput}
              onChange={(event) => {
                setPasswordInput(event.target.value);
                setPasswordError('');
              }}
              placeholder="请输入密码"
            />
            <button className="gate-button" type="submit">
              进入聊天
            </button>
          </form>

          {passwordError && <div className="gate-error">{passwordError}</div>}
        </section>
      </div>
    );
  }

  return (
    <div className={classNames('chat-app', `font-scale-${settings.fontSize || 'md'}`)}>
      <aside className={classNames('drawer', drawerOpen && 'drawer-open')}>
        <div className="drawer-header">
          <div>
            <div className="drawer-kicker">在线 AI 聊天</div>
            <div className="drawer-title">{drawerTab === 'history' ? '对话记录' : '接口设置'}</div>
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
              <input
                className="field-input"
                value={settings.model}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, model: event.target.value }))
                }
                placeholder="如接口本身已固定模型，可留空"
              />
            </label>

            <label className="field">
              <span className="field-label">请求模式</span>
              <select
                className="field-input"
                value={settings.requestMode}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, requestMode: event.target.value }))
                }
              >
                <option value="chat">OpenAI Chat Completions 兼容</option>
                <option value="responses">OpenAI Responses 兼容</option>
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
              退出并锁定
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
            <h1>{activeConversation?.title || '在线 AI 聊天'}</h1>
            <p>
              <span className={classNames('status-dot', isSending && 'status-dot-live')} />
              {statusText}
            </p>
          </div>

          <button className="header-button" type="button" onClick={() => openDrawer('settings')}>
            <span aria-hidden="true">⚙</span>
          </button>
        </header>

        <section className="message-list" aria-live="polite">
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

                  {text || (isLatestAssistant ? '正在思考...' : '')}
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
