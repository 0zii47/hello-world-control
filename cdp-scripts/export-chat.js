/**
 * 生成导出 WhatsApp 聊天记录的浏览器端 JS 表达式。
 * 使用 Store.Msg（全局消息存储）获取完整聊天历史，比 chat.msgs 更可靠。
 *
 * @param {object} opts
 * @param {string} [opts.contact_number] - 联系人号码，模糊匹配（如 '7608675'）
 * @param {string} [opts.chat_lid] - WhatsApp LID（如 '153902267777180@lid'），直接搜索最快
 * @returns {string} 可在 CDP Runtime.evaluate 中执行的表达式
 */
export function exportChatExpression({ contact_number, chat_lid }) {
  const num = contact_number ? JSON.stringify(contact_number) : null;
  const lid = chat_lid ? JSON.stringify(chat_lid) : null;

  return `(() => {
  const _num = ${num};
  const _lid = ${lid};
  const TARGETS = [];
  let chatName = '';
  let chatId = '';

  try {
    if (!Store || !Store.Msg) return JSON.stringify({ error: 'WhatsApp Store 尚未加载，请等待几秒后重试。' });

    // Step 1: 确定目标 LID 列表
    if (_lid) {
      // 直接使用提供的 LID
      TARGETS.push(_lid.toLowerCase().replace('@lid','').replace('@c.us',''));
    } else if (_num) {
      // 从 Store.Chat 模糊匹配找目标聊天
      const chats = Store.Chat.getModelsArray();
      for (const c of chats) {
        const cname = (c.name || c.formattedTitle || '').toLowerCase();
        const cid = (c.id?._serialized || c.id || '').toLowerCase();
        if (cname.includes(_num) || cid.includes(_num)) {
          const base = cid.replace('@lid','').replace('@c.us','').replace('@g.us','');
          if (base) {
            TARGETS.push(base);
            chatName = chatName || c.name || c.formattedTitle || '';
            chatId = chatId || (c.id?._serialized || c.id || '');
          }
        }
      }
    }

    if (TARGETS.length === 0) {
      return JSON.stringify({ error: _lid ? '未找到 LID 匹配的聊天: ' + _lid : '未找到号码匹配的聊天: ' + _num });
    }

    // Step 2: 从 Store.Msg 搜索所有相关消息
    const all = Store.Msg.getModelsArray();
    const matches = all.filter(m => {
      const from = (m.from?._serialized || m.from || '').toLowerCase();
      const to = (m.to?._serialized || m.to || '').toLowerCase();
      const id = (m.id?._serialized || m.__x_id || '').toLowerCase();
      for (const t of TARGETS) {
        if (from.includes(t) || to.includes(t) || id.includes(t)) return true;
      }
      return false;
    });

    let messages = matches.map(m => {
      const body = m.body || '';
      const hasMedia = !!(m.mediaData || m.deprecatedMms3Url || m.mmUrl || m.clientUrl ||
                         (m.type && ['image','video','sticker','ptt','audio','document'].includes(m.type)));
      return {
        id: m.id?._serialized || m.__x_id || (m.t + '_' + body.substring(0,20)),
        body: body,
        caption: m.caption || '',
        type: m.type || 'text',
        timestamp: m.t,
        hasMedia: hasMedia,
        isFromMe: !!(m.id?.fromMe || m.fromMe || m.__x_fromMe),
        from: m.from?._serialized || m.from || '',
        to: m.to?._serialized || m.to || '',
        ack: m.ack || 0,
      };
    });

    // Fallback: Store.Msg 无结果，尝试 chat.msgs
    if (messages.length === 0) {
      for (const t of TARGETS) {
        for (const suffix of ['@lid', '@c.us', '@g.us']) {
          const chat = Store.Chat.get(t + suffix);
          if (chat && chat.msgs && typeof chat.msgs.getModelsArray === 'function') {
            const msgs = chat.msgs.getModelsArray();
            if (msgs.length > 0) {
              messages = msgs.map(m => ({
                id: m.id?._serialized || m.__x_id || (m.t + '_' + (m.body||'').substring(0,20)),
                body: m.body || '',
                caption: m.caption || '',
                type: m.type || 'text',
                timestamp: m.t,
                hasMedia: !!(m.mediaData || m.deprecatedMms3Url || m.mmUrl),
                isFromMe: !!(m.id?.fromMe || m.fromMe),
                from: m.from?._serialized || m.from || '',
                to: m.to?._serialized || m.to || '',
                ack: m.ack || 0,
              }));
              chatName = chatName || chat.name || chat.formattedTitle || '';
              chatId = chatId || (chat.id?._serialized || chat.id || '');
              break;
            }
          }
        }
        if (messages.length > 0) break;
      }
    }

    // Step 3: 排序 + 去重
    messages.sort((a,b) => (a.timestamp||0) - (b.timestamp||0));

    const seen = new Set();
    const unique = messages.filter(m => {
      const key = m.id || (m.timestamp + '_' + (m.body||'').substring(0,30));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return JSON.stringify({
      total: unique.length,
      chatName: chatName,
      chatId: chatId,
      messages: unique,
    });
  } catch(e) {
    return JSON.stringify({ error: e.message, stack: e.stack });
  }
})()`;
}
