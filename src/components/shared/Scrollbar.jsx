import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { classNames } from '../../lib/utils';

function Scrollbar({ scrollRef }) {
  const [thumbState, setThumbState] = useState({ top: 0, height: 0, visible: false });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ y: 0, scrollTop: 0 });
  const fadeTimer = useRef(null);
  const [showThumb, setShowThumb] = useState(false);

  const updateThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const trackHeight = clientHeight;
    const canScroll = scrollHeight > clientHeight;
    const thumbHeight = Math.max(36, (clientHeight / scrollHeight) * trackHeight);
    const maxThumbTop = trackHeight - thumbHeight;
    const maxScrollTop = scrollHeight - clientHeight;
    const top = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;
    setThumbState({ top, height: thumbHeight, visible: canScroll });
    setShowThumb(true);
    clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      if (!dragging) setShowThumb(false);
    }, 1500);
  }, [scrollRef, dragging]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateThumb();
    el.addEventListener('scroll', updateThumb);
    const ro = new ResizeObserver(updateThumb);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateThumb);
      ro.disconnect();
    };
  }, [scrollRef, updateThumb]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const delta = clientY - dragStart.current.y;
      const el = scrollRef.current;
      if (!el) return;
      const { scrollHeight, clientHeight } = el;
      const trackHeight = clientHeight;
      const thumbHeight = Math.max(36, (clientHeight / scrollHeight) * trackHeight);
      const maxThumbTop = trackHeight - thumbHeight;
      const maxScrollTop = scrollHeight - clientHeight;
      const scrollDelta = maxThumbTop > 0 ? (delta / maxThumbTop) * maxScrollTop : 0;
      el.scrollTop = dragStart.current.scrollTop + scrollDelta;
    };
    const onUp = () => {
      setDragging(false);
      setShowThumb(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging, scrollRef]);

  function handleThumbDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStart.current = { y: clientY, scrollTop: scrollRef.current?.scrollTop || 0 };
    setDragging(true);
    setShowThumb(true);
  }

  function handleTrackClick(e) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const { scrollHeight, clientHeight } = el;
    const ratio = clickY / rect.height;
    el.scrollTop = ratio * (scrollHeight - clientHeight);
  }

  if (!thumbState.visible) return null;

  return (
    <div
      className={classNames('custom-scrollbar-track', showThumb && 'custom-scrollbar-track-visible')}
      onClick={handleTrackClick}
    >
      <div
        className={classNames('custom-scrollbar-thumb', dragging && 'custom-scrollbar-thumb-active')}
        style={{ top: thumbState.top, height: thumbState.height }}
        onMouseDown={handleThumbDown}
        onTouchStart={handleThumbDown}
      />
    </div>
  );
}

export default memo(Scrollbar);
