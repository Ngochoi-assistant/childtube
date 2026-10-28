// ChildTube — hàng đợi tải ảnh/video chạy ngầm (như Facebook):
// 1) chọn tệp là gửi ngay (tệp "chờ gắn bài" trên máy chủ, stage=1) trong lúc bố mẹ gõ tiêu đề, chọn cảm xúc;
// 2) bấm Lưu là bài hiện ngay; tệp chưa xong tiếp tục tải phía sau rồi tự gắn vào bài (ct_media_attach);
// 3) mỗi tệp video lớn gửi 5 phần cùng lúc (sendFile), tối đa 2 tệp cùng lúc.
// Giữ app mở đến khi tải xong: đóng hẳn app thì tệp đang tải dừng lại (bài vẫn còn, bấm ✎ Sửa để thêm lại).
const UpQ = {
  jobs: [], running: 0, MAXF: 2, seq: 0,
  tok() { return (JSON.parse(localStorage.getItem('ct-session') || '{}') || {}).access_token; },
  // Thêm tệp vào hàng đợi; group = khung soạn đang mở (để hiện xem trước đúng chỗ)
  add(files, group) {
    for (const f of [...files]) {
      if (this.jobs.filter((j) => j.group === group && !j.removed).length >= 12) { toast('Mỗi bài tối đa 12 ảnh/video', true); break; }
      if (f.size > 500 * 1024 * 1024) { toast(f.name + ': quá 500 MB. Hãy cắt ngắn video rồi thử lại.', true); continue; }
      const vid = (f.type || mimeOf(f)).startsWith('video/');
      this.jobs.push({ key: 'u' + (++this.seq), group, file: f, vid, thumb: vid ? '' : URL.createObjectURL(f), pct: 0, status: 'wait', media: null, entry: null, attached: false, removed: false });
    }
    this.pump(); this.paint();
  },
  pump() {
    while (this.running < this.MAXF) {
      const j = this.jobs.find((x) => x.status === 'wait' && !x.removed);
      if (!j) break;
      this.run(j);
    }
  },
  async run(j) {
    this.running++; j.status = 'up'; j.err = '';
    try {
      const r = await sendFile('stage=1', j.file, this.tok(), (p) => { j.pct = p; this.paint(); });
      j.media = r && r.id; j.status = 'done'; j.pct = 1;
      if (j.removed && j.media) rpc('ct_media_delete', { p_id: j.media }).catch(() => {});
      else if (j.entry) await this.attach(j.entry);
    } catch (e) { j.status = 'err'; j.err = e.message; }
    this.running--; this.paint(); this.pump();
  },
  of(group) { return this.jobs.filter((j) => j.group === group && !j.removed); },
  // Bài đã lưu: tệp xong rồi thì gắn ngay, tệp đang tải thì gắn khi xong
  bind(group, entry) {
    this.of(group).forEach((j) => { j.entry = entry; });
    return this.attach(entry);
  },
  async attach(entry) {
    const ready = this.jobs.filter((j) => j.entry === entry && j.status === 'done' && !j.attached && !j.removed && j.media);
    if (!ready.length) return;
    ready.forEach((j) => { j.attached = true; });
    try { await rpc('ct_media_attach', { p_entry: entry, p_ids: ready.map((j) => j.media) }); }
    catch (e) { ready.forEach((j) => { j.attached = false; }); toast('Chưa gắn được ảnh vào bài: ' + e.message, true); return; }
    const left = this.jobs.filter((j) => j.entry === entry && !j.removed && !j.attached);
    if (!left.length) {
      toast('Đã tải xong ảnh/video ✓');
      this.jobs = this.jobs.filter((j) => j.entry !== entry);
      if (typeof Feed !== 'undefined') { Feed.list = null; if (tab === 'feed') render(); }
      if (typeof P !== 'undefined') { P.jr = null; P.ov = null; P.gal = null; }
    }
    this.paint();
  },
  remove(key) {
    const j = this.jobs.find((x) => x.key === key); if (!j) return;
    j.removed = true;
    if (j.status === 'done' && j.media && !j.attached) rpc('ct_media_delete', { p_id: j.media }).catch(() => {});
    if (j.status !== 'up') this.jobs = this.jobs.filter((x) => x !== j);
    this.paint();
  },
  retry() { this.jobs.forEach((j) => { if (j.status === 'err') { j.status = 'wait'; j.pct = 0; } }); this.pump(); this.paint(); },
  busy(group) { return this.of(group).some((j) => j.status !== 'done'); },
  // Tiến độ chung của các tệp đang chờ gắn vào bài (hiện trên bảng tin)
  summary(entry) {
    const js = this.jobs.filter((j) => !j.removed && j.entry && (!entry || j.entry === entry) && !j.attached);
    if (!js.length) return null;
    const size = js.reduce((a, j) => a + j.file.size, 0) || 1, p = js.reduce((a, j) => a + j.pct * j.file.size, 0) / size;
    const v = js.filter((j) => j.vid).length;
    return { n: js.length, pct: Math.round(p * 100), err: js.filter((j) => j.status === 'err').length, what: v === js.length ? 'video' : v ? 'ảnh/video' : 'ảnh' };
  },
  paint() {
    // xem trước trong khung soạn: ảnh nhỏ + % trên từng tệp
    document.querySelectorAll('.up-prev').forEach((box) => {
      box.innerHTML = this.of(box.dataset.group).map((j) => `<span class="up-it ${j.status}" data-key="${j.key}">${j.vid ? '<i class="up-vi">🎬</i>' : `<img src="${j.thumb}" alt="">`}
        <b>${j.status === 'done' ? '✓' : j.status === 'err' ? '!' : Math.round(j.pct * 100) + '%'}</b><em style="width:${Math.round(j.pct * 100)}%"></em>
        <button type="button" data-a="je-up-x" data-key="${j.key}" aria-label="Bỏ tệp">✕</button></span>`).join('');
    });
    // trên bảng tin: một dải "Đang tải…" + ô tiến độ trong từng bài
    const s = this.summary(), bar = $('#up-banner');
    if (bar) bar.innerHTML = s ? `<div class="up-bar ${s.err ? 'err' : ''}"><span>${s.err ? `❗ ${s.err} tệp chưa tải được` : `⏫ Đang tải ${s.n} ${s.what} · ${s.pct}%`}</span>
      ${s.err ? '<button data-a="F2-upretry">Thử lại</button>' : '<em>Giữ app mở đến khi xong</em>'}<i style="width:${s.pct}%"></i></div>` : '';
    document.querySelectorAll('.fd-up[data-id]').forEach((el) => {
      const x = this.summary(el.dataset.id);
      el.innerHTML = x ? `⏫ Đang tải ${x.n} ${x.what} · ${x.pct}%<i style="width:${x.pct}%"></i>` : '';
      el.classList.toggle('hidden', !x);
    });
  },
};
window.addEventListener('beforeunload', (e) => { if (UpQ.jobs.some((j) => j.status === 'up' || j.status === 'wait')) { e.preventDefault(); e.returnValue = ''; } });
