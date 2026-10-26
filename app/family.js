// ChildTube — thành viên & vai trò, quyền riêng tư (đồng ý), nhật ký truy cập, chế độ chỉ xem cho người thân/giáo viên.
// Máy chủ: cloudflare/src/policy.ts (vai trò, đồng ý, mức riêng tư) + audit.ts. Dùng S, rpc, sheet, toast, esc của app.js.

const ROLE_LABEL = { owner: '👑 Chủ gia đình', parent: '👨‍👩‍👧 Bố/mẹ', relative: '👵 Người thân (chỉ xem)', teacher: '🧑‍🏫 Giáo viên', child: '🧒 Bé' };
const ROLE_HINT = {
  parent: 'Quản lý như bạn: thêm video, soạn giáo trình, duyệt, dùng AI.',
  relative: 'Ông bà, cô chú: chỉ xem giáo trình đã xuất bản (khi bạn bật chia sẻ cho người thân).',
  teacher: 'Xem giáo trình đã xuất bản, ghi nhận xét học tập. Không xem lịch sử hay Nhật ký riêng.',
  child: 'Tài khoản riêng cho bé từ 7 tuổi; quyền tăng dần theo tuổi (học bài → AI Tutor 12+ → AI Mentor 16+).',
};
const ACTION_LABEL = {
  'auth.token': 'Đăng nhập', 'auth.signup': 'Đăng ký', 'auth.setup': 'Đặt mật khẩu bằng mã thiết lập',
  ct_family_update: 'Sửa cài đặt gia đình', ct_invite: 'Tạo mã mời', ct_join: 'Vào gia đình', ct_member_role: 'Đổi vai trò', ct_member_remove: 'Xoá thành viên',
  ct_consent_set: 'Đổi quyền riêng tư', ct_child_save: 'Sửa hồ sơ bé', ct_child_delete: 'Xoá hồ sơ bé', ct_pair_tv: 'Ghép TV', ct_tv_remove: 'Gỡ TV',
  ct_tv_set_child: 'Đổi hồ sơ xem trên TV', ct_history_clear: 'Xoá lịch sử xem', ct_approve: 'Duyệt video', ct_approve_source: 'Duyệt cả kênh',
  ct_set_approval: 'Đổi cách duyệt kênh', ct_cur_publish: 'Xuất bản / ẩn giáo trình', ct_cur_save: 'Sửa giáo trình', 'ct-yt.add': 'Thêm kênh/video',
  'ct-ai.apply': 'Chốt đề xuất AI', 'ct-ai.note_delete': 'Xoá ghi nhớ của AI', ct_state: 'Xem dữ liệu gia đình',
};
const F = { consents: null, loading: false };

// ---------- Thành viên ----------
function familyMembersHtml() {
  const me = S.me || { role: 'owner' }, owner = me.role === 'owner';
  const kid = (id) => { const c = (S.children || []).find((x) => x.id === id); return c ? ` · ${esc(c.emoji)} ${esc(c.name)}` : ''; };
  return `<label>Thành viên & vai trò</label>
    ${S.members.map((m) => `<div class="row"><div class="av">${(ROLE_LABEL[m.role] || '👤').split(' ')[0]}</div>
      <div class="info"><div class="t">${esc(m.email || '(chưa có email)')}${m.me ? ' (bạn)' : ''}</div><div class="m">${esc((ROLE_LABEL[m.role] || m.role).replace(/^\S+ /, ''))}${kid(m.child_id)}</div></div>
      ${owner && !m.me ? `<button class="icon-btn" data-a="F-role" data-id="${m.user_id}" title="Đổi vai trò">✎</button>` : ''}</div>`).join('')}
    <div class="toolbar">${owner ? '<button class="btn small primary-s" data-a="F-invite">➕ Mời thành viên</button>' : ''}<button class="btn small" data-a="join">Nhập mã mời</button></div>`;
}
function inviteSheet() {
  const kids = S.children || [];
  const opt = (r) => `<label class="aic-do"><input type="radio" name="f-role" value="${r}" ${r === 'parent' ? 'checked' : ''}><span><b>${ROLE_LABEL[r]}</b><br><span class="m">${ROLE_HINT[r]}</span></span></label>`;
  sheet(`<h3>Mời thành viên</h3>
    <div class="aic-dest">${['parent', 'relative', 'teacher', 'child'].map(opt).join('')}</div>
    <div id="f-kid" class="hidden"><label>Tài khoản của bé nào?</label><select id="f-child">${kids.map((k) => `<option value="${k.id}">${esc(k.emoji)} ${esc(k.name)}</option>`).join('')}</select>
      ${kids.length ? '' : '<div class="hint">Hãy tạo hồ sơ bé trước.</div>'}</div>
    <button class="btn primary" data-a="F-invite-ok">Tạo mã mời</button>
    <div class="hint">Mã dùng được một lần, hết hạn sau 7 ngày. Người được mời đăng nhập app → Cài đặt → "Nhập mã mời".</div>`, async (a) => {
    if (a !== 'F-invite-ok') return;
    const role = (document.querySelector('input[name=f-role]:checked') || {}).value || 'parent';
    try {
      const code = await rpc('ct_invite', { p_role: role, p_child: role === 'child' ? ($('#f-child') || {}).value : null });
      sheet(`<h3>Mã mời ${esc(ROLE_LABEL[role])}</h3><div class="code-big">${esc(code)}</div>
        <div class="hint">Gửi mã này cho người được mời. Dùng một lần, hết hạn sau 7 ngày.</div><button class="btn primary" data-a="F-close">Xong</button>`, () => closeSheet());
    } catch (e) { toast(e.message, true); }
  });
  sheetChange = () => { const v = (document.querySelector('input[name=f-role]:checked') || {}).value; $('#f-kid').classList.toggle('hidden', v !== 'child'); };
}
function roleSheet(uid) {
  const m = S.members.find((x) => x.user_id === uid);
  if (!m) return;
  const kids = S.children || [];
  sheet(`<h3>Vai trò của ${esc(m.email || '')}</h3>
    <div class="aic-dest">${['owner', 'parent', 'relative', 'teacher', 'child'].map((r) => `<label class="aic-do"><input type="radio" name="f-r" value="${r}" ${m.role === r ? 'checked' : ''}><span><b>${ROLE_LABEL[r]}</b>${ROLE_HINT[r] ? `<br><span class="m">${ROLE_HINT[r]}</span>` : '<br><span class="m">Toàn quyền, kể cả mời và đổi vai trò.</span>'}</span></label>`).join('')}</div>
    <div id="f-kid2" class="${m.role === 'child' ? '' : 'hidden'}"><label>Hồ sơ bé</label><select id="f-child2">${kids.map((k) => `<option value="${k.id}" ${m.child_id === k.id ? 'selected' : ''}>${esc(k.emoji)} ${esc(k.name)}</option>`).join('')}</select></div>
    <button class="btn primary" data-a="F-role-ok">Lưu vai trò</button>
    <button class="btn" data-a="F-remove" style="width:100%;margin-top:8px;color:var(--danger)">Xoá khỏi gia đình</button>`, async (a) => {
    try {
      if (a === 'F-role-ok') {
        const role = (document.querySelector('input[name=f-r]:checked') || {}).value;
        await rpc('ct_member_role', { p_user: uid, p_role: role, p_child: role === 'child' ? ($('#f-child2') || {}).value : null });
        closeSheet(); toast('Đã đổi vai trò'); return load();
      }
      if (a === 'F-remove') {
        if (!confirm('Xoá ' + (m.email || 'thành viên này') + ' khỏi gia đình? Họ sẽ bị đăng xuất.')) return;
        await rpc('ct_member_remove', { p_user: uid }); closeSheet(); toast('Đã xoá thành viên'); return load();
      }
    } catch (e) { toast(e.message, true); }
  });
  sheetChange = () => { const v = (document.querySelector('input[name=f-r]:checked') || {}).value; $('#f-kid2').classList.toggle('hidden', v !== 'child'); };
}

// ---------- Quyền riêng tư & đồng ý ----------
function privacyHtml() {
  if (!F.consents && !F.loading) { F.loading = true; rpc('ct_consents').then((c) => { F.consents = c; F.loading = false; if (tab === 'settings') render(); }).catch(() => { F.loading = false; }); }
  const list = F.consents || [];
  return `<h2>🔐 Quyền riêng tư & đồng ý</h2>
  <div class="card">
    <div class="hint" style="margin-top:0">Mặc định tắt hết. Mỗi việc chỉ chạy khi bạn bật; tắt lúc nào cũng được. Dữ liệu của bé không bao giờ được công khai.</div>
    ${list.length ? list.map((c) => `<label class="switch f-consent"><input type="checkbox" data-consent="${c.kind}" ${c.granted ? 'checked' : ''}>
      <span><b>${esc(c.title)}</b><br><span class="m">${esc(c.desc)}</span></span></label>`).join('') : '<div class="m">Đang tải…</div>'}
  </div>
  <h2>📜 Nhật ký truy cập</h2>
  <div class="card"><div class="hint" style="margin-top:0">Ai đã làm gì trong gia đình, kể cả các lần bị chặn hoặc đăng nhập sai. Không lưu mật khẩu, mã PIN hay nội dung trò chuyện.</div>
    <button class="btn small" data-a="F-audit">Xem nhật ký</button></div>`;
}
// Chi tiết nhật ký dạng chữ: {"p":{"name":"X"},"p_on":true} → name: X · on: bật
function auditDetail(d) {
  let o; try { o = JSON.parse(d || '{}'); } catch (e) { return d || ''; }
  const out = [];
  const walk = (v, k) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) { for (const [kk, vv] of Object.entries(v)) walk(vv, kk === 'p' ? k : kk); return; }
    const key = String(k || '').replace(/^p_/, '');
    out.push((key ? key + ': ' : '') + (v === true ? 'bật' : v === false ? 'tắt' : Array.isArray(v) ? v.join(', ') : v));
  };
  walk(o, '');
  return out.join(' · ');
}
async function auditSheet() {
  let rows = [];
  try { rows = await rpc('ct_audit', { p_limit: 150 }); } catch (e) { return toast(e.message, true); }
  const when = (t) => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  sheet(`<h3>📜 Nhật ký truy cập</h3>
    <div class="card f-audit">${rows.length ? rows.map((r) => `<div class="row"><div class="av">${r.ok ? '✓' : '⛔'}</div>
      <div class="info"><div class="t">${esc(ACTION_LABEL[r.action] || r.action)}${r.ok ? '' : /^auth\./.test(r.action) ? ' — sai thông tin' : ' — bị chặn'}</div>
        <div class="m">${esc(r.email || '')}${r.role ? ' · ' + esc((ROLE_LABEL[r.role] || r.role).replace(/^\S+ /, '')) : ''} · ${when(r.at)}</div>
        ${r.target || (r.detail && r.detail !== '{}') ? `<div class="m f-detail">${esc([r.target, /^[{[]/.test(r.detail || '') ? auditDetail(r.detail) : r.detail].filter(Boolean).join(' · '))}</div>` : ''}</div></div>`).join('') : '<div class="empty">Chưa có hoạt động nào.</div>'}</div>
    <button class="btn primary" data-a="F-close">Đóng</button>`, () => closeSheet());
}

$('#view').addEventListener('click', (e) => {
  const b = e.target.closest('[data-a^="F-"]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'F-invite') return inviteSheet();
  if (a === 'F-role') return roleSheet(b.dataset.id);
  if (a === 'F-audit') return auditSheet();
});
$('#view').addEventListener('change', async (e) => {
  const k = e.target && e.target.dataset && e.target.dataset.consent;
  if (!k) return;
  const on = e.target.checked;
  if (on && k === 'child_ai' && !confirm('Cho bé từ 12 tuổi trò chuyện với AI? Bạn xem được toàn bộ hội thoại.')) { e.target.checked = false; return; }
  try {
    await rpc('ct_consent_set', { p_kind: k, p_on: on });
    const c = F.consents && F.consents.find((x) => x.kind === k); if (c) c.granted = on;
    S.consents = S.consents || {}; if (on) S.consents[k] = true; else delete S.consents[k];
    toast(on ? 'Đã bật' : 'Đã tắt');
  } catch (err) { e.target.checked = !on; toast(err.message, true); }
});

// ---------- Chế độ chỉ xem (người thân, giáo viên) ----------
const _renderFull = render;
render = function () {
  if (!S || !S.restricted) { document.body.classList.remove('ro'); return _renderFull(); }
  document.body.classList.add('ro');
  const role = (S.me && S.me.role) || 'relative';
  const kids = (S.children || []).map((c) => `${esc(c.emoji)} ${esc(c.name)}`).join(' · ');
  const cur = (S.groups || []).filter((g) => g.kind === 'collection');
  const pl = (S.groups || []).filter((g) => g.kind === 'topic');
  const lessons = (g) => (g.modules || []).map((m, i) => `<div class="m"><b>Chương ${i + 1}. ${esc(m.title)}</b> · ${m.lessons.map((l) => esc(l.title)).join(' · ')}</div>`).join('');
  $('#view').innerHTML = `<div class="card ro-banner"><b>${ROLE_LABEL[role] || role}</b><div class="hint" style="margin:4px 0 0">Bạn đang xem gia đình <b>${esc(S.family.name)}</b>${kids ? ' (' + kids + ')' : ''} ở chế độ chỉ xem.</div></div>
    ${!S.shared ? '<div class="card"><div class="empty">Bố mẹ chưa bật chia sẻ cho ' + (role === 'teacher' ? 'giáo viên' : 'người thân') + '. Khi được bật, các giáo trình đã xuất bản sẽ hiện ở đây.</div></div>' : ''}
    ${cur.length ? `<h2>📚 Giáo trình</h2><div class="card">${cur.map((g) => `<div class="row"><div class="av">${esc(g.emoji || '📘')}</div><div class="info"><div class="t">${esc(g.name)}</div>${lessons(g)}</div></div>`).join('')}</div>` : ''}
    ${pl.length ? `<h2>🎵 Playlist</h2><div class="card">${pl.map((g) => `<div class="row"><div class="av">${esc(g.emoji || '🎵')}</div><div class="info"><div class="t">${esc(g.name)}</div><div class="m">${g.items.length} mục</div></div></div>`).join('')}</div>` : ''}
    <button class="btn" data-a="logout" style="width:100%;margin-top:8px">Đăng xuất</button>`;
};
