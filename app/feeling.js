// ChildTube — gắn Cảm xúc / Hoạt động vào bài đăng (như Facebook "Bạn đang cảm thấy thế nào?").
// Bài đăng lưu data.feel = { e, t } (biểu tượng, chữ) và data.act = { e, v, t } (biểu tượng, động từ, việc gì);
// data.mood (vui / bình thường / mệt / buồn / cáu) vẫn ghi theo nhóm của cảm xúc để TV, thống kê dùng.
const FEELINGS = [
  ['😊', 'vui vẻ', 'vui'], ['🥰', 'hạnh phúc', 'vui'], ['😍', 'được yêu thương', 'vui'], ['🤩', 'hào hứng', 'vui'],
  ['😆', 'phấn khích', 'vui'], ['😄', 'thích thú', 'vui'], ['😁', 'tuyệt vời', 'vui'], ['🤗', 'ấm áp', 'vui'],
  ['😌', 'tự hào', 'vui'], ['😎', 'tự tin', 'vui'], ['💪', 'mạnh mẽ', 'vui'], ['🌟', 'giỏi giang', 'vui'],
  ['🙏', 'biết ơn', 'vui'], ['😋', 'no nê', 'vui'], ['😜', 'tinh nghịch', 'vui'], ['🤪', 'ngộ nghĩnh', 'vui'],
  ['🥳', 'vui như Tết', 'vui'], ['😘', 'được cưng chiều', 'vui'], ['🙂', 'bình thường', 'bình thường'], ['😇', 'bình yên', 'bình thường'],
  ['😌', 'thư giãn', 'bình thường'], ['🧐', 'tò mò', 'bình thường'], ['😮', 'ngạc nhiên', 'bình thường'], ['☺️', 'ngại ngùng', 'bình thường'],
  ['😕', 'bối rối', 'bình thường'], ['🤤', 'đói bụng', 'bình thường'], ['😑', 'chán', 'bình thường'], ['🤔', 'đang suy nghĩ', 'bình thường'],
  ['😴', 'buồn ngủ', 'mệt'], ['🥱', 'mệt mỏi', 'mệt'], ['🤒', 'ốm', 'mệt'], ['🤧', 'sổ mũi', 'mệt'],
  ['🤕', 'bị đau', 'mệt'], ['🦷', 'mọc răng', 'mệt'], ['🥺', 'nhớ bố mẹ', 'buồn'], ['😢', 'buồn', 'buồn'],
  ['😭', 'khóc nhè', 'buồn'], ['🥹', 'tủi thân', 'buồn'], ['😨', 'sợ hãi', 'buồn'], ['😟', 'lo lắng', 'buồn'],
  ['😠', 'cáu kỉnh', 'cáu'], ['😤', 'giận dỗi', 'cáu'], ['😣', 'bực bội', 'cáu'], ['😒', 'hờn dỗi', 'cáu'],
];
const FEEL_ACTS = [
  ['🎉', 'ăn mừng', ['sinh nhật', 'ngày đầu đi học', 'Tết', 'Trung thu', 'mọc chiếc răng đầu tiên', 'tròn 1 tuổi']],
  ['🍽️', 'ăn', ['cơm', 'cháo', 'nho', 'chuối', 'hoa quả', 'bánh', 'sữa chua', 'kem']],
  ['🥛', 'uống', ['sữa', 'nước cam', 'nước', 'sinh tố']],
  ['🎮', 'chơi', ['xếp hình', 'lego', 'bóng', 'búp bê', 'ô tô', 'cầu trượt', 'trốn tìm', 'với bạn']],
  ['📖', 'đọc', ['truyện cổ tích', 'sách tranh', 'truyện trước khi ngủ']],
  ['📺', 'xem', ['hoạt hình', 'ChildTube', 'ảnh gia đình']],
  ['🎧', 'nghe', ['nhạc thiếu nhi', 'bố mẹ kể chuyện', 'ông bà hát ru']],
  ['✏️', 'học', ['đếm số', 'chữ cái', 'tô màu', 'tiếng Anh', 'màu sắc', 'con vật']],
  ['🎨', 'vẽ', ['tranh', 'bằng sáp màu', 'bằng tay']],
  ['🏃', 'tập', ['đi', 'nói', 'xe đạp', 'bơi', 'tự xúc ăn', 'đi vệ sinh']],
  ['🚗', 'đi', ['công viên', 'nhà ông bà', 'trường', 'siêu thị', 'sở thú', 'du lịch', 'khám bác sĩ']],
  ['🛁', 'tắm', ['bồn', 'cùng bố', 'cùng mẹ']],
  ['😴', 'ngủ', ['trưa', 'cùng gấu bông', 'ngon']],
  ['🎂', 'gặp', ['ông bà', 'cô giáo', 'các bạn', 'anh chị']],
];
const feelNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
// Chữ hiện trên bài: "đang 😊 cảm thấy vui vẻ" · "đang 🍽️ ăn nho"
function feelText(d) {
  if (!d) return '';
  const parts = [];
  if (d.feel && d.feel.t) parts.push(`${esc(d.feel.e || '')} cảm thấy <b>${esc(d.feel.t)}</b>`);
  if (d.act && d.act.v) parts.push(`${esc(d.act.e || '')} ${esc(d.act.v)}${d.act.t ? ` <b>${esc(d.act.t)}</b>` : ''}`);
  return parts.length ? 'đang ' + parts.join(' và ') : '';
}
// Bảng chọn toàn màn hình (đè lên khung soạn bài, không mất chữ đang gõ). done({ feel, act })
function feelPicker(cur, done) {
  let st = { tab: cur && cur.act && !cur.feel ? 'act' : 'feel', q: '', cat: null, feel: cur && cur.feel || null, act: cur && cur.act || null };
  let el = $('#fp');
  if (!el) { el = document.createElement('div'); el.id = 'fp'; el.className = 'fp hidden'; document.body.appendChild(el); }
  const close = () => { el.classList.add('hidden'); el.innerHTML = ''; };
  const finish = () => { close(); done({ feel: st.feel, act: st.act }); };
  const paint = () => {
    const q = feelNorm(st.q);
    let body = '';
    if (st.tab === 'feel') {
      const list = FEELINGS.filter(([, t]) => !q || feelNorm(t).includes(q));
      body = `<div class="fp-grid">${list.map(([e, t, m], i) => `<button class="fp-cell ${st.feel && st.feel.t === t ? 'on' : ''}" data-fp="feel" data-i="${FEELINGS.indexOf(list[i])}"><span>${e}</span>${esc(t)}</button>`).join('')}
        ${q && !list.some(([, t]) => feelNorm(t) === q) ? `<button class="fp-cell" data-fp="feel-own"><span>💭</span>${esc(st.q)}</button>` : ''}</div>`;
    } else if (st.cat == null) {
      const list = FEEL_ACTS.filter(([, v, ex]) => !q || feelNorm(v).includes(q) || ex.some((x) => feelNorm(x).includes(q)));
      body = `<div class="fp-grid">${list.map(([e, v]) => `<button class="fp-cell go" data-fp="cat" data-i="${FEEL_ACTS.findIndex((x) => x[1] === v)}"><span>${e}</span>Đang ${esc(v)}…<i>›</i></button>`).join('')}</div>`;
    } else {
      const [e, v, ex] = FEEL_ACTS[st.cat];
      const list = ex.filter((x) => !q || feelNorm(x).includes(q));
      body = `<button class="fp-back" data-fp="cats">‹ ${e} Đang ${esc(v)}…</button><div class="fp-list">
        ${st.q.trim() ? `<button class="fp-row" data-fp="act-own"><span>${e}</span>${esc(v)} <b>${esc(st.q.trim())}</b></button>` : ''}
        ${list.map((x) => `<button class="fp-row ${st.act && st.act.v === v && st.act.t === x ? 'on' : ''}" data-fp="act" data-t="${esc(x)}"><span>${e}</span>${esc(v)} <b>${esc(x)}</b></button>`).join('')}
        <button class="fp-row" data-fp="act" data-t=""><span>${e}</span>Chỉ ghi “đang ${esc(v)}”</button></div>`;
    }
    const sel = feelText({ feel: st.feel, act: st.act });
    el.innerHTML = `<div class="fp-top"><button data-fp="x" aria-label="Đóng">✕</button><b>${st.tab === 'feel' ? 'Bé đang cảm thấy thế nào?' : 'Bé đang làm gì?'}</b><button class="fp-done" data-fp="done">Xong</button></div>
      <div class="fp-tabs"><button class="${st.tab === 'feel' ? 'on' : ''}" data-fp="tab" data-v="feel">Cảm xúc</button><button class="${st.tab === 'act' ? 'on' : ''}" data-fp="tab" data-v="act">Hoạt động</button></div>
      <div class="fp-search"><span>🔍</span><input id="fp-q" placeholder="${st.tab === 'act' && st.cat != null ? 'Gõ việc bé đang làm…' : 'Tìm kiếm'}" value="${esc(st.q)}" autocomplete="off"></div>
      ${sel ? `<div class="fp-sel">${sel}<button data-fp="clear" aria-label="Bỏ">✕</button></div>` : ''}
      <div class="fp-body">${body}</div>`;
  };
  el.onclick = (ev) => {
    const b = ev.target.closest('[data-fp]'); if (!b) return;
    const a = b.dataset.fp;
    if (a === 'x') return close();
    if (a === 'done') return finish();
    if (a === 'tab') { st.tab = b.dataset.v; st.q = ''; st.cat = null; return paint(); }
    if (a === 'clear') { st.feel = null; st.act = null; return paint(); }
    if (a === 'feel') { const [e, t, m] = FEELINGS[+b.dataset.i]; st.feel = { e, t, m }; return finish(); }
    if (a === 'feel-own') { st.feel = { e: '💭', t: st.q.trim().slice(0, 40), m: null }; return finish(); }
    if (a === 'cat') { st.cat = +b.dataset.i; st.q = ''; paint(); const i = $('#fp-q'); if (i) i.focus(); return; }
    if (a === 'cats') { st.cat = null; st.q = ''; return paint(); }
    if (a === 'act' || a === 'act-own') { const [e, v] = FEEL_ACTS[st.cat]; st.act = { e, v, t: (a === 'act' ? b.dataset.t : st.q.trim()).slice(0, 60) }; return finish(); }
  };
  el.oninput = (ev) => {
    if (ev.target.id !== 'fp-q') return;
    st.q = ev.target.value;
    const pos = ev.target.selectionStart; paint();
    const i = $('#fp-q'); i.focus(); i.setSelectionRange(pos, pos);
  };
  el.classList.remove('hidden');
  paint();
}
