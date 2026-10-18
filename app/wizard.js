// Lập giáo trình theo hồ sơ của bé. Chuỗi suy luận:
//   Hồ sơ bé (tính nết, điểm mạnh, cần hỗ trợ, sở thích, năng lực hiện tại, mong muốn của bố mẹ)
//   → Khung năng lực (6 lĩnh vực)  → Lộ trình 3 giai đoạn  → Giáo trình theo tuần/ngày  → Gắn video.
// Dùng chung hàm của app.js: sheet, closeSheet, $, esc, thumb, clock, toast, rpc, load, sb, openGroupEditor.

const WZ_KEY = 'ct_wiz2';
const WZ_DEF = { name: '', age: 4, lang: 'vi', traits: {}, strengths: [], needs: [], interests: [], ans: {}, goals: [], values: [], note: '',
  mins: 20, days: 5, weeks: 2, avoid: [], locked: false };
const WZ_AGES = [[2, '1–2 tuổi'], [3, '3 tuổi'], [4, '4 tuổi'], [5, '5 tuổi'], [6, '6 tuổi'], [7, '7–8 tuổi']];
const WZ_VALUES = ['Tự tin', 'Lễ phép', 'Biết ơn', 'Chia sẻ', 'Bình tĩnh', 'Tự lập', 'Tò mò', 'Kiên nhẫn', 'Sáng tạo'];
const WZ_AVOID = [['remix', 'Nhạc remix, quá ồn'], ['long', 'Video dài trên 10 phút']];
const WZ_PERDAY = { 10: 1, 20: 2, 30: 3 };
const WZ_STEPS = 6;
const WZ_LEVEL = ['low', 'mid', 'high'];
let wz = { ...WZ_DEF };
try { Object.assign(wz, JSON.parse(localStorage.getItem(WZ_KEY) || '{}')); } catch (e) { /* mặc định */ }
let fw = null, cp = null, plan = [], roadmap = [], wzToken = 0;

async function wzLoadJson(name) {
  const r = await fetch(name + '?v=' + (window.CT_TPL_V || ''), { cache: 'no-cache' });
  if (!r.ok) throw new Error('Không tải được dữ liệu giáo trình.');
  return r.json();
}
async function wzLoadAll() { if (!fw) fw = await wzLoadJson('framework.json'); if (!cp) cp = await wzLoadJson('competency.json'); }
const wzSave = () => { try { localStorage.setItem(WZ_KEY, JSON.stringify(wz)); } catch (e) { /* bỏ qua */ } };
const wzTotal = () => Math.min(60, wz.weeks * wz.days * WZ_PERDAY[wz.mins]);
const wzDom = (id) => (cp.domains.find((d) => d.id === id) || fw.domains.find((d) => d.id === id) || { emoji: '📁', name: '', short: '' });
const wzChips = (list, isOn, a, extra = '') => list.map(([v, l]) => `<button class="chip ${isOn(v) ? 'on' : ''}" data-a="${a}" ${extra} data-v="${esc(v)}">${esc(l)}</button>`).join('');
const wzToggle = (arr, v, max) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else if (!max || arr.length < max) arr.push(v); };
const wzAgeText = () => (wz.age === 2 ? '1–2' : wz.age >= 7 ? '7–8' : wz.age) + ' tuổi';
const wzBabyName = () => (wz.name ? 'bé ' + wz.name : 'bé');

// Cờ tính nết → điều chỉnh giáo trình.
function wzFlags() {
  const t = wz.traits;
  return {
    hiAct: t.act === 'high' || wz.needs.includes('itvd'),
    shortAtt: t.focus === 'low' || t.pers === 'low' || wz.needs.includes('xao'),
    cautious: t.appr === 'low' || wz.needs.includes('rutre'),
    rigid: t.adapt === 'low',
    calm: t.inten === 'high' || t.sens === 'high' || t.mood === 'low',
  };
}

async function wzOpen() {
  sheet('<h3>Lập giáo trình</h3><div class="empty"><span class="spin"></span></div>');
  try { await wzLoadAll(); } catch (e) { toast(e.message, true); return closeSheet(); }
  wzStep(1);
}
function wzKeepScroll(fn) { const b = $('.sheet-box'), y = b ? b.scrollTop : 0; fn(); const b2 = $('.sheet-box'); if (b2) b2.scrollTop = y; }
function wzReadInputs() {
  if ($('#wz-name')) wz.name = $('#wz-name').value.trim().slice(0, 30);
  if ($('#wz-note')) wz.note = $('#wz-note').value.trim().slice(0, 200);
}
const wzDots = (n) => `<div class="wz-dots">${Array.from({ length: WZ_STEPS }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;

// Các năng lực quan sát được phù hợp tuổi (tối đa 4 mỗi lĩnh vực, gần tuổi bé nhất).
function wzItems() {
  const age = wz.age;
  const ok = (it) => !(it.needs === 'both' && wz.lang !== 'both');
  return cp.domains.map((d) => {
    let list = cp.items.filter((it) => it.d === d.id && ok(it));
    const near = (w) => list.filter((it) => it.a >= age - w && it.a <= age + w);
    let pick = near(1); if (pick.length < 2) pick = near(2); if (pick.length < 2) pick = list;
    pick = pick.sort((x, y) => Math.abs(x.a - age) - Math.abs(y.a - age) || x.a - y.a).slice(0, 4).sort((x, y) => x.a - y.a);
    return { d, items: pick };
  }).filter((g) => g.items.length);
}

// ---------- 6 bước nhập hồ sơ ----------
function wzStep(n) {
  wzSave();
  let body = '';
  if (n === 1) {
    body = `<h3>Bé của bạn</h3><div class="hint wz-sub">Bước 1/${WZ_STEPS} · Thông tin cơ bản</div>
      <label>Tên bé (không bắt buộc)</label><input id="wz-name" value="${esc(wz.name)}" placeholder="Ví dụ: Na" maxlength="30">
      <label>Bé mấy tuổi?</label><div class="chips">${wzChips(WZ_AGES, (v) => wz.age === +v, 'wage')}</div>
      <label>Ngôn ngữ cho bé xem</label><div class="chips">${wzChips([['vi', 'Chủ yếu tiếng Việt'], ['both', 'Tiếng Việt + tiếng Anh']], (v) => wz.lang === v, 'wlang')}</div>`;
  } else if (n === 2) {
    body = `<h3>Tính nết của bé</h3><div class="hint wz-sub">Bước 2/${WZ_STEPS} · Không có đúng sai, mỗi bé một khác. Chọn mức gần đúng nhất, bỏ qua câu chưa chắc.</div>
      ${cp.traits.map((t) => `<div class="wz-q" data-id="${t.id}"><label>${esc(t.q)}</label><div class="chips wz-opts">${t.opts.map((o, i) => `<button class="chip ${wz.traits[t.id] === WZ_LEVEL[i] ? 'on' : ''}" data-a="wtrait" data-id="${t.id}" data-v="${WZ_LEVEL[i]}">${esc(o)}</button>`).join('')}</div></div>`).join('')}`;
  } else if (n === 3) {
    body = `<h3>Điểm mạnh và sở thích</h3><div class="hint wz-sub">Bước 3/${WZ_STEPS} · Dùng điểm mạnh làm đòn bẩy để bé tự tin hơn</div>
      <label>Bé có điểm mạnh nào? (tối đa 4)</label><div class="chips">${wzChips(cp.strengths.map((s) => [s.id, s.label]), (v) => wz.strengths.includes(v), 'wstr')}</div>
      <label>Bé cần được hỗ trợ thêm điều gì? (tối đa 3)</label><div class="chips">${wzChips(cp.needs.map((s) => [s.id, s.label]), (v) => wz.needs.includes(v), 'wneed')}</div>
      <label>Bé đang mê chủ đề nào? (tối đa 2, mỗi tuần có một video theo chủ đề này)</label><div class="chips">${wzChips(cp.interests.map((s) => [s[0], s[0]]), (v) => wz.interests.includes(v), 'wint')}</div>`;
  } else if (n === 4) {
    const groups = wzItems();
    body = `<h3>Bé đang làm được gì?</h3><div class="hint wz-sub">Bước 4/${WZ_STEPS} · Quan sát bé trong tuần qua. Bỏ qua điều chưa rõ.</div>
      ${groups.map((g) => `<h2 class="wz-dom">${g.d.emoji} ${esc(g.d.name)}</h2><div class="card wz-card">${g.items.map((it) => `<div class="wz-q" data-id="${it.id}"><div class="wz-t">${esc(it.t)}</div>
        <div class="chips wz-opts">${[['0', 'Chưa'], ['1', 'Đang tập'], ['2', 'Làm tốt']].map(([v, l]) => `<button class="chip ${String(wz.ans[it.id]) === v ? 'on' : ''}" data-a="wans" data-id="${it.id}" data-v="${v}">${l}</button>`).join('')}</div></div>`).join('')}</div>`).join('')}`;
  } else if (n === 5) {
    const rank = (id) => wz.goals.indexOf(id) + 1;
    body = `<h3>Bố mẹ mong muốn gì?</h3><div class="hint wz-sub">Bước 5/${WZ_STEPS} · Chọn tối đa 3 lĩnh vực muốn ưu tiên, theo thứ tự (số 1 quan trọng nhất)</div>
      <div class="goal-grid">${cp.domains.map((d) => `<button class="goal ${rank(d.id) ? 'on' : ''}" data-a="wgoal" data-v="${d.id}"><span class="e">${d.emoji}</span><span>${esc(d.name)}</span>${rank(d.id) ? `<b class="rk">${rank(d.id)}</b>` : ''}</button>`).join('')}</div>
      <label>Bố mẹ mong bé hình thành phẩm chất nào? (không bắt buộc)</label>
      <div class="chips">${wzChips(WZ_VALUES.map((v) => [v, v]), (v) => wz.values.includes(v), 'wval')}</div>
      <label>Điều khác bố mẹ muốn gửi gắm (không bắt buộc)</label>
      <textarea id="wz-note" rows="3" maxlength="200" placeholder="Ví dụ: sắp vào lớp 1, bố mẹ muốn bé tự tin đọc chữ">${esc(wz.note)}</textarea>`;
  } else {
    body = `<h3>Cách học</h3><div class="hint wz-sub">Bước 6/${WZ_STEPS} · Phù hợp thời gian của gia đình</div>
      <label>Mỗi ngày cho bé xem</label><div class="chips">${wzChips([[10, '10 phút'], [20, '20 phút'], [30, '30 phút']], (v) => wz.mins === +v, 'wmins')}</div>
      <label>Số ngày học mỗi tuần</label><div class="chips">${wzChips([[3, '3 ngày'], [5, '5 ngày'], [7, '7 ngày']], (v) => wz.days === +v, 'wdays')}</div>
      <label>Lộ trình kéo dài</label><div class="chips">${wzChips([[2, '2 tuần'], [4, '4 tuần'], [8, '8 tuần']], (v) => wz.weeks === +v, 'wweeks')}</div>
      <label>Bố mẹ muốn tránh</label><div class="chips">${wzChips(WZ_AVOID, (v) => wz.avoid.includes(v), 'wavoid')}</div>
      <div class="switch" style="margin-top:6px"><input type="checkbox" id="wz-locked" ${wz.locked ? 'checked' : ''}><label for="wz-locked" style="margin:0;color:var(--ink)">Học theo thứ tự: xong bài này mới mở bài sau</label></div>`;
  }
  const canNext = n !== 5 || wz.goals.length > 0;
  const nextLabel = n < WZ_STEPS ? 'Tiếp tục' : 'Xem hồ sơ năng lực của bé';
  sheet(`${wzDots(n)}${body}
    <button class="btn primary" data-a="wnext" ${canNext ? '' : 'disabled'}>${nextLabel}</button>
    ${n > 1 ? '<button class="btn link" data-a="wback">← Quay lại</button>' : '<button class="btn link" data-a="wback">← Chọn cách tạo khác</button>'}`,
  (a, b) => {
    wzReadInputs();
    const redo = () => wzKeepScroll(() => wzStep(n));
    const mark = (sel, on) => { document.querySelectorAll(sel).forEach((x) => x.classList.toggle('on', x === on)); };
    if (a === 'wage') { wz.age = +b.dataset.v; wz.ans = {}; return redo(); }
    if (a === 'wlang') { wz.lang = b.dataset.v; return redo(); }
    if (a === 'wtrait') { const same = wz.traits[b.dataset.id] === b.dataset.v; if (same) delete wz.traits[b.dataset.id]; else wz.traits[b.dataset.id] = b.dataset.v; return mark(`.wz-q[data-id="${b.dataset.id}"] .chip`, same ? null : b); }
    if (a === 'wans') { const same = String(wz.ans[b.dataset.id]) === b.dataset.v; if (same) delete wz.ans[b.dataset.id]; else wz.ans[b.dataset.id] = +b.dataset.v; return mark(`.wz-q[data-id="${b.dataset.id}"] .chip`, same ? null : b); }
    if (a === 'wstr') { wzToggle(wz.strengths, b.dataset.v, 4); return redo(); }
    if (a === 'wneed') { wzToggle(wz.needs, b.dataset.v, 3); return redo(); }
    if (a === 'wint') { wzToggle(wz.interests, b.dataset.v, 2); return redo(); }
    if (a === 'wgoal') { wzToggle(wz.goals, b.dataset.v, 3); return redo(); }
    if (a === 'wval') { wzToggle(wz.values, b.dataset.v); return redo(); }
    if (a === 'wmins') { wz.mins = +b.dataset.v; return redo(); }
    if (a === 'wdays') { wz.days = +b.dataset.v; return redo(); }
    if (a === 'wweeks') { wz.weeks = +b.dataset.v; return redo(); }
    if (a === 'wavoid') { wzToggle(wz.avoid, b.dataset.v); return redo(); }
    if (a === 'wback') return n === 1 ? openCreate() : wzStep(n - 1);
    if (a === 'wnext') { if (n === WZ_STEPS) { wz.locked = !!($('#wz-locked') && $('#wz-locked').checked); wzSave(); return wzProfile(); } return wzStep(n + 1); }
  });
  const lk = $('#wz-locked'); if (lk) lk.addEventListener('change', () => { wz.locked = lk.checked; });
}

// ---------- Khung năng lực: điểm từng lĩnh vực ----------
function wzScores() {
  return wzItems().map((g) => {
    const ans = g.items.filter((it) => wz.ans[it.id] !== undefined);
    const pct = ans.length ? Math.round(ans.reduce((n, it) => n + wz.ans[it.id], 0) / (2 * ans.length) * 100) : null;
    const lv = pct === null ? null : cp.levels.find((l) => pct >= l.min);
    return { d: g.d, items: g.items, pct, lv, n: ans.length };
  });
}
function wzProfile() {
  const scores = wzScores();
  const flags = wzFlags();
  const tips = cp.traits.map((t) => { const v = wz.traits[t.id]; return v && t.tip[v] ? t.tip[v] : ''; }).filter(Boolean);
  const labelOf = (list, id) => (list.find((x) => x.id === id) || {}).label;
  sheet(`<h3>Hồ sơ năng lực của ${esc(wzBabyName())}</h3><div class="hint wz-sub">${wzAgeText()} · khung 6 lĩnh vực phát triển</div>
    <div class="card wz-card">${scores.map((s) => `<div class="wz-bar"><div class="wz-bar-h"><span>${s.d.emoji} ${esc(s.d.name)}</span><b class="lv${s.lv ? ' ' + (s.pct >= 75 ? 'ok' : s.pct >= 40 ? 'mid' : 'low') : ''}">${s.lv ? esc(s.lv.name) : 'Chưa đánh giá'}</b></div>
      <div class="bar"><i style="width:${s.pct === null ? 0 : Math.max(s.pct, 6)}%"></i></div></div>`).join('')}</div>
    ${wz.strengths.length ? `<label>Điểm mạnh</label><div class="chips">${wz.strengths.map((id) => `<span class="chip on">${esc(labelOf(cp.strengths, id))}</span>`).join('')}</div>` : ''}
    ${wz.needs.length ? `<label>Cần hỗ trợ thêm</label><div class="chips">${wz.needs.map((id) => `<span class="chip">${esc(labelOf(cp.needs, id))}</span>`).join('')}</div>` : ''}
    ${tips.length ? `<label>Cách đồng hành hợp với tính nết của bé</label><ul class="wz-tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${flags.shortAtt || flags.hiAct || flags.cautious || flags.rigid || flags.calm ? '<div class="hint">Giáo trình sẽ được điều chỉnh theo các điểm trên.</div>' : ''}
    <div class="hint">Đây là gợi ý để bố mẹ tham khảo, không phải đánh giá chuyên môn. Nếu lo lắng về sự phát triển của bé, hãy trao đổi với bác sĩ.</div>
    <button class="btn primary" data-a="wroad">Xem lộ trình phát triển</button>
    <button class="btn link" data-a="wback6">← Chỉnh lại hồ sơ</button>`,
  (a) => { if (a === 'wback6') return wzStep(WZ_STEPS); if (a === 'wroad') return wzRoadmapView(); });
}

// ---------- Lộ trình: 3 giai đoạn ----------
function wzRoadmapCalc() {
  const age = wz.age, items = wzItems().flatMap((g) => g.items);
  const goalBoost = (d) => { const i = wz.goals.indexOf(d); return i < 0 ? 0 : [1.5, 1, 0.5][i]; };
  const needDoms = wz.needs.map((id) => (cp.needs.find((n) => n.id === id) || {}).dom).filter(Boolean);
  const sc = (it) => (wz.ans[it.id] === undefined ? 1 : wz.ans[it.id]);
  const w = (it) => (2 - sc(it)) + goalBoost(it.d) + (it.bank.some((b) => needDoms.includes(b)) ? 0.7 : 0);
  const byW = (x, y) => w(y) - w(x) || x.a - y.a;
  const taken = new Set();
  const take = (list, n) => { const out = []; for (const it of list) { if (out.length >= n) break; if (!taken.has(it.id)) { taken.add(it.id); out.push(it); } } return out; };
  const s1 = take(items.filter((it) => sc(it) === 0 && it.a <= age + 0.5).sort(byW), 4);
  const s2 = take(items.filter((it) => sc(it) === 1 && it.a <= age + 0.5).sort(byW), 4);
  const next = cp.items.filter((it) => it.a > age && it.a <= age + 1.5 && !(it.needs === 'both' && wz.lang !== 'both') && (wz.goals.includes(it.d) || sc(it) < 2));
  const s3 = take([...items.filter((it) => sc(it) < 2 && (wz.goals.includes(it.d) || it.a > age)).sort(byW), ...next.sort(byW)], 4);
  const stages = [
    { n: 1, name: 'Nền tảng', sub: 'Việc vừa sức bé chưa làm được', comps: s1 },
    { n: 2, name: 'Củng cố', sub: 'Việc bé đang tập, luyện cho vững', comps: s2 },
    { n: 3, name: 'Mở rộng', sub: 'Mục tiêu bố mẹ ưu tiên và mức cao hơn', comps: s3 },
  ];
  // Giai đoạn trống: lấy bớt từ năng lực còn lại để lộ trình luôn có nội dung.
  const rest = items.filter((it) => !taken.has(it.id)).sort(byW);
  for (const st of stages) if (!st.comps.length) st.comps = take(rest, 3);
  return stages.filter((s) => s.comps.length);
}

// ---------- Dựng giáo trình từ lộ trình ----------
const WZ_LOUD = /remix|sôi động|liên khúc|nhạc sàn/i;
const wzAvoidLoud = () => wz.avoid.includes('remix') || wzFlags().calm;
function wzBadVideo(v) {
  if (!v) return true;
  if (wzAvoidLoud() && WZ_LOUD.test(v.title || '')) return true;
  if (wz.avoid.includes('long') && v.seconds > 600) return true;
  if (wzFlags().shortAtt && v.seconds > 540) return true;
  return false;
}
function wzPool(d) {
  const age = wz.age;
  return fw.slots.filter((s) => s.d === d && s.a[0] <= age + 0.99 && s.a[1] >= age && !(wz.lang === 'vi' && d !== 'anh' && s.l === 'en'))
    .sort((x, y) => x.a[0] - y.a[0]);
}

function wzBuildPlan() {
  fw.slots.forEach((s) => { delete s._u; });
  const pools = {};
  const pool = (d) => pools[d] || (pools[d] = wzPool(d));
  const take = (d, pref) => {
    const p = pool(d); let i = pref ? p.findIndex((s) => !s._u && pref.includes(s.t)) : -1;
    if (i < 0) i = p.findIndex((s) => !s._u);
    if (i < 0) return null; p[i]._u = true; return p[i];
  };
  const flags = wzFlags(), perDay = WZ_PERDAY[wz.mins], perWeek = wz.days * perDay, N = wzTotal(), W = Math.ceil(N / perWeek);
  roadmap = wzRoadmapCalc();

  // Phần thưởng mỗi tuần: điểm mạnh, sở thích, khởi động quen (bé rụt rè), vận động (bé nhiều năng lượng).
  const bonusOf = (w) => {
    const out = [];
    const sd = wz.strengths.map((id) => cp.strengths.find((x) => x.id === id)).filter((x) => x && x.dom);
    if (flags.cautious) { const s = take('nhac'); if (s) out.push({ pos: 'first', s, goal: 'Khởi động bằng bài hát quen thuộc' }); }
    if (flags.hiAct) { const s = take('vandong'); if (s) out.push({ pos: 'mid', s, goal: 'Vận động cho bé nhiều năng lượng' }); }
    if (sd.length) { const st = sd[(w - 1) % sd.length], s = take(st.dom); if (s) out.push({ pos: 'late', s, goal: 'Điểm mạnh của bé: ' + st.label.toLowerCase() }); }
    if (wz.interests.length) {
      const it = cp.interests.find((x) => x[0] === wz.interests[(w - 1) % wz.interests.length]);
      if (it) out.push({ pos: 'last', s: { d: 'sothich', t: 'sothich', tn: it[0], a: [0, 99], q: it[1] + ' cho bé', l: 'vi', mn: 90, mx: 480, v: null }, goal: 'Chủ đề bé thích: ' + it[0].toLowerCase() });
    }
    return out.slice(0, Math.max(0, Math.min(4, perWeek - 2)));
  };
  const bonus = []; for (let w = 1; w <= W; w++) bonus[w] = bonusOf(w);
  const mainN = Math.max(0, N - bonus.reduce((n, b) => n + (b ? b.length : 0), 0));

  // Chia phần chính theo giai đoạn, rồi theo lĩnh vực kho video của các năng lực trong giai đoạn.
  const goalW = (d) => { const i = wz.goals.indexOf(d); return i < 0 ? 0 : [1.5, 1, 0.5][i]; };
  const stages = roadmap.map((st) => {
    const dw = {};
    st.comps.forEach((c) => c.bank.forEach((d) => { dw[d] = (dw[d] || 0) + 1 + goalW(c.d); }));
    return { st, dw, doms: Object.keys(dw) };
  });
  const live = stages.filter((x) => x.doms.length);
  const main = [];
  live.forEach((x, si) => {
    const q = Math.round(mainN / live.length) + (si === live.length - 1 ? mainN - Math.round(mainN / live.length) * live.length : 0);
    const sum = x.doms.reduce((n, d) => n + x.dw[d], 0);
    const lists = x.doms.map((d) => ({ d, q: Math.max(1, Math.round(q * x.dw[d] / sum)), items: [], rr: 0 }));
    let tot = lists.reduce((n, l) => n + l.q, 0); while (tot > q && lists.some((l) => l.q > 1)) { lists.filter((l) => l.q > 1).sort((a, b) => a.q - b.q).pop().q--; tot--; }
    lists.forEach((l) => {
      const comps = x.st.comps.filter((c) => c.bank.includes(l.d));
      for (let k = 0; k < l.q; k++) {
        const c = comps[k % comps.length], s = take(l.d, c.tpl);
        if (!s) break; l.items.push({ s, goal: c.t, comp: c.id, stage: x.st.n });
      }
    });
    if (flags.rigid) lists.forEach((l) => main.push(...l.items));
    else { let more = true; while (more) { more = false; lists.forEach((l) => { if (l.rr < l.items.length) { main.push(l.items[l.rr++]); more = true; } }); } }
  });

  // Xếp vào tuần – ngày.
  const out = []; let mi = 0;
  for (let w = 1; w <= W; w++) {
    const left = Math.min(perWeek, N - (w - 1) * perWeek), bs = bonus[w] || [];
    const pick = (pos) => bs.filter((b) => b.pos === pos);
    const mainCount = Math.max(0, left - bs.length), chunk = main.slice(mi, mi + mainCount); mi += mainCount;
    const mid = Math.floor(chunk.length / 2);
    const week = [...pick('first'), ...chunk.slice(0, mid), ...pick('mid'), ...chunk.slice(mid), ...pick('late'), ...pick('last')];
    week.forEach((it, k) => out.push({ s: it.s, v: wzBadVideo(it.s.v) ? null : it.s.v, week: w, day: Math.floor(k / perDay) + 1, goal: it.goal || it.s.tn, stage: it.stage || 0, tried: false }));
  }
  plan = out;
}

function wzRoadmapView() {
  wzBuildPlan();
  const weeksOf = (n) => { const ws = plan.filter((p) => p.stage === n).map((p) => p.week); return ws.length ? (Math.min(...ws) === Math.max(...ws) ? `Tuần ${ws[0]}` : `Tuần ${Math.min(...ws)}–${Math.max(...ws)}`) : ''; };
  const countOf = (n) => plan.filter((p) => p.stage === n).length;
  const bonusN = plan.filter((p) => !p.stage).length;
  sheet(`<h3>Lộ trình của ${esc(wzBabyName())}</h3><div class="hint wz-sub">${wzAgeText()} · ${plan.length} bài trong ${Math.max(...plan.map((p) => p.week), 1)} tuần · ${wz.mins} phút/ngày</div>
    ${roadmap.map((st) => `<div class="card wz-stage"><div class="wz-stage-h"><b>Giai đoạn ${st.n} · ${esc(st.name)}</b><span class="m">${weeksOf(st.n)}</span></div>
      <div class="hint" style="margin:2px 0 8px">${esc(st.sub)}</div>
      ${st.comps.map((c) => `<div class="wz-goal">${wzDom(c.d).emoji} ${esc(c.t)}</div>`).join('')}
      <div class="wz-tipbox"><b>Làm cùng bé (ngoài màn hình)</b>${st.comps.filter((c) => c.tip).slice(0, 3).map((c) => `<div>• ${esc(c.tip)}</div>`).join('')}</div>
      <div class="m" style="margin-top:6px">🎬 ${countOf(st.n)} video${st.comps.every((c) => !c.bank.length) ? ' · giai đoạn này chủ yếu là hoạt động cùng bé' : ''}</div></div>`).join('')}
    ${bonusN ? `<div class="hint">Cộng thêm ${bonusN} video theo điểm mạnh, sở thích và tính nết của bé, rải đều mỗi tuần.</div>` : ''}
    <button class="btn primary" data-a="wmake" ${plan.length ? '' : 'disabled'}>Lập giáo trình (${plan.length} bài)</button>
    <button class="btn link" data-a="wbackp">← Hồ sơ năng lực</button>`,
  (a) => { if (a === 'wbackp') return wzProfile(); if (a === 'wmake') { wzReview(); wzFill(); } });
}

// ---------- Giáo trình theo tuần / ngày ----------
function wzRow(p, i) {
  const img = p.v ? `<a href="https://www.youtube.com/watch?v=${p.v.id}" target="_blank" rel="noopener"><img class="th" src="${thumb(p.v.id)}" alt="" loading="lazy" decoding="async"></a>` : '<div class="th"></div>';
  const title = p.v ? esc(p.v.title) : (p.tried ? '<span class="pend">Chưa tìm được video, bấm ↻ để tìm</span>' : '<span class="spin"></span> Đang tìm video…');
  return `<div class="row wz-row" data-i="${i}">${img}
    <div class="info"><div class="m">🎯 ${esc(p.goal)}</div><div class="t" style="font-size:14px">${title}</div>${p.v ? `<div class="m">${esc(p.v.channel)}${p.v.seconds ? ' · ' + clock(p.v.seconds) : ''}</div>` : ''}</div>
    <div class="ctl"><button class="icon-btn" data-a="wswap" title="Đổi video">↻</button><button class="icon-btn" data-a="wdrop" title="Bỏ bài này">✕</button></div></div>`;
}
function wzReview() {
  const weeks = {};
  plan.forEach((p, i) => { ((weeks[p.week] = weeks[p.week] || {})[p.day] = weeks[p.week][p.day] || []).push([p, i]); });
  const defName = wz.name ? `Giáo trình của bé ${wz.name}` : 'Giáo trình của bé';
  sheet(`<h3>Giáo trình</h3><div class="hint wz-sub">Mỗi bài gắn với một mục tiêu trong lộ trình. Xem thử, đổi (↻) hoặc bỏ (✕) trước khi tạo.</div>
    ${Object.keys(weeks).map((w) => `<h2 style="margin:14px 2px 4px">Tuần ${w}</h2><div class="card" style="padding:4px 10px">${Object.keys(weeks[w]).map((dd) => `<div class="wz-day">Ngày ${dd}</div>${weeks[w][dd].map(([p, i]) => wzRow(p, i)).join('')}`).join('')}</div>`).join('')}
    ${plan.length ? '' : '<div class="empty">Không còn bài nào.</div>'}
    <label>Tên giáo trình</label><input id="wz-gname" value="${esc(defName)}" maxlength="40">
    <button class="btn primary" data-a="wcreate" ${plan.length ? '' : 'disabled'}>Tạo giáo trình (${plan.length} bài)</button>
    <button class="btn link" data-a="wback3">← Lộ trình</button>`,
  async (a, b) => {
    if (a === 'wback3') { wzToken++; return wzRoadmapView(); }
    const i = b && b.closest('.wz-row') ? +b.closest('.wz-row').dataset.i : -1;
    if (a === 'wdrop') { plan.splice(i, 1); return wzKeepScroll(() => { const g = $('#wz-gname') && $('#wz-gname').value; wzReview(); if (g && $('#wz-gname')) $('#wz-gname').value = g; }); }
    if (a === 'wswap') return wzSwap(i);
    if (a === 'wcreate') return wzCreate();
  });
}
function wzPaintRow(i) { const el = $(`.wz-row[data-i="${i}"]`); if (el && plan[i]) el.outerHTML = wzRow(plan[i], i); }

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
async function wzSwap(i, q) {
  const p = plan[i]; if (!p) return;
  wzToken++;
  const query = q || p.s.q;
  sheet(`<h3>Chọn video khác</h3><div class="hint wz-sub">🎯 ${esc(p.goal)}</div><form class="add" onsubmit="return false"><input id="wz-q" value="${esc(query)}" enterkeyhint="search"><button class="btn" data-a="wq" type="button">Tìm</button></form>
    <div id="wz-res" class="empty"><span class="spin"></span></div><button class="btn link" data-a="wback4">← Quay lại giáo trình</button>`,
  (a, b) => {
    if (a === 'wback4') return wzBack();
    if (a === 'wq') return wzSwap(i, $('#wz-q').value.trim() || query);
    if (a === 'wpick') { p.v = JSON.parse(decodeURIComponent(b.dataset.r)); p.tried = true; return wzBack(); }
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
  const lab = (list, id) => ((list.find((x) => x.id === id) || {}).label || '').toLowerCase();
  const note = [`${wz.name ? 'Bé ' + wz.name + ', ' : ''}${wzAgeText()}.`,
    wz.goals.length ? `Ưu tiên: ${wz.goals.map((d) => wzDom(d).short || wzDom(d).name).join(', ')}.` : '',
    wz.strengths.length ? `Điểm mạnh: ${wz.strengths.map((id) => lab(cp.strengths, id)).join(', ')}.` : '',
    wz.needs.length ? `Cần hỗ trợ: ${wz.needs.map((id) => lab(cp.needs, id)).join(', ')}.` : '',
    wz.values.length ? `Mong bé: ${wz.values.join(', ').toLowerCase()}.` : '', wz.note ? wz.note + '.' : '',
    `${wz.mins} phút/ngày, ${wz.days} ngày/tuần.`].filter(Boolean).join(' ').slice(0, 490);
  try {
    wzToken++;
    const gid = await rpc('ct_group_save', { p_id: null, p_kind: 'collection', p_name: name, p_emoji: wz.goals.length ? wzDom(wz.goals[0]).emoji : '🧭' });
    await rpc('ct_group_update', { p_id: gid, p: { numbered: true, locked: !!wz.locked, note } });
    await rpc('ct_group_add_videos', { p_group: gid, p_videos: vids });
    toast(`Đã tạo «${name}» với ${vids.length} bài`);
    await load();
    openGroupEditor(gid);
  } catch (e) { toast(e.message, true); }
}
