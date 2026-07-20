import { useEffect, useState } from 'react';
import { Button } from 'animal-island-ui';
import { MAX_COMPOSER_HEIGHT, CHAT_MAX_IMAGES } from '../lib/constants';
import ImagePreview from './ImagePreview';

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
  pendingImages,
  removePendingImage,
  clearPendingImages,
  handleUploadClick,
  imageProcessing,
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

  const canUploadMore = Array.isArray(pendingImages) && pendingImages.length < CHAT_MAX_IMAGES;
  const [previewIndex, setPreviewIndex] = useState(-1);
  const pendingImageUrls = Array.isArray(pendingImages) ? pendingImages.map((img) => img.url) : [];

  return (
    <footer className="composer-panel">
      {selectMode ? (
        <div className="select-action-bar">
          <Button className="select-action-btn select-action-btn-user" type="default" size="small" onClick={selectAllUserMessages}>全选用户</Button>
          <Button className="select-action-btn select-action-btn-ai" type="default" size="small" onClick={selectAllAssistantMessages}>全选AI</Button>
          <Button
            className="select-action-btn select-action-btn-delete"
            type="primary"
            danger
            size="small"
            onClick={deleteSelectedMessages}
            disabled={selectedMessageIds.size === 0}
          >
            删除({selectedMessageIds.size})
          </Button>
        </div>
      ) : (
        <>
          {showCompleteHint && !isSending && (
            <div className="complete-hint">回答完成</div>
          )}
          {errorText && <div className="error-banner">{errorText}</div>}

          {Array.isArray(pendingImages) && pendingImages.length > 0 && (
            <div className="pending-images-row">
              {pendingImages.map((img, index) => (
                <div key={index} className="pending-image-card pending-image-card-mini">
                  <img
                    className="pending-image-preview pending-image-clickable"
                    src={img.url}
                    alt={`待发送图片 ${index + 1}`}
                    onClick={() => setPreviewIndex(index)}
                  />
                  <Button
                    className="pending-image-remove"
                    type="text"
                    size="small"
                    danger
                    onClick={(e) => { e.stopPropagation(); removePendingImage(index); }}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-box">
            <Button
              className="upload-button"
              type="default"
              size="small"
              onClick={handleUploadClick}
              disabled={imageProcessing || !canUploadMore}
              aria-label="上传图片"
            >
              {imageProcessing ? (
                <span className="upload-button-loading">处理中</span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              )}
            </Button>

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
              <Button className="send-button stop-button" type="primary" danger size="small" onClick={stopStreaming}>停止</Button>
            ) : (
              <Button
                className="send-button"
                type="primary"
                size="small"
                disabled={!canSend || imageProcessing}
                onClick={() => sendMessage()}
              >
                发送
              </Button>
            )}
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
      />

      {previewIndex >= 0 && (
        <ImagePreview
          images={pendingImageUrls}
          index={previewIndex}
          onClose={() => setPreviewIndex(-1)}
        />
      )}
    </footer>
  );
}
