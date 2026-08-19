import { memo, useState } from 'react';
import { Button, Tooltip } from 'animal-island-ui';
import { classNames, formatTime, getImageParts, getTextParts, renderMarkdown } from '../../lib/utils';
import ImagePreview from '../shared/ImagePreview';

const MessageRow = memo(function MessageRow({
  message,
  isLatestAssistant,
  isSending,
  copiedMessageId,
  onCopy,
  onRetry,
  selectMode,
  selected,
  onToggleSelect,
  onEnterSelectMode,
}) {
  const [previewIndex, setPreviewIndex] = useState(-1);
  const images = getImageParts(message.content);
  const text = getTextParts(message.content);
  const isAssistant = message.role === 'assistant';
  const hasErrorText = isAssistant && text.startsWith('出错了：');
  const imageUrls = images.map((img) => img.image_url.url);

  return (
    <article
      className={classNames(
        'desktop-message-row',
        message.role === 'user' ? 'desktop-message-user' : 'desktop-message-assistant',
        selectMode && 'desktop-message-row-selectable',
        selectMode && selected && 'desktop-message-row-selected',
      )}
      onClick={selectMode ? () => onToggleSelect(message.id) : undefined}
    >
      {selectMode && (
        <div className={classNames('desktop-message-checkbox', selected && 'desktop-message-checkbox-checked')}>
          {selected ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8 6.5 11 12.5 5" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /></svg>
          )}
        </div>
      )}

      <div className="desktop-message-content-col">
        <div className="desktop-message-meta">
          <span className="desktop-message-role">{message.role === 'user' ? '我' : 'AI'}</span>
          <time>{formatTime(message.createdAt || Date.now())}</time>
        </div>

        <div className={classNames('desktop-message-bubble', isAssistant ? 'desktop-message-bubble-assistant' : 'desktop-message-bubble-user')}>
          {images.length > 0 && (
            <div className="desktop-message-images">
              {images.map((image, idx) => (
                <img
                  key={image.image_url.url}
                  className="desktop-message-image desktop-message-image-clickable"
                  src={image.image_url.url}
                  alt="上传图片"
                  onClick={() => setPreviewIndex(idx)}
                />
              ))}
            </div>
          )}

          {isAssistant ? (
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(text || (isLatestAssistant ? '正在思考...' : '')),
              }}
            />
          ) : (
            <div className="desktop-message-plain-text">{text}</div>
          )}

          {isLatestAssistant && <span className="typing-cursor" />}
        </div>

        {!selectMode && (
          <div className={classNames('desktop-message-tools', message.role === 'user' && 'desktop-message-tools-user')}>
            {hasErrorText && !isSending && (
              <Tooltip title="重新提问">
                <Button
                  className="tool-button tool-button-retry"
                  type="text"
                  size="small"
                  onClick={() => onRetry(message)}
                >
                  重新提问
                </Button>
              </Tooltip>
            )}

            <Tooltip title="复制">
              <Button
                className={classNames(
                  'tool-button',
                  copiedMessageId === message.id && 'tool-button-copied',
                  message.role === 'user' && 'tool-button-user',
                )}
                type="text"
                size="small"
                onClick={() => onCopy(message)}
                aria-label="复制"
                icon={copiedMessageId === message.id ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" /></svg>
                )}
              />
            </Tooltip>

            {isAssistant && !isSending && (
              <Tooltip title="删除">
                <Button
                  className="tool-button tool-button-delete"
                  type="text"
                  size="small"
                  danger
                  onClick={() => onEnterSelectMode(message.id)}
                  aria-label="删除"
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                  }
                />
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {previewIndex >= 0 && (
        <ImagePreview
          images={imageUrls}
          index={previewIndex}
          onClose={() => setPreviewIndex(-1)}
        />
      )}
    </article>
  );
});

export default MessageRow;
