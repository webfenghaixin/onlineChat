import { useCallback, useEffect, useRef, useState } from 'react';
import { saveState } from '../lib/utils.js';
import { saveToCloud, loadFromCloud, fetchBalance, clearToken } from '../lib/auth.js';
import { mergeCloudData, buildCloudSaveConversations } from '../lib/cloud-utils.js';

/**
 * Cloud dirty 追踪（独立于其他 hook，无循环依赖）
 * 在 chat/draw hook 之前调用
 */
export function useCloudDirty() {
  const [cloudDirtyVersion, setCloudDirtyVersion] = useState(0);
  const [cloudSaveRetryTick, setCloudSaveRetryTick] = useState(0);

  const cloudSaveTimerRef = useRef(null);
  const cloudSavingRef = useRef(null);
  const cloudLoadingRef = useRef(false);
  const cloudSessionRef = useRef(0);
  const cloudDirtyVersionRef = useRef(0);
  const cloudSavedVersionRef = useRef(0);
  const cloudWasBusyRef = useRef(false);
  const dirtyConversationVersionsRef = useRef(new Map());
  const dirtyDrawConversationVersionsRef = useRef(new Map());

  const markCloudDirty = useCallback(({ conversationId, conversationIds, drawConversationId, drawConversationIds } = {}) => {
    const nextVersion = cloudDirtyVersionRef.current + 1;
    cloudDirtyVersionRef.current = nextVersion;
    if (conversationId) dirtyConversationVersionsRef.current.set(conversationId, nextVersion);
    for (const id of (conversationIds || [])) {
      if (id) dirtyConversationVersionsRef.current.set(id, nextVersion);
    }
    if (drawConversationId) dirtyDrawConversationVersionsRef.current.set(drawConversationId, nextVersion);
    for (const id of (drawConversationIds || [])) {
      if (id) dirtyDrawConversationVersionsRef.current.set(id, nextVersion);
    }
    setCloudDirtyVersion(nextVersion);
  }, []);

  const resetCloudDirtyState = useCallback(() => {
    clearTimeout(cloudSaveTimerRef.current);
    cloudSessionRef.current += 1;
    cloudSavingRef.current = null;
    cloudDirtyVersionRef.current = 0;
    cloudSavedVersionRef.current = 0;
    cloudWasBusyRef.current = false;
    dirtyConversationVersionsRef.current.clear();
    dirtyDrawConversationVersionsRef.current.clear();
    setCloudDirtyVersion(0);
  }, []);

  return {
    cloudDirtyVersion, cloudSaveRetryTick, setCloudSaveRetryTick,
    markCloudDirty, resetCloudDirtyState,
    cloudSaveTimerRef, cloudSavingRef, cloudLoadingRef, cloudSessionRef,
    cloudDirtyVersionRef, cloudSavedVersionRef, cloudWasBusyRef,
    dirtyConversationVersionsRef, dirtyDrawConversationVersionsRef,
  };
}

/**
 * 云同步 + 本地持久化 + 鉴权加载 useEffect
 * 接收 useCloudDirty 返回的 refs/state
 */
export function useCloudSync({
  settings,
  conversations,
  drawConversations,
  activeConversationId,
  activeDrawConversationId,
  authState,
  isSending,
  isGenerating,
  loadedState,
  setSettings,
  setConversations,
  setActiveConversationId,
  setDrawConversations,
  setActiveDrawConversationId,
  setAuthState,
  setAuthLoadingActive,
  setBalance,
  loadConversationMessages,
  conversationsRef,
  drawConversationsRef,
  cloudDirtyVersion,
  cloudSaveRetryTick,
  setCloudSaveRetryTick,
  resetCloudDirtyState,
  cloudSaveTimerRef,
  cloudSavingRef,
  cloudLoadingRef,
  cloudSessionRef,
  cloudDirtyVersionRef,
  cloudSavedVersionRef,
  cloudWasBusyRef,
  dirtyConversationVersionsRef,
  dirtyDrawConversationVersionsRef,
}) {
  // 本地持久化状态镜像，供防抖落盘、页面隐藏、卸载时取最新快照
  const localPersistStateRef = useRef({ settings, conversations, activeConversationId, drawConversations, activeDrawConversationId });
  localPersistStateRef.current = { settings, conversations, activeConversationId, drawConversations, activeDrawConversationId };
  const localPersistTimerRef = useRef(null);

  // 本地持久化：500ms trailing 防抖，避免依赖高频变化时同步写 localStorage
  useEffect(() => {
    if (localPersistTimerRef.current) window.clearTimeout(localPersistTimerRef.current);
    localPersistTimerRef.current = window.setTimeout(() => {
      localPersistTimerRef.current = null;
      saveState(localPersistStateRef.current);
    }, 500);
    return () => {
      // 依赖变化触发的清理只取消旧定时器（新一轮 effect 会重新调度），不落盘
      if (localPersistTimerRef.current) {
        window.clearTimeout(localPersistTimerRef.current);
        localPersistTimerRef.current = null;
      }
    };
  }, [settings, conversations, activeConversationId, drawConversations, activeDrawConversationId]);

  // 页面隐藏/组件卸载时，若本地持久化仍有 pending 定时器，立即清除并同步落盘一次
  useEffect(() => {
    const flushPendingLocalPersist = () => {
      if (!localPersistTimerRef.current) return;
      window.clearTimeout(localPersistTimerRef.current);
      localPersistTimerRef.current = null;
      saveState(localPersistStateRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPendingLocalPersist();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      flushPendingLocalPersist();
    };
  }, []);

  // 始终持有最新状态快照，供页面隐藏/退出时同步刷新
  const flushSnapshotRef = useRef({ settings, conversations, activeConversationId, drawConversations, activeDrawConversationId });
  flushSnapshotRef.current = { settings, conversations, activeConversationId, drawConversations, activeDrawConversationId };

  // 组件卸载标记：区分"effect 将重跑（重新排定保存）"与"卸载（不会再保存）"
  const cloudSyncUnmountedRef = useRef(false);
  useEffect(() => () => { cloudSyncUnmountedRef.current = true; }, []);

  // 构造包含所有未落库脏数据的保存 payload（页面隐藏 flush 与卸载 flush 共用）；无脏数据时返回 null
  const buildDirtyPayload = () => {
    if (cloudDirtyVersionRef.current <= cloudSavedVersionRef.current) return null;
    const conversationVersions = new Map(dirtyConversationVersionsRef.current);
    const drawConversationVersions = new Map(dirtyDrawConversationVersionsRef.current);
    if (conversationVersions.size === 0 && drawConversationVersions.size === 0) return null;
    const snapshot = flushSnapshotRef.current;
    const targetVersion = cloudDirtyVersionRef.current;
    return {
      payload: {
        settings: snapshot.settings,
        conversations: buildCloudSaveConversations(snapshot.conversations, conversationVersions, targetVersion),
        activeConversationId: snapshot.activeConversationId,
        drawConversations: buildCloudSaveConversations(snapshot.drawConversations, drawConversationVersions, targetVersion, true),
        activeDrawConversationId: snapshot.activeDrawConversationId,
      },
    };
  };

  // 页面隐藏/退出/刷新时，若仍有未同步到云端的变更，用 keepalive 请求立即上报。
  // 避免小图片生成成功后，用户在云端防抖落库前退出，导致重新进入时图片“丢失”。
  useEffect(() => {
    if (authState !== 'authenticated') return undefined;
    let lastFlushAt = 0;
    const flushIfDirty = () => {
      const now = Date.now();
      if (now - lastFlushAt < 1500) return;
      const dirtyPayload = buildDirtyPayload();
      if (!dirtyPayload) return;
      lastFlushAt = now;
      saveToCloud(dirtyPayload.payload, { keepalive: true }).catch(() => {});
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushIfDirty(); };
    const onUnload = () => flushIfDirty();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [authState]); // eslint-disable-line react-hooks/exhaustive-deps

  // 云端自动保存
  useEffect(() => {
    const isBusy = isSending || isGenerating;
    const wasBusy = cloudWasBusyRef.current;
    cloudWasBusyRef.current = isBusy;
    clearTimeout(cloudSaveTimerRef.current);
    if (
      authState !== 'authenticated'
      || isBusy
      || cloudDirtyVersionRef.current <= cloudSavedVersionRef.current
    ) {
      // 忙碌期间不丢脏数据：排 30s 兜底定时器重新触发保存尝试，
      // 避免长流式回复期间云端保存一直被挂起
      if (authState === 'authenticated' && isBusy && cloudDirtyVersionRef.current > cloudSavedVersionRef.current) {
        cloudSaveTimerRef.current = window.setTimeout(() => {
          setCloudSaveRetryTick((current) => current + 1);
        }, 30000);
      }
      return undefined;
    }

    const targetVersion = cloudDirtyVersionRef.current;
    const saveSession = cloudSessionRef.current;
    const conversationVersions = new Map(dirtyConversationVersionsRef.current);
    const drawConversationVersions = new Map(dirtyDrawConversationVersionsRef.current);
    const payload = {
      settings,
      conversations: buildCloudSaveConversations(conversations, conversationVersions, targetVersion),
      activeConversationId,
      drawConversations: buildCloudSaveConversations(drawConversations, drawConversationVersions, targetVersion, true),
      activeDrawConversationId,
    };
    const delay = wasBusy ? 2000 : 8000;

    cloudSaveTimerRef.current = window.setTimeout(() => {
      if (cloudSavingRef.current === saveSession) return;
      cloudSavingRef.current = saveSession;
      let saveSucceeded = false;
      saveToCloud(payload)
        .then(() => {
          if (cloudSessionRef.current !== saveSession) return;
          saveSucceeded = true;
          cloudSavedVersionRef.current = Math.max(cloudSavedVersionRef.current, targetVersion);
          for (const [id, version] of conversationVersions) {
            if (dirtyConversationVersionsRef.current.get(id) === version) {
              dirtyConversationVersionsRef.current.delete(id);
            }
          }
          for (const [id, version] of drawConversationVersions) {
            if (dirtyDrawConversationVersionsRef.current.get(id) === version) {
              dirtyDrawConversationVersionsRef.current.delete(id);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          if (cloudSavingRef.current === saveSession) {
            cloudSavingRef.current = null;
          }
          const hasUnsavedFollowUp = saveSucceeded
            ? cloudDirtyVersionRef.current > cloudSavedVersionRef.current
            : cloudDirtyVersionRef.current > targetVersion;
          if (cloudSessionRef.current === saveSession && hasUnsavedFollowUp) {
            setCloudSaveRetryTick((current) => current + 1);
          }
        });
    }, delay);

    return () => {
      clearTimeout(cloudSaveTimerRef.current);
      // 仅在组件卸载（而非 effect 因状态变化重跑）时兜底：
      // 定时器尚未触发且仍有未落库的脏数据 → 用最新快照构造 payload，keepalive 立即上报
      if (!cloudSyncUnmountedRef.current) return;
      const dirtyPayload = buildDirtyPayload();
      if (!dirtyPayload) return;
      saveToCloud(dirtyPayload.payload, { keepalive: true }).catch(() => {});
    };
  }, [
    authState, isSending, isGenerating, cloudDirtyVersion, cloudSaveRetryTick,
    settings, conversations, activeConversationId, drawConversations, activeDrawConversationId,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // 鉴权加载
  useEffect(() => {
    if (authState !== 'loading') {
      cloudLoadingRef.current = false;
      return;
    }
    if (cloudLoadingRef.current) return;
    cloudLoadingRef.current = true;
    resetCloudDirtyState();

    setAuthLoadingActive(true);
    // 余额与云数据并行加载，余额失败不影响鉴权进入
    fetchBalance()
      .then((r) => setBalance(r.balance))
      .catch(() => {});
    loadFromCloud()
      .then((data) => {
        const merged = mergeCloudData(loadedState, data);
        conversationsRef.current = merged.conversations;
        drawConversationsRef.current = merged.drawConversations;
        setSettings(merged.settings);
        setConversations(merged.conversations);
        setActiveConversationId(merged.activeConversationId);
        setDrawConversations(merged.drawConversations);
        setActiveDrawConversationId(merged.activeDrawConversationId);
        if ((!Array.isArray(data.conversations) || data.conversations.length === 0) && merged.activeConversationId) {
          dirtyConversationVersionsRef.current.set(merged.activeConversationId, 1);
        }
        if (merged.activeConversationId) {
          loadConversationMessages(merged.activeConversationId);
        }
        setAuthLoadingActive(false);
        setAuthState('authenticated');
      })
      .catch(() => {
        clearToken();
        setAuthLoadingActive(false);
        setAuthState('auth-form');
      });
  }, [authState]); // eslint-disable-line react-hooks/exhaustive-deps
}
