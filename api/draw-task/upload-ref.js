export const config = {
  maxDuration: 30,
};

import { sendJson, setCorsHeaders, readJsonBody, authenticateNodeRequest } from './start.js';
import { getLimiter, limitRequest } from '../lib/ratelimit.js';
import { putPublicImage } from '../lib/cos-storage.js';

// data URL → buffer
function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const contentType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  return { contentType, buffer };
}

function getExt(contentType) {
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('gif')) return 'gif';
  return 'png';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Only POST is allowed.' });
    return;
  }

  const auth = await authenticateNodeRequest(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: auth.error.message });
    return;
  }

  const limiter = getLimiter('draw-upload-ref', 20, '1d');
  const rateLimit = await limitRequest(limiter, auth.username);
  if (!rateLimit.ok) {
    sendJson(res, 429, { error: '操作过于频繁，请稍后再试' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: '请求格式错误' });
    return;
  }

  const dataUrl = typeof body.image === 'string' ? body.image : '';
  if (!dataUrl.startsWith('data:image/')) {
    sendJson(res, 400, { error: '缺少有效的参考图数据' });
    return;
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    sendJson(res, 400, { error: '参考图格式解析失败' });
    return;
  }

  // 单张参考图体积上限 1MB（前端已压缩到 0.4MB，留余量）
  if (parsed.buffer.length > 1024 * 1024) {
    sendJson(res, 413, { error: '参考图过大，请先压缩后再上传。' });
    return;
  }

  // username 可能含 @ . 等特殊字符，转成安全路径片段
  const safeUser = String(auth.username || 'u').replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    const id = crypto.randomUUID();
    const ext = getExt(parsed.contentType);
    const url = await putPublicImage(
      `draw-ref/${safeUser}/${id}.${ext}`,
      parsed.buffer,
      parsed.contentType,
    );
    sendJson(res, 200, { url });
  } catch (error) {
    console.error('参考图上传到对象存储失败:', error);
    sendJson(res, 500, { error: '参考图上传失败，请稍后重试。' });
  }
}
