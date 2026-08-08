import {
  DRAW_REFERENCE_MAX_DIMENSION,
  DRAW_REFERENCE_MAX_BYTES,
  DRAW_REFERENCE_MIN_QUALITY,
  CHAT_IMAGE_MAX_DIMENSION,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MIN_QUALITY,
} from './constants';
import { API_BASE } from './constants';
import { getToken } from './auth.js';

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解析失败'));
    image.src = src;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('图片压缩失败'));
    }, type, quality);
  });
}

/**
 * 通用图片压缩：按最大边缩放，循环降低质量直到满足体积上限。
 * @param {File} file 原始图片文件
 * @param {object} options 压缩配置
 * @param {number} options.maxDimension 最大边长（px）
 * @param {number} options.maxBytes 目标体积上限（字节）
 * @param {number} options.minQuality 最低质量（0-1）
 * @param {string} errorLabel 错误提示中的图片称呼（如「参考图」「图片」）
 * @returns {Promise<string>} 压缩后的 data URL
 */
async function compressImageToDataUrl(file, options, errorLabel = '图片') {
  const { maxDimension, maxBytes, minQuality } = options;
  const originalDataUrl = await readAsDataUrl(file);
  const image = await loadImageElement(originalDataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const maxEdge = Math.max(sourceWidth, sourceHeight);
  const scale = maxEdge > maxDimension ? maxDimension / maxEdge : 1;

  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(`${errorLabel}处理失败，请更换浏览器后重试。`);
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  let quality = 0.86;
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality);

  while (blob.size > maxBytes && quality > minQuality) {
    quality = Math.max(minQuality, quality - 0.08);
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  }

  if (blob.size > maxBytes) {
    throw new Error(`${errorLabel}仍然过大，请先裁剪后再上传。`);
  }

  return readAsDataUrl(blob);
}

export async function prepareDrawReferenceImage(file) {
  return compressImageToDataUrl(
    file,
    {
      maxDimension: DRAW_REFERENCE_MAX_DIMENSION,
      maxBytes: DRAW_REFERENCE_MAX_BYTES,
      minQuality: DRAW_REFERENCE_MIN_QUALITY,
    },
    '参考图',
  );
}

// 带重试的 fetch：仅对网络错误 / 5xx / 429 重试，4xx（如 401/400/413）立即抛出
async function fetchUploadWithRetry(input, init, { retries = 3, baseDelay = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      // 网络抖动 / 中断：可重试
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** attempt));
        continue;
      }
      throw error;
    }
    // 5xx / 429（限流）：可重试
    if (response.status >= 500 || response.status === 429) {
      let body = null;
      try { body = await response.json(); } catch {}
      lastError = new Error(body?.error || `参考图上传失败 (${response.status})`);
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** attempt));
        continue;
      }
      // 重试耗尽，返回最后的响应让调用方读取错误
      return { response, preParsedBody: body };
    }
    return { response, preParsedBody: null };
  }
  throw lastError || new Error('参考图上传失败');
}

// 将压缩后的参考图 data URL 上传到 Vercel Blob 持久化，返回 blob URL
export async function uploadDrawReferenceImage(dataUrl) {
  const token = getToken();
  const { response, preParsedBody } = await fetchUploadWithRetry(`${API_BASE}/api/draw-task/upload-ref`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ image: dataUrl }),
  });
  const data = preParsedBody || await response.json().catch(() => ({}));
  if (!response.ok || !data.url) {
    throw new Error(data.error || '参考图上传失败，请稍后重试。');
  }
  return data.url;
}

export async function prepareChatImage(file) {
  return compressImageToDataUrl(
    file,
    {
      maxDimension: CHAT_IMAGE_MAX_DIMENSION,
      maxBytes: CHAT_IMAGE_MAX_BYTES,
      minQuality: CHAT_IMAGE_MIN_QUALITY,
    },
    '图片',
  );
}
