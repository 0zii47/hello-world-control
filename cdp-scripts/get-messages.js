/**
 * 生成读取指定聊天消息的浏览器端 JS 表达式。
 * @param {object} opts
 * @param {string} opts.chat_id
 * @param {number} opts.count
 * @returns {string}
 */
export function getMessagesExpression({ chat_id, count }) {
  const chatId = JSON.stringify(chat_id);
  const msgCount = JSON.stringify(count);
  return `(async () => {
  const chatId = ${chatId};
  const count = ${msgCount};
  try {
    if (typeof Store !== 'undefined' && Store.Chat) {
      const chat = Store.Chat.get(chatId);
      if (!chat) return { error: '未找到聊天: ' + chatId };
      const msgs = chat.msgs.getModelsArray();
      const recent = msgs.slice(-count).reverse();
      return recent.map(m => ({
        id: m.id?._serialized || m.id,
        body: m.body || '',
        type: m.type || 'text',
        from: m.from?._serialized || m.author,
        timestamp: m.t,
        hasMedia: !!(m.mediaData || m.deprecatedMms3Url),
        isForwarded: !!m.isForwarded,
        isFromMe: !!(m.id?.fromMe || m.fromMe),
      }));
    }
    if (window.WAPLUS_WPP && window.WAPLUS_WPP.chat) {
      const messages = await window.WAPLUS_WPP.chat.getMessages(chatId, { count });
      if (!messages || !Array.isArray(messages)) {
        return { error: 'WAPLUS_WPP 未返回消息数组' };
      }
      return messages.map(m => ({
        id: typeof m.id === 'object' ? m.id._serialized : m.id,
        body: m.body || '', type: m.type || 'text',
        from: typeof m.from === 'object' ? m.from._serialized : m.author,
        timestamp: m.timestamp || m.t,
        hasMedia: !!(m.mediaData || m.deprecatedMms3Url || m.mmUrl),
        isForwarded: !!m.isForwarded,
        isFromMe: !!(m.fromMe || m.isFromMe || (typeof m.id === 'object' && m.id.fromMe)),
      }));
    }
    return { error: 'WhatsApp 尚未加载。请等待几秒后重试。' };
  } catch(e) {
    return { error: e.message };
  }
})()`;
}
