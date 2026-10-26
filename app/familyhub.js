// ChildTube — tab "Gia đình": cài đặt chia nhóm (cài một lần rồi quên). Mỗi dòng mở một trang con.
// Trang con dùng lại đúng các khối cài đặt đang có (viewSettings), tách theo tiêu đề — mọi nút bấm cũ vẫn chạy như trước.
const Hub = {
  sub: null,
  GROUPS: [
    ['kids', '👧', 'Hồ sơ các bé', /Hồ sơ các bé/],
    ['tv', '📺', 'TV & giờ xem', /TV của bé|Mã PIN|Thời gian xem|^🎬|Video$/],
    ['members', '👥', 'Thành viên', /Gia đình/],
    ['privacy', '🔐', 'Quyền riêng tư', /Quyền riêng tư/],
    ['account', '🔑', 'Tài khoản', /Tài khoản|Cài ChildTube/],
  ],
  sections() {
    const t = document.createElement('div');
    t.innerHTML = viewSettings();
    const out = {}; let cur = 'kids';
    for (const el of [...t.children]) {
      const h = el.tagName === 'H2' ? el.textContent.trim() : (el.querySelector('h2,h3') || {}).textContent || '';
      if (/Nhật ký truy cập/.test(h)) { cur = 'audit'; continue; }
      const g = this.GROUPS.find(([, , , re]) => re.test(h));
      if (el.tagName === 'H2' && g) cur = g[0];
      else if (g && g[0] === 'account') { (out.account = out.account || []).push(el.outerHTML); continue; }
      if (cur === 'audit') { if (el.tagName === 'H2') cur = 'account'; else continue; }
      if (el.matches && el.matches('[data-a=logout], p.hint') && !el.closest('.card')) { (out.account = out.account || []).push(el.outerHTML); continue; }
      (out[cur] = out[cur] || []).push(el.outerHTML);
    }
    return out;
  },
  summary(key) {
    const f = S.family || {}, ks = S.children || [], c = S.consents || {};
    if (key === 'kids') return ks.length ? ks.map((k) => `${k.name}${k.birth ? ' ' + ageOf(k.birth) : ''}`).join(' · ') : 'Chưa có hồ sơ';
    if (key === 'tv') return `${(S.tvs || []).map((t) => t.name).join(', ') || 'Chưa ghép TV'} · ${f.daily_minutes ? f.daily_minutes + ' phút/ngày' : 'không giới hạn'} · PIN`;
    if (key === 'members') return (S.members || []).map((m) => (m.me ? 'Bạn' : m.name || (m.email || '').split('@')[0])).join(' · ');
    if (key === 'privacy') return `AI: ${c.ai_assistant ? 'bật' : 'tắt'} · Ảnh: ${c.media_storage ? 'bật' : 'tắt'} · Người thân: ${c.share_relatives ? 'bật' : 'tắt'}`;
    if (key === 'account') return `${(S.members || []).find((m) => m.me) ? esc(((S.members || []).find((m) => m.me) || {}).email || '') : ''} · tên, mật khẩu, đăng xuất`;
    return '';
  },
  render() {
    const v = $('#view');
    if (S.restricted) { this.sub = 'account'; }
    if (!this.sub) {
      const row = (key, icon, title) => `<div class="item tap" data-a="H-open" data-v="${key}"><div class="ic">${icon}</div><div class="info"><div class="t">${title}</div><div class="m">${this.summary(key)}</div></div><span class="chev">›</span></div>`;
      const g = Object.fromEntries(this.GROUPS.map((x) => [x[0], x]));
      v.innerHTML = `<div class="v-head"><h1>Gia đình</h1><div class="v-subt">Cài một lần rồi quên — mọi cài đặt ở đây</div></div>
        <div class="card hub">${['kids', 'tv', 'members'].map((k) => row(k, g[k][1], g[k][2])).join('')}</div>
        <div class="card hub">${row('privacy', '🔐', 'Quyền riêng tư')}<div class="item tap" data-a="F-audit"><div class="ic">📜</div><div class="info"><div class="t">Lịch sử hoạt động</div><div class="m">Ai đã làm gì, kể cả lần bị chặn</div></div><span class="chev">›</span></div></div>
        <div class="card hub">${row('account', '🔑', 'Tài khoản')}</div>`;
      return;
    }
    const g = this.GROUPS.find((x) => x[0] === this.sub) || this.GROUPS[0];
    const sec = this.sections()[this.sub] || [];
    const me = S.me || {};
    const nameBox = this.sub === 'account' ? `<h2>🙋 Tên hiện trong bảng tin</h2><div class="card"><div class="add"><input id="h-name" value="${esc(me.name || '')}" placeholder="Ví dụ: Mẹ, Bố, Bà nội, Cô Lan" maxlength="30"><button class="btn" data-a="H-name">Lưu</button></div></div>` : '';
    v.innerHTML = `${S.restricted ? '' : `<div class="v-sub"><button class="v-back" data-a="H-back">‹</button><b>${g[1]} ${g[2]}</b></div>`}${nameBox}${sec.join('')}
      ${S.restricted ? '<button class="btn" data-a="logout" style="width:100%;margin-top:8px">Đăng xuất</button>' : ''}`;
  },
};
$('#view').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a^="H-"]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'H-open') { Hub.sub = b.dataset.v; render(); return window.scrollTo(0, 0); }
  if (a === 'H-back') { Hub.sub = null; return render(); }
  if (a === 'H-name') { try { await rpc('ct_me_name', { p_name: $('#h-name').value }); S.me.name = $('#h-name').value; toast('Đã lưu tên'); } catch (err) { toast(err.message, true); } }
});
