import { useCallback, useState } from 'react';

/**
 * 制图选择模式 + 消息删除逻辑（从 useDrawActions 拆分）
 */
export function useDrawSelection({
  activeDrawConversation,
  activeDrawMessages,
  updateDrawConversation,
  setDrawConversations,
  setErrorText,
}) {
  const [drawSelectMode, setDrawSelectMode] = useState(false);
  const [drawSelectedMessageIds, setDrawSelectedMessageIds] = useState(new Set());
  const [deleteDrawTarget, setDeleteDrawTarget] = useState(null);

  const requestDeleteDrawMessage = useCallback((conversationId, messageId) => {
    setDeleteDrawTarget({ conversationId, messageId });
  }, []);
  const cancelDeleteDrawMessage = useCallback(() => setDeleteDrawTarget(null), []);
  const confirmDeleteDrawMessage = useCallback(() => {
    if (!deleteDrawTarget) return;
    const { conversationId, messageId } = deleteDrawTarget;
    updateDrawConversation(conversationId, (conv) => {
      const msgs = conv.messages || [];
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx < 0) return conv;
      const targetMessage = msgs[idx];
      if (targetMessage.batchId) {
        return { ...conv, messages: msgs.filter((m) => m.batchId !== targetMessage.batchId) };
      }
      const newMessages = [...msgs];
      if (newMessages[idx].role === 'assistant' && idx > 0 && newMessages[idx - 1].role === 'user') {
        newMessages.splice(idx - 1, 2);
      } else if (newMessages[idx].role === 'user' && idx + 1 < newMessages.length && newMessages[idx + 1].role === 'assistant') {
        newMessages.splice(idx, 2);
      } else {
        newMessages.splice(idx, 1);
      }
      return { ...conv, messages: newMessages };
    });
    setDrawConversations((current) => current.filter((c) => (
      c.id !== conversationId || !c.messagesLoaded || (c.messages || []).length > 0
    )));
    setDeleteDrawTarget(null);
  }, [deleteDrawTarget, updateDrawConversation, setDrawConversations]);

  const enterDrawSelectMode = useCallback(() => {
    setDrawSelectMode(true); setDrawSelectedMessageIds(new Set()); setErrorText('');
  }, [setErrorText]);
  const exitDrawSelectMode = useCallback(() => {
    setDrawSelectMode(false); setDrawSelectedMessageIds(new Set());
  }, []);
  const toggleDrawMessageSelection = useCallback((messageId) => {
    setDrawSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
      return next;
    });
  }, []);
  const selectAllDrawUserMessages = useCallback(() => {
    setDrawSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeDrawMessages.forEach((m) => { if (m.role === 'user') next.add(m.id); });
      return next;
    });
  }, [activeDrawMessages]);
  const selectAllDrawAssistantMessages = useCallback(() => {
    setDrawSelectedMessageIds((prev) => {
      const next = new Set(prev);
      activeDrawMessages.forEach((m) => { if (m.role === 'assistant') next.add(m.id); });
      return next;
    });
  }, [activeDrawMessages]);
  const deleteSelectedDrawMessages = useCallback(() => {
    if (!activeDrawConversation || drawSelectedMessageIds.size === 0) return;
    updateDrawConversation(activeDrawConversation.id, (conversation) => {
      const removableIds = new Set(drawSelectedMessageIds);
      const msgs = conversation.messages || [];
      msgs.forEach((message, index) => {
        if (!drawSelectedMessageIds.has(message.id)) return;
        if (message.batchId) {
          msgs.forEach((batchMessage) => {
            if (batchMessage.batchId === message.batchId) removableIds.add(batchMessage.id);
          });
          return;
        }
        if (message.role === 'user') {
          const nextMessage = msgs[index + 1];
          if (nextMessage?.role === 'assistant') removableIds.add(nextMessage.id);
        }
        if (message.role === 'assistant') {
          const previousMessage = msgs[index - 1];
          if (previousMessage?.role === 'user') removableIds.add(previousMessage.id);
        }
      });
      const remainingMessages = msgs.filter((m) => !removableIds.has(m.id));
      return { ...conversation, title: remainingMessages.length ? conversation.title : '新的画图', messages: remainingMessages };
    });
    exitDrawSelectMode();
  }, [activeDrawConversation, drawSelectedMessageIds, updateDrawConversation, exitDrawSelectMode]);

  return {
    drawSelectMode, drawSelectedMessageIds,
    deleteDrawTarget, setDeleteDrawTarget,
    requestDeleteDrawMessage, cancelDeleteDrawMessage, confirmDeleteDrawMessage,
    enterDrawSelectMode, exitDrawSelectMode, toggleDrawMessageSelection,
    selectAllDrawUserMessages, selectAllDrawAssistantMessages, deleteSelectedDrawMessages,
  };
}
