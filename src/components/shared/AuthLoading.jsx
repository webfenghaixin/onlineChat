import { Loading } from 'animal-island-ui';

export default function AuthLoading({ active = true }) {
  return (
    <div className="auth-loading-overlay" aria-hidden="true">
      <div className="auth-loading-fill">
        <Loading active={active} />
      </div>
    </div>
  );
}
