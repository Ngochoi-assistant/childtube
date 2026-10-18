// Lập giáo trình theo mong muốn của bố mẹ:
//   1) Bảng mô tả: bé là ai, bố mẹ muốn gì, học thế nào  →  2) Khung giáo trình (tuần / ngày / lĩnh vực)
//   →  3) Điền video cho từng ô của khung (có sẵn bài đã chọn lọc, đổi bằng tìm YouTube)  →  4) Tạo giáo trình.
// Dùng chung hàm của app.js: sheet, closeSheet, $, esc, thumb, clock, toast, act, rpc, load, sb, S, openGroupEditor.

const WZ_KEY = 'ct_wiz';
const WZ_DEF = { name: '', age: 4, know: [], goals: [], values: [], note: '', mins: 20, days: 5, weeks: 2, lang: 'vi', avoid: ['remix'], locked: false };
const WZ_AGES = [[2, '1–2 tuổi'], [3, '3 tuổi'], [4, '4 tuổi'], [5, '5 tuổi'], [6, '6 tuổi'], [7, '7–8 tuổi']];
const WZ_KNOW = [['chu', 'Nhận mặt chữ cái'], ['dem', 'Đếm đến 10'], ['anh', 'Biết vài từ tiếng Anh'], ['tuphuc', 'Tự rửa tay, đánh răng']];
const WZ_VALUES = ['Tự tin', 'Lễ phép', 'Biết ơn', 'Chia sẻ', 'Bình tĩnh', 'Tự lập', 'Tò mò', 'Kiên nhẫn', 'Sáng tạo'];
const WZ_AVOID = [['remix', 'Nhạc remix, quá ồn'], ['long', 'Video dài trên 10 phút']];
const WZ_PERDAY = { 10: 1, 20: 2, 30: 3 };
let wz = { ...WZ_DEF };
try { Object.assign(wz, JSON.parse(localStorage.getItem(WZ_KEY) || '{}')); } catch (e) { /* dùng mặc định */ }
let fw = null, plan = [], wzToken = 0;

async function loadFramework() {
  if (fw) return fw;
  const r = await fetch('framework.json?v=' + (window.CT_TPL_V || ''), { cache: 'no-cache' });
  if (!r.ok) throw new Error('Không tải được dữ liệu giáo trình.');
  fw = await r.json();
  return fw;
}
const wzSave = () => { try { localStorage.setItem(WZ_KEY, JSON.stringify(wz)); } catch (e) { /* bỏ qua */ } };
const wzTotal = () => Math.min(48, wz.weeks * wz.days * WZ_PERDAY[wz.mins]);
const wzDomain = (id) => (fw.domains.find((d) => d.id === id) || { emoji: '📁', name: '' });
const wzChips = (list, isOn, a) => list.map(([v, l]) => `<button class="chip ${isOn(v) ? 'on' : ''}" data-a="${a}" data-v="${esc(v)}">${esc(l)}</button>`).join('');
const wzToggle = (arr, v, max) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else if (!max || arr.length < max) arr.push(v); };

// Mở trình lập giáo trình (bước 1).
async function wzOpen() {
  sheet('<h3>Lập giáo trình</h3><div class="empty"><span class="spin"></span></div>');
  try { await loadFramework(); } catch (e) { toast(e.message, true); return closeSheet(); }
  wzStep(1);
}

function wzKeepScroll(fn) { const b = $('.sheet-box'), y = b ? b.scrollTop : 0; fn(); const b2 = $('.sheet-box'); if (b2) b2.scrollTop = y; }
function wzReadInputs() {
  if ($('#wz-name')) wz.name = $('#wz-name').value.trim().slice(0, 30);
  if ($('#wz-note')) wz.note = $('#wz-note').value.trim().slice(0, 200);
}
const wzDots = (n) => `<div class="wz-dots">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;

function wzStep(n) {
  wzSave();
  const next = n < 3 ? 'wnext' : 'wbuild';
  const nextLabel = n < 3 ? 'Tiếp tục' : `Lập khung giáo trình (${wzTotal()} bài)`;
  let body = '';
  if (n === 1) {
    body = `<h3>Bé của bạn</h3><div class="hint" style="margin-top:0">Bước 1/3 · Để giáo trình đúng với bé</div>
      <label>Tên bé (không bắt buộc)</label><input id="wz-name" value="${esc(wz.name)}" placeholder="Ví dụ: Na" maxlength="30">
      <label>Bé mấy tuổi?</label><div class="chips">${wzChips(WZ_AGES, (v) => wz.age === +v, 'wage')}</div>
      <label>Bé đã biết (chọn nếu có, để bỏ qua phần cơ bản)</label><div class="chips">${wzChips(WZ_KNOW, (v) => wz.know.includes(v), 'wknow')}</div>
      <label>Ngôn ngữ cho bé xem</label><div class="chips">${wzChips([['vi', 'Chủ yếu tiếng Việt'], ['both', 'Tiếng Việt + tiếng Anh']], (v) => wz.lang === v, 'wlang')}</div>`;
  } else if (n === 2) {
    const rank = (id) => wz.goals.indexOf(id) + 1;
    body = `<h3>Bố mẹ mong muốn gì?</h3><div class="hint" style="margin-top:0">Bước 2/3 · Chọn tối đa 3 mục, theo thứ tự quan trọng (số 1 được học nhiều nhất)</div>
      <div class="goal-grid">${fw.domains.map((d) => `<button class="goal ${rank(d.id) ? 'on' : ''}" data-a="wgoal" data-v="${d.id}"><span class="e">${d.emoji}</span><span>${esc(d.name)}</span>${rank(d.id) ? `<b class="rk">${rank(d.id)}</b>` : ''}</button>`).join('')}</div>
      <label>Bố mẹ muốn bé hình thành phẩm chất nào? (không bắt buộc)</label>
      <div class="chips">${wzChips(WZ_VALUES.map((v) => [v, v]), (v) => wz.values.includes(v), 'wval')}</div>
      <label>Điều khác bố mẹ muốn gửi gắm (không bắt buộc)</label>
      <textarea id="wz-note" rows="3" maxlength="200" placeholder="Ví dụ: bé hay nhút nhát, bố mẹ muốn bé mạnh dạn hơn">${esc(wz.note)}</textarea>`;
  } else {
    body = `<h3>Cách học</h3><div class="hint" style="margin-top:0">Bước 3/3 · Phù hợp thời gian của gia đình</div>
      <label>Mỗi ngày cho bé xem</label><div class="chips">${wzChips([[10, '10 phút'], [20, '20 phút'], [30, '30 phút']], (v) => wz.mins === +v, 'wmins')}</div>
      <label>Số ngày học mỗi tuần</label><div class="chips">${wzChips([[3, '3 ngày'], [5, '5 ngày'], [7, '7 ngày']], (v) => wz.days === +v, 'wdays')}</div>
      <label>Giáo trình kéo dài</label><div class="chips">${wzChips([[1, '1 tuần'], [2, '2 tuần'], [4, '4 tuần']], (v) => wz.weeks === +v, 'wweeks')}</div>
      <label>Bố mẹ muốn tránh</label><div class="chips">${wzChips(WZ_AVOID, (v) => wz.avoid.includes(v), 'wavoid')}</div>
      <div class="switch" style="margin-top:6px"><input type="checkbox" id="wz-locked" ${wz.locked ? 'checked' : ''}><label for="wz-locked" style="margin:0;color:var(--ink)">Học theo thứ tự: xong bài này mới mở bài sau</label></div>`;
  }
  const canNext = n !== 2 || wz.goals.length > 0;
  sheet(`${wzDots(n)}${body}
    <button class="btn primary" data-a="${next}" ${canNext ? '' : 'disabled'}>${nextLabel}</button>
    ${n > 1 ? '<button class="btn link" data-a="wback">← Quay lại</button>' : ''}`,
  (a, b) => {
    wzReadInputs();
    const redo = () => wzKeepScroll(() => wzStep(n));
    if (a === 'wage') { wz.age = +b.dataset.v; return redo(); }
    if (a === 'wknow') { wzToggle(wz.know, b.dataset.v); return redo(); }
    if (a === 'wlang') { wz.lang = b.dataset.v; return redo(); }
    if (a === 'wgoal') { wzToggle(wz.goals, b.dataset.v, 3); return redo(); }
    if (a === 'wval') { wzToggle(wz.values, b.dataset.v); return redo(); }
    if (a === 'wmins') { wz.mins = +b.dataset.v; return redo(); }
    if (a === 'wdays') { wz.days = +b.dataset.v; return redo(); }
    if (a === 'wweeks') { wz.weeks = +b.dataset.v; return redo(); }
    if (a === 'wavoid') { wzToggle(wz.avoid, b.dataset.v); return redo(); }
    if (a === 'wback') return n === 1 ? openCreate() : wzStep(n - 1);
    if (a === 'wnext') return wzStep(n + 1);
    if (a === 'wbuild') { wz.locked = !!($('#wz-locked') && $('#wz-locked').checked); wzSave(); return wzBuild(); }
  });
  const lk = $('#wz-locked'); if (lk) lk.addEventListener('change', () => { wz.locked = lk.checked; });
}

// ---------- Dựng khung ----------
const WZ_LOUD = /remix|sôi động|liên khúc|nhạc sàn/i;
const wzSkip = (s) => (wz.know.includes('chu') && s.t === 'chu-cai-viet' && s.i < 3)
  || (wz.know.includes('dem') && s.t === 'dem-so' && s.i < 3)
  || (wz.know.includes('anh') && s.t === 'tieng-anh-phonics' && s.i < 2)
  || (wz.know.includes('tuphuc') && s.t === 'thoi-quen-tot' && s.i < 2);

function wzPool(d) {
  const age = wz.age;
  return fw.slots.filter((s) => s.d === d && s.a[0] <= age + 0.99 && s.a[1] >= age && !wzSkip(s)
    && !(wz.lang === 'vi' && d !== 'anh' && s.l === 'en'))
    .sort((x, y) => x.a[0] - y.a[0]);
}
// Lấy q bài từ danh sách, chia đều theo từng chủ đề nhỏ, giữ thứ tự trong chủ đề.
function wzSpread(pool, q) {
  const groups = [];
  for (const s of pool) { let g = groups.find((x) => x.t === s.t); if (!g) groups.push(g = { t: s.t, items: [], i: 0 }); g.items.push(s); }
  const take = Math.max(1, Math.ceil(q / (groups.length || 1))), out = [];
  for (const g of groups) while (g.i < Math.min(take, g.items.length) && out.length < q) out.push(g.items[g.i++]);
  for (const g of groups) while (g.i < g.items.length && out.length < q) out.push(g.items[g.i++]);
  return out;
}
function wzBadVideo(v) {
  if (!v) return true;
  if (wz.avoid.includes('remix') && WZ_LOUD.test(v.title || '')) return true;
  if (wz.avoid.includes('long') && v.seconds > 600) return true;
  return false;
}

function wzBuild() {
  const N = wzTotal(), perWeek = wz.days * WZ_PERDAY[wz.mins];
  const goals = wz.goals.map((d, i) => ({ d, w: [3, 2, 1][i] }));
  if (wz.values.length && !goals.some((g) => g.d === 'camxuc')) goals.push({ d: 'camxuc', w: 0.7, bonus: true });
  const sum = goals.reduce((n, g) => n + g.w, 0);
  goals.forEach((g) => { g.pool = wzPool(g.d); g.q = Math.min(g.pool.length, Math.max(1, Math.round(N * g.w / sum))); });
  // Chia lại phần dư cho mục ưu tiên cao còn bài.
  let total = goals.reduce((n, g) => n + g.q, 0);
  for (let guard = 0; total < N && guard < 200; guard++) {
    const g = goals.find((x) => x.q < x.pool.length && !x.bonus) || goals.find((x) => x.q < x.pool.length);
    if (!g) break; g.q++; total++;
  }
  while (total > N) { const g = [...goals].reverse().find((x) => x.q > 1) || goals[0]; g.q--; total--; }
  goals.forEach((g) => { g.items = wzSpread(g.pool, g.q); g.n = 0; });
  // Xen kẽ các lĩnh vực đều trong từng tuần.
  const seq = [];
  while (seq.length < total) {
    const g = goals.filter((x) => x.n < x.items.length).sort((a, b) => (a.n / a.items.length) - (b.n / b.items.length))[0];
    if (!g) break; seq.push(g.items[g.n++]);
  }
  plan = seq.map((s, k) => ({ s, v: wzBadVideo(s.v) ? null : s.v, week: Math.floor(k / perWeek) + 1, day: Math.floor((k % perWeek) / WZ_PERDAY[wz.mins]) + 1, tried: false }));
  wzReview();
  wzFill();
}

// ---------- Màn hình khung giáo trình ----------
function wzSummary() {
  const goals = wz.goals.map((d, i) => `${i + 1}. ${wzDomain(d).emoji} ${wzDomain(d).name}`).join(' · ');
  return `${wz.name ? 'Bé ' + wz.name + ' · ' : ''}${wz.age >= 7 ? '7–8' : wz.age === 2 ? '1–2' : wz.age} tuổi · ${wz.mins} phút/ngày · ${wz.days} ngày/tuần · ${wz.weeks} tuần<br>Ưu tiên: ${goals}`;
}
function wzRow(p, i) {
  const d = wzDomain(p.s.d);
  const img = p.v ? `<a href="https://www.youtube.com/watch?v=${p.v.id}" target="_blank" rel="noopener"><img class="th" src="${thumb(p.v.id)}" alt="" loading="lazy" decoding="async"></a>` : '<div class="th"></div>';
  const title = p.v ? esc(p.v.title) : (p.tried ? '<span class="pend">Chưa tìm được video, bấm ↻ để tìm</span>' : '<span class="spin"></span> Đang tìm video…');
  return `<div class="row wz-row" data-i="${i}">${img}
    <div class="info"><div class="m">${d.emoji} ${esc(p.s.tn)}</div><div class="t" style="font-size:14px">${title}</div>${p.v ? `<div class="m">${esc(p.v.channel)}${p.v.seconds ? ' · ' + clock(p.v.seconds) : ''}</div>` : ''}</div>
    <div class="ctl"><button class="icon-btn" data-a="wswap" title="Đổi video">↻</button><button class="icon-btn" data-a="wdrop" title="Bỏ bài này">✕</button></div></div>`;
}
function wzReview() {
  const weeks = {};
  plan.forEach((p, i) => { ((weeks[p.week] = weeks[p.week] || {})[p.day] = weeks[p.week][p.day] || []).push([p, i]); });
  const defName = wz.name ? `Giáo trình của bé ${wz.name}` : 'Giáo trình của bé';
  sheet(`<h3>Khung giáo trình</h3><div class="hint wz-sum" style="margin-top:0">${wzSummary()}</div>
    ${Object.keys(weeks).map((w) => `<h2 style="margin:14px 2px 4px">Tuần ${w}</h2><div class="card" style="padding:4px 10px">${Object.keys(weeks[w]).map((dd) => `<div class="wz-day">Ngày ${dd}</div>${weeks[w][dd].map(([p, i]) => wzRow(p, i)).join('')}`).join('')}</div>`).join('')}
    ${plan.length ? '' : '<div class="empty">Không còn bài nào. Hãy quay lại chọn lại.</div>'}
    <label>Tên giáo trình</label><input id="wz-gname" value="${esc(defName)}" maxlength="40">
    <button class="btn primary" data-a="wcreate" ${plan.length ? '' : 'disabled'}>Tạo giáo trình (${plan.length} bài)</button>
    <button class="btn link" data-a="wback3">← Chỉnh lại mong muốn</button>`,
  async (a, b) => {
    if (a === 'wback3') { wzToken++; return wzStep(3); }
    const i = b && b.closest('.wz-row') ? +b.closest('.wz-row').dataset.i : -1;
    if (a === 'wdrop') { plan.splice(i, 1); return wzKeepScroll(() => { const g = $('#wz-gname') && $('#wz-gname').value; wzReview(); if (g && $('#wz-gname')) $('#wz-gname').value = g; }); }
    if (a === 'wswap') return wzSwap(i);
    if (a === 'wcreate') return wzCreate();
  });
}
function wzPaintRow(i) {
  const el = $(`.wz-row[data-i="${i}"]`);
  if (el && plan[i]) el.outerHTML = wzRow(plan[i], i);
}

// ---------- Tìm video cho ô còn trống (tuần tự để không bị YouTube chặn) ----------
async function wzSearch(q, lang) {
  const { data, error } = await sb.functions.invoke('ct-search', { body: { q, type: 'video', lang } });
  if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (e) { /* giữ */ } throw new Error(m); }
  return data.results || [];
}
async function wzFill() {
  const token = ++wzToken;
  for (let i = 0; i < plan.length; i++) {
    if (token !== wzToken || $('#sheet').classList.contains('hidden')) return;
    const p = plan[i];
    if (p.v || p.tried) continue;
    p.tried = true;
    try {
      const used = new Set(plan.map((x) => x.v && x.v.id));
      const res = (await wzSearch(p.s.q, p.s.l)).filter((r) => r.embed !== false && !used.has(r.id) && r.seconds >= 45 && r.seconds <= Math.max(p.s.mx, 300) * 1.3
        && !wzBadVideo({ title: r.title, seconds: r.seconds }));
      if (res[0]) p.v = { id: res[0].id, title: res[0].title, channel: res[0].channel, seconds: res[0].seconds };
    } catch (e) { /* để trống, bố mẹ bấm ↻ */ }
    if (token === wzToken) wzPaintRow(plan.indexOf(p));
    await new Promise((r) => setTimeout(r, 800));
  }
}

// Đổi video cho một ô bằng cách tìm trên YouTube.
async function wzSwap(i, q) {
  const p = plan[i]; if (!p) return;
  wzToken++;
  const query = q || p.s.q;
  sheet(`<h3>Chọn video khác</h3><form class="add" onsubmit="return false"><input id="wz-q" value="${esc(query)}" enterkeyhint="search"><button class="btn" data-a="wq" type="button">Tìm</button></form>
    <div id="wz-res" class="empty"><span class="spin"></span></div><button class="btn link" data-a="wback4">← Quay lại khung</button>`,
  (a, b) => {
    if (a === 'wback4') return wzBack();
    if (a === 'wq') return wzSwap(i, $('#wz-q').value.trim() || query);
    if (a === 'wpick') {
      const r = JSON.parse(decodeURIComponent(b.dataset.r));
      p.v = r; p.tried = true; return wzBack();
    }
  });
  try {
    const res = (await wzSearch(query, p.s.l)).filter((r) => r.embed !== false);
    $('#wz-res').className = '';
    $('#wz-res').innerHTML = res.length ? '<div class="card">' + res.map((r) => `<div class="row"><a href="https://www.youtube.com/watch?v=${r.id}" target="_blank" rel="noopener"><img class="th" src="${thumb(r.id)}" alt="" loading="lazy" decoding="async"></a>
      <div class="info"><div class="t" style="font-size:14px">${esc(r.title)}</div><div class="m">${esc(r.channel)} · ${esc(r.durationText)}</div></div>
      <button class="btn small" data-a="wpick" data-r="${encodeURIComponent(JSON.stringify({ id: r.id, title: r.title, channel: r.channel, seconds: r.seconds }))}">Chọn</button></div>`).join('') + '</div>' : 'Không có kết quả. Thử từ khoá khác.';
  } catch (e) { $('#wz-res').textContent = e.message; }
}
function wzBack() { wzReview(); wzFill(); }

// ---------- Tạo giáo trình ----------
async function wzCreate() {
  const vids = []; const seen = new Set();
  for (const p of plan) if (p.v && !seen.has(p.v.id)) { seen.add(p.v.id); vids.push({ id: p.v.id, title: p.v.title }); }
  if (!vids.length) return toast('Chưa có video nào để thêm.', true);
  const name = ($('#wz-gname') && $('#wz-gname').value.trim()) || 'Giáo trình của bé';
  const goals = wz.goals.map((d) => wzDomain(d).name).join(', ');
  const note = [`${wz.name ? 'Bé ' + wz.name + ', ' : ''}${wz.age >= 7 ? '7–8' : wz.age === 2 ? '1–2' : wz.age} tuổi.`, `Ưu tiên: ${goals}.`,
    wz.values.length ? `Mong bé: ${wz.values.join(', ').toLowerCase()}.` : '', wz.note ? wz.note + '.' : '', `${wz.mins} phút/ngày, ${wz.days} ngày/tuần, ${wz.weeks} tuần.`].filter(Boolean).join(' ').slice(0, 490);
  try {
    wzToken++;
    const gid = await rpc('ct_group_save', { p_id: null, p_kind: 'collection', p_name: name, p_emoji: wzDomain(wz.goals[0]).emoji });
    await rpc('ct_group_update', { p_id: gid, p: { numbered: true, locked: !!wz.locked, note } });
    await rpc('ct_group_add_videos', { p_group: gid, p_videos: vids });
    toast(`Đã tạo «${name}» với ${vids.length} bài`);
    await load();
    openGroupEditor(gid);
  } catch (e) { toast(e.message, true); }
}
