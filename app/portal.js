// ChildTube — Giao diện bố mẹ (bước 2): Tổng quan · Ghi nhanh trong ngày · Nhật ký (dòng thời gian + thư viện ảnh) · Trung tâm phê duyệt.
// Máy chủ: cloudflare/src/journal.ts. Dùng S, rpc, sheet, toast, esc, thumb, render, tab của app.js.

const P = { ov: null, jr: null, gal: null, ap: null, jSeg: 'time', jChild: '', jKind: '' };
const MOOD = [['vui', '😄', 'Vui'], ['bình thường', '🙂', 'Bình thường'], ['mệt', '🥱', 'Mệt'], ['buồn', '😢', 'Buồn'], ['cáu', '😠', 'Cáu']];
const MOOD_ICON = Object.fromEntries(MOOD.map(([k, i]) => [k, i]));
const JKIND = { checkin: ['☀️', 'Ghi nhanh'], note: ['📝', 'Ghi chú'], milestone: ['🌟', 'Cột mốc'], achievement: ['🏆', 'Thành tích'], feedback: ['🧑‍🏫', 'Nhận xét'], activity: ['🎨', 'Hoạt động'] };
const PRIV = { family: '👨‍👩‍👧 Gia đình', parents: '🔒 Chỉ bố mẹ', sensitive: '⚠️ Nhạy cảm' };
const INTERESTS = ['khủng long', 'xe cộ', 'vũ trụ', 'động vật', 'vẽ', 'âm nhạc', 'xếp hình', 'sách', 'robot', 'nấu ăn', 'thể thao', 'thiên nhiên'];
const ACTIVITIES = ['đọc sách', 'vẽ', 'chơi ngoài trời', 'xếp hình', 'hát', 'nấu ăn cùng bố mẹ', 'thí nghiệm', 'xem TV', 'chơi với bạn'];
const mediaUrl = (u) => (u ? (/^https?:/.test(u) ? u : CT_CONFIG.url + u) : '');
const kidOf = (id) => (S.children || []).find((c) => c.id === id);
const kidLabel = (id) => { const c = kidOf(id); return c ? `${esc(c.emoji)} ${esc(c.name)}` : '👨‍👩‍👧 Cả nhà'; };
const jDay = (d) => {
  const t = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), y = new Date(Date.now() + 7 * 3600e3 - 864e5).toISOString().slice(0, 10);
  if (d === t) return 'Hôm nay'; if (d === y) return 'Hôm qua';
  const [Y, M, D] = d.split('-'); return `${+D} tháng ${+M}${Y !== t.slice(0, 4) ? ' ' + Y : ''}`;
};
const mins = (s) => Math.round((s || 0) / 60);

// ---------- Tổng quan ----------
async function renderHome() {
  const v = $('#view');
  if (!P.ov) v.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try { P.ov = await rpc('ct_overview'); } catch (e) { return toast(e.message, true); }
  if (tab === 'home') v.innerHTML = viewHome();
}
function viewHome() {
  const o = P.ov, h = new Date().getHours();
  const hello = h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const kids = o.children.length ? o.children.map((c) => `<div class="pt-kid">
      <div class="pt-kav">${esc(c.emoji)}</div>
      <div class="pt-kinfo"><b>${esc(c.name)}</b><span class="m">${esc((kidOf(c.id) && ageOf(kidOf(c.id).birth)) || c.band_label)}</span>
        <span class="m">${c.last_checkin ? `${MOOD_ICON[c.last_checkin.mood] || '📝'} ${jDay(c.last_checkin.day)}${c.last_checkin.interests && c.last_checkin.interests.length ? ' · thích ' + esc(c.last_checkin.interests.slice(0, 2).join(', ')) : ''}` : 'Chưa ghi hôm nay'}</span></div>
      <button class="btn small primary-s" data-a="P-check" data-id="${c.id}">☀️ Ghi nhanh</button></div>`).join('')
    : '<div class="empty">Chưa có hồ sơ bé. <button class="btn small" data-a="go-settings">Thêm hồ sơ bé</button></div>';
  const used = mins(o.watch.today), lim = o.limit;
  const a = o.approvals;
  const chips = [a.videos && `🎬 ${a.videos} video`, a.drafts && `📝 ${a.drafts} giáo trình nháp`, a.ai_proposals && `🤖 ${a.ai_proposals} đề xuất AI`, a.requests && `🧩 ${a.requests} đề xuất khác`].filter(Boolean);
  const learn = o.learning.map((g) => `<div class="row tap" data-a="P-cur" data-id="${g.id}">
      <div class="av">${esc(g.emoji || '📘')}</div>
      <div class="info"><div class="t">${esc(g.name)}</div>
        <div class="m">${g.child_id ? kidLabel(g.child_id) + ' · ' : ''}${g.done}/${g.total} bài${g.next ? ' · tiếp: ' + esc(g.next.title) : ' · đã học xong 🎉'}</div>
        <div class="bar sm"><i style="width:${Math.round(g.done / g.total * 100)}%"></i></div></div><span class="m">›</span></div>`).join('');
  return `<div class="pt-hello"><b>${hello}!</b><span class="m">${esc(o.family || '')} · ${jDay(o.today)}</span></div>
  <div class="card pt-kids">${kids}</div>
  <div class="pt-grid">
    <div class="card pt-stat tap" data-a="P-hist"><span class="m">📺 Hôm nay bé đã xem</span><b>${used} phút</b>
      ${lim ? `<div class="bar sm"><i style="width:${Math.min(100, Math.round(used / lim * 100))}%"></i></div><span class="m">giới hạn ${lim} phút · tuần này ${mins(o.watch.week)} phút</span>` : `<span class="m">tuần này ${mins(o.watch.week)} phút</span>`}</div>
    <div class="card pt-stat tap ${a.total ? 'warn' : ''}" data-a="P-review"><span class="m">✅ Chờ bạn duyệt</span><b>${a.total || 'Không có'}</b>
      <span class="m">${chips.length ? chips.join(' · ') : 'Mọi thứ đã xong 🎉'}</span></div>
  </div>
  ${learn ? `<h2>📚 Đang học<button class="btn small" data-a="P-groups">Tất cả</button></h2><div class="card">${learn}</div>` : ''}
  <h2>📔 Nhật ký gần đây<button class="btn small" data-a="P-new">+ Ghi</button></h2>
  <div class="card">${o.recent.length ? o.recent.map((e) => entryRow(e, true)).join('') : '<div class="empty">Ghi lại khoảnh khắc của bé: câu hỏi hay, việc bé tự làm được, ảnh hoạt động…</div>'}
    ${o.recent.length ? '<button class="btn link" data-a="P-journal">Xem cả Nhật ký ›</button>' : ''}</div>
  <div class="pt-grid">
    <div class="card pt-stat tap" data-a="P-list"><span class="m">📺 Kênh & video bé được xem</span><b>${S.sources.length}</b><span class="m">Thêm link YouTube, đổi cách duyệt</span></div>
    <div class="card pt-stat tap" data-a="P-ai"><span class="m">🤖 Trợ lý AI</span><b>Soạn giáo trình</b><span class="m">Nói yêu cầu, AI tìm video và đề xuất</span></div>
  </div>`;
}

// ---------- Ghi nhanh (một chạm) ----------
function checkinSheet(childId) {
  const kids = S.children || [];
  const st = { child: childId || (kids[0] && kids[0].id) || null, mood: null, interests: new Set(), activities: new Set() };
  const recent = [...new Set(((P.jr || []).concat(P.ov ? P.ov.recent : [])).flatMap((e) => (e.data && e.data.interests) || []))];
  const ints = [...new Set([...recent, ...INTERESTS])].slice(0, 16);
  const chip = (grp, v) => `<button class="chip" data-a="ck-${grp}" data-v="${esc(v)}">${esc(v)}</button>`;
  const mediaOk = S.consents && S.consents.media_storage;
  sheet(`<h3>☀️ Ghi nhanh hôm nay</h3>
    ${kids.length > 1 ? `<div class="chips">${kids.map((k) => `<button class="chip ${k.id === st.child ? 'on' : ''}" data-a="ck-kid" data-v="${k.id}">${esc(k.emoji)} ${esc(k.name)}</button>`).join('')}</div>` : ''}
    <label>Hôm nay bé thế nào?</label>
    <div class="pt-moods">${MOOD.map(([k, i, t]) => `<button class="pt-mood" data-a="ck-mood" data-v="${k}"><span>${i}</span>${t}</button>`).join('')}</div>
    <label>Bé thích / hỏi về</label><div class="chips">${ints.map((v) => chip('int', v)).join('')}</div>
    <div class="add"><input id="ck-new" placeholder="Thêm điều bé thích…" maxlength="40"><button class="btn" data-a="ck-add">+</button></div>
    <label>Hôm nay bé đã</label><div class="chips">${ACTIVITIES.map((v) => chip('act', v)).join('')}</div>
    <label>Ghi thêm (không bắt buộc)</label><textarea id="ck-note" rows="2" placeholder="Ví dụ: bé hỏi vì sao trời mưa…"></textarea>
    ${mediaOk ? '<label class="btn small pt-file">📷 Thêm ảnh/video<input type="file" id="ck-files" accept="image/*,video/*" multiple hidden></label><div id="ck-prev" class="pt-prev"></div>'
      : '<div class="hint">Muốn đính kèm ảnh? Bật "Lưu ảnh, video của bé" trong Cài đặt → Quyền riêng tư.</div>'}
    <label>Ai được xem</label><select id="ck-priv">${Object.entries(PRIV).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>
    <button class="btn primary" data-a="ck-save">Lưu</button>`, async (a, b) => {
    const tog = (set) => { const v = b.dataset.v; if (set.has(v)) set.delete(v); else set.add(v); b.classList.toggle('on'); };
    if (a === 'ck-kid') { st.child = b.dataset.v; document.querySelectorAll('[data-a=ck-kid]').forEach((x) => x.classList.toggle('on', x === b)); return; }
    if (a === 'ck-mood') { st.mood = b.dataset.v; document.querySelectorAll('.pt-mood').forEach((x) => x.classList.toggle('on', x === b)); return; }
    if (a === 'ck-int') return tog(st.interests);
    if (a === 'ck-act') return tog(st.activities);
    if (a === 'ck-add') {
      const t = $('#ck-new').value.trim(); if (!t) return;
      st.interests.add(t); $('#ck-new').value = '';
      b.closest('.add').previousElementSibling.insertAdjacentHTML('beforeend', `<button class="chip on" data-a="ck-int" data-v="${esc(t)}">${esc(t)}</button>`);
      return;
    }
    if (a === 'ck-save') {
      st.saved = await saveWithFiles(b, () => rpc('ct_journal_save', { p_id: st.saved || null, p: { kind: 'checkin', child_id: st.child, mood: st.mood, interests: [...st.interests], activities: [...st.activities], body: $('#ck-note').value, privacy: $('#ck-priv').value } }), $('#ck-files'), 'Đã ghi lại 🌱') || st.saved;
    }
  });
  sheetChange = (e) => { if (e.target.id === 'ck-files') previewFiles(e.target, $('#ck-prev')); };
}

// ---------- Ảnh/video: xem trước, thu nhỏ, tải lên ----------
function previewFiles(input, box) {
  if (!box) return;
  box.innerHTML = [...input.files].slice(0, 12).map((f) => f.type.startsWith('image/') ? `<img src="${URL.createObjectURL(f)}" alt="">` : `<span class="pt-vid">🎬 ${esc(f.name.slice(0, 18))}</span>`).join('');
}
async function shrink(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return { blob: file, type: file.type, w: null, h: null };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    return { blob, type: 'image/jpeg', w, h };
  } catch (e) { return { blob: file, type: file.type, w: null, h: null }; }   // HEIC… trình duyệt không đọc được: gửi nguyên tệp
}
// Tệp nhỏ gửi một lần; video lớn gửi từng phần 8 MB (tối đa 500 MB), mỗi phần thử lại 3 lần khi mạng chập chờn.
// Tệp đã gửi xong được nhớ lại, nên bấm "Thử tải lại" chỉ gửi những tệp còn thiếu. Trả về số tệp chưa gửi được.
const sentFiles = new WeakSet();
const BIG = 8 * 1024 * 1024;
const mimeOf = (f) => f.type || ({ mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', heic: 'image/heic', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[(f.name.split('.').pop() || '').toLowerCase()] || '');
async function upFetch(path, opt, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(CT_CONFIG.url + path, opt);
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      if (r.status < 500 || i >= tries) throw Object.assign(new Error((j && j.message) || 'Tải lên lỗi (' + r.status + ')'), { status: r.status });
    } catch (e) { if (i >= tries || !(e instanceof TypeError)) throw e; }   // TypeError = mất mạng giữa chừng: thử lại
    await new Promise((ok) => setTimeout(ok, 1500 * i));
  }
}
// entryId: id mục Nhật ký, hoặc 'msg=<id>' để gắn vào tin nhắn
async function sendFile(entryId, f, tok, pct) {
  const H = { Authorization: 'Bearer ' + tok };
  const q = String(entryId).includes('=') ? String(entryId) : 'entry=' + entryId, msg = q.startsWith('msg=') ? q.slice(4) : null;
  const s = await shrink(f), type = s.type || mimeOf(f);
  if (s.blob.size <= BIG) {
    pct(0);
    await upFetch(`/media/v1/upload?${q}${s.w ? `&w=${s.w}&h=${s.h}` : ''}`, { method: 'POST', headers: { ...H, 'Content-Type': type }, body: s.blob }, 2);
    return;
  }
  let st;
  try { st = await upFetch(`/media/v1/upload/start?${q}&mime=${encodeURIComponent(type)}&size=${s.blob.size}`, { method: 'POST', headers: H }); }
  catch (e) {   // máy chủ bản cũ chưa có tải từng phần: gửi một lần nếu ≤ 50 MB
    if (e.status !== 404 || s.blob.size > 50 * 1024 * 1024) throw e;
    pct(0); return upFetch(`/media/v1/upload?${q}`, { method: 'POST', headers: { ...H, 'Content-Type': type }, body: s.blob }, 1);
  }
  const parts = [];
  for (let n = 1, o = 0; o < s.blob.size; n++, o += st.part) {
    pct(o / s.blob.size);
    parts.push(await upFetch(`/media/v1/upload/part?${msg ? 'msg=' + msg + '&' : ''}id=${st.id}&upload=${encodeURIComponent(st.upload)}&n=${n}`, { method: 'PUT', headers: H, body: s.blob.slice(o, o + st.part) }));
  }
  pct(1);
  await upFetch('/media/v1/upload/done' + (msg ? '?msg=' + msg : ''), { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: st.id, upload: st.upload, entry: msg ? null : entryId, msg, mime: type, parts }) });
}
async function uploadFiles(entryId, input, btn) {
  if (!input || !input.files || !input.files.length) return 0;
  const tok = (JSON.parse(localStorage.getItem('ct-session') || '{}') || {}).access_token;
  const files = [...input.files].slice(0, 12).filter((f) => !sentFiles.has(f));
  let bad = 0, i = 0;
  for (const f of files) {
    i++;
    const label = (f.type || mimeOf(f)).startsWith('video/') ? 'video' : 'ảnh';
    const pct = (p) => { const t = `Đang tải ${label} ${i}/${files.length}${p ? ' · ' + Math.round(p * 100) + '%' : '…'}`; if (btn) btn.textContent = t; else toast(t); };
    if (f.size > 500 * 1024 * 1024) { bad++; toast(f.name + ': quá 500 MB. Hãy cắt ngắn video rồi thử lại.', true); continue; }
    try { await sendFile(entryId, f, tok, pct); sentFiles.add(f); }
    catch (e) { bad++; toast(f.name + ': ' + e.message, true); }
  }
  return bad;
}
// Lưu bài trước, rồi gửi ảnh/video. Nếu có tệp lỗi: giữ nguyên khung soạn, lần bấm sau chỉ sửa bài đó + gửi tệp còn thiếu (không tạo bài trùng).
async function saveWithFiles(b, saveFn, input, doneMsg) {
  b.disabled = true;
  const txt = b.dataset.txt || (b.dataset.txt = b.textContent);
  try {
    const id = await saveFn();
    const bad = await uploadFiles(id, input, b);
    if (bad) { b.disabled = false; b.textContent = '↻ Thử tải lại ' + bad + ' tệp'; toast(`Đã lưu bài, còn ${bad} tệp chưa tải lên. Bấm "Thử tải lại".`, true); return id; }
    closeSheet(); toast(doneMsg); P.ov = null; P.jr = null; P.gal = null;
    if (typeof Feed !== 'undefined') Feed.list = null;
    render();
    return id;
  } catch (e) { b.disabled = false; b.textContent = txt; toast(e.message, true); return null; }
}

// ---------- Nhật ký ----------
function entryRow(e, compact) {
  const k = JKIND[e.kind] || ['📝', ''];
  const d = e.data || {};
  const chips = [d.mood && `${MOOD_ICON[d.mood] || ''} ${esc(d.mood)}`, ...(d.interests || []).map((x) => '❤️ ' + esc(x)), ...(d.activities || []).map((x) => '✔ ' + esc(x))].filter(Boolean);
  const media = (e.media || []).filter((m) => m.url);
  return `<div class="pt-entry ${compact ? 'compact' : ''}">
    <div class="pt-eh"><span class="pt-ei">${k[0]}</span><div class="pt-et"><b>${esc(e.title || k[1])}</b>
      <span class="m">${kidLabel(e.child_id)} · ${jDay(e.day)}${e.source === 'teacher' ? ' · 🧑‍🏫 giáo viên' : ''}</span></div>
      ${compact ? '' : `<span class="badge">${PRIV[e.privacy] || ''}</span>`}</div>
    ${e.body ? `<div class="pt-eb">${esc(e.body)}</div>` : ''}
    ${chips.length ? `<div class="pt-echips">${chips.slice(0, compact ? 4 : 20).map((c) => `<span>${c}</span>`).join('')}</div>` : ''}
    ${media.length ? `<div class="pt-media ${media.length === 1 ? 'one' : ''}">${media.slice(0, compact ? 3 : 12).map((m) => m.mime.startsWith('image/')
      ? `<img src="${esc(mediaUrl(m.url))}" alt="" loading="lazy" data-a="P-img" data-src="${esc(mediaUrl(m.url))}">`
      : `<video src="${esc(mediaUrl(m.url))}" controls playsinline preload="metadata"></video>`).join('')}</div>` : ''}
    ${compact || !(e.mine || (S.me && ['owner', 'parent'].includes(S.me.role))) ? '' : `<div class="pt-eact"><button class="btn small" data-a="P-edit" data-id="${e.id}">✎ Sửa</button><button class="btn small" data-a="P-del" data-id="${e.id}">🗑 Xoá</button></div>`}
  </div>`;
}
async function renderJournal() {
  const v = $('#view');
  if (!P.jr) v.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try {
    if (P.jSeg === 'gal') P.gal = await rpc('ct_journal_list', { p_media: true, p_child: P.jChild || null });
    else P.jr = await rpc('ct_journal_list', { p_child: P.jChild || null, p_kind: P.jKind || null });
  } catch (e) { return toast(e.message, true); }
  if (tab === 'journal') v.innerHTML = viewJournal();
}
function viewJournal() {
  const seg = (k, t) => `<button class="chip ${P.jSeg === k ? 'on' : ''}" data-a="P-seg" data-v="${k}">${t}</button>`;
  const kids = S.children || [];
  const kc = kids.length ? `<div class="chips strip">${[['', 'Tất cả bé'], ...kids.map((k) => [k.id, `${k.emoji} ${k.name}`])].map(([k, t]) => `<button class="chip ${P.jChild === k ? 'on' : ''}" data-a="P-kid" data-v="${k}">${esc(t)}</button>`).join('')}</div>` : '';
  let body;
  if (P.jSeg === 'gal') {
    const media = (P.gal || []).flatMap((e) => e.media.filter((m) => m.url).map((m) => ({ ...m, e })));
    body = media.length ? `<div class="pt-gallery">${media.map((m) => m.mime.startsWith('image/')
      ? `<img src="${esc(mediaUrl(m.url))}" alt="" loading="lazy" data-a="P-img" data-src="${esc(mediaUrl(m.url))}" data-cap="${esc((m.e.title || '') + ' · ' + jDay(m.e.day))}">`
      : `<video src="${esc(mediaUrl(m.url))}" preload="metadata" controls playsinline></video>`).join('')}</div>`
      : '<div class="card"><div class="empty">Chưa có ảnh/video. Thêm ảnh khi ghi nhanh hoặc ghi Nhật ký.</div></div>';
  } else {
    const kinds = `<div class="chips strip">${[['', 'Mọi loại'], ...Object.entries(JKIND).map(([k, [i, t]]) => [k, i + ' ' + t])].map(([k, t]) => `<button class="chip ${P.jKind === k ? 'on' : ''}" data-a="P-kind" data-v="${k}">${t}</button>`).join('')}</div>`;
    const list = P.jr || [];
    const days = []; for (const e of list) { const last = days[days.length - 1]; if (last && last.day === e.day) last.items.push(e); else days.push({ day: e.day, items: [e] }); }
    body = kinds + (days.length ? days.map((d) => `<div class="pt-day"><div class="pt-dayh">${jDay(d.day)}</div><div class="card">${d.items.map((e) => entryRow(e, false)).join('')}</div></div>`).join('')
      : '<div class="card"><div class="empty">Chưa có mục ghi nào. Bấm <b>+ Ghi</b> để bắt đầu Nhật ký của bé.</div></div>');
  }
  return `<h2>📔 Nhật ký của bé<button class="btn small primary-s" data-a="P-new">+ Ghi</button></h2>
    <div class="lb-seg">${seg('time', '🗓 Dòng thời gian')}${seg('gal', '🖼 Thư viện ảnh')}</div>${kc}${body}`;
}
function entrySheet(e) {
  const kids = S.children || [], isNew = !e;
  e = e || { kind: 'note', title: '', body: '', day: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), child_id: kids[0] ? kids[0].id : null, privacy: 'family', media: [] };
  const mediaOk = S.consents && S.consents.media_storage;
  let savedId = isNew ? null : e.id;
  sheet(`<h3>${isNew ? '📝 Ghi Nhật ký' : '✎ Sửa mục ghi'}</h3>
    <label>Loại</label><select id="je-kind">${Object.entries(JKIND).filter(([k]) => k !== 'feedback' && k !== 'checkin').map(([k, [i, t]]) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${i} ${t}</option>`).join('')}</select>
    <label>Bé</label><select id="je-kid"><option value="">👨‍👩‍👧 Cả nhà</option>${kids.map((k) => `<option value="${k.id}" ${e.child_id === k.id ? 'selected' : ''}>${esc(k.emoji)} ${esc(k.name)}</option>`).join('')}</select>
    <label>Tiêu đề</label><input id="je-title" value="${esc(e.title)}" maxlength="120" placeholder="Ví dụ: Bin tự đi xe đạp">
    <label>Nội dung</label><textarea id="je-body" rows="4" placeholder="Chuyện gì đã xảy ra, bé nói gì, cảm xúc thế nào…">${esc(e.body)}</textarea>
    <div class="pt-two"><div><label>Ngày</label><input id="je-day" type="date" value="${esc(e.day)}"></div>
      <div><label>Ai được xem</label><select id="je-priv">${Object.entries(PRIV).map(([k, t]) => `<option value="${k}" ${e.privacy === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    ${mediaOk ? '<label class="btn small pt-file">📷 Thêm ảnh/video<input type="file" id="je-files" accept="image/*,video/*" multiple hidden></label><div id="je-prev" class="pt-prev"></div>'
      : '<div class="hint">Muốn đính kèm ảnh? Bật "Lưu ảnh, video của bé" trong Cài đặt → Quyền riêng tư.</div>'}
    <label class="pt-chk"><input type="checkbox" id="je-lesson" ${e.data && e.data.lesson ? 'checked' : ''}> 🎓 Video người thân dạy bé <span class="hint">— hiện ở mục “Người thân dạy” trên TV để bé xem lại</span></label>
    ${(e.media || []).length ? `<div class="pt-media">${e.media.filter((m) => m.url).map((m) => `<span class="pt-mx"><img src="${esc(mediaUrl(m.url))}" alt=""><button class="icon-btn" data-a="je-mdel" data-id="${m.id}">✕</button></span>`).join('')}</div>` : ''}
    <button class="btn primary" data-a="je-save">Lưu</button>`, async (a, b) => {
    if (a === 'je-mdel') { if (!confirm('Xoá ảnh này?')) return; try { await rpc('ct_media_delete', { p_id: b.dataset.id }); b.parentElement.remove(); } catch (err) { toast(err.message, true); } return; }
    if (a !== 'je-save') return;
    savedId = await saveWithFiles(b, () => rpc('ct_journal_save', { p_id: savedId, p: { kind: $('#je-kind').value, child_id: $('#je-kid').value || null, title: $('#je-title').value, body: $('#je-body').value, day: $('#je-day').value, privacy: $('#je-priv').value, lesson: $('#je-lesson').checked } }), $('#je-files'), 'Đã đăng') || savedId;
  });
  sheetChange = (ev) => { if (ev.target.id === 'je-files') previewFiles(ev.target, $('#je-prev')); };
}
function imageSheet(src, cap) { sheet(`<img class="pt-full" src="${esc(src)}" alt="">${cap ? `<div class="hint">${esc(cap)}</div>` : ''}<button class="btn primary" data-a="x">Đóng</button>`, () => closeSheet()); }

// ---------- Trung tâm phê duyệt (đầu tab Duyệt) ----------
function approvalCenterHtml() {
  const ap = P.ap;
  if (!ap) return '';
  const block = (title, rows) => (rows.length ? `<h2>${title}</h2><div class="card">${rows.join('')}</div>` : '');
  const req = ap.requests.map((r) => `<div class="row"><div class="av">🧩</div><div class="info"><div class="t">${esc(r.title)}</div><div class="m">${r.child_id ? kidLabel(r.child_id) + ' · ' : ''}${esc(r.summary || '')}</div>
      ${r.evidence && r.evidence.length ? `<div class="m">Căn cứ: ${r.evidence.slice(0, 3).map((x) => esc(x.note || x.type || '')).join(' · ')}</div>` : ''}</div>
      <button class="icon-btn" data-a="P-req" data-id="${r.id}" data-on="1" title="Đồng ý">✅</button><button class="icon-btn" data-a="P-req" data-id="${r.id}" data-on="0" title="Từ chối">🚫</button></div>`);
  const ai = ap.ai_proposals.map((p) => `<div class="row tap" data-a="P-aichat" data-id="${p.group_id || ''}"><div class="av">${esc(p.emoji || '🤖')}</div>
      <div class="info"><div class="t">${esc(p.name)}</div><div class="m">${p.mode === 'edit' ? 'Đề xuất sửa' : 'Giáo trình mới'} · ${p.lessons} bài${p.changes.length ? ' · ' + esc(p.changes[0]) : ''}</div></div><span class="m">Mở ›</span></div>`);
  const drafts = ap.drafts.map((g) => `<div class="row tap" data-a="P-cur" data-id="${g.id}"><div class="av">${esc(g.emoji || '📘')}</div>
      <div class="info"><div class="t">${esc(g.name)}</div><div class="m">${kidLabel(g.child_id)} · Bản nháp${g.ai ? ' · có phần AI soạn' : ''} — xem lại rồi bấm Xuất bản</div></div><span class="m">›</span></div>`);
  const total = req.length + ai.length + drafts.length;
  return `<div class="card pt-apsum"><b>✅ Trung tâm phê duyệt</b><div class="m">Mọi thứ mới (video, giáo trình, đề xuất của AI) chỉ đến với bé sau khi bạn duyệt.</div>
      <div class="pt-echips">${[ap.videos.reduce((n, s) => n + s.n, 0) && `🎬 ${ap.videos.reduce((n, s) => n + s.n, 0)} video`, drafts.length && `📝 ${drafts.length} nháp`, ai.length && `🤖 ${ai.length} đề xuất AI`, req.length && `🧩 ${req.length} đề xuất khác`].filter(Boolean).map((x) => `<span>${x}</span>`).join('') || '<span>Không có gì chờ duyệt 🎉</span>'}</div></div>
    ${block('🧩 Đề xuất chờ duyệt', req)}${block('🤖 Đề xuất AI chưa chốt', ai)}${block('📝 Giáo trình nháp', drafts)}`;
}
const _renderReview = renderReview;
renderReview = async function () {
  try { P.ap = await rpc('ct_approvals_list'); } catch (e) { P.ap = null; }
  await _renderReview();
  if (tab === 'review' && P.ap) $('#view').insertAdjacentHTML('afterbegin', approvalCenterHtml());
};

// (Bản 2: điều hướng, Tổng quan và Nhật ký chuyển sang shell.js / today.js / feed.js; tệp này còn giữ các hộp thoại dùng chung.)
const goTab = (t) => vGo({ home: 'today', journal: 'feed' }[t] || t);

$('#view').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a^="P-"]');
  if (!b) return;
  const a = b.dataset.a, id = b.dataset.id;
  if (a === 'P-check') return checkinSheet(id);
  if (a === 'P-new') return entrySheet(null);
  if (a === 'P-edit') return entrySheet((P.jr || []).concat(P.ov ? P.ov.recent : []).find((x) => x.id === id));
  if (a === 'P-del') { if (!confirm('Xoá mục ghi này (kèm ảnh/video)?')) return; try { await rpc('ct_journal_delete', { p_id: id }); P.jr = null; P.ov = null; P.gal = null; toast('Đã xoá'); render(); } catch (err) { toast(err.message, true); } return; }
  if (a === 'P-img') return imageSheet(b.dataset.src, b.dataset.cap);
  if (a === 'P-seg') { P.jSeg = b.dataset.v; return render(); }
  if (a === 'P-kid') { P.jChild = b.dataset.v; P.jr = null; return render(); }
  if (a === 'P-kind') { P.jKind = b.dataset.v; P.jr = null; return render(); }
  if (a === 'P-home') return goTab('home');
  if (a === 'P-hist') return goTab('history');
  if (a === 'P-list') return goTab('list');
  if (a === 'P-review') return goTab('review');
  if (a === 'P-groups') return goTab('groups');
  if (a === 'P-journal') return goTab('journal');
  if (a === 'P-ai') return aiChat.open(null, () => { P.ov = null; render(); });
  if (a === 'P-aichat') return aiChat.open(id || null, () => { P.ap = null; render(); });
  if (a === 'P-cur') return openEditor(id);
  if (a === 'P-req') {
    try { await rpc('ct_approval_decide', { p_id: id, p_on: b.dataset.on === '1' }); toast(b.dataset.on === '1' ? 'Đã đồng ý' : 'Đã từ chối'); render(); } catch (err) { toast(err.message, true); }
  }
});
