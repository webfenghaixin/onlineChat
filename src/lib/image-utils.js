import {
  DRAW_REFERENCE_TIER_1_MAX_BYTES,
  DRAW_REFERENCE_DIM_TIERS,
  DRAW_REFERENCE_FALLBACK_MAX_DIMENSION,
  DRAW_REFERENCE_MIN_QUALITY,
  DRAW_REFERENCE_TOTAL_BYTES_LIMIT,
  CHAT_IMAGE_TIER_1_MAX_BYTES,
  CHAT_IMAGE_DIM_TIERS,
  CHAT_IMAGE_TOTAL_BYTES_LIMIT,
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
 * 入参 src 可为 File/Blob 或 data URL 字符串（用于对已压缩过的 data URL 二次重压）。
 * @param {File | Blob | string} src 原始图片（File/Blob）或 data URL 字符串
 * @param {object} options 压缩配置
 * @param {number} options.maxDimension 最大边长（px）
 * @param {number} options.maxBytes 目标体积上限（字节）
 * @param {number} options.minQuality 最低质量（0-1）
 * @param {string} errorLabel 错误提示中的图片称呼（如「参考图」「图片」）
 * @returns {Promise<string>} 压缩后的 data URL
 */
async function compressImageToDataUrl(src, options, errorLabel = '图片') {
  const { maxDimension, maxBytes, minQuality } = options;
  // 持有原图 data URL 的大变量，drawImage 完成后置 null 以便 GC 释放
  let originalDataUrl = typeof src === 'string' ? src : await readAsDataUrl(src);
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

  try {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error(`${errorLabel}处理失败，请更换浏览器后重试。`);
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    // 原图已绘制到 canvas，释放大字符串引用
    originalDataUrl = null;

    let quality = 0.86;
    let blob = await canvasToBlob(canvas, 'image/jpeg', quality);

    while (blob.size > maxBytes && quality > minQuality) {
      quality = Math.max(minQuality, quality - 0.08);
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }

    if (blob.size > maxBytes) {
      throw new Error(`${errorLabel}仍然过大，请先裁剪后再上传。`);
    }

    return await readAsDataUrl(blob);
  } finally {
    // 完成/异常路径均释放 canvas 位图内存
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * 按图片数量动态解析压缩档位：1 张最高质量，数量越多单张体积与尺寸越小，总量守恒不超安全线。
 * 单张体积上限 = min(1 张档上限, 总量预算 / 张数 / 1.4)，1.4 为 base64 膨胀预留余量；
 * 单张尺寸按数量阶梯递减（index = count - 1，count 超过档位数取最后档）。
 * @param {'draw' | 'chat'} module 模块类型：draw 制图 / chat 聊天
 * @param {number} [count=1] 本次图片数量
 * @returns {{ maxBytes: number, maxDimension: number, minQuality: number }}
 */
export function resolveDynamicCompressionTier(module, count = 1) {
  const isDraw = module === 'draw';
  const totalBudget = isDraw ? DRAW_REFERENCE_TOTAL_BYTES_LIMIT : CHAT_IMAGE_TOTAL_BYTES_LIMIT;
  const tier1MaxBytes = isDraw ? DRAW_REFERENCE_TIER_1_MAX_BYTES : CHAT_IMAGE_TIER_1_MAX_BYTES;
  const dimTiers = isDraw ? DRAW_REFERENCE_DIM_TIERS : CHAT_IMAGE_DIM_TIERS;
  const minQuality = isDraw ? DRAW_REFERENCE_MIN_QUALITY : CHAT_IMAGE_MIN_QUALITY;

  const n = Math.max(1, Math.min(dimTiers.length, Math.floor(Number(count) || 1)));
  const maxBytes = Math.min(tier1MaxBytes, totalBudget / n / 1.4);
  const maxDimension = dimTiers[n - 1];
  return { maxBytes, maxDimension, minQuality };
}

// 制图参考图两档降级压缩：
// 常规档按动态档位压缩（数量越多单张越小），失败（"仍然过大"）时
// 自动降级到 640px、质量 0.4 重压一次；两档都失败才抛出最终错误，提示用户更换图片。
/**
 * 压缩制图参考图：按数量动态分配档位，含两档降级。
 * @param {File} file 参考图文件
 * @param {number} [count=1] 本次参考图数量
 * @returns {Promise<string>} 压缩后的 data URL
 */
export async function prepareDrawReferenceImage(file, count = 1) {
  const tier = resolveDynamicCompressionTier('draw', count);
  try {
    return await compressImageToDataUrl(
      file,
      {
        maxDimension: tier.maxDimension,
        maxBytes: tier.maxBytes,
        minQuality: tier.minQuality,
      },
      '参考图',
    );
  } catch (error) {
    // 仅对"仍然过大"类错误降级重压；读取/解析类错误重压也无法解决，原样抛出
    if (typeof error?.message === 'string' && error.message.includes('仍然过大')) {
      try {
        return await compressImageToDataUrl(
          file,
          {
            maxDimension: DRAW_REFERENCE_FALLBACK_MAX_DIMENSION,
            maxBytes: tier.maxBytes,
            minQuality: 0.4,
          },
          '参考图',
        );
      } catch {
        throw new Error('参考图仍然过大，请更换体积更小的图片后重试。');
      }
    }
    throw error;
  }
}

/**
 * 压缩聊天图片：按数量动态分配档位，单档压缩不降级。
 * @param {File} file 图片文件
 * @param {number} [count=1] 本次图片数量
 * @returns {Promise<string>} 压缩后的 data URL
 */
export async function prepareChatImage(file, count = 1) {
  const tier = resolveDynamicCompressionTier('chat', count);
  return compressImageToDataUrl(
    file,
    {
      maxDimension: tier.maxDimension,
      maxBytes: tier.maxBytes,
      minQuality: tier.minQuality,
    },
    '图片',
  );
}

// 发送前按最终数量对多张图片统一重压（制图与聊天模块共用）。
// 制图发送重压走 draw 档位（更注重质量，1280px 起），聊天发送重压走 chat 档位；
// 逐张处理，单项失败不中断整体，失败项 error 非空、url 为 null，整体不抛错。
/**
 * 按最终数量重压多张图片。
 * @param {Array<{ file: File, name?: string }>} items 待重压图片列表（每项至少含 file）
 * @param {number} count 本次图片最终数量
 * @param {'chat' | 'draw'} [module='chat'] 压缩档位模块，chat 聊天 / draw 制图
 * @returns {Promise<Array<{ file: File, name?: string, url: string | null, error?: string }>>}
 */
export async function recompressImages(items, count, module = 'chat') {
  const result = [];
  const prepare = module === 'draw' ? prepareDrawReferenceImage : prepareChatImage;
  for (const item of items) {
    try {
      const url = await prepare(item.file, count);
      result.push({ file: item.file, name: item.name, url });
    } catch (error) {
      result.push({ file: item.file, name: item.name, url: null, error: error.message || '压缩失败' });
    }
  }
  return result;
}

// 制图参考图两档降级压缩的源无关版本：src 可为 File 或 data URL 字符串
async function compressReferenceFromSrc(src, count) {
  const tier = resolveDynamicCompressionTier('draw', count);
  try {
    return await compressImageToDataUrl(
      src,
      {
        maxDimension: tier.maxDimension,
        maxBytes: tier.maxBytes,
        minQuality: tier.minQuality,
      },
      '参考图',
    );
  } catch (error) {
    if (typeof error?.message === 'string' && error.message.includes('仍然过大')) {
      try {
        return await compressImageToDataUrl(
          src,
          {
            maxDimension: DRAW_REFERENCE_FALLBACK_MAX_DIMENSION,
            maxBytes: tier.maxBytes,
            minQuality: 0.4,
          },
          '参考图',
        );
      } catch {
        throw new Error('参考图仍然过大，请更换体积更小的图片后重试。');
      }
    }
    throw error;
  }
}

// 发送前对"无原始 file、仅有 data URL"的参考图按最终数量重压（如"再次生成"从本地存储恢复的场景）。
// 逐张处理，单项失败不中断整体，失败项 error 非空、url 为 null，整体不抛错。
/**
 * 按最终数量重压 data URL 图片列表。
 * @param {string[]} dataUrls 待重压的 data URL 数组
 * @param {number} count 本次图片最终数量
 * @param {'chat' | 'draw'} [module='chat'] 压缩档位模块
 * @returns {Promise<Array<{ url: string | null, error?: string }>>}
 */
export async function recompressDataUrls(dataUrls, count, module = 'chat') {
  const result = [];
  const tier = resolveDynamicCompressionTier(module, count);
  for (const dataUrl of dataUrls) {
    try {
      const url = module === 'draw'
        ? await compressReferenceFromSrc(dataUrl, count)
        : await compressImageToDataUrl(dataUrl, tier, '图片');
      result.push({ url });
    } catch (error) {
      result.push({ url: null, error: error.message || '压缩失败' });
    }
  }
  return result;
}
