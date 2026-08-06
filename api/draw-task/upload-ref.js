export const config = {
  maxDuration: 30,
};

import { sendJson, setCorsHeaders, readJsonBody, authenticateNodeRequest } from './start.js';

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

  const token = process.env.BLOB_READ_WRITE_TOKEN || '';
  if (!token) {
    sendJson(res, 500, { error: '服务端未配置 BLOB_READ_WRITE_TOKEN' });
    return;
  }

  try {
    const { put } = await import('@vercel/blob');
    const id = crypto.randomUUID();
    const ext = getExt(parsed.contentType);
    const blob = await put(`draw-ref/${auth.username}/${id}.${ext}`, parsed.buffer, {
      access: 'public',
      contentType: parsed.contentType,
      token,
      addRandomSuffix: false,
    });
    sendJson(res, 200, { url: blob.url });
  } catch (error) {
    sendJson(res, 500, { error: '参考图上传失败，请稍后重试。' });
  });
}
