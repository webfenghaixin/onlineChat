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
  // 本地持久化
  useEffect(() => {
    saveState({
      settings,
      conversations,
      activeConversationId,
      drawConversations,
      activeDrawConversationId,
    });
  }, [settings, conversations, activeConversationId, drawConversations, activeDrawConversationId]);

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

    return () => clearTimeout(cloudSaveTimerRef.current);
  }, [
    authState, isSending, isGenerating, cloudDirtyVersion, cloudSaveRetryTick,
    settings, conversations, activeConversationId, drawConversations, activeDrawConversationId,
  ]);

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
