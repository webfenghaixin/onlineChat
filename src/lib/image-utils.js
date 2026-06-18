import {
  DRAW_REFERENCE_MAX_DIMENSION,
  DRAW_REFERENCE_MAX_BYTES,
  DRAW_REFERENCE_MIN_QUALITY,
} from './constants';

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('参考图读取失败'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('参考图解析失败'));
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
      reject(new Error('参考图压缩失败'));
    }, type, quality);
  });
}

export async function prepareDrawReferenceImage(file) {
  const originalDataUrl = await readAsDataUrl(file);
  const image = await loadImageElement(originalDataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const maxEdge = Math.max(sourceWidth, sourceHeight);
  const scale = maxEdge > DRAW_REFERENCE_MAX_DIMENSION
    ? DRAW_REFERENCE_MAX_DIMENSION / maxEdge
    : 1;

  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('参考图处理失败，请更换浏览器后重试。');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  let quality = 0.86;
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality);

  while (blob.size > DRAW_REFERENCE_MAX_BYTES && quality > DRAW_REFERENCE_MIN_QUALITY) {
    quality = Math.max(DRAW_REFERENCE_MIN_QUALITY, quality - 0.08);
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  }

  if (blob.size > DRAW_REFERENCE_MAX_BYTES) {
    throw new Error('参考图仍然过大，请先裁剪后再上传。');
  }

  return readAsDataUrl(blob);
}
