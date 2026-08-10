// 制图参考图本地存储：基于 IndexedDB 的 ref-image-store 库
// 背景：参考图 base64 data URL 体积大，直接存入 Redis 任务记录极易超 1MB 限制。
// 方案：压缩后的 data URL 写入本地 IndexedDB，消息仅存轻量元数据 referenceMeta（refId + name），
//       发送任务时 data URL 仅进入 task.options，不再塞进任务记录本体。

const DB_NAME = 'ref-image-store';
const STORE_NAME = 'ref-images';
// 本地参考图总量上限 30MB（按 dataUrl.length 近似体积统计）
export const REF_IMAGE_STORE_MAX_BYTES = 30 * 1024 * 1024;
// 清理后保留到上限的 80%，留出余量避免频繁清理
const CLEANUP_TARGET_RATIO = 0.8;

// IndexedDB 不可用（隐私模式/老浏览器）时的内存兜底，仅本次会话有效
const memoryFallback = new Map(); // refId -> { refId, name, dataUrl, createdAt }

let dbPromise = null;

function getDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'refId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

// 读取全部记录；IndexedDB 不可用时降级读取内存兜底
async function readAllRecords() {
  const db = await getDb();
  if (db) {
    try {
      const records = await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      return records;
    } catch {
      // 读取失败时降级到内存兜底
    }
  }
  return Array.from(memoryFallback.values());
}

/**
 * 写入参考图记录，写入后触发总量清理（超限时按 createdAt 从旧到新删除）。
 * @param {string} refId 参考图唯一标识
 * @param {object} data { name, dataUrl }
 */
export async function saveRefImage(refId, { name, dataUrl }) {
  if (!refId || !dataUrl) return;
  const record = { refId, name: name || '', dataUrl, createdAt: Date.now() };
  let saved = false;
  const db = await getDb();
  if (db) {
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      saved = true;
    } catch {
      // 写入失败时降级到内存兜底
    }
  }
  if (!saved) {
    memoryFallback.set(refId, record);
  }
  await cleanupIfNeeded();
}

/**
 * 返回单条记录；不存在时返回 null，不抛错。
 * @param {string} refId
 */
export async function getRefImage(refId) {
  if (!refId) return null;
  const db = await getDb();
  if (db) {
    try {
      const record = await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(refId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      return record || null;
    } catch {
      // 读取失败时降级到内存兜底
    }
  }
  return memoryFallback.get(refId) || null;
}

/**
 * 按 refId 顺序批量读取，自动过滤不存在的项。
 * @param {string[]} refIds
 * @returns {Promise<Array<{refId, name, dataUrl, createdAt}>>}
 */
export async function getRefImages(refIds) {
  const ids = (refIds || []).filter(Boolean);
  const results = [];
  for (const refId of ids) {
    const record = await getRefImage(refId);
    if (record) results.push(record);
  }
  return results;
}

/** 删除单条参考图记录（静默失败，不影响主流程）。 */
export async function deleteRefImage(refId) {
  if (!refId) return;
  memoryFallback.delete(refId);
  const db = await getDb();
  if (!db) return;
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(refId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // 删除失败静默处理
  }
}

/** 批量删除参考图记录（静默失败，不影响主流程）。 */
export async function deleteRefImages(refIds) {
  const ids = (refIds || []).filter(Boolean);
  if (ids.length === 0) return;
  for (const refId of ids) memoryFallback.delete(refId);
  const db = await getDb();
  if (!db) return;
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      for (const refId of ids) store.delete(refId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // 删除失败静默处理
  }
}

/** 返回所有 refId 数组。 */
export async function listRefImageRefIds() {
  const records = await readAllRecords();
  return records.map((record) => record.refId).filter(Boolean);
}

// 每次 save 后统计所有记录 dataUrl 的 base64 长度，超过上限则按 createdAt 从旧到新删除，
// 直到总长度低于上限的 80%（保留余量），避免频繁清理。
async function cleanupIfNeeded() {
  try {
    const records = await readAllRecords();
    const totalBytes = records.reduce((sum, record) => sum + (record.dataUrl?.length || 0), 0);
    if (totalBytes <= REF_IMAGE_STORE_MAX_BYTES) return;
    const targetBytes = REF_IMAGE_STORE_MAX_BYTES * CLEANUP_TARGET_RATIO;
    const sorted = records.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const toRemove = [];
    let currentBytes = totalBytes;
    for (const record of sorted) {
      if (currentBytes <= targetBytes) break;
      currentBytes -= record.dataUrl?.length || 0;
      toRemove.push(record.refId);
    }
    await deleteRefImages(toRemove);
  } catch {
    // 清理失败不影响主流程
  }
}
