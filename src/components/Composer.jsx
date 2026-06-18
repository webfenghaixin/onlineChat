import { useEffect, useRef } from 'react';
import { MAX_COMPOSER_HEIGHT } from '../lib/constants';

export default function Composer({
  draft,
  setDraft,
  isSending,
  canSend,
  sendMessage,
  stopStreaming,
  handleComposerKeyDown,
  selectMode,
  selectedMessageIds,
  exitSelectMode,
  selectAllUserMessages,
  selectAllAssistantMessages,
  deleteSelectedMessages,
  showCompleteHint,
  errorText,
  pendingImage,
  clearPendingImage,
  handleUploadClick,
  composerRef,
  fileInputRef,
  handleFileChange,
}) {
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [draft, composerRef]);

  return (
    <footer className="composer-panel">
      {selectMode ? (
        <div className="select-action-bar">
          <button className="select-action-btn select-action-btn-user" type="button" onClick={selectAllUserMessages}>
            全选用户
          </button>
          <button className="select-action-btn select-action-btn-ai" type="button" onClick={selectAllAssistantMessages}>
            全选AI
          </button>
          <button
            className="select-action-btn select-action-btn-delete"
            type="button"
            onClick={deleteSelectedMessages}
            disabled={selectedMessageIds.size === 0}
          >
            删除({selectedMessageIds.size})
          </button>
        </div>
      ) : (
        <>
          {showCompleteHint && !isSending && (
            <div className="complete-hint">回答完成</div>
          )}
          {errorText && <div className="error-banner">{errorText}</div>}

          {pendingImage && (
            <div className="pending-image-card">
              <img className="pending-image-preview" src={pendingImage.url} alt="待发送图片" />
              <div className="pending-image-info">
                <div className="pending-image-title">已添加图片</div>
                <div className="pending-image-name">{pendingImage.name}</div>
              </div>
              <button className="pending-image-remove" type="button" onClick={clearPendingImage}>
                移除
              </button>
            </div>
          )}

          <div className="composer-box">
            <button className="upload-button" type="button" onClick={handleUploadClick} aria-label="上传图片">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>

            <textarea
              ref={composerRef}
              className="composer-input"
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="输入消息..."
            />

            {isSending ? (
              <button className="send-button stop-button" type="button" onClick={stopStreaming}>
                停止
              </button>
            ) : (
              <button
                className="send-button"
                type="button"
                disabled={!canSend}
                onClick={() => sendMessage()}
              >
                发送
              </button>
            )}
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
      />
    </footer>
  );
}
