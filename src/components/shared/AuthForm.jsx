import { useState } from 'react';
import { Button, Card, Divider, Footer, Input, Title } from 'animal-island-ui';
import { VITE_INVITE_CODE } from '../../lib/constants';
import { login, register } from '../../lib/auth';

const TERMS_TEXT = '本人确认本工具仅用于学习交流用途，不用于任何违法违规场景，使用过程中产生的内容由本人自行承担责任。';
const TERMS_AGREED_KEY = 'lightchat_terms_agreed';

export default function AuthForm({
  authTab,
  setAuthTab,
  authForm,
  setAuthForm,
  authError,
  setAuthError,
  authLoading,
  setAuthLoading,
  setAuthState,
  setAuthLoadingActive,
  setCurrentUser,
}) {
  const isRegister = authTab === 'register';
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(() => {
    try {
      return localStorage.getItem(TERMS_AGREED_KEY) === '1';
    } catch {
      return false;
    }
  });

  function handleFieldFocus(event) {
    window.setTimeout(() => {
      event.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError('');

    if (!agreedToTerms) {
      setAuthError('请先阅读并同意使用条款');
      return;
    }

    if (isRegister && VITE_INVITE_CODE && authForm.inviteCode !== VITE_INVITE_CODE) {
      setAuthError('邀请码不正确');
      return;
    }

    setAuthLoading(true);

    try {
      if (isRegister) {
        await register(authForm.username, authForm.password, authForm.inviteCode);
      } else {
        await login(authForm.username, authForm.password);
      }

      try { localStorage.setItem(TERMS_AGREED_KEY, '1'); } catch { /* ignore */ }
      setCurrentUser(authForm.username);
      setAuthForm({ username: '', password: '', inviteCode: '' });
      setAuthLoadingActive(true);
      setAuthState('loading');
    } catch (error) {
      setAuthError(error.message || '操作失败');
    } finally {
      setAuthLoading(false);
    }
  }

  function toggleTerms() {
    const next = !agreedToTerms;
    setAgreedToTerms(next);
    if (next) {
      try { localStorage.setItem(TERMS_AGREED_KEY, '1'); } catch { /* ignore */ }
    } else {
      try { localStorage.removeItem(TERMS_AGREED_KEY); } catch { /* ignore */ }
    }
  }

  function switchAuthTab(nextTab) {
    setAuthTab(nextTab);
    setAuthError('');
  }

  return (
    <div className="gate-shell">
      <div className="gate-bg-leaves" aria-hidden="true" />
      <div className="gate-bg-waves" aria-hidden="true" />

      <div className="gate-card-wrapper">
        <Card className="gate-card" color="default" pattern="default">
          <div className="gate-card-head">
            <div className="gate-logo-ring">
              <img className="gate-logo" src="/logo-2.png" alt="" />
            </div>
            <Title size="large" color="app-teal" className="gate-title">lightChat</Title>
            <p className="gate-subtitle">AI 智能对话 · 让交流更自然</p>
          </div>

          <Divider type="wave-yellow" className="gate-divider" />

          <div className="auth-mode-shell" role="tablist" aria-label="登录注册切换">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              className={`auth-mode-option ${!isRegister ? 'auth-mode-option-active' : ''}`}
              onClick={() => switchAuthTab('login')}
            >
              <span className="auth-mode-title">登录</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              className={`auth-mode-option ${isRegister ? 'auth-mode-option-active' : ''}`}
              onClick={() => switchAuthTab('register')}
            >
              <span className="auth-mode-title">注册</span>
            </button>
          </div>

          <form className="gate-form" onSubmit={handleAuthSubmit}>
            <Input
              size="large"
              shadow
              allowClear
              type="text"
              value={authForm.username}
              onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
              onFocus={handleFieldFocus}
              placeholder="用户名"
              autoComplete="username"
              required
            />

            <Input
              size="large"
              shadow
              allowClear
              type={showPassword ? 'text' : 'password'}
              value={authForm.password}
              onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
              onFocus={handleFieldFocus}
              placeholder="密码"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              suffix={(
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12c.92-2.6 2.66-4.77 4.94-6.22" />
                      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a11.8 11.8 0 0 1-2.16 3.19" />
                      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
                      <path d="M1 1l22 22" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              )}
              required
            />

            <div className={`auth-extra-field ${isRegister ? 'auth-extra-field-visible' : ''}`}>
              {isRegister && (
                <Input
                  size="large"
                  shadow
                  allowClear
                  type="text"
                  value={authForm.inviteCode}
                  onChange={(event) => setAuthForm((current) => ({ ...current, inviteCode: event.target.value }))}
                  onFocus={handleFieldFocus}
                  placeholder="邀请码"
                  required
                />
              )}
            </div>

            <label className="terms-checkbox">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={toggleTerms}
                className="terms-checkbox-input"
              />
              <span className="terms-checkbox-box" aria-hidden="true">
                {agreedToTerms && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2.5 6 5 8.5 9.5 3.5" />
                  </svg>
                )}
              </span>
              <span className="terms-checkbox-text">
                <span className="terms-checkbox-label">我同意以下条款</span>
                <span className="terms-checkbox-body">{TERMS_TEXT}</span>
              </span>
            </label>

            <Button
              type="primary"
              size="large"
              block
              loading={authLoading}
              disabled={authLoading || !agreedToTerms}
              htmlType="submit"
            >
              {isRegister ? '注册账号' : '登录'}
            </Button>
          </form>

          {authError && <div className="gate-error">{authError}</div>}
        </Card>
      </div>

      <Footer type="tree" className="gate-footer" />
    </div>
  );
}
