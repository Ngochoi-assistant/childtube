// ChildTube — tab "Hôm nay": dashboard trực quan của một bé (hoặc cả nhà). Máy chủ: ct_dashboard, ct_overview.
const Today = {
  d: {}, ov: null,
  MOODS: [['vui', '😄'], ['bình thường', '🙂'], ['mệt', '🥱'], ['buồn', '😢'], ['cáu', '😠']],
  async render() {
    const v = $('#view'), k = curKid();
    const key = k ? k.id : 'all';
    if (!this.d[key] && !(key === 'all' && this.ov)) v.innerHTML = pageHead('') + '<div class="empty"><span class="spin"></span></div>';
    try {
      const [ov, d] = await Promise.all([rpc('ct_overview'), k ? rpc('ct_dashboard', { p_child: k.id }) : null]);
      this.ov = ov; if (k) this.d[key] = d;
      V.counts = ov.approvals.total; topbar();
    } catch (e) { return toast(e.message, true); }
    if (tab !== 'today' || (curKid() ? curKid().id : 'all') !== key) return;
    v.innerHTML = k ? this.kidHtml(this.d[key]) : this.familyHtml(this.ov);
  },
  hello() { const h = new Date().getHours(); return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; },
  alertHtml() {
    const a = this.ov.approvals;
    if (!a.total) return '';
    const parts = [a.videos && `${a.videos} video mới`, a.ai_proposals && `${a.ai_proposals} giáo trình AI soạn`, a.drafts && `${a.drafts} giáo trình đang soạn`, a.requests && `${a.requests} đề xuất`].filter(Boolean);
    return `<div class="td-alert" data-a="V-go" data-v="review"><span>✋</span><b>${a.total} việc chờ bạn: ${esc(parts.join(', '))}</b><button class="btn small dark">Xem</button></div>`;
  },
  kidHtml(d) {
    const name = esc(d.child.name), todayMood = d.moods[6].mood;
    const used = Math.round(d.watch.today / 60), lim = d.watch.limit;
    const moodIcon = Object.fromEntries(this.MOODS);
    const ask = todayMood
      ? `<div class="card td-ask done"><div class="td-askh"><span class="td-big">${moodIcon[todayMood] || '📝'}</span><div><b>Hôm nay ${name} ${esc(todayMood)}</b><div class="m">Đã ghi lại. Muốn kể thêm chuyện gì?</div></div></div>
         <button class="btn small soft" data-a="P-check" data-id="${d.child.id}">+ Thêm chi tiết · ảnh</button></div>`
      : `<div class="card td-ask"><b>Hôm nay ${name} thế nào?</b><div class="m">Chạm 1 lần là lưu.</div>
         <div class="td-moods">${this.MOODS.map(([k, i]) => `<button data-a="T-mood" data-v="${k}" aria-label="${k}">${i}</button>`).join('')}</div>
         <button class="btn link" data-a="P-check" data-id="${d.child.id}">+ Thêm chi tiết · ảnh</button></div>`;
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const week = d.moods.map((x, i) => { const wd = days[new Date(x.day + 'T12:00:00+07:00').getDay()]; return `<div class="${i === 6 ? 'today' : ''}">${i === 6 ? 'Hôm nay' : wd}<i>${x.mood ? moodIcon[x.mood] || '📝' : '<span class="td-none">○</span>'}</i></div>`; }).join('');
    const bub = d.interests.length
      ? `${ch.bubbles(d.interests)}<div class="m">Bong bóng càng to = ${name} nhắc tới càng nhiều (${d.interest_samples} lần ghi). Đây là quan sát, chưa phải kết luận.</div>`
      : `<div class="empty">Khi ghi nhanh, chạm vào điều ${name} thích — bong bóng sở thích sẽ hiện ở đây.</div>`;
    const sk = d.skills;
    const radar = sk.evidence
      ? `<div class="td-skill">${ch.radar(sk.list, 3, 220)}<div><b>${sk.best.length ? 'Nổi bật: ' + esc(sk.best.join(', ')) : 'Đang theo dõi'}</b><div class="m">${sk.evidence} bằng chứng đã ghi nhận</div></div></div>`
      : `<div class="empty">Chưa có bằng chứng năng lực. Ghi nhận khi ${name} làm được điều mới (từ bài đăng trong Nhật ký hoặc tab Học → Năng lực).</div>`;
    const next = d.next
      ? `<div class="card td-next tap" data-a="T-path" data-id="${d.next.group_id}"><img src="${thumb(d.next.video)}" alt=""><div class="info"><div class="t">${esc(d.next.lesson)}</div>
          <div class="m">${esc(d.next.emoji || '📘')} ${esc(d.next.group)} · ${esc(d.next.chapter)}${d.next.minutes ? ' · ~' + d.next.minutes + ' phút' : ''}</div></div><span class="chev">›</span></div>`
      : `<div class="card"><div class="empty">Chưa có giáo trình nào cho ${name}. <button class="btn small" data-a="T-add">＋ Thêm</button></div></div>`;
    return `${pageHead('', '')}${this.alertHtml()}
      <div class="td-hi"><b>${this.hello()} 👋</b><span class="m">Đây là ngày của ${name}</span></div>
      ${ask}
      <div class="td-grid">
        <div class="card td-ring tap" data-a="V-go" data-v="history">${ch.ring(used, lim || Math.max(used, 60), 'var(--ok)', used + '′', lim ? '/ ' + lim + ' phút' : 'phút')}<b>Giờ xem TV hôm nay</b><span class="m">${lim ? (lim > used ? 'còn ' + (lim - used) + ' phút' : 'đã hết giờ') : 'không giới hạn'}</span></div>
        <div class="card td-ring tap" data-a="T-learn">${ch.ring(d.lessons_week.done, d.lessons_week.target, 'var(--blue)', d.lessons_week.done + '/' + d.lessons_week.target, 'bài tuần này')}<b>Học đều đặn</b><span class="m">${d.streak ? '🔥 ' + d.streak + ' ngày liên tiếp' : 'Bắt đầu chuỗi ngày học hôm nay'}</span></div>
      </div>
      <h2>Lộ trình học của ${name}<button class="btn link" data-a="T-road">Dài hạn ›</button></h2>${this.pathHtml(d)}
      <h2>Bài tiếp theo</h2>${next}
      <h2>Cảm xúc tuần này</h2><div class="card"><div class="td-week">${week}</div></div>
      <h2>${name} đang mê gì</h2><div class="card">${bub}</div>
      <h2>${name} đang phát triển<button class="btn link" data-a="T-skills">Bản đồ năng lực ›</button></h2><div class="card">${radar}</div>`;
  },
  // Lộ trình ngắn trên dashboard: giáo trình đang học (đã xong / đang học / bài tiếp) + vài mốc gần nhất.
  // Lộ trình dài hạn theo tuổi, định hướng nghề chỉ hiện khi bấm "Dài hạn ›" (tab Học → Lộ trình).
  pathHtml(d) {
    const name = esc(d.child.name), paths = d.paths || [];
    const steps = (p) => `<div class="pth">${p.from ? '<div class="pth-s more"><i>…</i><span></span></div>' : ''}${p.steps.map((s) =>
      `<div class="pth-s ${s.done ? 'done' : s.now ? 'now' : ''}"><i>${s.done ? '✓' : s.now ? '▶' : s.n}</i><span>${esc(s.title)}</span></div>`).join('')}${p.from + p.steps.length < p.total ? `<div class="pth-s more"><i>+${p.total - p.from - p.steps.length}</i><span>bài nữa</span></div>` : ''}<div class="pth-s end ${p.done === p.total ? 'done' : ''}"><i>🏁</i><span>Hoàn thành</span></div></div>`;
    const cards = paths.map((p) => `<div class="card td-path tap" data-a="T-path" data-id="${p.group_id}">
      <div class="td-pth"><b>${esc(p.emoji || '📘')} ${esc(p.name)}</b><span>${p.done}/${p.total} bài</span></div>
      <div class="td-bar"><i style="width:${p.total ? (p.done / p.total) * 100 : 0}%"></i></div>${steps(p)}</div>`).join('');
    const ms = ((d.road && d.road.milestones) || []).filter((m) => m.status !== 'done').slice(0, 3);
    const mile = ms.length ? `<div class="card td-mile2 tap" data-a="T-road"><b>Mốc gần nhất</b><div class="td-chips">${ms.map((m) => `<span class="td-chip ${m.status}">${m.status === 'doing' ? '◐' : '○'} ${esc(m.title)}</span>`).join('')}</div></div>` : '';
    return (cards || `<div class="card"><div class="empty">Chưa có giáo trình nào cho ${name}. <button class="btn small" data-a="T-add">＋ Thêm</button></div></div>`) + mile;
  },
  roadHtml(d) {
    const r = d.road;
    if (!r) return '';
    const now = (r.stages || []).find((s) => s.state === 'now'), p = r.progress || { done: 0, total: 0 };
    const chips = (r.milestones || []).slice(0, 6).map((m) => `<span class="td-chip ${m.status}">${m.status === 'done' ? '✓' : m.status === 'doing' ? '◐' : '○'} ${esc(m.title)}</span>`).join('');
    const goals = (r.goals || []).slice(0, 3).map((g) => esc(g.title)).join(' · ');
    return `<div class="card td-road tap" data-a="T-road">${ch.journey({ ...r, child: { ...r.child, emoji: d.child.emoji } })}
      ${now ? `<div class="m">Giai đoạn <b>${esc(now.name)}</b>: ${esc(now.focus)}</div>` : ''}
      <div class="td-mile"><b>${p.done}/${p.total}</b> mốc năm nay<span class="td-bar"><i style="width:${p.total ? (p.done / p.total) * 100 : 0}%"></i></span></div>
      ${chips ? `<div class="td-chips">${chips}</div>` : '<div class="m">Chưa có mốc năm nay — chạm để thêm.</div>'}
      ${goals ? `<div class="m">🎯 ${goals}</div>` : ''}</div>`;
  },
  familyHtml(o) {
    const cards = o.children.map((c) => `<div class="card td-kidcard tap" data-a="V-kid" data-id="${c.id}"><span class="td-big">${esc(c.emoji)}</span>
      <div class="info"><div class="t">${esc(c.name)}</div><div class="m">${c.last_checkin ? (Object.fromEntries(this.MOODS)[c.last_checkin.mood] || '📝') + ' ' + (c.last_checkin.interests || []).slice(0, 2).map(esc).join(', ') : 'Chưa ghi hôm nay'}</div></div><span class="chev">›</span></div>`).join('');
    const used = Math.round(o.watch.today / 60);
    return `${pageHead('', '')}${this.alertHtml()}
      <div class="td-hi"><b>${this.hello()} 👋</b><span class="m">${esc(o.family || '')} · cả nhà</span></div>
      <div class="td-grid"><div class="card td-ring">${ch.ring(used, o.limit || Math.max(used, 60), 'var(--ok)', used + '′', o.limit ? '/ ' + o.limit + ' phút' : 'phút')}<b>Cả nhà xem TV hôm nay</b><span class="m">tuần này ${Math.round(o.watch.week / 60)} phút</span></div>
        <div class="card td-ring tap" data-a="V-go" data-v="review">${ch.ring(o.approvals.total ? 1 : 0, 1, 'var(--brand)', String(o.approvals.total), 'việc chờ bạn')}<b>Cần bạn</b><span class="m">${o.approvals.total ? 'chạm để xem' : 'đã xong hết 🎉'}</span></div></div>
      <h2>Các bé</h2>${cards || '<div class="card"><div class="empty">Chưa có hồ sơ bé.</div></div>'}`;
  },
};

$('#view').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a^="T-"]');
  if (!b) return;
  const a = b.dataset.a, k = curKid();
  if (a === 'T-mood' && k) {
    try { await rpc('ct_journal_save', { p: { kind: 'checkin', child_id: k.id, mood: b.dataset.v } }); toast('Đã ghi lại 🌱'); delete Today.d[k.id]; Feed.list = null; render(); } catch (err) { toast(err.message, true); }
  }
  if (a === 'T-learn') { Learn.seg = 'now'; return vGo('learn'); }
  if (a === 'T-skills') { Learn.seg = 'skills'; return vGo('learn'); }
  if (a === 'T-road') { Learn.seg = 'road'; Learn.gid = null; return vGo('learn'); }
  if (a === 'T-path') { Learn.seg = 'now'; Learn.gid = b.dataset.id; return vGo('learn'); }
  if (a === 'T-add') return Learn.addSheet();
});
