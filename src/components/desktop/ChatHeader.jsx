import { Button } from 'animal-island-ui';
import { classNames } from '../../lib/utils';

export default function ChatHeader({
  selectMode,
  selectedMessageIds,
  exitSelectMode,
  deleteSelectedMessages,
  openDrawer,
  openDrawMode,
}) {
  return (
    <header className={classNames('desktop-chat-header', selectMode && 'desktop-chat-header-select')}>
      {selectMode ? (
        <>
          <Button type="text" size="small" onClick={exitSelectMode}>取消</Button>
          <div className="desktop-chat-title">
            <h1>已选 {selectedMessageIds.size} 条</h1>
          </div>
          <Button
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
            type="text"
            size="small"
            className="desktop-icon-btn"
            onClick={() => openDrawer('history')}
            aria-label="打开侧栏"
          >
            ☰
          </Button>
          <div style={{ flex: 1 }} />
          <Button
            type="text"
            size="small"
            className="desktop-icon-btn"
            onClick={openDrawMode}
            aria-label="画图"
          >
            ✏️ 画图
          </Button>
        </>
      )}
    </header>
  );
}
