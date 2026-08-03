import { Suspense, useCallback, useEffect, useMemo, useRef, useState, lazy } from 'react';
import {
  getToken, clearToken, getStoredUsername, rechargeBalance,
} from '../lib/auth.js';
import { loadState, classNames } from '../lib/utils.js';
import { COST_CHAT } from '../lib/constants.js';
import { useScrollCollapse } from '../hooks/useScrollCollapse.js';
import { useCloudDirty, useCloudSync } from '../hooks/useCloudSync.js';
import { useChatActions } from '../hooks/useChatActions.js';
import { useDrawActions } from '../hooks/useDrawActions.js';

import AuthLoading from '../components/AuthLoading';
import Drawer from '../components/Drawer';
import ChatHeader from '../components/ChatHeader';
import MessageRow from '../components/MessageRow';
import Scrollbar from '../components/Scrollbar';
import Composer from '../components/Composer';
import ConfirmDialog from '../components/ConfirmDialog';
import BalanceBar from '../components/BalanceBar';
import { Button, Card, Divider, Footer, Loading, Title } from 'animal-island-ui';

const AuthForm = lazy(() => import('../components/AuthForm'));
const DrawPage = lazy(() => import('../components/DrawPage'));
const RechargeDialog = lazy(() => import('../components/RechargeDialog'));

export default function IndexPage() {
  const loadedState = useMemo(() => loadState(), []);
  const [settings, setSettings] = useState(loadedState.settings);
  const [errorText, setErrorText] = useState('');
  const [statusText, setStatusText] = useState('已就绪');
  const [balance, setBalance] = useState(null);
  const [rechargeDialogOpen, setRechargeDialogOpen] = useState(false);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [authState, setAuthState] = useState(() => (getToken() ? 'loading' : 'auth-form'));
  const [authLoadingActive, setAuthLoadingActive] = useState(true);
  const [authTab, setAuthTab] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '', inviteCode: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => getStoredUsername());

  // 云脏数据追踪（独立 hook，先调用以获取 markCloudDirty，避免循环依赖）
  const cloudDirty = useCloudDirty();
  const { markCloudDirty, resetCloudDirtyState } = cloudDirty;

  const updateSettings = useCallback((updater) => {
    setSettings((current) => (typeof updater === 'function' ? updater(current) : updater));
    markCloudDirty();
  }, [markCloudDirty]);

  // 聊天逻辑
  const chat = useChatActions({
    settings, authState, balance, markCloudDirty,
    setBalance, setErrorText, setStatusText, setRechargeDialogOpen,
  });

  // 制图逻辑
  const draw = useDrawActions({
    settings, authState, balance, markCloudDirty,
    setBalance, setErrorText, setStatusText, setRechargeDialogOpen,
  });

  // 云同步 + 本地持久化 + 鉴权加载（依赖 chat/draw 状态，最后调用）
  useCloudSync({
    settings,
    conversations: chat.conversations,
    drawConversations: draw.drawConversations,
    activeConversationId: chat.activeConversationId,
    activeDrawConversationId: draw.activeDrawConversationId,
    authState,
    isSending: chat.isSending,
    isGenerating: draw.isGenerating,
    loadedState,
    setSettings,
    setConversations: chat.setConversations,
    setActiveConversationId: chat.setActiveConversationId,
    setDrawConversations: draw.setDrawConversations,
    setActiveDrawConversationId: draw.setActiveDrawConversationId,
    setAuthState,
    setAuthLoadingActive,
    setBalance,
    loadConversationMessages: chat.loadConversationMessages,
    conversationsRef: chat.conversationsRef,
    drawConversationsRef: draw.drawConversationsRef,
    ...cloudDirty,
  });

  // 滚动收起
  const composerWrapRef = useRef(null);

  const {
    showScrollToBottom, composerCollapsed, composerFabVisible,
    scrollToBottom, forceScrollToBottom, expandComposer, collapseComposer,
  } = useScrollCollapse({
    messageListRef: chat.messageListRef,
    authState,
    activeConversationId: chat.activeConversationId,
    latestMessageRenderKey: chat.activeMessages.length,
    visibleMessageCount: chat.visibleMessageCount,
    selectMode: chat.selectMode,
  });

  // 动态监听输入框高度，设置 CSS 变量 --composer-height 供消息列表 padding 使用
  // 输入框已脱离文档流（absolute），消息列表靠 padding-bottom 预留空间
  useEffect(() => {
    const list = chat.messageListRef.current;
    if (!list) return undefined;
    // 选择模式下无输入框，无需底部留白
    if (chat.selectMode) {
      list.style.setProperty('--composer-height', '0px');
      return undefined;
    }
    const wrap = composerWrapRef.current;
    const panel = wrap?.querySelector('.composer-panel');
    if (!panel) {
      list.style.setProperty('--composer-height', composerCollapsed ? '68px' : '80px');
      return undefined;
    }
    const apply = () => {
      const h = composerCollapsed ? 68 : panel.offsetHeight;
      list.style.setProperty('--composer-height', `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(panel);
    return () => ro.disconnect();
  }, [composerCollapsed, chat.selectMode]);

  // 派生
  const draftHasText = chat.draft.trim().length > 0;
  const canSend = Boolean(chat.activeConversation?.messagesLoaded)
    && !chat.convLoading
    && (draftHasText || chat.pendingImages.length > 0)
    && !chat.isSending
    && authState === 'authenticated';

  const visibleMessages = useMemo(() => {
    if (chat.activeMessages.length <= chat.visibleMessageCount) return chat.activeMessages;
    return chat.activeMessages.slice(-chat.visibleMessageCount);
  }, [chat.activeMessages, chat.visibleMessageCount]);
  const hasMoreMessages = chat.activeMessages.length > chat.visibleMessageCount;

  const handleRecharge = useCallback(async (amount) => {
    setRechargeLoading(true);
    try {
      const r = await rechargeBalance(amount);
      setBalance(r.balance);
      setRechargeDialogOpen(false);
    } catch (error) {
      setErrorText(error.message || '充值失败');
    } finally {
      setRechargeLoading(false);
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearToken();
    resetCloudDirtyState();
    setCurrentUser('');
    setAuthState('auth-form');
    chat.setDrawerOpen(false);
    setStatusText('已退出登录');
  }, [resetCloudDirtyState, chat]);

  // 401 监听
  useEffect(() => {
    function onUnauthorized() {
      resetCloudDirtyState();
      setCurrentUser('');
      setAuthState('auth-form');
      chat.setDrawerOpen(false);
      draw.setDrawMode(false);
      setErrorText('登录已过期，请重新登录');
    }
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, [resetCloudDirtyState, chat, draw]);

  // 注入 markCloudDirty 到 chat/draw（hooks 顺序限制的解决方案）
  // chat 和 draw 的 markCloudDirty 通过闭包引用，需要确保它们拿到正确的函数
  // 由于 React hooks 不能条件调用，我们用 ref + useEffect 模式

  if (authState === 'auth-form') {
    return (
      <Suspense fallback={<div className="auth-loading-overlay"><div className="auth-loading-fill"><Loading active /></div></div>}>
        <AuthForm
          authTab={authTab} setAuthTab={setAuthTab}
          authForm={authForm} setAuthForm={setAuthForm}
          authError={authError} setAuthError={setAuthError}
          authLoading={authLoading} setAuthLoading={setAuthLoading}
          setAuthState={setAuthState}
          setAuthLoadingActive={setAuthLoadingActive}
          setCurrentUser={setCurrentUser}
        />
      </Suspense>
    );
  }

  return (
    <div className={classNames('chat-app', `font-scale-${settings.fontSize || 'md'}`)}>
      <div className="scene-glow scene-glow-left" aria-hidden="true" />
      <div className="scene-glow scene-glow-right" aria-hidden="true" />
      <div className="scene-hills" aria-hidden="true" />
      <Footer type="tree" className="scene-footer scene-footer-tree pc-only" />
      <Footer type="sea" seamless className="scene-footer scene-footer-sea pc-only" />

      <Drawer
        drawerOpen={chat.drawerOpen} setDrawerOpen={chat.setDrawerOpen}
        drawerTab={chat.drawerTab} setDrawerTab={chat.setDrawerTab}
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        switchConversation={chat.switchConversation}
        setDeleteConversationTarget={chat.setDeleteConversationTarget}
        createNewConversation={chat.createNewConversation}
        settings={settings} setSettings={updateSettings}
        handleLogout={handleLogout}
      />

      <ConfirmDialog
        visible={Boolean(chat.deleteConversationTarget)}
        title="删除这条对话？"
        description="对话中的所有消息都会被删除，此操作不可撤销。"
        titleId="delete-conversation-title"
        onCancel={() => chat.setDeleteConversationTarget(null)}
        onConfirm={() => { chat.removeConversation(chat.deleteConversationTarget); chat.setDeleteConversationTarget(null); }}
      />

      <main className="phone-shell chat-shell">
        <ChatHeader
          selectMode={chat.selectMode}
          selectedMessageIds={chat.selectedMessageIds}
          exitSelectMode={chat.exitSelectMode}
          deleteSelectedMessages={chat.deleteSelectedMessages}
          selectAllUserMessages={chat.selectAllUserMessages}
          selectAllAssistantMessages={chat.selectAllAssistantMessages}
          openDrawer={chat.openDrawer}
          activeConversation={chat.activeConversation}
          isSending={chat.isSending}
          statusText={statusText}
          openDrawMode={draw.openDrawMode}
        />
        {!draw.drawMode && (
          <BalanceBar balance={balance} cost={COST_CHAT} onRecharge={() => setRechargeDialogOpen(true)} />
        )}

        <div className="message-list-wrapper">
          <section className="message-list" ref={chat.messageListRef} aria-live="polite">
            {chat.convLoading && visibleMessages.length === 0 && (
              <div className="conv-loading-hint"><Loading active /><span>加载对话中...</span></div>
            )}
            {hasMoreMessages && (
              <div className="load-more-bar">
                <Button type="dashed" size="small" onClick={() => chat.setVisibleMessageCount((c) => c + 50)}>
                  加载更早消息（还有 {chat.activeMessages.length - chat.visibleMessageCount} 条）
                </Button>
              </div>
            )}
            {visibleMessages.length === 0 && !chat.isSending && !chat.convLoading && (
              <div className="empty-state">
                <Card className="welcome-panel" type="dashed" pattern="default">
                  <div className="welcome-label">岛上广播</div>
                  <Title size="large" color="app-yellow">开始一段新对话</Title>
                  <p>在下方输入你的问题，或者先点一个常用方向，让这次对话更快进入状态。</p>
                  <Divider type="wave-yellow" className="welcome-divider" />
                  <div className="suggestions">
                    <button type="button" onClick={() => chat.quickFill('帮我把这段中文文案润色得更自然、更口语一些')}>润色文案</button>
                    <button type="button" onClick={() => chat.quickFill('帮我整理一个本周工作计划，按优先级和时间块输出')}>整理计划</button>
                    <button type="button" onClick={() => chat.quickFill('请把这段内容总结成 5 条重点，并补充一个执行建议')}>总结重点</button>
                    <button type="button" onClick={() => chat.quickFill('我想做一个 H5 页面，请先帮我梳理结构、文案和视觉方向')}>页面策划</button>
                  </div>
                </Card>
              </div>
            )}
            {visibleMessages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                isLatestAssistant={chat.isSending && message.role === 'assistant' && message === chat.activeMessages[chat.activeMessages.length - 1]}
                isSending={chat.isSending}
                copiedMessageId={chat.copiedMessageId}
                onCopy={chat.copyMessage}
                onRetry={chat.retryMessage}
                selectMode={chat.selectMode}
                selected={chat.selectedMessageIds.has(message.id)}
                onToggleSelect={chat.toggleMessageSelection}
                onEnterSelectMode={chat.enterSelectMode}
              />
            ))}
            <div ref={chat.messagesEndRef} />
          </section>
          <Scrollbar scrollRef={chat.messageListRef} />
          {showScrollToBottom && (
            <Button type="default" size="small" className="scroll-to-bottom-button" onClick={scrollToBottom} aria-label="滚动到底部"
              icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 10 17 15 12" /><line x1="10" y1="3" x2="10" y2="17" /></svg>}
            />
          )}
          {composerCollapsed && !chat.selectMode && (
            <button type="button" className={`composer-fab${composerFabVisible ? ' composer-fab-visible' : ''}`} onClick={expandComposer} aria-label="展开输入框">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
              </svg>
            </button>
          )}
        </div>

        {!chat.selectMode && (
          <div
            ref={composerWrapRef}
            className={`composer-transition-wrap${composerCollapsed ? ' composer-collapsed' : ''}`}
          >
            <Composer
              draft={chat.draft} setDraft={chat.setDraft}
              isSending={chat.isSending} canSend={canSend}
              sendMessage={chat.sendMessage} stopStreaming={chat.stopStreaming}
              handleComposerKeyDown={chat.handleComposerKeyDown}
              selectMode={chat.selectMode} selectedMessageIds={chat.selectedMessageIds}
              exitSelectMode={chat.exitSelectMode}
              selectAllUserMessages={chat.selectAllUserMessages}
              selectAllAssistantMessages={chat.selectAllAssistantMessages}
              deleteSelectedMessages={chat.deleteSelectedMessages}
              showCompleteHint={chat.showCompleteHint}
              errorText={errorText}
              pendingImages={chat.pendingImages}
              removePendingImage={chat.removePendingImage}
              clearPendingImages={chat.clearPendingImages}
              handleUploadClick={chat.handleUploadClick}
              imageProcessing={chat.imageProcessing}
              composerRef={chat.composerRef} fileInputRef={chat.fileInputRef}
              handleFileChange={chat.handleFileChange} handleComposerPaste={chat.handleComposerPaste}
              onCollapse={collapseComposer}
            />
          </div>
        )}
      </main>

      {draw.drawMode && (
        <Suspense fallback={<div className="draw-page draw-page-skeleton"><Loading active /></div>}>
          <DrawPage
            settings={settings} setSettings={updateSettings}
            drawConversations={draw.drawConversations}
            activeDrawConversationId={draw.activeDrawConversationId}
            switchDrawConversation={draw.switchDrawConversation}
            activeDrawConversation={draw.activeDrawConversation}
            activeDrawMessages={draw.activeDrawMessages}
            drawImageCount={draw.drawImageCount}
            isGenerating={draw.isGenerating}
            pendingDrawTaskCount={draw.pendingDrawTaskCount}
            isDrawSubmitting={draw.isDrawSubmitting}
            drawPrompt={draw.drawPrompt} setDrawPrompt={draw.setDrawPrompt}
            drawPendingImages={draw.drawPendingImages} setDrawPendingImages={draw.setDrawPendingImages}
            drawDrawerOpen={draw.drawDrawerOpen} setDrawDrawerOpen={draw.setDrawDrawerOpen}
            drawSelectMode={draw.drawSelectMode} drawSelectedMessageIds={draw.drawSelectedMessageIds}
            errorText={errorText} setErrorText={setErrorText}
            drawLimitWarning={draw.drawLimitWarning} setDrawLimitWarning={draw.setDrawLimitWarning}
            deleteDrawTarget={draw.deleteDrawTarget} setDeleteDrawTarget={draw.setDeleteDrawTarget}
            deleteDrawConversationTarget={draw.deleteDrawConversationTarget}
            setDeleteDrawConversationTarget={draw.setDeleteDrawConversationTarget}
            closeDrawMode={draw.closeDrawMode}
            createNewDrawConversation={draw.createNewDrawConversation}
            removeDrawConversation={draw.removeDrawConversation}
            handleDraw={draw.handleDraw} downloadImage={draw.downloadImage}
            requestDeleteDrawMessage={draw.requestDeleteDrawMessage}
            cancelDeleteDrawMessage={draw.cancelDeleteDrawMessage}
            confirmDeleteDrawMessage={draw.confirmDeleteDrawMessage}
            exitDrawSelectMode={draw.exitDrawSelectMode}
            enterDrawSelectMode={draw.enterDrawSelectMode}
            toggleDrawMessageSelection={draw.toggleDrawMessageSelection}
            selectAllDrawUserMessages={draw.selectAllDrawUserMessages}
            selectAllDrawAssistantMessages={draw.selectAllDrawAssistantMessages}
            deleteSelectedDrawMessages={draw.deleteSelectedDrawMessages}
            drawFileInputRef={draw.drawFileInputRef}
            authState={authState} balance={balance}
            onRecharge={() => setRechargeDialogOpen(true)}
            drawConvLoading={draw.drawConvLoading}
            retryDraw={draw.retryDraw} editDrawMessage={draw.editDrawMessage}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <RechargeDialog
          visible={rechargeDialogOpen}
          balance={balance}
          loading={rechargeLoading}
          onRecharge={handleRecharge}
          onCancel={() => setRechargeDialogOpen(false)}
        />
      </Suspense>

      {authState === 'loading' && <AuthLoading active={authLoadingActive} />}
    </div>
  );
}
