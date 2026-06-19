import { useState } from 'react';
import { classNames, formatTime, formatDateTime, formatDuration, renderMarkdown } from '../lib/utils';
import { DRAW_SIZE_OPTIONS, DRAW_QUALITY_OPTIONS, DRAW_API_MODE_OPTIONS, DRAW_MODEL_OPTIONS } from '../lib/constants';
import { prepareDrawReferenceImage } from '../lib/image-utils';
import ConfirmDialog from './ConfirmDialog';

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
  // actions
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
  toggleDrawMessageSelection,
  selectAllDrawUserMessages,
  selectAllDrawAssistantMessages,
  deleteSelectedDrawMessages,
  drawFileInputRef,
  authState,
}) {
  const [copiedId, setCopiedId] = useState(null);

  async function handleCopy(msg) {
    try {
      const textToCopy = msg.role === 'user' ? msg.content : (msg.prompt || msg.content || '');
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // fallback: do nothing
    }
  }

  return (
    <div className="draw-page">
      {/* Draw drawer (conversation list) */}
      <aside className={classNames('drawer', drawDrawerOpen && 'drawer-open')}>
        <div className="drawer-header">
          <div className="drawer-brand">
            <img className="drawer-logo" src="/logo-2.png" alt="" />
            <div>
              <div className="drawer-kicker">lightDraw</div>
              <div className="drawer-title">画图记录</div>
            </div>
          </div>
          <button className="plain-icon-button" type="button" onClick={() => setDrawDrawerOpen(false)}>
            关闭
          </button>
        </div>

        <div className="history-pane">
          <button className="primary-button wide-button" type="button" onClick={createNewDrawConversation}>
            新建画图
          </button>

          <div className="history-list">
            {drawConversations
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((conv) => (
                <div
                  key={conv.id}
                  className={classNames(
                    'history-card',
                    conv.id === activeDrawConversationId && 'history-card-active',
                  )}
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
                  <button
                    className="history-delete"
                    type="button"
                    aria-label="删除画图记录"
                    onClick={() => setDeleteDrawConversationTarget(conv.id)}
                  >
                    删除
                  </button>
                </div>
              ))}
          </div>
        </div>
      </aside>

      {drawDrawerOpen && (
        <button
          className="drawer-backdrop"
          type="button"
          aria-label="关闭面板"
          onClick={() => setDrawDrawerOpen(false)}
        />
      )}

      {/* Draw main page */}
      <main className="phone-shell">
        <header className={classNames('chat-header', drawSelectMode ? 'chat-header-select' : 'chat-header-3col')}>
          {drawSelectMode ? (
            <>
              <button className="header-button header-button-text" type="button" onClick={exitDrawSelectMode}>
                取消
              </button>
              <div className="chat-title">
                <h1>已选 {drawSelectedMessageIds.size} 条</h1>
              </div>
              <button
                className="header-button header-button-icon"
                type="button"
                onClick={deleteSelectedDrawMessages}
                disabled={drawSelectedMessageIds.size === 0}
                aria-label="删除"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
              </button>
            </>
          ) : (
            <>
              <button className="header-button header-button-icon" type="button" onClick={() => setDrawDrawerOpen(true)}>
                <span aria-hidden="true">☰</span>
              </button>

              <div className="chat-title">
                <img className="header-logo" src="/logo-2.png" alt="" />
                <h1>{activeDrawConversation?.title || 'AI 画图'}</h1>
                <p>
                  <span className={classNames('status-dot', isGenerating && 'status-dot-live')} />
                  {isGenerating ? `生成中 ${formatDuration(drawElapsedSeconds)}` : `已存 ${drawImageCount}/20 张`}
                </p>
              </div>

              <button className="header-button header-button-icon" type="button" onClick={closeDrawMode} aria-label="返回聊天">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </button>
            </>
          )}
        </header>

        <div className="message-list-wrapper">
          <section className="message-list" aria-live="polite">
            {drawLimitWarning && (
              <div className="draw-limit-banner">
                已存满 20 张图，新图片将自动替换最早的图片
                <button type="button" onClick={() => setDrawLimitWarning(false)}>知道了</button>
              </div>
            )}
            {errorText && <div className="error-banner">{errorText}</div>}

            {activeDrawConversation?.messages.length === 0 && !isGenerating && (
              <div className="draw-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                <p>输入描述，AI 为你生成图片</p>
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
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
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
                        {msg.content}
                        <span className="draw-msg-config">{DRAW_MODEL_OPTIONS.find(o => o.value === msg.model)?.label || msg.model || 'GPT-Image-2'} · {DRAW_SIZE_OPTIONS.find(o => o.value === msg.size)?.label} · {DRAW_QUALITY_OPTIONS.find(o => o.value === msg.quality)?.label}{msg.referenceImage ? ' · 图生图' : ''}</span>
                      </div>
                      {!drawSelectMode && (
                        <div className={classNames('message-tools', 'message-tools-user')}>
                          <button
                            type="button"
                            className={classNames('tool-button tool-button-icon', copiedId === msg.id && 'tool-button-copied')}
                            onClick={() => handleCopy(msg)}
                            aria-label="复制"
                          >
                            {copiedId === msg.id ? (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" /></svg>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              }

              // assistant message
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
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
                        )}
                      </div>
                    )}
                    <div className="message-content-col">
                      <div className="message-meta">
                        <img className="message-avatar" src="/logo-2.png" alt="" />
                        <span>AI</span>
                        <time>{formatTime(msg.createdAt)}</time>
                      </div>
                      <div className="message-bubble">
                        <img className="draw-result-image" src={msg.imageUrl} alt={msg.prompt} />
                        {typeof msg.durationSeconds === 'number' && (
                          <div className="draw-result-meta">生成用时 {formatDuration(msg.durationSeconds)}</div>
                        )}
                        {!drawSelectMode && (
                          <div className="draw-result-actions">
                            <button className="tool-button" type="button" onClick={() => handleCopy(msg)}>
                              {copiedId === msg.id ? '已复制' : '复制提示词'}
                            </button>
                            <button className="tool-button" type="button" onClick={() => downloadImage(msg.imageUrl, msg.prompt)}>
                              保存到相册
                            </button>
                            <button className="tool-button tool-button-retry" type="button" onClick={() => requestDeleteDrawMessage(activeDrawConversation.id, msg.id)}>
                              删除
                            </button>
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
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
                        )}
                      </div>
                    )}
                    <div className="message-content-col">
                      <div className="message-meta">
                        <img className="message-avatar" src="/logo-2.png" alt="" />
                        <span>AI</span>
                      </div>
                      <div className="message-bubble">
                        <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(`出错了：${msg.error}`) }} />
                      </div>
                    </div>
                  </article>
                );
              }

              // Still generating (no imageUrl yet)
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
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
                        )}
                      </div>
                    )}
                    <div className="message-content-col">
                      <div className="message-meta">
                        <img className="message-avatar" src="/logo-2.png" alt="" />
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
        </div>

        <footer className="composer-panel">
          {drawSelectMode ? (
            <div className="select-action-bar">
              <button className="select-action-btn select-action-btn-user" type="button" onClick={selectAllDrawUserMessages}>
                全选用户
              </button>
              <button className="select-action-btn select-action-btn-ai" type="button" onClick={selectAllDrawAssistantMessages}>
                全选AI
              </button>
              <button
                className="select-action-btn select-action-btn-delete"
                type="button"
                onClick={deleteSelectedDrawMessages}
                disabled={drawSelectedMessageIds.size === 0}
              >
                删除({drawSelectedMessageIds.size})
              </button>
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
                  <button className="pending-image-remove" type="button" onClick={() => setDrawPendingImage(null)}>
                    移除
                  </button>
                </div>
              )}
              <div className="draw-config">
                <label className="draw-config-item">
                  <span>模型</span>
                  <select
                    className="draw-config-select"
                    value={settings.drawModel || 'gpt-image-2'}
                    onChange={(e) => setSettings((s) => ({ ...s, drawModel: e.target.value }))}
                  >
                    {DRAW_MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                <label className="draw-config-item">
                  <span>模式</span>
                  <select
                    className="draw-config-select"
                    value={settings.drawApiMode || 'images'}
                    onChange={(e) => setSettings((s) => ({ ...s, drawApiMode: e.target.value }))}
                  >
                    {DRAW_API_MODE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                <label className="draw-config-item">
                  <span>尺寸</span>
                  <select
                    className="draw-config-select"
                    value={settings.drawSize || '1024x1792'}
                    onChange={(e) => setSettings((s) => ({ ...s, drawSize: e.target.value }))}
                  >
                    {DRAW_SIZE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                <label className="draw-config-item">
                  <span>质量</span>
                  <select
                    className="draw-config-select"
                    value={settings.drawQuality || 'medium'}
                    onChange={(e) => setSettings((s) => ({ ...s, drawQuality: e.target.value }))}
                  >
                    {DRAW_QUALITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                {activeDrawMessages.length > 0 && !isGenerating && (
                  <button
                    className="manage-button draw-config-manage"
                    type="button"
                    onClick={exitDrawSelectMode}
                    aria-label="管理画图记录"
                  >
                    管理
                  </button>
                )}
              </div>
              <div className="draw-input-row">
                <button className="upload-button" type="button" onClick={() => drawFileInputRef.current?.click()} aria-label="上传参考图">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </button>
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
                  <button className="send-button stop-button" type="button" onClick={stopDrawGeneration}>
                    停止
                  </button>
                ) : (
                  <button
                    className="send-button draw-send-button"
                    type="button"
                    disabled={!drawPrompt.trim() || isGenerating || authState !== 'authenticated'}
                    onClick={handleDraw}
                  >
                    生成
                  </button>
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
