import { marked } from 'marked';
import {
  STORAGE_KEY,
  defaultSettings,
  DEFAULT_PROXY_PATH,
  MODEL_OPTIONS,
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

export function normalizeModelSettings(settings) {
  const nextSettings = {
    ...settings,
    rightcodePricing: 'regular',
    stream: true,
    useProxy: true,
    proxyPath: DEFAULT_PROXY_PATH,
  };

  // 历史数据迁移：已下线的模型（gpt-5.4/5.5/gemini-3.1-pro 等）回退到默认模型
  if (!MODEL_OPTIONS.some((option) => option.value === nextSettings.model)) {
    nextSettings.model = defaultSettings.model;
  }
  nextSettings.requestMode = 'chat';

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

export function createId() {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    if (typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
      return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
      ].join('-');
    }
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createConversation() {
  const now = Date.now();
  return {
    id: createId(),
    title: '新的对话',
    updatedAt: now,
    messageCount: 1,
    messagesLoaded: true,
    messages: [
      {
        id: createId(),
        role: 'assistant',
        content: createTextContent('你好，直接把问题发给我就行。我会尽量用清晰、好读的方式回答。'),
        createdAt: now,
      },
    ],
  };
}

export function createDrawConversation() {
  const now = Date.now();
  return {
    id: createId(),
    title: '新的画图',
    updatedAt: now,
    messageCount: 0,
    imageCount: 0,
    messagesLoaded: true,
    messages: [],
  };
}

export function normalizeMessage(message, fallbackTimestamp) {
  const rawContent = Array.isArray(message?.content)
    ? message.content
    : typeof message?.content === 'string'
      ? createTextContent(message.content)
      : message?.content && typeof message.content === 'object' && message.content.type === 'text'
        ? createTextContent(message.content.text || '')
        : createTextContent('');

  return {
    ...message,
    id: message?.id || createId(),
    content: rawContent,
    createdAt: message?.createdAt || fallbackTimestamp || Date.now(),
  };
}

export function normalizeState(parsed) {
  const initialConversation = createConversation();

  const normalizeConversation = (conv, fallbackIdx) => {
    const messages = Array.isArray(conv?.messages) ? conv.messages : [];
    const hasMessages = messages.length > 0;
    return {
      ...conv,
      id: conv?.id || createId(),
      title: conv?.title || '新的对话',
      updatedAt: conv?.updatedAt || Date.now(),
      messageCount: typeof conv?.messageCount === 'number' ? conv.messageCount : messages.length,
      lastPreview: conv?.lastPreview || '',
      messagesLoaded: typeof conv?.messagesLoaded === 'boolean' ? conv.messagesLoaded : hasMessages,
      messages: hasMessages
        ? messages.map((message) => normalizeMessage(message, conv.updatedAt))
        : [],
    };
  };

  const normalizeDrawConversation = (conv) => {
    const messages = Array.isArray(conv?.messages) ? conv.messages : [];
    const hasMessages = messages.length > 0;
    return {
      ...conv,
      id: conv?.id || createId(),
      title: conv?.title || '新的画图',
      updatedAt: conv?.updatedAt || Date.now(),
      messageCount: typeof conv?.messageCount === 'number' ? conv.messageCount : messages.length,
      imageCount: typeof conv?.imageCount === 'number'
        ? conv.imageCount
        : messages.filter((m) => m.role === 'assistant' && m.imageUrl).length,
      messagesLoaded: typeof conv?.messagesLoaded === 'boolean' ? conv.messagesLoaded : hasMessages,
      messages: hasMessages
        ? messages.map((message) => normalizeMessage(message, conv.updatedAt))
        : [],
    };
  };

  const conversations =
    Array.isArray(parsed?.conversations) && parsed.conversations.length
      ? parsed.conversations.map((conv, i) => normalizeConversation(conv, i))
      : [initialConversation];

  const drawConversations =
    Array.isArray(parsed?.drawConversations) && parsed.drawConversations.length
      ? parsed.drawConversations.map((conv) => normalizeDrawConversation(conv))
      : [];

  const activeConversationId = parsed?.activeConversationId || conversations[0].id;
  const activeDrawConversationId = parsed?.activeDrawConversationId || (drawConversations[0]?.id ?? null);

  return {
    settings: normalizeModelSettings({
      ...defaultSettings,
      ...(parsed?.settings || {}),
    }),
    conversations,
    activeConversationId,
    drawConversations,
    activeDrawConversationId,
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
    const cleanedConversations = state.conversations.map((conversation) => ({
      ...conversation,
      messages: [],
      messagesLoaded: false,
    }));

    const cleanedDrawConversations = state.drawConversations.map((conversation) => ({
      ...conversation,
      messages: [],
      messagesLoaded: false,
    }));

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, conversations: cleanedConversations, drawConversations: cleanedDrawConversations }),
    );
  } catch {
    // localStorage may be full or unavailable in some embedded browsers.
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
