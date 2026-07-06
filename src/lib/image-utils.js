import {
  DRAW_REFERENCE_MAX_DIMENSION,
  DRAW_REFERENCE_MAX_BYTES,
  DRAW_REFERENCE_MIN_QUALITY,
  CHAT_IMAGE_MAX_DIMENSION,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MIN_QUALITY,
} from './constants';

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
