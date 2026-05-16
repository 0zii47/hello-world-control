/**
 * 生成获取 WhatsApp 聊天列表的浏览器端 JS 表达式。
 * @param {object} opts
 * @param {boolean} opts.include_unread_only
 * @returns {string} 可在 CDP Runtime.evaluate 中执行的表达式
 */
export function getChatsExpression({ include_unread_only }) {
  const filterUnread = JSON.stringify(include_unread_only);
  return `(async () => {
  try {
    if (typeof Store !== 'undefined' && Store.Chat) {
      const chats = Store.Chat.getModelsArray();
      const result = [];
      for (const c of chats) {
        if (!c.id) continue;
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
        result.push({
          id: c.id._serialized || c.id,
          name: c.name || c.formattedTitle || '(unknown)',
          unreadCount: c.unreadCount || 0,
          isGroup: c.isGroup || false,
          isMuted: c.muteExpiration > 0,
          lastMessage: lastMsgBody,
          timestamp: lastMsgTime,
        });
      }
      result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return result;
    }
    if (window.WAPLUS_WPP && window.WAPLUS_WPP.chat) {
      const chats = await window.WAPLUS_WPP.chat.list();
      const result = chats.map(c => {
        const id = typeof c.id === 'object' ? c.id._serialized : c.id;
        return {
          id, name: c.name || c.formattedTitle || '(unknown)',
          unreadCount: c.unreadCount || 0,
          isGroup: c.isGroup || false,
          isMuted: c.muteExpiration > 0,
          lastMessage: c.lastMessage?.body?.substring(0, 300) || null,
          timestamp: c.timestamp || c.lastMessage?.timestamp || null,
        };
      });
      if (${filterUnread}) return result.filter(c => c.unreadCount > 0);
      return result;
    }
    return { error: 'WhatsApp 尚未加载。请等待几秒后重试。' };
  } catch(e) {
    return { error: e.message };
  }
})()`;
}
