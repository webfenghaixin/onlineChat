import { Button, Card, Input, Select, Divider } from 'animal-island-ui';
import { FONT_SIZE_OPTIONS, MODEL_OPTIONS } from '../lib/constants';
import { formatDateTime, normalizeModelSettings } from '../lib/utils';

export default function Drawer({
  drawerOpen,
  setDrawerOpen,
  drawerTab,
  setDrawerTab,
  conversations,
  activeConversationId,
  switchConversation,
  setDeleteConversationTarget,
  createNewConversation,
  settings,
  setSettings,
  handleLogout,
}) {
  function switchDrawerTab(nextTab) {
    setDrawerTab(nextTab);
  }

  return (
    <>
      <aside className={`drawer ${drawerOpen ? 'drawer-open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-brand">
            <div>
              <div className="drawer-title">{drawerTab === 'history' ? '对话记录' : '接口设置'}</div>
            </div>
          </div>
          <Button className="drawer-close-button" type="text" size="small" onClick={() => setDrawerOpen(false)}>关闭</Button>
        </div>
        <div className="drawer-mode-shell" role="tablist" aria-label="对话与设置切换">
          <button
            type="button"
            role="tab"
            aria-selected={drawerTab === 'history'}
            className={`drawer-mode-option ${drawerTab === 'history' ? 'drawer-mode-option-active' : ''}`}
            onClick={() => switchDrawerTab('history')}
          >
            <span className="drawer-mode-title">对话</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={drawerTab === 'settings'}
            className={`drawer-mode-option ${drawerTab === 'settings' ? 'drawer-mode-option-active' : ''}`}
            onClick={() => switchDrawerTab('settings')}
          >
            <span className="drawer-mode-title">设置</span>
          </button>
        </div>

        {drawerTab === 'history' ? (
          <div className="history-pane">
            <Divider type="wave-yellow" />
            <Button className="drawer-primary-action" type="primary" block onClick={createNewConversation}>
              新建对话
            </Button>

            <div className="history-list">
              {conversations
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((conversation) => (
                  <Card
                    key={conversation.id}
                    className={`history-card ${conversation.id === activeConversationId ? 'history-card-active' : ''}`}
                    color={conversation.id === activeConversationId ? 'app-teal' : 'default'}
                  >
                    <button
                      className="history-main"
                      type="button"
                      onClick={() => {
                        switchConversation(conversation.id);
                      }}
                    >
                      <span className="history-title">{conversation.title}</span>
                      <span className="history-time">
                        {conversation.messageCount || conversation.messages.length} 条消息 · {formatDateTime(conversation.updatedAt)}
                      </span>
                    </button>
                    <Button
                      className="history-delete"
                      type="text"
                      size="small"
                      danger
                      onClick={() => setDeleteConversationTarget(conversation.id)}
                    >
                      删除
                    </Button>
                  </Card>
                ))}
            </div>
          </div>
        ) : (
          <div className="settings-form">
            <div className="field">
              <span className="field-label">字体大小</span>
              <Select
                value={settings.fontSize}
                onChange={(value) =>
                  setSettings((current) => ({ ...current, fontSize: value }))
                }
                options={FONT_SIZE_OPTIONS.map((option) => ({ key: option.value, label: option.label }))}
              />
            </div>

            <div className="field">
              <span className="field-label">模型名称</span>
              <Select
                value={settings.model}
                onChange={(value) =>
                  setSettings((current) =>
                    normalizeModelSettings({ ...current, model: value }),
                  )
                }
                options={MODEL_OPTIONS.map((option) => ({ key: option.value, label: option.label }))}
              />
            </div>

            <div className="field">
              <span className="field-label">系统提示词</span>
              <textarea
                className="field-input field-textarea"
                value={settings.systemPrompt}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, systemPrompt: event.target.value }))
                }
                placeholder="可以用来固定助手风格"
              />
            </div>

            <div className="field-row">
              <div className="field">
                <span className="field-label">温度</span>
                <Input
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
              </div>

              <div className="field">
                <span className="field-label">最大输出</span>
                <Input
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
              </div>
            </div>

            <Button className="drawer-logout-button" type="default" danger block onClick={handleLogout}>
              退出登录
            </Button>
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
