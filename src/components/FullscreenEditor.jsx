import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function FullscreenIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="8 3 3 3 3 8" />
      <polyline points="16 3 21 3 21 8" />
      <polyline points="21 16 21 21 16 21" />
      <polyline points="3 16 3 21 8 21" />
    </svg>
  );
}

export default function FullscreenEditor({
  title,
  description,
  value,
  onChange,
  onCancel,
  onSave,
  onPaste,
  onPreviewImage,
  onRemoveImage,
  placeholder,
  images = [],
}) {
  const initialValueRef = useRef(value);
  const textareaRef = useRef(null);
  const actionsRef = useRef({ onCancel, onChange, onSave });
  actionsRef.current = { onCancel, onChange, onSave };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    textareaRef.current?.focus();

    const handleKeyDown = (event) => {
      if (document.querySelector('.image-preview-lightbox')) return;

      if (event.key === 'Escape') {
        actionsRef.current.onChange(initialValueRef.current);
        actionsRef.current.onCancel?.();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        actionsRef.current.onSave?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleCancel = () => {
    onChange(initialValueRef.current);
    onCancel?.();
  };

  const editor = (
    <div className="fullscreen-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="fullscreen-editor-title">
      <section className="fullscreen-editor-panel">
        <header className="fullscreen-editor-header">
          <div>
            <h2 id="fullscreen-editor-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="fullscreen-editor-close" onClick={handleCancel} aria-label="关闭全屏编辑">
            ×
          </button>
        </header>

        {images.length > 0 && (
          <div className="fullscreen-editor-images" aria-label="当前图片">
            {images.map((url, index) => (
              <div className="fullscreen-editor-image-item" key={`${url}-${index}`}>
                {onPreviewImage ? (
                  <button
                    type="button"
                    className="fullscreen-editor-image-preview"
                    onClick={() => onPreviewImage(index)}
                    aria-label={`预览第 ${index + 1} 张图片`}
                  >
                    <img src={url} alt={`当前图片 ${index + 1}`} />
                  </button>
                ) : (
                  <img src={url} alt={`当前图片 ${index + 1}`} />
                )}
                {onRemoveImage && (
                  <button
                    type="button"
                    className="fullscreen-editor-image-remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveImage(index);
                    }}
                    aria-label={`删除第 ${index + 1} 张图片`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="fullscreen-editor-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={onPaste}
          placeholder={placeholder}
        />

        <footer className="fullscreen-editor-footer">
          <span>{value.length} 字</span>
          <div className="fullscreen-editor-actions">
            <button type="button" className="fullscreen-editor-button fullscreen-editor-button-secondary" onClick={handleCancel}>
              取消
            </button>
            <button type="button" className="fullscreen-editor-button fullscreen-editor-button-primary" onClick={onSave}>
              完成
            </button>
          </div>
        </footer>
      </section>
    </div>
  );

  return createPortal(editor, document.body);
}
