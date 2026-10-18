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
let tab = 'list';
let openGroup = null;  // nhóm đang mở trong tab Nhóm
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
  render();
}
const groupsOf = (kind) => S.groups.filter((g) => g.kind === kind);
const ago = (t) => {
  if (!t) return 'chưa kết nối';
  const m = Math.round((Date.now() - new Date(t)) / 60000);
  return m < 2 ? 'đang bật' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`;
};

// ---------- Bảng trượt ----------
let sheetHandler = null;
function sheet(html, onClick) {
  $('#sheet-body').innerHTML = html;
  sheetHandler = onClick || null;
  $('#sheet').classList.remove('hidden');
}
function closeSheet() { $('#sheet').classList.add('hidden'); sheetHandler = null; }
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
  const email = $('#email').value.trim(), password = $('#password').value;
  $('#login-btn').disabled = true;
  loginMsg(signup ? 'Đang tạo tài khoản…' : 'Đang đăng nhập…', true);
  const { data, error } = signup
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password });
  $('#login-btn').disabled = false;
  if (error) return loginMsg(AUTH_ERR[error.message] || error.message);
  if (signup && !data.session) loginMsg('Đã tạo tài khoản nhưng cần xác nhận email. Hãy báo người cài đặt tắt "Confirm email" trên Supabase.');
  else loginMsg('');
});

function showApp(on) {
  $('#login').classList.toggle('hidden', on);
  $('#main').classList.toggle('hidden', !on);
  $('#tabs').classList.toggle('hidden', !on);
  if (!on) $('#fam-name').textContent = '';
}

sb.auth.onAuthStateChange((ev, session) => {
  if (session) {
    showApp(true);
    // Gọi Supabase ngay trong callback này có thể bị treo, nên đẩy ra ngoài.
    if (!S) setTimeout(() => load().catch((e) => toast(e.message, true)), 0);
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
  else if (tab === 'groups') v.innerHTML = viewGroups();
  else if (tab === 'favs') v.innerHTML = viewFavs();
  else v.innerHTML = viewSettings();
  if (tab === 'list' && pendingLink) { $('#link').value = pendingLink; pendingLink = ''; startAdd(); }
}

// ---------- Tab Danh sách ----------
function viewList() {
  const src = S.sources;
  const noTv = !S.tvs.length ? `<div class="card"><b>Chưa có TV nào.</b><div class="hint" style="margin:4px 0 8px">Mở app ChildTube trên TV, TV sẽ hiện một mã 6 số.</div><button class="btn small" data-a="go-settings">Ghép TV ngay</button></div>` : '';
  return `${noTv}
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
        <div class="m"><span class="badge">${KIND[s.kind]}</span>${s.kind === 'video' ? '' : s.count + ' video'}${tagLine(s.id)}</div></div>
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

// Chi tiết một kênh/playlist/video: gắn nhóm, sắp xếp, xoá, từng video (yêu thích / ẩn / nhóm).
async function openSource(id, justAdded) {
  const s = S.sources.find((x) => x.id === id);
  if (!s) return;
  const idx = S.sources.indexOf(s);
  const isVideo = s.kind === 'video';
  const chips = (kind) => groupsOf(kind).map((g) => {
    const on = isVideo ? g.items.some((i) => i.video_id === s.yt_id) : g.items.some((i) => i.source_id === s.id);
    return `<button class="chip ${on ? 'on' : ''}" data-a="tag" data-g="${g.id}">${esc(g.emoji)} ${esc(g.name)}</button>`;
  }).join('') + `<button class="chip add-chip" data-a="newgroup" data-kind="${kind}">+ Tạo mới</button>`;
  const fav = isVideo && S.favorites.some((f) => f.video_id === s.yt_id);

  sheet(`<div class="head"><img src="${esc(s.thumb)}" alt=""><div><h3>${esc(s.title)}</h3><div class="hint" style="margin:0">${KIND[s.kind]}${isVideo ? '' : ' · ' + s.count + ' video'}</div></div></div>
    ${justAdded ? '<div class="hint">Đã thêm! Chọn bộ sưu tập / chủ đề cho ' + (isVideo ? 'video' : 'kênh') + ' này (không bắt buộc):</div>' : ''}
    <label>Bộ sưu tập</label><div class="chips">${chips('collection')}</div>
    <label>Chủ đề</label><div class="chips">${chips('topic')}</div>
    <div class="toolbar">
      ${isVideo ? `<button class="btn small" data-a="fav">${fav ? '❤️ Bỏ yêu thích' : '🤍 Yêu thích'}</button>` : ''}
      <button class="btn small" data-a="up" ${idx === 0 ? 'disabled' : ''}>↑ Lên</button>
      <button class="btn small" data-a="down" ${idx === S.sources.length - 1 ? 'disabled' : ''}>↓ Xuống</button>
      <button class="btn small danger" data-a="del">Xoá</button>
    </div>
    ${isVideo ? '' : '<h2 style="margin-top:14px">Từng video</h2><div class="hint" style="margin-top:-6px">❤ yêu thích · 🏷 gắn nhóm · 🚫 ẩn không cho bé xem</div><div id="vids"><div class="empty"><span class="spin"></span></div></div>'}`,
  async (a, b) => {
    if (a === 'tag') {
      const g = S.groups.find((x) => x.id === b.dataset.g);
      const on = !b.classList.contains('on');
      await act(() => rpc('ct_group_item', { p_group: g.id, p_source: isVideo ? null : s.id, p_video: isVideo ? s.yt_id : null, p_title: s.title, p_on: on }));
      b.classList.toggle('on', on);
      await load();
    } else if (a === 'newgroup') {
      newGroup(b.dataset.kind, () => openSource(id));
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
    } else if (a === 'vfav' || a === 'vhide' || a === 'vtag') {
      const row = b.closest('.row');
      const vid = row.dataset.vid, title = row.dataset.title;
      if (a === 'vtag') return videoTags(vid, title, () => openSource(id));
      const on = !b.classList.contains('on');
      await act(() => a === 'vfav' ? rpc('ct_favorite', { p_video: vid, p_title: title, p_on: on }) : rpc('ct_hide', { p_video: vid, p_on: on }));
      b.classList.toggle('on', on);
      if (a === 'vhide') row.classList.toggle('off', on);
      if (a === 'vfav') b.textContent = on ? '❤️' : '🤍';
      load();
    }
  });

  if (!isVideo) {
    try {
      const vids = await rpc('ct_source_videos', { p_source: id });
      const box = $('#vids');
      if (!box) return;
      box.innerHTML = vids.length ? vids.map((v) => `
        <div class="row ${v.hidden ? 'off' : ''}" data-vid="${v.id}" data-title="${esc(v.title)}">
          <img class="th" src="${thumb(v.id)}" alt="" loading="lazy">
          <div class="info"><div class="t" style="font-size:14px">${esc(v.title)}</div>${v.groups.length ? `<div class="m">${esc(S.groups.filter((g) => v.groups.includes(g.id)).map((g) => g.emoji + ' ' + g.name).join(', '))}</div>` : ''}</div>
          <button class="icon-btn ${v.fav ? 'on' : ''}" data-a="vfav" title="Yêu thích">${v.fav ? '❤️' : '🤍'}</button>
          <button class="icon-btn" data-a="vtag" title="Gắn nhóm">🏷</button>
          <button class="icon-btn ${v.hidden ? 'on' : ''}" data-a="vhide" title="Ẩn">🚫</button>
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
    <label>Chủ đề</label><div class="chips">${chips('topic')}</div>
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

// ---------- Tab Nhóm (bộ sưu tập + chủ đề) ----------
function viewGroups() {
  const block = (kind, title, hint) => {
    const list = groupsOf(kind);
    return `<h2>${title}<button class="btn small" data-a="newgroup" data-kind="${kind}">+ Tạo</button></h2>
    <div class="card">${list.length ? list.map((g, i) => `
      <div class="row tap" data-a="group" data-id="${g.id}">
        <div class="av">${esc(g.emoji || '📁')}</div>
        <div class="info"><div class="t">${esc(g.name)}</div><div class="m">${g.items.length} mục</div></div>
        <span class="m">${openGroup === g.id ? '⌄' : '›'}</span>
      </div>
      ${openGroup === g.id ? groupDetail(g, i, list.length) : ''}`).join('') : `<div class="empty">${hint}</div>`}
    </div>`;
  };
  return block('collection', '🗂️ Bộ sưu tập', 'Ví dụ: "Trước giờ ngủ", "Cuối tuần", "Học buổi sáng"')
    + block('topic', '🏷️ Chủ đề', `Ví dụ: Âm nhạc, Tiếng Anh, Toán…<br><button class="btn small" data-a="suggest" style="margin-top:10px">Tạo nhanh chủ đề gợi ý</button>`)
    + '<p class="hint">Mỗi nhóm hiện thành một mục riêng trên TV. Thêm kênh hoặc video vào nhóm ở tab <b>Danh sách</b> (bấm vào kênh → chọn nhóm, hoặc 🏷 ở từng video).</p>';
}
function groupDetail(g, i, n) {
  const item = (it) => {
    const s = it.source_id && S.sources.find((x) => x.id === it.source_id);
    const img = s ? s.thumb : thumb(it.video_id);
    return `<div class="row" style="padding-left:12px"><img class="${s && s.kind !== 'video' ? 'av' : 'th'}" src="${esc(img)}" alt="">
      <div class="info"><div class="t" style="font-size:14px">${esc(s ? s.title : it.title)}</div><div class="m">${s ? KIND[s.kind] + (s.kind === 'video' ? '' : ' · cả kênh') : 'Video'}</div></div>
      <button class="icon-btn" data-a="gremove" data-item="${it.id}" data-g="${g.id}" title="Bỏ khỏi nhóm">✕</button></div>`;
  };
  return `<div style="padding:0 0 8px">${g.items.map(item).join('') || '<div class="hint" style="padding-left:12px">Nhóm trống.</div>'}
    <div class="toolbar" style="padding-left:12px">
      <button class="btn small" data-a="gup" data-g="${g.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn small" data-a="gdown" data-g="${g.id}" ${i === n - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn small" data-a="gedit" data-g="${g.id}">✎ Sửa</button>
      <button class="btn small danger" data-a="gdel" data-g="${g.id}">Xoá nhóm</button>
    </div></div>`;
}

function newGroup(kind, after, g) {
  let emoji = g ? g.emoji : (kind === 'topic' ? '🎵' : '⭐');
  sheet(`<h3>${g ? 'Sửa' : 'Tạo'} ${kind === 'topic' ? 'chủ đề' : 'bộ sưu tập'}</h3>
    <label>Tên</label><input id="g-name" value="${esc(g ? g.name : '')}" placeholder="${kind === 'topic' ? 'Ví dụ: Tiếng Anh' : 'Ví dụ: Trước giờ ngủ'}">
    <label>Biểu tượng</label><div class="emoji-pick">${EMOJI.map((e) => `<button data-a="emoji" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
    <button class="btn primary" data-a="save">${g ? 'Lưu' : 'Tạo'}</button>`,
  async (a, b) => {
    if (a === 'emoji') {
      emoji = b.textContent;
      document.querySelectorAll('.emoji-pick button').forEach((x) => x.classList.toggle('on', x === b));
    } else if (a === 'save') {
      const ok = await act(() => rpc('ct_group_save', { p_id: g ? g.id : null, p_kind: kind, p_name: $('#g-name').value, p_emoji: emoji }));
      if (!ok) return;
      await load();
      if (after) after(); else closeSheet();
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
    <label>Bố mẹ trong gia đình</label>
    ${S.members.map((m) => `<div class="row"><div class="av">👤</div><div class="info"><div class="t">${esc(m.email)}${m.me ? ' (bạn)' : ''}</div></div></div>`).join('')}
    <div class="toolbar"><button class="btn small" data-a="invite">Mời bố/mẹ cùng quản lý</button><button class="btn small" data-a="join">Nhập mã mời</button></div>
    ${f.invite_code ? `<div class="hint">Mã mời hiện tại: <b style="letter-spacing:2px">${esc(f.invite_code)}</b> — người kia đăng nhập app rồi bấm "Nhập mã mời".</div>` : ''}
  </div>

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
  if (a === 'newgroup') return newGroup(b.dataset.kind);
  if (a === 'suggest') {
    for (const [n, em] of SUGGEST_TOPICS) await act(() => rpc('ct_group_save', { p_id: null, p_kind: 'topic', p_name: n, p_emoji: em }));
    return load();
  }
  if (a === 'group') { openGroup = openGroup === b.dataset.id ? null : b.dataset.id; return render(); }
  if (a === 'gremove') {
    const g = S.groups.find((x) => x.id === b.dataset.g);
    const it = g.items.find((x) => String(x.id) === b.dataset.item);
    await act(() => rpc('ct_group_item', { p_group: g.id, p_source: it.source_id, p_video: it.video_id, p_title: '', p_on: false }));
    return load();
  }
  if (a === 'gup' || a === 'gdown') {
    const g = S.groups.find((x) => x.id === b.dataset.g);
    const ids = groupsOf(g.kind).map((x) => x.id);
    const i = ids.indexOf(g.id), j = i + (a === 'gup' ? -1 : 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await act(() => rpc('ct_reorder', { p_what: 'group', p_ids: ids }));
    return load();
  }
  if (a === 'gedit') { const g = S.groups.find((x) => x.id === b.dataset.g); return newGroup(g.kind, null, g); }
  if (a === 'gdel') {
    const g = S.groups.find((x) => x.id === b.dataset.g);
    if (!confirm(`Xoá nhóm "${g.name}"? (Kênh và video vẫn còn trong danh sách.)`)) return;
    await act(() => rpc('ct_group_delete', { p_id: g.id }), 'Đã xoá nhóm');
    return load();
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
  if (e.target.id === 'shorts') {
    await act(() => rpc('ct_family_update', { p: { skip_shorts: e.target.checked } }));
    toast('Đã lưu, đang lấy lại video…');
    await act(() => yt({ action: 'refresh_family' }));
    load();
  }
});
$('#view').addEventListener('submit', (e) => { e.preventDefault(); if (e.target.id === 'add-form') startAdd(); });

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
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
