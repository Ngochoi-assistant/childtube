// ChildTube — Tin nhắn nội bộ gia đình (kiểu Zalo): nút 💬 trên đầu trang mở danh sách trò chuyện.
// Nhóm "Cả nhà" tự có; tạo nhóm đặt tên (ông bà, cô giáo…) hoặc nhắn riêng. Gửi chữ, ảnh, video (video lớn gửi từng phần).
// Tin có ảnh/video: bố mẹ bấm "📌 Đưa vào Nhật ký" để gán thành cột mốc / hoạt động của bé trên bảng tin.
// Máy chủ: ct_chat_list, ct_chat_unread, ct_chat_create, ct_chat_update, ct_chat_leave, ct_chat_messages, ct_chat_send, ct_chat_delete, ct_chat_pin.
const Chat = {
  list: null, cur: null, msgs: [], seen: [], more: false, poll: null, badgeTimer: null, sending: 0,
  EMOJI: ['💬', '👨‍👩‍👧', '👵', '🏫', '🎂', '⚽', '🌱', '❤️'],
  canPin() { return !S.restricted || (S.me && S.me.role === 'teacher'); },
  people() {   // ai có thể mời vào nhóm (S.members có thể rỗng với người thân: lấy thêm từ nhóm Cả nhà)
    const map = {};
    (S.members || []).forEach((m) => { if (m.user_id && !m.me) map[m.user_id] = { id: m.user_id, name: m.name || (m.email || '').split('@')[0], role: m.role }; });
    (this.list || []).forEach((c) => c.members.forEach((m) => { if (!map[m.id]) map[m.id] = m; }));
    const me = this.meId();
    delete map[me];
    return Object.values(map);
  },
  meId() { const m = (S.members || []).find((x) => x.me); return m ? m.user_id : (this.cur && this.msgs.find((x) => x.mine) || {}).user_id; },
  ago(iso) {
    const d = new Date(iso), s = (Date.now() - d) / 1000;
    if (s < 60) return 'vừa xong'; if (s < 3600) return Math.floor(s / 60) + ' phút';
    if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' });
  },
  av(c) { return c.kind === 'direct' ? (ROLE_ICON[(c.members.find((m) => m.name === c.name) || {}).role] || '👤') : c.emoji || '💬'; },

  // ---------- Mở / đóng ----------
  async open(chatId) {
    $('#chat').classList.remove('hidden'); document.body.classList.add('chat-open');
    if (chatId) return this.openChat(chatId);
    this.cur = null; this.stop();
    this.paintList();
    try { this.list = await rpc('ct_chat_list'); } catch (e) { return toast(e.message, true); }
    if (!this.cur) this.paintList();
    this.badge();
  },
  close() { this.stop(); this.cur = null; $('#chat').classList.add('hidden'); document.body.classList.remove('chat-open'); this.refreshBadge(); },
  stop() { clearInterval(this.poll); this.poll = null; },

  // ---------- Danh sách trò chuyện ----------
  paintList() {
    const rows = this.list == null ? '<div class="empty"><span class="spin"></span></div>' : this.list.map((c) => `<button class="ch-row" data-a="C-open" data-id="${c.id}">
        <span class="ch-av ${c.kind}">${esc(this.av(c))}</span>
        <span class="ch-mid"><b>${esc(c.name)}</b><em>${c.last ? esc((c.last.mine ? 'Bạn: ' : c.kind !== 'direct' && c.last.by ? c.last.by + ': ' : '') + c.last.text) : c.kind === 'family' ? 'Nhóm của cả nhà · ' + c.members.length + ' người' : 'Chưa có tin nhắn'}</em></span>
        <span class="ch-end"><i>${c.last ? this.ago(c.last.at) : ''}</i>${c.unread ? `<b>${c.unread > 99 ? '99+' : c.unread}</b>` : ''}</span></button>`).join('');
    $('#chat').innerHTML = `<div class="ch-top"><button class="ch-back" data-a="C-close" aria-label="Đóng">‹</button><h2>Tin nhắn</h2>
      <button class="btn small" data-a="C-new">＋ Nhóm mới</button></div><div class="ch-list">${rows}</div>`;
  },

  // ---------- Một cuộc trò chuyện ----------
  async openChat(id) {
    this.stop();
    this.cur = { id }; this.msgs = []; this.more = false;
    $('#chat').innerHTML = `<div class="ch-top"><button class="ch-back" data-a="C-list" aria-label="Quay lại">‹</button><div class="ch-title"><b>…</b></div></div>
      <div class="ch-msgs" id="ch-msgs"><div class="empty"><span class="spin"></span></div></div>${this.composer()}`;
    try {
      const r = await rpc('ct_chat_messages', { p_chat: id });
      if (!this.cur || this.cur.id !== id) return;
      this.cur = r.chat; this.msgs = r.messages; this.seen = r.seen; this.more = r.more;
    } catch (e) { toast(e.message, true); return this.open(); }
    this.paintHead(); this.paintMsgs(true);
    this.poll = setInterval(() => this.pull(), 3500);
  },
  composer() {
    return `<div class="ch-prev hidden" id="ch-prev"></div><form class="ch-comp" id="ch-comp"><label class="ch-pic" aria-label="Gửi ảnh, video">📷<input type="file" id="ch-files" accept="image/*,video/*" multiple hidden></label>
      <textarea id="ch-in" rows="1" placeholder="Tin nhắn" maxlength="4000"></textarea><button class="ch-send" type="submit" aria-label="Gửi">➤</button></form>`;
  },
  paintHead() {
    const c = this.cur;
    $('#chat .ch-top').innerHTML = `<button class="ch-back" data-a="C-list" aria-label="Quay lại">‹</button>
      <span class="ch-av sm ${c.kind}">${esc(this.av(c))}</span><div class="ch-title"><b>${esc(c.name)}</b><em>${c.kind === 'direct' ? (c.members.find((m) => m.name === c.name) ? ROLE_NAME(c.members.find((m) => m.name === c.name).role) : '') : c.members.length + ' thành viên'}</em></div>
      ${c.kind === 'group' ? `<button class="icon-btn" data-a="C-info" aria-label="Thông tin nhóm">⋯</button>` : c.kind === 'family' ? `<button class="icon-btn" data-a="C-info" aria-label="Thành viên">👥</button>` : ''}`;
  },
  bubble(m, prev) {
    const sameAuthor = prev && prev.user_id === m.user_id && !prev.deleted && new Date(m.at) - new Date(prev.at) < 5 * 60e3;
    const day = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString()
      ? `<div class="ch-day">${new Date(m.at).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' })}</div>` : '';
    if (m.deleted) return `${day}<div class="ch-msg ${m.mine ? 'me' : ''}"><div class="ch-bub gone">Tin nhắn đã thu hồi</div></div>`;
    const md = (m.media || []).filter((x) => x.url);
    const grid = md.length ? `<div class="ch-media n${Math.min(md.length, 4)}">${md.slice(0, 4).map((x, i) => (x.mime.startsWith('image/')
      ? `<img src="${esc(mediaUrl(x.url))}" alt="" decoding="async" data-a="P-img" data-src="${esc(mediaUrl(x.url))}" data-cap="${esc(m.body || '')}">`
      : `<div class="fd-vid" data-a="C-play"><video src="${esc(mediaUrl(x.url))}#t=0.5" muted playsinline preload="metadata"></video><span class="fd-play big">▶</span></div>`)
      + (i === 3 && md.length > 4 ? `<span class="fd-more">+${md.length - 4}</span>` : '')).join('')}</div>` : '';
    const pending = m.pending ? `<div class="ch-up">${esc(m.pending)}</div>` : '';
    const pin = md.length && !m.pending ? (m.entry_id ? '<span class="ch-pinned">✓ Đã đưa vào Nhật ký</span>'
      : this.canPin() ? `<button class="ch-pin" data-a="C-pin" data-id="${m.id}">📌 Đưa vào Nhật ký</button>` : '') : '';
    return `${day}<div class="ch-msg ${m.mine ? 'me' : ''} ${sameAuthor ? 'cont' : ''}" data-id="${m.id}">
      ${!m.mine && !sameAuthor && this.cur.kind !== 'direct' ? `<div class="ch-by">${esc(m.by)}</div>` : ''}
      ${grid}${m.body ? `<div class="ch-bub" data-a="C-menu" data-id="${m.id}">${esc(m.body).replace(/\n/g, '<br>')}</div>` : ''}${pending}
      <div class="ch-meta">${pin}<i>${new Date(m.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</i>${m.mine && !m.pending ? `<button class="ch-x" data-a="C-menu" data-id="${m.id}" aria-label="Tuỳ chọn">⋯</button>` : ''}</div></div>`;
  },
  paintMsgs(toEnd) {
    const box = $('#ch-msgs'); if (!box) return;
    const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const last = [...this.msgs].reverse().find((m) => m.mine && !m.pending);
    const seen = last ? this.seen.filter((s) => s.at >= last.at).map((s) => s.name) : [];
    box.innerHTML = (this.more ? '<button class="btn link ch-older" data-a="C-older">Xem tin cũ hơn</button>' : '') +
      (this.msgs.length ? this.msgs.map((m, i) => this.bubble(m, this.msgs[i - 1])).join('') : `<div class="ch-hello">${esc(this.av(this.cur))}<b>${esc(this.cur.name)}</b><span>Gửi lời chào, ảnh hay video đầu tiên 👋</span></div>`) +
      (seen.length ? `<div class="ch-seen">Đã xem · ${esc(seen.slice(0, 3).join(', '))}${seen.length > 3 ? '…' : ''}</div>` : '');
    if (toEnd || nearEnd) box.scrollTop = box.scrollHeight;
  },
  async pull() {
    if (!this.cur || document.hidden || this.sending) return;
    const last = [...this.msgs].reverse().find((m) => !m.pending);
    try {
      const r = await rpc('ct_chat_messages', { p_chat: this.cur.id, p_after: last ? last.at : null });
      if (!this.cur || r.chat.id !== this.cur.id) return;
      const known = new Set(this.msgs.map((m) => m.id));
      const fresh = r.messages.filter((m) => !known.has(m.id));
      const seenChanged = JSON.stringify(r.seen) !== JSON.stringify(this.seen);
      this.seen = r.seen;
      if (fresh.length || seenChanged) { this.msgs = this.msgs.concat(fresh); this.paintMsgs(false); }
    } catch (e) { /* mạng chập chờn: thử lại lần sau */ }
  },
  async reload() {   // sau khi thu hồi / đưa vào Nhật ký: lấy lại cả trang hiện tại
    const r = await rpc('ct_chat_messages', { p_chat: this.cur.id });
    this.msgs = r.messages; this.seen = r.seen; this.more = r.more; this.paintMsgs(false);
  },

  // ---------- Gửi ----------
  async send() {
    const inp = $('#ch-in'), files = [...(($('#ch-files') || {}).files || [])].slice(0, 12), body = inp.value.trim();
    if (!body && !files.length) return;
    const big = files.find((f) => f.size > 500 * 1024 * 1024);
    if (big) return toast(big.name + ': quá 500 MB. Hãy cắt ngắn video rồi thử lại.', true);
    inp.value = ''; inp.style.height = ''; $('#ch-files').value = ''; $('#ch-prev').classList.add('hidden'); $('#ch-prev').innerHTML = '';
    this.sending++;
    const temp = { id: 'tmp' + Date.now(), mine: true, body, at: new Date().toISOString(), media: [], pending: files.length ? 'Đang gửi…' : '', user_id: this.meId() };
    this.msgs.push(temp); this.paintMsgs(true);
    try {
      const id = await rpc('ct_chat_send', { p_chat: this.cur.id, p_body: body, p_files: files.length });
      temp.id = id;
      if (files.length) {
        const tok = (JSON.parse(localStorage.getItem('ct-session') || '{}') || {}).access_token;
        let bad = 0, i = 0;
        for (const f of files) {
          i++;
          const label = (f.type || mimeOf(f)).startsWith('video/') ? 'video' : 'ảnh';
          const pct = (p) => { temp.pending = `Đang gửi ${label} ${i}/${files.length}${p ? ' · ' + Math.round(p * 100) + '%' : '…'}`; const el = document.querySelector(`.ch-msg[data-id="${temp.id}"] .ch-up`); if (el) el.textContent = temp.pending; else this.paintMsgs(false); };
          try { await sendFile('msg=' + id, f, tok, pct); } catch (e) { bad++; toast(f.name + ': ' + e.message, true); }
        }
        if (bad) toast(`Còn ${bad} tệp chưa gửi được. Hãy gửi lại tệp đó.`, true);
      }
    } catch (e) { toast(e.message, true); this.msgs = this.msgs.filter((m) => m !== temp); }
    this.sending--;
    await this.reload().catch(() => {});
  },
  preview() {
    const f = $('#ch-files'), box = $('#ch-prev');
    if (!f.files.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = [...f.files].slice(0, 12).map((x) => (x.type || mimeOf(x)).startsWith('video/')
      ? `<span class="ch-pv vid">🎬<i>${(x.size / 1048576).toFixed(0)} MB</i></span>` : `<span class="ch-pv"><img src="${URL.createObjectURL(x)}" alt=""></span>`).join('') +
      `<button class="icon-btn sm" data-a="C-unpick" aria-label="Bỏ chọn">✕</button><span class="hint">Bấm ➤ để gửi${f.files.length > 12 ? ' (tối đa 12 tệp)' : ''}</span>`;
  },

  // ---------- Đưa vào Nhật ký ----------
  pinSheet(m) {
    const ks = kids(), k = curKid(), md = (m.media || []).filter((x) => x.url);
    const kinds = [['milestone', '🌟 Cột mốc'], ['activity', '🎨 Hoạt động'], ['achievement', '🏆 Thành tích'], ['note', '📝 Ghi chú']];
    sheet(`<h3>📌 Đưa vào Nhật ký</h3>
      <div class="hint">${md.length} ảnh/video của ${esc(m.by || 'bạn')} sẽ thành một bài trên bảng tin (không tải lại tệp).</div>
      ${md.length > 1 ? `<div class="ch-pick">${md.map((x) => `<label><input type="checkbox" class="cp-m" value="${x.id}" checked>${x.mime.startsWith('image/') ? `<img src="${esc(mediaUrl(x.url))}" alt="">` : '<span>🎬</span>'}</label>`).join('')}</div>` : ''}
      <label>Của bé</label><div class="chips">${ks.map((x) => `<button class="chip ${k && k.id === x.id ? 'on' : ''}" data-a="cp-kid" data-id="${x.id}">${esc(x.emoji)} ${esc(x.name)}</button>`).join('')}<button class="chip ${!k ? 'on' : ''}" data-a="cp-kid" data-id="">👨‍👩‍👧 Cả nhà</button></div>
      <label>Loại</label><div class="chips">${kinds.map(([v, t], i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-a="cp-kind" data-v="${v}">${t}</button>`).join('')}</div>
      <label>Tiêu đề</label><input id="cp-title" maxlength="120" value="${esc((m.body || '').slice(0, 120))}" placeholder="Ví dụ: Lúa tự đứng dậy">
      <div class="pt-two"><div><label>Ngày</label><input id="cp-day" type="date" value="${esc(new Date(m.at).toISOString().slice(0, 10))}"></div>
        <div><label>Ai được xem</label><select id="cp-priv"><option value="family">👨‍👩‍👧 Gia đình</option><option value="parents">🔒 Chỉ bố mẹ</option></select></div></div>
      <button class="btn primary" data-a="cp-save">Đăng lên Nhật ký</button>`, async (a, b) => {
      if (a === 'cp-kid' || a === 'cp-kind') { b.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); return; }
      if (a !== 'cp-save') return;
      const kid = $('#sheet-body [data-a="cp-kid"].on'), kind = $('#sheet-body [data-a="cp-kind"].on');
      const pick = [...document.querySelectorAll('#sheet-body .cp-m:checked')].map((x) => x.value);
      if (md.length > 1 && !pick.length) return toast('Chọn ít nhất một ảnh/video', true);
      b.disabled = true;
      try {
        await rpc('ct_chat_pin', { p_msg: m.id, p_media: md.length > 1 ? pick : null, p: { kind: kind ? kind.dataset.v : 'milestone', child_id: kid && kid.dataset.id || null, title: $('#cp-title').value, day: $('#cp-day').value, privacy: $('#cp-priv').value } });
        closeSheet(); toast('Đã đưa vào Nhật ký 🌟');
        if (typeof Feed !== 'undefined') Feed.list = null;
        await this.reload();
      } catch (e) { b.disabled = false; toast(e.message, true); }
    });
  },

  // ---------- Nhóm ----------
  groupSheet(c) {
    const isNew = !c, ppl = this.people(), on = new Set(c ? c.members.map((m) => m.id) : []);
    let emoji = c ? c.emoji : '💬';
    sheet(`<h3>${isNew ? '＋ Nhóm mới' : '✎ Sửa nhóm'}</h3>
      <label>Tên nhóm</label><input id="cg-name" maxlength="60" value="${esc(c ? c.name : '')}" placeholder="${isNew ? 'Bỏ trống + chọn 1 người = nhắn riêng' : ''}">
      <label>Biểu tượng</label><div class="chips">${this.EMOJI.map((x) => `<button class="chip ${x === emoji ? 'on' : ''}" data-a="cg-emo" data-v="${x}">${x}</button>`).join('')}</div>
      <label>Thành viên</label><div class="ch-people">${ppl.length ? ppl.map((p) => `<label class="ch-person"><input type="checkbox" class="cg-m" value="${p.id}" ${on.has(p.id) ? 'checked' : ''}><span>${ROLE_ICON[p.role] || '👤'}</span><b>${esc(p.name)}</b><em>${esc(ROLE_NAME(p.role))}</em></label>`).join('')
        : '<div class="hint">Chưa có ai khác trong gia đình. Mời người thân ở tab Gia đình → Thành viên.</div>'}</div>
      <button class="btn primary" data-a="cg-save">${isNew ? 'Tạo' : 'Lưu'}</button>
      ${!isNew ? '<button class="btn link" data-a="cg-leave" style="color:var(--danger)">Rời nhóm</button>' : ''}`, async (a, b) => {
      if (a === 'cg-emo') { emoji = b.dataset.v; b.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); return; }
      if (a === 'cg-leave') { if (!confirm('Rời nhóm này?')) return; try { await rpc('ct_chat_leave', { p_id: c.id }); closeSheet(); this.open(); } catch (e) { toast(e.message, true); } return; }
      if (a !== 'cg-save') return;
      const members = [...document.querySelectorAll('#sheet-body .cg-m:checked')].map((x) => x.value), name = $('#cg-name').value.trim();
      if (!members.length) return toast('Chọn ít nhất một người', true);
      b.disabled = true;
      try {
        if (isNew) { const id = await rpc('ct_chat_create', { p_name: name, p_emoji: emoji, p_members: members }); closeSheet(); this.openChat(id); }
        else { await rpc('ct_chat_update', { p_id: c.id, p_name: name, p_emoji: emoji, p_members: members }); closeSheet(); this.openChat(c.id); }
      } catch (e) { b.disabled = false; toast(e.message, true); }
    });
  },
  infoSheet() {
    const c = this.cur;
    if (c.kind === 'group') return this.groupSheet(c);
    sheet(`<h3>${esc(this.av(c))} ${esc(c.name)}</h3><div class="hint">Nhóm tự có của cả nhà: bố mẹ và người thân đều ở đây.</div>
      <div class="ch-people">${c.members.map((p) => `<div class="ch-person"><span>${ROLE_ICON[p.role] || '👤'}</span><b>${esc(p.name)}</b><em>${esc(ROLE_NAME(p.role))}</em></div>`).join('')}</div>
      <button class="btn primary" data-a="x">Đóng</button>`, () => closeSheet());
  },

  // ---------- Số tin chưa đọc trên nút 💬 ----------
  badge(n) {
    const el = $('#v-chat'); if (!el) return;
    if (n === undefined) n = (this.list || []).reduce((s, c) => s + c.unread, 0);
    el.querySelector('b').textContent = n > 99 ? '99+' : n;
    el.querySelector('b').classList.toggle('hidden', !n);
  },
  async refreshBadge() {
    if (!S || document.hidden) return;
    try { this.badge(await rpc('ct_chat_unread')); } catch (e) { /* máy chủ cũ / mất mạng */ }
  },
};
const ROLE_NAME = (r) => ({ owner: 'Bố mẹ', parent: 'Bố mẹ', relative: 'Người thân', teacher: 'Giáo viên', child: 'Bé' }[r] || '');

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a^="C-"]');
  const img = e.target.closest('#chat [data-a="P-img"]');
  if (img) return imageSheet(img.dataset.src, img.dataset.cap);
  if (!b) return;
  const a = b.dataset.a, m = Chat.msgs.find((x) => x.id === b.dataset.id);
  if (a === 'C-open') return Chat.openChat(b.dataset.id);
  if (a === 'C-chat') return Chat.open();
  if (a === 'C-close') return Chat.close();
  if (a === 'C-list') return Chat.open();
  if (a === 'C-new') return Chat.groupSheet(null);
  if (a === 'C-info') return Chat.infoSheet();
  if (a === 'C-unpick') { $('#ch-files').value = ''; return Chat.preview(); }
  if (a === 'C-pin' && m) return Chat.pinSheet(m);
  if (a === 'C-older') {
    const r = await rpc('ct_chat_messages', { p_chat: Chat.cur.id, p_before: Chat.msgs[0].at });
    const box = $('#ch-msgs'), h = box.scrollHeight;
    Chat.msgs = r.messages.concat(Chat.msgs); Chat.more = r.more; Chat.paintMsgs(false); box.scrollTop = box.scrollHeight - h;
    return;
  }
  if (a === 'C-play') {
    const v = b.querySelector('video'); if (b.classList.contains('on')) return;
    b.classList.add('on'); v.muted = false; v.controls = true;
    const p = v.play(); if (p && p.catch) p.catch(() => {});
    return;
  }
  if (a === 'C-menu' && m) {
    const md = (m.media || []).filter((x) => x.url);
    const items = [];
    if (m.body) items.push('<button class="choice" data-a="cm-copy">📋 Sao chép chữ</button>');
    if (md.length && !m.entry_id && Chat.canPin()) items.push('<button class="choice" data-a="cm-pin">📌 Đưa vào Nhật ký</button>');
    if (m.mine) items.push('<button class="choice" data-a="cm-del" style="color:var(--danger)">↩ Thu hồi tin nhắn</button>');
    if (!items.length) return;
    sheet(`<h3>Tin nhắn</h3>${items.join('')}`, async (x) => {
      if (x === 'cm-copy') { try { await navigator.clipboard.writeText(m.body); toast('Đã sao chép'); } catch (err) { /* trình duyệt chặn */ } return closeSheet(); }
      if (x === 'cm-pin') return Chat.pinSheet(m);
      if (x === 'cm-del') { if (!confirm('Thu hồi tin nhắn này? Ảnh/video đã đưa vào Nhật ký vẫn được giữ.')) return; try { await rpc('ct_chat_delete', { p_id: m.id }); closeSheet(); await Chat.reload(); } catch (err) { toast(err.message, true); } }
    });
  }
});
document.addEventListener('submit', (e) => { if (e.target.id === 'ch-comp') { e.preventDefault(); Chat.send(); } });
document.addEventListener('change', (e) => { if (e.target.id === 'ch-files') Chat.preview(); });
document.addEventListener('input', (e) => { if (e.target.id === 'ch-in') { e.target.style.height = ''; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; } });
document.addEventListener('keydown', (e) => { if (e.target.id === 'ch-in' && e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); Chat.send(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) Chat.refreshBadge(); });
setTimeout(() => Chat.refreshBadge(), 2500);
Chat.badgeTimer = setInterval(() => { if (!Chat.cur) Chat.refreshBadge(); }, 30000);
