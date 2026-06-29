import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Collapse, Select, Divider } from 'animal-island-ui';
import {
  classNames,
  formatTime,
  formatDateTime,
  formatDuration,
  getTextParts,
  renderMarkdown,
} from '../lib/utils';
import {
  DRAW_SIZE_OPTIONS,
  DRAW_QUALITY_OPTIONS,
  DRAW_API_MODE_OPTIONS,
  DRAW_MODEL_OPTIONS,
  DRAW_MAX_IMAGES,
} from '../lib/constants';
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
  setActiveDrawConversationId,
  activeDrawConversation,
  activeDrawMessages,
  drawImageCount,
  isGenerating,
  drawElapsedSeconds,
  drawPrompt,
  setDrawPrompt,
  drawPendingImage,
  setDrawPendingImage,
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
  stopDrawGeneration,
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
}) {
  const [copiedId, setCopiedId] = useState(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const messageListRef = useRef(null);
  const programmaticScrollRef = useRef(false);

  const checkIsAtBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowScrollToBottom(false);
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
      setShowScrollToBottom(!checkIsAtBottom());
    }, 500);
  }, [checkIsAtBottom]);

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      setShowScrollToBottom(!checkIsAtBottom());
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [checkIsAtBottom, activeDrawConversationId]);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setShowScrollToBottom(!checkIsAtBottom());
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeDrawMessages, isGenerating, checkIsAtBottom]);

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
    DRAW_SIZE_OPTIONS.find((opt) => opt.value === (settings.drawSize || '1024x1792'))?.label || '1K · 9:16 全屏';

  return (
    <div className="draw-page">
      <aside className={classNames('drawer', drawDrawerOpen && 'drawer-open')}>
        <div className="drawer-header">
          <div className="drawer-brand">
            <img className="drawer-logo" src="/logo-2.png" alt="" />
            <div>
              <div className="drawer-kicker">lightDraw</div>
              <div className="drawer-title">画图记录</div>
            </div>
          </div>
          <Button className="drawer-close-button" type="text" size="small" onClick={() => setDrawDrawerOpen(false)}>
            关闭
          </Button>
        </div>
         <Divider type="wave-yellow" />
        <div className="history-pane">
          <Button className="drawer-primary-action" type="primary" block onClick={createNewDrawConversation}>
            新建画图
          </Button>
          <div className="history-list">
            {drawConversations
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((conv) => (
                <Card
                  key={conv.id}
                  className={classNames('history-card', conv.id === activeDrawConversationId && 'history-card-active')}
                  color={conv.id === activeDrawConversationId ? 'app-teal' : 'default'}
                >
                  <button
                    className="history-main"
                    type="button"
                    onClick={() => {
                      setActiveDrawConversationId(conv.id);
                      setErrorText('');
                      exitDrawSelectMode();
                      setDrawDrawerOpen(false);
                    }}
                  >
                    <span className="history-title">{conv.title}</span>
                    <span className="history-time">
                      {conv.messages.filter((m) => m.imageUrl).length} 张图 · {formatDateTime(conv.updatedAt)}
                    </span>
                  </button>
                  <Button
                    className="history-delete"
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
              <Button className="select-header-button" type="text" size="small" onClick={exitDrawSelectMode}>
                取消
              </Button>
              <div className="chat-title">
                <h1>已选 {drawSelectedMessageIds.size} 条</h1>
              </div>
              <Button
                className="select-header-button"
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
                className="mobile-header-button mobile-header-button-menu"
                type="default"
                size="small"
                onClick={() => setDrawDrawerOpen(true)}
                aria-label="打开侧栏"
              >
                ☰
              </Button>

              <div className="chat-title">
                <h1>{activeDrawConversation?.title || 'AI 画图'}</h1>
                <p className="chat-title-status">
                  <span className={classNames('status-dot', isGenerating && 'status-dot-live')} />
                  {isGenerating ? `生成中 ${formatDuration(drawElapsedSeconds)}` : `已存 ${drawImageCount}/${DRAW_MAX_IMAGES} 张`}
                </p>
              </div>

              <Button
                className="mobile-header-button draw-back-button"
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

            {activeDrawConversation?.messages.length === 0 && !isGenerating && (
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

            {activeDrawConversation?.messages.map((msg) => {
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
                        {msg.referenceImage && (
                          <img className="draw-ref-image" src={msg.referenceImage} alt="参考图" />
                        )}
                        {getTextParts(msg.content)}
                        <span className="draw-msg-config">
                          {DRAW_MODEL_OPTIONS.find((o) => o.value === msg.model)?.label || msg.model || 'GPT-Image-2'}
                          {' · '}
                          {DRAW_SIZE_OPTIONS.find((o) => o.value === msg.size)?.label || msg.size}
                          {' · '}
                          {DRAW_QUALITY_OPTIONS.find((o) => o.value === msg.quality)?.label}
                          {msg.referenceImage ? ' · 图生图' : ''}
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

              if (msg.imageUrl) {
                return (
                  <article
                    key={msg.id}
                    className={classNames(
                      'message-row',
                      'message-assistant',
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
                        <span>AI</span>
                        <time>{formatTime(msg.createdAt)}</time>
                      </div>
                      <div className="message-bubble">
                        <img
                          className="draw-result-image"
                          src={msg.imageUrl}
                          alt={msg.prompt || getTextParts(msg.content) || '生成图片'}
                        />
                        {typeof msg.durationSeconds === 'number' && (
                          <div className="draw-result-meta">生成用时 {formatDuration(msg.durationSeconds)}</div>
                        )}
                        {!drawSelectMode && (
                          <div className="draw-result-actions">
                            <Button className="tool-button" type="text" size="small" onClick={() => handleCopy(msg)}>
                              {copiedId === msg.id ? '已复制' : '复制提示词'}
                            </Button>
                            <Button className="tool-button" type="default" size="small" onClick={() => downloadImage(msg.imageUrl, msg.prompt)}>
                              保存到相册
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

              if (msg.error) {
                return (
                  <article
                    key={msg.id}
                    className={classNames(
                      'message-row',
                      'message-assistant',
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
                        <span>AI</span>
                      </div>
                      <div className="message-bubble">
                        <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(`出错了：${msg.error}`) }} />
                      </div>
                    </div>
                  </article>
                );
              }

              if (isGenerating) {
                return (
                  <article
                    key={msg.id}
                    className={classNames(
                      'message-row',
                      'message-assistant',
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
                        <span>AI</span>
                      </div>
                      <div className="message-bubble">
                        <div className="draw-loading-inline">
                          <div className="draw-loading-stage" aria-hidden="true">
                            <img className="draw-loading-logo" src="/logo-2.png" alt="" />
                          </div>
                          <div className="draw-loading-copy">
                            <span className="draw-loading-subtitle">正在生成图片，已等待 {formatDuration(drawElapsedSeconds)}</span>
                          </div>
                        </div>
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
        </div>

        <footer className="composer-panel">
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
                  <span>正在生成，已等待 {formatDuration(drawElapsedSeconds)}</span>
                </div>
              )}

              {drawPendingImage && (
                <div className="pending-image-card">
                  <img className="pending-image-preview" src={drawPendingImage.url} alt="参考图" />
                  <div className="pending-image-info">
                    <div className="pending-image-title">参考图（图生图）</div>
                    <div className="pending-image-name">{drawPendingImage.name}</div>
                  </div>
                  <Button className="pending-image-remove" type="text" size="small" danger onClick={() => setDrawPendingImage(null)}>
                    移除
                  </Button>
                </div>
              )}

              <div className="draw-config-panel">
                <Collapse
                  className="draw-config-collapse"
                  defaultExpanded={false}
                  question={(
                    <div className="draw-config-collapse-head">
                      <span className="draw-config-toggle-label">绘图参数</span>
                      <span className="draw-config-toggle-summary">{currentModelLabel} · {currentSizeLabel}</span>
                    </div>
                  )}
                  answer={(
                    <div className="draw-config">
                      <div className="draw-config-item">
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
                <Button
                  className="upload-button"
                  type="default"
                  size="small"
                  onClick={() => drawFileInputRef.current?.click()}
                  aria-label="上传参考图"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </Button>
                <textarea
                  className="draw-input"
                  rows={1}
                  value={drawPrompt}
                  onChange={(e) => setDrawPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleDraw();
                    }
                  }}
                  placeholder="描述你想要的图片..."
                  disabled={isGenerating}
                />
                {isGenerating ? (
                  <Button className="send-button stop-button" type="primary" danger size="small" onClick={stopDrawGeneration}>
                    停止
                  </Button>
                ) : (
                  <Button
                    className="send-button"
                    type="primary"
                    size="small"
                    disabled={!drawPrompt.trim() || isGenerating || authState !== 'authenticated'}
                    onClick={handleDraw}
                  >
                    生成
                  </Button>
                )}
              </div>
            </>
          )}

          <input
            ref={drawFileInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;

              if (!file.type.startsWith('image/')) {
                setErrorText('只能上传图片文件。');
                e.target.value = '';
                return;
              }

              try {
                const optimizedImageUrl = await prepareDrawReferenceImage(file);
                setDrawPendingImage({
                  name: file.name,
                  url: optimizedImageUrl,
                });
                setErrorText('');
              } catch (error) {
                setErrorText(error.message || '参考图处理失败');
              }

              e.target.value = '';
            }}
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
    </div>
  );
}
