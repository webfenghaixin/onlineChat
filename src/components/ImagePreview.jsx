import { useEffect, useState, useCallback } from 'react';

export default function ImagePreview({ images, index, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(index || 0);

  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  const total = list.length;

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + total) % total);
  }, [total]);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % total);
  }, [total]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'ArrowLeft' && total > 1) goPrev();
      else if (e.key === 'ArrowRight' && total > 1) goNext();
    };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose, goPrev, goNext, total]);

  if (total === 0) return null;

  return (
    <div className="image-preview-overlay" onClick={onClose}>
      {total > 1 && (
        <button
          type="button"
          className="image-preview-nav image-preview-nav-prev"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          aria-label="上一张"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      )}

      <img
        className="image-preview-img"
        src={list[currentIndex]}
        alt="预览"
        onClick={(e) => e.stopPropagation()}
      />

      <div className="image-preview-header" onClick={(e) => e.stopPropagation()}>
        {total > 1 && <span className="image-preview-counter">{currentIndex + 1} / {total}</span>}
        <button
          type="button"
          className="image-preview-close"
          onClick={onClose}
          aria-label="关闭"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {total > 1 && (
        <button
          type="button"
          className="image-preview-nav image-preview-nav-next"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          aria-label="下一张"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      )}
    </div>
  );
}
