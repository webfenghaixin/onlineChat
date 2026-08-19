// 打包成 App 时，通过 VITE_API_BASE 指向后端域名（例如 https://www.lightchat.online）
// Web 部署时留空，使用相对路径 /api/...
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
export const DEFAULT_PROXY_PATH = API_BASE ? `${API_BASE}/api/proxy` : '/api/proxy';

export function resolveApiUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return API_BASE + (path.startsWith('/') ? path : `/${path}`);
}

export const STORAGE_KEY = 'online-chat-h5-state-v7';
export const VITE_INVITE_CODE = import.meta.env.VITE_INVITE_CODE || '';
export const MAX_COMPOSER_HEIGHT = 140;
// 常规档压缩仍过大时降级到 640px 再压一次
export const DRAW_REFERENCE_FALLBACK_MAX_DIMENSION = 640;
// 制图参考图：压缩后 data URL 写入本地 IndexedDB（ref-image-store），消息仅存轻量元数据。
// 发送任务时 data URL 仅进入 task.options（Redis 临时 24h），需控制 base64 总量 < 0.75MB。
// 动态分配规则：1 张最高质量，数量越多单张压缩尺寸与体积越小，总量守恒不超安全线。
// 单张体积上限 = min(1 张档上限, 总量预算 / 张数 / 1.4)，1.4 为 base64 膨胀预留余量；
// 单张尺寸按数量阶梯递减（index = count - 1，count 超过 5 取最后档）。
export const DRAW_REFERENCE_TIER_1_MAX_BYTES = 0.4 * 1024 * 1024;
export const DRAW_REFERENCE_DIM_TIERS = [1792, 1536, 1280, 1024, 1024];
export const DRAW_REFERENCE_MIN_QUALITY = 0.5;
export const DRAW_REFERENCE_TOTAL_BYTES_LIMIT = 0.75 * 1024 * 1024;
export const DRAW_MAX_REFERENCE_IMAGES = 5;
export const DRAW_MIN_BATCH_COUNT = 1;
export const DRAW_MAX_BATCH_COUNT = 20;

// 聊天页面上传图片的压缩参数
// Vercel Serverless Function 请求体上限 4.5MB，base64 编码会膨胀约 33%，
// base64 总量预算 3.5MB（CHAT_IMAGE_TOTAL_BYTES_LIMIT），加上对话历史等 payload，总请求体远低于 4.5MB。
// 动态分配规则：1 张最高质量，数量越多单张压缩尺寸与体积越小，总量守恒不超安全线。
// 单张体积上限 = min(1 张档上限, 总量预算 / 张数 / 1.4)；单张尺寸按数量阶梯递减（index = count - 1）。
export const CHAT_IMAGE_TIER_1_MAX_BYTES = 0.8 * 1024 * 1024;
export const CHAT_IMAGE_DIM_TIERS = [1536, 1280, 1024, 1024, 1024];
export const CHAT_IMAGE_TOTAL_BYTES_LIMIT = 3.5 * 1024 * 1024;
export const CHAT_IMAGE_MIN_QUALITY = 0.45;
export const CHAT_MAX_IMAGES = 5;
// 解除制图历史照片上限（原 100 张），保留 enforceDrawLimit 逻辑备用，设为极大值即不触发
export const DRAW_MAX_IMAGES = 100000;

// 余额系统（与服务端 api/lib/auth-utils.js 保持一致）
export const COST_CHAT = 0.05;
export const COST_DRAW = 0.3;
export const BALANCE_RECHARGE_PRESETS = [5, 10, 20, 50];

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
  { value: 'gpt-5.6-luna', label: 'light-5.6-luna' },
  { value: 'gpt-5.6-terra', label: 'light-5.6-terra' },
  { value: 'gpt-5.6-sol', label: 'light-5.6-sol' },
];

export const DRAW_MODEL_OPTIONS = [
  { value: 'gpt-image-2', label: 'light-image-2' },
  { value: 'gpt-image-2-vip', label: 'light-image-2-vip（暂不可用）', disabled: true },
];

export const DRAW_SIZE_OPTIONS = [
  { value: '1024x1024', label: '1:1 方图 · 正方形（1024×1024）' },
  { value: '1024x1536', label: '2:3 竖图 · 偏正方形（1024×1536）' },
  { value: '1024x1792', label: '9:16 长竖图 · 适合手机竖屏（1024×1792）' },
  { value: '1536x1024', label: '3:2 横图 · 偏正方形（1536×1024）' },
  { value: '1792x1024', label: '16:9 长横图 · 适合电脑横屏（1792×1024）' },
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

export const DRAW_STYLE_OPTIONS = [
  { value: '', label: '自动 / 无' },
  { value: 'photoreal', label: '写实摄影', prompt: 'Photorealistic, high detail, natural lighting' },
  { value: 'anime', label: '动漫插画', prompt: 'Anime style illustration' },
  { value: '3d', label: '3D 渲染', prompt: '3D render, octane, soft studio lighting' },
  { value: 'flat', label: '扁平插画', prompt: 'Flat vector illustration, clean shapes' },
  { value: 'watercolor', label: '水彩', prompt: 'Watercolor painting style' },
  { value: 'pixel', label: '像素风', prompt: 'Pixel art style' },
];

export const defaultSettings = {
  source: 'rightcode',
  rightcodePricing: 'regular',
  endpoint: '',
  apiKey: '',
  model: 'gpt-5.6-luna',
  requestMode: 'chat',
  systemPrompt: '你是一位耐心、清晰、友好的 AI 助手。请优先用简洁易懂的中文回答。',
  temperature: 0.7,
  maxOutputTokens: 8192,
  stream: true,
  useProxy: true,
  proxyPath: DEFAULT_PROXY_PATH,
  fontSize: 'lg',
  drawSize: '1024x1024',
  drawQuality: 'medium',
  drawModel: 'gpt-image-2',
  drawApiMode: 'images',
  drawStyle: '',
  drawImageCount: 1,
};
