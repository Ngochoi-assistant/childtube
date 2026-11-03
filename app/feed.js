// ChildTube — tab "Nhật ký" (mở app là vào đây): bảng tin kiểu mạng xã hội (bài đăng, ảnh, cảm xúc, bình luận của cả nhà).
// Máy chủ: ct_journal_list (kèm author, reactions, comments), ct_react, ct_comment, ct_comment_delete.
const Feed = {
  list: null, key: null, open: new Set(), filter: '',
  REACTS: ['❤️', '😂', '👏', '😮', '🥹'],
  // Vẽ ngay bản đã có (trong máy hoặc lần mở trước), rồi hỏi máy chủ; chỉ vẽ lại khi dữ liệu khác → không nháy, video không tải lại.
  async render() {
    const v = $('#view'), k = curKid(), key = (k ? k.id : 'all') + '|' + this.filter;
    if (this.key !== key) { this.list = null; this.key = key; this.sig = ''; }
    if (!this.list && !this.filter) this.list = this.cached(key);
    if (this.list) { if (!v.querySelector('.fd-post, .fd-comp') || v.dataset.feed !== this.sig) this.paint(k); }
    else v.innerHTML = pageHead('') + '<div class="empty"><span class="spin"></span></div>';
    let list;
    try { list = await rpc('ct_journal_list', { p_child: k ? k.id : null, p_kind: this.filter === 'mile' ? 'milestone' : this.filter === 'teacher' ? 'feedback' : null, p_media: this.filter === 'photo' }); }
    catch (e) { return toast(e.message, true); }
    if (this.key !== key) return;
    this.list = list;
    if (!this.filter) this.store(key, list);
    if (tab === 'feed' && this.sigOf(list) !== v.dataset.feed) this.paint(k);
  },
  // Chữ ký dữ liệu bỏ qua link ảnh (link ký lại mỗi lần hỏi máy chủ cũ) để không vẽ lại khi chỉ link đổi
  sigOf(list) { return JSON.stringify(list, (k2, x) => (k2 === 'url' ? undefined : x)); },
  paint(k) {
    const v = $('#view');
    this.sig = this.sigOf(this.list);
    v.innerHTML = this.html(k); v.dataset.feed = this.sig;
    if (typeof UpQ !== 'undefined') UpQ.paint();
  },
  // Lưu bảng tin trong máy 2 tiếng (link ảnh/video còn hạn) để mở app là thấy ngay
  cached(key) {
    try { const c = JSON.parse(localStorage.getItem('ct-feed') || 'null'); return c && c.key === key && Date.now() - c.at < 2 * 3600e3 ? c.list : null; } catch (e) { return null; }
  },
  store(key, list) { try { localStorage.setItem('ct-feed', JSON.stringify({ key, at: Date.now(), list: list.slice(0, 30) })); } catch (e) { /* đầy bộ nhớ: bỏ qua */ } },
  // Chỉ vẽ lại phần cảm xúc, bình luận của một bài (ảnh/video giữ nguyên, không tải lại)
  patch(id) {
    const e = (this.list || []).find((x) => x.id === id), old = document.querySelector(`.fd-post[data-id="${id}"]`);
    if (!e || !old) return;
    const t = document.createElement('div'); t.innerHTML = this.post(e);
    const sel = '.fd-sum, .fd-bar, .fd-pick, .fd-cms, .fd-reply';
    old.querySelectorAll(':scope > :is(' + sel + ')').forEach((x) => x.remove());
    t.firstElementChild.querySelectorAll(':scope > :is(' + sel + ')').forEach((x) => old.appendChild(x));
    this.sig = this.sigOf(this.list); $('#view').dataset.feed = this.sig;
  },
  // Thả cảm xúc: đổi trên màn hình ngay, gửi máy chủ phía sau; lỗi thì trả lại như cũ
  async react(id, emoji) {
    const e = (this.list || []).find((x) => x.id === id); if (!e) return;
    const r = e.reactions = e.reactions || { counts: {}, total: 0, names: [], mine: null }, before = JSON.stringify(r);
    const me = (S.me && S.me.name) || 'Bạn', next = r.mine === emoji ? null : emoji;
    if (r.mine) { r.counts[r.mine]--; if (r.counts[r.mine] <= 0) delete r.counts[r.mine]; r.total--; r.names = r.names.filter((n) => n !== me); }
    if (next) { r.counts[next] = (r.counts[next] || 0) + 1; r.total++; r.names = [me, ...r.names]; }
    r.mine = next;
    this.patch(id);
    try { await rpc('ct_react', { p_entry: id, p_emoji: next }); }
    catch (err) { e.reactions = JSON.parse(before); this.patch(id); toast(err.message, true); }
  },
  ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'vừa xong'; if (s < 3600) return Math.floor(s / 60) + ' phút trước'; if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' ngày trước';
    return new Date(iso).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' });
  },
  // "5 phút trước" trong 1 tiếng đầu; sau đó "Hôm nay lúc 14:30", "3 tháng 11 lúc 08:15"
  when(e) {
    const d = e.data || {}, today = vnNow().slice(0, 10);
    if (!d.time && e.day === today && e.created_at && Date.now() - new Date(e.created_at) < 3600e3) return this.ago(e.created_at);
    return jWhen(e) || this.ago(e.created_at);
  },
  html(k) {
    const me = S.me || {}, canWrite = !S.restricted || me.role === 'teacher';
    const name = k ? esc(k.name) : 'các bé';
    const composer = canWrite ? `<div class="card fd-comp"><div class="fd-row"><span class="fd-av">${ROLE_ICON[me.role] || '👤'}</span>
        <button class="fd-in" data-a="F2-write">${me.role === 'teacher' ? 'Viết nhận xét về ' + name + '…' : 'Hôm nay ' + name + ' có gì đáng nhớ?'}</button></div>
        ${me.role === 'teacher' ? '' : `<div class="fd-acts"><button data-a="F2-media">📷 Ảnh/video</button><button data-a="F2-mood">😊 Cảm xúc/Hoạt động</button></div>`}</div>` : '';
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
    return `${pageHead('')}<div id="up-banner"></div>${composer}<div class="chips strip fd-filter">${chips}</div>
      ${posts || `<div class="card"><div class="empty">${canWrite ? 'Bài đăng đầu tiên: một bức ảnh, một câu nói ngộ nghĩnh, hay việc bé tự làm được.' : 'Chưa có bài đăng nào được chia sẻ.'}</div></div>`}`;
  },
  post(e) {
    const k = kidOf(e.child_id), a = e.author || { name: 'Gia đình', role: null };
    const canAssess = !S.restricted || (S.me && S.me.role === 'teacher');
    const kind = { checkin: '☀️ Ghi nhanh', note: '📝 Ghi chú', milestone: '🌟 Cột mốc', achievement: '🏆 Thành tích', feedback: '🧑‍🏫 Nhận xét', activity: '🎨 Hoạt động' }[e.kind] || '';
    const d = e.data || {};
    const moodI = { vui: '😄', 'bình thường': '🙂', mệt: '🥱', buồn: '😢', cáu: '😠' }[d.mood];
    const media = e.media.filter((m) => m.url);
    // iPhone không vẽ khung đầu của video nếu thiếu #t và muted → để trống; chạm ▶ thì phát ngay trong bài
    const one = media.length === 1 ? media[0] : null;
    const ratio = one ? (one.w && one.h ? Math.max(0.56, Math.min(1.6, one.w / one.h)) : one.mime.startsWith('video/') ? 0.8 : 1) : 0;
    const grid = media.length ? `<div class="fd-media n${Math.min(media.length, 4)}"${one ? ` style="aspect-ratio:${ratio.toFixed(3)}"` : ''}>${media.slice(0, 4).map((m, i) => (m.mime.startsWith('image/')
      ? `<img src="${esc(mediaUrl(m.url))}" alt="" loading="${i || e !== this.list[0] ? 'lazy' : 'eager'}" decoding="async" data-a="F2-view" data-id="${e.id}" data-i="${i}">`
      : `<div class="fd-vid" data-a="F2-play">${vidTag(m, 'loop')}<span class="fd-play big">▶</span><span class="fd-mute">🔇</span><button class="fd-full" data-a="F2-view" data-id="${e.id}" data-i="${i}" aria-label="Xem lớn, tải về">⤢</button></div>`)
      + (i === 3 && media.length > 4 ? `<span class="fd-more" data-a="F2-view" data-id="${e.id}" data-i="3">+${media.length - 4}</span>` : '')).join('')}</div>` : '';
    const special = (e.kind === 'milestone' || e.kind === 'feedback' || e.kind === 'achievement') && !media.length
      ? `<div class="fd-mile"><span>${e.kind === 'feedback' ? '🎤' : e.kind === 'achievement' ? '🏆' : '🌟'}</span><div><b>${esc(e.title || kind)}</b>${e.body ? `<div>${esc(e.body)}</div>` : ''}</div></div>` : '';
    const text = special ? '' : `<div class="fd-text">${kind && e.kind !== 'checkin' ? `<span class="fd-tag">${kind}</span>` : ''}${d.lesson ? '<span class="fd-tag">🎓 Dạy bé · có trên TV</span>' : ''}${e.title ? `<b>${esc(e.title)}</b> ` : ''}${moodI && !d.feel ? `<span class="fd-mood">${moodI} ${k ? esc(k.name) + ' ' : ''}${esc(d.mood)}</span> ` : ''}${esc(e.body || '')}
      ${(d.interests || []).length || (d.activities || []).length ? `<div class="fd-chips">${(d.interests || []).map((x) => `<span>❤️ ${esc(x)}</span>`).join('')}${(d.activities || []).map((x) => `<span>✔ ${esc(x)}</span>`).join('')}</div>` : ''}</div>`;
    const r = e.reactions || { counts: {}, total: 0, names: [], mine: null };
    const icons = Object.entries(r.counts).sort((x, y) => y[1] - x[1]).map(([em]) => em).join('');
    const who = r.total ? `${icons} ${esc(r.names.slice(0, 2).join(', '))}${r.total > 2 ? ` và ${r.total - 2} người khác` : ''}` : '';
    const cm = e.comments || [], openAll = this.open.has(e.id);
    const shown = openAll ? cm : cm.slice(-2);
    return `<article class="fd-post" data-id="${e.id}">
      <div class="fd-head"><span class="fd-av ${a.role || ''}">${ROLE_ICON[a.role] || '👤'}</span>
        <div class="fd-who"><b>${esc(a.name)}</b>${k ? ` cùng <b>${esc(k.emoji)} ${esc(k.name)}</b>` : ''}${a.role === 'teacher' ? ' · Giáo viên' : ''}${feelText(d) ? ` <span class="fd-feel">— ${feelText(d)}</span>` : ''}
          <div class="m">${this.when(e)} · ${{ family: '👨‍👩‍👧', parents: '🔒 Chỉ bố mẹ', sensitive: '⚠️ Nhạy cảm' }[e.privacy] || ''}</div></div>
        ${e.mine || !S.restricted || (canAssess && e.child_id) ? `<button class="icon-btn" data-a="F2-menu" data-id="${e.id}" aria-label="Tuỳ chọn">⋯</button>` : ''}</div>
      ${text}${special}${grid}<div class="fd-up hidden" data-id="${e.id}"></div>
      ${who || cm.length ? `<div class="fd-sum"><span>${who}</span>${cm.length ? `<button data-a="F2-cm" data-id="${e.id}">${cm.length} bình luận</button>` : ''}</div>` : ''}
      <div class="fd-bar">
        <button class="fd-love ${r.mine ? 'on' : ''}" data-a="F2-love" data-id="${e.id}" aria-label="Thả cảm xúc (giữ để chọn)">${r.mine || '🤍'} ${r.mine ? ({ '❤️': 'Thương', '😂': 'Haha', '👏': 'Giỏi quá', '😮': 'Wow', '🥹': 'Xúc động' }[r.mine] || 'Đã thả') : 'Thương'}</button>
        <button data-a="F2-cm" data-id="${e.id}">💬 Bình luận</button></div>
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
  if (a === 'F2-upretry') return UpQ.retry();
  if (a === 'F2-view') {   // xem toàn màn hình mọi ảnh/video của bài, tải về được
    const en = (Feed.list || []).find((x) => x.id === id);
    if (en) mediaViewer(en.media.filter((m) => m.url).map((m) => ({ url: mediaUrl(m.url), mime: m.mime })), +b.dataset.i || 0, en.title || en.body || '');
    return;
  }
  if (a === 'F2-play') {   // chạm video: bật tiếng + thanh điều khiển ngay trong bài; video khác đang chạy thì dừng
    const v = b.querySelector('video');
    if (b.classList.contains('on')) return;
    if (v.dataset.src) { v.src = v.dataset.src; delete v.dataset.src; }
    document.querySelectorAll('.fd-vid video').forEach((x) => { if (x !== v) x.pause(); });
    b.classList.add('on', 'live'); v.muted = false; v.controls = true; v.loop = false;
    const p = v.play(); if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); });
    return;
  }
  const entry = (Feed.list || []).find((x) => x.id === id);
  try {
    if (a === 'F2-write') return entrySheet(null);
    if (a === 'F2-media') { entrySheet(null); const f = $('#je-files'); if (f) f.click(); return; }   // mở luôn kho ảnh của điện thoại
    if (a === 'F2-mile') { entrySheet(null); setTimeout(() => { const s = $('#je-kind'); if (s) s.value = 'milestone'; }, 0); return; }
    if (a === 'F2-mood') return entrySheet(null, { feel: true });
    if (a === 'F2-goto') { const p = document.querySelector(`.fd-post[data-id="${id}"]`); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (a === 'F2-filter') { Feed.filter = b.dataset.v; return render(); }
    if (a === 'F2-love' && Date.now() - (Feed.held || 0) < 900) return;   // vừa giữ lâu để mở bảng chọn: không thả tim
    if (a === 'F2-love') return Feed.react(id, entry && entry.reactions && entry.reactions.mine ? entry.reactions.mine : '❤️');
    if (a === 'F2-pick') return $('#pick-' + id).classList.toggle('hidden');
    if (a === 'F2-react') return Feed.react(id, b.dataset.v);
    if (a === 'F2-cm') { Feed.open.add(id); if ((entry.comments || []).length > 2) Feed.patch(id); const f = $('#rep-' + id); if (f) { f.classList.remove('hidden'); f.querySelector('input').focus(); } return; }
    if (a === 'F2-cdel') {
      if (!confirm('Xoá bình luận?')) return;
      await rpc('ct_comment_delete', { p_id: id });
      const en = (Feed.list || []).find((x) => (x.comments || []).some((c) => c.id === id));
      if (en) { en.comments = en.comments.filter((c) => c.id !== id); Feed.patch(en.id); }
      return;
    }
    if (a === 'F2-ass') { V.child = b.dataset.k; return Learn.assessSheet(null, id); }
    if (a === 'F2-menu') {
      // Việc ít dùng gom vào ⋯ cho thanh dưới bài chỉ còn Thương + Bình luận
      const own = entry.mine || !S.restricted, ass = (!S.restricted || (S.me && S.me.role === 'teacher')) && entry.child_id;
      sheet(`<h3>Bài đăng</h3>${ass ? '<button class="choice" data-a="m-ass">🌟 Ghi năng lực từ bài này</button>' : ''}${own ? `<button class="choice" data-a="m-edit">✎ Sửa bài</button><button class="choice" data-a="m-del" style="color:var(--danger)">🗑 Xoá bài (kèm ảnh)</button>` : ''}`, async (x) => {
        if (x === 'm-ass') { closeSheet(); V.child = entry.child_id; return Learn.assessSheet(null, id); }
        if (x === 'm-edit') return entrySheet(entry);
        if (x === 'm-del') { if (!confirm('Xoá bài đăng này?')) return; try { await rpc('ct_journal_delete', { p_id: id }); closeSheet(); Feed.refresh(); } catch (err) { toast(err.message, true); } }
      });
    }
  } catch (err) { toast(err.message, true); }
});
// Như Facebook: video tự chạy (không tiếng) khi cuộn tới giữa màn hình, cuộn qua thì dừng
const feedSeen = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => ents.forEach((en) => {
  const v = en.target, tile = v.closest('.fd-vid');
  if (!tile) return;
  if (en.isIntersecting && en.intersectionRatio >= 0.6) {
    if (tile.classList.contains('on')) return;   // người xem đã bật tiếng / tự điều khiển
    if (v.getAttribute('poster')) return;         // đã có ảnh bìa: không tự phát (video gốc 4K nặng), bấm ▶ mới tải
    if (document.querySelector('.fd-vid.on video:not([paused])') && [...document.querySelectorAll('.fd-vid.on video')].some((x) => !x.paused)) return;
    v.muted = true; tile.classList.add('live');
    const p = v.play(); if (p && p.catch) p.catch(() => tile.classList.remove('live'));
  } else { v.pause(); if (!tile.classList.contains('on')) tile.classList.remove('live'); }
}), { threshold: [0, 0.6] }) : null;
// Video chỉ bắt đầu tải khi sắp cuộn tới (cách ~1 màn hình): mở bảng tin không phải tải hết mọi video cùng lúc
// Thẻ video trong bảng tin: có ảnh bìa thì hiện ảnh, chỉ tải video khi bấm ▶; chưa có thì tải khung đầu (máy này chụp lại làm ảnh bìa)
function vidTag(m, extra = '') {
  return m.poster
    ? `<video data-src="${esc(mediaUrl(m.url))}" poster="${esc(mediaUrl(m.poster))}" muted playsinline preload="none" ${extra}></video>`
    : `<video data-src="${esc(mediaUrl(m.url))}#t=0.5" data-mid="${esc(m.id)}" crossorigin="anonymous" muted playsinline preload="metadata" ${extra}></video>`;
}
// Video cũ chưa có ảnh bìa: máy nào xem được khung hình đầu thì chụp gửi lên một lần, lần sau cả nhà thấy ảnh bìa ngay
const posterSent = new Set();
$('#view').addEventListener('loadeddata', (e) => {
  const v = e.target, id = v.dataset && v.dataset.mid;
  if (!id || posterSent.has(id) || S.restricted || typeof posterOf !== 'function') return;
  posterSent.add(id);
  setTimeout(() => posterOf(v).then((b) => b && sendPoster(id, b).catch(() => {})), 300);
}, true);
const feedNear = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => ents.forEach((en) => {
  if (!en.isIntersecting) return;
  const v = en.target; feedNear.unobserve(v);
  if (v.dataset.src) { v.src = v.dataset.src; delete v.dataset.src; }
}), { rootMargin: '900px 400px' }) : null;
new MutationObserver(() => {
  document.querySelectorAll('#view video[data-src]:not([data-near])').forEach((v) => { v.dataset.near = 1; if (feedNear) feedNear.observe(v); else { v.src = v.dataset.src; delete v.dataset.src; } });
  if (feedSeen) document.querySelectorAll('#view .fd-vid video:not([data-seen])').forEach((v) => { v.dataset.seen = 1; feedSeen.observe(v); });
}).observe($('#view'), { childList: true, subtree: true });
// Video cũ chưa lưu kích thước: đọc được khung hình thì chỉnh khung bài đăng cho vừa (dọc/ngang)
$('#view').addEventListener('loadedmetadata', (e) => {
  const v = e.target, box = v.closest && v.closest('.fd-media.n1');
  if (!box || !v.videoWidth || !v.videoHeight) return;
  box.style.aspectRatio = Math.max(0.56, Math.min(1.6, v.videoWidth / v.videoHeight)).toFixed(3);
}, true);
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
  try {
    const id = f.dataset.id, cid = await rpc('ct_comment', { p_entry: id, p_body: body }), en = (Feed.list || []).find((x) => x.id === id);
    Feed.open.add(id);
    if (!en) return Feed.refresh();
    const me = S.me || {};
    en.comments = [...(en.comments || []), { id: typeof cid === 'string' ? cid : 'new' + Date.now(), body, at: new Date().toISOString(), name: me.name || 'Bạn', role: me.role, me: true }];
    Feed.patch(id);
    if (typeof cid !== 'string') Feed.list = null;   // máy chủ không trả mã bình luận: lần sau hỏi lại để xoá được
  } catch (err) { inp.disabled = false; toast(err.message, true); }
});
