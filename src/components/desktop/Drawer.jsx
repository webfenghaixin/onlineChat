import { useState } from 'react';
import { Button, Input, Divider, Tabs, Modal } from 'animal-island-ui';
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
    <>
      <button type="button" className="desktop-new-conv-btn" onClick={createNewConversation}>
        新建对话
      </button>
      <div className="desktop-history-list">
        {conversations
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((conversation) => (
            <div
              key={conversation.id}
              className={`desktop-history-item ${conversation.id === activeConversationId ? 'active' : ''}`}
            >
              <button
                className="desktop-history-main"
                type="button"
                onClick={() => switchConversation(conversation.id)}
              >
                <span className="desktop-history-title">{conversation.title}</span>
                <span className="desktop-history-time">
                  {conversation.messageCount || conversation.messages.length} 条消息 · {formatDateTime(conversation.updatedAt)}
                </span>
              </button>
              <button
                className="desktop-history-del"
                type="button"
                onClick={() => setDeleteConversationTarget(conversation.id)}
              >
                删除
              </button>
            </div>
          ))}
      </div>
    </>
  );

  const settingsPane = (
    <div className="desktop-settings">
      <div className="desktop-field">
        <span className="desktop-field-label">字体大小</span>
        <PortaledSelect
          value={settings.fontSize}
          onChange={(value) =>
            setSettings((current) => ({ ...current, fontSize: value }))
          }
          options={FONT_SIZE_OPTIONS.map((option) => ({ key: option.value, label: option.label }))}
        />
      </div>

      <div className="desktop-field">
        <span className="desktop-field-label">模型名称</span>
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

      <div className="desktop-field">
        <span className="desktop-field-label">系统提示词</span>
        <textarea
          className="desktop-field-textarea"
          value={settings.systemPrompt}
          onChange={(event) =>
            setSettings((current) => ({ ...current, systemPrompt: event.target.value }))
          }
          placeholder="可以用来固定助手风格"
        />
      </div>

      <div className="desktop-field">
        <span className="desktop-field-label">温度</span>
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

      <div className="desktop-field">
        <span className="desktop-field-label">最大输出</span>
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

      <Divider type="wave-yellow" />

      <Button
        type="default"
        block
        onClick={() => setShowPasswordForm(true)}
      >
        修改密码
      </Button>

      <button type="button" className="desktop-logout-btn" onClick={handleLogout}>
        退出登录
      </button>
    </div>
  );

  const tabItems = [
    { key: 'history', label: '对话', children: historyPane },
    { key: 'settings', label: '设置', children: settingsPane },
  ];

  return (
    <>
      <aside className="desktop-drawer">
        <div className="desktop-drawer-content">
          <Tabs
            activeKey={drawerTab}
            onChange={(key) => setDrawerTab(key)}
            items={tabItems}
          />
        </div>
      </aside>

      <Modal
        open={showPasswordForm}
        title="修改密码"
        footer={null}
        typewriter={false}
        maskClosable={!passwordLoading}
        onClose={closePasswordModal}
        width={420}
      >
        <div className="desktop-password-form">
          <div className="desktop-field">
            <span className="desktop-field-label">旧密码</span>
            <Input
              type="password"
              value={passwordForm.oldPassword}
              onChange={(e) => setPasswordForm((p) => ({ ...p, oldPassword: e.target.value }))}
              placeholder="输入旧密码"
            />
          </div>
          <div className="desktop-field">
            <span className="desktop-field-label">新密码</span>
            <Input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
              placeholder="至少 6 位"
            />
          </div>
          <div className="desktop-field">
            <span className="desktop-field-label">确认新密码</span>
            <Input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
              placeholder="再次输入新密码"
            />
          </div>
          {passwordError && <div className="desktop-field-error">{passwordError}</div>}
          {passwordMsg && <div className="desktop-field-success">{passwordMsg}</div>}
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
