import { useState } from 'react';
import { applyTheme, getStoredTheme, setStoredTheme, toggleTheme } from '../../lib/theme-utils';

export default function ThemeSwitch({ theme, onThemeChange }) {
  const [currentTheme, setCurrentTheme] = useState(theme || getStoredTheme());

  function handleToggle() {
    const next = toggleTheme(currentTheme);
    setCurrentTheme(next);
    applyTheme(next);
    setStoredTheme(next);
    if (onThemeChange) onThemeChange(next);
  }

  const isDark = currentTheme === 'dark';

  return (
    <button
      type="button"
      className="desktop-theme-switch"
      onClick={handleToggle}
      aria-label={isDark ? '切换到动森主题' : '切换到暗黑主题'}
      title={isDark ? '切换到动森主题' : '切换到暗黑主题'}
    >
      {isDark ? '🌙' : '🌞'}
    </button>
  );
}
