import { useState } from 'react';
import { Button, Card, Input, Select, Divider } from 'animal-island-ui';
import { FONT_SIZE_OPTIONS, MODEL_OPTIONS } from '../lib/constants';
import { formatDateTime, normalizeModelSettings } from '../lib/utils';
import { changePassword } from '../lib/auth';

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

  const [vconsoleLoading, setVconsoleLoading] = useState(false);
  function loadVConsole() {
    if (window.__VCONSOLE_LOADED__) {
      setDrawerOpen(false);
      return;
    }
    setVconsoleLoading(true);
    import('vconsole').then((mod) => {
      const VConsole = mod.default;
      new VConsole();
      window.__VCONSOLE_LOADED__ = true;
      setVconsoleLoading(false);
      setDrawerOpen(false);
    }).catch(() => {
      setVconsoleLoading(false);
    });
  }

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordError, setPasswordError] = useState('');

  async function handleSubmitPassword() {
    setPasswordMsg('');
    setPasswordError('');

    if (!passwordForm.oldPassword || !passwordForm.newPassword) {
      setPasswordError('请输入旧密码和新密码');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordError('新密码至少 6 位');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('两次输入的新密码不一致');
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword(passwordForm.oldPassword, passwordForm.newPassword);
      setPasswordMsg('密码修改成功');
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => {
        setShowPasswordForm(false);
        setPasswordMsg('');
      }, 1500);
    } catch (error) {
      setPasswordError(error.message || '修改失败');
    } finally {
      setPasswordLoading(false);
    }
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

            <Divider type="wave-yellow" />

            {showPasswordForm ? (
              <div className="password-form">
                <div className="field">
                  <span className="field-label">旧密码</span>
                  <Input
                    type="password"
                    value={passwordForm.oldPassword}
                    onChange={(e) => setPasswordForm((p) => ({ ...p, oldPassword: e.target.value }))}
                    placeholder="输入旧密码"
                  />
                </div>
                <div className="field">
                  <span className="field-label">新密码</span>
                  <Input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
                    placeholder="至少 6 位"
                  />
                </div>
                <div className="field">
                  <span className="field-label">确认新密码</span>
                  <Input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                    placeholder="再次输入新密码"
                  />
                </div>
                {passwordError && <div className="field-error">{passwordError}</div>}
                {passwordMsg && <div className="field-success">{passwordMsg}</div>}
                <Button
                  type="primary"
                  block
                  loading={passwordLoading}
                  onClick={handleSubmitPassword}
                >
                  确认修改
                </Button>
                <Button
                  type="text"
                  block
                  onClick={() => { setShowPasswordForm(false); setPasswordError(''); setPasswordMsg(''); }}
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                className="drawer-password-button"
                type="default"
                block
                onClick={() => setShowPasswordForm(true)}
              >
                修改密码
              </Button>
            )}

            <Button
              className="drawer-debug-button"
              type="dashed"
              block
              loading={vconsoleLoading}
              onClick={loadVConsole}
            >
              调试面板 {window.__VCONSOLE_LOADED__ ? '（已开启）' : ''}
            </Button>

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
