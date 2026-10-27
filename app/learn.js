// ChildTube — tab "Học": Đang học (giáo trình → đường học dạng bản đồ) · Lộ trình (sơ đồ dòng thời gian) · Năng lực (mạng nhện + bằng chứng).
// Máy chủ: ct_state (giáo trình), ct_roadmap, ct_goal_*, ct_milestone_*, ct_skills, ct_skill_assess.
const Learn = {
  seg: 'now', gid: null, rm: {}, sk: {},
  render() {
    if (this.gid) return this.pathView();
    const k = curKid(), seg = (v, t) => `<button class="${this.seg === v ? 'on' : ''}" data-a="L2-seg" data-v="${v}">${t}</button>`;
    const head = `${pageHead(k ? `${esc(k.name)} học gì` : 'Cả nhà học gì', '')}<div class="v-seg">${seg('now', 'Đang học')}${seg('road', 'Lộ trình')}${seg('skills', 'Năng lực')}</div>`;
    const v = $('#view');
    if (this.seg === 'now') { v.innerHTML = head + this.nowHtml(k) + (S.restricted ? '' : '<button class="v-fab" data-a="L2-add" aria-label="Thêm">＋</button>'); return; }
    if (!k) {
      v.innerHTML = head + ((S.children || []).length
        ? '<div class="card"><div class="empty">Chọn một bé ở trên để xem lộ trình và năng lực riêng của bé.</div></div>'
        : '<div class="card"><div class="empty">Lộ trình và năng lực đi theo từng bé. Thêm hồ sơ bé (tên, ngày sinh) để bắt đầu.<br><button class="btn small" data-a="V-addkid">＋ Thêm hồ sơ bé</button></div></div>');
      return;
    }
    v.innerHTML = head + '<div class="empty"><span class="spin"></span></div>';
    (this.seg === 'road' ? this.roadView(k, head) : this.skillsView(k, head)).catch((e) => toast(e.message, true));
  },

  // ---------- Đang học ----------
  mine(k) { return curricula().filter((g) => !g.archived && (!k || !g.child_id || g.child_id === k.id)); },
  nowHtml(k) {
    const cur = this.mine(k).sort((a, b) => (a.status === 'published' ? 0 : 1) - (b.status === 'published' ? 0 : 1));
    const card = (g) => {
      const s = curStats(g), pct = s.main ? Math.round(s.done / s.main * 100) : 0;
      return `<div class="item tap" data-a="L2-open" data-id="${g.id}"><div class="ic">${esc(g.emoji || '📘')}</div>
        <div class="info"><div class="t">${esc(g.name)}</div><div class="m">${s.lessons} bài · ${g.child_id ? childName(g.child_id) : '👨‍👩‍👧 cả nhà'}${g.status === 'published' ? '' : ' · <b class="tag-draft">đang soạn</b>'}</div>
        <div class="v-bar"><i style="width:${pct}%"></i></div></div><span class="chev">›</span></div>`;
    };
    const pls = groupsOf('topic');
    const src = S.sources || [];
    const auto = S.family && S.family.end_mode === 'next';
    const autoCard = S.restricted ? '' : `<div class="card lr-auto"><div class="info"><b>${auto ? '▶ Đang phát liên tiếp' : '⏸ Dừng sau mỗi video'}</b>
      <div class="m">${auto ? 'Xem xong, TV tự phát video kế tiếp đã duyệt trong cùng danh mục.' : 'Xem xong mỗi video, TV dừng lại cho bé chọn.'}</div></div>
      <button class="lr-sw ${auto ? 'on' : ''}" data-a="L2-auto" aria-label="Phát liên tiếp"><i></i></button></div>`;
    return `${autoCard}<h2>Giáo trình</h2><div class="card">${cur.length ? cur.map(card).join('') : `<div class="empty">Chưa có giáo trình. Bấm <b>＋</b> để nhờ AI soạn hoặc tự tạo.</div>`}</div>
      <h2>🎵 Playlist của gia đình<button class="btn link" data-a="L2-pl">Quản lý ›</button></h2><div class="card">
        ${pls.map((g) => `<div class="item tap" data-a="L2-pl"><div class="ic">${esc(g.emoji || '🎵')}</div><div class="info"><div class="t">${esc(g.name)}</div><div class="m">${g.items.length} mục · bố mẹ tạo</div></div><span class="chev">›</span></div>`).join('')
          || '<div class="empty">Chưa có playlist. Tạo playlist như “Nhạc trước giờ ngủ” để gom video theo ý bạn.</div>'}</div>
      ${[['channel', '📺 Kênh YouTube'], ['playlist', '📃 Playlist YouTube']].map(([kd, t]) => {
        const list = src.filter((s) => s.kind === kd);
        return list.length ? `<h2>${t} (${list.length})<button class="btn link" data-a="V-go" data-v="list">Quản lý ›</button></h2><div class="card">${list.slice(0, 6).map((s) => `<div class="item tap" data-a="V-go" data-v="list"><img class="ic" src="${esc(s.thumb)}" alt=""><div class="info"><div class="t">${esc(s.title)}</div><div class="m">${s.count || 0} video${s.pending ? ` · <b class="tag-wait">${s.pending} chờ duyệt</b>` : ''}</div></div><span class="chev">›</span></div>`).join('')}${list.length > 6 ? `<button class="btn link" data-a="V-go" data-v="list">Xem tất cả ${list.length} ›</button>` : ''}</div>` : '';
      }).join('')}
      ${src.some((s) => s.kind === 'video') ? `<div class="card"><div class="item tap" data-a="V-go" data-v="list"><div class="ic">🎬</div><div class="info"><div class="t">Video lẻ</div><div class="m">${src.filter((s) => s.kind === 'video').length} video</div></div><span class="chev">›</span></div></div>` : ''}
      ${!src.length ? '<div class="card"><div class="empty">Chưa có kênh YouTube nào. <button class="btn link" data-a="V-go" data-v="list">Thêm kênh ›</button></div></div>' : ''}
      <h2>Video đã lưu ❤️<button class="btn link" data-a="L2-fav">${S.favorites.length} ›</button></h2>
      <div class="v-thumbs">${S.favorites.slice(0, 6).map((f) => `<img src="${thumb(f.video_id)}" alt="" data-a="L2-fav">`).join('') || '<div class="card"><div class="empty">Lưu video hay để dùng sau.</div></div>'}</div>`;
  },
  addSheet() {
    sheet(`<h3>Thêm để bé xem</h3><div class="hint">Mọi thứ mới đều chờ bạn cho phép trước khi lên TV.</div>
      <div class="v-opts">
        <button data-a="L2-ai"><span style="background:var(--brand-soft)">🤖</span><b>Nhờ AI soạn giáo trình</b><small>Nói mục tiêu, AI tìm video và sắp bài</small></button>
        <button data-a="L2-search"><span style="background:var(--blue-soft)">🔎</span><b>Tìm trên YouTube</b><small>Gõ chủ đề, xem thử rồi chọn</small></button>
        <button data-a="L2-link"><span style="background:var(--ok-soft)">🔗</span><b>Dán link YouTube</b><small>Video, kênh hoặc playlist</small></button>
        <button data-a="L2-new"><span style="background:var(--sun-soft)">✍️</span><b>Tự tạo giáo trình</b><small>Chương → bài → video, tự sắp xếp</small></button>
      </div>`, (a) => {
      closeSheet();
      if (a === 'L2-ai') return aiChat.open(null, () => render());
      if (a === 'L2-search') return vGo('search');
      if (a === 'L2-link') return vGo('list');
      if (a === 'L2-new') return curInfoSheet(null, (id) => openEditor(id));
    });
  },

  // ---------- Đường học của một giáo trình ----------
  pathView() {
    const g = S.groups.find((x) => x.id === this.gid);
    if (!g) { this.gid = null; return this.render(); }
    const done = new Set(g.items.filter((i) => i.done).map((i) => i.video_id));
    const nodes = []; let nextSet = false, total = 0, fin = 0;
    (g.modules || []).forEach((m, mi) => {
      if (mi) nodes.push({ state: 'chapter', title: `Chương ${mi + 1} · ${m.title}`, sub: `${m.lessons.length} bài` });
      for (const l of m.lessons) {
        const main = l.items.filter((i) => i.video_id && i.role !== 'extra');
        if (!main.length) continue;
        total++;
        const isDone = main.every((i) => done.has(i.video_id));
        let state = isDone ? 'done' : 'todo';
        if (isDone) fin++; else if (!nextSet) { state = 'next'; nextSet = true; }
        nodes.push({ id: l.id, title: l.title, state, sub: (l.minutes ? l.minutes + ' phút' : '') + (l.items.length > main.length ? (l.minutes ? ' · ' : '') + '+ bổ trợ' : ''), icon: ['🎬', '📺', '🎵', '🧩', '🔍', '🎨'][nodes.length % 6] });
      }
    });
    if (total) nodes.push({ state: 'todo', id: '', title: 'Hoàn thành 🏆', icon: '🏆', sub: '' });
    const pct = total ? Math.round(fin / total * 100) : 0;
    $('#view').innerHTML = `<div class="v-sub"><button class="v-back" data-a="L2-close">‹</button><b>${esc(g.emoji || '📘')} ${esc(g.name)}</b></div>
      <div class="card lp-head"><div class="info"><div class="m">${g.child_id ? childName(g.child_id) : '👨‍👩‍👧 Cả nhà'} · ${fin}/${total} bài${g.status === 'published' ? '' : ' · đang soạn (bé chưa thấy)'}</div><div class="v-bar"><i style="width:${pct}%"></i></div></div>
        ${S.restricted ? '' : `<div class="lp-acts"><button class="btn small soft" data-a="L2-edit">✏️ Sửa</button><button class="btn small soft" data-a="L2-aiedit">🤖 Sửa bằng AI</button></div>`}</div>
      ${total ? ch.path(nodes) : '<div class="card"><div class="empty">Giáo trình chưa có bài nào.</div></div>'}`;
  },

  // ---------- Lộ trình ----------
  async roadView(k, head) {
    const [rm, jd] = await Promise.all([rpc('ct_roadmap', { p_child: k.id }), Journey.load(k).catch(() => null)]);
    this.rm[k.id] = rm;
    if (tab !== 'learn' || this.seg !== 'road') return;
    const st = { todo: '○', doing: '◐', done: '✓' };
    const ms = rm.milestones.map((x) => `<div class="item"><button class="lr-chk ${x.status}" data-a="L2-mtog" data-id="${x.id}" aria-label="Đánh dấu">${st[x.status]}</button>
      <div class="info"><div class="t ${x.status === 'done' ? 'lr-done' : ''}">${esc(x.title)}</div><div class="m">${x.competency ? esc(x.competency_name || x.competency) + ' · ' : ''}${x.due_on ? 'hạn ' + esc(x.due_on) : 'năm nay'}</div></div>
      <button class="icon-btn" data-a="L2-mdel" data-id="${x.id}" title="Xoá">✕</button></div>`).join('');
    const gs = rm.goals.map((g) => `<div class="item tap" data-a="L2-goal" data-id="${g.id}"><div class="ic">${{ school: '🏫', field: '🔭', career: '💼', skill: '⭐', personal: '🌱' }[g.kind] || '🎯'}</div>
      <div class="info"><div class="t">${esc(g.title)}</div><div class="m">${{ parent: '💭 Kỳ vọng của bố mẹ', child: '💖 Bé muốn', ai: '🤖 AI gợi ý' }[g.proposed_by]} · ${{ exploring: 'đang tìm hiểu', active: 'đang theo', paused: 'tạm dừng', completed: 'đã xong' }[g.status] || ''}${g.target_age ? ' · ' + g.target_age + ' tuổi' : ''}</div></div><span class="chev">›</span></div>`).join('');
    $('#view').innerHTML = `${head}<h2>🗺 Hành trình của ${esc(k.name)}</h2>${jd ? Journey.block(jd, true) : ''}
      <div class="v-subt">Định hướng dài hạn — cập nhật theo sở thích và năng lực thật của ${esc(k.name)}</div>
      <div class="card">${ch.timeline(rm)}<div class="v-legend"><span><i style="background:var(--ok)"></i>Đã qua</span><span><i style="background:var(--brand)"></i>Hiện tại</span><span><i style="background:var(--blue)"></i>Định hướng</span><span><i style="background:var(--vio)"></i>Mục tiêu</span></div></div>
      <h2>Mốc năm nay<button class="btn link" data-a="L2-madd">＋ Thêm mốc</button></h2><div class="card">${ms || '<div class="empty">Đặt 3–5 mốc nhỏ cho năm nay, ví dụ “Đọc được 20 chữ cái”.</div>'}</div>
      <h2>Mục tiêu dài hạn<button class="btn link" data-a="L2-gadd">＋ Thêm</button></h2><div class="card">${gs || '<div class="empty">Chưa có mục tiêu. Mục tiêu có thể là trường, ngành, nghề hay một năng lực.</div>'}</div>
      <div class="card lr-ai"><span>🤖</span><div class="m">Mốc càng xa càng chỉ là định hướng. Phân biệt rõ kỳ vọng của bố mẹ và điều bé thật sự thích; AI chỉ đề xuất, bạn duyệt mới đổi.</div></div>`;
  },
  goalSheet(g) {
    const k = curKid(); g = g || { kind: 'skill', title: '', target_age: '', proposed_by: 'parent', status: 'exploring', reason: '' };
    const opt = (o, v) => Object.entries(o).map(([key, t]) => `<option value="${key}" ${v === key ? 'selected' : ''}>${t}</option>`).join('');
    sheet(`<h3>${g.id ? 'Sửa mục tiêu' : 'Mục tiêu mới cho ' + esc(k.name)}</h3>
      <label>Loại</label><select id="gk">${opt({ skill: '⭐ Năng lực (toán, ngoại ngữ…)', field: '🔭 Lĩnh vực (AI, y học…)', career: '💼 Nghề nghiệp', school: '🏫 Trường', personal: '🌱 Phát triển bản thân' }, g.kind)}</select>
      <label>Tên mục tiêu</label><input id="gt" value="${esc(g.title)}" placeholder="Ví dụ: Tiếng Anh giao tiếp tự tin">
      <div class="pt-two"><div><label>Ở tuổi</label><input id="ga" type="number" min="3" max="30" value="${esc(g.target_age || '')}" placeholder="vd 18"></div>
        <div><label>Ai đề xuất</label><select id="gb">${opt({ parent: '💭 Bố mẹ', child: '💖 Bé', ai: '🤖 AI' }, g.proposed_by)}</select></div></div>
      <label>Trạng thái</label><select id="gs">${opt({ exploring: 'Đang tìm hiểu', active: 'Đang theo', paused: 'Tạm dừng', completed: 'Đã xong', archived: 'Lưu trữ' }, g.status)}</select>
      <label>Vì sao (không bắt buộc)</label><textarea id="gr" rows="2">${esc(g.reason || '')}</textarea>
      <button class="btn primary" data-a="g-save">Lưu</button>${g.id ? '<button class="btn" data-a="g-del" style="width:100%;margin-top:8px;color:var(--danger)">Xoá mục tiêu</button>' : ''}`, async (a) => {
      try {
        if (a === 'g-save') await rpc('ct_goal_save', { p_id: g.id || null, p: { child_id: k.id, kind: $('#gk').value, title: $('#gt').value, target_age: $('#ga').value, proposed_by: $('#gb').value, status: $('#gs').value, reason: $('#gr').value } });
        else if (a === 'g-del') { if (!confirm('Xoá mục tiêu này?')) return; await rpc('ct_goal_delete', { p_id: g.id }); } else return;
        closeSheet(); render();
      } catch (e) { toast(e.message, true); }
    });
  },

  // ---------- Năng lực ----------
  async skillsView(k, head) {
    const sk = this.sk[k.id] = await rpc('ct_skills', { p_child: k.id });
    if (tab !== 'learn' || this.seg !== 'skills') return;
    const colors = ['var(--brand)', 'var(--blue)', 'var(--ok)', 'var(--vio)', 'var(--sun)', '#ec4899'];
    const rows = sk.competencies.map((c, i) => `<div class="sk-row">
      <div class="sk-h"><b>${esc(c.icon)} ${esc(c.name)}</b><span class="m">${c.level ? `Cấp ${c.level}/5 · ${esc(c.level_name)}` : 'Chưa có bằng chứng'}</span></div>
      <div class="v-bar big"><i style="width:${c.level * 20}%;background:${colors[i % colors.length]}"></i></div>
      <div class="m">${c.items.length ? c.items.slice(0, 2).map((x) => `${x.source === 'teacher' ? '🧑‍🏫' : '✅'} ${esc(x.entry || x.note)}`).join(' · ') + (c.evidence > 2 ? ` · +${c.evidence - 2}` : '') : 'Ghi nhận khi bé làm được điều mới'}
        ${S.restricted && S.me.role !== 'teacher' ? '' : `<button class="btn link" data-a="L2-assess" data-v="${c.key}">＋ Ghi nhận</button>`}</div></div>`).join('');
    $('#view').innerHTML = `${head}<div class="card sk-radar">${ch.radar(sk.competencies, 3)}
      <div class="v-legend center"><span><i style="background:var(--brand)"></i>${esc(k.name)} hiện tại (có bằng chứng)</span><span><i style="background:var(--blue)"></i>Mức thường gặp ở tuổi này (tham khảo)</span></div></div>
      <h2>Chi tiết & bằng chứng</h2><div class="card">${rows}</div>
      <p class="v-note">Cấp độ chỉ tăng khi có bằng chứng (bài kiểm tra, sản phẩm, nhận xét giáo viên, việc bé tự làm được) — không tính theo số video đã xem.</p>`;
  },
  async assessSheet(comp, entryId) {
    const k = curKid(), sk = this.sk[k.id] || await rpc('ct_skills', { p_child: k.id });
    const c = comp ? sk.competencies.find((x) => x.key === comp) : null;
    let entries = [];
    try { entries = (await rpc('ct_journal_list', { p_child: k.id })).slice(0, 20); } catch (e) { /* để trống */ }
    sheet(`<h3>Ghi nhận năng lực · ${esc(k.name)}</h3>
      <label>Năng lực</label><select id="sa-c">${sk.competencies.map((x) => `<option value="${x.key}" ${x.key === (c && c.key) ? 'selected' : ''}>${esc(x.icon + ' ' + x.name)}${x.level ? ' (đang cấp ' + x.level + ')' : ''}</option>`).join('')}</select>
      <label>Bé đang ở mức nào?</label><div class="sk-lv">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="sa-l" value="${n}" ${n === Math.min(5, ((c && c.level) || 0) + 1) ? 'checked' : ''}><span><b>${n}</b>${esc(sk.levels[n])}</span></label>`).join('')}</div>
      <label>Bằng chứng</label><select id="sa-e"><option value="">— Ghi bằng lời bên dưới —</option>${entries.map((e) => `<option value="${e.id}" ${e.id === entryId ? 'selected' : ''}>${esc((e.title || 'Ghi nhanh') + ' · ' + e.day)}</option>`).join('')}</select>
      <textarea id="sa-n" rows="2" placeholder="Bé đã làm được gì? Ví dụ: tự kể lại truyện 5 câu"></textarea>
      <button class="btn primary" data-a="sa-save">Lưu ghi nhận</button>`, async (a) => {
      if (a !== 'sa-save') return;
      try {
        await rpc('ct_skill_assess', { p_child: k.id, p_comp: $('#sa-c').value, p_level: (document.querySelector('input[name=sa-l]:checked') || {}).value, p_entry: $('#sa-e').value || null, p_note: $('#sa-n').value });
        closeSheet(); toast('Đã ghi nhận 🌟'); delete Today.d[k.id]; render();
      } catch (e) { toast(e.message, true); }
    });
  },
};

$('#view').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a^="L2-"]');
  if (!b) return;
  const a = b.dataset.a, id = b.dataset.id, k = curKid();
  if (a === 'L2-seg') { Learn.seg = b.dataset.v; return render(); }
  if (a === 'L2-add') return Learn.addSheet();
  if (a === 'L2-open') { Learn.gid = id; render(); return window.scrollTo(0, 0); }
  if (a === 'L2-close') { Learn.gid = null; return render(); }
  if (a === 'L2-edit') return openEditor(Learn.gid);
  if (a === 'L2-aiedit') return aiChat.open(Learn.gid, () => render());
  if (a === 'L2-lesson') {
    const g = S.groups.find((x) => x.id === Learn.gid), l = g && (g.modules || []).flatMap((m) => m.lessons).find((x) => x.id === id);
    const v = l && l.items.find((i) => i.video_id); if (v) previewSheet(v.video_id, l.title, closeSheet); return;
  }
  if (a === 'L2-auto') {
    const next = S.family.end_mode === 'next' ? 'stop' : 'next';
    try { await rpc('ct_family_update', { p: { end_mode: next } }); S.family.end_mode = next; toast(next === 'next' ? '▶ Đã bật phát liên tiếp (TV cập nhật trong 2 phút)' : '⏸ Đã chuyển sang dừng sau mỗi video'); render(); } catch (err) { toast(err.message, true); }
    return;
  }
  if (a === 'L2-pl') { L.seg = 'pl'; return vGo('groups'); }
  if (a === 'L2-fav') { L.seg = 'fav'; return vGo('groups'); }
  if (a === 'L2-gadd') return Learn.goalSheet(null);
  if (a === 'L2-goal') return Learn.goalSheet((Learn.rm[k.id].goals || []).find((g) => g.id === id));
  if (a === 'L2-madd') {
    const t = prompt('Mốc mới cho năm nay (ví dụ: Đọc được 20 chữ cái):'); if (!t) return;
    try { await rpc('ct_milestone_save', { p: { child_id: k.id, title: t, due_on: new Date().getFullYear() + '-12-31' } }); render(); } catch (err) { toast(err.message, true); }
  }
  if (a === 'L2-mtog') {
    const m = (Learn.rm[k.id].milestones || []).find((x) => x.id === id); if (!m) return;
    try { await rpc('ct_milestone_save', { p_id: id, p: { status: m.status === 'done' ? 'todo' : 'done' } }); if (m.status !== 'done') toast('Tuyệt! 🎉'); render(); } catch (err) { toast(err.message, true); }
  }
  if (a === 'L2-mdel') { if (!confirm('Xoá mốc này?')) return; try { await rpc('ct_milestone_delete', { p_id: id }); render(); } catch (err) { toast(err.message, true); } }
  if (a === 'L2-assess') return Learn.assessSheet(b.dataset.v, null);
});
// Bấm vào nút trên đường học (SVG) — phần tử <g> có data-a
