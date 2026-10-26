// ChildTube — Module 8: hồ sơ trẻ, thư viện yêu thích + bộ sưu tập, tự xây dựng giáo trình (Giáo trình → Chương → Bài → Video).
// Dùng chung trạng thái S, rpc(), sheet(), toast() của app.js. Hàm cloud: cloud/005_library_curriculum.sql.
// Video bố mẹ tự thêm vào bài = đã duyệt; yêu thích ≠ đã duyệt (yêu thích chưa duyệt không lên TV).

// ---------- Tiện ích ----------
const L = { seg: 'cur', child: 'all', showArchived: false, fq: '', fcol: '', fsub: '', fage: '', fsort: 'new', picked: new Set() };
const lbDur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
const parseTime = (t) => {
  t = String(t || '').trim();
  if (!t) return '';
  const p = t.split(':').map(Number);
  if (p.some((x) => Number.isNaN(x))) return '';
  return p.reduce((a, n) => a * 60 + n, 0);
};
const vmeta = (id) => (S.videos && S.videos[id]) || {};
const childName = (id) => { const c = (S.children || []).find((x) => x.id === id); return c ? `${c.emoji} ${c.name}` : '👨‍👩‍👧 Cả nhà'; };
const ageOf = (birth) => {
  if (!birth) return '';
  const m = (Date.now() - new Date(birth)) / (365.25 * 864e5);
  return m < 1 ? `${Math.max(1, Math.round(m * 12))} tháng` : `${Math.floor(m)} tuổi`;
};
const SRC = { parent: '✍️ Bố mẹ tự tạo', ai: '🤖 AI tạo', hybrid: '🤝 Phối hợp' };
const curricula = () => S.groups.filter((g) => g.kind === 'collection');
const curStats = (g) => {
  const mods = g.modules || [], lessons = mods.reduce((n, m) => n + m.lessons.length, 0);
  const items = mods.flatMap((m) => m.lessons.flatMap((l) => l.items)).filter((i) => i.video_id);
  const doneSet = new Set(g.items.filter((i) => i.done).map((i) => i.video_id));
  const main = items.filter((i) => i.role !== 'extra');
  return { mods: mods.length, lessons, videos: items.length, done: main.filter((i) => doneSet.has(i.video_id)).length, main: main.length };
};
const assignedCount = (vid) => S.groups.reduce((n, g) => n + g.items.filter((i) => i.video_id === vid).length, 0);
const ytId = (url) => (String(url).match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/) || [])[1] || (/^[\w-]{11}$/.test(String(url).trim()) ? String(url).trim() : null);
const listId = (url) => (String(url).match(/[?&]list=([\w-]+)/) || [])[1];

// Tìm thông tin video (tên, kênh, thời lượng, phát được trên TV) qua hàm tìm kiếm có sẵn, lưu vào thư viện dùng chung.
async function lookupVideo(id) {
  const m = vmeta(id);
  if (m.title && m.channel) return { id, ...m };
  let r = null;
  try {
    const { data } = await sb.functions.invoke('ct-search', { body: { q: id, type: 'video', lang: 'vi' } });
    r = (data && data.results || []).find((x) => x.id === id) || null;
  } catch (e) { /* để trống */ }
  const v = { id, title: (r && r.title) || m.title || `Video ${id}`, channel: (r && r.channel) || '', channelId: (r && r.channelId) || '',
    thumb: (r && r.thumb) || thumb(id), seconds: (r && r.seconds) || null, embed: r ? r.embed : undefined };
  try { await rpc('ct_video_meta', { p_videos: [v] }); } catch (e) { /* không chặn */ }
  return v;
}
// Dán link: video → 1 video; playlist → các video trong playlist (lấy qua ct-yt, rồi gỡ nguồn tạm)
async function videosFromLink(url) {
  const vid = ytId(url), list = listId(url);
  if (list && !vid) {
    const r = await yt({ action: 'add', url });
    try {
      const vids = await rpc('ct_source_videos', { p_source: r.id });
      return vids.map((v) => ({ id: v.id, title: v.title, thumb: thumb(v.id) }));
    } finally { await rpc('ct_source_delete', { p_id: r.id }).catch(() => {}); }
  }
  if (!vid) throw new Error('Link không phải video hay playlist YouTube.');
  return [await lookupVideo(vid)];
}
function previewSheet(vid, title, back) {
  const m = vmeta(vid);
  sheet(`<h3>${esc(title || m.title || '')}</h3>
    <div class="lb-player"><iframe src="https://www.youtube-nocookie.com/embed/${vid}?rel=0&modestbranding=1" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>
    <div class="hint">${esc(m.channel || '')}${m.seconds ? ' · ' + lbDur(m.seconds) : ''}${m.embed === false ? ' · ⚠ Chủ video không cho phát ngoài YouTube: TV không phát được' : ''}</div>
    <button class="btn primary" data-a="pv-back">Đóng</button>`, (a) => { if (a === 'pv-back') return back ? back() : closeSheet(); });
}

// ---------- Tab Giáo trình: Giáo trình | Yêu thích | Playlist ----------
viewGroups = function () {
  const seg = (v, t) => `<button class="chip ${L.seg === v ? 'on' : ''}" data-a="L-seg" data-v="${v}">${t}</button>`;
  const head = `<div class="lb-seg">${seg('cur', '📚 Giáo trình')}${seg('fav', `❤️ Yêu thích (${S.favorites.length})`)}${seg('pl', '🎵 Playlist')}</div>`;
  if (L.seg === 'fav') return head + viewFavorites();
  if (L.seg === 'pl') return head + viewPlaylists();
  return head + viewCurricula();
};

function childChips() {
  const kids = S.children || [];
  if (!kids.length) return '';
  const c = (v, t) => `<button class="chip ${L.child === v ? 'on' : ''}" data-a="L-child" data-v="${v}">${t}</button>`;
  return `<div class="chips">${c('all', 'Tất cả')}${c('', '👨‍👩‍👧 Cả nhà')}${kids.map((k) => c(k.id, `${esc(k.emoji)} ${esc(k.name)}`)).join('')}</div>`;
}

function viewCurricula() {
  let list = curricula().filter((g) => L.showArchived || !g.archived);
  if (L.child !== 'all') list = list.filter((g) => (g.child_id || '') === L.child);
  const card = (g) => {
    const s = curStats(g);
    return `<div class="row tap lb-cur ${g.archived ? 'off' : ''}" data-a="L-edit" data-id="${g.id}">
      <div class="av">${esc(g.emoji || '📘')}</div>
      <div class="info"><div class="t">${esc(g.name)}</div>
        <div class="m">${childName(g.child_id)} · ${s.mods} chương · ${s.lessons} bài · ${s.videos} video${g.subject ? ' · ' + esc(g.subject) : ''}</div>
        <div class="m"><span class="badge ${g.status === 'published' ? 'pub' : 'draft'}">${g.status === 'published' ? 'Đã xuất bản' : 'Bản nháp'}</span><span class="badge">${SRC[g.source_type] || SRC.parent}</span>${g.archived ? '<span class="badge">Lưu trữ</span>' : ''}</div>
        ${s.main ? `<div class="bar sm"><i style="width:${Math.round(s.done / s.main * 100)}%"></i></div>` : ''}</div>
      <span class="m">›</span></div>`;
  };
  const nArch = curricula().filter((g) => g.archived).length;
  return `<h2>📚 Giáo trình của bé</h2>${childChips()}
    <div class="toolbar"><button class="btn small primary-s" data-a="L-ai">🤖 Soạn cùng AI</button><button class="btn small" data-a="L-new">✍️ Tự tạo giáo trình</button><button class="btn small" data-a="newgroup" data-kind="collection">✨ Từ mẫu / theo hồ sơ bé</button></div>
    <div class="card">${list.length ? list.map(card).join('') : '<div class="empty">Chưa có giáo trình. Bấm <b>Tự tạo giáo trình</b> hoặc chọn từ mẫu.</div>'}</div>
    ${nArch ? `<button class="btn link" data-a="L-arch">${L.showArchived ? 'Ẩn' : 'Hiện'} ${nArch} giáo trình đã lưu trữ</button>` : ''}
    <p class="hint">Chỉ giáo trình <b>Đã xuất bản</b> mới hiện trên TV. Bản nháp sửa thoải mái, bé không thấy.</p>`;
}

function viewPlaylists() {
  const list = groupsOf('topic');
  return `<h2>🎵 Playlist & chủ đề<button class="btn small" data-a="newgroup" data-kind="topic">+ Tạo</button></h2>
    <div class="card">${list.length ? list.map((g) => `<div class="row tap" data-a="gedit" data-id="${g.id}"><div class="av">${esc(g.emoji || '🎵')}</div>
      <div class="info"><div class="t">${esc(g.name)}</div><div class="m">${g.items.length} mục</div></div><span class="m">›</span></div>`).join('')
      : '<div class="empty">Danh sách phát bố mẹ tự tạo, ví dụ: Nhạc trước giờ ngủ. Mỗi playlist là một mục trên TV.</div>'}</div>`;
}

// ---------- My Favorites ----------
function favFiltered() {
  const q = L.fq.trim().toLowerCase();
  const col = L.fcol && (S.fav_collections || []).find((c) => c.id === L.fcol);
  let list = S.favorites.filter((f) => {
    const m = vmeta(f.video_id);
    if (col && col.items.indexOf(f.video_id) < 0) return false;
    if (L.fsub && f.subject !== L.fsub) return false;
    if (L.fage) {
      const a = +L.fage;
      if (f.age_min != null && f.age_min > a + 1.99) return false;
      if (f.age_max != null && f.age_max < a) return false;
    }
    if (q && ![f.title, m.channel, f.subject, (f.tags || []).join(' ')].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
  const by = { new: (a, b) => (b.created_at || '').localeCompare(a.created_at || ''), name: (a, b) => a.title.localeCompare(b.title, 'vi'),
    dur: (a, b) => (vmeta(a.video_id).seconds || 0) - (vmeta(b.video_id).seconds || 0) };
  return list.sort(by[L.fsort] || by.new);
}
function viewFavorites() {
  const cols = S.fav_collections || [], subs = [...new Set(S.favorites.map((f) => f.subject).filter(Boolean))].sort();
  const list = favFiltered();
  const colChip = (id, t) => `<button class="chip ${L.fcol === id ? 'on' : ''}" data-a="L-fcol" data-v="${id}">${t}</button>`;
  const card = (f) => {
    const m = vmeta(f.video_id), n = assignedCount(f.video_id), on = L.picked.has(f.video_id);
    return `<div class="lb-vcard ${on ? 'picked' : ''}">
      <div class="lb-thumb" data-a="L-fprev" data-vid="${f.video_id}"><img src="${esc(m.thumb || thumb(f.video_id))}" alt="" loading="lazy">${m.seconds ? `<span class="dur">${lbDur(m.seconds)}</span>` : ''}
        <label class="lb-pick" data-a="L-pick" data-vid="${f.video_id}"><input type="checkbox" ${on ? 'checked' : ''} tabindex="-1"></label></div>
      <div class="lb-vt">${esc(f.title || m.title)}</div>
      <div class="m">${esc(m.channel || '')}</div>
      <div class="m"><span class="badge ${f.approved ? 'pub' : 'draft'}">${f.approved ? 'Đã duyệt' : 'Chưa duyệt'}</span>${n ? `<span class="badge">Trong ${n} bài</span>` : ''}${f.subject ? `<span class="badge">${esc(f.subject)}</span>` : ''}${(f.tags || []).map((t) => `<span class="badge">#${esc(t)}</span>`).join('')}</div>
      <div class="lb-act">
        <button class="icon-btn" data-a="L-fprev" data-vid="${f.video_id}" title="Xem trước">▶</button>
        <button class="icon-btn" data-a="L-fadd" data-vid="${f.video_id}" title="Thêm vào giáo trình">➕</button>
        <button class="icon-btn" data-a="L-fcols" data-vid="${f.video_id}" title="Bộ sưu tập">📁</button>
        <button class="icon-btn" data-a="L-fedit" data-vid="${f.video_id}" title="Môn, tag, tuổi">✎</button>
        ${f.approved ? '' : `<button class="icon-btn" data-a="L-fok" data-vid="${f.video_id}" title="Duyệt cho bé xem">✅</button>`}
        <button class="icon-btn" disabled title="AI phân tích (giai đoạn 2)">🤖</button>
        <button class="icon-btn" data-a="L-funfav" data-vid="${f.video_id}" title="Bỏ yêu thích">💔</button>
      </div></div>`;
  };
  const sel = (id, cur, opts) => `<select id="${id}">${opts.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  return `<h2>❤️ Thư viện yêu thích</h2>
    <p class="hint" style="margin-top:-4px">Lưu video để dùng sau. Yêu thích <b>chưa duyệt</b> sẽ không tự lên TV; video đưa vào bài học thì tự được duyệt.</p>
    <div class="card">
      <div class="add"><input id="lf-link" placeholder="Dán link video hoặc playlist YouTube để lưu" autocomplete="off"><button class="btn" data-a="L-flink">Lưu</button></div>
      <div class="chips">${colChip('', 'Tất cả')}${cols.map((c) => colChip(c.id, `${esc(c.emoji)} ${esc(c.name)} (${c.items.length})`)).join('')}<button class="chip add-chip" data-a="L-fcolnew">+ Bộ sưu tập</button>${L.fcol ? '<button class="chip add-chip" data-a="L-fcoledit">✎ Sửa bộ này</button>' : ''}</div>
      <div class="lb-filters">
        <input id="lf-q" placeholder="Tìm theo tên, kênh, chủ đề, tag" value="${esc(L.fq)}">
        ${sel('lf-sub', L.fsub, [['', 'Mọi môn']].concat(subs.map((s) => [s, s])))}
        ${sel('lf-age', L.fage, [['', 'Mọi tuổi'], ['1', '1–2 tuổi'], ['3', '3–4 tuổi'], ['5', '5–6 tuổi'], ['7', '7+ tuổi']])}
        ${sel('lf-sort', L.fsort, [['new', 'Mới lưu'], ['name', 'Tên A–Z'], ['dur', 'Ngắn trước']])}
      </div>
    </div>
    ${L.picked.size ? `<div class="card target lb-bulk"><span>Đã chọn <b>${L.picked.size}</b> video</span>
      <span><button class="btn small" data-a="L-bulkadd">➕ Vào giáo trình</button> <button class="btn small" data-a="L-bulkcol">📁 Bộ sưu tập</button> <button class="btn small" data-a="L-bulknone">Bỏ chọn</button></span></div>` : ''}
    <div class="lb-grid">${list.length ? list.map(card).join('') : '<div class="empty">Chưa có video nào khớp. Dán link ở trên, hoặc bấm ❤ ở tab Tìm / Danh sách.</div>'}</div>`;
}

// Chọn giáo trình + chương/bài để thêm video. mode: 'each' (mỗi video một bài) | 'one' (tất cả vào một bài)
function addToCurriculumSheet(videos, back) {
  const list = curricula().filter((g) => !g.archived);
  sheet(`<h3>Thêm ${videos.length} video vào giáo trình</h3>
    ${list.length ? `<label>Giáo trình</label><select id="ac-g">${list.map((g) => `<option value="${g.id}">${esc(g.emoji)} ${esc(g.name)}${g.status === 'draft' ? ' (nháp)' : ''}</option>`).join('')}</select>
    <label>Đặt vào</label><select id="ac-l"></select>
    <button class="btn primary" data-a="ac-go">Thêm</button>` : '<div class="empty">Chưa có giáo trình. Hãy tạo ở mục Giáo trình.</div>'}
    <button class="btn link" data-a="ac-back">Quay lại</button>`,
  async (a) => {
    if (a === 'ac-back') return back();
    if (a !== 'ac-go') return;
    const g = S.groups.find((x) => x.id === $('#ac-g').value), target = $('#ac-l').value;
    try {
      const vids = videos.map((v) => ({ id: v.id, title: v.title, ...vmeta(v.id) }));
      if (target.startsWith('each:') || target.startsWith('one:')) {
        const [mode, mid] = target.split(':');
        if (mode === 'one') {
          const lid = await rpc('ct_lesson_save', { p_id: null, p_module: mid, p: { title: vids[0].title } });
          await rpc('ct_content_add', { p_lesson: lid, p_videos: vids, p_source: 'parent' });
        } else {
          for (const v of vids) {
            const lid = await rpc('ct_lesson_save', { p_id: null, p_module: mid, p: { title: v.title } });
            await rpc('ct_content_add', { p_lesson: lid, p_videos: [v], p_source: 'parent' });
          }
        }
      } else await rpc('ct_content_add', { p_lesson: target, p_videos: vids, p_source: 'parent' });
      toast(`Đã thêm vào "${g.name}"`);
      await quietLoad();
      back();
    } catch (e) { toast(e.message, true); }
  });
  const fill = () => {
    const g = S.groups.find((x) => x.id === $('#ac-g').value);
    if (!g) return;
    const mods = g.modules || [];
    $('#ac-l').innerHTML = mods.map((m) => `<optgroup label="${esc(m.title)}">
        <option value="each:${m.id}">＋ Mỗi video thành một bài mới (cuối chương)</option>
        ${videos.length > 1 ? `<option value="one:${m.id}">＋ Tất cả vào một bài mới</option>` : ''}
        ${m.lessons.map((l) => `<option value="${l.id}">Bài: ${esc(l.title)}</option>`).join('')}</optgroup>`).join('');
  };
  if (list.length) { fill(); sheetChange = (e) => { if (e.target.id === 'ac-g') fill(); }; }
}

function collectionsSheet(vids, back) {
  const cols = S.fav_collections || [];
  const inAll = (c) => vids.every((v) => c.items.indexOf(v.id) >= 0);
  sheet(`<h3>Bộ sưu tập</h3><p class="hint" style="margin-top:0">${vids.length > 1 ? `${vids.length} video đã chọn` : esc(vids[0].title)}</p>
    <div class="chips">${cols.map((c) => `<button class="chip ${inAll(c) ? 'on' : ''}" data-a="cs-t" data-id="${c.id}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('')}
    <button class="chip add-chip" data-a="cs-new">+ Tạo mới</button></div>
    <button class="btn primary" data-a="cs-done">Xong</button>`,
  async (a, b) => {
    if (a === 'cs-done') return back();
    if (a === 'cs-new') return collectionEdit(null, () => collectionsSheet(vids, back));
    if (a === 'cs-t') {
      const on = !b.classList.contains('on');
      await act(() => rpc('ct_fcol_items', { p_col: b.dataset.id, p_videos: vids.map((v) => ({ id: v.id, title: v.title, ...vmeta(v.id) })), p_on: on }));
      await quietLoad();
      collectionsSheet(vids, back);
    }
  });
}
const COL_EMOJI = ['📁', '🔬', '🔢', '🧪', '🔤', '🦁', '🌏', '🎵', '📚', '⭐', '🔁', '🚀'];
function collectionEdit(c, after) {
  let emoji = c ? c.emoji : '📁';
  sheet(`<h3>${c ? 'Sửa' : 'Tạo'} bộ sưu tập</h3>
    <label>Tên</label><input id="ce-name" value="${esc(c ? c.name : '')}" placeholder="Ví dụ: Thí nghiệm tại nhà">
    <label>Biểu tượng</label><div class="emoji-pick">${COL_EMOJI.map((e) => `<button data-a="ce-e" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
    <button class="btn primary" data-a="ce-save">${c ? 'Lưu' : 'Tạo'}</button>
    ${c ? '<button class="btn link danger" data-a="ce-del">Xoá bộ sưu tập (video vẫn còn trong yêu thích)</button>' : ''}`,
  async (a, b) => {
    if (a === 'ce-e') { emoji = b.textContent; document.querySelectorAll('.emoji-pick button').forEach((x) => x.classList.toggle('on', x === b)); }
    if (a === 'ce-save') { const id = await act(() => rpc('ct_fcol_save', { p_id: c ? c.id : null, p_name: $('#ce-name').value, p_emoji: emoji })); if (!id) return; await quietLoad(); after(id); }
    if (a === 'ce-del') { if (!confirm(`Xoá bộ sưu tập "${c.name}"?`)) return; await act(() => rpc('ct_fcol_delete', { p_id: c.id })); L.fcol = ''; await quietLoad(); after(null); }
  });
}
function favEditSheet(f) {
  sheet(`<h3>Thông tin học liệu</h3><p class="hint" style="margin-top:0">${esc(f.title)}</p>
    <label>Môn học / chủ đề</label><input id="fe-sub" value="${esc(f.subject || '')}" placeholder="Ví dụ: Khoa học" list="fe-subs">
    <datalist id="fe-subs">${['Tiếng Việt', 'Toán', 'Tiếng Anh', 'Khoa học', 'Âm nhạc', 'Mĩ thuật', 'Kỹ năng sống', 'Vận động'].map((s) => `<option value="${s}">`).join('')}</datalist>
    <label>Tag (cách nhau bằng dấu phẩy)</label><input id="fe-tags" value="${esc((f.tags || []).join(', '))}" placeholder="thí nghiệm, tại nhà">
    <label>Độ tuổi phù hợp</label><div class="add"><input id="fe-a1" inputmode="decimal" value="${f.age_min ?? ''}" placeholder="từ"><input id="fe-a2" inputmode="decimal" value="${f.age_max ?? ''}" placeholder="đến"></div>
    <label>Ghi chú</label><input id="fe-note" value="${esc(f.note || '')}" placeholder="Xem cùng bé, hỏi bé…">
    <button class="btn primary" data-a="fe-save">Lưu</button>`,
  async (a) => {
    if (a !== 'fe-save') return;
    await act(() => rpc('ct_fav_update', { p_video: f.video_id, p: { subject: $('#fe-sub').value.trim(), tags: $('#fe-tags').value.split(','),
      age_min: $('#fe-a1').value.trim(), age_max: $('#fe-a2').value.trim(), note: $('#fe-note').value } }), 'Đã lưu');
    await quietLoad(); closeSheet(); render();
  });
}

// ---------- Tạo giáo trình (bước 1) ----------
const CUR_EMOJI = ['📘', '🔬', '🔢', '🔤', '🌏', '🚀', '🦁', '🎨', '🎵', '🧠', '⚽', '📚'];
function curInfoSheet(g, after) {
  let emoji = g ? g.emoji || '📘' : '📘';
  const kids = S.children || [];
  sheet(`<h3>${g ? 'Thông tin giáo trình' : '✍️ Tự tạo giáo trình'}</h3>
    <label>Tên giáo trình</label><input id="ci-name" value="${esc(g ? g.name : '')}" placeholder="Ví dụ: Khám phá vũ trụ">
    <label>Biểu tượng</label><div class="emoji-pick">${CUR_EMOJI.map((e) => `<button data-a="ci-e" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
    <label>Áp dụng cho</label><select id="ci-child"><option value="">👨‍👩‍👧 Cả nhà (dùng chung cho các bé)</option>${kids.map((k) => `<option value="${k.id}" ${g && g.child_id === k.id ? 'selected' : ''}>${esc(k.emoji)} ${esc(k.name)}</option>`).join('')}</select>
    ${kids.length ? '' : '<div class="hint">Thêm hồ sơ từng bé ở <b>Cài đặt → Hồ sơ các bé</b>.</div>'}
    <label>Môn học</label><input id="ci-sub" value="${esc(g ? g.subject : '')}" placeholder="Ví dụ: Khoa học" list="fe-subs2">
    <datalist id="fe-subs2">${['Tiếng Việt', 'Toán', 'Tiếng Anh', 'Khoa học', 'Âm nhạc', 'Mĩ thuật', 'Kỹ năng sống', 'Vận động'].map((s) => `<option value="${s}">`).join('')}</datalist>
    <label>Mục tiêu</label><input id="ci-goal" value="${esc(g ? g.goal || g.note : '')}" placeholder="Ví dụ: Biết tên 8 hành tinh" maxlength="300">
    <div class="add"><div style="flex:1"><label>Nhóm tuổi / trình độ</label><input id="ci-age" value="${esc(g ? g.age_label : '')}" placeholder="4–6 tuổi"></div>
      <div style="flex:1"><label>Mỗi buổi (phút)</label><input id="ci-min" inputmode="numeric" value="${g && g.minutes ? g.minutes : ''}" placeholder="20"></div></div>
    <label>Chế độ học</label><select id="ci-mode"><option value="passive" ${g && g.mode === 'active' ? '' : 'selected'}>Thụ động: bé xem, bố mẹ nhắc</option><option value="active" ${g && g.mode === 'active' ? 'selected' : ''}>Chủ động: có câu hỏi / nhiệm vụ sau bài</option></select>
    <label class="switch"><input type="checkbox" id="ci-lock" ${g && g.locked ? 'checked' : ''}> Khoá bài sau cho tới khi bé xem xong bài trước</label>
    <button class="btn primary" data-a="ci-save">${g ? 'Lưu' : 'Tạo bản nháp và soạn bài'}</button>`,
  async (a, b) => {
    if (a === 'ci-e') { emoji = b.textContent; document.querySelectorAll('.emoji-pick button').forEach((x) => x.classList.toggle('on', x === b)); return; }
    if (a !== 'ci-save') return;
    const p = { name: $('#ci-name').value, emoji, child_id: $('#ci-child').value, subject: $('#ci-sub').value.trim(), goal: $('#ci-goal').value.trim(),
      age_label: $('#ci-age').value.trim(), minutes: $('#ci-min').value.trim(), mode: $('#ci-mode').value, locked: $('#ci-lock').checked };
    const id = await act(() => rpc('ct_cur_save', { p_id: g ? g.id : null, p }));
    if (!id) return;
    await quietLoad(); closeSheet(); after(id);
  });
  setTimeout(() => !g && $('#ci-name') && $('#ci-name').focus(), 50);
}

// ---------- Curriculum Editor (toàn màn hình) ----------
const E = { gid: null, lesson: null, pane: 'tree', lib: 'fav', q: '', results: null, busy: false, other: '' };
function edGroup() { return S.groups.find((g) => g.id === E.gid); }
function edLesson(g) {
  for (const m of g.modules || []) for (const l of m.lessons) if (l.id === E.lesson) return { m, l };
  return null;
}
function openEditor(gid) {
  E.gid = gid; E.lesson = null; E.pane = 'tree';
  const g = edGroup();
  const first = g && (g.modules || []).flatMap((m) => m.lessons)[0];
  if (first) E.lesson = first.id;
  let el = $('#ed');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ed';
    el.className = 'ed';
    document.body.appendChild(el);
    el.addEventListener('click', edClick);
    el.addEventListener('change', edChange);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'ed-q') { e.preventDefault(); edSearch(); } });
  }
  el.classList.remove('hidden');
  document.body.classList.add('ed-open');
  renderEditor();
}
function closeEditor() { const el = $('#ed'); if (el) el.classList.add('hidden'); document.body.classList.remove('ed-open'); render(); }
async function edReload() {
  const keep = [...document.querySelectorAll('#ed .ed-col')].map((c) => c.scrollTop);
  await quietLoad();
  renderEditor();
  document.querySelectorAll('#ed .ed-col').forEach((c, i) => { c.scrollTop = keep[i] || 0; });
}

function renderEditor() {
  const g = edGroup();
  if (!g) return closeEditor();
  const s = curStats(g), cur = edLesson(g);
  const pub = g.status === 'published';
  const tab = (v, t) => `<button class="chip ${E.pane === v ? 'on' : ''}" data-a="E-pane" data-v="${v}">${t}</button>`;
  $('#ed').innerHTML = `
  <div class="ed-top">
    <button class="icon-btn" data-a="E-close" title="Đóng">✕</button>
    <div class="ed-title"><b>${esc(g.emoji || '📘')} ${esc(g.name)}</b>
      <span class="m">${childName(g.child_id)} · ${s.mods} chương · ${s.lessons} bài · ${s.videos} video · <span class="badge ${pub ? 'pub' : 'draft'}">${pub ? 'Đã xuất bản' : 'Bản nháp'}</span><span class="badge">${SRC[g.source_type] || SRC.parent}</span></span></div>
    <div class="ed-tools">
      <button class="btn small primary-s" data-a="E-ai">🤖 Sửa bằng AI</button>
      <button class="btn small" data-a="E-info">✎ Thông tin</button>
      <button class="btn small" data-a="E-preview">👁 Xem trước</button>
      <button class="btn small" data-a="E-dup">⧉ Nhân bản</button>
      <button class="btn small" data-a="E-hist">🕘 Lịch sử</button>
      <button class="btn small" data-a="E-arch">${g.archived ? '↩ Bỏ lưu trữ' : '🗄 Lưu trữ'}</button>
      <button class="btn small ${pub ? '' : 'primary-s'}" data-a="E-pub">${pub ? '🚀 Xuất bản lại' : '🚀 Xuất bản lên TV'}</button>
      ${pub ? '<button class="btn small" data-a="E-unpub">Ẩn khỏi TV</button>' : ''}
    </div>
  </div>
  <div class="ed-tabs">${tab('tree', '🌳 Cấu trúc')}${tab('lesson', '🎬 Bài học')}${tab('lib', '📥 Thêm video')}</div>
  <div class="ed-body pane-${E.pane}">
    <section class="ed-col ed-tree">${edTreeHtml(g)}</section>
    <section class="ed-col ed-lesson">${cur ? edLessonHtml(g, cur.m, cur.l) : '<div class="empty">Chọn một bài ở cột Cấu trúc, hoặc thêm bài mới.</div>'}</section>
    <section class="ed-col ed-lib">${edLibHtml(g, cur)}</section>
  </div>`;
  sortable($('#ed .ed-tree'), 'lesson', () => saveTreeFromDom(g));
  sortable($('#ed .ed-lesson'), 'item', (info) => saveTreeFromDom(g, info));
}

function edTreeHtml(g) {
  const mods = g.modules || [];
  return `<h3 class="ed-h">Chương & bài</h3>
    ${mods.map((m, mi) => `<div class="ed-mod" data-mod="${m.id}">
      <div class="ed-modh"><b>Chương ${mi + 1}.</b> <span class="ed-mt">${esc(m.title)}</span>
        <span class="ed-ctl"><button class="icon-btn" data-a="E-mren" data-id="${m.id}" title="Đổi tên">✎</button><button class="icon-btn" data-a="E-mdel" data-id="${m.id}" title="Xoá chương">🗑</button></span></div>
      <div class="ed-lessons" data-list="lesson" data-mod="${m.id}">
        ${m.lessons.map((l) => `<div class="ed-les ${l.id === E.lesson ? 'on' : ''}" data-drag="lesson" data-id="${l.id}" data-drop-lesson="${l.id}">
          <span class="dh" title="Kéo để sắp xếp">⠿</span>
          <button class="ed-lt" data-a="E-sel" data-id="${l.id}">${esc(l.title || 'Bài chưa đặt tên')}<span class="m"> · ${l.items.length} video</span></button>
          <span class="ed-ctl"><button class="icon-btn" data-a="E-ldup" data-id="${l.id}" title="Nhân bản bài">⧉</button><button class="icon-btn" data-a="E-ldel" data-id="${l.id}" title="Xoá bài">🗑</button></span>
        </div>`).join('') || '<div class="ed-emptyl">Kéo bài vào đây hoặc bấm “+ Bài”.</div>'}
      </div>
      <button class="btn small ed-add" data-a="E-ladd" data-id="${m.id}">+ Bài</button>
    </div>`).join('')}
    <button class="btn small" data-a="E-madd">+ Thêm chương</button>
    <p class="hint">Kéo biểu tượng ⠿ để đổi thứ tự bài hoặc chuyển bài sang chương khác.</p>`;
}

function edLessonHtml(g, m, l) {
  return `<h3 class="ed-h">Bài học</h3>
    <label>Tên bài</label><input class="ed-in" data-f="title" value="${esc(l.title)}" placeholder="Ví dụ: Trái Đất quay quanh Mặt Trời">
    <div class="add"><div style="flex:1"><label>Thời lượng dự kiến (phút)</label><input class="ed-in" data-f="minutes" inputmode="numeric" value="${l.minutes || ''}"></div></div>
    <label>Ghi chú cho bố mẹ</label><input class="ed-in" data-f="note" value="${esc(l.note)}" placeholder="Xem cùng bé, chỉ cho bé…">
    <label>Câu hỏi / nhiệm vụ sau bài</label><input class="ed-in" data-f="task" value="${esc(l.task)}" placeholder="Con kể lại cho bố mẹ nghe…">
    <h3 class="ed-h" style="margin-top:16px">Video trong bài (${l.items.length})</h3>
    <div class="ed-items" data-list="item" data-lesson="${l.id}">
      ${l.items.map((it) => {
        const mv = vmeta(it.video_id);
        return `<div class="ed-item" data-drag="item" data-id="${it.id}">
          <span class="dh" title="Kéo để sắp xếp, hoặc thả vào bài khác ở cột Cấu trúc">⠿</span>
          <img class="th" src="${esc(mv.thumb || thumb(it.video_id))}" alt="" data-a="E-prev" data-vid="${it.video_id}">
          <div class="info"><div class="t">${esc(it.title || mv.title)}</div>
            <div class="m">${esc(mv.channel || '')}${mv.seconds ? ' · ' + lbDur(mv.seconds) : ''}${mv.embed === false ? ' · ⚠ TV không phát được' : ''}</div>
            <div class="ed-iopt">
              <button class="chip ${it.role !== 'extra' ? 'on' : ''}" data-a="E-role" data-id="${it.id}" data-v="main">Video chính</button>
              <button class="chip ${it.role === 'extra' ? 'on' : ''}" data-a="E-role" data-id="${it.id}" data-v="extra">Bổ trợ</button>
              <input class="ed-t" data-id="${it.id}" data-f="start" value="${it.start != null ? lbDur(it.start) || '0:00' : ''}" placeholder="từ 0:00" inputmode="numeric">
              <input class="ed-t" data-id="${it.id}" data-f="end" value="${it.end != null ? lbDur(it.end) : ''}" placeholder="đến hết" inputmode="numeric">
            </div>
            <input class="ed-inote" data-id="${it.id}" data-f="note" value="${esc(it.note || '')}" placeholder="Ghi chú / câu hỏi cho video này"></div>
          <button class="icon-btn" data-a="E-irm" data-id="${it.id}" title="Bỏ khỏi bài">✕</button>
        </div>`;
      }).join('') || '<div class="ed-emptyl">Chưa có video. Thêm ở cột “Thêm video”.</div>'}
    </div>`;
}

function edLibHtml(g, cur) {
  const t = (v, x) => `<button class="chip ${E.lib === v ? 'on' : ''}" data-a="E-lib" data-v="${v}">${x}</button>`;
  const target = cur ? `vào bài “${esc(cur.l.title || 'chưa đặt tên')}”` : 'thành bài mới ở chương cuối';
  const row = (v, inLesson) => `<div class="row"><img class="th" src="${esc(v.thumb || thumb(v.id))}" alt="" data-a="E-prev" data-vid="${v.id}">
      <div class="info"><div class="t" style="font-size:14px">${esc(v.title)}</div><div class="m">${esc(v.channel || '')}${v.seconds ? ' · ' + lbDur(v.seconds) : ''}${v.embed === false ? ' · ⚠ TV không phát được' : ''}</div></div>
      <button class="btn small" data-a="E-add" data-vid="${v.id}" data-title="${esc(v.title)}" ${inLesson || v.embed === false ? 'disabled' : ''}>${inLesson ? '✓' : '➕'}</button></div>`;
  const inL = new Set(cur ? cur.l.items.map((i) => i.video_id) : []);
  let body = '';
  if (E.lib === 'fav') {
    const q = E.q.toLowerCase();
    const list = S.favorites.filter((f) => !q || (f.title + ' ' + (vmeta(f.video_id).channel || '')).toLowerCase().includes(q));
    body = `<input id="ed-fq" placeholder="Lọc yêu thích" value="${esc(E.q)}">` + (list.map((f) => row({ id: f.video_id, title: f.title, ...vmeta(f.video_id) }, inL.has(f.video_id))).join('') || '<div class="empty">Chưa có video yêu thích.</div>');
  } else if (E.lib === 'link') {
    body = `<div class="add"><input id="ed-link" placeholder="Dán link video hoặc playlist YouTube" autocomplete="off"><button class="btn" data-a="E-link">Thêm</button></div>
      <p class="hint">Playlist: thêm tất cả video của playlist (mỗi video một bài mới, hoặc vào bài đang chọn).</p>`;
  } else if (E.lib === 'search') {
    body = `<div class="add"><input id="ed-q" placeholder="Tìm video trên YouTube" value="${esc(E.q)}"><button class="btn" data-a="E-search">Tìm</button></div>
      ${E.busy ? '<div class="empty"><span class="spin"></span></div>' : (E.results || []).map((r) => row(r, inL.has(r.id))).join('')}`;
  } else if (E.lib === 'other') {
    const others = curricula().filter((x) => x.id !== g.id);
    const o = others.find((x) => x.id === E.other) || others[0];
    body = others.length ? `<select id="ed-other">${others.map((x) => `<option value="${x.id}" ${o && o.id === x.id ? 'selected' : ''}>${esc(x.emoji)} ${esc(x.name)}</option>`).join('')}</select>
      ${(o.modules || []).flatMap((m) => m.lessons.flatMap((l) => l.items)).filter((i) => i.video_id).map((i) => row({ id: i.video_id, title: i.title, ...vmeta(i.video_id) }, inL.has(i.video_id))).join('') || '<div class="empty">Giáo trình này chưa có video.</div>'}`
      : '<div class="empty">Chưa có giáo trình khác.</div>';
  } else {
    body = '<div class="empty">🤖 Nhờ AI tìm video và sửa giáo trình bằng lời: “thêm 2 bài về màu sắc”, “đổi video bài này sang tiếng Việt”…<br><br><button class="btn primary" data-a="E-ai">🤖 Sửa bằng AI</button></div>';
  }
  return `<h3 class="ed-h">Thêm video</h3>
    <div class="chips">${t('fav', '❤️ Yêu thích')}${t('link', '🔗 Dán link')}${t('search', '🔎 Tìm')}${t('other', '📚 Giáo trình khác')}${t('ai', '🤖 AI')}</div>
    <p class="hint">Bấm ➕ để thêm ${target}. Video bố mẹ tự thêm được duyệt luôn.</p>${body}`;
}

async function edAddVideos(g, vids) {
  const cur = edLesson(g);
  try {
    if (cur) {
      await rpc('ct_content_add', { p_lesson: cur.l.id, p_videos: vids, p_source: 'parent' });
    } else {
      let mod = (g.modules || []).slice(-1)[0];
      const mid = mod ? mod.id : await rpc('ct_module_save', { p_id: null, p_group: g.id, p_title: 'Chương 1' });
      for (const v of vids) {
        const lid = await rpc('ct_lesson_save', { p_id: null, p_module: mid, p: { title: v.title } });
        await rpc('ct_content_add', { p_lesson: lid, p_videos: [v], p_source: 'parent' });
        E.lesson = lid;
      }
    }
    toast(`Đã thêm ${vids.length} video`);
  } catch (e) { toast(e.message, true); }
  await edReload();
}

async function edSearch() {
  const q = ($('#ed-q') && $('#ed-q').value.trim()) || '';
  if (!q) return;
  E.q = q; E.busy = true; renderEditor();
  try {
    const { data, error } = await sb.functions.invoke('ct-search', { body: { q, type: 'video', lang: 'vi' } });
    if (error) throw new Error(error.message);
    E.results = (data.results || []).map((r) => ({ id: r.id, title: r.title, channel: r.channel, channelId: r.channelId, thumb: r.thumb, seconds: r.seconds, embed: r.embed }));
    rpc('ct_video_meta', { p_videos: E.results }).catch(() => {});
  } catch (e) { toast(e.message, true); }
  E.busy = false; renderEditor();
}

async function edClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a, g = edGroup();
  if (!g) return;
  const id = b.dataset.id;
  if (a === 'E-close') return closeEditor();
  if (a === 'E-ai') return aiChat.open(E.gid, () => edReload());
  if (a === 'E-pane') { E.pane = b.dataset.v; return renderEditor(); }
  if (a === 'E-lib') { E.lib = b.dataset.v; E.q = ''; return renderEditor(); }
  if (a === 'E-sel') { E.lesson = id; E.pane = 'lesson'; return renderEditor(); }
  if (a === 'E-prev') return previewSheet(b.dataset.vid, '', closeSheet);
  if (a === 'E-info') return curInfoSheet(g, () => edReload());
  if (a === 'E-madd') { const t = prompt('Tên chương mới', `Chương ${(g.modules || []).length + 1}`); if (t === null) return; await act(() => rpc('ct_module_save', { p_id: null, p_group: g.id, p_title: t })); return edReload(); }
  if (a === 'E-mren') { const m = g.modules.find((x) => x.id === id); const t = prompt('Đổi tên chương', m.title); if (!t) return; await act(() => rpc('ct_module_save', { p_id: id, p_group: g.id, p_title: t })); return edReload(); }
  if (a === 'E-mdel') { const m = g.modules.find((x) => x.id === id); if (!confirm(`Xoá chương "${m.title}" và ${m.lessons.length} bài trong chương?`)) return; await act(() => rpc('ct_module_delete', { p_id: id })); return edReload(); }
  if (a === 'E-ladd') { const lid = await act(() => rpc('ct_lesson_save', { p_id: null, p_module: id, p: { title: 'Bài mới' } })); if (lid) { E.lesson = lid; E.pane = 'lesson'; } return edReload(); }
  if (a === 'E-ldup') { const lid = await act(() => rpc('ct_lesson_duplicate', { p_id: id }), 'Đã nhân bản bài'); if (lid) E.lesson = lid; return edReload(); }
  if (a === 'E-ldel') { if (!confirm('Xoá bài này và các video trong bài?')) return; await act(() => rpc('ct_lesson_delete', { p_id: id })); if (E.lesson === id) E.lesson = null; return edReload(); }
  if (a === 'E-role') { await act(() => rpc('ct_content_update', { p_item: +id, p: { role: b.dataset.v } })); return edReload(); }
  if (a === 'E-irm') { await act(() => rpc('ct_content_delete', { p_item: +id })); return edReload(); }
  if (a === 'E-add') {
    const vid = b.dataset.vid;
    const v = { id: vid, title: b.dataset.title, ...vmeta(vid), ...((E.results || []).find((r) => r.id === vid) || {}) };
    b.disabled = true;
    return edAddVideos(g, [v]);
  }
  if (a === 'E-link') {
    const url = $('#ed-link').value.trim();
    if (!url) return toast('Hãy dán link YouTube.', true);
    b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    try { const vids = await videosFromLink(url); return edAddVideos(g, vids); }
    catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Thêm'; return; }
  }
  if (a === 'E-search') return edSearch();
  if (a === 'E-preview') return edPreview(g);
  if (a === 'E-dup') { const nid = await act(() => rpc('ct_cur_duplicate', { p_id: g.id }), 'Đã tạo bản sao (bản nháp)'); if (!nid) return; await quietLoad(); return openEditor(nid); }
  if (a === 'E-arch') { await act(() => rpc('ct_cur_archive', { p_id: g.id, p_on: !g.archived }), g.archived ? 'Đã bỏ lưu trữ' : 'Đã lưu trữ (TV không hiện)'); return edReload(); }
  if (a === 'E-pub') {
    const s = curStats(g);
    if (!s.videos) return toast('Giáo trình chưa có video nào.', true);
    const note = prompt('Ghi chú cho lần xuất bản này (không bắt buộc)', '');
    if (note === null) return;
    await act(() => rpc('ct_cur_publish', { p_id: g.id, p_on: true, p_note: note }), 'Đã xuất bản: TV sẽ hiện trong vòng 2 phút');
    return edReload();
  }
  if (a === 'E-unpub') { await act(() => rpc('ct_cur_publish', { p_id: g.id, p_on: false }), 'Đã ẩn khỏi TV (về bản nháp)'); return edReload(); }
  if (a === 'E-hist') {
    const h = await act(() => rpc('ct_cur_revisions', { p_id: g.id }));
    if (!h) return;
    return sheet(`<h3>🕘 Lịch sử xuất bản</h3>${h.length ? h.map((r) => `<div class="row"><div class="info"><div class="t" style="font-size:14px">${new Date(r.created_at).toLocaleString('vi-VN')}</div>
      <div class="m">${r.lessons} bài${r.note ? ' · ' + esc(r.note) : ''}</div></div></div>`).join('') : '<div class="empty">Chưa xuất bản lần nào.</div>'}
      <button class="btn primary" data-a="h-x">Đóng</button>`, () => closeSheet());
  }
}

async function edChange(e) {
  const t = e.target, g = edGroup();
  if (!g) return;
  if (t.id === 'ed-fq') { E.q = t.value; return renderEditor(); }
  if (t.id === 'ed-other') { E.other = t.value; return renderEditor(); }
  if (t.classList.contains('ed-in')) {
    const p = {}; p[t.dataset.f] = t.value.trim();
    await act(() => rpc('ct_lesson_save', { p_id: E.lesson, p_module: null, p }), 'Đã lưu');
    return edReload();
  }
  if (t.classList.contains('ed-t') || t.classList.contains('ed-inote')) {
    const p = {};
    if (t.classList.contains('ed-t')) {
      const v = parseTime(t.value);
      if (t.value.trim() && v === '') return toast('Thời điểm viết dạng phút:giây, ví dụ 1:30', true);
      p[t.dataset.f] = v === '' ? '' : String(v);
    } else p.note = t.value;
    await act(() => rpc('ct_content_update', { p_item: +t.dataset.id, p }), 'Đã lưu');
    return edReload();
  }
}

function edPreview(g) {
  let n = 0;
  const rows = (g.modules || []).map((m, mi) => `<h3 style="margin:14px 0 6px">Chương ${mi + 1}. ${esc(m.title)}</h3>` + m.lessons.map((l) => {
    n++;
    return `<div class="row"><div class="info"><div class="t" style="font-size:14px">Bài ${n}. ${esc(l.title)}</div>
      <div class="m">${l.items.map((i) => `${i.role === 'extra' ? '➕ Bổ trợ' : '▶ Chính'}: ${esc(i.title)}${i.start != null || i.end != null ? ` (${lbDur(i.start || 0) || '0:00'}–${i.end != null ? lbDur(i.end) : 'hết'})` : ''}`).join('<br>') || 'Chưa có video'}</div>
      ${l.task ? `<div class="m">❓ ${esc(l.task)}</div>` : ''}</div></div>`;
  }).join('')).join('');
  sheet(`<h3>👁 Xem trước trên TV</h3>
    <p class="hint" style="margin-top:0">Thứ tự bé sẽ thấy trên TV. ${g.status === 'published' ? 'Đang hiện trên TV.' : 'Bản nháp: TV chưa hiện, bấm <b>Xuất bản lên TV</b> khi xong.'} Video chưa được duyệt sẽ không hiện.</p>
    ${rows || '<div class="empty">Chưa có bài nào.</div>'}<button class="btn primary" data-a="p-x">Đóng</button>`, () => closeSheet());
}

// Đọc thứ tự từ màn hình sau khi kéo thả rồi lưu (ct_tree_save). info.moveTo: thả video vào bài khác ở cột Cấu trúc.
async function saveTreeFromDom(g, info) {
  const lessonsById = {};
  (g.modules || []).forEach((m) => m.lessons.forEach((l) => { lessonsById[l.id] = l.items.map((i) => i.id); }));
  const curList = document.querySelector('#ed .ed-items');
  if (curList) lessonsById[curList.dataset.lesson] = [...curList.querySelectorAll('[data-drag="item"]')].map((x) => +x.dataset.id);
  if (info && info.moveTo && info.item && info.moveTo !== E.lesson) {
    lessonsById[E.lesson] = (lessonsById[E.lesson] || []).filter((x) => x !== info.item);
    lessonsById[info.moveTo] = (lessonsById[info.moveTo] || []).concat([info.item]);
  }
  const tree = [...document.querySelectorAll('#ed .ed-lessons')].map((box) => ({
    id: box.dataset.mod,
    lessons: [...box.querySelectorAll('[data-drag="lesson"]')].map((x) => ({ id: x.dataset.id, items: lessonsById[x.dataset.id] || [] })),
  }));
  await act(() => rpc('ct_tree_save', { p_group: g.id, p: tree }), info && info.moveTo ? 'Đã chuyển video sang bài khác' : 'Đã lưu thứ tự');
  await edReload();
}

// Kéo thả bằng chuột lẫn cảm ứng (Pointer Events), giữ biểu tượng ⠿. type: 'lesson' | 'item'.
function sortable(root, type, onDrop) {
  if (!root) return;
  root.addEventListener('pointerdown', (ev) => {
    const h = ev.target.closest('.dh');
    if (!h) return;
    const item = h.closest(`[data-drag="${type}"]`);
    if (!item) return;
    ev.preventDefault();
    const r = item.getBoundingClientRect(), dy = ev.clientY - r.top;
    const ph = document.createElement('div');
    ph.className = 'ed-ph';
    ph.style.height = r.height + 'px';
    item.parentNode.insertBefore(ph, item);
    item.classList.add('dragging');
    Object.assign(item.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', zIndex: 1000, pointerEvents: 'none' });
    let dropLesson = null, scrollBox = item.closest('.ed-col') || root;
    const move = (e) => {
      item.style.top = (e.clientY - dy) + 'px';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      document.querySelectorAll('.ed-les.drop').forEach((x) => x.classList.remove('drop'));
      dropLesson = null;
      if (!under) return;
      if (type === 'item') {
        const les = under.closest('[data-drop-lesson]');
        if (les && les.dataset.dropLesson !== E.lesson) { les.classList.add('drop'); dropLesson = les.dataset.dropLesson; return; }
      }
      const list = under.closest(`[data-list="${type}"]`);
      if (list) {
        const sibs = [...list.querySelectorAll(`[data-drag="${type}"]:not(.dragging)`)];
        const next = sibs.find((s) => { const b = s.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
        if (next) list.insertBefore(ph, next); else list.appendChild(ph);
        const empty = list.querySelector('.ed-emptyl'); if (empty) empty.remove();
      }
      const sb2 = scrollBox.getBoundingClientRect();
      if (e.clientY < sb2.top + 40) scrollBox.scrollTop -= 12; else if (e.clientY > sb2.bottom - 40) scrollBox.scrollTop += 12;
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      document.querySelectorAll('.ed-les.drop').forEach((x) => x.classList.remove('drop'));
      item.removeAttribute('style');
      item.classList.remove('dragging');
      ph.parentNode.insertBefore(item, ph);
      ph.remove();
      onDrop(dropLesson ? { moveTo: dropLesson, item: +item.dataset.id } : null);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
}

// ---------- Hồ sơ các bé (Cài đặt) ----------
const KID_EMOJI = ['🧒', '👦', '👧', '👶', '🧑', '🐣', '🦄', '🐻'];
function childSheet(c) {
  let emoji = c ? c.emoji : '🧒';
  sheet(`<h3>${c ? 'Sửa hồ sơ' : 'Thêm hồ sơ bé'}</h3>
    <label>Tên bé</label><input id="ch-name" value="${esc(c ? c.name : '')}" placeholder="Ví dụ: Bin">
    <label>Biểu tượng</label><div class="emoji-pick">${KID_EMOJI.map((e) => `<button data-a="ch-e" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
    <label>Ngày sinh (để gợi ý theo tuổi)</label><input id="ch-birth" type="date" value="${c && c.birth ? c.birth : ''}">
    <button class="btn primary" data-a="ch-save">${c ? 'Lưu' : 'Thêm'}</button>
    ${c ? '<button class="btn link danger" data-a="ch-del">Xoá hồ sơ (giáo trình của bé chuyển về Cả nhà)</button>' : ''}`,
  async (a, b) => {
    if (a === 'ch-e') { emoji = b.textContent; document.querySelectorAll('.emoji-pick button').forEach((x) => x.classList.toggle('on', x === b)); return; }
    if (a === 'ch-save') { const id = await act(() => rpc('ct_child_save', { p_id: c ? c.id : null, p: { name: $('#ch-name').value, emoji, birth: $('#ch-birth').value } }), 'Đã lưu'); if (!id) return; closeSheet(); return load(); }
    if (a === 'ch-del') { if (!confirm(`Xoá hồ sơ ${c.name}?`)) return; await act(() => rpc('ct_child_delete', { p_id: c.id }), 'Đã xoá'); closeSheet(); return load(); }
  });
}
const _viewSettings = viewSettings;
viewSettings = function () {
  const kids = S.children || [];
  const html = `<h2>👧 Hồ sơ các bé<button class="btn small" data-a="L-kidnew">+ Thêm bé</button></h2>
  <div class="card">
    ${kids.length ? kids.map((k) => `<div class="row tap" data-a="L-kid" data-id="${k.id}"><div class="av">${esc(k.emoji)}</div><div class="info"><div class="t">${esc(k.name)}</div><div class="m">${ageOf(k.birth) || 'Chưa nhập ngày sinh'}</div></div><span class="m">›</span></div>`).join('')
      : '<div class="empty">Chưa có hồ sơ. Mỗi bé một hồ sơ để giáo trình và TV hiện đúng cho từng bé; không tạo thì cả nhà dùng chung.</div>'}
    ${S.tvs.length ? `<label>TV xem theo hồ sơ</label>${S.tvs.map((t) => `<div class="add" style="align-items:center"><span class="lb-tvname" style="flex:1">📺 ${esc(t.name)}</span>
      <select data-a="L-tvchild" data-tv="${t.id}"><option value="">👨‍👩‍👧 Cả nhà (mọi giáo trình)</option>${kids.map((k) => `<option value="${k.id}" ${t.child_id === k.id ? 'selected' : ''}>${esc(k.emoji)} ${esc(k.name)}</option>`).join('')}</select></div>`).join('')}
      <div class="hint">Chọn một bé: TV chỉ hiện giáo trình của bé đó và giáo trình “Cả nhà”.</div>` : ''}
  </div>`;
  return html + _viewSettings();
};

// ---------- Bắt sự kiện trên màn hình chính (#view) ----------
$('#view').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a^="L-"]');
  if (!b) return;
  const a = b.dataset.a, vid = b.dataset.vid;
  const fav = vid && S.favorites.find((f) => f.video_id === vid);
  if (a === 'L-seg') { L.seg = b.dataset.v; return render(); }
  if (a === 'L-child') { L.child = b.dataset.v; return render(); }
  if (a === 'L-arch') { L.showArchived = !L.showArchived; return render(); }
  if (a === 'L-ai') return aiChat.open();
  if (a === 'L-new') return curInfoSheet(null, (id) => openEditor(id));
  if (a === 'L-edit') return openEditor(b.dataset.id);
  if (a === 'L-fcol') { L.fcol = b.dataset.v; return render(); }
  if (a === 'L-fcolnew') return collectionEdit(null, (id) => { L.fcol = id || ''; closeSheet(); render(); });
  if (a === 'L-fcoledit') return collectionEdit((S.fav_collections || []).find((c) => c.id === L.fcol), () => { closeSheet(); render(); });
  if (a === 'L-pick') { e.preventDefault(); if (L.picked.has(vid)) L.picked.delete(vid); else L.picked.add(vid); return render(); }
  if (a === 'L-bulknone') { L.picked.clear(); return render(); }
  const picked = () => [...L.picked].map((id) => { const f = S.favorites.find((x) => x.video_id === id); return { id, title: f ? f.title : '' }; });
  if (a === 'L-bulkadd') return addToCurriculumSheet(picked(), () => { L.picked.clear(); closeSheet(); render(); });
  if (a === 'L-bulkcol') return collectionsSheet(picked(), () => { closeSheet(); render(); });
  if (a === 'L-fprev') return previewSheet(vid, fav && fav.title);
  if (a === 'L-fadd') return addToCurriculumSheet([{ id: vid, title: fav.title }], () => { closeSheet(); render(); });
  if (a === 'L-fcols') return collectionsSheet([{ id: vid, title: fav.title }], () => { closeSheet(); render(); });
  if (a === 'L-fedit') return favEditSheet(fav);
  if (a === 'L-fok') { await act(() => rpc('ct_approve', { p_videos: [vid], p_on: true }), 'Đã duyệt: video sẽ lên TV ở mục Yêu thích'); return load(); }
  if (a === 'L-funfav') { if (!confirm('Bỏ yêu thích video này?')) return; await act(() => rpc('ct_favorite', { p_video: vid, p_title: '', p_on: false })); return load(); }
  if (a === 'L-flink') {
    const url = $('#lf-link').value.trim();
    if (!url) return toast('Hãy dán link YouTube.', true);
    b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    try {
      const vids = await videosFromLink(url);
      for (const v of vids) await rpc('ct_fav_update', { p_video: v.id, p: { title: v.title } });
      await rpc('ct_video_meta', { p_videos: vids });
      if (L.fcol) await rpc('ct_fcol_items', { p_col: L.fcol, p_videos: vids, p_on: true });
      toast(`Đã lưu ${vids.length} video vào yêu thích`);
      return load();
    } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Lưu'; }
  }
  if (a === 'L-kidnew') return childSheet(null);
  if (a === 'L-kid') return childSheet((S.children || []).find((k) => k.id === b.dataset.id));
});
$('#view').addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.a === 'L-tvchild') { await act(() => rpc('ct_tv_set_child', { p_tv: t.dataset.tv, p_child: t.value || null }), 'Đã lưu: TV cập nhật trong vòng 2 phút'); return quietLoad(); }
  if (t.id === 'lf-sub') { L.fsub = t.value; return render(); }
  if (t.id === 'lf-age') { L.fage = t.value; return render(); }
  if (t.id === 'lf-sort') { L.fsort = t.value; return render(); }
  if (t.id === 'lf-q') { L.fq = t.value; return render(); }
});
// Giáo trình (collection) mở trình soạn mới; playlist/chủ đề vẫn dùng trình soạn cũ.
const _openGroupEditor = openGroupEditor;
openGroupEditor = function (gid, keep) {
  const g = S.groups.find((x) => x.id === gid);
  if (g && g.kind === 'collection' && g.modules) { closeSheet(); return openEditor(gid); }
  return _openGroupEditor(gid, keep);
};
