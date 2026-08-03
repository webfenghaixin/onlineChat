import { normalizeState, createConversation } from './utils.js';

export function mergeCloudData(localData, cloudData) {
  if (!cloudData) {
    return localData;
  }

  const hasCloudConversations = Array.isArray(cloudData.conversations) && cloudData.conversations.length > 0;
  const hasCloudDrawConversations = Array.isArray(cloudData.drawConversations) && cloudData.drawConversations.length > 0;
  const normalized = normalizeState({
    settings: cloudData.settings || localData.settings,
    conversations: hasCloudConversations ? cloudData.conversations : [createConversation()],
    activeConversationId: hasCloudConversations ? cloudData.activeConversationId : null,
    drawConversations: hasCloudDrawConversations ? cloudData.drawConversations : [],
    activeDrawConversationId: hasCloudDrawConversations ? cloudData.activeDrawConversationId : null,
  });

  const conversations = normalized.conversations.map((conversation) => {
    if (!hasCloudConversations) return conversation;
    return {
      ...conversation,
      messages: [],
      messagesLoaded: (conversation.messageCount || 0) === 0,
    };
  });

  const drawConversations = normalized.drawConversations.map((conversation) => ({
    ...conversation,
    messages: [],
    messagesLoaded: (conversation.messageCount || 0) === 0,
  }));

  const activeConversationId = conversations.some((conversation) => conversation.id === normalized.activeConversationId)
    ? normalized.activeConversationId
    : conversations[0]?.id || null;
  const activeDrawConversationId = drawConversations.some((conversation) => conversation.id === normalized.activeDrawConversationId)
    ? normalized.activeDrawConversationId
    : drawConversations[0]?.id || null;

  return {
    settings: normalized.settings,
    conversations,
    activeConversationId,
    drawConversations,
    activeDrawConversationId,
  };
}

export function buildCloudSaveConversations(items, dirtyVersions, targetVersion, isDraw = false) {
  return items.map((conversation) => {
    const messagesLoaded = (dirtyVersions.get(conversation.id) || 0) <= targetVersion
      && dirtyVersions.has(conversation.id);
    const summary = {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messageCount || 0,
      messagesLoaded,
      messages: messagesLoaded ? (conversation.messages || []) : [],
    };
    if (isDraw) {
      summary.imageCount = conversation.imageCount || 0;
    } else {
      summary.lastPreview = conversation.lastPreview || '';
    }
    return summary;
  });
}
