import { resolveApiUrl } from './constants';

const TOKEN_KEY = 'online-chat-h5-token';
const USERNAME_KEY = 'online-chat-h5-username';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(token, username) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, username);
  } catch {}
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
  } catch {}
}

export function getStoredUsername() {
  try {
    return localStorage.getItem(USERNAME_KEY) || '';
  } catch {
    return '';
  }
}

async function apiRequest(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `请求失败 (${response.status})`);
  }

  return data;
}

export async function register(username, password, inviteCode) {
  const data = await apiRequest(resolveApiUrl('/api/auth/register'), {
    method: 'POST',
    body: JSON.stringify({ username, password, inviteCode }),
  });
  setToken(data.token, data.username);
  return data;
}

export async function login(username, password) {
  const data = await apiRequest(resolveApiUrl('/api/auth/login'), {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token, data.username);
  return data;
}

export async function saveToCloud(state) {
  await apiRequest(resolveApiUrl('/api/data/save'), {
    method: 'POST',
    body: JSON.stringify({
      conversations: state.conversations,
      settings: state.settings,
      activeConversationId: state.activeConversationId,
      drawConversations: state.drawConversations,
      activeDrawConversationId: state.activeDrawConversationId,
    }),
  });
}

export async function loadFromCloud() {
  const data = await apiRequest(resolveApiUrl('/api/data/load'));
  return data;
}
