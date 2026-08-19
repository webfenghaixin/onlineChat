import { useState } from 'react';
import { Button, Card, Input, Divider, Tabs, Modal } from 'animal-island-ui';
import PortaledSelect from '../shared/PortaledSelect';
import { FONT_SIZE_OPTIONS, MODEL_OPTIONS } from '../../lib/constants';
import { formatDateTime, normalizeModelSettings } from '../../lib/utils';
import { changePassword } from '../../lib/auth';

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

  function closePasswordModal() {
    setShowPasswordForm(false);
    setPasswordError('');
    setPasswordMsg('');
    setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
  }

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
        closePasswordModal();
      }, 1500);
    } catch (error) {
      setPasswordError(error.message || '修改失败');
    } finally {
      setPasswordLoading(false);
    }
  }

  const historyPane = (
    <div className="drawer-tab-content">
      <Button type="primary" block onClick={createNewConversation}>
        新建对话
      </Button>
      <div className="drawer-history-list">
        {conversations
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((conversation) => (
            <Card
              key={conversation.id}
              className={`drawer-history-card ${conversation.id === activeConversationId ? 'drawer-history-card-active' : ''}`}
            >
              <button
                className="drawer-history-main"
                type="button"
                onClick={() => {
                  switchConversation(conversation.id);
                }}
              >
                <span className="drawer-history-title">{conversation.title}</span>
                <span className="drawer-history-time">
                  {conversation.messageCount || conversation.messages.length} 条消息 · {formatDateTime(conversation.updatedAt)}
                </span>
              </button>
              <Button
                className="drawer-history-delete"
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
  );

  const settingsPane = (
    <div className="drawer-tab-content drawer-settings-form">
      <div className="drawer-field">
        <span className="drawer-field-label">字体大小</span>
        <PortaledSelect
          value={settings.fontSize}
          onChange={(value) =>
            setSettings((current) => ({ ...current, fontSize: value }))
          }
          options={FONT_SIZE_OPTIONS.map((option) => ({ key: option.value, label: option.label }))}
        />
      </div>

      <div className="drawer-field">
        <span className="drawer-field-label">模型名称</span>
        <PortaledSelect
          value={settings.model}
          onChange={(value) =>
            setSettings((current) =>
              normalizeModelSettings({ ...current, model: value }),
            )
          }
          options={MODEL_OPTIONS.map((option) => ({ key: option.value, label: option.label }))}
        />
      </div>

      <div className="drawer-field">
        <span className="drawer-field-label">系统提示词</span>
        <textarea
          className="drawer-field-textarea"
          value={settings.systemPrompt}
          onChange={(event) =>
            setSettings((current) => ({ ...current, systemPrompt: event.target.value }))
          }
          placeholder="可以用来固定助手风格"
        />
      </div>

      <div className="drawer-field-row">
        <div className="drawer-field">
          <span className="drawer-field-label">温度</span>
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

        <div className="drawer-field">
          <span className="drawer-field-label">最大输出</span>
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

      <Button
        type="default"
        block
        onClick={() => setShowPasswordForm(true)}
      >
        修改密码
      </Button>

      <Button
        type="dashed"
        block
        loading={vconsoleLoading}
        onClick={loadVConsole}
      >
        调试面板 {window.__VCONSOLE_LOADED__ ? '（已开启）' : ''}
      </Button>

      <Button type="default" danger block onClick={handleLogout}>
        退出登录
      </Button>
    </div>
  );

  const tabItems = [
    { key: 'history', label: '对话', children: historyPane },
    { key: 'settings', label: '设置', children: settingsPane },
  ];

  return (
    <>
      <aside className={`drawer ${drawerOpen ? 'drawer-open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-title-wrap">
            <div className="drawer-title">lightChat</div>
          </div>
          <Button type="text" size="small" onClick={() => setDrawerOpen(false)}>关闭</Button>
        </div>
        <Divider type="wave-yellow" />
        <div className="drawer-tabs-wrap">
          <Tabs
            activeKey={drawerTab}
            onChange={(key) => setDrawerTab(key)}
            items={tabItems}
          />
        </div>
      </aside>

      {drawerOpen && (
        <button
          className="drawer-backdrop"
          type="button"
          aria-label="关闭面板"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <Modal
        open={showPasswordForm}
        title="修改密码"
        footer={null}
        typewriter={false}
        maskClosable={!passwordLoading}
        onClose={closePasswordModal}
        width={420}
      >
        <div className="drawer-password-form">
          <div className="drawer-field">
            <span className="drawer-field-label">旧密码</span>
            <Input
              type="password"
              value={passwordForm.oldPassword}
              onChange={(e) => setPasswordForm((p) => ({ ...p, oldPassword: e.target.value }))}
              placeholder="输入旧密码"
            />
          </div>
          <div className="drawer-field">
            <span className="drawer-field-label">新密码</span>
            <Input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
              placeholder="至少 6 位"
            />
          </div>
          <div className="drawer-field">
            <span className="drawer-field-label">确认新密码</span>
            <Input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
              placeholder="再次输入新密码"
            />
          </div>
          {passwordError && <div className="drawer-field-error">{passwordError}</div>}
          {passwordMsg && <div className="drawer-field-success">{passwordMsg}</div>}
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
            disabled={passwordLoading}
            onClick={closePasswordModal}
          >
            取消
          </Button>
        </div>
      </Modal>
    </>
  );
}
