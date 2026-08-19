import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const OPTION_HEIGHT = 44;
const DROPDOWN_PAD = 24;
const GAP = 6;
const HOVER_GUESS_WIDTH = 160;

/**
 * animal-island-ui 的 Select 下拉是内联 absolute，会被祖先 overflow 裁切。
 * 这里保留库的触发交互与视觉，仅把列表用 Portal 挂到 body（position: fixed），
 * 从而既能逃出可滚动容器，又不影响容器的滚动条。
 */
export default function PortaledSelect({
  value,
  onChange,
  options,
  placeholder = '请选择',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(null);
  const wrapperRef = useRef(null);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const uid = useId();
  const listboxId = `portaled-select-${uid.replace(/:/g, '')}-listbox`;

  const selectedLabel = options.find((option) => option.key === value)?.label || placeholder;

  const close = useCallback(() => {
    setOpen(false);
    setMeasured(false);
  }, []);

  // 打开时先定位，Portal 挂载后测出真实宽高，再按视口钳制坐标
  useLayoutEffect(() => {
    if (!open) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      anchorLeft: rect.left,
      anchorTop: rect.top,
    });
    let raf;
    raf = requestAnimationFrame(() => {
      const node = dropdownRef.current;
      if (!node) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = node.offsetWidth || HOVER_GUESS_WIDTH;
      const h = node.offsetHeight || Math.min(options.length * OPTION_HEIGHT + DROPDOWN_PAD, 320);
      // 横向：左对齐触发器，视口内钳制
      let left = rect.left;
      if (left < 8) left = 8;
      if (left + w > vw - 8) left = vw - w - 8;
      // 纵向：优先向下贴住触发器；下方放不下且上方更宽裕时向上
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      let top = rect.bottom + GAP;
      if (spaceBelow < h && spaceAbove > spaceBelow) {
        top = rect.top - h - GAP;
      }
      if (top < 8) top = 8;
      if (top + h > vh - 8) top = vh - h - 8;
      setPos((current) => (current ? { ...current, left, top, w, h } : current));
      setMeasured(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 点击外部关闭（含 Portal 内的下拉）
  useEffect(() => {
    if (!open) return;
    const handler = (event) => {
      const inWrapper = wrapperRef.current?.contains(event.target);
      const inDropdown = dropdownRef.current?.contains(event.target);
      if (!inWrapper && !inDropdown) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      setActive(value ?? options[0]?.key ?? null);
    } else {
      setMeasured(false);
    }
  }, [open, value, options]);

  function toggle() {
    if (!disabled) setOpen((current) => !current);
  }

  function select(key) {
    onChange(key);
    close();
    triggerRef.current?.focus();
  }

  function onKeyDown(event) {
    if (disabled) return;
    const { key } = event;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      close();
      triggerRef.current?.focus();
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      const idx = options.findIndex((option) => option.key === active);
      const step = key === 'ArrowDown' ? 1 : -1;
      const next =
        idx < 0 ? (step === 1 ? 0 : options.length - 1) : (idx + step + options.length) % options.length;
      const nextKey = options[next]?.key;
      if (nextKey != null) setActive(nextKey);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (active) select(active);
    }
  }

  return (
    <div ref={wrapperRef} className="ps-wrapper" onKeyDown={onKeyDown}>
      <div
        ref={triggerRef}
        className={`ps-trigger ${open ? 'ps-open' : ''}`}
        onClick={toggle}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
      >
        <span className={value ? 'ps-value' : 'ps-placeholder'}>{selectedLabel}</span>
        <span className="ps-arrow" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="ps-dropdown"
            role="listbox"
            id={listboxId}
            style={{
              position: 'fixed',
              left: measured && pos?.left != null ? pos.left : pos?.anchorLeft ?? 0,
              top: measured && pos?.top != null ? pos.top : pos?.anchorTop ?? 0,
              visibility: measured ? 'visible' : 'hidden',
              minWidth: HOVER_GUESS_WIDTH,
            }}
          >
            {options.map((option) => {
              const isActive = option.key === active;
              return (
                <div
                  key={option.key}
                  id={`${listboxId}-option-${option.key}`}
                  role="option"
                  aria-selected={option.key === value}
                  className={`ps-option ${isActive ? 'ps-active' : ''}`}
                  onClick={() => select(option.key)}
                  onMouseEnter={() => setActive(option.key)}
                >
                  <span className="ps-option-dot" aria-hidden="true" />
                  {option.label}
                  {option.key === value && <div className="ps-pill" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}