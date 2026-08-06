import { useCallback, useEffect, useRef, useState } from 'react';
import { generateImageBatch, pollDrawTask } from '../lib/stream.js';
import {
  createId, createDrawConversation, getTextParts, resolveDrawDurationSeconds,
} from '../lib/utils.js';
import { fetchBalance } from '../lib/auth.js';
import { DRAW_MAX_IMAGES, DRAW_MIN_BATCH_COUNT, DRAW_MAX_BATCH_COUNT, COST_DRAW } from '../lib/constants.js';

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

  const _executeDraw = useCallback(async ({ prompt, referenceImages, targetConvId, model, size, quality, imageCount = 1 }) => {
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
    const userMessage = {
      id: createId(), role: 'user', content: prompt,
      referenceImage: referenceImages[0] || null,
      referenceImages: referenceImages.length > 0 ? referenceImages : null,
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
  }, [authState, balance, drawImageCount, settings, markCloudDirty, updateDrawConversation, enforceDrawLimit, setErrorText, setStatusText, setRechargeDialogOpen, setBalance]);

  const handleDraw = useCallback(async () => {
    const prompt = drawPrompt.trim();
    if (!prompt || drawSubmissionRef.current || drawConvLoading || !activeDrawConversation?.messagesLoaded || authState !== 'authenticated') return;
    const referenceImages = drawPendingImages.map((img) => img.url).filter(Boolean);
    const imageCount = Math.min(DRAW_MAX_BATCH_COUNT, Math.max(DRAW_MIN_BATCH_COUNT, Number(settings.drawImageCount) || 1));
    await _executeDraw({
      prompt, referenceImages,
      targetConvId: activeDrawConversationId,
      model: settings.drawModel || 'gpt-image-2',
      size: settings.drawSize || '1024x1024',
      quality: settings.drawQuality || 'medium',
      imageCount,
    });
  }, [drawPrompt, drawConvLoading, activeDrawConversation, authState, drawPendingImages, settings, activeDrawConversationId, _executeDraw]);

  const retryDraw = useCallback(async (userMessageId) => {
    const conv = drawConversationsRef.current.find((c) => c.id === activeDrawConversationId);
    if (!conv || !conv.messages) return;
    const userMsg = conv.messages.find((m) => m.id === userMessageId);
    if (!userMsg) return;
    const referenceImages = Array.isArray(userMsg.referenceImages) && userMsg.referenceImages.length > 0
      ? userMsg.referenceImages
      : userMsg.referenceImage ? [userMsg.referenceImage] : [];
    await _executeDraw({
      prompt: getTextParts(userMsg.content),
      referenceImages,
      targetConvId: conv.id,
      model: userMsg.model || settings.drawModel || 'gpt-image-2',
      size: userMsg.size || settings.drawSize || '1024x1024',
      quality: userMsg.quality || settings.drawQuality || 'medium',
      imageCount: userMsg.imageCount || 1,
    });
  }, [activeDrawConversationId, settings, _executeDraw]);

  const editDrawMessage = useCallback((userMessageId) => {
    const conv = drawConversationsRef.current.find((c) => c.id === activeDrawConversationId);
    if (!conv || !conv.messages) return;
    const userMsg = conv.messages.find((m) => m.id === userMessageId);
    if (!userMsg) return;
    setDrawPrompt(getTextParts(userMsg.content));
    const referenceImages = Array.isArray(userMsg.referenceImages) && userMsg.referenceImages.length > 0
      ? userMsg.referenceImages
      : userMsg.referenceImage ? [userMsg.referenceImage] : [];
    setDrawPendingImages(referenceImages.map((url, i) => ({ name: `参考图${i + 1}`, url })));
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
  }, [authState, drawConversations, settings, updateDrawConversation]);

  return {
    isDrawSubmitting,
    handleDraw,
    retryDraw,
    editDrawMessage,
    downloadImage,
  };
}
