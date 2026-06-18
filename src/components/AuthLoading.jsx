export default function AuthLoading() {
  return (
    <div className="gate-shell gate-shell-loading">
      <section className="gate-card-loading">
        <div className="gate-loading-scene" aria-hidden="true">
          <img className="gate-loading-logo" src="/logo-2.png" alt="" />
        </div>
        <div className="gate-loading-copy">
          <p className="loading-text" aria-label="正在同步你的工作台">
            {'正在同步你的工作台'.split('').map((char, index) => (
              <span key={`${char}-${index}`} style={{ '--delay': `${index * 0.08}s` }}>
                {char}
              </span>
            ))}
          </p>
        </div>
      </section>
    </div>
  );
}
