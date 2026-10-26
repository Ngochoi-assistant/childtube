// ChildTube — app của bố mẹ (chạy trên điện thoại iOS/Android, cài ra màn hình chính như app).
const sb = supabase.createClient(CT_CONFIG.url, CT_CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const KIND = { channel: 'Kênh', playlist: 'Playlist', video: 'Video' };
const EMOJI = ['⭐', '🎵', '🔤', '🔢', '🔬', '🦁', '📚', '🎨', '🚗', '🌙', '🧸', '🌈', '⚽', '🍎', '🦖', '🚀'];
const SUGGEST_TOPICS = [['Âm nhạc', '🎵'], ['Tiếng Anh', '🔤'], ['Toán', '🔢'], ['Khoa học', '🔬'], ['Động vật', '🦁'], ['Truyện', '📚']];

let S = null;          // trạng thái gia đình (ct_state)
let tab = 'today';
let pendingLink = '';  // link nhận từ "Chia sẻ" hoặc extension

// ---------- Tiện ích ----------
let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), err ? 5000 : 3000);
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
async function yt(body) {
  const { data, error } = await sb.functions.invoke('ct-yt', { body });
  if (error) {
    let m = error.message;
    try { m = (await error.context.json()).error || m; } catch (e) { /* giữ thông báo gốc */ }
    throw new Error(m);
  }
  return data;
}
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); }
}
async function load() {
  S = await rpc('ct_state');
  $('#fam-name').textContent = S.family.name;
  updateBadge();
  render();
  offerPair();
}
// Cập nhật dữ liệu mà không vẽ lại màn hình (để không nháy khi đang duyệt hàng loạt).
async function quietLoad() { S = await rpc('ct_state'); updateBadge(); }
const pendTotal = () => S.sources.reduce((n, s) => n + (s.pending || 0), 0);
function updateBadge() {
  const n = pendTotal(), el = $('#pend-count');
  el.textContent = n > 99 ? '99+' : n;
  el.classList.toggle('hidden', !n);
}

// Có mã ghép từ QR trên TV: hỏi xác nhận rồi ghép.
function offerPair() {
  let code = null;
  try { code = sessionStorage.getItem('ct-pair'); } catch (e) { /* bỏ qua */ }
  if (!code) return;
  const forget = () => { try { sessionStorage.removeItem('ct-pair'); } catch (e) { /* bỏ qua */ } };
  sheet(`<h3>📺 Ghép TV của bé?</h3>
    <p class="hint" style="margin-top:0">Mã trên TV: <b style="letter-spacing:3px">${esc(code)}</b>. Sau khi ghép, TV sẽ hiện các video bạn đã chọn.</p>
    <label>Tên TV</label><input id="qr-name" placeholder="Ví dụ: TV phòng khách" value="TV phòng khách">
    <button class="btn primary" data-a="go">Ghép TV này</button>
    <button class="btn link" data-a="no">Để sau</button>`,
  async (a) => {
    if (a === 'no') { forget(); return closeSheet(); }
    try {
      await rpc('ct_pair_tv', { p_code: code, p_name: $('#qr-name').value });
      forget(); closeSheet(); toast('Đã ghép TV! TV sẽ hiện danh sách trong vài giây.');
      await load();
    } catch (e) {
      toast(e.message, true);
      if (/hết hạn|không đúng/i.test(e.message)) { forget(); closeSheet(); }
    }
  });
}
const groupsOf = (kind) => S.groups.filter((g) => g.kind === kind);
const ago = (t) => {
  if (!t) return 'chưa kết nối';
  const m = Math.round((Date.now() - new Date(t)) / 60000);
  return m < 2 ? 'đang bật' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`;
};

// ---------- Bảng trượt ----------
let sheetHandler = null, sheetChange = null;
function sheet(html, onClick) {
  $('#sheet-body').innerHTML = html;
  sheetHandler = onClick || null;
  sheetChange = null;
  $('#sheet').classList.remove('hidden');
}
function closeSheet() { $('#sheet').classList.add('hidden'); sheetHandler = null; sheetChange = null; }
$('#sheet').addEventListener('change', (e) => { if (sheetChange) sheetChange(e); });
$('#sheet-x').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').classList.contains('hidden')) closeSheet(); });
$('#sheet').addEventListener('click', (e) => {
  if (e.target === $('#sheet')) return closeSheet();
  const b = e.target.closest('[data-a]');
  if (b && sheetHandler) sheetHandler(b.dataset.a, b, e);
});

// ---------- Đăng nhập (email + mật khẩu) ----------
let signup = false;  // false = đăng nhập, true = tạo tài khoản mới
const loginMsg = (t, ok) => { $('#login-msg').textContent = t || ''; $('#login-msg').className = 'msg ' + (ok ? 'ok' : 'err'); };
const AUTH_ERR = {
  'Invalid login credentials': 'Sai email hoặc mật khẩu.',
  'User already registered': 'Email này đã có tài khoản, hãy bấm "Đăng nhập".',
  'Password should be at least 6 characters.': 'Mật khẩu phải có ít nhất 6 ký tự.',
  'Unable to validate email address: invalid format': 'Email không hợp lệ.',
  'NEED_SETUP': 'Tài khoản này đã chuyển sang máy chủ mới. Nhập mã thiết lập (8 ký tự) vào ô Mã thiết lập rồi bấm lại — mật khẩu vừa gõ sẽ là mật khẩu mới.',
};
function setMode(isSignup) {
  signup = isSignup;
  $('#login-btn').textContent = signup ? 'Tạo tài khoản' : 'Đăng nhập';
  $('#mode-btn').textContent = signup ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Tạo tài khoản mới';
  $('#password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  loginMsg(signup ? 'Tự đặt một mật khẩu (ít nhất 6 ký tự) và ghi nhớ lại.' : '', true);
}
$('#mode-btn').addEventListener('click', () => setMode(!signup));
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim(), password = $('#password').value, setupCode = $('#setup-code').value.trim();
  $('#login-btn').disabled = true;
  loginMsg(signup ? 'Đang tạo tài khoản…' : 'Đang đăng nhập…', true);
  const { data, error } = signup
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password, setupCode });
  $('#login-btn').disabled = false;
  if (error && error.message === 'NEED_SETUP') { $('#setup-box').classList.remove('hidden'); $('#setup-code').focus(); $('#login-btn').textContent = 'Đặt mật khẩu & đăng nhập'; }
  if (error) return loginMsg(AUTH_ERR[error.message] || error.message);
  if (signup && !data.session) loginMsg('Đã tạo tài khoản nhưng cần xác nhận email. Hãy báo người cài đặt tắt "Confirm email" trên Supabase.');
  else loginMsg('');
});

function showApp(on) {
  $('#login').classList.toggle('hidden', on);
  $('#main').classList.toggle('hidden', !on);
  $('#tabs').classList.toggle('hidden', !on);
  if (!on) { $('#fam-name').textContent = ''; setMode(false); }
}

sb.auth.onAuthStateChange((ev, session) => {
  if (session) {
    showApp(true);
    // Gọi Supabase ngay trong callback này có thể bị treo, nên đẩy ra ngoài.
    // Chờ mọi tệp script (library, family, portal…) chạy xong rồi mới tải: không thì có lúc vẽ màn hình khi tệp sau chưa có.
    const start = () => { if (!S) load().catch((e) => toast(e.message, true)); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0), { once: true });
    else setTimeout(start, 0);
  } else {
    S = null;
    showApp(false);
  }
});

// ---------- Tab ----------
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
  window.scrollTo(0, 0);
});

function render() {
  if (!S) return;
  const v = $('#view');
  if (tab === 'list') v.innerHTML = viewList();
  else if (tab === 'search') v.innerHTML = viewSearch();
  else if (tab === 'review') renderReview();
  else if (tab === 'history') renderHistory();
  else if (tab === 'groups') v.innerHTML = viewGroups();
  else v.innerHTML = viewSettings();
  if (tab === 'list' && pendingLink) { $('#link').value = pendingLink; pendingLink = ''; startAdd(); }
}

// ---------- Tab Danh sách ----------
function viewList() {
  const src = S.sources;
  const noTv = !S.tvs.length ? `<div class="card"><b>Chưa có TV nào.</b><div class="hint" style="margin:4px 0 8px">Mở app ChildTube trên TV, TV sẽ hiện một mã 6 số.</div><button class="btn small" data-a="go-settings">Ghép TV ngay</button></div>` : '';
  const waiting = pendTotal();
  const banner = waiting ? `<div class="card warn"><b>⏳ ${waiting} video đang chờ bạn duyệt</b><div class="hint" style="margin:4px 0 8px;color:inherit">Bé chưa xem được các video này trên TV.</div><button class="btn small" data-a="gorev">Duyệt ngay</button></div>` : '';
  return `${noTv}${banner}
  <form class="add" id="add-form" onsubmit="return false">
    <input id="link" placeholder="Dán link YouTube (kênh, video, playlist)" autocomplete="off" enterkeyhint="go">
    <button class="btn" data-a="add" type="submit">Thêm</button>
  </form>
  <div class="toolbar"><button class="btn small" data-a="paste">📋 Dán từ bộ nhớ</button><button class="btn small" data-a="howto">Cách lấy link?</button></div>
  <h2>Bé được xem (${src.length})</h2>
  <div class="card">${src.length ? src.map((s) => `
    <div class="row tap" data-a="source" data-id="${s.id}">
      ${s.kind === 'video' ? `<img class="th" src="${esc(s.thumb)}" alt="">` : `<img class="av" src="${esc(s.thumb)}" alt="">`}
      <div class="info"><div class="t">${esc(s.title)}</div>
        <div class="m"><span class="badge">${KIND[s.kind]}</span>${s.kind === 'video' ? '' : s.count + ' video'}${s.pending ? ` · <span class="pend">⏳ ${s.pending} chờ duyệt</span>` : (s.kind !== 'video' && s.approval === 'auto' ? ' · ▶ tự động' : '')}${tagLine(s.id)}</div></div>
      <span class="m">›</span>
    </div>`).join('') : `<div class="empty">Chưa có gì.<br>Dán link kênh YouTube đầu tiên ở trên, ví dụ <b>youtube.com/@Cocomelon</b></div>`}
  </div>`;
}
function tagLine(sourceId) {
  const names = S.groups.filter((g) => g.items.some((i) => i.source_id === sourceId)).map((g) => g.emoji + ' ' + g.name);
  return names.length ? ' · ' + esc(names.join(', ')) : '';
}

function linkKind(url) {
  if (/[?&]v=[\w-]{11}|youtu\.be\/|\/shorts\/|\/live\//.test(url)) return /[?&]list=(?!RD)[\w-]+/.test(url) ? 'video+list' : 'video';
  if (/[?&]list=/.test(url)) return 'playlist';
  return 'channel';
}

function startAdd() {
  const url = $('#link').value.trim();
  if (!url) return $('#link').focus();
  const k = linkKind(url);
  if (k === 'video' || k === 'video+list') {
    sheet(`<h3>Thêm gì cho bé?</h3>
      <button class="choice" data-a="video">🎬 Chỉ video này</button>
      <button class="choice" data-a="channel">📺 Cả kênh của video này<small>Video mới của kênh sẽ tự xuất hiện trên TV</small></button>
      ${k === 'video+list' ? '<button class="choice" data-a="playlist">📃 Cả playlist đang phát</button>' : ''}`,
    (a) => { closeSheet(); doAdd(url, a === 'video' ? undefined : a); });
  } else doAdd(url);
}

async function doAdd(url, as) {
  const btn = $('[data-a="add"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try {
    const r = await yt({ action: 'add', url, as });
    $('#link') && ($('#link').value = '');
    await load();
    toast(`Đã thêm ${KIND[r.kind].toLowerCase()} "${r.title}"` + (r.kind === 'video' ? '' : ` (${r.count} video)`));
    openSource(r.id, true);
  } catch (e) { toast(e.message, true); }
  if (btn) { btn.disabled = false; btn.textContent = 'Thêm'; }
}

// Chi tiết một kênh/playlist/video: chế độ duyệt, gắn nhóm, sắp xếp, xoá, từng video.
async function openSource(id, justAdded) {
  const s = S.sources.find((x) => x.id === id);
  if (!s) return;
  const idx = S.sources.indexOf(s);
  const isVideo = s.kind === 'video';
  const manual = !isVideo && s.approval === 'manual';
  const chips = (kind) => groupsOf(kind).map((g) => {
    const on = isVideo ? g.items.some((i) => i.video_id === s.yt_id) : g.items.some((i) => i.source_id === s.id);
    return `<button class="chip ${on ? 'on' : ''}" data-a="tag" data-g="${g.id}">${esc(g.emoji)} ${esc(g.name)}</button>`;
  }).join('') + `<button class="chip add-chip" data-a="newgroup" data-kind="${kind}">+ Tạo mới</button>`;
  const fav = isVideo && S.favorites.some((f) => f.video_id === s.yt_id);
  const modeBox = isVideo ? '' : `
    <label>Cách cho bé xem</label>
    <div class="chips">
      <button class="chip ${manual ? 'on' : ''}" data-a="mode" data-m="manual">✅ Tôi duyệt từng video</button>
      <button class="chip ${manual ? '' : 'on'}" data-a="mode" data-m="auto">▶ Cho xem tất cả</button>
    </div>
    <div class="hint" style="margin:0 0 8px">${manual
      ? 'Video của ' + (s.kind === 'channel' ? 'kênh' : 'playlist') + ' này (kể cả video mới) chỉ lên TV sau khi bạn bấm ✅ <b>Cho xem</b>.'
      : 'Tất cả video, kể cả video mới đăng, hiện trên TV ngay.'}</div>
    ${manual && s.pending ? `<button class="btn small" data-a="okall">✅ Duyệt tất cả (${s.pending} video)</button>` : ''}`;

  sheet(`<div class="head"><img src="${esc(s.thumb)}" alt=""><div><h3>${esc(s.title)}</h3><div class="hint" style="margin:0">${KIND[s.kind]}${isVideo ? '' : ' · ' + s.count + ' video'}</div></div></div>
    ${justAdded ? '<div class="hint">Đã thêm!' + (isVideo ? '' : ' Mặc định bé <b>chỉ xem video bạn duyệt</b>: bấm ✅ ở từng video bên dưới, hoặc <b>Duyệt tất cả</b>.') + '</div>' : ''}
    ${modeBox}
    <label>Bộ sưu tập</label><div class="chips">${chips('collection')}</div>
    <label>Playlist & chủ đề</label><div class="chips">${chips('topic')}</div>
    <div class="toolbar">
      ${isVideo ? `<button class="btn small" data-a="fav">${fav ? '❤️ Bỏ yêu thích' : '🤍 Yêu thích'}</button>` : ''}
      <button class="btn small" data-a="up" ${idx === 0 ? 'disabled' : ''}>↑ Lên</button>
      <button class="btn small" data-a="down" ${idx === S.sources.length - 1 ? 'disabled' : ''}>↓ Xuống</button>
      <button class="btn small danger" data-a="del">Xoá</button>
    </div>
    ${isVideo ? '' : `<h2 style="margin-top:14px">Từng video</h2><div class="hint" style="margin-top:-6px">${manual ? '✅ cho xem · ' : ''}❤ yêu thích · 🏷 thêm vào giáo trình/nhóm · 🚫 ẩn</div><div id="vids"><div class="empty"><span class="spin"></span></div></div>`}`,
  async (a, b) => {
    if (a === 'tag') {
      const g = S.groups.find((x) => x.id === b.dataset.g);
      const on = !b.classList.contains('on');
      await act(() => rpc('ct_group_item', { p_group: g.id, p_source: isVideo ? null : s.id, p_video: isVideo ? s.yt_id : null, p_title: s.title, p_on: on }));
      b.classList.toggle('on', on);
      await load();
    } else if (a === 'newgroup') {
      newGroup(b.dataset.kind, () => openSource(id));
    } else if (a === 'mode') {
      await act(() => rpc('ct_set_approval', { p_source: s.id, p_mode: b.dataset.m }));
      await load(); openSource(id);
    } else if (a === 'okall') {
      const n = await act(() => rpc('ct_approve_source', { p_source: s.id }));
      if (n !== undefined) toast(`Đã duyệt ${n} video. Bé xem được trên TV.`);
      await load(); openSource(id);
    } else if (a === 'fav') {
      await act(() => rpc('ct_favorite', { p_video: s.yt_id, p_title: s.title, p_on: !fav }));
      await load(); openSource(id);
    } else if (a === 'up' || a === 'down') {
      const ids = S.sources.map((x) => x.id);
      const j = idx + (a === 'up' ? -1 : 1);
      [ids[idx], ids[j]] = [ids[j], ids[idx]];
      await act(() => rpc('ct_reorder', { p_what: 'source', p_ids: ids }));
      await load(); openSource(id);
    } else if (a === 'del') {
      if (!confirm(`Xoá "${s.title}" khỏi danh sách của bé?`)) return;
      await act(() => rpc('ct_source_delete', { p_id: s.id }), 'Đã xoá');
      closeSheet(); load();
    } else if (a === 'vfav' || a === 'vhide' || a === 'vtag' || a === 'vok') {
      const row = b.closest('.row');
      const vid = row.dataset.vid, title = row.dataset.title;
      if (a === 'vtag') return videoTags(vid, title, () => openSource(id));
      const on = !b.classList.contains('on');
      await act(() => a === 'vfav' ? rpc('ct_favorite', { p_video: vid, p_title: title, p_on: on })
        : a === 'vok' ? rpc('ct_approve', { p_videos: [vid], p_on: on })
        : rpc('ct_hide', { p_video: vid, p_on: on }));
      b.classList.toggle('on', on);
      if (a === 'vhide') { row.classList.toggle('off', on); if (on) { const ok = row.querySelector('[data-a="vok"]'); if (ok) ok.classList.remove('on'); } }
      if (a === 'vok') { row.classList.remove('off'); row.classList.toggle('waiting', !on); const hb = row.querySelector('[data-a="vhide"]'); if (hb) hb.classList.remove('on'); }
      if (a === 'vfav') b.textContent = on ? '❤️' : '🤍';
      quietLoad();
    }
  });

  if (!isVideo) {
    try {
      const vids = await rpc('ct_source_videos', { p_source: id });
      const box = $('#vids');
      if (!box) return;
      box.innerHTML = vids.length ? vids.map((v) => `
        <div class="row ${v.hidden ? 'off' : ''} ${manual && !v.approved && !v.hidden ? 'waiting' : ''}" data-vid="${v.id}" data-title="${esc(v.title)}">
          <img class="th" src="${thumb(v.id)}" alt="" loading="lazy">
          <div class="info"><div class="t" style="font-size:14px">${esc(v.title)}</div>${manual && !v.approved && !v.hidden ? '<div class="m pend">⏳ Chờ duyệt</div>' : ''}${v.groups.length ? `<div class="m">${esc(S.groups.filter((g) => v.groups.includes(g.id)).map((g) => g.emoji + ' ' + g.name).join(', '))}</div>` : ''}</div>
          <div class="ctl">
            ${manual ? `<button class="icon-btn ${v.approved ? 'on' : ''}" data-a="vok" title="Cho xem">✅</button>` : ''}
            <button class="icon-btn ${v.fav ? 'on' : ''}" data-a="vfav" title="Yêu thích">${v.fav ? '❤️' : '🤍'}</button>
            <button class="icon-btn" data-a="vtag" title="Thêm vào giáo trình">🏷</button>
            <button class="icon-btn ${v.hidden ? 'on' : ''}" data-a="vhide" title="Ẩn">🚫</button>
          </div>
        </div>`).join('') : '<div class="empty">Chưa lấy được video. Thử lại sau ít phút.</div>';
    } catch (e) { toast(e.message, true); }
  }
}

// Gắn một video lẻ (trong kênh) vào bộ sưu tập / chủ đề.
function videoTags(vid, title, back) {
  const chips = (kind) => groupsOf(kind).map((g) => `<button class="chip ${g.items.some((i) => i.video_id === vid) ? 'on' : ''}" data-a="tag" data-g="${g.id}">${esc(g.emoji)} ${esc(g.name)}</button>`).join('')
    + `<button class="chip add-chip" data-a="newgroup" data-kind="${kind}">+ Tạo mới</button>`;
  sheet(`<div class="head"><img src="${thumb(vid)}" alt="" style="width:96px;height:54px"><h3 style="font-size:15px">${esc(title)}</h3></div>
    <label>Bộ sưu tập</label><div class="chips">${chips('collection')}</div>
    <label>Playlist & chủ đề</label><div class="chips">${chips('topic')}</div>
    <button class="btn primary" data-a="done">Xong</button>`,
  async (a, b) => {
    if (a === 'done') return back();
    if (a === 'newgroup') return newGroup(b.dataset.kind, () => videoTags(vid, title, back));
    if (a === 'tag') {
      const on = !b.classList.contains('on');
      await act(() => rpc('ct_group_item', { p_group: b.dataset.g, p_source: null, p_video: vid, p_title: title, p_on: on }));
      b.classList.toggle('on', on);
      await load();
    }
  });
}

// ---------- Tab Giáo trình (bộ sưu tập + chủ đề + yêu thích) ----------
function viewGroups() {
  const card = (g) => {
    const vids = g.items.filter((i) => i.video_id), done = vids.filter((i) => i.done).length;
    const srcN = g.items.length - vids.length;
    return `<div class="row tap" data-a="gedit" data-id="${g.id}">
      <div class="av">${esc(g.emoji || '📁')}</div>
      <div class="info"><div class="t">${esc(g.name)}</div>
        <div class="m">${vids.length} bài${srcN ? ` + ${srcN} kênh/playlist` : ''}${g.numbered && vids.length ? ` · đã học ${done}/${vids.length}` : ''}${g.locked ? ' · 🔒 học theo thứ tự' : ''}</div>
        ${g.numbered && vids.length ? `<div class="bar sm"><i style="width:${Math.round(done / vids.length * 100)}%"></i></div>` : ''}</div>
      <span class="m">›</span></div>`;
  };
  const block = (kind, title, hint) => {
    const list = groupsOf(kind);
    return `<h2>${title}<button class="btn small" data-a="newgroup" data-kind="${kind}">+ Tạo</button></h2>
    <div class="card">${list.length ? list.map(card).join('') : `<div class="empty">${hint}</div>`}</div>`;
  };
  return block('collection', '📚 Giáo trình', 'Chưa có giáo trình. Bấm <b>+ Tạo</b> để chọn mẫu theo tuổi của bé.')
    + block('topic', '🎵 Playlist & chủ đề', `Danh sách phát bố mẹ tự tạo, ví dụ: Nhạc trước giờ ngủ, Tiếng Anh, Khủng long. Mỗi playlist là một mục trên TV.<br><button class="btn small" data-a="suggest" style="margin-top:10px">Tạo nhanh vài playlist gợi ý</button>`)
    + viewFavs();
}

// Trình soạn giáo trình: thứ tự bài, đánh số, khoá theo thứ tự, thêm bài bằng link hoặc chọn từ danh sách.
function openGroupEditor(gid, keepScroll) {
  const g = S.groups.find((x) => x.id === gid);
  if (!g) return closeSheet();
  const box = $('.sheet-box');
  const y = keepScroll && box ? box.scrollTop : 0;
  const vids = g.items.filter((i) => i.video_id), done = vids.filter((i) => i.done).length;
  let n = 0;
  const row = (it, k) => {
    const src = it.source_id && S.sources.find((x) => x.id === it.source_id);
    const lead = src ? `<img class="av" src="${esc(src.thumb)}" alt="">` : `<img class="th" src="${thumb(it.video_id)}" alt="" loading="lazy">`;
    const num = !src && g.numbered ? `<span class="lesson-n">Bài ${++n}</span>` : '';
    return `<div class="row lesson ${it.done ? 'done' : ''}">
      ${lead}
      <div class="info">${num}<div class="t" style="font-size:14px">${esc(src ? src.title : it.title)}</div>
        <div class="m">${src ? `${KIND[src.kind]} · cả ${src.kind === 'channel' ? 'kênh' : 'playlist'} (${src.count} video)` : (it.done ? '✓ Đã học' : 'Chưa học')}</div></div>
      <div class="ctl">
        ${src ? '<span></span>' : `<button class="icon-btn ${it.done ? 'on' : ''}" data-a="gdone" data-k="${k}" title="Đánh dấu đã học">✓</button>`}
        <button class="icon-btn" data-a="gmv" data-d="-1" data-k="${k}" title="Lên" ${k === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-a="grm" data-k="${k}" title="Bỏ khỏi nhóm">✕</button>
        <button class="icon-btn" data-a="gmv" data-d="1" data-k="${k}" title="Xuống" ${k === g.items.length - 1 ? 'disabled' : ''}>↓</button>
      </div></div>`;
  };
  sheet(`<div class="head"><div class="av" style="width:54px;height:54px;font-size:28px">${esc(g.emoji || '📁')}</div>
      <div><h3>${esc(g.name)}</h3><div class="hint" style="margin:0">${g.kind === 'collection' ? 'Bộ sưu tập' : 'Chủ đề'} · ${vids.length} bài${vids.length ? ` · đã học ${done}/${vids.length}` : ''}</div></div></div>
    ${vids.length ? `<div class="bar"><i style="width:${Math.round(done / vids.length * 100)}%"></i></div>` : ''}
    <label>Mục tiêu / ghi chú</label>
    <input id="g-note" value="${esc(g.note)}" placeholder="Ví dụ: Học bảng chữ cái trong 2 tuần" maxlength="200">
    <label class="switch"><input type="checkbox" data-a="gnum" ${g.numbered ? 'checked' : ''}> Đánh số bài (Bài 1, Bài 2…) và chiếu theo thứ tự</label>
    <label class="switch" ${g.numbered ? '' : 'style="opacity:.45"'}><input type="checkbox" data-a="glock" ${g.locked ? 'checked' : ''} ${g.numbered ? '' : 'disabled'}> Khoá bài sau cho tới khi bé xem xong bài trước</label>
    <h2 style="margin-top:14px">Các bài (${g.items.length})</h2>
    <div>${g.items.length ? g.items.map(row).join('') : '<div class="empty">Chưa có bài nào. Thêm bên dưới.</div>'}</div>
    <h2 style="margin-top:14px">Thêm bài</h2>
    <div class="add"><input id="g-link" placeholder="Dán link video YouTube" autocomplete="off"><button class="btn" data-a="gadd">Thêm</button></div>
    <div class="toolbar"><button class="btn small" data-a="gsearch">🔎 Tìm trên YouTube để thêm</button><button class="btn small" data-a="gpick">📂 Chọn từ danh sách đã có</button></div>
    <div class="toolbar" style="margin-top:14px">
      <button class="btn small" data-a="gren">✎ Tên & biểu tượng</button>
      <button class="btn small" data-a="gup">↑ Nhóm lên</button>
      <button class="btn small" data-a="gdown">↓ Nhóm xuống</button>
      <button class="btn small danger" data-a="gdel">Xoá nhóm</button>
    </div>
    <button class="btn primary" data-a="gclose">Xong</button>`,
  async (a, b) => {
    const reopen = async () => { await load(); openGroupEditor(gid, true); };
    const it = b.dataset.k !== undefined ? g.items[+b.dataset.k] : null;
    if (a === 'gclose') return closeSheet();
    if (a === 'gnum') { await act(() => rpc('ct_group_update', { p_id: gid, p: b.checked ? { numbered: true } : { numbered: false, locked: false } })); return reopen(); }
    if (a === 'glock') { await act(() => rpc('ct_group_update', { p_id: gid, p: { locked: b.checked } })); return reopen(); }
    if (a === 'gdone') { await act(() => rpc('ct_mark_done', { p_video: it.video_id, p_on: !it.done })); return reopen(); }
    if (a === 'gmv') {
      const ids = g.items.map((x) => x.id), k = +b.dataset.k, j = k + +b.dataset.d;
      [ids[k], ids[j]] = [ids[j], ids[k]];
      await act(() => rpc('ct_group_reorder', { p_group: gid, p_items: ids }));
      return reopen();
    }
    if (a === 'grm') {
      await act(() => rpc('ct_group_item', { p_group: gid, p_source: it.source_id, p_video: it.video_id, p_title: '', p_on: false }));
      return reopen();
    }
    if (a === 'gadd') return addLinkToGroup(gid, $('#g-link').value);
    if (a === 'gpick') return openPicker(gid);
    if (a === 'gsearch') return groupSearch(gid);
    if (a === 'gren') return newGroup(g.kind, () => openGroupEditor(gid), g);
    if (a === 'gup' || a === 'gdown') {
      const ids = groupsOf(g.kind).map((x) => x.id), i = ids.indexOf(gid), j = i + (a === 'gup' ? -1 : 1);
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await act(() => rpc('ct_reorder', { p_what: 'group', p_ids: ids }), 'Đã đổi thứ tự hiển thị trên TV');
      return reopen();
    }
    if (a === 'gdel') {
      if (!confirm(`Xoá "${g.name}"? (Kênh và video vẫn còn trong danh sách.)`)) return;
      await act(() => rpc('ct_group_delete', { p_id: gid }), 'Đã xoá');
      closeSheet(); return load();
    }
  });
  sheetChange = async (e) => {
    if (e.target.id !== 'g-note') return;
    await act(() => rpc('ct_group_update', { p_id: gid, p: { note: e.target.value } }), 'Đã lưu ghi chú');
    quietLoad();
  };
  if (box) box.scrollTop = y;
}

// Dán link YouTube vào giáo trình: video → thêm thành một bài; kênh/playlist → thêm cả kênh/playlist.
async function addLinkToGroup(gid, text) {
  const url = (text || '').trim();
  if (!url) return toast('Hãy dán link video YouTube.', true);
  const k = linkKind(url);
  const vid = (url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/) || [])[1];
  const btn = $('[data-a="gadd"]'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try {
    if ((k === 'video' || k === 'video+list') && vid) {
      const exist = S.sources.find((x) => x.kind === 'video' && x.yt_id === vid);
      if (exist) {
        await rpc('ct_group_item', { p_group: gid, p_source: null, p_video: vid, p_title: exist.title, p_on: true });
      } else {
        const r = await yt({ action: 'add', url });
        await rpc('ct_group_item', { p_group: gid, p_source: null, p_video: vid, p_title: r.title, p_on: true });
        await rpc('ct_source_delete', { p_id: r.id });   // bài nằm trong giáo trình, không cần hiện thêm ở "Video lẻ"
      }
    } else {
      const r = await yt({ action: 'add', url });
      await rpc('ct_group_item', { p_group: gid, p_source: r.id, p_video: null, p_title: r.title, p_on: true });
    }
    toast('Đã thêm vào giáo trình');
  } catch (e) { toast(e.message, true); if (btn) { btn.disabled = false; btn.textContent = 'Thêm'; } return; }
  await load();
  openGroupEditor(gid, true);
}

// Chọn bài từ các kênh/video đã có trong danh sách của bé.
function openPicker(gid) {
  const g = S.groups.find((x) => x.id === gid);
  const inV = new Set(g.items.filter((i) => i.video_id).map((i) => i.video_id));
  const inS = new Set(g.items.filter((i) => i.source_id).map((i) => i.source_id));
  const rows = S.sources.map((s) => {
    const isV = s.kind === 'video', added = isV ? inV.has(s.yt_id) : inS.has(s.id);
    return `<div class="row"><img class="${isV ? 'th' : 'av'}" src="${esc(s.thumb)}" alt="">
      <div class="info"><div class="t" style="font-size:14px">${esc(s.title)}</div><div class="m"><span class="badge">${KIND[s.kind]}</span>${isV ? '' : s.count + ' video'}</div></div>
      ${isV ? `<button class="btn small" data-a="padd" data-id="${s.id}" ${added ? 'disabled' : ''}>${added ? '✓ Đã có' : '➕ Thêm'}</button>`
            : `<button class="btn small" data-a="ppick" data-id="${s.id}">Chọn video…</button>`}</div>`;
  }).join('');
  sheet(`<h3>Chọn bài từ danh sách đã có</h3>
    <div class="hint" style="margin-top:0">Chọn video từ các kênh/playlist bạn đã thêm. Video được chọn vào giáo trình sẽ tự được duyệt cho bé xem.</div>
    ${rows || '<div class="empty">Chưa có kênh hay video nào. Hãy thêm ở tab <b>Danh sách</b>.</div>'}
    <button class="btn primary" data-a="pback">Quay lại giáo trình</button>`,
  async (a, b) => {
    if (a === 'pback') return openGroupEditor(gid, true);
    const s = S.sources.find((x) => x.id === b.dataset.id);
    if (a === 'padd') { await act(() => rpc('ct_group_item', { p_group: gid, p_source: null, p_video: s.yt_id, p_title: s.title, p_on: true })); await load(); return openPicker(gid); }
    if (a === 'ppick') return pickVideos(gid, s.id);
  });
}

async function pickVideos(gid, sid) {
  const s = S.sources.find((x) => x.id === sid), g = S.groups.find((x) => x.id === gid);
  sheet(`<h3>${esc(s.title)}</h3><div class="empty"><span class="spin"></span></div>`);
  let vids;
  try { vids = await rpc('ct_source_videos', { p_source: sid }); } catch (e) { toast(e.message, true); return openPicker(gid); }
  const inV = new Set(g.items.filter((i) => i.video_id).map((i) => i.video_id));
  const list = vids.filter((v) => !v.hidden);
  sheet(`<h3>${esc(s.title)}</h3>
    <div class="hint" style="margin-top:0">Tick các video muốn đưa vào giáo trình "${esc(g.name)}" theo thứ tự hiện ở đây.</div>
    <div class="toolbar"><button class="btn small" data-a="pall">Chọn tất cả</button><button class="btn small" data-a="pnone">Bỏ chọn</button></div>
    <div id="pv">${list.map((v) => `<label class="row pick"><input type="checkbox" data-vid="${v.id}" data-title="${esc(v.title)}" ${inV.has(v.id) ? 'checked disabled' : ''}>
      <img class="th" src="${thumb(v.id)}" alt="" loading="lazy"><div class="info"><div class="t" style="font-size:14px">${esc(v.title)}</div>${inV.has(v.id) ? '<div class="m">✓ Đã có trong giáo trình</div>' : ''}</div></label>`).join('') || '<div class="empty">Kênh này chưa có video.</div>'}</div>
    <button class="btn primary" data-a="pgo">Thêm vào giáo trình</button>
    <button class="btn link" data-a="pback">Quay lại</button>`,
  async (a) => {
    const boxes = () => [...document.querySelectorAll('#pv input[type=checkbox]:not(:disabled)')];
    if (a === 'pall') return boxes().forEach((x) => { x.checked = true; });
    if (a === 'pnone') return boxes().forEach((x) => { x.checked = false; });
    if (a === 'pback') return openPicker(gid);
    if (a === 'pgo') {
      const picked = boxes().filter((x) => x.checked).map((x) => ({ id: x.dataset.vid, title: x.dataset.title }));
      if (!picked.length) return toast('Hãy tick ít nhất một video.', true);
      const n = await act(() => rpc('ct_group_add_videos', { p_group: gid, p_videos: picked }));
      if (n === undefined) return;
      toast(`Đã thêm ${n} bài vào giáo trình`);
      await load(); openGroupEditor(gid, true);
    }
  });
}

// ---------- Tab Tìm (tìm trực tiếp trên YouTube) ----------
const srchCache = new Map();
let srchSeq = 0;
let srchTargets = [];
try { srchTargets = JSON.parse(localStorage.getItem('ct_targets') || '[]'); } catch (e) { srchTargets = []; }
const saveTargets = () => { try { localStorage.setItem('ct_targets', JSON.stringify(srchTargets)); } catch (e) { /* bỏ qua */ } };
const targetGroups = () => { srchTargets = srchTargets.filter((id) => S.groups.some((g) => g.id === id)); return srchTargets.map((id) => S.groups.find((g) => g.id === id)); };
let srch = { q: '', type: 'video', lang: 'vi', results: null, busy: false, err: '', target: null };

function viewSearch() {
  const chips = (list, cur, a) => list.map(([v, label]) => `<button class="chip ${cur === v ? 'on' : ''}" data-a="${a}" data-v="${v}">${label}</button>`).join('');
  const ideas = ['bảng chữ cái tiếng Việt', 'học đếm số cho bé', 'bài hát thiếu nhi', 'truyện cổ tích cho bé', 'khoa học cho bé', 'Super Simple Songs'];
  const tg = targetGroups();
  const order = [...groupsOf('topic'), ...groupsOf('collection')];
  const bar = `<div class="card tbar"><div class="m">Thêm nhanh vào (chọn một hoặc nhiều):</div><div class="chips">${order.map((g) => {
    const on = srchTargets.includes(g.id);
    return `<button class="chip ${on ? 'on' : ''}" data-a="stg" data-g="${g.id}">${on ? '✓ ' : ''}${esc(g.emoji)} ${esc(g.name)}</button>`;
  }).join('')}<button class="chip add-chip" data-a="stg-new">+ Playlist mới</button></div></div>`;
  return `${bar}
    <form class="add" id="search-form" onsubmit="return false">
      <input id="sq" value="${esc(srch.q)}" placeholder="Tìm trên YouTube…" enterkeyhint="search" autocomplete="off">
      <button class="btn" data-a="sgo" type="button">Tìm</button>
    </form>
    <div class="chips" style="margin-top:8px">${chips([['video', '🎬 Video'], ['channel', '📺 Kênh'], ['playlist', '📃 Playlist']], srch.type, 'stype')}</div>
    <div class="chips">${chips([['vi', '🇻🇳 Tiếng Việt'], ['en', '🇬🇧 English']], srch.lang, 'slang')}</div>
    ${srch.busy ? '<div class="empty"><span class="spin"></span><br>Đang tìm…</div>'
      : srch.err ? `<div class="empty">${esc(srch.err)}</div>`
      : srch.results === null ? `<div class="hint" style="margin-top:12px">Gợi ý tìm: ${ideas.map((i) => `<button class="chip" data-a="sidea" data-q="${esc(i)}">${esc(i)}</button>`).join('')}</div>`
      : srch.results.length ? '<div class="card">' + srch.results.map(searchRow).join('') + '</div>' : '<div class="empty">Không có kết quả. Thử từ khoá khác.</div>'}`;
}

function searchRow(r, i) {
  const tg = targetGroups();
  const allIn = tg.length && tg.every((g) => g.items.some((x) => x.video_id === r.id));
  const addLabel = tg.length === 1 ? `➕ Thêm vào «${esc(tg[0].name)}»` : `➕ Thêm vào ${tg.length} playlist`;
  if (r.type === 'video') {
    const bad = r.embed === false;
    return `<div class="row" data-i="${i}">
      <div class="info" style="width:100%">${previewBox(r.id)}<div class="t" style="font-size:14px">${esc(r.title)}</div>
        <div class="m">${esc(r.channel)} · ${esc(r.durationText)}${r.viewsText ? ' · ' + esc(r.viewsText) : ''}${r.published ? ' · ' + esc(r.published) : ''}</div>
        ${bad ? '<div class="m pend">⚠ Không phát được trên TV</div>' : ''}
        <div class="toolbar" style="margin:6px 0 0">
          ${bad ? '' : !tg.length ? '<button class="btn small" data-a="spick">➕ Thêm vào playlist…</button>'
            : `${allIn ? '<button class="btn small" disabled>✓ Đã thêm</button>' : `<button class="btn small primary-s" data-a="sadd">${addLabel}</button>`}<button class="btn small" data-a="spick">Chọn khác…</button>`}
          ${r.channelId ? '<button class="btn small" data-a="sch">📺 Thêm kênh</button>' : ''}
        </div></div></div>`;
  }
  if (r.type === 'channel') {
    return `<div class="row" data-i="${i}"><img class="av" src="${esc(r.thumb)}" alt="">
      <div class="info"><div class="t">${esc(r.title)}</div><div class="m">${esc(r.subs)}</div><div class="m">${esc(r.desc)}</div>
        <div class="toolbar" style="margin:6px 0 0"><button class="btn small" data-a="sch">➕ Thêm kênh</button><a class="btn small" href="https://www.youtube.com/channel/${esc(r.channelId)}" target="_blank" rel="noopener">▶ Xem</a></div></div></div>`;
  }
  return `<div class="row" data-i="${i}"><img class="th" src="${esc(r.thumb)}" alt="">
    <div class="info"><div class="t" style="font-size:14px">${esc(r.title)}</div><div class="m">Playlist${r.count ? ' · ' + r.count + ' video' : ''}${r.channel ? ' · ' + esc(r.channel) : ''}</div>
      <div class="toolbar" style="margin:6px 0 0"><button class="btn small" data-a="spl">➕ Thêm playlist</button><a class="btn small" href="https://www.youtube.com/playlist?list=${esc(r.id)}" target="_blank" rel="noopener">▶ Xem</a></div></div></div>`;
}

async function doSearch() {
  const q = ($('#sq') ? $('#sq').value : srch.q).trim();
  if (q.length < 2) return toast('Hãy gõ ít nhất 2 ký tự.', true);
  srch.q = q; srch.err = '';
  const key = [q.toLowerCase(), srch.type, srch.lang].join('|');
  if (srchCache.has(key)) { srch.results = srchCache.get(key); srch.busy = false; $('#view').innerHTML = viewSearch(); return; }
  srch.busy = true; srch.results = null;
  const mine = ++srchSeq;
  $('#view').innerHTML = viewSearch();
  try {
    const { data, error } = await sb.functions.invoke('ct-search', { body: { q, type: srch.type, lang: srch.lang } });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (e) { /* giữ thông báo gốc */ } throw new Error(m); }
    if (mine !== srchSeq) return;
    srch.results = data.results || [];
    srchCache.set(key, srch.results);
  } catch (e) { if (mine !== srchSeq) return; srch.err = e.message; srch.results = []; }
  srch.busy = false;
  if (tab === 'search') $('#view').innerHTML = viewSearch();
}

function wzToggleTarget(id) { const i = srchTargets.indexOf(id); if (i >= 0) srchTargets.splice(i, 1); else srchTargets.push(id); saveTargets(); }
// Vẽ lại tab Tìm, giữ nguyên vị trí cuộn.
function repaintSearch() { if (tab !== 'search') return; const y = window.scrollY; $('#view').innerHTML = viewSearch(); window.scrollTo(0, y); }

// ---------- Tìm YouTube ngay trong một nhóm: xem thử tại chỗ + thêm vào nhóm ----------
// Ô xem thử: bấm ảnh để phát ngay trong danh sách (chỉ một video phát cùng lúc).
const previewBox = (id) => `<div class="pv-box" data-pv="${id}"><img src="${thumb(id)}" alt="" loading="lazy" decoding="async"><span class="pv-play">▶</span></div>`;
function playPreview(box) {
  document.querySelectorAll('.pv-box.on').forEach((x) => { if (x !== box) { x.classList.remove('on'); x.innerHTML = `<img src="${thumb(x.dataset.pv)}" alt=""><span class="pv-play">▶</span>`; } });
  if (box.classList.contains('on')) return;
  box.classList.add('on');
  box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${box.dataset.pv}?autoplay=1&rel=0&modestbranding=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
}
let gsr = { gid: null, q: '', results: null, busy: false, err: '' };
async function groupSearch(gid, q) {
  const g = S.groups.find((x) => x.id === gid);
  if (!g) return closeSheet();
  if (gsr.gid !== gid) gsr = { gid, q: '', results: null, busy: false, err: '' };
  const paint = () => {
    const gg = S.groups.find((x) => x.id === gid) || g;
    const has = (id) => gg.items.some((x) => x.video_id === id);
    const body = gsr.busy ? '<div class="empty"><span class="spin"></span><br>Đang tìm…</div>'
      : gsr.err ? `<div class="empty">${esc(gsr.err)}</div>`
      : gsr.results === null ? '<div class="hint">Gõ từ khoá rồi bấm Tìm. Bấm vào ảnh để xem thử ngay tại đây.</div>'
      : !gsr.results.length ? '<div class="empty">Không có kết quả. Thử từ khoá khác.</div>'
      : gsr.results.map((r, i) => `<div class="gs-item" data-i="${i}">${previewBox(r.id)}
          <div class="gs-t">${esc(r.title)}</div>
          <div class="m">${esc(r.channel)}${r.durationText ? ' · ' + esc(r.durationText) : ''}${r.viewsText ? ' · ' + esc(r.viewsText) : ''}</div>
          ${r.embed === false ? '<div class="m pend">⚠ Video này không phát được trên TV</div>'
            : has(r.id) ? '<button class="btn small" disabled>✓ Đã có trong nhóm</button>'
            : `<button class="btn small primary-s" data-a="gs-add">➕ Thêm vào «${esc(gg.name)}»</button>`}
        </div>`).join('');
    sheet(`<h3>Tìm video cho «${esc(gg.emoji + ' ' + gg.name)}»</h3>
      <form class="add" onsubmit="return false"><input id="gs-q" value="${esc(gsr.q)}" placeholder="Tìm trên YouTube…" enterkeyhint="search" autocomplete="off"><button class="btn" data-a="gs-go" type="button">Tìm</button></form>
      <div class="gs-list">${body}</div>
      <button class="btn link" data-a="gs-back">← Quay lại nhóm (${gg.items.length} bài)</button>`,
    async (a, b) => {
      if (a === 'gs-back') return openGroupEditor(gid);
      if (a === 'gs-go') return groupSearch(gid, $('#gs-q').value);
      if (a === 'gs-add') {
        const r = gsr.results[+b.closest('[data-i]').dataset.i];
        b.disabled = true; b.innerHTML = '<span class="spin"></span>';
        try {
          await rpc('ct_group_item', { p_group: gid, p_source: null, p_video: r.id, p_title: r.title, p_on: true });
          toast(`Đã thêm vào «${gg.name}»`); b.textContent = '✓ Đã có trong nhóm'; await quietLoad();
        } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = `➕ Thêm vào «${gg.name}»`; }
      }
    });
    const box = $('.sheet-box');
    $('.gs-list') && $('.gs-list').addEventListener('click', (e) => { const pv = e.target.closest('.pv-box'); if (pv) playPreview(pv); });
    const inp = $('#gs-q'); if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); groupSearch(gid, inp.value); } });
    return box;
  };
  q = (q || '').trim();
  if (!q) { paint(); setTimeout(() => $('#gs-q') && $('#gs-q').focus(), 50); return; }
  gsr.q = q; gsr.busy = true; gsr.err = ''; paint();
  try {
    const { data, error } = await sb.functions.invoke('ct-search', { body: { q, type: 'video', lang: /[a-z]/i.test(q) && !/[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/i.test(q) ? 'en' : 'vi' } });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (e) { /* giữ */ } throw new Error(m); }
    gsr.results = (data.results || []).filter((r) => r.type === 'video' || !r.type);
  } catch (e) { gsr.err = e.message; gsr.results = []; }
  gsr.busy = false;
  if (!$('#sheet').classList.contains('hidden') && $('#gs-q')) paint();
}

// Chọn giáo trình để thêm một video vào (có thể tạo giáo trình mới ngay tại đây).
function chooseGroup(v, back) {
  const rows = (kind) => groupsOf(kind).map((g) => {
    const has = g.items.some((i) => i.video_id === v.id);
    return `<button class="choice" data-a="gp" data-g="${g.id}" ${has ? 'disabled' : ''}>${esc(g.emoji)} ${esc(g.name)}<small>${g.items.length} mục${has ? ' · ✓ đã có trong nhóm này' : ''}</small></button>`;
  }).join('');
  sheet(`<h3>Thêm vào playlist / giáo trình nào?</h3>
    <div class="head"><img src="${thumb(v.id)}" alt="" style="width:96px;height:54px;border-radius:8px"><div class="t" style="font-size:14px">${esc(v.title)}</div></div>
    ${groupsOf('topic').length ? '<label>Playlist & chủ đề</label>' : ''}${rows('topic')}
    ${groupsOf('collection').length ? '<label>Giáo trình</label>' : ''}${rows('collection')}
    <button class="choice" data-a="gnew">➕ Tạo playlist mới…</button>
    <button class="btn link" data-a="gx">Đóng</button>`,
  async (a, b) => {
    if (a === 'gx') return closeSheet();
    if (a === 'gnew') return newGroup('topic', async (gid) => {
      await act(() => rpc('ct_group_item', { p_group: gid, p_source: null, p_video: v.id, p_title: v.title, p_on: true }), 'Đã thêm vào playlist mới');
      await quietLoad(); (back || closeSheet)();
    });
    if (a === 'gp') {
      const ok = await act(() => rpc('ct_group_item', { p_group: b.dataset.g, p_source: null, p_video: v.id, p_title: v.title, p_on: true }));
      if (ok === undefined) { const g = S.groups.find((x) => x.id === b.dataset.g); toast(`Đã thêm vào «${g.name}»`); }
      await quietLoad(); chooseGroup(v, back);
    }
  });
}

// ---------- Thư viện giáo trình mẫu ----------
let tplData = null, tplAge = 'all';
const AGE_BANDS = [['all', 'Tất cả'], ['1', '1–2 tuổi'], ['3', '3–4 tuổi'], ['5', '5–6 tuổi'], ['7', '7–8 tuổi']];
async function loadTemplates() {
  if (tplData) return tplData;
  const r = await fetch('templates.json?v=' + (window.CT_TPL_V || ''), { cache: 'no-cache' });
  if (!r.ok) throw new Error('Không tải được thư viện mẫu.');
  tplData = await r.json();
  return tplData;
}
const tplMinutes = (t) => Math.max(1, Math.round(t.lessons.reduce((n, l) => n + (l.seconds || 0), 0) / 60));
const ageText = (a) => `${String(a[0]).replace('.5', ',5')}–${a[1]} tuổi`;
const overlaps = (t, band) => band === 'all' || (t.age[0] <= +band + 1.99 && t.age[1] >= +band);

async function openCreate() {
  sheet('<h3>Tạo giáo trình</h3><div class="empty"><span class="spin"></span></div>');
  let d;
  try { d = await loadTemplates(); } catch (e) { toast(e.message, true); return closeSheet(); }
  const list = d.templates.filter((t) => overlaps(t, tplAge)).sort((a, b) => a.age[0] - b.age[0] || a.name.localeCompare(b.name, 'vi'));
  sheet(`<h3>Tạo giáo trình</h3>
    <button class="choice wiz-cta" data-a="cwiz">🧭 Lập giáo trình theo mong muốn của bố mẹ<small>Trả lời vài câu hỏi về bé và định hướng, app dựng khung rồi tìm video phù hợp</small></button>
    <button class="choice" data-a="cblank">✏️ Tự tạo từ đầu<small>Đặt tên rồi thêm video bạn chọn</small></button>
    <label>Hoặc chọn mẫu có sẵn theo tuổi</label>
    <div class="chips">${AGE_BANDS.map(([v, l]) => `<button class="chip ${tplAge === v ? 'on' : ''}" data-a="tage" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="tpl-grid">${list.map((t) => `<button class="tpl-card" data-a="tpl" data-id="${t.id}"><span class="e">${esc(t.emoji)}</span><b>${esc(t.name)}</b><small>${ageText(t.age)} · ${t.lessons.length} bài</small></button>`).join('') || '<div class="empty">Chưa có mẫu cho tuổi này.</div>'}</div>`,
  async (a, b) => {
    if (a === 'cwiz') return wzOpen();
    if (a === 'cblank') return newGroup('collection');
    if (a === 'tage') { tplAge = b.dataset.v; return openCreate(); }
    if (a === 'tpl') return openTemplate(b.dataset.id);
  });
}

async function openTemplate(id) {
  const d = await loadTemplates(), t = d.templates.find((x) => x.id === id);
  if (!t) return openCreate();
  const mins = tplMinutes(t);
  sheet(`<div class="head"><div class="av" style="width:54px;height:54px;font-size:28px">${esc(t.emoji)}</div><div><h3>${esc(t.name)}</h3>
      <div class="hint" style="margin:0">${ageText(t.age)} · ${t.lessons.length} bài · ~${mins} phút · xem ≤ ${t.dailyMinutes} phút/ngày</div></div></div>
    <p class="hint" style="margin:0 0 4px">${esc(t.blurb)}${t.note ? ' ' + esc(t.note) : ''}</p>
    <button class="btn primary" data-a="tuse">✅ Dùng mẫu này</button>
    <button class="btn link" data-a="tinto">Hoặc thêm vào giáo trình có sẵn…</button>
    ${t.lessons.map((l, i) => `<div class="row" data-k="${i}">
      <a href="https://www.youtube.com/watch?v=${l.id}" target="_blank" rel="noopener"><img class="th" src="${thumb(l.id)}" alt="" loading="lazy"></a>
      <div class="info"><span class="lesson-n">Bài ${i + 1}</span><div class="t" style="font-size:14px">${esc(l.title)}</div><div class="m">${esc(l.channel)} · ${clock(l.seconds)}</div></div>
      <button class="icon-btn" data-a="tl-add" title="Thêm riêng bài này">➕</button></div>`).join('')}
    <button class="btn link" data-a="tback">← Chọn mẫu khác</button>`,
  async (a, b) => {
    if (a === 'tback') return openCreate();
    if (a === 'tl-add') { const l = t.lessons[+b.closest('.row').dataset.k]; return chooseGroup({ id: l.id, title: l.title }, () => openTemplate(id)); }
    if (a === 'tuse') return useTemplate(t);
    if (a === 'tinto') {
      const rows = S.groups.map((g) => `<button class="choice" data-a="tg" data-g="${g.id}">${esc(g.emoji)} ${esc(g.name)}<small>${g.items.length} mục</small></button>`).join('');
      return sheet(`<h3>Thêm ${t.lessons.length} bài vào…</h3>${rows || '<div class="empty">Chưa có giáo trình nào. Hãy bấm "Dùng mẫu này".</div>'}<button class="btn link" data-a="tx">← Quay lại</button>`,
        async (a2, b2) => {
          if (a2 === 'tx') return openTemplate(id);
          const n = await act(() => rpc('ct_group_add_videos', { p_group: b2.dataset.g, p_videos: t.lessons.map((l) => ({ id: l.id, title: l.title })) }));
          if (n === undefined) return;
          toast(`Đã thêm ${n} bài mới`);
          await load(); openGroupEditor(b2.dataset.g);
        });
    }
  });
}

// Tạo bộ sưu tập mới từ mẫu: đánh số bài, đặt mục tiêu, thêm toàn bộ bài (các bài được duyệt sẵn).
async function useTemplate(t) {
  const note = (`Mục tiêu: ${t.goals.join('; ')}. Gợi ý xem ≤ ${t.dailyMinutes} phút/ngày.`).slice(0, 480);
  try {
    const gid = await rpc('ct_group_save', { p_id: null, p_kind: 'collection', p_name: t.name, p_emoji: t.emoji });
    await rpc('ct_group_update', { p_id: gid, p: { numbered: true, note } });
    await rpc('ct_group_add_videos', { p_group: gid, p_videos: t.lessons.map((l) => ({ id: l.id, title: l.title })) });
    toast(`Đã tạo giáo trình «${t.name}» với ${t.lessons.length} bài`);
    await load();
    openGroupEditor(gid);
  } catch (e) { toast(e.message, true); }
}

// ---------- Tab Duyệt ----------
let pend = [];
async function renderReview() {
  const box = $('#view');
  box.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try { pend = await rpc('ct_pending'); } catch (e) { return toast(e.message, true); }
  if (tab === 'review') box.innerHTML = viewReview();
}
function viewReview() {
  if (!pend.length) {
    return `<h2>✅ Duyệt video</h2><div class="card"><div class="empty">Không có video nào đang chờ duyệt. 🎉<br>Khi kênh có video mới, chúng hiện ở đây trước khi lên TV.</div></div>
    <p class="hint">Kênh nào để chế độ <b>Cho xem tất cả</b> thì không cần duyệt. Đổi chế độ ở trang chi tiết của kênh (tab Danh sách).</p>`;
  }
  const order = [], by = {};
  for (const v of pend) { if (!by[v.source_id]) { by[v.source_id] = { sid: v.source_id, source: v.source, items: [] }; order.push(by[v.source_id]); } by[v.source_id].items.push(v); }
  return `<h2>✅ Chờ duyệt (${pend.length})<button class="btn small" data-a="rv-all">Duyệt tất cả</button></h2>
    <p class="hint" style="margin-top:-4px">Bé chỉ xem được video sau khi bạn bấm ✅. Bấm vào ảnh để xem thử trên YouTube.</p>`
    + order.map((g) => `<div class="card">
      <div class="row" style="padding-top:0"><div class="info"><div class="t">${esc(g.source)}</div><div class="m">${g.items.length} video chờ duyệt</div></div>
        <button class="btn small" data-a="rv-src" data-id="${g.sid}">✅ Duyệt cả kênh</button></div>
      ${g.items.map((v) => `<div class="row" data-vid="${v.id}" data-title="${esc(v.title)}">
        <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener"><img class="th" src="${thumb(v.id)}" alt="" loading="lazy"></a>
        <div class="info"><div class="t" style="font-size:14px">${esc(v.title)}</div></div>
        <div class="ctl"><button class="icon-btn" data-a="rv-ok" title="Cho xem">✅</button><button class="icon-btn" data-a="rv-tag" title="Thêm vào giáo trình">🏷</button><button class="icon-btn" data-a="rv-no" title="Không cho xem">🚫</button></div></div>`).join('')}
    </div>`).join('');
}

// ---------- Tab Lịch sử ----------
let hist = { items: [], today: 0, week: 0 };
async function renderHistory() {
  const box = $('#view');
  box.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try { hist = await rpc('ct_history', { p_days: 30 }); } catch (e) { return toast(e.message, true); }
  if (tab === 'history') box.innerHTML = viewHistory();
}
const fmtDur = (sec) => {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h ? `${h} giờ ${m} phút` : m ? `${m} phút` : `${sec} giây`;
};
const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function dayLabel(d) {
  const same = (a, b) => a.toDateString() === b.toDateString();
  return same(d, new Date()) ? 'Hôm nay' : same(d, new Date(Date.now() - 864e5)) ? 'Hôm qua'
    : d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });
}
function viewHistory() {
  const head = `<h2>🕘 Bé đã xem</h2>
    <div class="stats"><div><b>${fmtDur(hist.today)}</b><span>Hôm nay</span></div><div><b>${fmtDur(hist.week)}</b><span>7 ngày qua</span></div></div>`;
  if (!hist.items.length) return head + '<div class="card"><div class="empty">Chưa có lịch sử.<br>Khi bé xem video trên TV, danh sách hiện ở đây.</div></div>';
  const days = []; let cur = null;
  for (const it of hist.items) {
    const d = new Date(it.started_at), key = d.toDateString();
    if (!cur || cur.key !== key) { cur = { key, label: dayLabel(d), list: [], sec: 0 }; days.push(cur); }
    cur.list.push(it); cur.sec += it.seconds;
  }
  const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  return head + days.map((d) => `<h2 style="font-size:15px">${esc(d.label)} <span class="m" style="font-weight:400">· ${fmtDur(d.sec)}</span></h2>
    <div class="card">${d.list.map((it) => `<div class="row" data-vid="${it.video_id}" data-title="${esc(it.title)}">
      <img class="th" src="${thumb(it.video_id)}" alt="" loading="lazy">
      <div class="info"><div class="t" style="font-size:14px">${esc(it.title)}</div>
        <div class="m">${hhmm(it.started_at)} · xem ${clock(it.seconds)}${it.duration ? ' / ' + clock(it.duration) : ''}${it.finished ? ' · ✓ xem hết' : ''}${it.tv ? ' · ' + esc(it.tv) : ''}</div></div>
      <div class="ctl"><button class="icon-btn ${it.fav ? 'on' : ''}" data-a="h-fav">${it.fav ? '❤️' : '🤍'}</button><button class="icon-btn" data-a="h-tag" title="Thêm vào giáo trình">🏷</button><button class="icon-btn ${it.hidden ? 'on' : ''}" data-a="h-hide" title="Không cho xem nữa">🚫</button></div></div>`).join('')}</div>`).join('')
    + '<button class="btn danger" data-a="h-clear" style="width:100%;margin-top:8px">Xoá lịch sử</button><p class="hint" style="text-align:center">Lịch sử được giữ 90 ngày.</p>';
}

function newGroup(kind, after, g) {
  let emoji = g ? g.emoji : (kind === 'topic' ? '🎵' : '⭐');
  sheet(`<h3>${g ? 'Sửa' : 'Tạo'} ${kind === 'topic' ? 'playlist' : 'bộ sưu tập'}</h3>
    <label>Tên</label><input id="g-name" value="${esc(g ? g.name : '')}" placeholder="${kind === 'topic' ? 'Ví dụ: Nhạc trước giờ ngủ' : 'Ví dụ: Bảng chữ cái'}">
    <label>Biểu tượng</label><div class="emoji-pick">${EMOJI.map((e) => `<button data-a="emoji" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
    <button class="btn primary" data-a="save">${g ? 'Lưu' : 'Tạo'}</button>`,
  async (a, b) => {
    if (a === 'emoji') {
      emoji = b.textContent;
      document.querySelectorAll('.emoji-pick button').forEach((x) => x.classList.toggle('on', x === b));
    } else if (a === 'save') {
      const gid = await act(() => rpc('ct_group_save', { p_id: g ? g.id : null, p_kind: kind, p_name: $('#g-name').value, p_emoji: emoji }));
      if (!gid) return;
      await load();
      if (after) after(gid); else if (!g) openGroupEditor(gid); else closeSheet();
    }
  });
  setTimeout(() => $('#g-name') && $('#g-name').focus(), 50);
}

// ---------- Tab Yêu thích ----------
function viewFavs() {
  const f = S.favorites;
  return `<h2>❤️ Yêu thích (${f.length})</h2>
  <p class="hint" style="margin-top:-4px">Hiện thành mục đầu tiên trên TV của bé.</p>
  <div class="card">${f.length ? f.map((v) => `
    <div class="row"><img class="th" src="${thumb(v.video_id)}" alt="" loading="lazy">
      <div class="info"><div class="t" style="font-size:14px">${esc(v.title)}</div></div>
      <button class="icon-btn" data-a="unfav" data-vid="${v.video_id}" title="Bỏ yêu thích">✕</button></div>`).join('')
    : '<div class="empty">Chưa có video yêu thích.<br>Ở tab <b>Danh sách</b>, bấm vào một kênh rồi bấm 🤍 cạnh video.</div>'}
  </div>`;
}

// ---------- Tab Cài đặt ----------
function viewSettings() {
  const f = S.family;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return `
  ${standalone ? '' : `<div class="card"><b>📲 Cài ChildTube ra màn hình chính</b><div class="hint" style="margin:6px 0 0">${ios
      ? 'Trên iPhone/iPad: mở trang này bằng <b>Safari</b> → bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên) → <b>Thêm vào MH chính</b>.'
      : 'Trên Android: bấm <b>⋮</b> ở góc Chrome → <b>Cài đặt ứng dụng</b> (hoặc "Thêm vào màn hình chính"). Sau đó trong app YouTube bấm <b>Chia sẻ → ChildTube</b> để thêm video nhanh.'}</div></div>`}

  <h2>📺 TV của bé</h2>
  <div class="card">
    ${S.tvs.map((t) => `<div class="row"><div class="av">📺</div><div class="info"><div class="t">${esc(t.name)}</div><div class="m">${ago(t.last_seen)}</div></div>
      <button class="icon-btn" data-a="tvdel" data-id="${t.id}" title="Gỡ TV">✕</button></div>`).join('')}
    <label>Ghép TV mới: nhập mã 6 số đang hiện trên TV</label>
    <input id="pair-code" class="pair-code" inputmode="numeric" maxlength="6" placeholder="••••••">
    <input id="pair-name" placeholder="Tên TV (ví dụ: TV phòng khách)" style="margin-top:8px">
    <button class="btn primary" data-a="pair">Ghép TV</button>
  </div>

  <h2>🔒 Mã PIN trên TV</h2>
  <div class="card">
    <div class="hint" style="margin:0 0 8px">Dùng để mở mục "Bố mẹ" trên TV (thoát app). Hiện tại: <b>${esc(f.tv_pin)}</b></div>
    <div class="add"><input id="pin" inputmode="numeric" maxlength="6" placeholder="PIN mới (4–6 số)"><button class="btn" data-a="pin">Đổi</button></div>
  </div>

  <h2>⏱ Thời gian xem trên TV</h2>
  <div class="card">
    ${f.end_mode === undefined ? '<div class="hint" style="margin:0 0 8px">⚠ Cần chạy <b>cloud/004_screen_time.sql</b> trong SQL Editor trước khi dùng mục này.</div>' : ''}
    <label>Mỗi ngày bé được xem</label>
    <div class="chips">${[0, 20, 30, 45, 60, 90, 120].concat([0, 20, 30, 45, 60, 90, 120].indexOf(f.daily_minutes || 0) < 0 ? [f.daily_minutes] : [])
      .map((m) => `<button class="chip ${(f.daily_minutes || 0) === m ? 'on' : ''}" data-a="daily" data-m="${m}">${m ? m + ' phút' : 'Không giới hạn'}</button>`).join('')}</div>
    <div class="hint" style="margin:0 0 10px">Hôm nay bé đã xem <b>${Math.floor((f.today_seconds || 0) / 60)} phút</b> (cộng mọi TV).
      WHO/AAP khuyên bé 2–5 tuổi xem tối đa 60 phút mỗi ngày; dưới 2 tuổi nên hạn chế và xem cùng bố mẹ.
      Còn 5 phút TV sẽ báo trước; hết giờ bé được xem nốt video đang xem nếu còn ≤ 10 phút. Muốn cho xem thêm: vào "Bố mẹ" trên TV, nhập PIN.</div>
    <label>Khi bé xem xong một video</label>
    <label class="switch"><input type="radio" name="endmode" value="stop" ${f.end_mode !== 'next' ? 'checked' : ''}> Dừng lại cho bé chọn: về trang chủ, xem lại hay xem tiếp (khuyên dùng)</label>
    <label class="switch"><input type="radio" name="endmode" value="next" ${f.end_mode === 'next' ? 'checked' : ''}> Tự chuyển sang video kế</label>
  </div>

  <h2>🎬 Video</h2>
  <div class="card">
    <label class="switch"><input type="checkbox" id="shorts" ${f.skip_shorts ? 'checked' : ''}> Bỏ qua video Shorts</label>
    <button class="btn small" data-a="refresh" style="margin-top:8px">🔄 Lấy video mới ngay</button>
    <div class="hint">Video mới của các kênh tự cập nhật mỗi giờ; mỗi kênh hiện khoảng 15 video mới nhất.</div>
  </div>

  <h2>👨‍👩‍👧 Gia đình</h2>
  <div class="card">
    <label>Tên gia đình (hiện trên TV)</label>
    <div class="add"><input id="fname" value="${esc(f.name)}"><button class="btn" data-a="fname">Lưu</button></div>
    ${familyMembersHtml()}
  </div>
  ${privacyHtml()}

  <h2>🔑 Tài khoản của bạn</h2>
  <div class="card">
    <label>Đổi mật khẩu đăng nhập app</label>
    <div class="add"><input id="newpw" type="password" autocomplete="new-password" placeholder="Mật khẩu mới (ít nhất 6 ký tự)"><button class="btn" data-a="newpw">Đổi</button></div>
  </div>

  <button class="btn" data-a="logout" style="width:100%;margin-top:8px">Đăng xuất</button>
  <p class="hint" style="text-align:center">Trang trên TV: ${esc(new URL('../tv/', location.href).href)}</p>`;
}

// ---------- Bấm trong màn hình chính ----------
$('#view').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'add') return startAdd();
  if (a === 'paste') {
    try { $('#link').value = (await navigator.clipboard.readText()).trim(); startAdd(); }
    catch { toast('Không đọc được bộ nhớ. Hãy nhấn giữ vào ô rồi chọn Dán.', true); }
    return;
  }
  if (a === 'howto') {
    return sheet(`<h3>Lấy link YouTube</h3>
      <p class="hint">Trong app YouTube: mở video hoặc kênh → bấm <b>Chia sẻ</b> → <b>Sao chép đường liên kết</b> → quay lại đây bấm <b>📋 Dán từ bộ nhớ</b>.</p>
      <p class="hint">Trên Android đã cài app: bấm <b>Chia sẻ → ChildTube</b> là thêm luôn.</p>
      <p class="hint">Trên máy tính: dùng extension "Thêm vào ChildTube" cho Chrome/Edge.</p>
      <button class="btn primary" data-a="x">Đã hiểu</button>`, closeSheet);
  }
  if (a === 'go-settings') return $('#tabs [data-tab="settings"]').click();
  if (a === 'source') return openSource(b.dataset.id);
  if (a === 'newgroup') return b.dataset.kind === 'collection' ? openCreate() : newGroup(b.dataset.kind);
  if (a === 'suggest') {
    for (const [n, em] of SUGGEST_TOPICS) await act(() => rpc('ct_group_save', { p_id: null, p_kind: 'topic', p_name: n, p_emoji: em }));
    return load();
  }
  if (a === 'gedit') return openGroupEditor(b.dataset.id);
  // --- Tab Tìm ---
  if (a === 'sgo') return doSearch();
  if (a === 'stype' || a === 'slang') {
    if (a === 'stype') srch.type = b.dataset.v; else srch.lang = b.dataset.v;
    const q = $('#sq') ? $('#sq').value.trim() : srch.q;
    srch.q = q;
    return q.length >= 2 ? doSearch() : ($('#view').innerHTML = viewSearch());
  }
  if (a === 'sidea') { srch.q = b.dataset.q; return doSearch(); }
  if (a === 'stg') { wzToggleTarget(b.dataset.g); return repaintSearch(); }
  if (a === 'stg-new') return newGroup('topic', async (gid) => { srchTargets.push(gid); saveTargets(); closeSheet(); repaintSearch(); });
  if (a === 'spick') { const r = srch.results[+b.closest('[data-i]').dataset.i]; return chooseGroup({ id: r.id, title: r.title }, () => { closeSheet(); repaintSearch(); }); }
  if (a === 'sadd' || a === 'sch' || a === 'spl') {
    const r = srch.results[+b.closest('[data-i]').dataset.i];
    if (a === 'sadd') {
      const tg = targetGroups().filter((g) => !g.items.some((x) => x.video_id === r.id));
      b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      let n = 0;
      for (const g of tg) { const ok = await act(() => rpc('ct_group_item', { p_group: g.id, p_source: null, p_video: r.id, p_title: r.title, p_on: true })); if (ok === undefined) n++; }
      if (n) toast(n === 1 ? `Đã thêm vào «${tg[0].name}»` : `Đã thêm vào ${n} playlist`);
      await quietLoad();
      return repaintSearch();
    }
    b.disabled = true; const keep = b.textContent; b.innerHTML = '<span class="spin"></span>';
    try {
      const res = await yt({ action: 'add', url: a === 'sch' ? `https://www.youtube.com/channel/${r.channelId}` : `https://www.youtube.com/playlist?list=${r.id}` });
      toast(`Đã thêm ${KIND[res.kind].toLowerCase()} "${res.title}" (${res.count} video, chờ bạn duyệt ở tab Duyệt)`);
      await quietLoad(); b.textContent = '✓ Đã thêm';
    } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = keep; }
    return;
  }
  if (a === 'gorev') return $('#tabs [data-tab="review"]').click();
  // --- Tab Duyệt ---
  if (a === 'rv-all') {
    if (!confirm(`Cho bé xem tất cả ${pend.length} video đang chờ?`)) return;
    await act(() => rpc('ct_approve', { p_videos: pend.map((v) => v.id), p_on: true }), 'Đã duyệt tất cả');
    await quietLoad(); return renderReview();
  }
  if (a === 'rv-src') {
    const n = await act(() => rpc('ct_approve_source', { p_source: b.dataset.id }));
    if (n !== undefined) toast(`Đã duyệt ${n} video`);
    await quietLoad(); return renderReview();
  }
  if (a === 'rv-ok' || a === 'rv-no') {
    const row = b.closest('.row'), vid = row.dataset.vid;
    await act(() => a === 'rv-ok' ? rpc('ct_approve', { p_videos: [vid], p_on: true }) : rpc('ct_hide', { p_video: vid, p_on: true }));
    pend = pend.filter((v) => v.id !== vid);
    $('#view').innerHTML = viewReview();
    return quietLoad();
  }
  if (a === 'rv-tag') {
    const row = b.closest('.row');
    return videoTags(row.dataset.vid, row.dataset.title, async () => { closeSheet(); await quietLoad(); renderReview(); });
  }
  // --- Tab Lịch sử ---
  if (a === 'h-fav' || a === 'h-hide') {
    const row = b.closest('.row'), vid = row.dataset.vid, on = !b.classList.contains('on');
    await act(() => a === 'h-fav' ? rpc('ct_favorite', { p_video: vid, p_title: row.dataset.title, p_on: on }) : rpc('ct_hide', { p_video: vid, p_on: on }));
    b.classList.toggle('on', on);
    if (a === 'h-fav') b.textContent = on ? '❤️' : '🤍';
    return quietLoad();
  }
  if (a === 'h-tag') { const row = b.closest('.row'); return videoTags(row.dataset.vid, row.dataset.title, () => closeSheet()); }
  if (a === 'h-clear') {
    if (!confirm('Xoá toàn bộ lịch sử xem? Việc này không hoàn tác được.')) return;
    await act(() => rpc('ct_history_clear'), 'Đã xoá lịch sử');
    return renderHistory();
  }
  if (a === 'unfav') { await act(() => rpc('ct_favorite', { p_video: b.dataset.vid, p_title: '', p_on: false })); return load(); }
  if (a === 'pair') {
    const ok = await act(() => rpc('ct_pair_tv', { p_code: $('#pair-code').value, p_name: $('#pair-name').value }), 'Đã ghép TV! Trên TV sẽ hiện danh sách trong vài giây.');
    if (ok !== undefined) load();
    return;
  }
  if (a === 'tvdel') {
    if (!confirm('Gỡ TV này? TV sẽ quay về màn hình ghép mã.')) return;
    await act(() => rpc('ct_tv_remove', { p_id: b.dataset.id }));
    return load();
  }
  if (a === 'daily') { await act(() => rpc('ct_family_update', { p: { daily_minutes: +b.dataset.m } }), 'Đã lưu'); return load(); }
  if (a === 'pin') { await act(() => rpc('ct_family_update', { p: { tv_pin: $('#pin').value.trim() } }), 'Đã đổi PIN'); return load(); }
  if (a === 'fname') { await act(() => rpc('ct_family_update', { p: { name: $('#fname').value } }), 'Đã lưu'); return load(); }
  if (a === 'refresh') {
    b.disabled = true; b.innerHTML = '<span class="spin"></span> Đang lấy…';
    const r = await act(() => yt({ action: 'refresh_family' }));
    if (r) toast(`Đã cập nhật ${r.refreshed} kênh` + (r.failed ? `, ${r.failed} kênh lỗi` : ''));
    return load();
  }
  if (a === 'invite') { await act(() => rpc('ct_invite')); return load(); }
  if (a === 'join') {
    const code = prompt('Nhập mã mời (8 ký tự):');
    if (!code) return;
    if (!confirm('Vào gia đình kia? Danh sách hiện tại của bạn (nếu chỉ có mình bạn) sẽ bị xoá.')) return;
    await act(() => rpc('ct_join', { p_code: code }), 'Đã vào gia đình');
    return load();
  }
  if (a === 'newpw') {
    const pw = $('#newpw').value;
    if (pw.length < 6) return toast('Mật khẩu phải có ít nhất 6 ký tự.', true);
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) return toast(error.message, true);
    $('#newpw').value = '';
    return toast('Đã đổi mật khẩu.');
  }
  if (a === 'logout') { await sb.auth.signOut(); return; }
});
$('#view').addEventListener('change', async (e) => {
  if (e.target.name === 'endmode') { await act(() => rpc('ct_family_update', { p: { end_mode: e.target.value } }), 'Đã lưu'); return load(); }
  if (e.target.id === 'shorts') {
    await act(() => rpc('ct_family_update', { p: { skip_shorts: e.target.checked } }));
    toast('Đã lưu, đang lấy lại video…');
    await act(() => yt({ action: 'refresh_family' }));
    load();
  }
});
$('#view').addEventListener('submit', (e) => { e.preventDefault(); if (e.target.id === 'add-form') startAdd(); if (e.target.id === 'search-form') doSearch(); });

// ---------- Link nhận từ "Chia sẻ" (Android) hoặc extension (#add=…) ----------
(function readIncoming() {
  const q = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.slice(1));
  const text = [hash.get('add'), q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
  const m = text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/);
  if (m) {
    pendingLink = m[0];
    history.replaceState(null, '', location.pathname);
  }
  // Quét QR trên TV: #pair=123456. Giữ trong sessionStorage để không mất khi đăng ký/đăng nhập tải lại trang.
  const code = (hash.get('pair') || '').replace(/\D/g, '');
  try {
    if (/^\d{6}$/.test(code)) { sessionStorage.setItem('ct-pair', code); history.replaceState(null, '', location.pathname); }
  } catch (e) { /* trình duyệt chặn lưu trữ: bỏ qua */ }
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// Tab Tìm: bấm ảnh video để xem thử ngay trong danh sách.
$('#view').addEventListener('click', (e) => { const pv = e.target.closest('.pv-box'); if (pv) playPreview(pv); });
