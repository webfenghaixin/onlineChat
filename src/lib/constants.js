export const STORAGE_KEY = 'online-chat-h5-state-v7';
export const VITE_INVITE_CODE = import.meta.env.VITE_INVITE_CODE || '';
export const MAX_COMPOSER_HEIGHT = 140;
export const GEMINI_MODEL_ID = 'gemini-3.1-pro';
export const DRAW_REFERENCE_MAX_DIMENSION = 1536;
export const DRAW_REFERENCE_MAX_BYTES = 1.5 * 1024 * 1024;
export const DRAW_REFERENCE_MIN_QUALITY = 0.55;

export const FONT_SIZE_OPTIONS = [
  { value: 'md', label: '标准' },
  { value: 'lg', label: '大字' },
  { value: 'xl', label: '超大' },
];

export const SOURCE_OPTIONS = [
  { value: 'luxee', label: 'Luxee' },
  { value: 'rightcode', label: 'RightCode' },
];

export const RIGHTCODE_PRICING_OPTIONS = [
  { value: 'regular', label: '正价' },
  { value: 'daily', label: '日抛' },
];

export const MODEL_OPTIONS = [
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-medium', label: 'GPT-5.4-Medium' },
  { value: 'gpt-5.4-high', label: 'GPT-5.4-High' },
  { value: GEMINI_MODEL_ID, label: 'Gemini 3.1 Pro' },
];

export const DRAW_MODEL_OPTIONS = [
  { value: 'gpt-image-2', label: 'GPT-Image-2' },
  { value: 'gpt-image-2-vip', label: 'GPT-Image-2-VIP' },
];

export const DRAW_SIZE_OPTIONS = [
  // 1K 分辨率
  { value: '1024x1024', label: '1K · 1:1 方图' },
  { value: '1024x1536', label: '1K · 2:3 竖图' },
  { value: '1024x1792', label: '1K · 9:16 全屏' },
  { value: '1536x1024', label: '1K · 3:2 横图' },
  { value: '1792x1024', label: '1K · 16:9 宽屏' },
  // 2K 分辨率
  { value: '2048x2048', label: '2K · 1:1 方图' },
  { value: '2048x3072', label: '2K · 2:3 竖图' },
  { value: '2048x3584', label: '2K · 9:16 全屏' },
  { value: '3072x2048', label: '2K · 3:2 横图' },
  { value: '3584x2048', label: '2K · 16:9 宽屏' },
  // 4K 分辨率
  { value: '4096x4096', label: '4K · 1:1 方图' },
  { value: '4096x6144', label: '4K · 2:3 竖图' },
  { value: '4096x7168', label: '4K · 9:16 全屏' },
  { value: '6144x4096', label: '4K · 3:2 横图' },
  { value: '7168x4096', label: '4K · 16:9 宽屏' },
];

export const DRAW_QUALITY_OPTIONS = [
  { value: 'low', label: '快速' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '高清' },
  { value: 'auto', label: '自动' },
];

export const DRAW_API_MODE_OPTIONS = [
  { value: 'images', label: 'Images API' },
  { value: 'chat', label: 'Chat API' },
];

export const defaultSettings = {
  source: 'rightcode',
  rightcodePricing: 'regular',
  endpoint: '',
  apiKey: '',
  model: 'gpt-5.4',
  requestMode: 'chat',
  systemPrompt: '你是一位耐心、清晰、友好的 AI 助手。请优先用简洁易懂的中文回答。',
  temperature: 0.7,
  maxOutputTokens: 8192,
  stream: true,
  useProxy: true,
  proxyPath: '/api/proxy',
  fontSize: 'lg',
  drawSize: '1024x1024',
  drawQuality: 'medium',
  drawModel: 'gpt-image-2',
  drawApiMode: 'images',
};
