// ChildTube — trò chuyện với AI để soạn giáo trình mới hoặc sửa giáo trình có sẵn bằng lời (Module 8, giai đoạn 2).
// Máy chủ: /functions/v1/ct-ai (cloudflare/src/ai.js). AI đưa đề xuất → bố mẹ xem → bấm Chốt mới lưu.
// Mở: aiChat.open() (soạn mới) · aiChat.open(groupId) (sửa giáo trình). Dùng S, sb, rpc, toast, esc, thumb, previewSheet của app.

const AIC = { c: null, busy: false, gid: null, open_: false, onClose: null };
const AI_EXAMPLES_NEW = ['Tiếng Anh cho bé 5 tuổi, 2 tuần, mỗi ngày 15 phút', 'Bé 3 tuổi học tên con vật và tiếng kêu', 'Toán vui: đếm số và hình khối cho bé 4 tuổi', 'Kỹ năng sống: đánh răng, rửa tay, chào hỏi'];
const AI_EXAMPLES_EDIT = ['Thêm 1 chương ôn tập', 'Đổi video bài 2 sang tiếng Việt', 'Rút mỗi bài còn khoảng 10 phút', 'Thêm câu hỏi sau mỗi bài'];

async function aiCall(body) {
  const { data, error } = await sb.functions.invoke('ct-ai', { body });
  if (error) {
    let m = error.message;
    try { m = (await error.context.json()).error || m; } catch (e) { /* giữ thông báo gốc */ }
    throw new Error(m);
  }
  return data;
}
// Chữ của AI: thoát HTML, giữ xuống dòng và gạch đầu dòng
function aiText(t) {
  // dòng gạch đầu dòng là một khối riêng nên không cần <br> trước/sau (tránh hở dòng)
  let out = '';
  esc(t || '').split('\n').forEach((l, i, a) => {
    if (/^\s*[-•*]\s+/.test(l)) out += '<span class="aic-li">' + l.replace(/^\s*[-•*]\s+/, '') + '</span>';
    else out += l + (i < a.length - 1 && !/^\s*[-•*]\s+/.test(a[i + 1]) ? '<br>' : '');
  });
  return out;
}

function aiProposalCard(p, mode) {
  const kid = p.child_id ? childName(p.child_id) : '👨‍👩‍👧 Cả nhà';
  const les = (l, i) => `<div class="aic-les"><div class="aic-lt"><b>Bài ${i}.</b> ${esc(l.title)}${l.minutes ? `<span class="m"> · ${l.minutes} phút</span>` : ''}</div>
    <div class="aic-vids">${l.videos.map((v) => `<button class="aic-v ${v.role === 'extra' ? 'extra' : ''}" data-a="aic-prev" data-vid="${v.id}" data-title="${esc(v.title)}">
      <img src="${thumb(v.id)}" alt="" loading="lazy"><span>${v.role === 'extra' ? '<i>Bổ trợ</i> ' : ''}${esc(v.title)}</span></button>`).join('')}</div>
    ${l.task ? `<div class="aic-task">💬 ${esc(l.task)}</div>` : ''}</div>`;
  let n = 0;
  return `<div class="aic-prop">
    <div class="aic-ph"><span class="aic-pe">${esc(p.emoji || '📘')}</span><div class="aic-pt"><b>${esc(p.name)}</b>
      <span class="m">${kid}${p.age_label ? ' · ' + esc(p.age_label) : ''} · ${p.stats.modules} chương · ${p.stats.lessons} bài · ${p.stats.videos} video</span></div></div>
    ${p.summary ? `<p class="aic-sum">${esc(p.summary)}</p>` : ''}
    ${p.changes && p.changes.length ? `<div class="aic-chg"><b>Thay đổi</b>${p.changes.map((c) => `<div>• ${esc(c)}</div>`).join('')}</div>` : ''}
    <details class="aic-tree" ${mode === 'new' ? 'open' : ''}><summary>Xem chương & bài</summary>
      ${p.modules.map((m, mi) => `<div class="aic-mod"><div class="aic-mt">Chương ${mi + 1}. ${esc(m.title)}</div>${m.lessons.map((l) => les(l, ++n)).join('')}</div>`).join('')}
    </details>
    ${p.dups ? `<div class="aic-dups">⚠ ${p.dups} video đã có trong giáo trình khác hoặc bé đã xem. Nhắn “thay video trùng” nếu muốn đổi.</div>` : ''}
    <div class="aic-pa">${mode === 'new'
    ? '<button class="btn primary" data-a="aic-save">✅ Chốt · chọn nơi lưu…</button><span class="hint">Lưu thành giáo trình mới hoặc thêm vào một giáo trình/chương đã có.</span>'
    : '<button class="btn primary" data-a="aic-apply">✅ Áp dụng thay đổi</button><button class="btn ghost" data-a="aic-save">📥 Lưu vào chỗ khác…</button><span class="hint">Bản cũ được giữ trong Lịch sử.</span>'}</div>
  </div>`;
}

// Lần đầu dùng AI: xin đồng ý (không tích sẵn ô ghi nhớ lâu dài)
function aiConsentRender() {
  const el = $('#aic'), c = AIC.c.consent || {};
  el.innerHTML = `<div class="aic-top"><button class="icon-btn" data-a="aic-close" title="Đóng">✕</button>
    <div class="aic-title"><b>🤖 Trợ lý AI</b><span class="m">Cần bạn đồng ý trước khi dùng</span></div></div>
  <div class="aic-list"><div class="card aic-consent">
    <h3 style="margin-top:0">🔐 ${esc(c.title || 'Trợ lý AI đọc dữ liệu gia đình')}</h3>
    <p>${esc(c.desc || '')}</p>
    <ul class="hint"><li>AI chỉ đề xuất; bạn bấm Chốt thì mới lưu, bé chỉ thấy khi bạn xuất bản.</li><li>Tắt lại được bất cứ lúc nào trong Cài đặt → Quyền riêng tư.</li></ul>
    <label class="switch f-consent"><input type="checkbox" id="aic-mem"><span><b>Cho AI ghi nhớ lâu dài</b><br><span class="m">Lưu sở thích, điều cần tránh của bé để lần sau không hỏi lại. Xem và xoá được trong mục 🧠.</span></span></label>
    <button class="btn primary" data-a="aic-consent-ok">Đồng ý và bắt đầu</button>
  </div></div>`;
}

function aiRender() {
  const c = AIC.c, el = $('#aic');
  if (!el || !c) return;
  if (c.need_consent) return aiConsentRender();
  const g = c.group_id && S.groups.find((x) => x.id === c.group_id);
  const title = c.mode === 'edit' && g ? `🤖 Sửa: ${esc(g.emoji || '')} ${esc(g.name)}` : '🤖 Soạn giáo trình cùng AI';
  const lastProp = c.messages.map((m, i) => (m.proposal ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const msgs = c.messages.map((m, i) => {
    if (m.role === 'system') return `<div class="aic-sys">${esc(m.text)}${c.applied_group && /Bản nháp|Đã thêm vào/.test(m.text) ? ' <button class="btn small" data-a="aic-openg">Mở giáo trình</button>' : ''}</div>`;
    const card = m.proposal ? (i === lastProp && c.proposal ? aiProposalCard(c.proposal, c.mode) : '<div class="aic-old">(đề xuất trước — đã thay bằng bản mới hơn hoặc đã chốt)</div>') : '';
    return `<div class="aic-msg ${m.role}"><div class="aic-b">${aiText(m.text)}</div>${card}</div>`;
  }).join('');
  const ex = c.messages.filter((m) => m.role === 'user').length ? [] : (c.mode === 'edit' ? AI_EXAMPLES_EDIT : (c.examples && c.examples.length ? c.examples : AI_EXAMPLES_NEW));
  el.innerHTML = `
  <div class="aic-top">
    <button class="icon-btn" data-a="aic-close" title="Đóng">✕</button>
    <div class="aic-title"><b>${title}</b><span class="m">${c.live ? 'Claude · chỉ dùng video tìm thấy trên YouTube, bạn duyệt trước khi lưu' : '🧪 Chế độ thử — máy chủ chưa có khoá AI'}</span></div>
    <button class="icon-btn" data-a="aic-notes" title="AI đang ghi nhớ gì">🧠</button>
    <button class="btn small" data-a="aic-restart" title="Bắt đầu cuộc trò chuyện mới">↺ Mới</button>
  </div>
  <div class="aic-list" id="aic-list">${msgs}
    ${ex.length ? `<div class="aic-ex"><div class="aic-exh">Thử nhắn:</div>${ex.map((t) => `<button class="aic-exb" data-a="aic-ex">${esc(t)}</button>`).join('')}</div>` : ''}
    ${AIC.busy ? '<div class="aic-msg assistant"><div class="aic-b aic-typing"><i></i><i></i><i></i> AI đang tìm video và soạn… (thường 20–60 giây)</div></div>' : ''}
  </div>
  <form class="aic-in" id="aic-form">
    <textarea id="aic-text" rows="1" placeholder="${c.mode === 'edit' ? 'Muốn sửa gì trong giáo trình?' : 'Bé mấy tuổi, muốn học gì?'}" ${AIC.busy ? 'disabled' : ''}></textarea>
    <button class="btn primary aic-send" type="submit" ${AIC.busy ? 'disabled' : ''} aria-label="Gửi">➤</button>
  </form>`;
  const list = $('#aic-list');
  list.scrollTop = list.scrollHeight;
}

async function aiSend(text) {
  text = String(text || '').trim();
  if (!text || AIC.busy) return;
  AIC.c.messages.push({ role: 'user', text });
  AIC.busy = true; aiRender();
  try {
    AIC.c = await aiCall({ action: 'send', chat_id: AIC.c.chat_id, message: text });
    if (AIC.c.remembered && AIC.c.remembered.length) toast('🧠 Đã ghi nhớ: ' + AIC.c.remembered.join('; '));
  }
  catch (e) { AIC.c.messages.pop(); toast(e.message, true); setTimeout(() => { const t = $('#aic-text'); if (t) t.value = text; }, 0); }
  AIC.busy = false; aiRender();
}
async function aiApply(target) {
  if (AIC.busy) return;
  AIC.busy = true; aiRender();
  try {
    AIC.c = await aiCall({ action: 'apply', chat_id: AIC.c.chat_id, target: target || null });
    await quietLoad();
    toast(target && target.group_id ? 'Đã thêm vào giáo trình' : AIC.c.mode === 'edit' && AIC.gid && !target ? 'Đã áp dụng vào giáo trình' : 'Đã lưu bản nháp giáo trình');
  } catch (e) { toast(e.message, true); }
  AIC.busy = false; aiRender();
}

// Chọn nơi lưu đề xuất: giáo trình mới, chương mới trong giáo trình có sẵn, hoặc cuối một chương
function aiSavePicker() {
  const p = AIC.c.proposal;
  const curs = curricula().filter((g) => !g.archived);
  const opt = (val, label, sub, checked) => `<label class="aic-do ${sub ? 'sub' : ''}"><input type="radio" name="aic-dest" value="${val}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  const tree = curs.map((g) => `<div class="aic-dg"><b>${esc(g.emoji || '📘')} ${esc(g.name)} <span class="m">· ${childName(g.child_id)} · ${g.status === 'published' ? 'Đã xuất bản' : 'Bản nháp'}</span></b>
    ${opt('g:' + g.id, `➕ Thêm ${p.stats.modules} chương mới ở cuối`, true)}
    ${(g.modules || []).map((m, i) => opt('m:' + g.id + ':' + m.id, `↳ Nối ${p.stats.lessons} bài vào cuối <b>Chương ${i + 1}. ${esc(m.title)}</b> <span class="m">(${m.lessons.length} bài)</span>`, true)).join('')}</div>`).join('');
  sheet(`<h3>Lưu “${esc(p.name)}” vào đâu?</h3>
    <div class="hint">${p.stats.modules} chương · ${p.stats.lessons} bài · ${p.stats.videos} video. Bản cũ của giáo trình được giữ trong Lịch sử.</div>
    <div class="aic-dest">
      <div class="aic-dg">${opt('new', '🆕 <b>Tạo giáo trình mới</b> (Bản nháp, bé chưa thấy)', false, true)}</div>
      ${tree}
    </div>
    <button class="btn primary" data-a="aic-dest-ok">Lưu vào chỗ đã chọn</button>`, async (a) => {
    if (a !== 'aic-dest-ok') return;
    const v = (document.querySelector('input[name=aic-dest]:checked') || {}).value || 'new';
    const [k, gid, mid] = v.split(':');
    const target = k === 'new' ? { new: true } : { group_id: gid, module_id: k === 'm' ? mid : null };
    closeSheet();
    await aiApply(target);
  });
}
// Những điều AI đang ghi nhớ về gia đình (xem / xoá)
async function aiNotes() {
  let list = [];
  try { list = await aiCall({ action: 'notes' }); } catch (e) { return toast(e.message, true); }
  sheet(`<h3>🧠 AI đang ghi nhớ</h3>
    <div class="hint">AI tự ghi khi bố mẹ kể về sở thích, điều cần tránh, mục tiêu của bé, để lần sau không hỏi lại.</div>
    <div class="card">${list.length ? list.map((n) => `<div class="row"><div class="info"><div class="t">${esc(n.note)}</div><div class="m">${n.child ? esc(n.child) : 'Cả nhà'}</div></div>
      <button class="icon-btn" data-a="aic-note-del" data-id="${n.id}" title="Xoá">🗑</button></div>`).join('') : '<div class="empty">Chưa ghi nhớ gì. Ví dụ, hãy nhắn: “Bin rất thích khủng long, không thích nhạc quá ồn”.</div>'}</div>
    <button class="btn primary" data-a="aic-notes-close">Đóng</button>`, async (a, b) => {
    if (a === 'aic-notes-close') return closeSheet();
    if (a === 'aic-note-del') { try { await aiCall({ action: 'note_delete', id: b.dataset.id }); } catch (e) { return toast(e.message, true); } return aiNotes(); }
  });
}

async function aiClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'aic-close') return aiChat.close();
  if (a === 'aic-consent-ok') {
    try {
      await rpc('ct_consent_set', { p_kind: 'ai_assistant', p_on: true });
      if ($('#aic-mem') && $('#aic-mem').checked) await rpc('ct_consent_set', { p_kind: 'ai_memory', p_on: true });
      if (typeof F !== 'undefined') F.consents = null;
      AIC.c = await aiCall({ action: 'open', group_id: AIC.gid });
    } catch (err) { toast(err.message, true); }
    return aiRender();
  }
  if (a === 'aic-ex') return aiSend(b.textContent);
  if (a === 'aic-apply') return aiApply();
  if (a === 'aic-save') return aiSavePicker();
  if (a === 'aic-notes') return aiNotes();
  if (a === 'aic-prev') return previewSheet(b.dataset.vid, b.dataset.title, closeSheet);
  if (a === 'aic-openg') { const gid = AIC.c.applied_group; aiChat.close(); return openEditor(gid); }
  if (a === 'aic-restart') {
    if (AIC.busy) return;
    if (AIC.c.proposal && !confirm('Bỏ đề xuất chưa chốt và bắt đầu cuộc trò chuyện mới?')) return;
    try { AIC.c = await aiCall({ action: 'open', group_id: AIC.c.mode === 'edit' ? AIC.c.group_id : null, restart: true }); } catch (err) { toast(err.message, true); }
    return aiRender();
  }
}

const aiChat = {
  async open(gid, onClose) {
    AIC.gid = gid || null; AIC.onClose = onClose || null;
    let el = $('#aic');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aic';
      el.className = 'aic';
      document.body.appendChild(el);
      el.addEventListener('click', aiClick);
      el.addEventListener('submit', (e) => { e.preventDefault(); const t = $('#aic-text'); aiSend(t.value); });
      el.addEventListener('keydown', (e) => {
        if (e.target.id === 'aic-text' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer:fine)').matches) { e.preventDefault(); aiSend(e.target.value); }
      });
      el.addEventListener('input', (e) => { if (e.target.id === 'aic-text') { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; } });
    }
    el.innerHTML = '<div class="aic-list"><div class="aic-sys">Đang mở…</div></div>';
    el.classList.remove('hidden');
    document.body.classList.add('ed-open');
    try { AIC.c = await aiCall({ action: 'open', group_id: AIC.gid }); aiRender(); } catch (e) { toast(e.message, true); aiChat.close(); }
  },
  close() {
    const el = $('#aic');
    if (el) el.classList.add('hidden');
    if (!$('#ed') || $('#ed').classList.contains('hidden')) document.body.classList.remove('ed-open');
    const cb = AIC.onClose; AIC.onClose = null;
    if (cb) cb(); else render();
  },
};
