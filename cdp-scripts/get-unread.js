/**
 * 生成获取未读消息摘要的浏览器端 JS 表达式。
 * @returns {string}
 */
export function getUnreadExpression() {
  return `(async () => {
  try {
    if (typeof Store !== 'undefined' && Store.Chat) {
      const chats = Store.Chat.getModelsArray();
      const unread = chats
        .filter(c => c.unreadCount > 0)
        .map(c => {
          const id = c.id?._serialized || c.id;
          let lastMsgBody = null;
          let lastMsgTime = c.t || null;
          try {
            const msgs = c.msgs.getModelsArray();
            if (msgs.length > 0) {
              const lm = msgs[msgs.length - 1];
              lastMsgBody = lm.body?.substring(0, 300) || null;
              lastMsgTime = lm.t || lastMsgTime;
            }
          } catch {}
          return {
            id, name: c.name || c.formattedTitle || '(unknown)',
            unreadCount: c.unreadCount,
            isGroup: c.isGroup || false,
            isMuted: c.muteExpiration > 0,
            lastMessage: lastMsgBody,
            timestamp: lastMsgTime,
          };
        })
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return {
        total_unread_chats: unread.length,
        total_unread_messages: unread.reduce((s, c) => s + c.unreadCount, 0),
        unread_chats: unread,
      };
    }
    if (window.WAPLUS_WPP && window.WAPLUS_WPP.chat) {
      const chats = await window.WAPLUS_WPP.chat.list();
      const unread = chats
        .filter(c => c.unreadCount > 0)
        .map(c => {
          const id = typeof c.id === 'object' ? c.id._serialized : c.id;
          return {
            id, name: c.name || c.formattedTitle || '(unknown)',
            unreadCount: c.unreadCount,
            isGroup: c.isGroup || false,
            isMuted: c.muteExpiration > 0,
            lastMessage: c.lastMessage?.body?.substring(0, 300) || null,
            timestamp: c.lastMessage?.timestamp || null,
          };
        })
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return {
        total_unread_chats: unread.length,
        total_unread_messages: unread.reduce((s, c) => s + c.unreadCount, 0),
        unread_chats: unread,
      };
    }
    return { error: 'WhatsApp 尚未加载。请等待几秒后重试。' };
  } catch(e) {
    return { error: e.message };
  }
})()`;
}
