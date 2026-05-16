/**
 * 生成搜索/列出 WhatsApp 联系人的浏览器端 JS 表达式。
 * @param {object} opts
 * @param {string} opts.query
 * @param {number} opts.limit
 * @returns {string}
 */
export function getContactsExpression({ query, limit }) {
  const q = JSON.stringify(query || "");
  const lim = JSON.stringify(limit);
  return `(async () => {
  const q = ${q};
  const limit = ${lim};
  try {
    if (typeof Store !== 'undefined' && Store.Contact) {
      const contacts = Store.Contact.getModelsArray();
      let filtered = contacts;
      if (q) {
        const lower = q.toLowerCase();
        filtered = contacts.filter(c =>
          (c.name || c.formattedName || c.pushname || '').toLowerCase().includes(lower) ||
          (c.number || c.userid || '').includes(q)
        );
      }
      return filtered.slice(0, limit).map(c => ({
        id: c.id?._serialized || c.id,
        name: c.name || c.formattedName || c.pushname || '',
        number: c.number || c.userid || '',
        isBusiness: c.isBusiness || false,
        isMe: c.isMe || false,
        isBlocked: c.isBlocked || false,
      }));
    }
    if (window.WAPLUS_WPP && window.WAPLUS_WPP.contact) {
      let contacts;
      if (q) {
        contacts = await window.WAPLUS_WPP.contact.get(q);
        contacts = contacts ? [contacts] : [];
      } else {
        contacts = await window.WAPLUS_WPP.contact.list();
      }
      if (!contacts) return [];
      return contacts.slice(0, limit).map(c => ({
        id: typeof c.id === 'object' ? c.id._serialized : c.id,
        name: c.name || c.formattedName || c.pushname || '',
        number: c.number || c.userid || '',
        isBusiness: c.isBusiness || false,
        isMe: c.isMe || false,
        isBlocked: c.isBlocked || false,
      }));
    }
    return { error: 'WhatsApp 尚未加载。请等待几秒后重试。' };
  } catch(e) {
    return { error: e.message };
  }
})()`;
}
