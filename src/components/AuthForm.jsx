import { classNames } from '../lib/utils';
import { VITE_INVITE_CODE } from '../lib/constants';
import { register, login } from '../lib/auth';

export default function AuthForm({ authTab, setAuthTab, authForm, setAuthForm, authError, setAuthError, authLoading, setAuthLoading, setAuthState, setCurrentUser }) {
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
