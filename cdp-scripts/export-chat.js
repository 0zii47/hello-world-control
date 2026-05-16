/**
 * 生成导出聊天记录（查找联系人 + 读取消息）的浏览器端 JS 表达式。
 * @param {object} opts
 * @param {string} opts.contact_number
 * @returns {string}
 */
export function exportChatExpression({ contact_number }) {
  const num = JSON.stringify(contact_number);
  return `(async () => {
  const num = ${num};
  try {
    if (typeof Store === 'undefined' || !Store.Contact) {
      return JSON.stringify({ error: 'WhatsApp Store 尚未加载，请等待几秒后重试。' });
    }
    const contacts = Store.Contact.getModelsArray();
    const match = contacts.find(c => {
      const id = (c.id?._serialized || c.id || '').replace(/[@c.us@g.us]/g, '');
      const clean = id.replace(/[+\\s()-]/g, '');
      return clean.includes(num);
    });
    if (!match) {
      const sampleIds = contacts.slice(0, 10).map(c => c.id?._serialized || c.id || '');
      return JSON.stringify({ error: '未找到匹配联系人: ' + num, total_contacts: contacts.length, sample_ids: sampleIds });
    }
    const chatId = match.id?._serialized || match.id;
    const chatName = match.name || match.formattedName || match.pushname || '';
    if (typeof window.openChatWindow === 'function') {
      await window.openChatWindow(chatId);
    }
    await new Promise(r => setTimeout(r, 2000));
    let messages = [];
    if (Store.Msg) {
      const allMsgs = Store.Msg.getModelsArray();
      const chatMsgs = allMsgs.filter(m => {
        const from = m.from?._serialized || m.from || '';
        const to = m.to?._serialized || m.to || '';
        return from === chatId || to === chatId;
      });
      messages = chatMsgs.map(m => ({
        id: m.id?._serialized || m.id,
        body: m.body || '',
        type: m.type || 'text',
        from: m.from?._serialized || m.from || '',
        timestamp: m.t,
        hasMedia: !!(m.mediaData || m.deprecatedMms3Url || m.mmUrl),
        isFromMe: !!(m.id?.fromMe || m.fromMe),
      }));
    } else {
      const chat = Store.Chat.get(chatId);
      if (chat) {
        const msgs = chat.msgs.getModelsArray();
        messages = msgs.map(m => ({
          id: m.id?._serialized || m.id,
          body: m.body || '',
          type: m.type || 'text',
          from: m.from?._serialized || m.author || '',
          timestamp: m.t,
          hasMedia: !!(m.mediaData || m.deprecatedMms3Url),
          isFromMe: !!(m.id?.fromMe || m.fromMe),
        }));
      }
    }
    return JSON.stringify({ chatId, chatName, totalMessages: messages.length, messages });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()`;
}
