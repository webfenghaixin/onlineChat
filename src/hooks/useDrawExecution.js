import { useCallback, useEffect, useRef, useState } from 'react';
import { generateImageBatch, pollDrawTask } from '../lib/stream.js';
import {
  createId, createDrawConversation, getTextParts, resolveDrawDurationSeconds,
} from '../lib/utils.js';
import { fetchBalance } from '../lib/auth.js';
import {
  DRAW_MAX_IMAGES, DRAW_MIN_BATCH_COUNT, DRAW_MAX_BATCH_COUNT, COST_DRAW,
  DRAW_REFERENCE_TOTAL_BYTES_LIMIT,
} from '../lib/constants.js';
import { getRefImages } from '../lib/ref-image-store.js';
import { recompressImages, recompressDataUrls } from '../lib/image-utils.js';

/**
 * 制图任务提交、执行、轮询恢复（从 useDrawActions 拆分）
 * 自包含执行相关 state/refs/useEffect
 */
export function useDrawExecution({
  settings,
  authState,
  balance,
  markCloudDirty,
  drawConversations,
  drawConversationsRef,
  activeDrawConversationId,
  activeDrawConversationIdRef,
  activeDrawConversation,
  drawConvLoading,
  drawPrompt,
  drawPendingImages,
  drawImageCount,
  updateDrawConversation,
  enforceDrawLimit,
  refreshDrawConversationMessages,
  setErrorText,
  setStatusText,
  setRechargeDialogOpen,
  setBalance,
  setDrawLimitWarning,
  setDrawPrompt,
  setDrawPendingImages,
  setDrawConversations,
  setActiveDrawConversationId,
}) {
  const [isDrawSubmitting, setIsDrawSubmitting] = useState(false);
  const drawSubmissionRef = useRef(null);
  const drawTaskControllersRef = useRef(new Map());
  const activeDrawTaskIdsRef = useRef(new Set());
  const resumedDrawTasksRef = useRef(new Set());

  const _executeDraw = useCallback(async ({ prompt, referenceImages, referenceMeta, targetConvId, model, size, quality, imageCount = 1, preWarning }) => {
    if (!prompt || drawSubmissionRef.current || authState !== 'authenticated') return;
    const requestedCount = Math.min(DRAW_MAX_BATCH_COUNT, Math.max(DRAW_MIN_BATCH_COUNT, Number(imageCount) || 1));
    const totalCost = Number((COST_DRAW * requestedCount).toFixed(2));
    if (balance !== null && balance < totalCost - 0.0001) {
      setErrorText(`余额不足，生成 ${requestedCount} 张图需要 ${totalCost.toFixed(2)} 元，当前余额 ${balance.toFixed(2)} 元`);
      setRechargeDialogOpen(true);
      return;
    }
    const submissionId = createId();
    drawSubmissionRef.current = submissionId;
    setIsDrawSubmitting(true);
    const releaseSubmission = () => {
      if (drawSubmissionRef.current !== submissionId) return;
      drawSubmissionRef.current = null;
      setIsDrawSubmitting(false);
    };
    if (drawImageCount + requestedCount > DRAW_MAX_IMAGES) setDrawLimitWarning(true);
    setErrorText('');
    // 参考图部分不可用的警告在此回填，避免被上面的清空逻辑覆盖
    if (preWarning) setErrorText(preWarning);
    setStatusText('正在提交图片任务');
    if (!targetConvId || !drawConversationsRef.current.find((c) => c.id === targetConvId)) {
      const conv = createDrawConversation();
      markCloudDirty({ drawConversationId: conv.id });
      setDrawConversations((prev) => [conv, ...prev]);
      setActiveDrawConversationId(conv.id);
      targetConvId = conv.id;
    }
    const now = Date.now();
    const batchId = createId();
    // 消息仅存轻量元数据 referenceMeta（refId + name），data URL 已写入本地 ref-image-store，
    // 避免大体积 base64 进入 Redis 任务记录；referenceImageCount 保留作为兼容字段。
    // 优先用调用方传入的 referenceMeta（"再次生成"/重试复用原消息 refId），
    // 否则从 drawPendingImages 派生（正常发送场景）。
    const derivedMeta = (Array.isArray(drawPendingImages) ? drawPendingImages : [])
      .filter((img) => img.uploadState !== 'failed' && img.refId)
      .map((img) => ({ refId: img.refId, name: img.name }));
    const referenceMetaArray = referenceMeta || derivedMeta;
    const userMessage = {
      id: createId(), role: 'user', content: prompt,
      referenceMeta: referenceMetaArray.length > 0 ? referenceMetaArray : null,
      referenceImageCount: referenceMetaArray.length,
      model, size, quality, batchId, imageCount: requestedCount, createdAt: now,
    };
    const assistantMessages = Array.from({ length: requestedCount }, (_, index) => ({
      id: createId(), role: 'assistant', imageUrl: null, prompt, model, size, quality,
      batchId, batchIndex: index, imageCount: requestedCount, pending: true, createdAt: now + index + 1,
    }));
    updateDrawConversation(targetConvId, (conv) => ({
      ...conv,
      title: (conv.messages || []).length === 0 ? prompt.slice(0, 18) : conv.title,
      messages: [...(conv.messages || []), userMessage, ...assistantMessages],
    }));
    setDrawPrompt('');
    setDrawPendingImages([]);
    const activeConv = drawConversationsRef.current.find((c) => c.id === targetConvId);
    const batchController = new AbortController();
    const taskIdToMessageId = new Map();
    let startedTaskCount = 0;
    try {
      const results = await generateImageBatch({
        settings, prompt, referenceImages, size, quality, count: requestedCount,
        signal: batchController.signal,
        taskMetadata: {
          conversationId: targetConvId,
          conversationTitle: activeConv?.id === targetConvId ? activeConv.title : prompt.slice(0, 18),
          activeDrawConversationId: targetConvId,
          userMessage, assistantMessages,
        },
        onTasksCreated: () => { releaseSubmission(); },
        onTaskStart: (taskId, messageId) => {
          startedTaskCount += 1;
          taskIdToMessageId.set(taskId, messageId);
          activeDrawTaskIdsRef.current.add(taskId);
          drawTaskControllersRef.current.set(messageId, batchController);
          updateDrawConversation(targetConvId, (conv) => ({
            ...conv,
            messages: (conv.messages || []).map((message) =>
              message.id === messageId ? { ...message, taskId, pending: true } : message,
            ),
          }));
          setStatusText(`已提交 ${startedTaskCount}/${requestedCount} 个图片任务`);
        },
        onImage: (imageUrl, taskTiming, taskId) => {
          const messageId = taskIdToMessageId.get(taskId);
          if (!messageId) return;
          const durationSeconds = resolveDrawDurationSeconds(taskTiming, now);
          updateDrawConversation(targetConvId, (conv) => ({
            ...conv,
            messages: (conv.messages || []).map((message) =>
              message.id === messageId
                ? { ...message, imageUrl, durationSeconds, error: undefined, pending: false }
                : message,
            ),
          }));
          enforceDrawLimit();
        },
      });
      const successCount = results.filter((r) => r.ok).length;
      const failedResults = results.filter((r) => !r.ok);
      for (const result of failedResults) {
        updateDrawConversation(targetConvId, (conv) => ({
          ...conv,
          messages: (conv.messages || []).map((message) =>
            message.id === result.messageId
              ? { ...message, error: result.error, pending: false }
              : message,
          ),
        }));
      }
      if (successCount === requestedCount) {
        setStatusText(`${requestedCount} 张图片生成完成`);
      } else if (successCount > 0) {
        setStatusText(`已完成 ${successCount}/${requestedCount} 张图片`);
        setErrorText(`有 ${failedResults.length} 张图片生成失败，可在结果中查看。`);
      } else if (failedResults.length > 0) {
        setStatusText('图片生成失败');
        setErrorText(failedResults[0].error);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        setStatusText('图片生成已暂停');
      } else if (error instanceof TypeError) {
        setStatusText('网络中断，任务在后端继续执行');
      } else {
        const nextErrorText = error.message || '图片生成失败，请重试。';
        updateDrawConversation(targetConvId, (conv) => ({
          ...conv,
          messages: (conv.messages || []).map((message) =>
            message.batchId === batchId && message.role === 'assistant' && !message.imageUrl
              ? { ...message, error: nextErrorText, pending: false }
              : message,
          ),
        }));
        if (error.code === 'INSUFFICIENT_BALANCE' || error.status === 402) {
          setRechargeDialogOpen(true);
        }
        setStatusText('图片生成失败');
        setErrorText(nextErrorText);
      }
    } finally {
      releaseSubmission();
      try { const r = await fetchBalance(); setBalance(r.balance); } catch {}
      for (const messageId of taskIdToMessageId.values()) {
        if (drawTaskControllersRef.current.get(messageId) === batchController) {
          drawTaskControllersRef.current.delete(messageId);
        }
      }
      for (const taskId of taskIdToMessageId.keys()) {
        activeDrawTaskIdsRef.current.delete(taskId);
      }
    }
  }, [authState, balance, drawImageCount, drawPendingImages, settings, markCloudDirty, updateDrawConversation, enforceDrawLimit, setErrorText, setStatusText, setRechargeDialogOpen, setBalance]);

  const handleDraw = useCallback(async () => {
    const prompt = drawPrompt.trim();
    if (!prompt || drawSubmissionRef.current || drawConvLoading || !activeDrawConversation?.messagesLoaded || authState !== 'authenticated') return;

    const pendingList = Array.isArray(drawPendingImages) ? drawPendingImages : [];
    // 参考图压缩为异步任务，若仍有 processing 项直接提示稍候再发送（不再 await 压缩 promise）
    const processingCount = pendingList.filter((img) => img.uploadState === 'processing').length;
    if (processingCount > 0) {
      setStatusText(`参考图处理中 ${processingCount} 张，请稍候...`);
      return;
    }

    // 可发送项：跳过选图阶段失败的项。
    // 含原始 file 的项（新选图）可用 file 重压；无 file 但有 data URL 的项（编辑恢复）用 data URL 重压。
    const readyItems = pendingList.filter((img) => img.uploadState !== 'failed' && img.url && img.url.startsWith('data:'));
    const itemsWithFile = readyItems.filter((img) => img.file);
    const itemsWithoutFile = readyItems.filter((img) => !img.file);

    let referenceImages = [];
    let recompressFailedCount = 0;
    if (readyItems.length > 1) {
      // 多图：按最终图片数量动态重压（单张质量档位随数量降低、总量守恒不超 Redis 0.75MB）
      setStatusText('正在按图片数量调整参考图质量...');
      const withFileResults = itemsWithFile.length > 0
        ? await recompressImages(itemsWithFile.map((img) => ({ file: img.file, name: img.name })), readyItems.length, 'draw')
        : [];
      const withoutFileResults = itemsWithoutFile.length > 0
        ? await recompressDataUrls(itemsWithoutFile.map((img) => img.url), readyItems.length, 'draw')
        : [];
      // 按 readyItems 原始顺序回填（file / data 两组各自按序取），保持用户选择的参考图顺序
      let fileIndex = 0;
      let dataIndex = 0;
      const orderedUrls = [];
      for (const img of readyItems) {
        const item = img.file ? withFileResults[fileIndex++] : withoutFileResults[dataIndex++];
        if (item?.url) {
          orderedUrls.push(item.url);
        } else {
          recompressFailedCount += 1;
        }
      }
      referenceImages = orderedUrls;
    } else if (readyItems.length === 1) {
      // 单图（count === 1）：选图阶段已按"1 张档"最高质量压缩，直接使用已有 data URL，无需重压
      referenceImages = [readyItems[0].url];
    }

    // 总量校验：data URL 的 base64 长度总和不能超过限制，避免撑爆后端 Redis 任务记录（0.75MB）
    const totalRefBytes = referenceImages.reduce((sum, url) => sum + url.length, 0);
    if (totalRefBytes > DRAW_REFERENCE_TOTAL_BYTES_LIMIT) {
      setErrorText('参考图体积过大，请减少张数或更换图片。');
      return;
    }

    // 参考图可用性汇总：部分不可用 → 经 preWarning 在 _executeDraw 里回显；
    // 有参考图意图却一张都没用上 → 阻止发送，避免无参考图生成出非预期结果。
    const intentCount = pendingList.filter((img) => img.uploadState !== 'failed').length;
    const droppedUnusable = intentCount - readyItems.length;
    const failedCount = pendingList.filter((img) => img.uploadState === 'failed').length;
    const totalUnusable = recompressFailedCount + droppedUnusable;
    let preWarning = '';
    if (pendingList.length > 0 && referenceImages.length === 0) {
      setErrorText('参考图全部无法使用，请重新添加参考图后再发送。');
      return;
    }
    if (totalUnusable > 0 || failedCount > 0) {
      const parts = [];
      if (totalUnusable > 0) parts.push(`${totalUnusable} 张参考图无法使用已跳过`);
      if (failedCount > 0) parts.push(`${failedCount} 张参考图处理失败已跳过`);
      preWarning = `${parts.join('，')}，将使用其余 ${referenceImages.length} 张参考图生成。`;
    }

    const imageCount = Math.min(DRAW_MAX_BATCH_COUNT, Math.max(DRAW_MIN_BATCH_COUNT, Number(settings.drawImageCount) || 1));
    await _executeDraw({
      prompt, referenceImages,
      preWarning,
      targetConvId: activeDrawConversationId,
      model: settings.drawModel || 'gpt-image-2',
      size: settings.drawSize || '1024x1024',
      quality: settings.drawQuality || 'medium',
      imageCount,
    });
  }, [drawPrompt, drawConvLoading, activeDrawConversation, authState, drawPendingImages, settings, activeDrawConversationId, _executeDraw, setStatusText, setErrorText]);

  const retryDraw = useCallback(async (userMessageId) => {
    const conv = drawConversationsRef.current.find((c) => c.id === activeDrawConversationId);
    if (!conv || !conv.messages) return;
    const userMsg = conv.messages.find((m) => m.id === userMessageId);
    if (!userMsg) return;

    // 恢复参考图元数据（refId + name），供重试消息历史回显；本地无图时仍保留 meta（占位显示）
    const metaList = Array.isArray(userMsg.referenceMeta)
      ? userMsg.referenceMeta.filter((meta) => meta?.refId)
      : [];
    // 原消息是否携带参考图：用于"全部无法使用"时阻止重试，避免无参考图重试
    const hadRefs = metaList.length > 0
      || (Array.isArray(userMsg.referenceImages) && userMsg.referenceImages.length > 0)
      || Boolean(userMsg.referenceImage);

    let referenceImages = [];
    let preWarning = '';
    // 新数据：从 referenceMeta（refId 列表）恢复本地 ref-image-store 中的 data URL；
    // 恢复的是选图阶段"1 张档"最高质量版本，多张重试时需按最终数量动态重压 + 总量校验，
    // 避免 data URL 总量超过 Redis 1MB 限制导致任务创建失败（参考图丢失）。
    if (metaList.length > 0) {
      const records = await getRefImages(metaList.map((meta) => meta.refId));
      referenceImages = records.map((record) => record.dataUrl).filter(Boolean);
      if (referenceImages.length < metaList.length) {
        preWarning = `部分原参考图仅当前设备可见且已被清理，已使用剩余 ${referenceImages.length} 张参考图重试。`;
      }
    }
    // 兼容旧数据：referenceImages（blob URL）/ referenceImage 单图
    if (referenceImages.length === 0) {
      referenceImages = Array.isArray(userMsg.referenceImages) && userMsg.referenceImages.length > 0
        ? userMsg.referenceImages
        : userMsg.referenceImage ? [userMsg.referenceImage] : [];
    }

    // 原消息有参考图但一张都恢复不了（本地已清理/失效）→ 阻止重试，提示走"再次生成"重新添加
    if (hadRefs && referenceImages.length === 0) {
      setErrorText('原参考图无法使用（本地已清理或已失效），请点击"再次生成"重新添加参考图后重试。');
      return;
    }

    // 多张本地 data URL 时按最终数量动态重压（1 张档最高质量 → 数量档），并做总量校验
    if (referenceImages.length > 1 && referenceImages.every((url) => url.startsWith('data:'))) {
      setStatusText('正在按图片数量调整参考图质量...');
      const recompressed = await recompressDataUrls(referenceImages, referenceImages.length, 'draw');
      referenceImages = recompressed.filter((item) => item.url).map((item) => item.url);
      const failedCount = recompressed.length - referenceImages.length;
      if (failedCount > 0) {
        preWarning = `${failedCount} 张参考图压缩调整失败已跳过，将使用其余参考图重试。`;
      }
      if (hadRefs && referenceImages.length === 0) {
        setErrorText('参考图全部无法使用，请点击"再次生成"重新添加参考图后重试。');
        return;
      }
    }
    const totalRefBytes = referenceImages.reduce((sum, url) => sum + url.length, 0);
    if (totalRefBytes > DRAW_REFERENCE_TOTAL_BYTES_LIMIT) {
      setErrorText('参考图体积过大，请编辑消息重新添加参考图后再试。');
      return;
    }

    await _executeDraw({
      prompt: getTextParts(userMsg.content),
      referenceImages,
      referenceMeta: metaList.length > 0 ? metaList : null,
      preWarning,
      targetConvId: conv.id,
      model: userMsg.model || settings.drawModel || 'gpt-image-2',
      size: userMsg.size || settings.drawSize || '1024x1024',
      quality: userMsg.quality || settings.drawQuality || 'medium',
      imageCount: userMsg.imageCount || 1,
    });
  }, [activeDrawConversationId, settings, _executeDraw, setErrorText]);

  const editDrawMessage = useCallback(async (userMessageId) => {
    const conv = drawConversationsRef.current.find((c) => c.id === activeDrawConversationId);
    if (!conv || !conv.messages) return;
    const userMsg = conv.messages.find((m) => m.id === userMessageId);
    if (!userMsg) return;
    setDrawPrompt(getTextParts(userMsg.content));
    const restoredItems = [];
    // 新数据：解析 referenceMeta → 从本地存储恢复为 { refId, name, url: dataUrl, uploadState: 'done' }；
    // 本地无图的项跳过（数据仅存于当前设备，已被清理或换设备时不可见）。
    if (Array.isArray(userMsg.referenceMeta) && userMsg.referenceMeta.length > 0) {
      const metaList = userMsg.referenceMeta.filter((meta) => meta?.refId);
      const records = await getRefImages(metaList.map((meta) => meta.refId));
      const recordByRefId = new Map(records.map((record) => [record.refId, record]));
      metaList.forEach((meta, index) => {
        const record = recordByRefId.get(meta.refId);
        if (record) {
          restoredItems.push({
            refId: meta.refId,
            name: meta.name || `参考图${index + 1}`,
            url: record.dataUrl,
            localUrl: meta.refId,
            uploadState: 'done',
          });
        }
      });
      // 本地 store 缺图时明确提示，避免用户误以为参考图全部恢复
      if (restoredItems.length < metaList.length) {
        setErrorText(`${metaList.length - restoredItems.length} 张参考图在当前设备不可用（已被清理或原设备数据），已恢复其余 ${restoredItems.length} 张。`);
      }
    }
    // 兼容旧数据：referenceImages（blob URL）/ referenceImage 单图
    if (restoredItems.length === 0) {
      const referenceImages = Array.isArray(userMsg.referenceImages) && userMsg.referenceImages.length > 0
        ? userMsg.referenceImages
        : userMsg.referenceImage ? [userMsg.referenceImage] : [];
      restoredItems.push(...referenceImages.map((url, i) => ({
        name: `参考图${i + 1}`, url, localUrl: url, uploadState: 'done',
      })));
    }
    setDrawPendingImages(restoredItems);
  }, [activeDrawConversationId, setDrawPrompt, setDrawPendingImages]);

  const downloadImage = useCallback(async (imageUrl, prompt) => {
    const fileName = `draw_${prompt.slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${Date.now()}.png`;
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: blob.type || 'image/png' });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: '保存图片', text: '请选择"保存图片"或"存储到相册"。' });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.alert('已触发下载。如果手机没有自动保存到相册，请在下载记录中打开图片并保存到相册。');
    } catch {
      window.open(imageUrl, '_blank');
      window.alert('已打开图片，请长按图片选择"保存到相册"。');
    }
  }, []);

  // abort 清理
  useEffect(() => {
    return () => {
      for (const controller of drawTaskControllersRef.current.values()) {
        controller.abort();
      }
      drawTaskControllersRef.current.clear();
    };
  }, []);

  // 页面切回时刷新
  useEffect(() => {
    if (authState !== 'authenticated') return undefined;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      for (const controller of drawTaskControllersRef.current.values()) controller.abort();
      drawTaskControllersRef.current.clear();
      activeDrawTaskIdsRef.current.clear();
      resumedDrawTasksRef.current.clear();
      const activeConvId = activeDrawConversationIdRef.current;
      if (activeConvId) refreshDrawConversationMessages(activeConvId);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [authState, refreshDrawConversationMessages]);

  // 恢复 pending 任务
  useEffect(() => {
    if (authState !== 'authenticated') return undefined;
    const PENDING_TIMEOUT_MS = 5 * 60 * 1000;
    const now = Date.now();
    const pendingTasks = [];
    for (const conversation of drawConversations) {
      if (!conversation.messages || conversation.messages.length === 0) continue;
      for (const message of conversation.messages) {
        if (message.role === 'assistant' && message.taskId && !message.imageUrl && !message.error
          && !activeDrawTaskIdsRef.current.has(message.taskId)
          && !resumedDrawTasksRef.current.has(message.taskId)) {
          // 超过 5 分钟的 pending 任务直接标记为超时失败，不再恢复轮询
          if (typeof message.createdAt === 'number' && now - message.createdAt > PENDING_TIMEOUT_MS) {
            const timeoutConversationId = conversation.id;
            const timeoutMessageId = message.id;
            updateDrawConversation(timeoutConversationId, (conv) => ({
              ...conv,
              messages: (conv.messages || []).map((m) =>
                m.id === timeoutMessageId
                  ? { ...m, pending: false, error: '图片生成超时（已超过 5 分钟），请重试。' }
                  : m,
              ),
            }));
            continue;
          }
          pendingTasks.push({ conversationId: conversation.id, messageId: message.id, taskId: message.taskId, createdAt: message.createdAt });
        }
      }
    }
    if (!pendingTasks.length) return undefined;
    setStatusText(`已恢复 ${pendingTasks.length} 个制图任务，正在等待生成结果...`);
    pendingTasks.forEach((task) => {
      resumedDrawTasksRef.current.add(task.taskId);
      activeDrawTaskIdsRef.current.add(task.taskId);
      const controller = new AbortController();
      drawTaskControllersRef.current.set(task.messageId, controller);
      pollDrawTask({
        settings, taskId: task.taskId, startedAt: Date.now(), signal: controller.signal,
        onImage: (imageUrl, taskTiming) => {
          const durationSeconds = resolveDrawDurationSeconds(taskTiming, task.createdAt);
          updateDrawConversation(task.conversationId, (conv) => ({
            ...conv,
            messages: (conv.messages || []).map((m) =>
              m.id === task.messageId ? { ...m, imageUrl, error: undefined, pending: false, durationSeconds } : m,
            ),
          }));
        },
      }).catch((error) => {
        if (error.name === 'AbortError') return;
        updateDrawConversation(task.conversationId, (conv) => ({
          ...conv,
          messages: (conv.messages || []).map((m) =>
            m.id === task.messageId ? { ...m, error: error.message || '图片生成失败，请稍后重试。', pending: false } : m,
          ),
        }));
      }).finally(() => {
        if (drawTaskControllersRef.current.get(task.messageId) === controller) {
          drawTaskControllersRef.current.delete(task.messageId);
        }
        activeDrawTaskIdsRef.current.delete(task.taskId);
      });
    });
    return undefined;
  }, [authState, drawConversations, settings, updateDrawConversation, setStatusText]);

  return {
    isDrawSubmitting,
    handleDraw,
    retryDraw,
    editDrawMessage,
    downloadImage,
  };
}
