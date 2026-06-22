import { Button } from 'animal-island-ui';
import { classNames } from '../lib/utils';

export default function ChatHeader({
  selectMode,
  selectedMessageIds,
  exitSelectMode,
  deleteSelectedMessages,
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
          <Button className="select-header-button" type="text" size="small" onClick={exitSelectMode}>取消</Button>
          <div className="chat-title">
            <h1>已选 {selectedMessageIds.size} 条</h1>
          </div>
          <Button
            className="select-header-button"
            type="primary"
            danger
            size="small"
            onClick={deleteSelectedMessages}
            disabled={selectedMessageIds.size === 0}
            aria-label="删除"
          >
            删除
          </Button>
        </>
      ) : (
        <>
          <Button
            type="default"
            size="small"
            className="mobile-header-button mobile-header-button-menu"
            onClick={() => openDrawer('history')}
            aria-label="打开侧栏"
          >
            ☰
          </Button>

          <div className="chat-title">
            <h1>{activeConversation?.title || 'lightChat'}</h1>
          </div>

          <Button
            type="primary"
            size="small"
            className="mobile-header-button mobile-draw-button"
            onClick={openDrawMode}
            aria-label="画图"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
            画图
          </Button>
        </>
      )}
    </header>
  );
}
