import { classNames, formatDateTime, normalizeModelSettings } from '../lib/utils';
import {
  FONT_SIZE_OPTIONS,
  SOURCE_OPTIONS,
  RIGHTCODE_PRICING_OPTIONS,
  MODEL_OPTIONS,
} from '../lib/constants';

export default function Drawer({
  drawerOpen,
  setDrawerOpen,
  drawerTab,
  setDrawerTab,
  conversations,
  activeConversationId,
  setActiveConversationId,
  setDeleteConversationTarget,
  createNewConversation,
  settings,
  setSettings,
  handleLogout,
}) {
  return (
    <>
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
                      onClick={() => setDeleteConversationTarget(conversation.id)}
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

            {false && (
              <>

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

              </>
            )}

            <label className="field">
              <span className="field-label">模型名</span>
              <select
                className="field-input"
                value={settings.model}
                onChange={(event) =>
                  setSettings((current) =>
                    normalizeModelSettings({ ...current, model: event.target.value }),
                  )
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

            {false && (
              <>

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

              </>
            )}

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
    </>
  );
}
