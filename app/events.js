// ChildTube — Gia đình → "Ngày quan trọng": giỗ, sinh nhật, kỷ niệm… theo lịch âm hoặc dương, lặp hằng năm.
// TV "Màn hình chính" hiện các ngày này trên Lịch vạn niên và nhắc trước vài ngày. Đổi âm ↔ dương bằng lunar.js (dùng chung với TV).
const EV_KIND = { gio: ['🕯', 'Ngày giỗ'], birthday: ['🎂', 'Sinh nhật'], wedding: ['💍', 'Kỷ niệm cưới'], other: ['📌', 'Ngày khác'] };
const EV_WD = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const Events = {
  list: null,
  next(e) { return Lunar.nextOccurrence({ cal: e.cal, m: e.month, d: e.day }, new Date()); },
  when(n) { return !n ? '' : n.days === 0 ? 'Hôm nay' : n.days === 1 ? 'Ngày mai' : `Còn ${n.days} ngày`; },
  dateOf(e) { return e.cal === 'lunar' ? `${e.day}/${e.month} âm lịch` : `${e.day}/${e.month}`; },
  async load() { this.list = await rpc('ct_event_list', {}); },
  summary() {
    if (!this.list) return 'Giỗ, sinh nhật, kỷ niệm · hiện trên TV';
    const up = this.sorted()[0];
    return this.list.length ? `${this.list.length} ngày · gần nhất: ${up.e.title} (${this.when(up.n).toLowerCase()})` : 'Chưa có · thêm giỗ, sinh nhật để TV nhắc';
  },
  sorted() { return (this.list || []).map((e) => ({ e, n: this.next(e) })).sort((a, b) => (a.n ? a.n.days : 999) - (b.n ? b.n.days : 999)); },
  async render(v) {
    const role = (S.me || {}).role, can = !role || role === 'owner' || role === 'parent';
    if (!this.list) {
      v.innerHTML = `<div class="v-sub"><button class="v-back" data-a="H-back">‹</button><b>📅 Ngày quan trọng</b></div><div class="card"><div class="hint">Đang tải…</div></div>`;
      try { await this.load(); } catch (e) { this.list = []; toast(e.message, true); }
      if (Hub.sub !== 'events') return;
    }
    const kids = (S.children || []).filter((k) => k.birth);
    const rows = this.sorted().map(({ e, n }) => {
      const [ic, kind] = EV_KIND[e.kind] || EV_KIND.other;
      const yrs = e.year && n ? (e.cal === 'lunar' ? Lunar.toLunar(n.d, n.m, n.y).y : n.y) - e.year : 0;
      const extra = yrs > 0 ? (e.kind === 'gio' ? ` · năm thứ ${yrs}` : e.kind === 'birthday' ? ` · ${yrs} tuổi` : ` · ${yrs} năm`) : '';
      return `<div class="item tap" data-a="EV-edit" data-id="${e.id}"><div class="ic">${ic}</div><div class="info"><div class="t">${esc(e.title)}</div>
        <div class="m">${e.cal === 'lunar' ? esc(this.dateOf(e)) + ' · ' : ''}${n ? `${EV_WD[new Date(n.y, n.m - 1, n.d).getDay()]} ${n.d}/${n.m}/${n.y}` : ''}${extra}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
        <span class="ev-when ${n && n.days <= (e.remind_days || 0) ? 'soon' : ''}">${this.when(n)}</span></div>`;
    }).join('');
    v.innerHTML = `<div class="v-sub"><button class="v-back" data-a="H-back">‹</button><b>📅 Ngày quan trọng</b></div>
      <div class="hint" style="margin:0 2px 10px">Hiện trên Lịch vạn niên của TV (Màn hình chính) và nhắc trước vài ngày. Ngày giỗ thường tính theo lịch âm.</div>
      ${can ? '<button class="btn primary" data-a="EV-new" style="width:100%;margin-bottom:12px">＋ Thêm ngày quan trọng</button>' : ''}
      <div class="card hub">${rows || '<div class="hint" style="padding:14px">Chưa có ngày nào. Thêm ngày giỗ ông bà, sinh nhật bố mẹ, ngày cưới…</div>'}</div>
      ${kids.length ? `<h2>🎈 Sinh nhật các bé</h2><div class="card hub">${kids.map((k) => {
        const b = k.birth.split('-'), n = Lunar.nextOccurrence({ cal: 'solar', m: +b[1], d: +b[2] }, new Date());
        return `<div class="item"><div class="ic">${esc(k.emoji || '🎈')}</div><div class="info"><div class="t">${esc(k.name)}</div><div class="m">${+b[2]}/${+b[1]} · tròn ${n.y - +b[0]} tuổi · tự lấy từ hồ sơ bé</div></div><span class="ev-when">${this.when(n)}</span></div>`;
      }).join('')}</div>` : ''}`;
  },
  sheet(e) {
    e = e || { title: '', kind: 'gio', cal: 'lunar', month: 1, day: 1, year: null, remind_days: 3, note: '' };
    const opt = (n, cur) => Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${i + 1 === cur ? 'selected' : ''}>${i + 1}</option>`).join('');
    sheet(`<h3>${e.id ? 'Sửa ngày quan trọng' : 'Thêm ngày quan trọng'}</h3>
      <label>Tên</label><input id="ev-title" maxlength="80" value="${esc(e.title)}" placeholder="Ví dụ: Giỗ ông nội, Sinh nhật mẹ">
      <label>Loại</label><div class="ev-seg" id="ev-kind">${Object.entries(EV_KIND).map(([k, [ic, t]]) => `<label><input type="radio" name="ev-kind" value="${k}" ${e.kind === k ? 'checked' : ''}><span>${ic} ${t}</span></label>`).join('')}</div>
      <label>Theo lịch</label><div class="ev-seg"><label><input type="radio" name="ev-cal" value="lunar" ${e.cal === 'lunar' ? 'checked' : ''}><span>🌙 Âm lịch</span></label><label><input type="radio" name="ev-cal" value="solar" ${e.cal !== 'lunar' ? 'checked' : ''}><span>☀️ Dương lịch</span></label></div>
      <div class="ev-date"><div><label>Ngày</label><select id="ev-day">${opt(31, e.day)}</select></div><div><label>Tháng</label><select id="ev-month">${opt(12, e.month)}</select></div>
        <div><label>Năm (không bắt buộc)</label><input id="ev-year" inputmode="numeric" maxlength="4" value="${e.year || ''}" placeholder="vd 1990"></div></div>
      <div class="hint" id="ev-prev"></div>
      <label>Nhắc trên TV trước</label><select id="ev-remind">${[0, 1, 3, 5, 7, 14, 30].map((d) => `<option value="${d}" ${d === e.remind_days ? 'selected' : ''}>${d ? d + ' ngày' : 'Chỉ đúng ngày'}</option>`).join('')}</select>
      <label>Ghi chú</label><input id="ev-note" maxlength="200" value="${esc(e.note || '')}" placeholder="Ví dụ: làm mâm cơm ở nhà bác cả">
      <button class="btn primary" data-a="EV-save" style="width:100%;margin-top:12px">Lưu</button>
      ${e.id ? '<button class="btn" data-a="EV-del" style="width:100%;margin-top:8px;color:var(--danger)">Xoá ngày này</button>' : ''}`, async (a, b) => {
      try {
        if (a === 'EV-save') {
          b.disabled = true;
          await rpc('ct_event_save', { p_id: e.id || null, p: { title: $('#ev-title').value, kind: this.radio('ev-kind'), cal: this.radio('ev-cal'), day: +$('#ev-day').value, month: +$('#ev-month').value,
            year: $('#ev-year').value.trim() || null, remind_days: +$('#ev-remind').value, note: $('#ev-note').value } });
          closeSheet(); toast('Đã lưu · TV sẽ cập nhật trong 30 phút');
        } else if (a === 'EV-del') {
          if (!confirm('Xoá "' + e.title + '"?')) return;
          await rpc('ct_event_delete', { p_id: e.id }); closeSheet(); toast('Đã xoá');
        } else return;
        await this.load(); render();
      } catch (err) { b.disabled = false; toast(err.message, true); }
    });
    sheetChange = () => this.preview();
    this.preview();
  },
  radio(name) { return (document.querySelector(`input[name=${name}]:checked`) || {}).value; },
  // Xem trước: ngày âm năm nay rơi vào ngày dương nào (và ngược lại)
  preview() {
    const cal = this.radio('ev-cal'), d = +$('#ev-day').value, m = +$('#ev-month').value, box = $('#ev-prev');
    if (!box) return;
    const n = Lunar.nextOccurrence({ cal, m, d }, new Date());
    if (!n) { box.textContent = ''; return; }
    const l = Lunar.toLunar(n.d, n.m, n.y);
    box.innerHTML = cal === 'lunar'
      ? `Lần tới: <b>${EV_WD[new Date(n.y, n.m - 1, n.d).getDay()]} ${n.d}/${n.m}/${n.y}</b> (dương lịch) · ${this.when(n).toLowerCase()}${d === 30 && l.d !== 30 ? ' · tháng này chỉ có 29 ngày nên tính ngày 29' : ''}`
      : `Lần tới: <b>${EV_WD[new Date(n.y, n.m - 1, n.d).getDay()]} ${n.d}/${n.m}/${n.y}</b> · ngày ${l.d}/${l.m} âm lịch · ${this.when(n).toLowerCase()}`;
  },
};
$('#view').addEventListener('click', (e) => {
  const b = e.target.closest('[data-a^="EV-"]');
  if (!b) return;
  if (b.dataset.a === 'EV-new') Events.sheet(null);
  if (b.dataset.a === 'EV-edit') Events.sheet((Events.list || []).find((x) => x.id === b.dataset.id));
});
