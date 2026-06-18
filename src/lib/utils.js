import { marked } from 'marked';
import {
  STORAGE_KEY,
  GEMINI_MODEL_ID,
  defaultSettings,
} from './constants';

marked.setOptions({
  breaks: true,
  gfm: true,
});

const markdownCache = new Map();
const MARKDOWN_CACHE_MAX = 200;

export function renderMarkdown(text) {
  if (!text) return '';
  const cached = markdownCache.get(text);
  if (cached !== undefined) return cached;
  const html = marked.parse(text);
  if (markdownCache.size >= MARKDOWN_CACHE_MAX) {
    const firstKey = markdownCache.keys().next().value;
    markdownCache.delete(firstKey);
  }
  markdownCache.set(text, html);
  return html;
}

export function isGeminiModel(model) {
  return String(model || '').toLowerCase().startsWith('gemini');
}

export function normalizeModelSettings(settings) {
  const nextSettings = {
    ...settings,
    rightcodePricing: 'regular',
    stream: true,
    useProxy: true,
    proxyPath: '/api/proxy',
  };

  if (isGeminiModel(nextSettings.model)) {
    nextSettings.source = 'rightcode';
    nextSettings.requestMode = 'gemini';
    nextSettings.endpoint = '';
    nextSettings.apiKey = '';
  } else {
    nextSettings.requestMode = 'chat';
  }

  return nextSettings;
}

export function getTextParts(content) {
  if (Array.isArray(content)) {
    return content
      .filter((item) => item?.type === 'text' && item.text)
      .map((item) => item.text)
      .join('\n');
  }

  return typeof content === 'string' ? content : '';
}

export function getImageParts(content) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter((item) => item?.type === 'image_url' && item.image_url?.url);
}

export function createTextContent(text) {
  return [
    {
      type: 'text',
      text,
    },
  ];
}

export function createConversation() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '新的对话',
    updatedAt: now,
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: createTextContent('你好，直接把问题发给我就行。我会尽量用清楚、好读的方式回答。'),
        createdAt: now,
      },
    ],
  };
}

export function createDrawConversation() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '新的画图',
    updatedAt: now,
    messages: [],
  };
}

function normalizeMessage(message, fallbackTimestamp) {
  const rawContent = Array.isArray(message?.content)
    ? message.content
    : createTextContent(typeof message?.content === 'string' ? message.content : '');

  return {
    ...message,
    content: rawContent,
    createdAt: message?.createdAt || fallbackTimestamp || Date.now(),
  };
}

export function normalizeState(parsed) {
  const initialConversation = createConversation();
  const conversations =
    Array.isArray(parsed?.conversations) && parsed.conversations.length
      ? parsed.conversations.map((conversation) => ({
          ...conversation,
          messages: (conversation.messages || []).map((message) =>
            normalizeMessage(message, conversation.updatedAt),
          ),
        }))
      : [initialConversation];

  const drawConversations =
    Array.isArray(parsed?.drawConversations) && parsed.drawConversations.length
      ? parsed.drawConversations
      : [];

  return {
    settings: normalizeModelSettings({
      ...defaultSettings,
      ...(parsed?.settings || {}),
    }),
    conversations,
    activeConversationId: parsed?.activeConversationId || conversations[0].id,
    drawConversations,
    activeDrawConversationId: parsed?.activeDrawConversationId || (drawConversations[0]?.id ?? null),
  };
}

export function loadState() {
  try {
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    if (currentRaw) {
      return normalizeState(JSON.parse(currentRaw));
    }
  } catch (error) {
    return normalizeState(null);
  }

  return normalizeState(null);
}

export function saveState(state) {
  try {
    // 过滤掉画图消息中的 referenceImage（base64 数据过大，且仅临时使用）
    const cleanedDrawConversations = state.drawConversations.map((conv) => ({
      ...conv,
      messages: conv.messages.map((msg) => {
        if (msg.referenceImage) {
          const { referenceImage, ...rest } = msg;
          return rest;
        }
        return msg;
      }),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, drawConversations: cleanedDrawConversations }));
  } catch {
    // localStorage 可能已满，忽略写入错误
  }
}

export function formatTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

export function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function resolveDrawDurationSeconds(taskTiming, fallbackStartedAt) {
  const createdAt = Number(taskTiming?.createdAt || fallbackStartedAt || 0);
  const completedAt = Number(taskTiming?.completedAt || Date.now());
  if (!createdAt || !completedAt || completedAt < createdAt) {
    return 0;
  }

  return Math.max(0, Math.round((completedAt - createdAt) / 1000));
}

export function buildConversationTitle(messages) {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) {
    return '新的对话';
  }

  const titleSource = getTextParts(firstUserMessage.content);
  return titleSource.slice(0, 18) || '新的对话';
}

export function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

export function buildCopyText(message) {
  const text = getTextParts(message.content).trim();
  if (!text) {
    return '';
  }

  return `${message.role === 'assistant' ? 'AI' : '我'}：${text}`;
}
