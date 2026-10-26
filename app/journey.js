// ChildTube — Hành trình của bé (bản đồ kiểu game), dùng chung cho tab Học → Lộ trình và tab Kỷ niệm.
// Cùng dữ liệu với TV (ct_tv_feed): ⭐ điều bé ĐÃ LÀM ĐƯỢC = mục ghi "Cột mốc"/"Thành tích" + mốc năm nay đã xong;
// 🎯 phía trước = mốc năm nay chưa xong + năng lực nên tập theo tuổi (khung năng lực 6 lĩnh vực).
// Bấm "Bé làm được rồi" trên một chấm phía trước → ghi Cột mốc (mức Gia đình) → chấm sáng ⭐ trên điện thoại và trên TV.
const Journey = {
  comp: null, cache: {},
  LEVELS: ['Hạt mầm', 'Chồi non', 'Lá xanh', 'Cây nhỏ', 'Nhà thám hiểm', 'Ngôi sao nhỏ', 'Siêu sao'],
  level(n) { const lv = Math.min(this.LEVELS.length, Math.floor(n / 3) + 1); return { lv, name: this.LEVELS[lv - 1], pct: (n % 3) / 3 * 100, left: 3 - n % 3 }; },
  day(d) { const x = String(d || '').slice(0, 10).split('-'); return x.length === 3 ? `${+x[2]}/${+x[1]}/${x[0]}` : ''; },
  async loadComp() {
    if (this.comp) return this.comp;
    try { this.comp = await (await fetch('competency.json', { cache: 'no-cache' })).json(); } catch (e) { this.comp = { items: [], domains: [] }; }
    return this.comp;
  },
  // Gom dữ liệu của một bé: thành tích, mốc kế hoạch, gợi ý theo tuổi
  async load(k) {
    const [mile, ach, rm, comp] = await Promise.all([
      rpc('ct_journal_list', { p_child: k.id, p_kind: 'milestone' }), rpc('ct_journal_list', { p_child: k.id, p_kind: 'achievement' }),
      rpc('ct_roadmap', { p_child: k.id }), this.loadComp()]);
    const wins = mile.concat(ach).filter((e) => e.privacy === 'family' || !e.privacy).map((e) => {
      const img = (e.media || []).find((m) => m.url && /^image\/(jpeg|png|webp|gif)/.test(m.mime));
      return { id: e.id, kind: e.kind, title: e.title || e.body || 'Điều mới', text: e.title ? e.body : '', day: e.day, by: e.author ? e.author.name : '', photo: img ? mediaUrl(img.url) : '' };
    });
    for (const m of rm.milestones || []) if (m.status === 'done' && !wins.some((w) => w.title === m.title)) wins.push({ id: m.id, kind: 'milestone', title: m.title, day: m.due_on || '', by: '', photo: '', plan: true });
    wins.sort((a, b) => String(b.day).localeCompare(String(a.day)));
    const age = rm.child && rm.child.age != null ? Math.max(2, Math.min(7, rm.child.age)) : 4;
    const seen = new Set(wins.map((w) => w.title.toLowerCase()));
    const goals = (rm.milestones || []).filter((m) => m.status !== 'done').map((m) => ({ t: 'goal', title: m.title, due: m.due_on, doing: m.status === 'doing', mid: m.id }));
    const items = (comp.items || []).filter((x) => x.needs !== 'both' && x.a > age - 1 && x.a <= age + 1.5 && !seen.has(x.t.toLowerCase())).sort((a, b) => a.a - b.a);
    for (const x of items) { if (goals.length >= 5) break; goals.push({ t: 'goal', title: x.t, tip: x.tip, dom: x.d }); }
    return (this.cache[k.id] = { wins, goals: goals.slice(0, 5), age, kid: k });
  },
  nodes(d) {
    const past = d.wins.slice(0, 6).reverse(), n = [];
    if (!past.length) n.push({ t: 'start', title: 'Bắt đầu hành trình' });
    past.forEach((w) => n.push({ t: 'win', w, title: w.title }));
    n.push({ t: 'now', title: 'Bé đang ở đây' });
    return n.concat(d.goals, [{ t: 'end', title: 'Đích đến' }]);
  },
  // Bản đồ dọc cho điện thoại: đường uốn lượn từ trên xuống, nhãn nằm bên phía rộng hơn
  svg(d) {
    const ns = this.nodes(d), W = 360, top = 50, gap = 92, H = top * 2 + gap * (ns.length - 1), cx = (i) => 180 + 70 * Math.sin(i * 0.95 + 0.3);
    const pts = ns.map((_, i) => [cx(i), top + i * gap]);
    let path = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; path += ` C${x0} ${y0 + gap / 2} ${x1} ${y1 - gap / 2} ${x1} ${y1}`; }
    const nowI = ns.findIndex((x) => x.t === 'now');
    let walked = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i <= nowI; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; walked += ` C${x0} ${y0 + gap / 2} ${x1} ${y1 - gap / 2} ${x1} ${y1}`; }
    let out = `<path d="${path}" fill="none" stroke="var(--jr-road)" stroke-width="22" stroke-linecap="round"/>
      <path d="${path}" fill="none" stroke="var(--jr-dash)" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/>
      ${nowI > 0 ? `<path d="${walked}" fill="none" stroke="url(#jrg)" stroke-width="22" stroke-linecap="round"/>` : ''}`;
    ns.forEach((nd, i) => {
      const [x, y] = pts[i], r = nd.t === 'now' ? 30 : 22, right = x < 180;
      const look = { win: ['#ffd60a', nd.w && nd.w.kind === 'achievement' ? '🏆' : '⭐'], now: ['#fff', d.kid.emoji || '🧒'], goal: ['var(--jr-goal)', nd.doing ? '◐' : '🎯'], end: ['var(--jr-goal)', '🏁'], start: ['#30d158', '🚩'] }[nd.t];
      if (nd.t === 'now') out += `<circle cx="${x}" cy="${y}" r="${r + 6}" fill="none" stroke="#ff453a" stroke-width="4"><animate attributeName="r" values="${r + 3};${r + 12};${r + 3}" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;.2;1" dur="2.4s" repeatCount="indefinite"/></circle>`;
      out += `<g class="jr-node" data-a="J-node" data-i="${i}"><circle cx="${x}" cy="${y}" r="${r + 10}" fill="transparent"/>
        <circle cx="${x}" cy="${y}" r="${r}" fill="${look[0]}"${nd.t === 'goal' ? ' stroke="var(--jr-dash)" stroke-width="2" stroke-dasharray="5 5"' : ''}${nd.t === 'now' ? ' stroke="#ff453a" stroke-width="3"' : ''}/>
        <text x="${x}" y="${y + r * 0.36}" text-anchor="middle" font-size="${Math.round(r * 1.05)}">${esc(look[1])}</text>
        <text x="${right ? x + r + 10 : x - r - 10}" y="${y - (nd.t === 'win' ? 3 : -5)}" text-anchor="${right ? 'start' : 'end'}" class="jr-l ${nd.t}">${esc(nd.title.length > 22 ? nd.title.slice(0, 21) + '…' : nd.title)}</text>
        ${nd.t === 'win' && nd.w.day ? `<text x="${right ? x + r + 10 : x - r - 10}" y="${y + 15}" text-anchor="${right ? 'start' : 'end'}" class="jr-d">${this.day(nd.w.day)}</text>` : ''}</g>`;
    });
    return `<svg class="jr-svg" viewBox="0 0 ${W} ${H}" width="100%" style="overflow:visible"><defs><linearGradient id="jrg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd60a"/><stop offset="1" stop-color="#30d158"/></linearGradient></defs>${out}</svg>`;
  },
  hud(d) {
    const L = this.level(d.wins.length);
    return `<div class="jr-hud"><span class="jr-lv">Cấp ${L.lv} · ${L.name}</span><span class="jr-xp"><i style="width:${L.pct}%"></i></span><span class="jr-left">⭐ ${d.wins.length} · còn ${L.left} lên cấp</span></div>`;
  },
  // Thẻ thành tích ngang (dùng ở tab Kỷ niệm)
  cards(d, max = 6) {
    if (!d.wins.length) return '';
    return `<div class="jr-cards">${d.wins.slice(0, max).map((w, i) => `<button class="jr-card c${i % 5}" data-a="J-win" data-id="${esc(w.id)}">
      ${w.photo ? `<img src="${esc(w.photo)}" alt="" loading="lazy">` : ''}<span class="jr-badge">${w.kind === 'achievement' ? '🏆' : '⭐'}</span>${i === 0 ? '<span class="jr-new">MỚI</span>' : ''}
      <b>${esc(w.title)}</b><em>${this.day(w.day)}${w.by ? ' · ' + esc(w.by) : ''}</em></button>`).join('')}</div>`;
  },
  block(d, withCards) {
    return `<div class="card jr">${this.hud(d)}${withCards ? this.cards(d) : ''}${this.svg(d)}
      <div class="hint" style="text-align:center">Chạm vào một chấm để xem. Chấm 🎯 → bấm “Bé làm được rồi” để thắp sáng ⭐ (TV cũng hiện).</div></div>`;
  },
  // Chạm chấm → bảng chi tiết
  open(k, i, done) {
    const d = this.cache[k.id]; if (!d) return;
    const nd = this.nodes(d)[i]; if (!nd) return;
    if (nd.t === 'win') return this.winSheet(nd.w);
    if (nd.t !== 'goal') return;
    sheet(`<div class="jr-sh"><div class="jr-big goal">🎯</div><span class="jr-tag">${nd.doing ? 'Đang tập' : 'Mốc tiếp theo'}</span><h3>${esc(nd.title)}</h3>
      ${nd.due ? `<div class="hint">Hẹn đạt: ${this.day(nd.due)}</div>` : ''}
      ${nd.tip ? `<div class="jr-tip"><b>👨‍👩‍👧 Bố mẹ làm cùng bé</b><div>${esc(nd.tip)}</div></div>` : ''}</div>
      <button class="btn primary" data-a="J-did">🌟 Bé làm được rồi!</button><button class="btn link" data-a="J-x">Để sau</button>`, async (a) => {
      if (a === 'J-x') return closeSheet();
      if (a !== 'J-did') return;
      try {
        if (nd.mid) await rpc('ct_milestone_save', { p_id: nd.mid, p: { status: 'done' } });
        await rpc('ct_journal_save', { p: { kind: 'milestone', title: nd.title, privacy: 'family', child_id: k.id } });
        closeSheet(); toast('Tuyệt vời! ⭐ Đã thắp sáng mốc này, TV cũng cập nhật.'); if (done) done();
      } catch (e) { toast(e.message, true); }
    });
  },
  winSheet(w) {
    sheet(`<div class="jr-sh">${w.photo ? `<img class="jr-photo" src="${esc(w.photo)}" alt="">` : `<div class="jr-big">${w.kind === 'achievement' ? '🏆' : '⭐'}</div>`}
      <span class="jr-tag win">Bé đã làm được!</span><h3>${esc(w.title)}</h3>
      <div class="hint">${this.day(w.day)}${w.by ? ' · ghi bởi ' + esc(w.by) : ''}</div>${w.text ? `<p>${esc(w.text)}</p>` : ''}</div>
      <button class="btn primary" data-a="J-x">Đóng</button>`, () => closeSheet());
  },
};

// Chạm chấm trên bản đồ / thẻ thành tích (dùng chung cho mọi tab)
$('#view').addEventListener('click', (e) => {
  const b = e.target.closest('[data-a^="J-"]');
  if (!b) return;
  const a = b.dataset.a, k = curKid();
  if (a === 'J-node' && k) return Journey.open(k, +b.dataset.i, () => render());
  if (a === 'J-win') {
    const all = Object.values(Journey.cache).flatMap((d) => d.wins).concat(Journey.feedWins || []);
    const w = all.find((x) => String(x.id) === b.dataset.id); if (w) Journey.winSheet(w);
  }
  if (a === 'J-road') { Learn.seg = 'road'; Learn.gid = null; return vGo('learn'); }
});
