import { Suspense, lazy } from 'react';
import { Loading, Tooltip } from 'animal-island-ui';
import { classNames } from '../../lib/utils';
import '../../styles/desktop.css';
import ConfirmDialog from '../shared/ConfirmDialog';
import AuthLoading from '../shared/AuthLoading';
import ChatHeader from './ChatHeader';
import Composer from './Composer';
import MessageRow from './MessageRow';
import Drawer from './Drawer';
import ThemeSwitch from './ThemeSwitch';

const AuthForm = lazy(() => import('../shared/AuthForm'));
const RechargeDialog = lazy(() => import('../shared/RechargeDialog'));
const DrawPage = lazy(() => import('./DrawPage'));

export default function DesktopApp({
  authState,
  authTab, setAuthTab,
  authForm, setAuthForm,
  authError, setAuthError,
  authLoading, setAuthLoading,
  authLoadingActive,
  setAuthState,
  setAuthLoadingActive,
  setCurrentUser,
  settings, setSettings,
  errorText, setErrorText,
  statusText,
  balance,
  rechargeDialogOpen, setRechargeDialogOpen,
  rechargeLoading, setRechargeLoading,
  handleRecharge,
  chat,
  draw,
  showScrollToBottom,
  scrollToBottom,
  composerCollapsed,
  composerFabVisible,
  expandComposer,
  collapseComposer,
  composerWrapRef,
  visibleMessages,
  hasMoreMessages,
  draftHasText,
  canSend,
  handleLogout,
  theme,
  onThemeChange,
}) {
  if (authState === 'auth-form') {
    return (
      <div className="auth-loading-overlay">
        <Suspense fallback={<div className="auth-loading-fill"><Loading active /></div>}>
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
      </div>
    );
  }

  return (
    <div className={classNames('desktop-app', `font-scale-${settings.fontSize || 'md'}`)}>
      <div className="scene-glow scene-glow-left" aria-hidden="true" />
      <div className="scene-glow scene-glow-right" aria-hidden="true" />
      <div className="scene-hills" aria-hidden="true" />

      {!draw.drawMode ? (
        <div className="desktop-chat-layout">
          <div className="desktop-sidebar-area">
            <Drawer
              drawerOpen={chat.drawerOpen} setDrawerOpen={chat.setDrawerOpen}
              drawerTab={chat.drawerTab} setDrawerTab={chat.setDrawerTab}
              conversations={chat.conversations}
              activeConversationId={chat.activeConversationId}
              switchConversation={chat.switchConversation}
              setDeleteConversationTarget={chat.setDeleteConversationTarget}
              createNewConversation={chat.createNewConversation}
              settings={settings} setSettings={setSettings}
              handleLogout={handleLogout}
            />
          </div>

          <div className="desktop-main-area">
            <ChatHeader
              selectMode={chat.selectMode}
              selectedMessageIds={chat.selectedMessageIds}
              exitSelectMode={chat.exitSelectMode}
              deleteSelectedMessages={chat.deleteSelectedMessages}
              openDrawer={chat.openDrawer}
              openDrawMode={draw.openDrawMode}
            />

            <div className="desktop-balance-bar">
              <span>余额：{balance !== null ? `${balance} 次` : '加载中...'}</span>
              <div className="desktop-balance-actions">
                <ThemeSwitch theme={theme} onThemeChange={onThemeChange} />
                <button type="button" className="desktop-recharge-btn" onClick={() => setRechargeDialogOpen(true)}>
                  充值
                </button>
              </div>
            </div>

            <div className="desktop-message-area">
              <section className="message-list desktop-message-list" ref={chat.messageListRef} aria-live="polite">
                {chat.convLoading && visibleMessages.length === 0 && (
                  <div className="desktop-empty-hint">加载对话中...</div>
                )}
                {hasMoreMessages && (
                  <div className="desktop-load-more">
                    <button type="button" onClick={() => chat.setVisibleMessageCount((c) => c + 50)}>
                      加载更早消息（还有 {chat.activeMessages.length - chat.visibleMessageCount} 条）
                    </button>
                  </div>
                )}
                {visibleMessages.length === 0 && !chat.isSending && !chat.convLoading && (
                  <div className="desktop-welcome">
                    <div className="desktop-welcome-card">
                      <div className="desktop-welcome-label">岛上广播</div>
                      <h2>开始一段新对话</h2>
                      <p>在下方输入你的问题，或者先点一个常用方向。</p>
                      <div className="desktop-suggestions">
                        <button type="button" onClick={() => chat.quickFill('帮我把这段中文文案润色得更自然、更口语一些')}>润色文案</button>
                        <button type="button" onClick={() => chat.quickFill('帮我整理一个本周工作计划，按优先级和时间块输出')}>整理计划</button>
                        <button type="button" onClick={() => chat.quickFill('请把这段内容总结成 5 条重点，并补充一个执行建议')}>总结重点</button>
                        <button type="button" onClick={() => chat.quickFill('我想做一个 H5 页面，请先帮我梳理结构、文案和视觉方向')}>页面策划</button>
                      </div>
                    </div>
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
              {showScrollToBottom && (
                <Tooltip title="回到底部" placement="top" className="desktop-scroll-btn-wrap">
                  <button type="button" className="desktop-scroll-btn" onClick={scrollToBottom}>↓</button>
                </Tooltip>
              )}
            </div>

            <div
              ref={composerWrapRef}
              className={`composer-transition-wrap desktop-composer-wrap ${composerCollapsed ? 'composer-collapsed' : ''}`}
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

            {composerCollapsed && composerFabVisible && (
              <button
                type="button"
                className={`composer-fab${composerFabVisible ? ' composer-fab-visible' : ''}`}
                onClick={expandComposer}
                aria-label="展开输入框"
              >
                ↑
              </button>
            )}
          </div>
        </div>
      ) : (
        <Suspense fallback={<div className="desktop-loading"><Loading active /></div>}>
          <DrawPage
            settings={settings} setSettings={setSettings}
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

      <ConfirmDialog
        visible={Boolean(chat.deleteConversationTarget)}
        title="删除这条对话？"
        description="对话中的所有消息都会被删除，此操作不可撤销。"
        titleId="desktop-delete-conversation-title"
        onCancel={() => chat.setDeleteConversationTarget(null)}
        onConfirm={() => { chat.removeConversation(chat.deleteConversationTarget); chat.setDeleteConversationTarget(null); }}
      />

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
