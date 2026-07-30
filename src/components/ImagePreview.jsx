import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

export default function ImagePreview({ images, index, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(index || 0);
  const [scale, setScale] = useState(1);
  const touchStartRef = useRef(null);
  const wheelLockedRef = useRef(false);

  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  const total = list.length;

  const resetScale = useCallback(() => setScale(1), []);

  const goPrev = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex((i) => (i - 1 + total) % total);
    resetScale();
  }, [resetScale, total]);

  const goNext = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex((i) => (i + 1) % total);
    resetScale();
  }, [resetScale, total]);

  const zoomOut = useCallback(() => {
    setScale((value) => Math.max(MIN_SCALE, Number((value - SCALE_STEP).toFixed(2))));
  }, []);

  const zoomIn = useCallback(() => {
    setScale((value) => Math.min(MAX_SCALE, Number((value + SCALE_STEP).toFixed(2))));
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
      else if ((event.key === 'ArrowUp' || event.key === 'ArrowLeft') && total > 1) goPrev();
      else if ((event.key === 'ArrowDown' || event.key === 'ArrowRight') && total > 1) goNext();
      else if (event.key === '+' || event.key === '=') zoomIn();
      else if (event.key === '-') zoomOut();
      else if (event.key === '0') resetScale();
    };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [goNext, goPrev, onClose, resetScale, total, zoomIn, zoomOut]);

  useEffect(() => {
    if (currentIndex >= total) setCurrentIndex(Math.max(0, total - 1));
  }, [currentIndex, total]);

  const handleWheel = (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (event.deltaY < 0) zoomIn();
      else zoomOut();
      return;
    }
    if (scale !== 1 || total <= 1 || wheelLockedRef.current || Math.abs(event.deltaY) < 16) return;
    event.preventDefault();
    wheelLockedRef.current = true;
    if (event.deltaY > 0) goNext();
    else goPrev();
    window.setTimeout(() => { wheelLockedRef.current = false; }, 320);
  };

  const handleTouchStart = (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event) => {
    if (!touchStartRef.current || scale !== 1 || total <= 1) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(deltaY) < 52 || Math.abs(deltaY) <= Math.abs(deltaX)) return;
    if (deltaY < 0) goNext();
    else goPrev();
  };

  if (total === 0) return null;

  const preview = (
    <div
      className="image-preview-overlay"
      onClick={onClose}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="image-preview-stage" onClick={(event) => event.stopPropagation()}>
        <img
          className="image-preview-img"
          src={list[currentIndex]}
          alt={`预览图片 ${currentIndex + 1}`}
          style={{ transform: `scale(${scale})` }}
          onDoubleClick={() => setScale((value) => (value === 1 ? 2 : 1))}
          draggable="false"
        />
      </div>

      <div className="image-preview-header" onClick={(event) => event.stopPropagation()}>
        <span className="image-preview-counter">{currentIndex + 1} / {total}</span>
        <button type="button" className="image-preview-close" onClick={onClose} aria-label="关闭预览">×</button>
      </div>

      <div className="image-preview-zoom" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={zoomOut} disabled={scale <= MIN_SCALE} aria-label="缩小图片">−</button>
        <button type="button" className="image-preview-scale" onClick={resetScale} aria-label="恢复原始缩放">
          {Math.round(scale * 100)}%
        </button>
        <button type="button" onClick={zoomIn} disabled={scale >= MAX_SCALE} aria-label="放大图片">+</button>
      </div>

      {total > 1 && (
        <div className="image-preview-nav-stack" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="image-preview-nav" onClick={goPrev} aria-label="上一张">↑</button>
          <button type="button" className="image-preview-nav" onClick={goNext} aria-label="下一张">↓</button>
        </div>
      )}

      {total > 1 && <div className="image-preview-swipe-hint">上下滑动切换</div>}
    </div>
  );

  return createPortal(preview, document.body);
}
