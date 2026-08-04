import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Collapse, Select, Divider, Loading, Tabs } from 'animal-island-ui';
import {
  classNames,
  formatTime,
  formatDateTime,
  formatDuration,
  getTextParts,
} from '../lib/utils';
import {
  DRAW_SIZE_OPTIONS,
  DRAW_QUALITY_OPTIONS,
  DRAW_API_MODE_OPTIONS,
  DRAW_MODEL_OPTIONS,
  DRAW_MAX_IMAGES,
  DRAW_MAX_REFERENCE_IMAGES,
  DRAW_MIN_BATCH_COUNT,
  DRAW_MAX_BATCH_COUNT,
} from '../lib/constants';
import ImagePreview from './ImagePreview';
import FullscreenEditor, { FullscreenIcon } from './FullscreenEditor';
import { prepareDrawReferenceImage } from '../lib/image-utils';
import ConfirmDialog from './ConfirmDialog';
import Scrollbar from './Scrollbar';
import BalanceBar from './BalanceBar';
import { COST_DRAW } from '../lib/constants';

export default function DrawPage({
  settings,
  setSettings,
  drawConversations,
  activeDrawConversationId,
  switchDrawConversation,
  activeDrawConversation,
  activeDrawMessages,
  drawImageCount,
  isGenerating,
  pendingDrawTaskCount,
  isDrawSubmitting,
  drawPrompt,
  setDrawPrompt,
  drawPendingImages,
  setDrawPendingImages,
  drawDrawerOpen,
  setDrawDrawerOpen,
  drawSelectMode,
  drawSelectedMessageIds,
  errorText,
  setErrorText,
  drawLimitWarning,
  setDrawLimitWarning,
  deleteDrawTarget,
  setDeleteDrawTarget,
  deleteDrawConversationTarget,
  setDeleteDrawConversationTarget,
  closeDrawMode,
  createNewDrawConversation,
  removeDrawConversation,
  handleDraw,
  downloadImage,
  requestDeleteDrawMessage,
  cancelDeleteDrawMessage,
  confirmDeleteDrawMessage,
  exitDrawSelectMode,
  enterDrawSelectMode,
  toggleDrawMessageSelection,
  selectAllDrawUserMessages,
  selectAllDrawAssistantMessages,
  deleteSelectedDrawMessages,
  drawFileInputRef,
  authState,
  balance,
  onRecharge,
  drawConvLoading,
  retryDraw,
  editDrawMessage,
}) {
  const [previewImages, setPreviewImages] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [drawImageProcessing, setDrawImageProcessing] = useState(false);

  const generatedDrawGallery = useMemo(
    () => activeDrawMessages
      .filter((message) => message.role === 'assistant' && message.imageUrl)
      .map((message) => ({ id: message.id, url: message.imageUrl })),
    [activeDrawMessages],
  );

  const openPreview = useCallback((images, index = 0) => {
    const list = Array.isArray(images) ? images.filter(Boolean) : images ? [images] : [];
    if (list.length === 0) return;
    setPreviewImages(list);
    setPreviewIndex(index);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewImages(null);
    setPreviewIndex(0);
  }, []);

  const openGeneratedImagePreview = useCallback((messageId) => {
    const imageIndex = generatedDrawGallery.findIndex((image) => image.id === messageId);
    if (imageIndex < 0) return;
    openPreview(generatedDrawGallery.map((image) => image.url), imageIndex);
  }, [generatedDrawGallery, openPreview]);
  const [copiedId, setCopiedId] = useState(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [composerFabVisible, setComposerFabVisible] = useState(false);
  const [drawDrawerTab, setDrawDrawerTab] = useState('history');
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const messageListRef = useRef(null);
  const programmaticScrollRef = useRef(false);
  const atBottomRef = useRef(true);
  const userExpandedRef = useRef(false);
  const userCollapsedRef = useRef(false);
  // 用户手动收起后，必须先把列表滚离底部，回到底部时才自动展开，避免收起瞬间被滚动事件弹回
  const collapsedLeftBottomRef = useRef(false);
  const keyboardVisibleRef = useRef(false);
  const collapseDebounceRef = useRef(0);
  const drawImageProcessingRef = useRef(false);
  const composerPanelRef = useRef(null);

  const removeDrawPendingImage = useCallback((index) => {
    setDrawPendingImages((prev) => (prev || []).filter((_, itemIndex) => itemIndex !== index));
  }, [setDrawPendingImages]);

  const processDrawReferenceFiles = useCallback(async (files) => {
    if (drawImageProcessingRef.current) {
      setErrorText('参考图正在处理中，请稍候。');
      return;
    }

    const normalizedFiles = Array.from(files || []);
    if (normalizedFiles.length === 0) return;

    const imageFiles = normalizedFiles.filter((file) => file?.type?.startsWith('image/'));
    if (imageFiles.length === 0) {
      setErrorText('只能上传图片文件。');
      return;
    }

    const currentCount = Array.isArray(drawPendingImages) ? drawPendingImages.length : 0;
    const remainingSlots = DRAW_MAX_REFERENCE_IMAGES - currentCount;
    if (remainingSlots <= 0) {
      setErrorText(`最多只能上传 ${DRAW_MAX_REFERENCE_IMAGES} 张参考图。`);
      return;
    }

    const filesToProcess = imageFiles.slice(0, remainingSlots);
    if (imageFiles.length > remainingSlots) {
      setErrorText(`最多只能上传 ${DRAW_MAX_REFERENCE_IMAGES} 张参考图，已添加前 ${remainingSlots} 张。`);
    } else {
      setErrorText('');
    }

    drawImageProcessingRef.current = true;
    setDrawImageProcessing(true);
    try {
      const results = await Promise.all(
        filesToProcess.map(async (file) => {
          const optimizedImageUrl = await prepareDrawReferenceImage(file);
          return {
            name: file.name || `clipboard-image-${Date.now()}`,
            url: optimizedImageUrl,
          };
        }),
      );
      setDrawPendingImages((prev) => [...(prev || []), ...results]);
    } catch (error) {
      setErrorText(error.message || '参考图处理失败');
    } finally {
      drawImageProcessingRef.current = false;
      setDrawImageProcessing(false);
    }
  }, [drawPendingImages, setDrawPendingImages, setErrorText]);

  const handleDrawFileChange = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void processDrawReferenceFiles(files);
  }, [processDrawReferenceFiles]);

  const handleDrawPaste = useCallback((event) => {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const itemImages = Array.from(clipboardData.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    const fileImages = Array.from(clipboardData.files || [])
      .filter((file) => file?.type?.startsWith('image/'));
    const imageFiles = itemImages.length > 0 ? itemImages : fileImages;

    if (imageFiles.length === 0) return;
    event.preventDefault();
    void processDrawReferenceFiles(imageFiles);
  }, [processDrawReferenceFiles]);

  const checkIsAtBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // 带滞后阈值的滚动状态更新，避免边界反复横跳导致输入框闪烁
  // 进入底部需 distance < 40px（严格），离开底部需 distance > 半个屏幕（宽松）
  // 用户手动展开后锁定，直到滚回底部才恢复自动逻辑
  // 键盘弹出时禁止自动收起，状态切换后 300ms 防抖避开键盘收起动画抖动
  const updateScrollState = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const leaveThreshold = el.clientHeight * 0.5;

    if (userExpandedRef.current) {
      if (distance < 40) {
        userExpandedRef.current = false;
        atBottomRef.current = true;
        setComposerCollapsed(false);
      }
      setShowScrollToBottom(distance >= 40);
      return;
    }

    // 用户手动收起后，需先把列表滚离底部（distance > 半个屏幕）才解除锁定，
    // 滚回底部时自动展开；避免收起后 padding 变化触发的滚动事件瞬间弹回
    if (userCollapsedRef.current) {
      if (!collapsedLeftBottomRef.current && distance > leaveThreshold) {
        collapsedLeftBottomRef.current = true;
      }
      if (collapsedLeftBottomRef.current && distance < 40) {
        userCollapsedRef.current = false;
        collapsedLeftBottomRef.current = false;
        atBottomRef.current = true;
        setComposerCollapsed(false);
      }
      setShowScrollToBottom(distance >= 40);
      return;
    }

    let atBottom = atBottomRef.current;
    if (atBottom && distance > leaveThreshold) {
      atBottom = false;
    } else if (!atBottom && distance < 40) {
      atBottom = true;
    }

    // 键盘弹出时不自动收起输入框
    if (!atBottom && keyboardVisibleRef.current) {
      setShowScrollToBottom(distance >= 40);
      return;
    }

    // 状态切换后 300ms 内忽略 scroll 事件
    const now = Date.now();
    if (now - collapseDebounceRef.current < 300) {
      setShowScrollToBottom(distance >= 40);
      return;
    }

    const prevAtBottom = atBottomRef.current;
    atBottomRef.current = atBottom;
    if (prevAtBottom !== atBottom) {
      collapseDebounceRef.current = now;
    }
    setShowScrollToBottom(!atBottom);
    setComposerCollapsed(!atBottom);
  }, []);

  // 用户点击 FAB 手动展开输入框，锁定状态防止布局变化触发的 scroll 再次收起
  const expandComposer = useCallback(() => {
    userExpandedRef.current = true;
    userCollapsedRef.current = false;
    setComposerCollapsed(false);
  }, []);

  // 用户点击收起按钮，锁定收起状态，滚回底部时自动展开
  const collapseComposer = useCallback(() => {
    userCollapsedRef.current = true;
    userExpandedRef.current = false;
    collapsedLeftBottomRef.current = false;
    atBottomRef.current = false;
    setComposerCollapsed(true);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    userExpandedRef.current = false;
    userCollapsedRef.current = false;
    collapsedLeftBottomRef.current = false;
    atBottomRef.current = true;
    setShowScrollToBottom(false);
    setComposerCollapsed(false);
    const doScroll = () => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    doScroll();
    // 输入框展开会让底部 padding（--composer-height）变大，滚动目标后移；
    // 等布局稳定后重定向一次，确保平滑滚动朝真正的底部进行
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
    // 兜底：平滑滚动可能被输入框展开引起的布局变化打断，结束时精确校正到最底部
    window.setTimeout(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 4) {
        const prevBehavior = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        el.scrollTop = el.scrollHeight;
        el.style.scrollBehavior = prevBehavior;
      }
      programmaticScrollRef.current = false;
    }, 700);
  }, []);

  // FAB 可见性同步：收起时延迟显示（等 Composer 缩小动画），展开时立即隐藏
  useEffect(() => {
    if (composerCollapsed) {
      const timer = setTimeout(() => setComposerFabVisible(true), 180);
      return () => clearTimeout(timer);
    }
    setComposerFabVisible(false);
    return undefined;
  }, [composerCollapsed]);

  // 动态监听输入框高度，设置 CSS 变量 --composer-height 供消息列表 padding 使用
  // 输入框已脱离文档流（absolute），消息列表靠 padding-bottom 预留空间
  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return undefined;
    // 变量设置在父容器（message-list-wrapper）上，滚动到底按钮（兄弟元素）也能读取
    const host = list.parentElement || list;
    if (drawSelectMode) {
      host.style.setProperty('--composer-height', '0px');
      return undefined;
    }
    const panel = composerPanelRef.current;
    if (!panel) {
      host.style.setProperty('--composer-height', composerCollapsed ? '68px' : '80px');
      return undefined;
    }
    const apply = () => {
      const h = composerCollapsed ? 68 : panel.offsetHeight;
      host.style.setProperty('--composer-height', `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(panel);
    return () => ro.disconnect();
  }, [composerCollapsed, drawSelectMode]);

  // 监听键盘弹出状态（通过全局 --keyboard-offset CSS 变量同步）
  // 延迟到 rAF 再读取：useScrollCollapse 也在同一帧内更新该变量，需等它先写入
  useEffect(() => {
    let rafId = null;
    const checkKeyboard = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-offset') || '0');
        const visible = offset > 0;
        // 键盘刚弹出且正停留在底部时，底部 padding 会随 --keyboard-offset 增大，
        // 需自动滚到新底部，避免最后一条消息被键盘盖住
        if (visible && !keyboardVisibleRef.current && atBottomRef.current) {
          const el = messageListRef.current;
          if (el) {
            programmaticScrollRef.current = true;
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            window.setTimeout(() => { programmaticScrollRef.current = false; }, 500);
          }
        }
        keyboardVisibleRef.current = visible;
      });
    };
    checkKeyboard();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', checkKeyboard);
    vv?.addEventListener('scroll', checkKeyboard);
    window.addEventListener('focusin', checkKeyboard);
    window.addEventListener('focusout', checkKeyboard);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      vv?.removeEventListener('resize', checkKeyboard);
      vv?.removeEventListener('scroll', checkKeyboard);
      window.removeEventListener('focusin', checkKeyboard);
      window.removeEventListener('focusout', checkKeyboard);
    };
  }, []);

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      updateScrollState();
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateScrollState, activeDrawConversationId]);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      updateScrollState();
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeDrawMessages, isGenerating, updateScrollState]);

  const isPendingDrawMessage = (message) => (
    message.role === 'assistant' &&
    !message.imageUrl &&
    !message.error &&
    (message.pending || message.taskId)
  );
  const activePendingDrawTaskCount = activeDrawMessages.filter(isPendingDrawMessage).length;
  const hasPendingDrawTask = activePendingDrawTaskCount > 0;

  useEffect(() => {
    if (!hasPendingDrawTask && !isGenerating) return undefined;
    setCurrentTime(Date.now());
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasPendingDrawTask, isGenerating]);

  async function handleCopy(msg) {
    try {
      const textToCopy = msg.role === 'user'
        ? getTextParts(msg.content)
        : (msg.prompt || getTextParts(msg.content) || '');
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore clipboard errors in restricted webviews.
    }
  }

  const currentModelLabel = (() => {
    const opt = DRAW_MODEL_OPTIONS.find((o) => o.value === (settings.drawModel || 'gpt-image-2'));
    return opt?.disabled ? 'GPT-Image-2' : (opt?.label || 'GPT-Image-2');
  })();
  const currentSizeLabel =
    DRAW_SIZE_OPTIONS.find((opt) => opt.value === (settings.drawSize || '1024x1792'))?.label || '9:16 全屏';
  const currentImageCount = Math.min(
    DRAW_MAX_BATCH_COUNT,
    Math.max(DRAW_MIN_BATCH_COUNT, Number(settings.drawImageCount) || 1),
  );
  const drawCountOptions = Array.from({ length: DRAW_MAX_BATCH_COUNT }, (_, index) => ({
    key: String(index + 1),
    label: `${index + 1} 张`,
  }));

  const drawHistoryPane = (
    <div className="drawer-tab-content">
      <Button type="primary" block onClick={createNewDrawConversation}>
        新建画图
      </Button>
      <div className="drawer-history-list">
        {drawConversations
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((conv) => (
            <Card
              key={conv.id}
              className={classNames('drawer-history-card', conv.id === activeDrawConversationId && 'drawer-history-card-active')}
            >
              <button
                className="drawer-history-main"
                type="button"
                onClick={() => {
                  switchDrawConversation(conv.id);
                }}
              >
                <span className="drawer-history-title">{conv.title}</span>
                <span className="drawer-history-time">
                  {conv.imageCount || conv.messages.filter((m) => m.imageUrl).length} 张图 · {formatDateTime(conv.updatedAt)}
                </span>
              </button>
              <Button
                className="drawer-history-delete"
                type="text"
                size="small"
                danger
                onClick={() => setDeleteDrawConversationTarget(conv.id)}
              >
                删除
              </Button>
            </Card>
          ))}
      </div>
    </div>
  );

  const drawSettingsPane = (
    <div className="drawer-tab-content drawer-settings-form">
      <div className="drawer-field">
        <span className="drawer-field-label">字体大小</span>
        <Select
          value={settings.fontSize}
          onChange={(value) =>
            setSettings((current) => ({ ...current, fontSize: value }))
          }
          options={[
            { key: 'sm', label: '小' },
            { key: 'md', label: '中' },
            { key: 'lg', label: '大' },
          ]}
        />
      </div>
    </div>
  );

  const drawTabItems = [
    { key: 'history', label: '画图', children: drawHistoryPane },
    { key: 'settings', label: '设置', children: drawSettingsPane },
  ];

  return (
    <div className="draw-page">
      <aside className={classNames('drawer', drawDrawerOpen && 'drawer-open')}>
        <div className="drawer-header">
          <div className="drawer-title-wrap">
            <div className="drawer-title">lightDraw</div>
          </div>
          <Button type="text" size="small" onClick={() => setDrawDrawerOpen(false)}>
            关闭
          </Button>
        </div>
        <Divider type="wave-yellow" />
        <div className="drawer-tabs-wrap">
          <Tabs
            activeKey={drawDrawerTab}
            onChange={(key) => setDrawDrawerTab(key)}
            items={drawTabItems}
          />
        </div>
      </aside>

      {drawDrawerOpen && (
        <button
          className="drawer-backdrop"
          type="button"
          aria-label="关闭侧栏"
          onClick={() => setDrawDrawerOpen(false)}
        />
      )}

      <main className="phone-shell">
        <header className={classNames('chat-header', drawSelectMode ? 'chat-header-select' : 'chat-header-3col')}>
          {drawSelectMode ? (
            <>
              <Button type="text" size="small" onClick={exitDrawSelectMode}>
                取消
              </Button>
              <div className="chat-title">
                <h1>已选 {drawSelectedMessageIds.size} 条</h1>
              </div>
              <Button
                type="primary"
                danger
                size="small"
                onClick={deleteSelectedDrawMessages}
                disabled={drawSelectedMessageIds.size === 0}
                aria-label="删除"
              >
                删除
              </Button>
            </>
          ) : (
            <>
              <Button
                type="default"
                size="small"
                onClick={() => { setDrawDrawerTab('history'); setDrawDrawerOpen(true); }}
                aria-label="打开侧栏"
              >
                ☰
              </Button>

              <div className="chat-title">
                <h1>{activeDrawConversation?.title || 'AI 画图'}</h1>
                <p className="chat-title-status">
                  <span className={classNames('status-dot', isGenerating && 'status-dot-live')} />
                  {isGenerating
                    ? `${pendingDrawTaskCount} 个任务生成中`
                    : `已存 ${drawImageCount}/${DRAW_MAX_IMAGES} 张`}
                </p>
              </div>

              <Button
                type="default"
                size="small"
                onClick={closeDrawMode}
                aria-label="返回聊天"
              >
                返回
              </Button>
            </>
          )}
        </header>

        <BalanceBar
          balance={balance}
          cost={COST_DRAW}
          onRecharge={onRecharge}
        />

        <div className="message-list-wrapper">
          <section className="message-list" ref={messageListRef} aria-live="polite">
            {drawLimitWarning && (
              <div className="draw-limit-banner">
                已存满 {DRAW_MAX_IMAGES} 张图，新图片将自动替换最早的一张。
                <Button type="text" size="small" onClick={() => setDrawLimitWarning(false)}>
                  知道了
                </Button>
              </div>
            )}
            {errorText && <div className="error-banner">{errorText}</div>}

            {drawConvLoading && activeDrawMessages.length === 0 && (
              <div className="conv-loading-hint">
                <Loading active />
                <span>加载画图记录中...</span>
              </div>
            )}

            {!drawConvLoading && activeDrawConversation?.messages.length === 0 && !isGenerating && (
              <div className="draw-empty">
                <Card className="draw-empty-card" type="dashed" color="app-yellow">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19l7-7 3 3-7 7-3-3z" />
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                    <path d="M2 2l7.586 7.586" />
                    <circle cx="11" cy="11" r="2" />
                  </svg>
                  <p>输入描述，AI 为你生成图片</p>
                </Card>
              </div>
            )}

            {activeDrawConversation?.messages.map((msg, msgIndex) => {
              if (msg.role === 'user') {
                return (
                  <article
                    key={msg.id}
                    className={classNames(
                      'message-row',
                      'message-user',
                      drawSelectMode && 'message-row-selectable',
                      drawSelectMode && drawSelectedMessageIds.has(msg.id) && 'message-row-selected',
                    )}
                    onClick={drawSelectMode ? () => toggleDrawMessageSelection(msg.id) : undefined}
                  >
                    {drawSelectMode && (
                      <div className={classNames('message-checkbox', drawSelectedMessageIds.has(msg.id) && 'message-checkbox-checked')}>
                        {drawSelectedMessageIds.has(msg.id) ? (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3.5 8 6.5 11 12.5 5" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
                          </svg>
                        )}
                      </div>
                    )}
                    <div className="message-content-col">
                      <div className="message-meta">
                        <span>我</span>
                        <time>{formatTime(msg.createdAt)}</time>
                      </div>
                      <div className="message-bubble">
                        {(() => {
                          const refImgs = Array.isArray(msg.referenceImages) && msg.referenceImages.length > 0
                            ? msg.referenceImages
                            : msg.referenceImage ? [msg.referenceImage] : [];
                          if (refImgs.length === 0) return null;
                          return (
                            <div className="draw-ref-images">
                              {refImgs.map((url, i) => (
                                <img
                                  key={i}
                                  className="draw-ref-image draw-ref-image-clickable"
                                  src={url}
                                  alt={`参考图 ${i + 1}`}
                                  onClick={() => openPreview(refImgs, i)}
                                />
                              ))}
                            </div>
                          );
                        })()}
                        {getTextParts(msg.content)}
                        <span className="draw-msg-config">
                          {DRAW_MODEL_OPTIONS.find((o) => o.value === msg.model)?.label || msg.model || 'GPT-Image-2'}
                          {' · '}
                          {DRAW_SIZE_OPTIONS.find((o) => o.value === msg.size)?.label || msg.size}
                          {' · '}
                          {DRAW_QUALITY_OPTIONS.find((o) => o.value === msg.quality)?.label}
                          {' · '}
                          {Math.max(1, Number(msg.imageCount) || 1)} 张
                          {(() => {
                            const refCount = Array.isArray(msg.referenceImages) && msg.referenceImages.length > 0
                              ? msg.referenceImages.length
                              : msg.referenceImage ? 1 : 0;
                            return refCount > 0 ? ` · 图生图${refCount > 1 ? `(${refCount}张)` : ''}` : '';
                          })()}
                        </span>
                      </div>
                      {!drawSelectMode && (
                        <div className={classNames('message-tools', 'message-tools-user')}>
                          <Button
                            className="tool-button tool-button-user"
                            type="text"
                            size="small"
                            onClick={() => handleCopy(msg)}
                            aria-label="复制"
                          >
                            {copiedId === msg.id ? '已复制' : '复制'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              }

              if (msg.role === 'assistant' && (msg.imageUrl || msg.error || isPendingDrawMessage(msg))) {
                const resultMessages = msg.batchId
                  ? activeDrawConversation.messages
                    .filter((message) => message.role === 'assistant' && message.batchId === msg.batchId)
                    .sort((a, b) => (a.batchIndex || 0) - (b.batchIndex || 0))
                  : [msg];
                const isFirstBatchMessage = resultMessages[0]?.id === msg.id;
                if (!isFirstBatchMessage) return null;

                const successfulMessages = resultMessages.filter((message) => message.imageUrl);
                const failedMessages = resultMessages.filter((message) => message.error);
                const pendingMessages = resultMessages.filter(isPendingDrawMessage);
                const batchMessageIds = resultMessages.map((message) => message.id);
                const batchSelected = batchMessageIds.every((id) => drawSelectedMessageIds.has(id));
                const maxDuration = successfulMessages.reduce(
                  (max, message) => Math.max(max, Number(message.durationSeconds) || 0),
                  0,
                );

                let userMsg = msg.batchId
                  ? activeDrawConversation.messages.find((message) => message.role === 'user' && message.batchId === msg.batchId)
                  : null;
                if (!userMsg) {
                  for (let i = msgIndex - 1; i >= 0; i--) {
                    if (activeDrawConversation.messages[i].role === 'user') {
                      userMsg = activeDrawConversation.messages[i];
                      break;
                    }
                  }
                }

                return (
                  <article
                    key={msg.batchId || msg.id}
                    className={classNames(
                      'message-row',
                      'message-assistant',
                      'draw-result-group-row',
                      drawSelectMode && 'message-row-selectable',
                      drawSelectMode && batchSelected && 'message-row-selected',
                    )}
                    onClick={drawSelectMode ? () => batchMessageIds.forEach(toggleDrawMessageSelection) : undefined}
                  >
                    {drawSelectMode && (
                      <div className={classNames('message-checkbox', batchSelected && 'message-checkbox-checked')}>
                        {batchSelected ? '✓' : ''}
                      </div>
                    )}
                    <div className="message-content-col">
                      <div className="message-meta">
                        <span>AI</span>
                        <time>{formatTime(msg.createdAt)}</time>
                      </div>
                      <div className="message-bubble draw-result-group-bubble">
                        <div className="draw-result-summary">
                          <strong>{successfulMessages.length}/{resultMessages.length} 张已完成</strong>
                          {pendingMessages.length > 0 && <span>{pendingMessages.length} 张生成中</span>}
                          {failedMessages.length > 0 && <span className="draw-result-summary-error">{failedMessages.length} 张失败</span>}
                        </div>

                        <div
                          className={classNames('draw-result-grid', resultMessages.length === 1 && 'draw-result-grid-single')}
                          style={{ '--draw-grid-columns': Math.min(5, Math.max(1, resultMessages.length)) }}
                        >
                          {resultMessages.map((resultMessage, resultIndex) => {
                            if (resultMessage.imageUrl) {
                              return (
                                <div key={resultMessage.id} className="draw-result-tile">
                                  <img
                                    className="draw-result-image draw-result-image-clickable"
                                    src={resultMessage.imageUrl}
                                    alt={`${resultMessage.prompt || '生成图片'} ${resultIndex + 1}`}
                                    onClick={() => openGeneratedImagePreview(resultMessage.id)}
                                  />
                                  {!drawSelectMode && (
                                    <button
                                      type="button"
                                      className="draw-result-tile-save"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        downloadImage(resultMessage.imageUrl, resultMessage.prompt || 'image');
                                      }}
                                    >
                                      保存
                                    </button>
                                  )}
                                </div>
                              );
                            }

                            if (resultMessage.error) {
                              return (
                                <div key={resultMessage.id} className="draw-result-tile draw-result-tile-error" title={resultMessage.error}>
                                  <span>生成失败</span>
                                  <small>第 {resultIndex + 1} 张</small>
                                </div>
                              );
                            }

                            const elapsedSeconds = resultMessage.createdAt
                              ? Math.max(0, Math.floor((currentTime - resultMessage.createdAt) / 1000))
                              : 0;
                            return (
                              <div key={resultMessage.id} className="draw-result-tile draw-result-tile-loading">
                                <img src="/logo-2.png" alt="" aria-hidden="true" />
                                <span>{formatDuration(elapsedSeconds)}</span>
                              </div>
                            );
                          })}
                        </div>

                        {maxDuration > 0 && (
                          <div className="draw-result-meta">本组最长生成用时 {formatDuration(maxDuration)}</div>
                        )}

                        {!drawSelectMode && userMsg && (
                          <div className="draw-result-actions">
                            <Button
                              className="tool-button draw-regenerate-button"
                              type="primary"
                              size="small"
                              onClick={() => editDrawMessage?.(userMsg.id)}
                            >
                              再次生成
                            </Button>
                            {successfulMessages.length === 0 && failedMessages.length > 0 && (
                              <Button
                                className="tool-button"
                                type="default"
                                size="small"
                                disabled={isDrawSubmitting}
                                onClick={() => retryDraw?.(userMsg.id)}
                              >
                                立即重试
                              </Button>
                            )}
                            <Button className="tool-button" type="text" size="small" onClick={() => handleCopy(msg)}>
                              {copiedId === msg.id ? '已复制' : '复制提示词'}
                            </Button>
                            <Button
                              className="tool-button tool-button-delete"
                              type="text"
                              size="small"
                              onClick={() => requestDeleteDrawMessage(activeDrawConversation.id, msg.id)}
                            >
                              删除
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              }

              return null;
            })}
          </section>
          <Scrollbar scrollRef={messageListRef} />
          {showScrollToBottom && (
            <Button
              type="default"
              size="small"
              className="scroll-to-bottom-button"
              onClick={scrollToBottom}
              aria-label="滚动到底部"
              icon={(
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="5 12 10 17 15 12" />
                  <line x1="10" y1="3" x2="10" y2="17" />
                </svg>
              )}
            />
          )}
          {composerCollapsed && !drawSelectMode && (
            <button
              type="button"
              className={`composer-fab${composerFabVisible ? ' composer-fab-visible' : ''}`}
              onClick={expandComposer}
              aria-label="展开输入框"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
              </svg>
            </button>
          )}
        </div>

        <footer
          ref={composerPanelRef}
          className={`composer-panel composer-transition-wrap${composerCollapsed && !drawSelectMode ? ' composer-collapsed' : ''}`}
        >
            {drawSelectMode ? (
              <div className="select-action-bar">
                <Button className="select-action-btn select-action-btn-user" type="default" size="small" onClick={selectAllDrawUserMessages}>
                  全选用户
                </Button>
                <Button className="select-action-btn select-action-btn-ai" type="default" size="small" onClick={selectAllDrawAssistantMessages}>
                  全选 AI
                </Button>
                <Button
                  className="select-action-btn select-action-btn-delete"
                  type="primary"
                  danger
                  size="small"
                  onClick={deleteSelectedDrawMessages}
                  disabled={drawSelectedMessageIds.size === 0}
                >
                  删除({drawSelectedMessageIds.size})
                </Button>
              </div>
            ) : (
              <>
                {isGenerating && (
                <div className="draw-waiting-bar">
                  <span className="draw-waiting-dot" />
                  <span>{pendingDrawTaskCount} 个任务正在异步生成，可继续提交</span>
                </div>
              )}

              {Array.isArray(drawPendingImages) && drawPendingImages.length > 0 && (
                <div className="pending-images-row">
                  {drawPendingImages.map((img, index) => (
                    <div key={index} className="pending-image-card pending-image-card-mini">
                      <img
                        className="pending-image-preview pending-image-clickable"
                        src={img.url}
                        alt={`参考图 ${index + 1}`}
                        onClick={() => openPreview(drawPendingImages.map((i) => i.url), index)}
                      />
                      <Button
                        className="pending-image-remove"
                        type="text"
                        size="small"
                        danger
                        onClick={(e) => { e.stopPropagation(); removeDrawPendingImage(index); }}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="draw-config-panel">
                <Collapse
                  className="draw-config-collapse"
                  defaultExpanded={false}
                  question={(
                    <div className="draw-config-collapse-head">
                      <span className="draw-config-toggle-label">绘图参数</span>
                      <span className="draw-config-toggle-summary">{currentModelLabel} · {currentSizeLabel} · {currentImageCount} 张</span>
                    </div>
                  )}
                  answer={(
                    <div className="draw-config">
                      <div className="draw-config-item draw-config-item-model">
                        <span>模型</span>
                        <Select
                          value={(() => {
                            const current = settings.drawModel || 'gpt-image-2';
                            const opt = DRAW_MODEL_OPTIONS.find((o) => o.value === current);
                            return opt?.disabled ? 'gpt-image-2' : current;
                          })()}
                          onChange={(value) => {
                            const opt = DRAW_MODEL_OPTIONS.find((o) => o.value === value);
                            if (opt?.disabled) return;
                            setSettings((s) => ({ ...s, drawModel: value }));
                          }}
                          options={DRAW_MODEL_OPTIONS.map((opt) => ({ key: opt.value, label: opt.label }))}
                        />
                      </div>
                      <div className="draw-config-item">
                        <span>模式</span>
                        <Select
                          value={settings.drawApiMode || 'images'}
                          onChange={(value) => setSettings((s) => ({ ...s, drawApiMode: value }))}
                          options={DRAW_API_MODE_OPTIONS.map((opt) => ({ key: opt.value, label: opt.label }))}
                        />
                      </div>
                      <div className="draw-config-item">
                        <span>尺寸</span>
                        <Select
                          value={settings.drawSize || '1024x1792'}
                          onChange={(value) => setSettings((s) => ({ ...s, drawSize: value }))}
                          options={DRAW_SIZE_OPTIONS.map((opt) => ({ key: opt.value, label: opt.label }))}
                        />
                      </div>
                      <div className="draw-config-item">
                        <span>质量</span>
                        <Select
                          value={settings.drawQuality || 'medium'}
                          onChange={(value) => setSettings((s) => ({ ...s, drawQuality: value }))}
                          options={DRAW_QUALITY_OPTIONS.map((opt) => ({ key: opt.value, label: opt.label }))}
                        />
                      </div>
                      <div className="draw-config-item">
                        <span>数量</span>
                        <Select
                          value={String(currentImageCount)}
                          onChange={(value) => setSettings((s) => ({ ...s, drawImageCount: Number(value) || 1 }))}
                          options={drawCountOptions}
                        />
                      </div>
                      {activeDrawMessages.length > 0 && !isGenerating && (
                        <Button
                          className="draw-config-manage manage-button"
                          type="dashed"
                          size="small"
                          onClick={enterDrawSelectMode}
                          aria-label="管理画图记录"
                        >
                          管理
                        </Button>
                      )}
                    </div>
                  )}
                />
              </div>

              <div className="draw-input-row">
                <button
                  type="button"
                  className="composer-fullscreen-button"
                  onClick={() => setFullscreenOpen(true)}
                  aria-label="全屏编辑提示词"
                  title="全屏编辑提示词"
                >
                  <FullscreenIcon />
                </button>
                <button
                  type="button"
                  className="composer-collapse-button"
                  onClick={collapseComposer}
                  aria-label="收起输入框"
                  title="收起输入框"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
                  </svg>
                </button>
                <Button
                  className="upload-button"
                  type="default"
                  size="small"
                  onClick={() => drawFileInputRef.current?.click()}
                  disabled={drawImageProcessing || (drawPendingImages?.length || 0) >= DRAW_MAX_REFERENCE_IMAGES}
                  aria-label="上传参考图"
                  aria-busy={drawImageProcessing}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </Button>
                <label className="draw-count-quick" title="生成数量">
                  <span className="sr-only">生成数量</span>
                  <select
                    value={currentImageCount}
                    onChange={(event) => setSettings((s) => ({ ...s, drawImageCount: Number(event.target.value) || 1 }))}
                    aria-label="生成图片数量"
                  >
                    {drawCountOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <textarea
                  className="draw-input"
                  rows={1}
                  value={drawPrompt}
                  onChange={(e) => setDrawPrompt(e.target.value)}
                  onPaste={handleDrawPaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleDraw();
                    }
                  }}
                  placeholder="描述你想要的图片..."
                />
                <Button
                  className="send-button"
                  type="primary"
                  size="small"
                  disabled={!drawPrompt.trim() || isDrawSubmitting || drawConvLoading || !activeDrawConversation?.messagesLoaded || authState !== 'authenticated'}
                  onClick={handleDraw}
                >
                  {isDrawSubmitting ? '提交中' : '生成'}
                </Button>
              </div>
            </>
          )}

          <input
            ref={drawFileInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            multiple
            onChange={handleDrawFileChange}
          />
        </footer>
      </main>

      <ConfirmDialog
        visible={Boolean(deleteDrawTarget)}
        title="删除这张图片？"
        description="对应的提示词记录也会一起删除，此操作不可撤销。"
        titleId="delete-draw-title"
        onCancel={cancelDeleteDrawMessage}
        onConfirm={confirmDeleteDrawMessage}
      />

      <ConfirmDialog
        visible={Boolean(deleteDrawConversationTarget)}
        title="删除这条画图记录？"
        description="这条记录里的提示词和图片都会被删除，此操作不可撤销。"
        titleId="delete-draw-conversation-title"
        onCancel={() => setDeleteDrawConversationTarget(null)}
        onConfirm={() => {
          removeDrawConversation(deleteDrawConversationTarget);
          setDeleteDrawConversationTarget(null);
        }}
      />

      {previewImages && (
        <ImagePreview
          images={previewImages}
          index={previewIndex}
          onClose={closePreview}
        />
      )}

      {fullscreenOpen && (
        <FullscreenEditor
          title="全屏编辑提示词"
          description="适合编辑较长提示词，Ctrl/Cmd + Enter 可快速完成"
          value={drawPrompt}
          onChange={setDrawPrompt}
          onCancel={() => setFullscreenOpen(false)}
          onSave={() => setFullscreenOpen(false)}
          onPaste={handleDrawPaste}
          onPreviewImage={(index) => openPreview(
            (drawPendingImages || []).map((image) => image.url).filter(Boolean),
            index,
          )}
          onRemoveImage={removeDrawPendingImage}
          placeholder="描述你想要的图片..."
          images={(drawPendingImages || []).map((image) => image.url).filter(Boolean)}
        />
      )}
    </div>
  );
}
