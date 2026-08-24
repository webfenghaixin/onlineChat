import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 腾讯云 COS 配置（走环境变量，不落库）
const COS_SECRET_ID = process.env.COS_SECRET_ID || '';
const COS_SECRET_KEY = process.env.COS_SECRET_KEY || '';
const COS_BUCKET = process.env.COS_BUCKET || '';
const COS_REGION = process.env.COS_REGION || '';
// 自定义域名（已备案/CDN），建议配置；不配则回退到 COS 默认域名
const COS_BASE_URL = process.env.COS_BASE_URL || '';

// 是否启用 COS：密钥、桶、地域三者齐全才启用
export function isCosConfigured() {
  return Boolean(COS_SECRET_ID && COS_SECRET_KEY && COS_BUCKET && COS_REGION);
}

let cosClient;

function getCosClient() {
  if (!cosClient) {
    const COS = require('cos-nodejs-sdk-v5');
    cosClient = new COS({
      SecretId: COS_SECRET_ID,
      SecretKey: COS_SECRET_KEY,
    });
  }
  return cosClient;
}

function resolveCosPublicUrl(key) {
  if (COS_BASE_URL) {
    const base = COS_BASE_URL.replace(/\/+$/, '');
    return `${base}/${key.replace(/^\/+/, '')}`;
  }
  return `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${key.replace(/^\/+/, '')}`;
}

function cosPutObject(key, buffer, contentType) {
  return new Promise((resolve, reject) => {
    getCosClient().putObject(
      {
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
      },
      (err) => {
        if (err) return reject(err);
        resolve(resolveCosPublicUrl(key));
      },
    );
  });
}

async function vercelBlobPut(key, buffer, contentType) {
  const token = process.env.BLOB_READ_WRITE_TOKEN || '';
  if (!token) throw new Error('服务端未配置 BLOB_READ_WRITE_TOKEN');
  const { put } = await import('@vercel/blob');
  const blob = await put(key, buffer, {
    access: 'public',
    contentType,
    token,
    addRandomSuffix: false,
  });
  return blob.url;
}

/**
 * 上传图片到对象存储。
 * 优先 COS；未配置 COS 时回退到 Vercel Blob（灰度兼容）。
 * @param {string} key 对象键（如 draw-ref/u/xxx.png）
 * @param {Buffer} buffer 图片二进制
 * @param {string} contentType 图片 MIME
 * @returns {Promise<string>} 公网可读的图片 URL
 */
export async function putPublicImage(key, buffer, contentType) {
  if (isCosConfigured()) {
    return cosPutObject(key, buffer, contentType);
  }
  return vercelBlobPut(key, buffer, contentType);
}