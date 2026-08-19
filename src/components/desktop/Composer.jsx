import { useEffect, useState } from 'react';
import { Button, Icon } from 'animal-island-ui';
import { MAX_COMPOSER_HEIGHT, CHAT_MAX_IMAGES } from '../../lib/constants';
import ImagePreview from '../shared/ImagePreview';
import FullscreenEditor, { FullscreenIcon } from '../shared/FullscreenEditor';

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
  handleComposerPaste,
  onCollapse,
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
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const pendingImageUrls = Array.isArray(pendingImages) ? pendingImages.map((img) => img.url) : [];

  return (
    <footer className="desktop-composer-panel">
      {selectMode ? (
        <div className="desktop-select-action-bar">
          <Button className="desktop-select-action-btn desktop-select-action-btn-user" type="default" size="small" onClick={selectAllUserMessages}>全选用户</Button>
          <Button className="desktop-select-action-btn desktop-select-action-btn-ai" type="default" size="small" onClick={selectAllAssistantMessages}>全选AI</Button>
          <Button
            className="desktop-select-action-btn desktop-select-action-btn-delete"
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
            <div className="desktop-complete-hint">回答完成</div>
          )}
          {errorText && <div className="desktop-error-banner">{errorText}</div>}

          {Array.isArray(pendingImages) && pendingImages.length > 0 && (
            <div className="desktop-pending-images-row">
              {pendingImages.map((img, index) => (
                <div key={index} className="desktop-pending-image-card desktop-pending-image-card-mini">
                  <img
                    className="desktop-pending-image-preview desktop-pending-image-clickable"
                    src={img.url}
                    alt={`待发送图片 ${index + 1}`}
                    onClick={() => setPreviewIndex(index)}
                  />
                  <Button
                    className="desktop-pending-image-remove"
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

          <div className="desktop-composer-box">
            <button
              type="button"
              className="desktop-composer-fullscreen-button"
              onClick={() => setFullscreenOpen(true)}
              aria-label="全屏编辑消息"
              title="全屏编辑消息"
            >
              <FullscreenIcon />
            </button>
            <Button
              className="desktop-upload-btn"
              type="default"
              size="small"
              onClick={handleUploadClick}
              disabled={imageProcessing || !canUploadMore}
              aria-label="上传图片"
            >
              {imageProcessing ? (
                <span className="desktop-upload-btn-loading">处理中</span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              )}
            </Button>

            <textarea
              ref={composerRef}
              className="desktop-composer-input"
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onPaste={handleComposerPaste}
              placeholder="输入消息..."
            />

            {isSending ? (
              <Button className="desktop-send-btn desktop-stop-btn" type="primary" danger size="middle" onClick={stopStreaming}>停止</Button>
            ) : (
              <Button
                className="desktop-send-btn"
                type="primary"
                size="middle"
                disabled={!canSend || imageProcessing}
                onClick={() => sendMessage()}
              >
                <Icon name="icon-chat" size={30} bounce />发送
              </Button>
            )}
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        className="desktop-hidden-input"
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

      {fullscreenOpen && (
        <FullscreenEditor
          title="全屏编辑消息"
          description="适合编辑较长内容，Ctrl/Cmd + Enter 可快速完成"
          value={draft}
          onChange={setDraft}
          onCancel={() => setFullscreenOpen(false)}
          onSave={() => setFullscreenOpen(false)}
          onPaste={handleComposerPaste}
          onPreviewImage={setPreviewIndex}
          onRemoveImage={removePendingImage}
          placeholder="输入消息..."
          images={pendingImageUrls}
        />
      )}
    </footer>
  );
}
