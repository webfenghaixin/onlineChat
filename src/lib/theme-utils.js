const THEME_KEY = 'lightchat_theme';
export const DEFAULT_THEME = 'animal';

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const validTheme = theme === 'dark' ? 'dark' : 'animal';
  document.documentElement.dataset.theme = validTheme;
}

export function getStoredTheme() {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' ? 'dark' : 'animal';
}

export function setStoredTheme(theme) {
  if (typeof localStorage === 'undefined') return;
  const validTheme = theme === 'dark' ? 'dark' : 'animal';
  localStorage.setItem(THEME_KEY, validTheme);
}

export function toggleTheme(currentTheme) {
  return currentTheme === 'dark' ? 'animal' : 'dark';
}
