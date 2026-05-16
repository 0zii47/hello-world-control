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

    // Step 1: 从 Store.Contact 查找联系人
    const contacts = Store.Contact.getModelsArray();
    const match = contacts.find(c => {
      const id = (c.id?._serialized || c.id || '').replace(/[@c.us@g.us@s.whatsapp.net]/g, '');
      const clean = id.replace(/[+\\s()-]/g, '');
      const pn = typeof c.phoneNumber === 'string' ? c.phoneNumber : '';
      const number = (c.number || c.userid || '').replace(/[@c.us@g.us@s.whatsapp.net]/g, '');
      return clean.includes(num) || number.includes(num) || pn.includes(num);
    });

    // Step 2: 从 IndexedDB 获取所有关联 ID（包括 lid 格式）
    let possibleIds = new Set();
    let chatName = '';

    try {
      const idbResult = await new Promise((resolve, reject) => {
        const request = indexedDB.open('model-storage', 1910);
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          try {
            const tx = db.transaction('contact', 'readonly');
            const store = tx.objectStore('contact');
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
              const allContacts = getAllReq.result || [];
              for (const c of allContacts) {
                const cid = c.id || '';
                const phoneNum = c.phoneNumber || '';
                const cnumber = c.number || c.userid || '';

                if (cid.includes(num) || (typeof phoneNum === 'string' && phoneNum.includes(num)) ||
                    (typeof cnumber === 'string' && cnumber.includes(num))) {
                  possibleIds.add(cid);
                  if (typeof phoneNum === 'string' && phoneNum) possibleIds.add(phoneNum);
                  if (typeof cnumber === 'string' && cnumber) possibleIds.add(cnumber);
                  if (!chatName) chatName = c.name || c.shortName || c.pushname || '';
                }
              }
              db.close();
              resolve(true);
            };
            getAllReq.onerror = () => { db.close(); resolve(null); };
          } catch(e) { db.close(); resolve(null); }
        };
      });
    } catch(e) { /* IndexedDB may not be available */ }

    // 也加入 Store.Contact 找到的ID
    if (match) {
      possibleIds.add(match.id?._serialized || match.id);
      if (typeof match.phoneNumber === 'string') possibleIds.add(match.phoneNumber);
      if (match.number) possibleIds.add(match.number);
      if (match.userid) possibleIds.add(match.userid);
      if (!chatName) chatName = match.name || match.formattedName || match.pushname || '';
    }

    if (possibleIds.size === 0) {
      return JSON.stringify({ error: '未找到匹配联系人: ' + num });
    }

    // Step 3: 从 Store.Msg 获取所有相关消息
    let messages = [];
    if (Store.Msg) {
      const allMsgs = Store.Msg.getModelsArray();
      const chatMsgs = allMsgs.filter(m => {
        const from = m.from?._serialized || m.from || '';
        const to = m.to?._serialized || m.to || '';
        for (const id of possibleIds) {
          if (from === id || to === id) return true;
        }
        return false;
      });
      messages = chatMsgs.map(m => ({
        id: m.id?._serialized || m.id,
        body: m.body || '',
        caption: m.caption || '',
        type: m.type || 'text',
        from: m.from?._serialized || m.from || '',
        timestamp: m.t,
        hasMedia: !!(m.mediaData || m.deprecatedMms3Url || m.mmUrl),
        isFromMe: !!(m.id?.fromMe || m.fromMe),
      }));
    }

    // Fallback: 如果 Store.Msg 没消息，尝试 chat.msgs
    if (messages.length === 0) {
      for (const id of possibleIds) {
        const chat = Store.Chat.get(id);
        if (chat && chat.msgs) {
          const msgs = chat.msgs.getModelsArray();
          if (msgs.length > 0) {
            messages = msgs.map(m => ({
              id: m.id?._serialized || m.id,
              body: m.body || '',
              type: m.type || 'text',
              from: m.from?._serialized || m.author || '',
              timestamp: m.t,
              hasMedia: !!(m.mediaData || m.deprecatedMms3Url),
              isFromMe: !!(m.id?.fromMe || m.fromMe),
            }));
            break;
          }
        }
      }
    }

    return JSON.stringify({ chatName, totalMessages: messages.length, messages });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()`;
}
