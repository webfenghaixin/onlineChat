import { useEffect, useMemo, useRef, useState } from 'react';
import { streamChatCompletion } from './lib/stream';

const STORAGE_KEY = 'online-chat-h5-state-v2';

const defaultSettings = {
  endpoint: 'https://api.luxee.ai/v1/chat/completions',
  apiKey: '123456',
  model: 'gpt5.4',
  requestMode: 'chat',
  systemPrompt: '你是一位耐心、清晰、友好的 AI 助手。请优先用简洁易懂的中文回答。',
  temperature: 0.7,
  maxOutputTokens: 2048,
  stream: true,
  useProxy: true,
  proxyPath: '/api/proxy',
};

function createConversation() {
  const id = crypto.randomUUID();
  return {
    id,
    title: '新的对话',
    updatedAt: Date.now(),
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '您好，我已经准备好了。请直接输入问题，我会用流式方式持续输出回答。',
      },
    ],
  };
}

function normalizeLegacyState(parsed) {
  const initialConversation = createConversation();
  const conversations =
    Array.isArray(parsed?.conversations) && parsed.conversations.length
      ? parsed.conversations
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
      return normalizeLegacyState(JSON.parse(currentRaw));
    }

    const legacyRaw = localStorage.getItem('online-chat-h5-state-v1');
    if (legacyRaw) {
      return normalizeLegacyState(JSON.parse(legacyRaw));
    }
  } catch (error) {
    return normalizeLegacyState(null);
  }

  return normalizeLegacyState(null);
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatTime(timestamp) {
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
  return firstUserMessage.content.slice(0, 18) || '新的对话';
}

function classNames(...values) {
  return values.filter(Boolean).join(' ');
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('history');

  const abortControllerRef = useRef(null);
  const messagesEndRef = useRef(null);

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const activeMessages = activeConversation?.messages || [];

  useEffect(() => {
    saveState({
      settings,
      conversations,
      activeConversationId,
    });
  }, [settings, conversations, activeConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeMessages, historyOpen, drawerTab]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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

  function createNewConversation() {
    const conversation = createConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setDraft('');
    setErrorText('');
    setStatusText('已创建新对话');
    setHistoryOpen(false);
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

  async function sendMessage() {
    const content = draft.trim();
    if (!content || isSending || !activeConversation) {
      return;
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
    };

    const assistantMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
    };

    const nextMessages = [...activeConversation.messages, userMessage, assistantMessage];
    setDraft('');
    setErrorText('');
    setIsSending(true);
    setStatusText('正在流式生成回答...');

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
                ? { ...message, content: `${message.content}${text}` }
                : message,
            ),
          }));
        },
      });

      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistantMessage.id && !message.content.trim()
            ? { ...message, content: '接口已连接，但没有返回可显示的文本内容。' }
            : message,
        ),
      }));

      setStatusText('回答完成');
    } catch (error) {
      if (error.name === 'AbortError') {
        updateConversation(activeConversation.id, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantMessage.id && !message.content.trim()
              ? { ...message, content: '本次回答已手动停止。' }
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
            message.id === assistantMessage.id && !message.content.trim()
              ? { ...message, content: `出错了：${nextErrorText}` }
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
  }

  return (
    <div className="app-shell">
      <aside className={classNames('side-sheet', historyOpen && 'side-sheet-open')}>
        <div className="sheet-header">
          <div>
            <div className="sheet-title">菜单</div>
            <div className="sheet-subtitle">在这里切换对话和接口设置</div>
          </div>
          <button className="icon-button" type="button" onClick={() => setHistoryOpen(false)}>
            关闭
          </button>
        </div>

        <div className="drawer-tabs">
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
          <>
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
                        setHistoryOpen(false);
                      }}
                    >
                      <span className="history-title">{conversation.title}</span>
                      <span className="history-time">{formatTime(conversation.updatedAt)}</span>
                    </button>
                    <button
                      className="history-delete"
                      type="button"
                      onClick={() => removeConversation(conversation.id)}
                    >
                      删除
                    </button>
                  </div>
                ))}
            </div>
          </>
        ) : (
          <div className="settings-form">
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
          </div>
        )}
      </aside>

      {historyOpen && (
        <button
          className="backdrop"
          type="button"
          aria-label="关闭面板"
          onClick={() => {
            setHistoryOpen(false);
          }}
        />
      )}

      <main className="main-panel">
        <header className="top-bar">
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              setDrawerTab('settings');
              setHistoryOpen(true);
            }}
          >
            菜单
          </button>

          <div className="title-block">
            <h1>在线 AI 聊天</h1>
            <p>大字号、流式输出、适合手机直接使用</p>
          </div>

          <div className="top-bar-spacer" />
        </header>

        <section className="hero-card">
          <div>
            <div className="hero-title">连接信息</div>
            <div className="hero-value">{settings.endpoint || '请先填写请求地址'}</div>
            <div className="hero-caption">
              {settings.useProxy
                ? `当前通过 ${settings.proxyPath || '/api/proxy'} 同源代理转发`
                : '当前直接从浏览器请求上游接口'}
            </div>
          </div>
          <div className="hero-actions">
            <span className={classNames('status-pill', isSending && 'status-pill-live')}>{statusText}</span>
            <button className="secondary-button" type="button" onClick={createNewConversation}>
              新对话
            </button>
          </div>
        </section>

        {!activeMessages.filter((message) => message.role === 'user').length && (
          <section className="suggestions">
            <button className="suggestion-chip" type="button" onClick={() => quickFill('请帮我总结今天的工作安排')}>
              帮我总结工作安排
            </button>
            <button className="suggestion-chip" type="button" onClick={() => quickFill('请用简单中文解释这个概念')}>
              用简单中文解释概念
            </button>
            <button className="suggestion-chip" type="button" onClick={() => quickFill('请一步一步教我怎么操作')}>
              一步一步教我操作
            </button>
          </section>
        )}

        <section className="message-list">
          {activeMessages.map((message) => (
            <article
              key={message.id}
              className={classNames(
                'message-row',
                message.role === 'user' ? 'message-user' : 'message-assistant',
              )}
            >
              <div className="avatar">{message.role === 'user' ? '我' : 'AI'}</div>
              <div className="bubble-wrap">
                <div className="bubble-role">{message.role === 'user' ? '您' : '助手'}</div>
                <div className="bubble">
                  {message.content || (isSending && message.role === 'assistant' ? '正在思考...' : '')}
                  {isSending &&
                    message.role === 'assistant' &&
                    message === activeMessages[activeMessages.length - 1] && <span className="typing-cursor" />}
                </div>
              </div>
            </article>
          ))}
          <div ref={messagesEndRef} />
        </section>

        <footer className="composer-panel">
          {errorText && <div className="error-banner">{errorText}</div>}

          <textarea
            className="composer-input"
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="请输入您的问题。按 Enter 发送，Shift + Enter 换行。"
          />

          <div className="composer-actions">
            <button className="secondary-button" type="button" onClick={() => setDraft('')}>
              清空输入
            </button>
            {isSending ? (
              <button className="danger-button" type="button" onClick={stopStreaming}>
                停止回答
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={sendMessage}>
                发送消息
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
