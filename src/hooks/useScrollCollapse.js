import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 滚动 + 输入框收起/展开 + 键盘适配
 * 自包含所有滚动相关 state/refs/useEffect
 */
export function useScrollCollapse({
  messageListRef,
  authState,
  activeConversationId,
  latestMessageRenderKey,
  visibleMessageCount,
  selectMode,
}) {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [composerFabVisible, setComposerFabVisible] = useState(false);

  const programmaticScrollRef = useRef(false);
  const atBottomRef = useRef(true);
  const userExpandedRef = useRef(false);
  const userCollapsedRef = useRef(false);
  const keyboardVisibleRef = useRef(false);
  const collapseDebounceRef = useRef(0);
  // 用户手动收起后，必须先把列表滚离底部，回到底部时才自动展开，避免收起瞬间被滚动事件弹回
  const collapsedLeftBottomRef = useRef(false);

  // 带滞后阈值的滚动状态更新
  // 进入底部需 distance < 40px，离开底部需 distance > 半个屏幕
  // 用户手动展开后锁定，键盘弹出时不自动收起，状态切换后 300ms 防抖
  const updateScrollState = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const leaveThreshold = el.clientHeight * 0.5;

    if (userExpandedRef.current) {
      if (distance < 40) {
        userExpandedRef.current = false;
        atBottomRef.current = true;
        setComposerCollapsed(false);
      }
      setShowScrollToBottom(distance >= 40);
      return;
    }

    // 用户手动收起后，需先把列表滚离底部（distance > 半个屏幕）才解除锁定，
    // 滚回底部时自动展开；避免收起后 padding 变化触发的滚动事件瞬间弹回
    if (userCollapsedRef.current) {
      if (!collapsedLeftBottomRef.current && distance > leaveThreshold) {
        collapsedLeftBottomRef.current = true;
      }
      if (collapsedLeftBottomRef.current && distance < 40) {
        userCollapsedRef.current = false;
        collapsedLeftBottomRef.current = false;
        atBottomRef.current = true;
        setComposerCollapsed(false);
      }
      setShowScrollToBottom(distance >= 40);
      return;
    }

    let atBottom = atBottomRef.current;
    if (atBottom && distance > leaveThreshold) {
      atBottom = false;
    } else if (!atBottom && distance < 40) {
      atBottom = true;
    }

    if (!atBottom && keyboardVisibleRef.current) {
      setShowScrollToBottom(distance >= 40);
      return;
    }

    const now = Date.now();
    if (now - collapseDebounceRef.current < 300) {
      setShowScrollToBottom(distance >= 40);
      return;
    }

    const prevAtBottom = atBottomRef.current;
    atBottomRef.current = atBottom;
    if (prevAtBottom !== atBottom) {
      collapseDebounceRef.current = now;
    }
    setShowScrollToBottom(!atBottom);
    setComposerCollapsed(!atBottom);
  }, [messageListRef]);

  const expandComposer = useCallback(() => {
    userExpandedRef.current = true;
    userCollapsedRef.current = false;
    setComposerCollapsed(false);
  }, []);

  const collapseComposer = useCallback(() => {
    userCollapsedRef.current = true;
    userExpandedRef.current = false;
    collapsedLeftBottomRef.current = false;
    atBottomRef.current = false;
    setComposerCollapsed(true);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    userExpandedRef.current = false;
    userCollapsedRef.current = false;
    collapsedLeftBottomRef.current = false;
    atBottomRef.current = true;
    setShowScrollToBottom(false);
    setComposerCollapsed(false);
    const doScroll = () => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    doScroll();
    // 输入框展开会让底部 padding（--composer-height）变大，滚动目标后移；
    // 等布局稳定后重定向一次，确保平滑滚动朝真正的底部进行
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
    // 兜底：平滑滚动可能被输入框展开引起的布局变化打断，结束时精确校正到最底部
    window.setTimeout(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 4) {
        const prevBehavior = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        el.scrollTop = el.scrollHeight;
        el.style.scrollBehavior = prevBehavior;
      }
      programmaticScrollRef.current = false;
    }, 700);
  }, [messageListRef]);

  const forceScrollToBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    userExpandedRef.current = false;
    userCollapsedRef.current = false;
    collapsedLeftBottomRef.current = false;
    atBottomRef.current = true;
    setShowScrollToBottom(false);
    setComposerCollapsed(false);
    const doScroll = () => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    doScroll();
    // 输入框展开会让底部 padding 变大，等布局稳定后重定向一次
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
    window.setTimeout(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 4) {
        const prevBehavior = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        el.scrollTop = el.scrollHeight;
        el.style.scrollBehavior = prevBehavior;
      }
      programmaticScrollRef.current = false;
    }, 700);
  }, [messageListRef]);

  // FAB 可见性同步
  useEffect(() => {
    if (composerCollapsed) {
      const timer = setTimeout(() => setComposerFabVisible(true), 180);
      return () => clearTimeout(timer);
    }
    setComposerFabVisible(false);
    return undefined;
  }, [composerCollapsed]);

  // 监听用户滚动
  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      updateScrollState();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateScrollState, authState, messageListRef]);

  // 消息变化时更新滚动状态
  useEffect(() => {
    if (authState !== 'authenticated') return undefined;
    const rafId = requestAnimationFrame(() => {
      if (programmaticScrollRef.current) return;
      updateScrollState();
    });
    return () => cancelAnimationFrame(rafId);
  }, [latestMessageRenderKey, visibleMessageCount, updateScrollState, authState]);

  // 登录完成后滚到底
  useEffect(() => {
    if (authState === 'authenticated') {
      forceScrollToBottom();
    }
  }, [authState, forceScrollToBottom]);

  // 切换对话时滚到底
  useEffect(() => {
    if (authState === 'authenticated') {
      forceScrollToBottom();
    }
  }, [activeConversationId, authState, forceScrollToBottom]);

  // visualViewport：键盘适配 + 稳定高度
  useEffect(() => {
    const vv = window.visualViewport;
    let rafId = null;
    let stableWidth = window.innerWidth || document.documentElement.clientWidth;
    let stableHeight = window.innerHeight || document.documentElement.clientHeight;

    function applyStableHeight() {
      document.documentElement.style.setProperty('--app-height', `${Math.max(320, Math.round(stableHeight))}px`);
    }

    function applyKeyboardOffset() {
      if (!vv) {
        document.documentElement.style.setProperty('--keyboard-offset', '0px');
        keyboardVisibleRef.current = false;
        return;
      }
      const keyboardOffset = Math.max(0, stableHeight - vv.height - vv.offsetTop);
      const visible = keyboardOffset > 80;
      document.documentElement.style.setProperty(
        '--keyboard-offset',
        `${Math.round(visible ? keyboardOffset : 0)}px`,
      );
      // 键盘刚弹出且正停留在底部时，底部 padding 会随 --keyboard-offset 增大，
      // 需自动滚到新底部，避免最后一条消息被键盘盖住
      if (visible && !keyboardVisibleRef.current && atBottomRef.current) {
        const el = messageListRef.current;
        if (el) {
          programmaticScrollRef.current = true;
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          setTimeout(() => { programmaticScrollRef.current = false; }, 500);
        }
      }
      keyboardVisibleRef.current = visible;
    }

    function onViewportChange() {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const nextWidth = window.innerWidth || document.documentElement.clientWidth;
        const nextHeight = window.innerHeight || document.documentElement.clientHeight;
        const widthChanged = Math.abs(nextWidth - stableWidth) > 24;
        if (widthChanged) {
          stableWidth = nextWidth;
          stableHeight = nextHeight;
        } else if (nextHeight > stableHeight) {
          stableHeight = nextHeight;
        }
        applyStableHeight();
        applyKeyboardOffset();
        window.scrollTo(0, 0);
      });
    }

    applyStableHeight();
    applyKeyboardOffset();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    window.addEventListener('focusin', onViewportChange);
    window.addEventListener('focusout', onViewportChange);
    vv?.addEventListener('resize', onViewportChange);
    vv?.addEventListener('scroll', onViewportChange);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      window.removeEventListener('focusin', onViewportChange);
      window.removeEventListener('focusout', onViewportChange);
      vv?.removeEventListener('resize', onViewportChange);
      vv?.removeEventListener('scroll', onViewportChange);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return {
    showScrollToBottom,
    composerCollapsed,
    composerFabVisible,
    setComposerCollapsed,
    scrollToBottom,
    forceScrollToBottom,
    expandComposer,
    collapseComposer,
  };
}
