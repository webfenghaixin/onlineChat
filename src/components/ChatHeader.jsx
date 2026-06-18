import { classNames } from '../lib/utils';

export default function ChatHeader({
  selectMode,
  selectedMessageIds,
  exitSelectMode,
  deleteSelectedMessages,
  selectAllUserMessages,
  selectAllAssistantMessages,
  openDrawer,
  activeConversation,
  isSending,
  statusText,
  openDrawMode,
}) {
  return (
    <header className={classNames('chat-header', selectMode ? 'chat-header-select' : 'chat-header-3col')}>
      {selectMode ? (
        <>
          <button className="header-button header-button-text" type="button" onClick={exitSelectMode}>
            取消
          </button>
          <div className="chat-title">
            <h1>已选 {selectedMessageIds.size} 条</h1>
          </div>
          <button className="header-button header-button-icon" type="button" onClick={deleteSelectedMessages} disabled={selectedMessageIds.size === 0} aria-label="删除">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
          </button>
        </>
      ) : (
        <>
          <button className="header-button header-button-icon" type="button" onClick={() => openDrawer('history')}>
            <span aria-hidden="true">☰</span>
          </button>

          <div className="chat-title">
            <img className="header-logo" src="/logo-2.png" alt="" />
            <h1>{activeConversation?.title || 'lightChat'}</h1>
            <p>
              <span className={classNames('status-dot', isSending && 'status-dot-live')} />
              {statusText}
            </p>
          </div>

          <button className="header-button header-button-icon draw-header-button" type="button" onClick={openDrawMode} aria-label="画图">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
          </button>
        </>
      )}
    </header>
  );
}
