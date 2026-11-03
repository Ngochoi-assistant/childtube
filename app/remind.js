// ChildTube — Gia đình → "Nhắc hằng ngày": tự đặt lịch nhắc lưu ảnh của bé / ghi nhớ hôm nay (giờ, các thứ, bé nào).
// Máy chủ gửi thông báo đẩy tới mọi máy người này đã bật (cloudflare/src/remind.ts). Lịch là của riêng mỗi người.
// iPhone: chỉ nhận được khi app đã "Thêm vào Màn hình chính" và mở từ biểu tượng đó (iOS 16.4 trở lên).
const RM_KIND = { photo: ['📸', 'Lưu ảnh/video của bé'], journal: ['📝', 'Ghi nhớ hôm nay'] };
const RM_DAYS = [['1', 'T2'], ['2', 'T3'], ['3', 'T4'], ['4', 'T5'], ['5', 'T6'], ['6', 'T7'], ['0', 'CN']];
const Remind = {
  data: null, sub: null,
  async load() {
    this.data = await rpc('ct_remind_list', {});
    // getRegistration không chờ (ready treo mãi nếu máy chưa cài service worker)
    this.sub = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration().then((r) => r && r.pushManager && r.pushManager.getSubscription()).catch(() => null) : null;
  },
  ok() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
  ios() { return /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window.navigator.standalone || matchMedia('(display-mode: standalone)').matches); },
  reg() { return 'serviceWorker' in navigator ? navigator.serviceWorker.ready : Promise.resolve(null); },
  on() { return !!(this.sub && this.data && this.data.devices.includes(this.sub.endpoint) && Notification.permission === 'granted'); },
  daysText(d) {
    if (d.length === 7) return 'Hằng ngày';
    if (d === '12345') return 'Thứ 2 – Thứ 6';
    if (d === '06') return 'Cuối tuần';
    return RM_DAYS.filter(([v]) => d.includes(v)).map(([, t]) => t).join(', ');
  },
  summary() {
    if (!this.data) return 'Nhắc lưu ảnh của bé, ghi nhớ mỗi ngày theo giờ bạn chọn';
    const n = this.data.reminders.filter((r) => r.enabled).length;
    return n ? `${n} lịch nhắc · ${this.data.reminders.filter((r) => r.enabled).map((r) => r.time).join(', ')}` : 'Chưa đặt · nhắc lưu ảnh, ghi nhớ theo lịch';
  },
  async render(v) {
    const head = `<div class="v-sub"><button class="v-back" data-a="H-back">‹</button><b>⏰ Nhắc hằng ngày</b></div>`;
    if (!this.data) {
      v.innerHTML = head + '<div class="card"><div class="hint">Đang tải…</div></div>';
      try { await this.load(); } catch (e) { this.data = { reminders: [], devices: [], vapid: '' }; toast(e.message, true); }
      if (Hub.sub !== 'remind') return;
    }
    const kids = S.children || [], kid = (id) => kids.find((k) => k.id === id);
    const dev = !this.ok()
      ? `<div class="item"><div class="ic">📵</div><div class="info"><div class="t">Máy này chưa nhận được thông báo</div><div class="m">${this.ios()
        ? 'iPhone: mở bằng Safari → nút Chia sẻ → <b>Thêm vào MH chính</b>, rồi mở ChildTube từ biểu tượng đó và bật ở đây (cần iOS 16.4 trở lên).'
        : 'Trình duyệt này không hỗ trợ thông báo. Hãy dùng Chrome, Safari hoặc Edge bản mới.'}</div></div></div>`
      : this.on()
        ? `<div class="item"><div class="ic">🔔</div><div class="info"><div class="t">Máy này đã bật thông báo</div><div class="m">${this.data.devices.length > 1 ? `Cùng ${this.data.devices.length - 1} máy khác của bạn` : 'Nhắc sẽ hiện như tin nhắn, kể cả khi app đang đóng'}</div></div>
          <button class="btn small" data-a="RM-test">Gửi thử</button></div>`
        : `<div class="item"><div class="ic">🔕</div><div class="info"><div class="t">Máy này chưa bật thông báo</div><div class="m">${Notification.permission === 'denied'
          ? 'Bạn đã chặn thông báo. Vào Cài đặt của máy → ChildTube (hoặc trình duyệt) → Thông báo → Cho phép, rồi quay lại đây.'
          : 'Bật để nhận nhắc đúng giờ, kể cả khi app đang đóng'}</div></div>${Notification.permission === 'denied' ? '' : '<button class="btn small primary-s" data-a="RM-on">Bật</button>'}</div>`;
    const rows = this.data.reminders.map((r) => {
      const [ic, t] = RM_KIND[r.kind] || RM_KIND.photo, k = kid(r.child_id);
      return `<div class="item tap ${r.enabled ? '' : 'off'}" data-a="RM-edit" data-id="${r.id}"><div class="ic">${ic}</div><div class="info"><div class="t">${t}${k ? ' · ' + esc(k.emoji || '') + ' ' + esc(k.name) : ''}</div>
        <div class="m">${this.daysText(r.days)}${r.skip_done ? ' · bỏ qua nếu hôm nay đã ghi' : ''}${r.note ? ' · “' + esc(r.note) + '”' : ''}</div></div>
        <span class="ev-when ${r.enabled ? 'soon' : ''}">${r.enabled ? r.time : 'Tắt'}</span></div>`;
    }).join('');
    v.innerHTML = head + `<div class="hint" style="margin:0 2px 10px">Đặt giờ để ChildTube nhắc bạn lưu ảnh của bé hoặc ghi vài dòng mỗi ngày. Lịch là của riêng bạn; người khác trong gia đình tự đặt lịch của họ.</div>
      <div class="card hub">${dev}</div>
      <button class="btn primary" data-a="RM-new" style="width:100%;margin:4px 0 12px">＋ Thêm lịch nhắc</button>
      <div class="card hub">${rows || '<div class="hint" style="padding:14px">Chưa có lịch nào. Ví dụ: 📸 20:30 hằng ngày — lưu ảnh của bé trong ngày.</div>'}</div>`;
  },
  // Bật thông báo trên máy này: xin quyền → đăng ký đẩy với khoá VAPID của máy chủ → gửi đăng ký lên máy chủ
  async enable() {
    if (!this.ok()) return toast('Máy này chưa hỗ trợ thông báo', true);
    if ((await Notification.requestPermission()) !== 'granted') { render(); return toast('Chưa được cho phép thông báo', true); }
    const reg = await this.reg(), key = Uint8Array.from(atob(this.data.vapid.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((this.data.vapid.length + 3) % 4)), (c) => c.charCodeAt(0));
    let sub = await reg.pushManager.getSubscription();
    if (sub) {   // đăng ký cũ với khoá khác: gỡ rồi đăng ký lại
      const old = sub.options && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
      if (old && old.join() !== key.join()) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const ua = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : 'Máy tính';
    await rpc('ct_push_sub', { p_sub: sub.toJSON(), p_ua: ua });
    await this.load();
    toast('Đã bật thông báo trên máy này 🔔');
  },
  sheet(r) {
    const isNew = !r, kids = S.children || [];
    r = r || { kind: 'photo', time: '20:30', days: '0123456', child_id: kids.length === 1 ? kids[0].id : null, note: '', skip_done: true, enabled: true };
    sheet(`<h3>${isNew ? '⏰ Thêm lịch nhắc' : '✎ Sửa lịch nhắc'}</h3>
      <label>Nhắc việc</label><div class="ev-seg">${Object.entries(RM_KIND).map(([k, [ic, t]]) => `<label><input type="radio" name="rm-kind" value="${k}" ${r.kind === k ? 'checked' : ''}><span>${ic} ${t}</span></label>`).join('')}</div>
      <div class="pt-two"><div><label>Giờ</label><input id="rm-time" type="time" value="${esc(r.time)}"></div>
        <div><label>Bé</label><select id="rm-kid"><option value="">Cả nhà</option>${kids.map((k) => `<option value="${k.id}" ${r.child_id === k.id ? 'selected' : ''}>${esc(k.emoji || '')} ${esc(k.name)}</option>`).join('')}</select></div></div>
      <label>Ngày nhắc</label><div class="ev-seg rm-days">${RM_DAYS.map(([v, t]) => `<label><input type="checkbox" name="rm-day" value="${v}" ${r.days.includes(v) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      <div class="chips" style="margin:-2px 0 6px"><button type="button" class="chip" data-a="RM-preset" data-v="0123456">Hằng ngày</button><button type="button" class="chip" data-a="RM-preset" data-v="12345">Thứ 2 – Thứ 6</button><button type="button" class="chip" data-a="RM-preset" data-v="06">Cuối tuần</button></div>
      <label>Lời nhắc (không bắt buộc)</label><input id="rm-note" maxlength="120" value="${esc(r.note || '')}" placeholder="Ví dụ: Chụp ảnh bé ăn tối, ghi câu nói hay hôm nay">
      <label class="pt-chk"><input type="checkbox" id="rm-skip" ${r.skip_done ? 'checked' : ''}> Hôm nay đã ghi${r.kind === 'photo' ? '/đã có ảnh' : ''} thì không nhắc</label>
      ${isNew ? '' : `<label class="pt-chk"><input type="checkbox" id="rm-on" ${r.enabled ? 'checked' : ''}> Đang bật</label>`}
      <button class="btn primary" data-a="RM-save" style="width:100%;margin-top:12px">Lưu</button>
      ${isNew ? '' : '<button class="btn" data-a="RM-del" style="width:100%;margin-top:8px;color:var(--danger)">Xoá lịch này</button>'}`, async (a, b) => {
      if (a === 'RM-preset') { document.querySelectorAll('input[name=rm-day]').forEach((x) => { x.checked = b.dataset.v.includes(x.value); }); return; }
      try {
        if (a === 'RM-save') {
          b.disabled = true;
          const days = [...document.querySelectorAll('input[name=rm-day]:checked')].map((x) => x.value).join('');
          await rpc('ct_remind_save', { p_id: r.id || null, p: { kind: (document.querySelector('input[name=rm-kind]:checked') || {}).value, time: $('#rm-time').value, days,
            child_id: $('#rm-kid').value || null, note: $('#rm-note').value, skip_done: $('#rm-skip').checked, enabled: isNew ? true : $('#rm-on').checked } });
          closeSheet(); toast(this.on() || !this.ok() ? 'Đã lưu lịch nhắc' : 'Đã lưu · bấm “Bật” để máy này nhận thông báo');
        } else if (a === 'RM-del') {
          if (!confirm('Xoá lịch nhắc này?')) return;
          await rpc('ct_remind_delete', { p_id: r.id }); closeSheet(); toast('Đã xoá');
        } else return;
        await this.load(); render();
      } catch (err) { b.disabled = false; toast(err.message, true); }
    });
  },
  // Bấm vào thông báo nhắc: mở khung Ghi Nhật ký, chọn sẵn bé
  go(q) {
    if (q.get('go') !== 'je' || typeof entrySheet !== 'function' || !S) return false;
    entrySheet(null);
    const kid = q.get('child'), sel = $('#je-kid');
    if (kid && sel && [...sel.options].some((o) => o.value === kid)) sel.value = kid;
    if (q.get('kind') === 'photo') toast('📸 Bấm “Thêm ảnh/video” để chọn ảnh hôm nay');
    return true;
  },
  pending() {
    let s = null;
    try { s = sessionStorage.getItem('ct-go'); sessionStorage.removeItem('ct-go'); } catch (e) { /* bỏ qua */ }
    if (s) this.go(new URLSearchParams(s));
  },
};
// Mở app từ thông báo (?go=je…): giữ lại đến khi tải xong dữ liệu gia đình
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('go')) { try { sessionStorage.setItem('ct-go', location.search); } catch (e) { /* bỏ qua */ } history.replaceState(null, '', location.pathname); }
})();
// App đang mở sẵn: service worker báo sang khi bấm thông báo
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.go) Remind.go(new URLSearchParams(e.data.go)); });
$('#view').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a^="RM-"]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'RM-new') Remind.sheet(null);
  if (a === 'RM-edit') Remind.sheet(((Remind.data || {}).reminders || []).find((x) => x.id === b.dataset.id));
  if (a === 'RM-on') { b.disabled = true; try { await Remind.enable(); } catch (err) { toast('Chưa bật được: ' + err.message, true); } render(); }
  if (a === 'RM-test') { b.disabled = true; try { const r = await rpc('ct_push_test', {}); toast(`Đã gửi thử tới ${r.sent}/${r.devices} máy`); } catch (err) { toast(err.message, true); } b.disabled = false; await Remind.load(); render(); }
});
