// ChildTube — dashboard "Bé đã xem gì" (tab Hôm nay → thẻ 📊): nội dung bé đã xem trên TV, % hoàn thành giáo trình,
// bao nhiêu thời gian xem đúng giáo trình, có lệch hướng không và nên chỉnh thế nào. Máy chủ: ct_watch_insights.
const Watch = {
  d: {}, days: 7, kid: null,
  LV: { ok: ['🟢', 'Đúng hướng', 'ok'], mild: ['🟡', 'Hơi lệch hướng', 'mild'], high: ['🔴', 'Đang lệch hướng', 'high'], little: ['⚪', 'Chưa đủ dữ liệu', 'little'] },
  ST: { on_track: ['Đúng nhịp', 'ok'], slow: ['Học chậm', 'mild'], stalled: ['Bỏ dở', 'high'], done: ['Đã xong', 'ok'], empty: ['Chưa có bài', 'little'] },
  KIND: { cur: '📘 Giáo trình', topic: '🎵 Playlist nhà mình', fav: '⭐ Yêu thích', free: '📺 Ngoài giáo trình' },
  // Thẻ tóm tắt trên tab Hôm nay (tải riêng, không làm chậm trang)
  card(kidId) {
    const x = this.d[kidId + '|7'];
    setTimeout(() => this.loadCard(kidId), 0);
    return `<div class="card wd-card tap" data-a="W-open" id="wd-card">${x ? this.cardInner(x) : '<b>📊 Bé đã xem gì · 7 ngày</b><div class="m">Đang phân tích…</div>'}</div>`;
  },
  async loadCard(kidId) {
    try { this.d[kidId + '|7'] = await rpc('ct_watch_insights', { p_child: kidId, p_days: 7 }); } catch (e) { return; }
    const el = $('#wd-card'); if (el) el.innerHTML = this.cardInner(this.d[kidId + '|7']);
  },
  cardInner(x) {
    const lv = this.LV[x.drift.level], s = x.share;
    return `<div class="wd-ch"><b>📊 ${esc(x.child.name)} đã xem gì · 7 ngày</b><span class="wd-lv ${lv[2]}">${lv[0]} ${lv[1]}</span></div>
      ${x.total.minutes ? `${this.stack(x)}<div class="m">${x.total.minutes} phút · <b>${s.cur}%</b> đúng giáo trình${x.drift.reasons[0] ? ' · ' + esc(x.drift.reasons[0].text) : ''}</div>`
        : '<div class="m">Tuần này bé chưa xem gì trên TV.</div>'}<span class="chev">›</span>`;
  },
  stack(x) {
    const m = x.minutes, t = Math.max(1, m.cur + m.topic + m.fav + m.free);
    return `<div class="wd-stack">${[['cur', m.cur], ['topic', m.topic], ['fav', m.fav], ['free', m.free]].filter(([, v]) => v).map(([k, v]) => `<i class="${k}" style="width:${(v / t) * 100}%"></i>`).join('')}</div>`;
  },

  // ---------- Trang đầy đủ ----------
  async open(kidId) {
    this.kid = kidId || (curKid() && curKid().id);
    if (!this.kid) return toast('Chọn một bé trước (nút bé ở cuối thanh tab).', true);
    let el = $('#wd');
    if (!el) { el = document.createElement('div'); el.id = 'wd'; el.className = 'wd hidden'; document.body.appendChild(el); }
    el.classList.remove('hidden'); document.body.classList.add('chat-open');
    this.paint();
    await this.load();
  },
  close() { const el = $('#wd'); if (el) el.classList.add('hidden'); document.body.classList.remove('chat-open'); },
  async load() {
    const key = this.kid + '|' + this.days;
    try { this.d[key] = await rpc('ct_watch_insights', { p_child: this.kid, p_days: this.days }); } catch (e) { toast(e.message, true); }
    this.paint();
  },
  paint() {
    const el = $('#wd'); if (!el) return;
    const x = this.d[this.kid + '|' + this.days], k = kids().find((c) => c.id === this.kid) || {};
    const top = `<div class="ch-top wd-top"><button class="ch-back" data-a="W-close" aria-label="Đóng">‹</button><div class="ch-title"><b>${esc(k.emoji || '🧒')} ${esc(k.name || 'Bé')} đã xem gì</b><em>Trên TV ChildTube</em></div>
      <div class="wd-seg">${[7, 30].map((n) => `<button class="${this.days === n ? 'on' : ''}" data-a="W-days" data-v="${n}">${n} ngày</button>`).join('')}</div></div>`;
    if (!x) { el.innerHTML = top + '<div class="wd-body"><div class="empty"><span class="spin"></span></div></div>'; return; }
    const lv = this.LV[x.drift.level], s = x.share, m = x.minutes, t = x.total;
    const arrow = (a, b, unit) => (b == null || a === b ? '' : `<em class="${a > b ? 'up' : 'down'}">${a > b ? '▲' : '▼'} ${Math.abs(a - b)}${unit}</em>`);
    const drift = `<div class="card wd-drift ${lv[2]}"><div class="wd-dh"><span>${lv[0]}</span><b>${lv[1]}</b></div>
      ${x.drift.reasons.length ? `<ul>${x.drift.reasons.map((r) => `<li class="${r.level}">${esc(r.text)}</li>`).join('')}</ul>`
        : `<div class="m">${x.drift.level === 'little' ? `Mới xem ${t.minutes} phút trong ${x.days} ngày — xem thêm vài hôm để đánh giá chính xác.` : 'Phần lớn thời gian bé xem đúng bài trong giáo trình.'}</div>`}</div>`;
    const kpi = `<div class="wd-kpi"><div><b>${t.minutes}′</b><span>tổng thời gian</span>${arrow(t.minutes, t.prev_minutes, '′')}</div>
      <div><b>${s.cur}%</b><span>đúng giáo trình</span>${t.prev_minutes ? arrow(s.cur, s.prev_cur, '%') : ''}</div><div><b>${t.videos}</b><span>video khác nhau</span></div></div>`;
    const legend = [['cur', 'Giáo trình', m.cur], ['topic', 'Playlist nhà mình', m.topic], ['fav', 'Yêu thích', m.fav], ['free', 'Ngoài giáo trình', m.free]];
    const mix = `<div class="card"><b>Bé xem gì</b>${this.stack(x)}<div class="wd-leg">${legend.map(([c, n, v]) => `<span><i class="${c}"></i>${n} · ${v}′</span>`).join('')}</div>
      ${m.free + m.topic + m.fav ? `<div class="m">Trong video ngoài giáo trình, khoảng <b>${s.related}%</b> thời gian là cùng chủ đề với giáo trình (ước tính theo tên video).</div>` : ''}
      ${m.late ? `<div class="m">🌙 ${m.late} phút xem sau 20:30.</div>` : ''}</div>`;
    const maxDay = Math.max(1, ...x.series.map((d) => d.cur + d.other), t.limit || 0);
    const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const chart = `<div class="card"><b>Mỗi ngày</b><div class="wd-bars ${x.days > 7 ? 'many' : ''}">${x.series.map((d, i) => {
      const lbl = x.days > 7 ? (i % 5 === 4 || i === x.series.length - 1 ? +d.day.slice(8) : '') : wd[new Date(d.day + 'T12:00:00+07:00').getDay()];
      return `<div title="${d.day}: ${d.cur + d.other} phút"><span><i class="other" style="height:${(d.other / maxDay) * 100}%"></i><i class="cur" style="height:${(d.cur / maxDay) * 100}%"></i></span><em>${lbl}</em></div>`; }).join('')}
</div>
      <div class="wd-leg"><span><i class="cur"></i>Giáo trình</span><span><i class="free"></i>Khác</span>${t.limit ? `<span>— giới hạn ${t.limit}′/ngày</span>` : ''}</div></div>`;
    const curs = x.curriculum.length ? x.curriculum.map((c) => { const st = this.ST[c.state];
      return `<div class="card wd-cur tap" data-a="W-cur" data-id="${c.id}"><div class="wd-cth"><b>${esc(c.emoji || '📘')} ${esc(c.name)}</b><span class="wd-lv ${st[1]}">${st[0]}</span></div>
        <div class="wd-prog"><i style="width:${c.pct}%"></i></div>
        <div class="m"><b>${c.pct}%</b> · ${c.done}/${c.total} bài · kỳ này ${c.period_lessons} bài, ${c.minutes} phút${c.idle_days != null && c.idle_days > 1 ? ` · lần cuối ${c.idle_days} ngày trước` : ''}</div>
        ${c.next ? `<div class="wd-next">Tiếp theo: <b>${esc(c.next.title)}</b> <span class="m">(${esc(c.next.chapter)})</span></div>` : ''}</div>`; }).join('')
      : '<div class="card"><div class="empty">Bé chưa có giáo trình đang học.</div></div>';
    const tips = x.tips.length ? `<div class="card wd-tips">${x.tips.map((tp, i) => `<div class="wd-tip"><span>${tp.icon}</span><div>${esc(tp.text)}${tp.action ? `<button class="btn small soft" data-a="W-act" data-i="${i}">${({ open_cur: 'Mở giáo trình', sources: 'Kênh & video', add_video: 'Nhờ AI thêm', ai: 'Hỏi trợ lý AI', tv_settings: 'Cài đặt TV' })[tp.action] || 'Mở'} ›</button>` : ''}</div></div>`).join('')}</div>` : '';
    const list = x.top.length ? `<div class="card wd-list">${x.top.map((v) => `<div class="wd-v"><img src="${thumb(v.id)}" alt="" loading="lazy"><div><b>${esc(v.title || v.id)}</b>
      <span class="wd-tag ${v.kind}">${v.kind === 'cur' ? `📘 ${esc(v.name)}${v.main ? '' : ' · bài phụ'}` : this.KIND[v.kind]}${v.kind !== 'cur' && v.related ? ' · cùng chủ đề' : ''}</span>
      <span class="m">${v.minutes} phút${v.times > 1 ? ` · xem ${v.times} lần` : ''}${v.finished ? ' · ✓ xem hết' : ''}</span></div></div>`).join('')}</div>` : '';
    const src = x.sources.length ? `<div class="card wd-list">${x.sources.map((s2) => `<div class="wd-src"><b>📺 ${esc(s2.name)}</b><span>${s2.minutes}′ · ${s2.share}%</span><i style="width:${s2.share}%"></i></div>`).join('')}</div>` : '';
    el.innerHTML = top + `<div class="wd-body">${drift}${kpi}
      ${tips ? '<h2>Nên điều chỉnh</h2>' + tips : ''}
      <h2>Tiến độ giáo trình</h2>${curs}
      ${mix}${chart}
      ${list ? '<h2>Nội dung đã xem nhiều nhất</h2>' + list : ''}
      ${src ? '<h2>Kênh ngoài giáo trình</h2>' + src : ''}
      <div class="m wd-note">Tính theo lịch sử xem trên TV gán cho bé và TV dùng chung cả nhà. "Đúng giáo trình" = video nằm trong giáo trình của bé hoặc của cả nhà.</div></div>`;
  },
  async act(tp) {
    if (!tp || !tp.action) return;
    if (tp.action === 'open_cur') { this.close(); Learn.seg = 'now'; Learn.gid = tp.id; return vGo('learn'); }
    if (tp.action === 'sources') { this.close(); return vGo('list'); }
    if (tp.action === 'tv_settings') { this.close(); return vGo('settings'); }
    if (tp.action === 'add_video' || tp.action === 'ai') {
      const v = (this.d[this.kid + '|' + this.days].top || []).find((x) => x.id === tp.id);
      const msg = tp.text_ai || `Bé rất hay xem video "${v ? v.title : ''}" (https://youtu.be/${tp.id}). Hãy thêm video này vào giáo trình phù hợp làm bài ôn tập.`;
      this.close();
      await aiChat.open(null, () => render());
      const t = $('#aic-text'); if (t) { t.value = msg; t.focus(); }
    }
  },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a^="W-"]'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'W-open') return Watch.open();
  if (a === 'W-close') return Watch.close();
  if (a === 'W-days') { Watch.days = +b.dataset.v; Watch.paint(); return Watch.load(); }
  if (a === 'W-cur') { Watch.close(); Learn.seg = 'now'; Learn.gid = b.dataset.id; return vGo('learn'); }
  if (a === 'W-act') return Watch.act((Watch.d[Watch.kid + '|' + Watch.days] || {}).tips[+b.dataset.i]);
});
