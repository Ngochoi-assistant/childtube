// ChildTube — tab "Nhật ký" (mở app là vào đây): bảng tin kiểu mạng xã hội (bài đăng, ảnh, cảm xúc, bình luận của cả nhà).
// Máy chủ: ct_journal_list (kèm author, reactions, comments), ct_react, ct_comment, ct_comment_delete.
const Feed = {
  list: null, key: null, open: new Set(), filter: '',
  REACTS: ['❤️', '😂', '👏', '😮', '🥹'],
  async render() {
    const v = $('#view'), k = curKid(), key = (k ? k.id : 'all') + '|' + this.filter;
    if (this.key !== key) { this.list = null; this.key = key; }
    if (!this.list) v.innerHTML = pageHead('') + '<div class="empty"><span class="spin"></span></div>';
    try { this.list = await rpc('ct_journal_list', { p_child: k ? k.id : null, p_kind: this.filter === 'mile' ? 'milestone' : this.filter === 'teacher' ? 'feedback' : null, p_media: this.filter === 'photo' }); }
    catch (e) { return toast(e.message, true); }
    if (tab !== 'feed' || this.key !== key) return;
    v.innerHTML = this.html(k);
  },
  ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'vừa xong'; if (s < 3600) return Math.floor(s / 60) + ' phút trước'; if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' ngày trước';
    return new Date(iso).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' });
  },
  html(k) {
    const me = S.me || {}, canWrite = !S.restricted || me.role === 'teacher';
    const name = k ? esc(k.name) : 'các bé';
    const composer = canWrite ? `<div class="card fd-comp"><div class="fd-row"><span class="fd-av">${ROLE_ICON[me.role] || '👤'}</span>
        <button class="fd-in" data-a="F2-write">${me.role === 'teacher' ? 'Viết nhận xét về ' + name + '…' : 'Hôm nay ' + name + ' có gì đáng nhớ?'}</button></div>
        ${me.role === 'teacher' ? '' : `<div class="fd-acts"><button data-a="F2-media">📷 Ảnh/video</button><button data-a="F2-mile">🌟 Cột mốc</button><button data-a="F2-mood">😄 Cảm xúc</button></div>`}</div>` : '';
    const withMedia = (this.list || []).filter((e) => e.media.some((m) => m.url)).slice(0, 8);
    const stories = withMedia.length ? `<div class="fd-stories">${withMedia.map((e) => {
      const m = e.media.find((x) => x.url && x.mime.startsWith('image/')) || e.media[0], c = kidOf(e.child_id);
      const vid = !m.mime.startsWith('image/');   // tin video: hiện khung hình đầu, bấm thì cuộn tới bài
      return `<button class="fd-story${vid ? ' vid' : ''}" ${vid ? `data-a="F2-goto" data-id="${e.id}"` : `data-a="P-img" data-src="${esc(mediaUrl(m.url))}" data-cap="${esc(e.title || '')}" style="background-image:url('${esc(mediaUrl(m.url))}')"`}>${vid ? `<video src="${esc(mediaUrl(m.url))}#t=0.5" muted playsinline preload="metadata"></video><span class="fd-play">▶</span>` : ''}<span class="fd-sav">${esc(c ? c.emoji : '👨‍👩‍👧')}</span><span class="fd-st">${esc((e.title || jDay(e.day)).slice(0, 28))}</span></button>`;
    }).join('')}</div>` : '';
    const chips = [['', 'Tất cả'], ['photo', 'Ảnh'], ['mile', 'Cột mốc'], ['teacher', 'Thầy cô']].map(([v2, t]) => `<button class="chip ${this.filter === v2 ? 'on' : ''}" data-a="F2-filter" data-v="${v2}">${t}</button>`).join('');
    // Kiểu game: bé đã làm được gì (Cột mốc, Thành tích) — cùng dữ liệu với bản đồ Hành trình và TV
    const wins = (this.list || []).filter((e) => e.kind === 'milestone' || e.kind === 'achievement').map((e) => {
      const img = (e.media || []).find((m) => m.url && /^image\/(jpeg|png|webp|gif)/.test(m.mime));
      return { id: e.id, kind: e.kind, title: e.title || e.body || 'Điều mới', text: e.title ? e.body : '', day: e.day, by: e.author ? e.author.name : '', photo: img ? mediaUrl(img.url) : '' };
    });
    Journey.feedWins = wins;
    const game = wins.length ? `<div class="card jr fd-game">${Journey.hud({ wins })}<div class="jr-head"><b>🏆 ${name === 'các bé' ? 'Các bé' : name} đã làm được</b>${k ? '<button class="btn link" data-a="J-road">🗺 Xem hành trình ›</button>' : ''}</div>${Journey.cards({ wins })}</div>` : '';
    const list = (this.list || []).map((e) => this.post(e));
    if (game) list.splice(Math.min(2, list.length), 0, game);
    const posts = list.join('');
    return `${pageHead('')}${composer}${stories}<div class="chips strip fd-filter">${chips}</div>
      ${posts || `<div class="card"><div class="empty">${canWrite ? 'Bài đăng đầu tiên: một bức ảnh, một câu nói ngộ nghĩnh, hay việc bé tự làm được.' : 'Chưa có bài đăng nào được chia sẻ.'}</div></div>`}`;
  },
  post(e) {
    const k = kidOf(e.child_id), a = e.author || { name: 'Gia đình', role: null };
    const kind = { checkin: '☀️ Ghi nhanh', note: '📝 Ghi chú', milestone: '🌟 Cột mốc', achievement: '🏆 Thành tích', feedback: '🧑‍🏫 Nhận xét', activity: '🎨 Hoạt động' }[e.kind] || '';
    const d = e.data || {};
    const moodI = { vui: '😄', 'bình thường': '🙂', mệt: '🥱', buồn: '😢', cáu: '😠' }[d.mood];
    const media = e.media.filter((m) => m.url);
    // iPhone không vẽ khung đầu của video nếu thiếu #t và muted → để trống; chạm ▶ thì phát ngay trong bài
    const one = media.length === 1 ? media[0] : null;
    const ratio = one ? (one.w && one.h ? Math.max(0.56, Math.min(1.6, one.w / one.h)) : one.mime.startsWith('video/') ? 0.8 : 1) : 0;
    const grid = media.length ? `<div class="fd-media n${Math.min(media.length, 3)}"${one ? ` style="aspect-ratio:${ratio.toFixed(3)}"` : ''}>${media.slice(0, 3).map((m, i) => (m.mime.startsWith('image/')
      ? `<img src="${esc(mediaUrl(m.url))}" alt="" decoding="async" data-a="P-img" data-src="${esc(mediaUrl(m.url))}" data-cap="${esc(e.title || '')}">`
      : `<div class="fd-vid" data-a="F2-play"><video src="${esc(mediaUrl(m.url))}#t=0.5" muted playsinline preload="metadata"></video><span class="fd-play big">▶</span></div>`)
      + (i === 2 && media.length > 3 ? `<span class="fd-more">+${media.length - 3}</span>` : '')).join('')}</div>` : '';
    const special = (e.kind === 'milestone' || e.kind === 'feedback' || e.kind === 'achievement') && !media.length
      ? `<div class="fd-mile"><span>${e.kind === 'feedback' ? '🎤' : e.kind === 'achievement' ? '🏆' : '🌟'}</span><div><b>${esc(e.title || kind)}</b>${e.body ? `<div>${esc(e.body)}</div>` : ''}</div></div>` : '';
    const text = special ? '' : `<div class="fd-text">${kind && e.kind !== 'checkin' ? `<span class="fd-tag">${kind}</span>` : ''}${d.lesson ? '<span class="fd-tag">🎓 Dạy bé · có trên TV</span>' : ''}${e.title ? `<b>${esc(e.title)}</b> ` : ''}${moodI ? `<span class="fd-mood">${moodI} ${k ? esc(k.name) + ' ' : ''}${esc(d.mood)}</span> ` : ''}${esc(e.body || '')}
      ${(d.interests || []).length || (d.activities || []).length ? `<div class="fd-chips">${(d.interests || []).map((x) => `<span>❤️ ${esc(x)}</span>`).join('')}${(d.activities || []).map((x) => `<span>✔ ${esc(x)}</span>`).join('')}</div>` : ''}</div>`;
    const r = e.reactions || { counts: {}, total: 0, names: [], mine: null };
    const icons = Object.entries(r.counts).sort((x, y) => y[1] - x[1]).map(([em]) => em).join('');
    const who = r.total ? `${icons} ${esc(r.names.slice(0, 2).join(', '))}${r.total > 2 ? ` và ${r.total - 2} người khác` : ''}` : '';
    const cm = e.comments || [], openAll = this.open.has(e.id);
    const shown = openAll ? cm : cm.slice(-2);
    const canAssess = !S.restricted || (S.me && S.me.role === 'teacher');
    return `<article class="fd-post" data-id="${e.id}">
      <div class="fd-head"><span class="fd-av ${a.role || ''}">${ROLE_ICON[a.role] || '👤'}</span>
        <div class="fd-who"><b>${esc(a.name)}</b>${k ? ` cùng <b>${esc(k.emoji)} ${esc(k.name)}</b>` : ''}${a.role === 'teacher' ? ' · Giáo viên' : ''}
          <div class="m">${e.day && e.day !== new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) ? jDay(e.day) : this.ago(e.created_at)} · ${{ family: '👨‍👩‍👧', parents: '🔒 Chỉ bố mẹ', sensitive: '⚠️ Nhạy cảm' }[e.privacy] || ''}</div></div>
        ${e.mine || (!S.restricted) ? `<button class="icon-btn" data-a="F2-menu" data-id="${e.id}" aria-label="Tuỳ chọn">⋯</button>` : ''}</div>
      ${text}${special}${grid}
      ${who || cm.length ? `<div class="fd-sum"><span>${who}</span>${cm.length ? `<button data-a="F2-cm" data-id="${e.id}">${cm.length} bình luận</button>` : ''}</div>` : ''}
      <div class="fd-bar">
        <button class="fd-love ${r.mine ? 'on' : ''}" data-a="F2-love" data-id="${e.id}" aria-label="Thả cảm xúc (giữ để chọn)">${r.mine || '🤍'} ${r.mine ? ({ '❤️': 'Thương', '😂': 'Haha', '👏': 'Giỏi quá', '😮': 'Wow', '🥹': 'Xúc động' }[r.mine] || 'Đã thả') : 'Thương'}</button>
        <button data-a="F2-cm" data-id="${e.id}">💬 Bình luận</button>
        ${canAssess && e.child_id ? `<button data-a="F2-ass" data-id="${e.id}" data-k="${e.child_id}">🌟 Ghi năng lực</button>` : ''}</div>
      <div class="fd-pick hidden" id="pick-${e.id}">${this.REACTS.map((x) => `<button data-a="F2-react" data-id="${e.id}" data-v="${x}">${x}</button>`).join('')}</div>
      ${shown.length ? `<div class="fd-cms">${cm.length > shown.length ? `<button class="btn link" data-a="F2-cm" data-id="${e.id}">Xem cả ${cm.length} bình luận</button>` : ''}
        ${shown.map((c) => `<div class="fd-cm"><span class="fd-av sm">${ROLE_ICON[c.role] || '👤'}</span><div class="fd-bub"><b>${esc(c.name)}</b>${esc(c.body)}</div>
          ${c.me || !S.restricted ? `<button class="icon-btn sm" data-a="F2-cdel" data-id="${c.id}" aria-label="Xoá">✕</button>` : ''}</div>`).join('')}</div>` : ''}
      <form class="fd-reply ${openAll || cm.length ? '' : 'hidden'}" id="rep-${e.id}" data-id="${e.id}"><input placeholder="Viết bình luận…" maxlength="1000"><button class="btn small dark" type="submit">Gửi</button></form>
    </article>`;
  },
  refresh() { this.list = null; render(); },
};

$('#view').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a^="F2-"]');
  if (!b) return;
  const a = b.dataset.a, id = b.dataset.id, k = curKid();
  if (a === 'F2-play') {   // phát video ngay trong bài: bật tiếng, hiện thanh điều khiển; video khác đang chạy thì dừng
    const v = b.querySelector('video');
    if (b.classList.contains('on')) return;
    document.querySelectorAll('.fd-vid.on video').forEach((x) => x.pause());
    b.classList.add('on'); v.muted = false; v.controls = true;
    const p = v.play(); if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); });
    return;
  }
  const entry = (Feed.list || []).find((x) => x.id === id);
  try {
    if (a === 'F2-write') return entrySheet(null);
    if (a === 'F2-media') { entrySheet(null); const f = $('#je-files'); if (f) f.click(); return; }   // mở luôn kho ảnh của điện thoại
    if (a === 'F2-mile') { entrySheet(null); setTimeout(() => { const s = $('#je-kind'); if (s) s.value = 'milestone'; }, 0); return; }
    if (a === 'F2-mood') return checkinSheet(k ? k.id : null);
    if (a === 'F2-goto') { const p = document.querySelector(`.fd-post[data-id="${id}"]`); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (a === 'F2-filter') { Feed.filter = b.dataset.v; return render(); }
    if (a === 'F2-love' && Date.now() - (Feed.held || 0) < 900) return;   // vừa giữ lâu để mở bảng chọn: không thả tim
    if (a === 'F2-love') { await rpc('ct_react', { p_entry: id, p_emoji: entry && entry.reactions.mine ? null : '❤️' }); return Feed.refresh(); }
    if (a === 'F2-pick') return $('#pick-' + id).classList.toggle('hidden');
    if (a === 'F2-react') { await rpc('ct_react', { p_entry: id, p_emoji: entry && entry.reactions.mine === b.dataset.v ? null : b.dataset.v }); return Feed.refresh(); }
    if (a === 'F2-cm') { Feed.open.add(id); const f = $('#rep-' + id); if (f) { f.classList.remove('hidden'); f.querySelector('input').focus(); } if ((entry.comments || []).length > 2) render(); return; }
    if (a === 'F2-cdel') { if (!confirm('Xoá bình luận?')) return; await rpc('ct_comment_delete', { p_id: id }); return Feed.refresh(); }
    if (a === 'F2-ass') { V.child = b.dataset.k; return Learn.assessSheet(null, id); }
    if (a === 'F2-menu') {
      sheet(`<h3>Bài đăng</h3><button class="choice" data-a="m-edit">✎ Sửa bài</button><button class="choice" data-a="m-del" style="color:var(--danger)">🗑 Xoá bài (kèm ảnh)</button>`, async (x) => {
        if (x === 'm-edit') return entrySheet(entry);
        if (x === 'm-del') { if (!confirm('Xoá bài đăng này?')) return; try { await rpc('ct_journal_delete', { p_id: id }); closeSheet(); Feed.refresh(); } catch (err) { toast(err.message, true); } }
      });
    }
  } catch (err) { toast(err.message, true); }
});
// Giữ lâu nút "Thương" (hoặc di chuột trên máy tính) để chọn cảm xúc khác
let feedHold = null;
const feedPick = (id) => { document.querySelectorAll('.fd-pick').forEach((x) => x.classList.toggle('hidden', x.id !== 'pick-' + id)); };
$('#view').addEventListener('touchstart', (e) => {
  const b = e.target.closest('[data-a="F2-love"]'); if (!b) return;
  feedHold = setTimeout(() => { Feed.held = Date.now(); feedPick(b.dataset.id); if (navigator.vibrate) navigator.vibrate(15); }, 420);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach((t) => $('#view').addEventListener(t, () => clearTimeout(feedHold), { passive: true }));
$('#view').addEventListener('contextmenu', (e) => { const b = e.target.closest('[data-a="F2-love"]'); if (b) { e.preventDefault(); Feed.held = Date.now(); feedPick(b.dataset.id); } });
$('#view').addEventListener('mouseover', (e) => {
  if ('ontouchstart' in window) return;
  const b = e.target.closest('[data-a="F2-love"]'); if (!b) return;
  clearTimeout(feedHold); feedHold = setTimeout(() => feedPick(b.dataset.id), 600);
});
$('#view').addEventListener('submit', async (e) => {
  const f = e.target.closest('.fd-reply');
  if (!f) return;
  e.preventDefault();
  const inp = f.querySelector('input'), body = inp.value.trim();
  if (!body) return;
  inp.disabled = true;
  try { await rpc('ct_comment', { p_entry: f.dataset.id, p_body: body }); Feed.open.add(f.dataset.id); Feed.refresh(); } catch (err) { inp.disabled = false; toast(err.message, true); }
});
