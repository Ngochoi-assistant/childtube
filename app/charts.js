// ChildTube — biểu đồ SVG nhẹ (không thư viện): vòng tiến độ, mạng nhện năng lực, bong bóng sở thích, dòng thời gian lộ trình, đường học.
// Chữ trong biểu đồ luôn nằm trong khung (chừa lề), để không bị cắt ở màn hình hẹp.

const ch = {
  esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),

  // Vòng tiến độ: giá trị / tối đa, chữ lớn ở giữa
  ring(value, max, color, big, small, size = 112) {
    const r = size / 2 - 10, c = 2 * Math.PI * r, p = max ? Math.max(0, Math.min(1, value / max)) : 0;
    return `<svg class="cv-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${ch.esc(big)} ${ch.esc(small)}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="12"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="${size / 2 - 1}" text-anchor="middle" font-size="${size / 4.6}" font-weight="800" fill="var(--ink)">${ch.esc(big)}</text>
      <text x="50%" y="${size / 2 + size / 7}" text-anchor="middle" font-size="12" fill="var(--mute)">${ch.esc(small)}</text></svg>`;
  },

  // Mạng nhện: items [{name, icon, level 0–5}], vạch tham khảo (benchmark) vẽ nét đứt
  radar(items, benchmark, size = 300) {
    const n = items.length, cx = size / 2, cy = size / 2 + 4, R = size / 2 - 58;
    if (n < 3) return '';
    const pt = (i, v) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
    const poly = (f) => items.map((it, i) => pt(i, f(it)).map((x) => x.toFixed(1)).join(',')).join(' ');
    const grid = [1, 2 / 3, 1 / 3].map((k) => `<polygon points="${poly(() => k)}" fill="none" stroke="var(--line)"/>`).join('');
    const axes = items.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)"/>`; }).join('');
    const labels = items.map((it, i) => {
      const [x, y] = pt(i, 1.2), anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end';
      return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" font-size="12" font-weight="700" fill="var(--ink)">${ch.esc(it.icon + ' ' + it.name)}</text>`;
    }).join('');
    const bench = benchmark ? `<polygon points="${poly(() => benchmark / 5)}" fill="rgba(58,111,247,.10)" stroke="var(--blue)" stroke-width="2" stroke-dasharray="5 4"/>` : '';
    const mine = `<polygon points="${poly((it) => Math.max(0.04, (it.level || 0) / 5))}" fill="rgba(255,90,78,.25)" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round"/>`;
    const dots = items.map((it, i) => { const [x, y] = pt(i, Math.max(0.04, (it.level || 0) / 5)); return it.level ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="var(--brand)"/>` : ''; }).join('');
    return `<svg class="cv-radar" viewBox="${-Math.round(size * 0.14)} 0 ${Math.round(size * 1.28)} ${size + 8}" width="100%" role="img" aria-label="Bản đồ năng lực">${grid}${axes}${bench}${mine}${dots}${labels}</svg>`;
  },

  // Bong bóng sở thích: to = nhắc nhiều; xếp xoắn ốc không chồng nhau
  bubbles(list, width = 320, height = 170) {
    if (!list.length) return '';
    const colors = ['#ff5a4e', '#8b5cf6', '#3a6ff7', '#1f9d61', '#ffb020', '#ec4899', '#0ea5e9', '#f97316'];
    const max = Math.max(...list.map((x) => x.n));
    const placed = [];
    list.slice(0, 8).forEach((it, i) => {
      const r = 26 + 30 * Math.sqrt(it.n / max);
      for (let t = 0; t < 600; t++) {
        const a = t * 0.35, d = 3 * t ** 0.62;
        const x = width / 2 + Math.cos(a) * d * 1.6, y = height / 2 + Math.sin(a) * d * 0.8;
        if (x - r < 2 || x + r > width - 2 || y - r < 2 || y + r > height - 2) continue;
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + 4)) { placed.push({ x, y, r, it, c: colors[i % colors.length] }); break; }
      }
    });
    return `<svg class="cv-bub" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Sở thích">${placed.map((p) => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${p.c}"/>
      <text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" font-size="${Math.max(11, p.r / 3.2).toFixed(1)}" font-weight="700" fill="#fff">${ch.esc(p.it.name.length > 12 ? p.it.name.slice(0, 11) + '…' : p.it.name)}</text>`).join('')}</svg>`;
  },

  // Đường lộ trình ngang 3 → 18 tuổi cho dashboard: giai đoạn đã qua / hiện tại / phía trước, bé đứng ở tuổi hiện tại, cờ mục tiêu
  journey(rm, W = 340) {
    const H = 112, L = 14, R = W - 44, Y = 52, A0 = 3, A1 = 18, sx = (a) => L + (R - L) * (a - A0) / (A1 - A0);
    let out = '';
    for (const s of rm.stages || []) {
      const x0 = sx(s.from), x1 = sx(s.to + 1) - 4, now = s.state === 'now';
      out += `<rect x="${x0.toFixed(1)}" y="${Y - 5}" width="${(x1 - x0).toFixed(1)}" height="10" rx="5" fill="${s.state === 'past' ? 'var(--ok)' : now ? 'var(--brand)' : 'var(--line)'}"/>
        <text x="${((x0 + x1) / 2).toFixed(1)}" y="${Y + 30}" text-anchor="middle" font-size="11" font-weight="${now ? 800 : 600}" fill="${now ? 'var(--ink)' : 'var(--mute)'}">${ch.esc(s.name.replace('Khám phá sở thích', 'Sở thích'))}</text>
        <text x="${((x0 + x1) / 2).toFixed(1)}" y="${Y + 45}" text-anchor="middle" font-size="10" fill="var(--mute)">${s.from}–${s.to}t</text>`;
    }
    const age = rm.child.age == null ? A0 : Math.max(A0, Math.min(A1 - 1, rm.child.age)), ax = sx(age + 0.5), left = ax < 70;
    out += `<circle cx="${ax.toFixed(1)}" cy="${Y}" r="17" fill="var(--card)" stroke="var(--brand)" stroke-width="3"/><text x="${ax.toFixed(1)}" y="${Y + 6}" text-anchor="middle" font-size="17">${ch.esc(rm.child.emoji || '🧒')}</text>
      <text x="${(left ? L - 4 : ax).toFixed(1)}" y="${Y - 26}" text-anchor="${left ? 'start' : 'middle'}" font-size="11" font-weight="800" fill="var(--brand)">${rm.child.age != null ? rm.child.age + ' tuổi · ' : ''}bé đang ở đây</text>
      <text x="${R + 24}" y="${Y + 8}" text-anchor="middle" font-size="22">🎯</text>`;
    return `<svg class="cv-journey" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Lộ trình">${out}</svg>`;
  },

  // Dòng thời gian lộ trình: giai đoạn đã qua / hiện tại (thẻ tiến độ) / định hướng / mục tiêu
  timeline(rm) {
    const W = 340, rows = [];
    let y = 36;
    for (const s of rm.stages) {
      if (s.state === 'now') { rows.push({ type: 'now', y, s }); y += 108; } else { rows.push({ type: s.state, y, s }); y += 76; }
    }
    const goal = (rm.goals || []).filter((g) => g.status !== 'archived').slice(0, 3);
    if (goal.length) { rows.push({ type: 'goal', y, goal }); y += 40 + goal.length * 20; }
    const H = y + 10, nowRow = rows.find((r) => r.type === 'now');
    const age = rm.child.age;
    const node = (r) => {
      const s = r.s;
      if (r.type === 'past') return `<circle cx="34" cy="${r.y}" r="15" fill="var(--ok)"/><text x="34" y="${r.y + 5}" text-anchor="middle" font-size="14" fill="#fff">✓</text>
        <text x="62" y="${r.y - 4}" font-size="15" font-weight="700" fill="var(--ink)">${s.from}–${s.to} tuổi · ${ch.esc(s.name)}</text><text x="62" y="${r.y + 15}" font-size="12" fill="var(--mute)">${ch.esc(s.focus)} — đã qua</text>`;
      if (r.type === 'future') return `<circle cx="34" cy="${r.y}" r="13" fill="var(--card)" stroke="var(--blue)" stroke-width="3"/>
        <text x="62" y="${r.y - 4}" font-size="15" font-weight="700" fill="var(--ink)">${s.from}–${s.to} tuổi · ${ch.esc(s.name)}</text><text x="62" y="${r.y + 15}" font-size="12" fill="var(--mute)">${ch.esc(s.focus)}</text>`;
      if (r.type === 'now') {
        const p = rm.progress.total ? rm.progress.done / rm.progress.total : 0;
        return `<circle cx="34" cy="${r.y + 18}" r="19" fill="var(--brand)"/><text x="34" y="${r.y + 25}" text-anchor="middle" font-size="17">${ch.esc(rm.child.emoji || '🧒')}</text>
          <rect x="60" y="${r.y - 14}" width="${W - 64}" height="86" rx="14" fill="var(--brand-soft)"/>
          <text x="74" y="${r.y + 8}" font-size="15" font-weight="800" fill="var(--ink)">Bây giờ${age != null ? ' · ' + age + ' tuổi' : ''} · ${ch.esc(s.name)}</text>
          <text x="74" y="${r.y + 26}" font-size="12" fill="var(--mute)">${ch.esc(s.focus)}</text>
          <rect x="74" y="${r.y + 36}" width="${W - 92}" height="8" rx="4" fill="var(--card)"/><rect x="74" y="${r.y + 36}" width="${((W - 92) * p).toFixed(1)}" height="8" rx="4" fill="var(--brand)"/>
          <text x="74" y="${r.y + 62}" font-size="12" fill="var(--mute)">${rm.progress.total ? `${rm.progress.done}/${rm.progress.total} mốc năm nay` : 'Chưa có mốc năm nay — thêm bên dưới'}</text>`;
      }
      return `<circle cx="34" cy="${r.y + 14}" r="19" fill="var(--vio)"/><text x="34" y="${r.y + 20}" text-anchor="middle" font-size="16">🎯</text>
        <rect x="60" y="${r.y - 10}" width="${W - 64}" height="${30 + r.goal.length * 20}" rx="14" fill="var(--vio-soft)"/>
        <text x="74" y="${r.y + 10}" font-size="14" font-weight="800" fill="var(--ink)">Mục tiêu dài hạn</text>
        ${r.goal.map((g, i) => `<text x="74" y="${r.y + 30 + i * 20}" font-size="12.5" fill="var(--vio-ink)">${{ school: '🏫', field: '🔭', career: '💼', skill: '⭐', personal: '🌱' }[g.kind] || '•'} ${ch.esc(g.title)}${g.target_age ? ' · ' + g.target_age + ' tuổi' : ''} · ${{ parent: 'bố mẹ', child: 'bé', ai: 'AI' }[g.proposed_by]} ${{ exploring: '(đang tìm hiểu)', active: '', paused: '(tạm dừng)', completed: '(đã xong)' }[g.status] || ''}</text>`).join('')}`;
    };
    const lastY = rows.length ? rows[rows.length - 1].y + 14 : 40;
    const nowY = nowRow ? nowRow.y + 18 : 36;
    return `<svg class="cv-time" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Lộ trình">
      <line x1="34" y1="22" x2="34" y2="${lastY}" stroke="var(--line)" stroke-width="6" stroke-linecap="round"/>
      <line x1="34" y1="22" x2="34" y2="${nowY}" stroke="var(--brand)" stroke-width="6" stroke-linecap="round"/>
      ${rows.map(node).join('')}</svg>`;
  },

  // Đường học dạng bản đồ: các bài là vòng tròn nối nhau; bài đã xong ✓, bài tiếp theo nổi bật
  path(lessons) {
    const W = 360, gap = 92, xs = [180, 268, 180, 92];
    const pts = lessons.map((l, i) => ({ x: xs[i % 4], y: 56 + i * gap, l }));
    const H = (pts.length ? pts[pts.length - 1].y : 0) + 70;
    const d = pts.map((p, i) => (i ? `S ${(p.x + pts[i - 1].x) / 2 + (i % 2 ? 60 : -60)} ${p.y - gap / 2}, ${p.x} ${p.y}` : `M ${p.x} ${p.y}`)).join(' ');
    const lbl = (p, t, sub, bold) => {
      const right = p.x <= 180, x = right ? p.x + 50 : p.x - 50, a = right ? 'start' : 'end';
      const tt = t.length > 24 ? t.slice(0, 23) + '…' : t;
      return `<text x="${x}" y="${p.y - 2}" text-anchor="${a}" font-size="14" font-weight="${bold ? 800 : 600}" fill="${bold ? 'var(--ink)' : 'var(--mute)'}">${ch.esc(tt)}</text>
        ${sub ? `<text x="${x}" y="${p.y + 16}" text-anchor="${a}" font-size="12" fill="var(--mute)">${ch.esc(sub)}</text>` : ''}`;
    };
    return `<svg class="cv-path" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Đường học">
      <path d="${d}" fill="none" stroke="var(--path)" stroke-width="14" stroke-linecap="round" stroke-dasharray="2 24"/>
      ${pts.map((p) => {
        const l = p.l;
        if (l.state === 'done') return `<g class="cv-node" data-a="L2-lesson" data-id="${l.id}"><circle cx="${p.x}" cy="${p.y}" r="32" fill="var(--ok)"/><text x="${p.x}" y="${p.y + 9}" text-anchor="middle" font-size="26" fill="#fff">✓</text>${lbl(p, l.title, l.sub, false)}</g>`;
        if (l.state === 'next') return `<g class="cv-node" data-a="L2-lesson" data-id="${l.id}"><circle cx="${p.x}" cy="${p.y}" r="46" fill="none" stroke="var(--brand)" stroke-width="3" opacity=".35"/><circle cx="${p.x}" cy="${p.y}" r="38" fill="var(--brand)"/><text x="${p.x + 3}" y="${p.y + 11}" text-anchor="middle" font-size="30" fill="#fff">▶</text>${lbl(p, 'Tiếp: ' + l.title, l.sub, true)}</g>`;
        if (l.state === 'chapter') return `<g><rect x="40" y="${p.y - 26}" width="280" height="52" rx="16" fill="var(--blue-soft)"/><text x="180" y="${p.y - 2}" text-anchor="middle" font-size="13.5" font-weight="800" fill="var(--blue)">${ch.esc(l.title)}</text><text x="180" y="${p.y + 16}" text-anchor="middle" font-size="12" fill="var(--mute)">${ch.esc(l.sub || '')}</text></g>`;
        return `<g class="cv-node" data-a="L2-lesson" data-id="${l.id}"><circle cx="${p.x}" cy="${p.y}" r="30" fill="var(--card)" stroke="var(--path)" stroke-width="4"/><text x="${p.x}" y="${p.y + 8}" text-anchor="middle" font-size="22">${ch.esc(l.icon || '•')}</text>${lbl(p, l.title, l.sub, false)}</g>`;
      }).join('')}</svg>`;
  },
};
