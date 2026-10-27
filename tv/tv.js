// ChildTube — màn hình của bé trên TV. Điều khiển bằng remote (mũi tên, OK, Back) hoặc chuột.
// Viết kiểu JS đơn giản (không async/await, không ?.) để chạy được trên TV Samsung đời 2017+.
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412 };
  var BACK = [10009, 27, 8, 461];
  var COLS = 4;
  var SEC = { collection: 'Giáo trình', topic: 'Playlist của gia đình', source: 'Kênh YouTube', ytpl: 'Playlist YouTube', single: 'Khác' };
  var APP_URL = new URL('../app/', location.href).href;

  var lib = [];           // [{section,id,title,emoji,thumb,videos:[{id,title}]}]
  var chIdx = 0;
  var zone = 'loading';   // loading | pair | ov | side | grid | pin | parent | player
  var sideIdx = 0, gridIdx = 0, pinIdx = 0, parentIdx = 0, ovIdx = 0;
  var ov = null;           // dữ liệu màn tổng quan (ct_tv_overview)
  var pin = '', pinFails = 0, pinLockUntil = 0;
  var player = null, playerReady = false, pending = null;
  var queue = null;
  var osdTimer = null, tickTimer = null, toastTimer = null, pollTimer = null;

  // ---------- Thời gian xem mỗi ngày ----------
  // quota lấy từ cloud (ct_tv_hello → screen). Cloud chưa cập nhật: không giới hạn, dừng sau mỗi video.
  // Giây đã xem = max(số cloud báo + số đếm từ lần hỏi đó, số TV tự đếm trong ngày) để vẫn đúng khi mất mạng.
  var quota = { limit: null, used: 0, end: 'stop', day: '' };
  var sinceHello = 0, warned = 0, grace = false;
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function loadDay(key) {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(key)); } catch (e) { v = null; }
    return v && v.day === quota.day ? v : { day: quota.day, n: 0 };
  }
  function saveDay(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } }
  var usage, extra;                                        // giây đã xem hôm nay / phút bố mẹ cho thêm hôm nay
  function setQuota(s, fromCache) {
    var day = (s && s.day) || today(), stale = fromCache && day !== today();
    quota = { limit: s && s.limit > 0 ? s.limit : null, used: s && !stale ? s.used || 0 : 0,
              end: s && s.end === 'next' ? 'next' : 'stop', day: stale ? today() : day, quiz: s && s.quiz ? s.quiz : null };
    sinceHello = 0;
    usage = loadDay('ct-usage');
    extra = loadDay('ct-extra');
  }
  setQuota(null);
  function usedSec() { return Math.max(quota.used + sinceHello, usage.n); }
  function leftSec() { return quota.limit ? (quota.limit + extra.n) * 60 - usedSec() : Infinity; }
  function timeUp() { return leftSec() <= 0; }
  function mins(sec) { return Math.max(1, Math.ceil(sec / 60)); }

  try {
    tizen.tvinputdevice.registerKeyBatch(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  } catch (e) { /* không phải TV Samsung */ }

  // ---------- Danh tính TV (lưu trong máy, dùng để ghép với gia đình) ----------
  function rand(n) {
    var a = new Uint8Array(n), s = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < n; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return s;
  }
  var device = null;
  try { device = JSON.parse(localStorage.getItem('ct-device')); } catch (e) { device = null; }
  if (!device || !device.id) {
    var h = rand(16);
    device = { id: h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32), secret: rand(24) };
    try { localStorage.setItem('ct-device', JSON.stringify(device)); } catch (e) { /* vẫn chạy trong phiên này */ }
  }

  // Mỗi lần hỏi cloud tối đa 12 giây: mạng treo (vd. TV vừa bật lại) thì báo lỗi và thử lại, không đứng im mãi.
  function rpc(fn, args) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : null;
    return fetch(CT_CONFIG.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/json', apikey: CT_CONFIG.key, Authorization: 'Bearer ' + CT_CONFIG.key },
      body: JSON.stringify(args)
    }).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || 'Lỗi'); return j; });
    }, function (e) { clearTimeout(timer); throw e; });
  }

  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function thumb(id) { return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 3000);
  }

  // ---------- Hỏi cloud: đã ghép chưa, danh sách gì ----------
  function showHome(rows, family) {
    $('#loading').classList.add('hidden');
    $('#pair').classList.add('hidden');
    var first = zone === 'loading' || zone === 'pair';
    if (first) zone = 'side';
    setLib(rows, family);
    if (first) { showOverview(); return; }
    if (zone !== 'ov') $('#home').classList.remove('hidden');
    checkLimit();
  }
  function hello() {
    return rpc('ct_tv_hello', { p_device: device.id, p_secret: device.secret }).then(function (r) {
      if (!r.paired) { try { localStorage.removeItem('ct-lib'); } catch (e) { /* bỏ qua */ } return showPair(r.code); }
      var rows = (r.rows || []).filter(function (g) { return g && g.videos && g.videos.length; });
      try { localStorage.setItem('ct-lib', JSON.stringify({ rows: rows, family: r.family, screen: r.screen })); } catch (e) { /* bộ nhớ đầy */ }
      setQuota(r.screen);
      showHome(rows, r.family);
    }).catch(function (err) {
      if (window.console) console.error('hello', err);
      if (zone === 'loading' && cached) { showHome(cached.rows, cached.family); toast('Mạng chậm, đang dùng danh sách đã lưu'); return; }
      if (zone === 'loading' || zone === 'pair') {
        showPair(null);
        $('#pair-msg').textContent = 'Chưa kết nối được Internet, đang thử lại…';
      } else toast('Mất kết nối Internet, đang thử lại…');
    });
  }

  var qrFor = '';
  function drawQr(code) {
    if (!code || qrFor === code) return;
    qrFor = code;
    try {
      var q = qrcode(0, 'M');
      q.addData(APP_URL + '#pair=' + code);
      q.make();
      $('#qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) { $('#qr').innerHTML = ''; }
  }

  function showPair(code) {
    zone = 'pair';
    $('#loading').classList.add('hidden');
    $('#home').classList.add('hidden');
    $('#pair').classList.remove('hidden');
    $('#pair-url').textContent = APP_URL.replace(/^https?:\/\//, '');
    if (code) { $('#pair-code').textContent = code; drawQr(code); }
    $('#pair-msg').textContent = 'Màn hình sẽ tự chuyển khi ghép xong.';
  }

  // index.html có thể bị TV giữ trong bộ nhớ đệm tới 10 phút sau khi xuất bản (GitHub Pages: max-age=600),
  // nên TV vẫn chạy bản cũ. Mỗi lần hỏi cloud thì xem bản mới nhất; mới hơn thì tải lại (chỉ khi bé ở trang chủ).
  var MY_V = (function () {
    for (var i = 0; i < document.scripts.length; i++) { var m = /tv\.js\?v=(\d+)/.exec(document.scripts[i].src); if (m) return +m[1]; }
    return 0;
  })();
  function checkVersion() {
    if (!window.fetch || !MY_V) return;
    fetch('./?nc=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (html) {
      var m = /tv\.js\?v=(\d+)/.exec(html), v = m ? +m[1] : 0, tried = null;
      if (v <= MY_V || !(zone === 'ov' || zone === 'side' || zone === 'grid' || zone === 'pair' || zone === 'limit')) return;
      try { tried = sessionStorage.getItem('ct-upd'); sessionStorage.setItem('ct-upd', String(v)); } catch (e) { /* bỏ qua */ }
      if (tried !== String(v)) location.replace(location.pathname + '?v=' + v);   // mỗi bản chỉ thử một lần, tránh tải lại liên tục
    }).catch(function () { /* mạng chậm: để lần sau */ });
  }

  function schedule() {
    clearTimeout(pollTimer);
    // Chưa ghép: hỏi mỗi 4 giây. Đã ghép: mỗi 2 phút (chỉ khi bé đang ở trang chủ).
    var wait = zone === 'pair' || zone === 'loading' ? 4000 : 120000;
    pollTimer = setTimeout(function () {
      if (zone === 'pair' || zone === 'loading' || zone === 'ov' || zone === 'side' || zone === 'grid' || zone === 'limit') hello().then(function () { if (zone === 'ov') return loadOverview(); }).then(checkVersion).then(schedule, schedule); else schedule();
    }, wait);
  }
  // TV bật lại từ chế độ chờ / quay lại app: cập nhật ngay.
  // Tắt quá 30 phút rồi bật lại (thường là lần xem mới): quay về màn tổng quan.
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (zone === 'player') return;
    if (hiddenAt && Date.now() - hiddenAt > 30 * 60000 && (zone === 'side' || zone === 'grid')) showOverview();
    hello().then(schedule, schedule);
  });
  // Lỗi bất ngờ không được làm đứng app: ghi lại và báo nhẹ.
  window.addEventListener('error', function (e) {
    if (window.console) console.error('tv error', e.message, e.filename, e.lineno);
    if (zone === 'loading') { $('#loading-msg').textContent = 'Đang thử lại…'; }
  });

  var libKey = '';
  function setLib(rows, family) {
    var key = JSON.stringify(rows) + '|' + family;
    if (key === libKey) return;                            // không đổi: giữ nguyên màn hình, không tải lại ảnh
    libKey = key;
    paintWho(family);
    var curId = lib[chIdx] && lib[chIdx].id;
    lib = rows;
    chIdx = 0;
    for (var i = 0; i < lib.length; i++) if (lib[i].id === curId) chIdx = i;
    if (zone === 'side') sideIdx = Math.min(sideIdx, lib.length);
    renderSide();
    renderGrid(family);
    if (gridIdx >= gridItems().length) gridIdx = 0;
    if (zone === 'grid' && !gridItems().length) zone = 'side';
    focus();
  }

  // Nhãn bài: giáo trình nhiều tầng có số bài thật (ln) — một bài có thể có nhiều video; video bổ trợ ghi "Bổ trợ".
  function lessonLabel(v, i) {
    if (!v) return 'Bài ' + (i + 1);
    if (v.ln) return (v.role === 'extra' ? 'Bổ trợ · Bài ' : 'Bài ') + v.ln;
    return 'Bài ' + (i + 1);
  }

  // Giáo trình: bài nào bé đã học, bài nào đang bị khoá (khi bật "học theo thứ tự").
  function isLocked(g, i) {
    if (!g || !g.locked) return false;
    for (var k = 0; k < i; k++) if (!g.videos[k].done) return true;
    return false;
  }
  function startIndex(g) {                                 // bài đầu tiên chưa học (hoặc bài 1)
    if (!g || !g.numbered) return 0;
    for (var k = 0; k < g.videos.length; k++) if (!g.videos[k].done) return k;
    return 0;
  }
  function doneCount(g) {
    var n = 0;
    for (var k = 0; k < g.videos.length; k++) if (g.videos[k].done) n++;
    return n;
  }

  function renderSide() {
    var html = '', last = null;
    lib.forEach(function (g, i) {
      if (g.section !== last && SEC[g.section]) html += '<div class="sec">' + SEC[g.section] + '</div>';
      last = g.section;
      var icon = g.thumb ? '<img src="' + esc(g.thumb) + '" alt="">' : '<span class="emo">' + esc(g.emoji || '📁') + '</span>';
      html += '<div class="ch' + (i === chIdx ? ' current' : '') + '" data-i="' + i + '">' + icon + '<span class="name">' + esc(g.title) + '</span></div>';
    });
    html += '<div class="ch parent" data-i="' + lib.length + '"><span class="lock">🔒</span><span class="name">Bố mẹ</span></div>';
    $('#channels').innerHTML = html;
  }

  function renderGrid(family) {
    var g = lib[chIdx];
    paintHero(g);
    $('#empty').classList.toggle('hidden', !!lib.length);
    if (!lib.length) {
      $('#empty').innerHTML = 'Chưa có video nào' + (family ? ' cho <b>' + esc(family) + '</b>' : '') +
        '.<br>Bố mẹ hãy mở app ChildTube trên điện thoại<br>để chọn video cho bé nhé!';
    }
    $('#grid').innerHTML = g ? g.videos.map(function (v, i) {
      var locked = isLocked(g, i);
      var badges = (g.numbered ? '<span class="num">' + lessonLabel(v, i) + '</span>' : '') + (v.done ? '<span class="tick">✓</span>' : '') + (locked ? '<span class="lock-ic">🔒</span>' : '<span class="play"></span>');
      return '<div class="card' + (locked ? ' locked' : '') + (v.done ? ' done' : '') + '" data-i="' + i + '"><div class="thumb"><img src="' + thumb(v.id) + '" alt="" loading="lazy" decoding="async">' + badges + '</div><div class="t">' + esc(v.title) + '</div></div>';
    }).join('') : '';
    $('#grid').scrollTop = 0;
  }

  // Banner của nhóm đang chọn: loại nhóm, tên, ghi chú, tiến độ giáo trình, ảnh bài nên xem tiếp.
  var heroImg = '';
  function paintHero(g) {
    $('#hero').classList.toggle('hidden', !g);
    if (!g) return;
    // Giáo trình nhiều tầng: đếm theo bài (ln), một bài có thể có nhiều video; bài học xong = mọi video chính đã xem
    var n = g.videos.length, d = 0, byLesson = {}, k;
    for (k = 0; k < g.videos.length; k++) if (g.videos[k].ln) {
      var vv = g.videos[k], key = 'l' + vv.ln;
      if (!(key in byLesson)) byLesson[key] = true;
      if (vv.role !== 'extra' && !vv.done) byLesson[key] = false;
    }
    var keys = Object.keys(byLesson);
    if (keys.length) { n = keys.length; for (k = 0; k < keys.length; k++) if (byLesson[keys[k]]) d++; } else d = doneCount(g);
    $('#hero-kicker').innerHTML = '<i></i>' + esc((g.section === 'fav' ? 'Yêu thích' : SEC[g.section] || 'Video') + ' · ' + n + (g.numbered ? ' bài' : ' video'));
    $('#ch-title').textContent = (g.emoji ? g.emoji + ' ' : '') + g.title;
    $('#ch-note').textContent = g.note || '';
    $('#hero-prog').classList.toggle('hidden', !g.numbered);
    if (g.numbered) {
      $('#hero-fill').style.width = (n ? d / n * 100 : 0) + '%';
      $('#hero-done').textContent = 'Đã học ' + d + '/' + n + ' bài';
    }
    var v = g.videos[startIndex(g)], src = v ? 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg' : '';
    if (src !== heroImg) { heroImg = src; $('#hero-img').src = src; }   // chỉ tải ảnh khi đổi bài
  }

  // Đồng hồ + tên gia đình ở thanh trên. Đồng hồ đổi mỗi phút (đúng đầu phút) để không vẽ lại liên tục.
  var DAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  function tickClock() {
    var d = new Date();
    $('#clock-time').textContent = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
    $('#clock-date').textContent = DAYS[d.getDay()] + ', ' + d.getDate() + ' tháng ' + (d.getMonth() + 1);
    setTimeout(tickClock, 60000 - d.getSeconds() * 1000 - d.getMilliseconds() + 50);
  }
  tickClock();
  function paintWho(family) {
    var name = family || 'Gia đình', w = name.replace(/^(nhà|gia đình)\s+/i, '').split(/\s+/).filter(function (x) { return /[a-zà-ỹđ0-9]/i.test(x); });
    if (!w.length) w = ['G'];
    $('#who-name').textContent = name;
    $('#who-av').textContent = (w.length > 1 ? w[w.length - 2].charAt(0) + w[w.length - 1].charAt(0) : w[0].charAt(0)).toUpperCase();
  }

  function sideItems() { return document.querySelectorAll('#channels .ch'); }
  function gridItems() { return $('#grid').children; }

  function reveal(el, box) {
    var top = el.offsetTop, bottom = top + el.offsetHeight, pad = box.clientHeight * 0.08;
    if (top - pad < box.scrollTop) box.scrollTop = Math.max(0, top - pad);
    else if (bottom + pad > box.scrollTop + box.clientHeight) box.scrollTop = bottom + pad - box.clientHeight;
  }

  function focus() {
    var old = document.querySelectorAll('.focus');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('focus');
    var el = null;
    if (zone === 'side') { el = sideItems()[sideIdx]; if (el) reveal(el, $('#channels')); }
    else if (zone === 'grid') { el = gridItems()[gridIdx]; if (el) reveal(el, $('#grid')); }
    else if (zone === 'pin') el = $('#pin-pad').children[pinIdx];
    else if (zone === 'parent') el = $('#parent-btns').children[parentIdx];
    else if (zone === 'end') el = $('#end-btns').children[endIdx];
    else if (zone === 'qz') el = qzItems()[qzIdx];
    else if (zone === 'limit') el = $('#limit-btns').children[0];
    else if (zone === 'ov') el = $('#ov-btns').children[ovIdx];
    else if (zone === 'rm') el = mapRow === 'btn' ? $('#rm-btns').children[rmIdx2] : null;
    else if (zone === 'rmbtn') el = $('#rm-btn');
    else if (zone === 'phbtn') el = $('#ph-btn');
    else if (zone === 'ph') { el = ph.at === 'chips' ? $('#ph-chips').children[ph.chip] : phCells()[ph.idx]; if (el && ph.at === 'grid') reveal(el, $('#ph-grid')); }
    if (el) el.classList.add('focus');
    $('#grid').classList.toggle('dim', zone === 'grid');   // đang chọn video: làm mờ các video còn lại
  }

  function showChannel(i) {
    if (i === chIdx || i >= lib.length) return;
    chIdx = i;
    gridIdx = 0;
    var items = sideItems();
    for (var n = 0; n < items.length; n++) items[n].classList.toggle('current', n === i);
    renderGrid();
  }

  // ---------- Điều hướng trang chủ ----------
  function homeKey(k) {
    var n;
    if (zone === 'side') {
      n = sideItems().length;
      if (k === K.UP && sideIdx === 0) { zone = 'phbtn'; focus(); return; }
      if (k === K.UP && sideIdx > 0) sideIdx--;
      else if (k === K.DOWN && sideIdx < n - 1) sideIdx++;
      else if (BACK.indexOf(k) >= 0) { showOverview(); return; }
      else if ((k === K.RIGHT || k === K.ENTER) && sideIdx < lib.length) {
        if (gridItems().length) { zone = 'grid'; gridIdx = startIndex(lib[chIdx]); }
      } else if (k === K.ENTER && sideIdx === lib.length) { openPin(); return; }
      showChannel(sideIdx);
    } else if (zone === 'grid') {
      n = gridItems().length;
      if (k === K.LEFT) { if (gridIdx % COLS === 0) { zone = 'side'; sideIdx = chIdx; } else gridIdx--; }
      else if (k === K.RIGHT && gridIdx % COLS < COLS - 1 && gridIdx + 1 < n) gridIdx++;
      else if (k === K.UP && gridIdx >= COLS) gridIdx -= COLS;
      else if (k === K.DOWN && Math.floor(gridIdx / COLS) < Math.floor((n - 1) / COLS)) gridIdx = Math.min(gridIdx + COLS, n - 1);
      else if (k === K.ENTER || k === K.PLAY || k === K.PLAYPAUSE) {
        if (isLocked(lib[chIdx], gridIdx)) { toast('Hãy xem bài trước nhé! 🔒'); return; }
        play(lib[chIdx].videos, gridIdx); return;
      }
      else if (BACK.indexOf(k) >= 0) { zone = 'side'; sideIdx = chIdx; }
    }
    focus();
  }

  // ---------- Màn tổng quan ----------
  // Mở TV: thấy ngay từng bé đang ở đâu trên lộ trình, hôm nay xem bao lâu, mốc năm nay — rồi bố mẹ mới chọn chương trình.
  try { ov = JSON.parse(localStorage.getItem('ct-ov')); } catch (e) { ov = null; }
  function showOverview() {
    clearTimeout(endTimer);
    $('#home').classList.add('hidden');
    $('#end').classList.add('hidden');
    $('#ov').classList.remove('hidden');
    zone = 'ov';
    ovIdx = 0;
    paintOverview();
    loadOverview();
  }
  function hideOverview() {
    $('#ov').classList.add('hidden');
    $('#home').classList.remove('hidden');
    zone = 'side';
    sideIdx = chIdx;
    if (timeUp()) { showLimit(); return; }
    focus();
  }
  function loadOverview() {
    return rpc('ct_tv_overview', { p_device: device.id, p_secret: device.secret }).then(function (r) {
      ov = r;
      try { localStorage.setItem('ct-ov', JSON.stringify(r)); } catch (e) { /* bộ nhớ đầy */ }
      if (zone === 'ov') paintOverview();
    }).catch(function () { /* mạng chậm: giữ bản đã lưu */ });
  }
  var MOOD = { 'vui': '😄', 'bình thường': '🙂', 'mệt': '🥱', 'buồn': '😢', 'cáu': '😠' };
  function hi() { var h = new Date().getHours(); return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; }

  // Lộ trình ngắn của giáo trình đang học: đã xong / đang học / bài tiếp theo (lộ trình dài hạn theo tuổi chỉ xem trong app)
  function tvPaths(k) {
    var ps = (k.paths || []).slice(0, 1);
    if (!ps.length) return '<div class="ov-none ov-pnone">Bố mẹ thêm giáo trình cho bé trong app ChildTube để thấy lộ trình học ở đây.</div>';
    return ps.map(function (p) {
      var st = (p.from ? '<div class="tp-s more"><i>…</i><span></span></div>' : '') + p.steps.map(function (s) {
        return '<div class="tp-s' + (s.done ? ' done' : s.now ? ' now' : '') + '"><i>' + (s.done ? '✓' : s.now ? '▶' : s.n) + '</i><span>' + esc(s.title) + '</span></div>';
      }).join('') + (p.from + p.steps.length < p.total ? '<div class="tp-s more"><i>+' + (p.total - p.from - p.steps.length) + '</i><span>bài nữa</span></div>' : '') +
        '<div class="tp-s end' + (p.done === p.total ? ' done' : '') + '"><i>🏁</i><span>Hoàn thành</span></div>';
      return '<div class="tp"><div class="tp-h"><b>' + esc((p.emoji || '📘') + ' ' + p.name) + '</b><span>' + p.done + '/' + p.total + ' bài</span></div>' +
        '<span class="ov-bar tp-bar"><i style="width:' + (p.total ? p.done / p.total * 100 : 0) + '%"></i></span><div class="tp-row">' + st + '</div></div>';
    }).join('');
  }
  // Đường lộ trình 3 → 18 tuổi: các giai đoạn (đã qua / đang ở / phía trước), bé đứng ở tuổi hiện tại, cờ mục tiêu ở cuối
  function journey(k, W) {
    var H = 150, L = 30, R = W - 80, Y = 74, A0 = 3, A1 = 18;
    var sx = function (a) { return L + (R - L) * (a - A0) / (A1 - A0); };
    var st = (k.road && k.road.stages) || [], out = '', i, s, x0, x1, col;
    for (i = 0; i < st.length; i++) {
      s = st[i]; x0 = sx(s.from); x1 = sx(s.to + 1) - 6;
      col = s.state === 'past' ? '#30d158' : s.state === 'now' ? '#ff453a' : 'rgba(255,255,255,.18)';
      out += '<rect x="' + x0 + '" y="' + (Y - 7) + '" width="' + (x1 - x0) + '" height="14" rx="7" fill="' + col + '"/>';
      out += '<text x="' + ((x0 + x1) / 2) + '" y="' + (Y + 44) + '" text-anchor="middle" font-size="18" font-weight="' + (s.state === 'now' ? 800 : 600) + '" fill="' + (s.state === 'now' ? '#fff' : 'rgba(235,235,245,.6)') + '">' + esc(s.name) + '</text>';
      out += '<text x="' + ((x0 + x1) / 2) + '" y="' + (Y + 66) + '" text-anchor="middle" font-size="15" fill="rgba(235,235,245,.4)">' + s.from + '–' + s.to + ' tuổi</text>';
    }
    var age = k.age == null ? A0 : Math.max(A0, Math.min(A1 - 1, k.age)), ax = sx(age + 0.5);
    out += '<circle cx="' + ax + '" cy="' + Y + '" r="27" fill="#fff"/><text x="' + ax + '" y="' + (Y + 11) + '" text-anchor="middle" font-size="30">' + esc(k.emoji || '🧒') + '</text>';
    out += '<text x="' + (ax < 140 ? L - 6 : ax) + '" y="' + (Y - 40) + '" text-anchor="' + (ax < 140 ? 'start' : 'middle') + '" font-size="17" font-weight="800" fill="#ff6961">' + (k.age != null ? k.age + ' tuổi · ' : '') + 'bé đang ở đây</text>';
    var g = (k.road && k.road.goals) || [];
    out += '<text x="' + (R + 40) + '" y="' + (Y + 12) + '" text-anchor="middle" font-size="36">🎯</text>';
    out += '<text x="' + (R + 40) + '" y="' + (Y + 44) + '" text-anchor="middle" font-size="15" fill="rgba(235,235,245,.6)">' + (g.length ? g.length + ' mục tiêu' : 'mục tiêu') + '</text>';
    return '<svg class="ov-road" viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + out + '</svg>';
  }
  function paintOverview() {
    var d = new Date();
    $('#ov-clock').innerHTML = '<b>' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2) + '</b><span>' + DAYS[d.getDay()] + ', ' + d.getDate() + ' tháng ' + (d.getMonth() + 1) + '</span>';
    var used = Math.floor(usedSec() / 60), lim = quota.limit ? quota.limit + extra.n : null;
    var kids = (ov && ov.kids) || [];
    $('#ov-hi').innerHTML = '<h1>' + hi() + ', ' + esc((ov && ov.family) || 'cả nhà') + ' 👋</h1>' +
      '<div class="ov-today"><span>📺 Hôm nay đã xem <b>' + used + (lim ? ' / ' + lim : '') + ' phút</b></span>' +
      (lim ? '<span class="ov-bar"><i style="width:' + Math.min(100, used / lim * 100) + '%"></i></span><span>' + (lim > used ? 'còn ' + (lim - used) + ' phút' : 'đã hết giờ') + '</span>' : '') + '</div>';
    $('#ov-kids').className = 'n' + Math.min(kids.length, 3);
    $('#ov-kids').innerHTML = kids.length ? kids.map(function (k) {
      var p = (k.road && k.road.progress) || { done: 0, total: 0 }, ms = (k.road && k.road.milestones) || [], now = null, i;
      for (i = 0; i < ((k.road && k.road.stages) || []).length; i++) if (k.road.stages[i].state === 'now') now = k.road.stages[i];
      ms = ms.filter(function (m) { return m.status !== 'done'; }).slice(0, 3);
      var chips = ms.length ? ms.map(function (m) { return '<span class="ov-chip ' + m.status + '">' + (m.status === 'done' ? '✓' : m.status === 'doing' ? '◐' : '○') + ' ' + esc(m.title) + '</span>'; }).join('')
        : '<span class="ov-none">' + (p.total ? 'Đã xong mọi mốc năm nay 🎉' : 'Chưa có mốc năm nay — bố mẹ thêm trong app (Học → Lộ trình)') + '</span>';
      var moods = (k.moods || []).map(function (m) { return '<i>' + (m ? MOOD[m] || '📝' : '·') + '</i>'; }).join('');
      var sk = (k.skills && k.skills.list) || [], bars = sk.filter(function (x) { return x.level; }).slice(0, 6).map(function (x) {
        return '<div class="ov-sk"><span>' + esc(x.icon + ' ' + x.name) + '</span><b><i style="width:' + x.level * 20 + '%"></i></b></div>'; }).join('');
      return '<div class="ov-kid">' +
        '<div class="ov-kh"><span class="ov-av">' + esc(k.emoji || '🧒') + '</span><div><h2>' + esc(k.name) + '</h2><div class="ov-sub">' + (k.age != null ? k.age + ' tuổi · ' : '') + ((k.paths || []).length ? 'đang học ' + k.paths.length + ' giáo trình' : 'chưa có giáo trình') + '</div></div></div>' +
        tvPaths(k) +
        '<div class="ov-stats">' +
          '<div><b>' + p.done + '/' + p.total + '</b><span>mốc năm nay</span><span class="ov-bar"><i style="width:' + (p.total ? p.done / p.total * 100 : 0) + '%"></i></span></div>' +
          '<div><b>' + k.lessons_week.done + '/' + k.lessons_week.target + '</b><span>bài tuần này</span></div>' +
          '<div><b>' + (k.streak ? '🔥 ' + k.streak : '0') + '</b><span>ngày liên tiếp</span></div>' +
          '<div class="ov-moods"><b>' + moods + '</b><span>cảm xúc 7 ngày</span></div>' +
        '</div>' +
        '<div class="ov-plh">Mốc gần nhất</div><div class="ov-chips">' + chips + '</div>' +
        (bars ? '<div class="ov-sks">' + bars + '</div>' : '') +
        (k.next ? '<div class="ov-next"><img src="' + thumb(k.next.video) + '" alt=""><div><span>Bài tiếp theo</span><b>' + esc(k.next.lesson) + '</b><em>' + esc((k.next.emoji || '📘') + ' ' + k.next.group) + '</em></div></div>' : '') +
        '</div>';
    }).join('') : familyCard();
    var btns = ['<button class="obtn main" data-act="lib">📚 Chọn chương trình</button>'];
    if (curList().length) btns.push('<button class="obtn" data-act="road">🗺 Hành trình của bé</button>');
    btns.push('<button class="obtn" data-act="photos">🏆 Bảng tin của bé</button>');
    kids.forEach(function (k, i) { if (k.next && findLesson(k.next)) btns.push('<button class="obtn" data-act="next" data-i="' + i + '">▶ ' + esc(k.name) + ' học tiếp: ' + esc(k.next.lesson) + '</button>'); });
    $('#ov-btns').innerHTML = btns.join('');
    if (ovIdx >= btns.length) ovIdx = 0;
    focus();
  }
  // Chưa có hồ sơ bé: vẫn cho thấy cả nhà đang học tới đâu (tiến độ từng giáo trình, các playlist) từ danh sách của TV
  function familyCard() {
    var cur = lib.filter(function (g) { return g.numbered; }), pl = lib.filter(function (g) { return !g.numbered && g.section !== 'fav'; });
    var rows = cur.slice(0, 3).map(function (g) {
      var n = g.videos.length, d = doneCount(g), v = g.videos[startIndex(g)];
      return '<div class="ov-cur"><img src="' + (v ? thumb(v.id) : '') + '" alt=""><div><b>' + esc((g.emoji ? g.emoji + ' ' : '') + g.title) + '</b>' +
        '<span class="ov-bar"><i style="width:' + (n ? d / n * 100 : 0) + '%"></i></span><em>Đã học ' + d + '/' + n + ' bài' + (v && d < n ? ' · tiếp theo: ' + esc(v.title) : '') + '</em></div></div>';
    }).join('');
    var chip = function (g) { return '<span class="ov-chip">' + esc((g.emoji ? g.emoji + ' ' : '') + g.title) + ' · ' + g.videos.length + '</span>'; };
    var mine = pl.filter(function (g) { return g.section === 'topic'; }), yt = pl.filter(function (g) { return g.section !== 'topic'; });
    var chips = (mine.length ? '<div class="ov-plh">Playlist của gia đình</div><div class="ov-chips">' + mine.slice(0, 8).map(chip).join('') + '</div>' : '') +
      (yt.length ? '<div class="ov-plh">Kênh & playlist YouTube</div><div class="ov-chips">' + yt.slice(0, 8).map(chip).join('') + '</div>' : '');
    return '<div class="ov-kid ov-fam"><div class="ov-kh"><span class="ov-av">👨‍👩‍👧</span><div><h2>Cả nhà đang học</h2><div class="ov-sub">Thêm hồ sơ bé (tên, ngày sinh) trong app ChildTube → Gia đình để thấy lộ trình riêng của từng bé ở đây.</div></div></div>' +
      (rows || '<div class="ov-none">Chưa có giáo trình nào.</div>') + chips + '</div>';
  }
  // Bài tiếp theo của bé nằm ở đâu trong danh sách của TV
  function findLesson(n) {
    for (var i = 0; i < lib.length; i++) if (lib[i].id === n.group_id) {
      for (var j = 0; j < lib[i].videos.length; j++) if (lib[i].videos[j].id === n.video) return { ch: i, idx: j };
    }
    return null;
  }
  function ovAct(b) {
    var act = b.getAttribute('data-act');
    if (act === 'lib') { hideOverview(); return; }
    if (act === 'road') { showRoad('ov'); return; }
    if (act === 'photos') { showPhotos('ov'); return; }
    var k = ov && ov.kids[+b.getAttribute('data-i')], at = k && findLesson(k.next);
    if (!at) { hideOverview(); return; }
    $('#ov').classList.add('hidden');
    $('#home').classList.remove('hidden');
    zone = 'side';
    chIdx = -1; showChannel(at.ch); sideIdx = at.ch;
    if (isLocked(lib[at.ch], at.idx)) { focus(); toast('Hãy xem bài trước nhé! 🔒'); return; }
    play(lib[at.ch].videos, at.idx);
  }
  function ovKey(k) {
    var n = $('#ov-btns').children.length;
    if ((k === K.LEFT || k === K.UP) && ovIdx > 0) ovIdx--;
    else if ((k === K.RIGHT || k === K.DOWN) && ovIdx < n - 1) ovIdx++;
    else if (k === K.ENTER) { ovAct($('#ov-btns').children[ovIdx]); return; }
    else if (k === 10009) { try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* không phải TV */ } return; }
    focus();
  }

  // ---------- Lộ trình (mục riêng: nút "Lộ trình của bé" ở cột trái, hoặc nút ở màn mở đầu) ----------
  var rmFrom = 'side';
  function curList() { var a = []; for (var i = 0; i < lib.length; i++) if (lib[i].numbered && lib[i].videos.length) a.push(i); return a; }
  function curLessons(g) {
    var ls = [], map = {}, i, v, key, l;
    for (i = 0; i < g.videos.length; i++) {
      v = g.videos[i];
      key = v.ln ? 'l' + v.ln : 'v' + i;
      l = map[key];
      if (!l) { l = map[key] = { n: v.ln || ls.length + 1, title: v.lt || v.title, mt: v.mt || '', idx: i, vid: v.id, done: true, main: 0 }; ls.push(l); }
      if (v.role !== 'extra') { l.main++; if (!v.done) l.done = false; }
    }
    for (i = 0; i < ls.length; i++) if (!ls[i].main) ls[i].done = false;
    return ls;
  }
  // Lộ trình giáo dục: theo tuổi của bé, 3 giai đoạn Nền tảng → Củng cố → Mở rộng; mỗi giai đoạn nói rõ
  // bé cần đạt gì (theo khung năng lực 6 lĩnh vực) và BỐ MẸ LÀM GÌ mỗi ngày; kèm cách dùng màn hình hợp tuổi.
  var comp = null;
  try { comp = JSON.parse(localStorage.getItem('ct-comp')); } catch (e) { comp = null; }
  function loadComp() {
    if (comp && comp.items) return Promise.resolve(comp);
    return fetch('../app/competency.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
      comp = { domains: j.domains, items: j.items };
      try { localStorage.setItem('ct-comp', JSON.stringify(comp)); } catch (e) { /* bộ nhớ đầy */ }
      return comp;
    });
  }
  // Tuổi bé: hồ sơ bé (nếu có) → ghi chú giáo trình ("1–2 tuổi") → mặc định 4
  function kidAge(kid, g) {
    if (kid && kid.age != null) return Math.max(2, Math.min(7, kid.age));
    var m = g && g.note && /(\d+)\s*(?:–|-)\s*(\d+)\s*tuổi|(\d+)\s*tuổi/.exec(g.note);
    if (m) return Math.max(2, Math.min(7, +(m[2] || m[3])));
    return 4;
  }
  function domOf(id) { for (var i = 0; i < comp.domains.length; i++) if (comp.domains[i].id === id) return comp.domains[i]; return { emoji: '•', short: '' }; }
  function roadStages(age) {
    var items = comp.items.filter(function (x) { return x.needs !== 'both'; }), used = {};
    function pick(test, sortFn, n) {
      var list = items.filter(function (x) { return !used[x.id] && test(x); }).sort(sortFn), out = [], doms = {};
      for (var i = 0; i < list.length && out.length < n; i++) if (!doms[list[i].d]) { doms[list[i].d] = 1; out.push(list[i]); }   // mỗi lĩnh vực một mục cho đều
      for (i = 0; i < list.length && out.length < n; i++) if (out.indexOf(list[i]) < 0) out.push(list[i]);
      out.forEach(function (x) { used[x.id] = 1; });
      return out;
    }
    return [
      { name: 'Nền tảng', sub: 'Những việc bé nên làm được ở tuổi này', items: pick(function (x) { return x.a <= age; }, function (p, q) { return q.a - p.a; }, 4) },
      { name: 'Củng cố', sub: 'Đang hình thành, cần luyện mỗi ngày', items: pick(function (x) { return x.a > age - 1 && x.a <= age + 1; }, function (p, q) { return p.a - q.a; }, 4) },
      { name: 'Mở rộng', sub: 'Bước tiếp theo khi bé đã vững', items: pick(function (x) { return x.a > age && x.a <= age + 2; }, function (p, q) { return p.a - q.a; }, 4) },
    ];
  }
  // ---------- Hành trình của bé: bản đồ kiểu game ----------
  // Con đường uốn lượn với các chấm mốc: ⭐ điều bé ĐÃ LÀM ĐƯỢC (bố mẹ, ông bà ghi trong bảng tin) → bé đang ở đây → 🎯 mốc tiếp theo → 🏁.
  // Chọn chấm bằng ◀ ▶: chấm đã đạt hiện ngày, người ghi, ảnh; chấm phía trước hiện việc bố mẹ làm cùng bé để đạt được.
  var feed = null, mapSel = 0, mapRow = 'map', rmIdx2 = 0, mapMoved = false;
  try { feed = JSON.parse(localStorage.getItem('ct-feed')); } catch (e) { feed = null; }
  function loadFeed() {
    return rpc('ct_tv_feed', { p_device: device.id, p_secret: device.secret }).then(function (r) {
      feed = r;
      try { localStorage.setItem('ct-feed', JSON.stringify(r)); } catch (e) { /* bộ nhớ đầy */ }
      return r;
    });
  }
  var LEVELS = ['Hạt mầm', 'Chồi non', 'Lá xanh', 'Cây nhỏ', 'Nhà thám hiểm', 'Ngôi sao nhỏ', 'Siêu sao'];
  function mapNodes() {
    var cs = curList(), g = cs.length ? lib[cs[0]] : null, kid = ov && ov.kids && ov.kids[0], age = kidAge(kid, g);
    var wins = (feed && feed.wins) || [], plan = (feed && feed.plan) || [], nodes = [], i;
    var past = wins.slice(0, 5).reverse();
    if (!past.length) nodes.push({ t: 'start', title: 'Bắt đầu hành trình' });
    for (i = 0; i < past.length; i++) nodes.push({ t: 'win', w: past[i], title: past[i].title });
    nodes.push({ t: 'now', title: kid ? kid.name : 'Bé' });
    var next = [], seen = {};
    for (i = 0; i < wins.length; i++) seen[(wins[i].title || '').toLowerCase()] = 1;
    for (i = 0; i < plan.length && next.length < 5; i++) next.push({ t: 'goal', title: plan[i].title, due: plan[i].due_on, doing: plan[i].status === 'doing' });
    if (comp) {
      var st = roadStages(age), items = st[0].items.concat(st[1].items, st[2].items);
      for (i = 0; i < items.length && next.length < 5; i++) if (!seen[items[i].t.toLowerCase()]) next.push({ t: 'goal', title: items[i].t, tip: items[i].tip, d: items[i].d });
    }
    nodes = nodes.concat(next);
    nodes.push({ t: 'end', title: 'Đích đến' });
    return { nodes: nodes, wins: wins, age: age, kid: kid, g: g };
  }
  // Đường uốn lượn: y theo hình sin, chia đều theo x
  function mapSvg(nodes, sel) {
    var W = 1600, H = 520, L = 90, R = 1510, n = nodes.length, pts = [], i, x, y, out = '';
    var yAt = function (t) { return 260 + 88 * Math.sin(t * Math.PI * 2.2 - 0.6); };
    for (i = 0; i < n; i++) { x = n > 1 ? L + (R - L) * i / (n - 1) : (L + R) / 2; pts.push([x, yAt(n > 1 ? i / (n - 1) : 0.5)]); }
    var path = '', k;
    for (k = 0; k <= 80; k++) { var tt = k / 80; path += (k ? ' L' : 'M') + (L + (R - L) * tt).toFixed(1) + ' ' + yAt(tt).toFixed(1); }
    var nowI = 0; for (i = 0; i < n; i++) if (nodes[i].t === 'now') nowI = i;
    var walkTo = n > 1 ? nowI / (n - 1) : 0, walked = '';
    for (k = 0; k <= 80 * walkTo; k++) { var t2 = k / 80; walked += (k ? ' L' : 'M') + (L + (R - L) * t2).toFixed(1) + ' ' + yAt(t2).toFixed(1); }
    out += '<path d="' + path + '" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="34" stroke-linecap="round"/>';
    out += '<path d="' + path + '" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="4" stroke-dasharray="2 18" stroke-linecap="round"/>';
    if (walked) out += '<path d="' + walked + '" fill="none" stroke="url(#gw)" stroke-width="34" stroke-linecap="round"/>';
    for (i = 0; i < n; i++) {
      var nd = nodes[i], p = pts[i], sz = nd.t === 'now' ? 50 : 34, fill, ic, col;
      if (nd.t === 'win') { fill = '#ffd60a'; ic = nd.w.kind === 'achievement' ? '🏆' : '⭐'; col = '#ffe680'; }
      else if (nd.t === 'now') { fill = '#ffffff'; ic = (nodes.kidEmoji || '🧒'); col = '#ff6961'; }
      else if (nd.t === 'goal') { fill = nd.doing ? '#3a3a3c' : '#2c2c2e'; ic = nd.doing ? '◐' : '🎯'; col = 'rgba(235,235,245,.7)'; }
      else if (nd.t === 'end') { fill = '#2c2c2e'; ic = '🏁'; col = 'rgba(235,235,245,.6)'; }
      else { fill = '#30d158'; ic = '🚩'; col = '#7ee2a0'; }
      if (i === sel) out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (sz + 13) + '" fill="none" stroke="#fff" stroke-width="5"/>';
      if (nd.t === 'now') out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (sz + 6) + '" fill="none" stroke="#ff453a" stroke-width="5"><animate attributeName="r" values="' + (sz + 4) + ';' + (sz + 16) + ';' + (sz + 4) + '" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.2;1" dur="2.4s" repeatCount="indefinite"/></circle>';
      out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + sz + '" fill="' + fill + '"' + (nd.t === 'goal' ? ' stroke="rgba(255,255,255,.35)" stroke-width="3" stroke-dasharray="6 6"' : '') + '/>';
      out += '<text x="' + p[0] + '" y="' + (p[1] + sz * 0.36) + '" text-anchor="middle" font-size="' + Math.round(sz * 1.05) + '">' + esc(ic) + '</text>';
      // Nhãn đặt phía ngoài đường cong (trên đỉnh thì ghi lên trên, dưới đáy thì ghi xuống dưới) để không đè nhau
      var words = String(nd.t === 'now' ? 'Bé đang ở đây' : nd.title || '').split(' '), l1 = '', l2 = '';
      for (k = 0; k < words.length; k++) { if ((l1 + ' ' + words[k]).length <= 15 && !l2) l1 = (l1 ? l1 + ' ' : '') + words[k]; else if ((l2 + ' ' + words[k]).length <= 15) l2 = (l2 ? l2 + ' ' : '') + words[k]; else { l2 += '…'; break; } }
      var lines = [[l1, 19, nd.t === 'now' || i === sel ? 800 : 600, col]];
      if (l2) lines.push([l2, 19, 600, col]);
      if (nd.t === 'win' && nd.w.day) lines.push([phDay(nd.w.day), 15, 400, 'rgba(235,235,245,.45)']);
      if (nd.t === 'goal' && nd.due) lines.push(['hẹn ' + phDay(nd.due), 15, 400, 'rgba(235,235,245,.45)']);
      var above = p[1] < 260, gap = sz + (i === sel ? 22 : 14) + (i % 2) * 50, yy = above ? p[1] - gap - (lines.length - 1) * 23 : p[1] + gap + 18;
      for (k = 0; k < lines.length; k++) out += '<text x="' + p[0] + '" y="' + (yy + k * 23) + '" text-anchor="middle" font-size="' + lines[k][1] + '" font-weight="' + lines[k][2] + '" fill="' + lines[k][3] + '">' + esc(lines[k][0]) + '</text>';
    }
    return '<svg class="mp-svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%"><defs><linearGradient id="gw" x1="0" x2="1"><stop offset="0" stop-color="#ffd60a"/><stop offset="1" stop-color="#30d158"/></linearGradient></defs>' + out + '</svg>';
  }
  function showRoad(from) {
    rmFrom = from || 'side';
    $('#home').classList.add('hidden'); $('#ov').classList.add('hidden'); $('#rm').classList.remove('hidden');
    zone = 'rm'; mapRow = 'map'; mapSel = -1; mapMoved = false;
    paintRoad();
    loadComp().then(function () { if (zone === 'rm') paintRoad(); }, function () {});
    loadFeed().then(function () { if (zone === 'rm') paintRoad(); }, function () { if (zone === 'rm') paintRoad(); });
    loadOverview().then(function () { if (zone === 'rm') paintRoad(); });
  }
  function hideRoad() {
    $('#rm').classList.add('hidden');
    if (rmFrom === 'ov') { showOverview(); return; }
    $('#home').classList.remove('hidden');
    zone = 'side'; sideIdx = chIdx < 0 ? 0 : chIdx; focus();
  }
  function paintRoad() {
    var m = mapNodes(), nodes = m.nodes, i, nowI = 0;
    nodes.kidEmoji = m.kid && m.kid.emoji;
    for (i = 0; i < nodes.length; i++) if (nodes[i].t === 'now') nowI = i;
    if (mapSel < 0 || mapSel >= nodes.length || !mapMoved) mapSel = nowI;
    var nW = m.wins.length, lv = Math.min(LEVELS.length, Math.floor(nW / 3) + 1), toNext = 3 - nW % 3;
    $('#rm-kids').innerHTML = '<span class="hud-lv">Cấp ' + lv + ' · ' + LEVELS[lv - 1] + '</span><span class="hud-xp"><i style="width:' + (nW % 3) / 3 * 100 + '%"></i></span><em>còn ' + toNext + ' ⭐ lên cấp</em>';
    var nd = nodes[mapSel], det = '';
    if (nd.t === 'win') {
      var w = nd.w;
      det = (w.photo ? '<img class="mp-pic" src="' + phUrl({ url: w.photo }) + '" alt="">' : '<div class="mp-badge">' + (w.kind === 'achievement' ? '🏆' : '⭐') + '</div>') +
        '<div class="mp-txt"><span class="mp-tag win">Bé đã làm được!</span><b>' + esc(w.title) + '</b><em>' + phDay(w.day) + (w.by ? ' · ghi bởi ' + esc(w.by) : '') + (w.child ? ' · ' + esc(w.child) : '') + '</em>' + (w.text ? '<p>' + esc(w.text) + '</p>' : '') + '</div>';
    } else if (nd.t === 'goal') {
      det = '<div class="mp-badge goal">🎯</div><div class="mp-txt"><span class="mp-tag">' + (nd.doing ? 'Đang tập' : 'Mốc tiếp theo') + '</span><b>' + esc(nd.title) + '</b>' +
        (nd.due ? '<em>Hẹn đạt: ' + phDay(nd.due) + '</em>' : '') + '<p>' + (nd.tip ? '👨‍👩‍👧 Bố mẹ làm cùng bé: ' + esc(nd.tip) : 'Khi bé làm được, bố mẹ ghi “Cột mốc” trong Bảng tin của app để thắp sáng chấm này ⭐') + '</p></div>';
    } else if (nd.t === 'now') {
      det = '<div class="mp-badge now">' + esc(m.kid && m.kid.emoji || '🧒') + '</div><div class="mp-txt"><span class="mp-tag now">Bé đang ở đây</span><b>' + (nW ? 'Đã đạt ' + nW + ' thành tích ⭐' : 'Hành trình vừa bắt đầu') + '</b>' +
        '<p>' + (nW ? 'Gần nhất: ' + esc(m.wins[0].title) + ' (' + phDay(m.wins[0].day) + ').' : 'Mỗi khi bé làm được điều mới (biết đếm 1–10, nhảy lò cò, nói từ mới…), bố mẹ hoặc ông bà ghi vào Bảng tin trong app — chấm ⭐ sẽ hiện trên đường.') + '</p></div>';
    } else {
      det = '<div class="mp-badge goal">' + (nd.t === 'end' ? '🏁' : '🚩') + '</div><div class="mp-txt"><b>' + esc(nd.title) + '</b><p>' + (nd.t === 'end' ? 'Hoàn thành các mốc của giai đoạn này.' : 'Điểm xuất phát.') + '</p></div>';
    }
    $('#rm-body').innerHTML = '<div class="mp-map">' + mapSvg(nodes, mapRow === 'map' ? mapSel : -1) + '</div><div class="mp-det">' + det + '</div>';
    var btns = [], cs = curList();
    if (cs.length) btns.push('<button class="obtn main" data-act="rm-next">▶ Học tiếp</button>');
    btns.push('<button class="obtn" data-act="rm-feed">🏆 Bảng tin của bé</button>');
    btns.push('<button class="obtn" data-act="rm-back">' + (rmFrom === 'ov' ? '← Quay lại' : '← Thư viện') + '</button>');
    $('#rm-btns').innerHTML = btns.join('');
    if (rmIdx2 >= btns.length) rmIdx2 = 0;
    focus();
  }
  function rmAct(b) {
    var act = b.getAttribute('data-act');
    if (act === 'rm-back') return hideRoad();
    if (act === 'rm-feed') { $('#rm').classList.add('hidden'); showPhotos(rmFrom === 'ov' ? 'ov' : 'side'); return; }
    var gi = curList()[0], g = lib[gi];
    if (!g) return hideRoad();
    var ls = curLessons(g), cur = null;
    for (var i = 0; i < ls.length; i++) if (!ls[i].done) { cur = ls[i]; break; }
    $('#rm').classList.add('hidden'); $('#home').classList.remove('hidden');
    zone = 'side'; chIdx = -1; showChannel(gi); sideIdx = gi;
    if (!cur) { focus(); return; }
    if (isLocked(g, cur.idx)) { focus(); toast('Hãy xem bài trước nhé! 🔒'); return; }
    play(g.videos, cur.idx);
  }
  function rmKey(k) {
    if (BACK.indexOf(k) >= 0) { hideRoad(); return; }
    var n = $('#rm-btns').children.length, total = mapNodes().nodes.length;
    if (mapRow === 'map') {
      if (k === K.LEFT && mapSel > 0) { mapSel--; mapMoved = true; paintRoad(); return; }
      if (k === K.RIGHT && mapSel < total - 1) { mapSel++; mapMoved = true; paintRoad(); return; }
      if (k === K.DOWN || k === K.ENTER) { mapRow = 'btn'; rmIdx2 = 0; paintRoad(); return; }
      return;
    }
    if (k === K.UP) { mapRow = 'map'; paintRoad(); return; }
    if (k === K.LEFT && rmIdx2 > 0) rmIdx2--;
    else if (k === K.RIGHT && rmIdx2 < n - 1) rmIdx2++;
    else if (k === K.ENTER) { rmAct($('#rm-btns').children[rmIdx2]); return; }
    focus();
  }

  // ---------- Ảnh kỷ niệm (kiểu Google Photos) ----------
  // Ảnh trong bảng tin ChildTube ở mức "Gia đình": bố mẹ, ông bà, người thân đăng. Lọc theo người đăng; trình chiếu tự chạy.
  var ph = { list: [], who: '', idx: 0, chip: 0, at: 'grid', timer: null, vIdx: 0, vAuto: false, vTimer: null, from: 'side' };
  ph.list = (feed && feed.photos) || [];
  var ROLE = { owner: 'Bố mẹ', parent: 'Bố mẹ', relative: 'Người thân', teacher: 'Giáo viên' };
  function phUrl(p) { return /^https?:/.test(p.url) ? p.url : CT_CONFIG.url + p.url; }
  function phShown() { return ph.who ? ph.list.filter(function (p) { return (p.by || '') === ph.who; }) : ph.list; }
  function phDay(d) { var x = (d || '').split('-'); return x.length === 3 ? +x[2] + '/' + +x[1] + '/' + x[0] : ''; }
  function phCap(p) {
    return '<b>' + esc(p.title || (p.child ? 'Khoảnh khắc của ' + p.child : 'Khoảnh khắc gia đình')) + '</b>' +
      '<span>' + phDay(p.day) + (p.by ? ' · 📸 ' + esc(p.by) + (ROLE[p.role] && p.by !== ROLE[p.role] ? ' (' + ROLE[p.role] + ')' : '') : '') + '</span>';
  }
  function showPhotos(from) {
    ph.from = from || 'side';
    $('#home').classList.add('hidden'); $('#ov').classList.add('hidden'); $('#ph').classList.remove('hidden');
    zone = 'ph'; ph.at = 'grid'; ph.idx = 0;
    paintPhotos();
    loadFeed().then(function (r) {
      ph.enabled = r.enabled; ph.list = r.photos || []; ph.err = false;
      if (zone === 'ph') paintPhotos();
    }, function () { ph.err = true; if (zone === 'ph') paintPhotos(); });
  }
  function hidePhotos() {
    clearInterval(ph.timer);
    $('#ph').classList.add('hidden');
    if (ph.from === 'ov') { showOverview(); return; }
    $('#home').classList.remove('hidden');
    zone = 'side'; sideIdx = chIdx < 0 ? 0 : chIdx; focus();
  }
  function paintPhotos() {
    var whos = [], i, list;
    for (i = 0; i < ph.list.length; i++) if (ph.list[i].by && whos.indexOf(ph.list[i].by) < 0) whos.push(ph.list[i].by);
    if (ph.who && whos.indexOf(ph.who) < 0) ph.who = '';
    var chips = [['', 'Tất cả · ' + ph.list.length]].concat(whos.map(function (w) { return [w, '📸 ' + w]; }));
    $('#ph-chips').innerHTML = chips.map(function (c) { return '<button class="obtn ph-chip' + (c[0] === ph.who ? ' on' : '') + '" data-who="' + esc(c[0]) + '">' + esc(c[1]) + '</button>'; }).join('') +
      '<button class="obtn main ph-chip" data-act="show">▶ Trình chiếu</button>';
    list = phShown();
    // Thẻ thành tích kiểu game: mới nhất trước, mỗi thẻ một màu, có huy hiệu, ngày, người ghi
    var wins = (feed && feed.wins) || [], nW = wins.length;
    $('#ph-wins').classList.toggle('hidden', !nW);
    $('#ph-wins').innerHTML = nW ? '<div class="pw-h"><b>🏆 Bé đã làm được</b><span>⭐ ' + nW + ' thành tích · Cấp ' + Math.min(LEVELS.length, Math.floor(nW / 3) + 1) + ' ' + LEVELS[Math.min(LEVELS.length, Math.floor(nW / 3) + 1) - 1] + '</span></div><div class="pw-row">' +
      wins.slice(0, 5).map(function (w, k) {
        return '<div class="pw-card c' + (k % 5) + '">' + (w.photo ? '<img src="' + phUrl({ url: w.photo }) + '" alt="">' : '') +
          '<div class="pw-in"><span class="pw-badge">' + (w.kind === 'achievement' ? '🏆' : '⭐') + '</span><b>' + esc(w.title) + '</b><em>' + phDay(w.day) + (w.by ? ' · ' + esc(w.by) : '') + '</em>' +
          (k === 0 ? '<span class="pw-new">MỚI</span>' : '') + '</div></div>'; }).join('') + '</div>' : '';
    if (!list.length) {
      $('#ph-hero').classList.add('hidden');
      $('#ph-grid').innerHTML = '<div class="rm-empty">' + (ph.err ? 'Chưa tải được ảnh, hãy thử lại sau.' : ph.enabled === false
        ? 'Gia đình chưa bật lưu ảnh.<br>Trong app ChildTube: Cài đặt → Quyền riêng tư → bật "Lưu ảnh, video của bé".'
        : 'Chưa có ảnh nào.<br>Bố mẹ, ông bà đăng ảnh vào Bảng tin trong app ChildTube (mức "Gia đình") để ảnh hiện ở đây.') + '</div>';
      clearInterval(ph.timer);
    } else {
      $('#ph-hero').classList.toggle('hidden', !!nW);   // có thành tích thì dải thẻ thay cho ảnh lớn
      // Lưới theo tháng
      var html = '', month = '';
      list.forEach(function (p, k) {
        var m = (p.day || '').slice(0, 7);
        if (m !== month) { month = m; html += '<div class="ph-month">Tháng ' + +m.slice(5, 7) + ', ' + m.slice(0, 4) + '</div>'; }
        html += '<div class="ph-cell" data-k="' + k + '"><img src="' + phUrl(p) + '" alt=""' + (k > 17 ? ' loading="lazy"' : '') + ' decoding="async"></div>';
      });
      $('#ph-grid').innerHTML = html;
      phHero(0);
      clearInterval(ph.timer);
      ph.timer = setInterval(function () { if (zone === 'ph') phHero(ph.hero + 1); }, 7000);
    }
    if (ph.idx >= list.length) ph.idx = 0;
    focus();
  }
  // Ảnh lớn phía trên: hai lớp ảnh chuyển mờ dần
  function phHero(k) {
    var list = phShown(); if (!list.length) return;
    ph.hero = (k + list.length) % list.length;
    var p = list[ph.hero], a = $('#ph-a'), b = $('#ph-b'), top = a.classList.contains('on') ? b : a, old = top === a ? b : a;
    top.onload = function () { top.classList.add('on'); old.classList.remove('on'); };
    top.src = phUrl(p);
    $('#ph-cap').innerHTML = phCap(p);
  }
  function phCells() { return document.querySelectorAll('#ph-grid .ph-cell'); }
  var PH_COLS = 6;
  function phKey(k) {
    var cells = phCells(), chips = $('#ph-chips').children;
    if (BACK.indexOf(k) >= 0) { hidePhotos(); return; }
    if (ph.at === 'chips') {
      if (k === K.LEFT && ph.chip > 0) ph.chip--;
      else if (k === K.RIGHT && ph.chip < chips.length - 1) ph.chip++;
      else if (k === K.DOWN && cells.length) ph.at = 'grid';
      else if (k === K.ENTER) {
        var c = chips[ph.chip];
        if (c.getAttribute('data-act') === 'show') { openViewer(0, true); return; }
        ph.who = c.getAttribute('data-who'); ph.idx = 0; paintPhotos(); return;
      }
    } else {
      if (k === K.UP && ph.idx < PH_COLS) { ph.at = 'chips'; }
      else if (k === K.UP) ph.idx -= PH_COLS;
      else if (k === K.DOWN && ph.idx + PH_COLS < cells.length) ph.idx += PH_COLS;
      else if (k === K.LEFT && ph.idx > 0) ph.idx--;
      else if (k === K.RIGHT && ph.idx < cells.length - 1) ph.idx++;
      else if (k === K.ENTER && cells.length) { openViewer(ph.idx, false); return; }
    }
    focus();
  }
  // Xem toàn màn hình: ◀ ▶ đổi ảnh, OK bật/tắt trình chiếu tự động
  function openViewer(k, auto) {
    zone = 'phv'; ph.vAuto = !!auto;
    $('#phv').classList.remove('hidden');
    phShow(k);
  }
  function phShow(k) {
    var list = phShown(); if (!list.length) return closeViewer();
    ph.vIdx = (k + list.length) % list.length;
    var p = list[ph.vIdx];
    $('#phv-img').src = phUrl(p);
    $('#phv-cap').innerHTML = phCap(p) + (p.text ? '<em>' + esc(p.text) + '</em>' : '');
    $('#phv-n').textContent = (ph.vIdx + 1) + ' / ' + list.length + (ph.vAuto ? ' · ▶ đang trình chiếu' : ' · OK: trình chiếu');
    clearTimeout(ph.vTimer);
    if (ph.vAuto) ph.vTimer = setTimeout(function () { if (zone === 'phv') phShow(ph.vIdx + 1); }, 6000);
  }
  function closeViewer() {
    clearTimeout(ph.vTimer);
    $('#phv').classList.add('hidden');
    zone = 'ph'; ph.idx = Math.min(ph.vIdx, phCells().length - 1); ph.at = 'grid';
    focus();
  }
  function phvKey(k) {
    if (BACK.indexOf(k) >= 0 || k === K.STOP) { closeViewer(); return; }
    if (k === K.LEFT || k === K.RW) phShow(ph.vIdx - 1);
    else if (k === K.RIGHT || k === K.FF) phShow(ph.vIdx + 1);
    else if (k === K.ENTER || k === K.PLAYPAUSE || k === K.PLAY || k === K.PAUSE) { ph.vAuto = !ph.vAuto; phShow(ph.vIdx); }
  }

  // ---------- Lịch sử xem ----------
  // Mỗi lần bé mở một video là một dòng; cập nhật số giây đã xem mỗi 30 giây và khi thoát/hết video.
  var wl = null;

  function watchStart(v) {
    if (wl) watchFlush(wl, true);
    wl = { id: null, video: v.id, title: v.title, played: 0, sent: 0, duration: 0, busy: false, final: false, done: false };
  }

  function watchFlush(w, final) {
    if (!w) return;
    if (final) w.final = true;
    if (w.busy) return;                                   // đang gửi; gửi lại sau khi xong
    if (!w.final && w.id && w.played - w.sent < 30) return;
    if (!w.id && w.played < 3) { if (w.final && wl === w) wl = null; return; }  // mở chưa tới 3 giây: bỏ qua
    w.busy = true;
    var secs = Math.floor(w.played), sentFinal = w.final;
    rpc('ct_tv_watch', { p_device: device.id, p_secret: device.secret, p_id: w.id, p_video: w.video, p_title: w.title,
      p_seconds: secs, p_duration: Math.floor(w.duration), p_done: w.done }).then(function (id) {
      w.id = id; w.sent = secs; w.busy = false;
      if (w.final && !sentFinal) watchFlush(w, true);     // trong lúc gửi đã có lệnh kết thúc
      else if (sentFinal && wl === w) wl = null;
    }).catch(function () { w.busy = false; });
  }

  // ---------- Trình phát ----------
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('yt', {
      host: 'https://www.youtube-nocookie.com',
      width: '100%', height: '100%',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, cc_load_policy: 0, vq: 'hd720', origin: location.origin },
      events: {
        onReady: function () { playerReady = true; window.ctPlayer = player; try { player.setPlaybackQuality('hd720'); } catch (e) { /* YouTube tự chọn */ } if (pending) { player.loadVideoById(pending); pending = null; } },
        onStateChange: onState,
        onError: function () {
          toast('Video này không xem được, chuyển video khác…');
          setTimeout(next, 2000);
        }
      }
    });
  };

  function play(videos, idx) {
    if (timeUp()) { showLimit(); return; }
    if (qzDue()) { startQuiz(function () { play(videos, idx); }); return; }
    clearTimeout(endTimer);
    $('#end').classList.add('hidden');
    grace = false;
    queue = { videos: videos, idx: idx, group: lib[chIdx] };
    zone = 'player';
    document.body.classList.add('playing');
    $('#player').classList.remove('hidden');
    $('#pause-icon').classList.add('hidden');
    $('#osd-fill').style.width = '0';
    $('#osd-time').textContent = '';
    $('#osd-title').textContent = videos[idx].title;
    showOsd();
    watchStart(videos[idx]);
    // Giáo trình có thể chỉ định đoạn video (giây bắt đầu s / kết thúc e)
    var req = { videoId: videos[idx].id };
    if (videos[idx].s) req.startSeconds = videos[idx].s;
    if (videos[idx].e) req.endSeconds = videos[idx].e;
    if (playerReady) player.loadVideoById(req); else pending = req;
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 1000);
  }

  function hasNext() { return queue && queue.idx + 1 < queue.videos.length && !isLocked(queue.group, queue.idx + 1); }

  // Sang video kế: khi video lỗi, hoặc khi bố mẹ chọn "tự chuyển video kế".
  function next() {
    if (!queue || zone !== 'player') return;
    if (timeUp()) { showLimit(); return; }
    if (hasNext()) {
      play(queue.videos, queue.idx + 1);
      gridIdx = queue.idx;
    } else stop();
  }

  // Dừng phát, ghi lịch sử; chưa quyết định hiện màn nào.
  function endPlayback() {
    if (wl) watchFlush(wl, true);
    clearInterval(tickTimer);
    pending = null;
    if (playerReady) player.stopVideo();
    $('#player').classList.add('hidden');
  }

  function stop() {
    endPlayback();
    clearTimeout(endTimer);
    $('#end').classList.add('hidden');
    document.body.classList.remove('playing');
    var cg = lib[chIdx];
    renderGrid();
    if (cg && cg.numbered) gridIdx = startIndex(cg);
    zone = gridItems().length ? 'grid' : 'side';
    if (timeUp()) showLimit(); else focus();
  }

  // Hết video: mặc định dừng lại cho bé chọn (không tự phát tiếp); hết giờ thì sang màn hết giờ.
  function ended() {
    if (!queue || zone !== 'player') return;
    if (timeUp()) { showLimit(); return; }
    if (quota.end === 'next' && hasNext()) { upNext(); return; }   // phát liên tiếp trong cùng danh mục (chỉ video đã duyệt)
    showEnd();
  }
  // Phát liên tiếp: báo "Tiếp theo" 5 giây — OK để phát ngay, Back để dừng lại
  var unTimer = null, unLeft = 0;
  function upNext() {
    var v = queue.videos[queue.idx + 1], g = queue.group;
    zone = 'upnext'; unLeft = 5;
    $('#un-img').src = thumb(v.id);
    $('#un-title').textContent = (g && g.numbered ? lessonLabel(v, queue.idx + 1) + ' · ' : '') + v.title;
    $('#un-count').textContent = 'Tự phát sau ' + unLeft + ' giây · OK: phát ngay · Back: dừng';
    $('#upnext').classList.remove('hidden');
    clearInterval(unTimer);
    unTimer = setInterval(function () {
      if (zone !== 'upnext') { clearInterval(unTimer); return; }
      if (--unLeft <= 0) { unGo(true); return; }
      $('#un-count').textContent = 'Tự phát sau ' + unLeft + ' giây · OK: phát ngay · Back: dừng';
    }, 1000);
  }
  function unGo(play2) {
    clearInterval(unTimer);
    $('#upnext').classList.add('hidden');
    zone = 'player';
    if (play2) next(); else showEnd();
  }

  // ---------- Giải lao học bài ----------
  // Cứ xem đủ `every` phút (đếm cả khi tắt app mở lại) thì video tạm dừng, bé làm `count` câu hợp tuổi rồi mới xem tiếp.
  // Chỉ áp dụng khi có bé từ `min_age` tuổi (lấy từ màn tổng quan); bé nhỏ hơn thì không hỏi. Bố mẹ bỏ qua bằng PIN.
  var QZ_DEF = { on: true, every: 20, count: 5, min_age: 3 };
  var qzRun = null, qzIdx = 0, qzBusy = false;
  var qzSec = (function () { var v = null; try { v = JSON.parse(localStorage.getItem('ct-qz')); } catch (e) { v = null; } return v && v.day === today() ? v : { day: today(), n: 0 }; })();
  function qzSave() { try { localStorage.setItem('ct-qz', JSON.stringify(qzSec)); } catch (e) { /* bỏ qua */ } }
  function qc() { return quota.quiz || QZ_DEF; }
  function qzAge() {
    var ks = (ov && ov.kids) || [], ok = [];
    for (var i = 0; i < ks.length; i++) if (ks[i].age != null && ks[i].age >= qc().min_age) ok.push(ks[i].age);
    return ok.length ? Math.min.apply(null, ok) : null;     // nhiều bé: hỏi theo bé nhỏ nhất đủ tuổi
  }
  function qzDue() { return qc().on && qzAge() != null && qzSec.n >= qc().every * 60; }
  function qzCount() {
    if (qzSec.day !== today()) qzSec = { day: today(), n: 0 };
    qzSec.n++;
    if (qzSec.n % 10 === 0) qzSave();
  }
  var canSay = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  function say(t) {
    if (!canSay || !t) return;
    try { var u = new SpeechSynthesisUtterance(t); u.lang = 'vi-VN'; u.rate = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { /* TV không có giọng đọc */ }
  }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  // 3 lựa chọn: đáp án + 2 số gần đó (không âm, không trùng)
  function near(n, lo, hi) {
    var o = [n];
    while (o.length < 3) { var x = n + pick([-2, -1, 1, 2, 3]); if (x >= lo && x <= hi && o.indexOf(x) < 0) o.push(x); }
    return shuffle(o);
  }
  var DIGIT = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  function numWord(n) {
    if (n < 10) return DIGIT[n];
    if (n === 100) return 'một trăm';
    var c = Math.floor(n / 10), u = n % 10;
    var s = c === 1 ? 'mười' : DIGIT[c] + ' mươi';
    if (u === 0) return s;
    if (u === 1) return s + (c === 1 ? ' một' : ' mốt');
    if (u === 5) return s + ' lăm';
    if (u === 4 && c > 1) return s + ' tư';
    return s + ' ' + DIGIT[u];
  }
  var THINGS = [['🍎', 'quả táo'], ['⭐', 'ngôi sao'], ['🐟', 'con cá'], ['🎈', 'quả bóng bay'], ['🌸', 'bông hoa'], ['🚗', 'chiếc ô tô'], ['🐤', 'chú gà con'], ['🌧️', 'đám mây mưa'], ['🍌', 'quả chuối'], ['🦋', 'con bướm']];
  var WORDS = [['🐄', 'bò', 'B'], ['🐟', 'cá', 'C'], ['🐐', 'dê', 'D'], ['💡', 'đèn', 'Đ'], ['🐸', 'ếch', 'Ê'], ['🐔', 'gà', 'G'], ['🌸', 'hoa', 'H'], ['🍦', 'kem', 'K'], ['🍃', 'lá', 'L'],
    ['🐱', 'mèo', 'M'], ['🎀', 'nơ', 'N'], ['🐝', 'ong', 'O'], ['☂️', 'ô', 'Ô'], ['🐢', 'rùa', 'R'], ['⭐', 'sao', 'S'], ['🍎', 'táo', 'T'], ['🐘', 'voi', 'V'], ['🚲', 'xe đạp', 'X']];
  var LETTERS = 'A Ă Â B C D Đ E Ê G H I K L M N O Ô Ơ P R S T U Ư V X Y'.split(' ');
  function emo(e, n) { var s = ''; for (var i = 0; i < n; i++) s += '<i>' + e + '</i>'; return s; }

  // Mỗi câu: { t: tiêu đề, v: hình (HTML), cap: chú thích, opts: [..], ans, say: câu đọc, read: true = bé đọc to, bố mẹ xác nhận }
  var QGEN = {
    count: function (a) {
      var th = pick(THINGS), n = rnd(1, a <= 3 ? 5 : a === 4 ? 8 : 10);
      return { t: 'Đếm xem có mấy ' + th[1] + ' nhé', v: '<div class="qz-emo n' + Math.min(n, 10) + '">' + emo(th[0], n) + '</div>', cap: th[1], opts: near(n, 1, 10), ans: n, say: 'Con đếm xem có mấy ' + th[1] + ' nào?' };
    },
    more: function () {
      var th = pick(THINGS), l = rnd(1, 5), r = rnd(1, 5);
      while (r === l) r = rnd(1, 5);
      return { t: 'Bên nào nhiều ' + th[1] + ' hơn?', v: '<div class="qz-two"><div class="qz-emo">' + emo(th[0], l) + '</div><div class="qz-emo">' + emo(th[0], r) + '</div></div>', cap: '',
        opts: ['◀ Bên trái', 'Bên phải ▶'], ans: l > r ? '◀ Bên trái' : 'Bên phải ▶', say: 'Bên nào nhiều ' + th[1] + ' hơn?' };
    },
    read: function (a) {
      var n = a <= 4 ? rnd(1, 10) : a === 5 ? rnd(10, 50) : rnd(10, 100);
      return { t: 'Con đọc số này nhé', v: '<div class="qz-big">' + n + '</div>', cap: '', read: true, opts: ['✅ Bé đọc đúng rồi'], ans: '✅ Bé đọc đúng rồi', say: 'Số ' + numWord(n) };
    },
    which: function (a) {
      var n = a <= 5 ? rnd(1, 20) : rnd(10, 100), o = [n];
      while (o.length < 3) { var x = a <= 5 ? rnd(1, 20) : rnd(10, 100); if (o.indexOf(x) < 0) o.push(x); }
      return { t: 'Số «' + numWord(n) + '» là số nào?', v: '<div class="qz-word">' + numWord(n) + '</div>', cap: '', opts: shuffle(o), ans: n, say: 'Số ' + numWord(n) + ' là số nào?' };
    },
    next: function (a) {
      var s = rnd(1, a <= 4 ? 6 : 15);
      return { t: 'Số tiếp theo là số mấy?', v: '<div class="qz-seq">' + s + '<span>,</span>' + (s + 1) + '<span>,</span>' + (s + 2) + '<span>,</span><b>?</b></div>', cap: '', opts: near(s + 3, 1, 30), ans: s + 3, say: s + ', ' + (s + 1) + ', ' + (s + 2) + ', số tiếp theo là số mấy?' };
    },
    letter: function () {
      var w = pick(WORDS), o = [w[2]];
      while (o.length < 3) { var l = pick(LETTERS); if (o.indexOf(l) < 0) o.push(l); }
      return { t: 'Chữ «' + w[1] + '» bắt đầu bằng chữ nào?', v: '<div class="qz-pic">' + w[0] + '</div>', cap: w[1], opts: shuffle(o), ans: w[2], say: w[1] + '. Chữ ' + w[1] + ' bắt đầu bằng chữ cái nào?' };
    },
    spell: function () {
      var cs = ['b', 'd', 'đ', 'h', 'l', 'm', 'n', 't', 'v', 'x'], vs = ['a', 'o', 'ô', 'ơ', 'e', 'ê', 'i', 'u'];
      var c = pick(cs), v = pick(vs), o = [c + v];
      while (o.length < 3) { var x = o.length === 1 ? c + pick(vs) : pick(cs) + v; if (o.indexOf(x) < 0) o.push(x); }   // nhiễu: cùng phụ âm khác vần, cùng vần khác phụ âm
      return { t: 'Ghép vần nào', v: '<div class="qz-seq">' + c + '<span>+</span>' + v + '<span>=</span><b>?</b></div>', cap: '', opts: shuffle(o), ans: c + v, say: 'Chữ ' + c + ', ghép với chữ ' + v + ', thành tiếng gì?' };
    },
    add: function (a) {
      var big = a >= 6, x = rnd(1, big ? 10 : 5), y = rnd(1, big ? 10 : 5), th = pick(THINGS);
      if (big && Math.random() < 0.4 && x !== y) {   // phép trừ cho bé lớn
        var hi = Math.max(x, y), lo = Math.min(x, y);
        return { t: 'Làm phép trừ nào', v: '<div class="qz-seq">' + hi + '<span>−</span>' + lo + '<span>=</span><b>?</b></div>', cap: '', opts: near(hi - lo, 0, 20), ans: hi - lo, say: hi + ' trừ ' + lo + ' bằng mấy?' };
      }
      var v = big ? '<div class="qz-seq">' + x + '<span>+</span>' + y + '<span>=</span><b>?</b></div>'
        : '<div class="qz-two plus"><div class="qz-emo">' + emo(th[0], x) + '</div><span>+</span><div class="qz-emo">' + emo(th[0], y) + '</div></div>';
      return { t: big ? 'Làm phép cộng nào' : 'Gộp lại được mấy ' + th[1] + '?', v: v, cap: '', opts: near(x + y, 1, 20), ans: x + y, say: x + ' cộng ' + y + ' bằng mấy?' };
    },
  };
  function qzKinds(a) {
    if (a <= 3) return ['count', 'count', 'more', 'read'];
    if (a === 4) return ['count', 'more', 'read', 'next', 'letter'];
    if (a === 5) return ['count', 'read', 'next', 'letter', 'spell', 'add', 'which'];
    return ['add', 'add', 'spell', 'letter', 'read', 'which', 'next'];
  }
  function qzMake(a, n) {
    var ks = qzKinds(a), out = [], last = '';
    for (var i = 0; i < n; i++) {
      var k = pick(ks);
      if (k === last) k = pick(ks);                 // tránh hai câu giống loại liền nhau
      out.push(QGEN[k](a)); last = k;
    }
    return out;
  }

  // after: việc làm khi xong (tiếp tục video đang dở / phát video bé vừa chọn)
  function startQuiz(after) {
    var a = qzAge();
    if (playerReady && zone === 'player') player.pauseVideo();
    qzRun = { age: a, qs: qzMake(a, qc().count), i: -1, right: 0, wrong: 0, after: after, prev: zone };
    zone = 'qz';
    $('#qz').classList.remove('hidden');
    qzPaint();
  }
  function qzBtns(list) {
    $('#qz-opts').innerHTML = list.opts.map(function (o) { return '<button class="qbtn' + (String(o).length > 4 ? ' wide' : '') + '" data-v="' + esc(String(o)) + '">' + esc(String(o)) + '</button>'; }).join('');
    $('#qz-tools').innerHTML = (list.tools || []).map(function (b) { return '<button class="qtool" data-act="' + b[0] + '">' + b[1] + '</button>'; }).join('');
    qzIdx = 0; focus();
  }
  function qzPaint() {
    var r = qzRun, dots = '';
    $('#qz-msg').textContent = ''; $('#qz-msg').className = '';
    for (var i = 0; i < r.qs.length; i++) dots += '<i class="' + (i < r.i ? 'ok' : i === r.i ? 'now' : '') + '"></i>';
    $('#qz-dots').innerHTML = r.i >= 0 && r.i < r.qs.length ? dots : '';
    if (r.i < 0) {                                   // màn mở đầu
      $('#qz').className = 'screen intro';
      $('#qz-title').textContent = '';
      $('#qz-card').innerHTML = '<div class="qz-cloud">☁️<sup>z</sup></div><h1>Mình nghỉ một chút nhé</h1><p>Bây giờ mình cùng chơi số, đếm hình' + (r.age >= 4 ? ', chữ cái' : '') + (r.age >= 5 ? ' và ghép vần' : '') + '</p>';
      qzBtns({ opts: ['▶ Bắt đầu'], tools: [['parent', '🔒 Bố mẹ']] });
      say('Mình nghỉ một chút nhé. Cùng chơi nào!');
      return;
    }
    if (r.i >= r.qs.length) {                        // xong
      $('#qz').className = 'screen intro';
      $('#qz-title').textContent = '';
      $('#qz-card').innerHTML = '<div class="qz-star">⭐</div><h1>Con giỏi lắm!</h1><p>Con đã làm xong ' + r.qs.length + ' câu' + (r.wrong ? '' : ', không sai câu nào') + ' 🎉</p>';
      qzBtns({ opts: ['▶ Xem video tiếp', 'Chơi thêm'] });
      say('Con giỏi lắm!');
      return;
    }
    var q = r.qs[r.i];
    $('#qz').className = 'screen';
    $('#qz-title').textContent = q.t;
    $('#qz-card').innerHTML = q.v + (q.cap ? '<div class="qz-cap">' + esc(q.cap) + '</div>' : '');
    var tools = [];
    if (canSay) tools.push(['say', q.read ? '🔊 Nghe mẫu' : '🔊 Nghe lại']);
    if (q.read) tools.push(['skip', 'Bố mẹ giúp']);
    tools.push(['parent', '🔒 Bố mẹ']);
    qzBtns({ opts: q.opts, tools: tools });
    if (!q.read) say(q.say);
  }
  function qzItems() { return [].slice.call($('#qz-opts').children).concat([].slice.call($('#qz-tools').children)); }
  function qzPress(b) {
    if (qzBusy || !b) return;
    var r = qzRun, act = b.getAttribute('data-act'), v = b.getAttribute('data-v');
    if (act === 'say') { say(r.qs[r.i].say); return; }
    if (act === 'parent') { qzPin = true; openPin(); return; }
    if (act === 'skip') { r.i++; qzPaint(); return; }  // câu đọc to: bố mẹ giúp thì sang câu sau
    if (r.i < 0) { r.i = 0; qzPaint(); return; }
    if (r.i >= r.qs.length) {
      if (v === 'Chơi thêm') { r.qs = qzMake(r.age, qc().count); r.i = 0; r.wrong = 0; qzPaint(); return; }
      return qzEnd();
    }
    var q = r.qs[r.i];
    if (v === String(q.ans)) {
      r.right++; b.classList.add('ok'); qzBusy = true;
      $('#qz-msg').textContent = pick(['Đúng rồi! 🎉', 'Giỏi quá! 👏', 'Chính xác! ⭐']); $('#qz-msg').className = 'ok';
      say(q.read ? '' : 'Đúng rồi!');
      setTimeout(function () { qzBusy = false; r.i++; qzPaint(); }, 1100);
    } else if (!b.classList.contains('no')) {
      r.wrong++; b.classList.add('no');
      $('#qz-msg').textContent = 'Chưa đúng, con thử lại nhé!'; $('#qz-msg').className = 'no';
      say('Chưa đúng, con thử lại nhé');
    }
  }
  function qzEnd() {
    var r = qzRun;
    try {   // nhật ký nhỏ trên TV để sau này gửi cho bố mẹ
      var log = JSON.parse(localStorage.getItem('ct-qz-log') || '[]');
      log.push({ at: new Date().toISOString(), n: r.qs.length, wrong: r.wrong });
      localStorage.setItem('ct-qz-log', JSON.stringify(log.slice(-60)));
    } catch (e) { /* bỏ qua */ }
    qzSec.n = 0; qzSave();
    qzRun = null;
    if (canSay) try { speechSynthesis.cancel(); } catch (e) { /* bỏ qua */ }
    $('#qz').classList.add('hidden');
    zone = 'player';
    if (r.after) r.after();
  }
  function qzKey(k) {
    var it = qzItems(), nOpt = $('#qz-opts').children.length;
    if (k === K.LEFT && qzIdx > 0) qzIdx--;
    else if (k === K.RIGHT && qzIdx < it.length - 1) qzIdx++;
    else if (k === K.DOWN && qzIdx < nOpt && it.length > nOpt) qzIdx = nOpt;
    else if (k === K.UP && qzIdx >= nOpt) qzIdx = 0;
    else if (k === K.ENTER) { qzPress(it[qzIdx]); return; }
    else if (k >= 49 && k <= 57 && qzRun && qzRun.i >= 0 && qzRun.i < qzRun.qs.length) {   // phím số trên remote: chọn đáp án là số đó
      for (var i = 0; i < nOpt; i++) if (it[i].getAttribute('data-v') === String(k - 48)) { qzIdx = i; focus(); qzPress(it[i]); return; }
    }
    focus();
  }
  var qzPin = false;

  // ---------- Màn xem xong ----------
  var endIdx = 0, endTimer = null;
  var IDEAS = ['Giờ mình đi uống nước rồi chơi xếp hình nhé!', 'Con kể cho bố mẹ nghe con vừa xem gì nhé!',
    'Mình cùng hát lại bài vừa rồi nhé!', 'Đứng dậy vươn vai, nhảy 5 cái nào!', 'Con vẽ lại điều con thích nhất nhé!',
    'Đi tìm một đồ vật màu đỏ trong nhà nào!', 'Mình đọc một cuốn sách cùng nhau nhé!', 'Con giúp bố mẹ cất đồ chơi nhé!',
    'Ra ngoài chơi một chút cho mắt nghỉ nhé!', 'Con thử đếm từ 1 đến 10 thật to nào!'];

  function showEnd() {
    endPlayback();
    var g = queue.group, v = queue.videos[queue.idx], left = leftSec();
    var btns = [['home', '🏠 Về trang chủ'], ['again', '🔁 Xem lại']];
    if (hasNext() && left > 0) {
      btns.push(['next', left < 300 ? '▶ Xem video cuối cùng' : g && g.numbered ? '▶ Tiếp: ' + lessonLabel(queue.videos[queue.idx + 1], queue.idx + 1) : '▶ Video tiếp']);
    }
    $('#end-title').textContent = (g && g.numbered ? lessonLabel(v, queue.idx) + ' · ' : '') + v.title;
    $('#end-btns').innerHTML = btns.map(function (b) { return '<button class="ebtn" data-act="' + b[0] + '">' + esc(b[1]) + '</button>'; }).join('');
    $('#end-idea').textContent = IDEAS[Math.floor(Math.random() * IDEAS.length)];
    $('#end-left').textContent = quota.limit ? '⏱ Hôm nay còn ' + mins(left) + ' phút' : '';
    $('#end').classList.remove('hidden');
    zone = 'end';
    endIdx = 0;                                               // chọn sẵn "Về trang chủ": bé bấm OK theo thói quen thì dừng lại
    focus();
    clearTimeout(endTimer);
    endTimer = setTimeout(function () { if (zone === 'end') stop(); }, 180000);   // để yên 3 phút: về trang chủ
  }

  function endAct(act) {
    clearTimeout(endTimer);
    if (act === 'again') play(queue.videos, queue.idx);
    else if (act === 'next') { play(queue.videos, queue.idx + 1); gridIdx = queue.idx; }
    else stop();
  }

  function endKey(k) {
    var n = $('#end-btns').children.length;
    if (k === K.LEFT && endIdx > 0) endIdx--;
    else if (k === K.RIGHT && endIdx < n - 1) endIdx++;
    else if (k === K.ENTER) { endAct($('#end-btns').children[endIdx].getAttribute('data-act')); return; }
    else if (BACK.indexOf(k) >= 0) { endAct('home'); return; }
    focus();
  }

  // ---------- Màn hết giờ ----------
  function showLimit() {
    endPlayback();
    clearTimeout(endTimer);
    $('#end').classList.add('hidden');
    document.body.classList.remove('playing');
    $('#limit').classList.remove('hidden');
    zone = 'limit';
    focus();
  }
  function checkLimit() {
    if (timeUp() && (zone === 'side' || zone === 'grid')) showLimit();
    else if (zone === 'limit' && !timeUp()) { $('#limit').classList.add('hidden'); zone = 'side'; sideIdx = chIdx; focus(); }
  }
  function limitKey(k) {
    if (k === K.ENTER) openPin();
    else if (k === 10009) { try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* không phải TV */ } }
  }

  function onState(e) {
    if (e.data === 0) { if (wl) wl.done = true; if (queue) queue.videos[queue.idx].done = true; ended(); }
    else if (e.data === 1) { $('#pause-icon').classList.add('hidden'); showOsd(); }
    else if (e.data === 2) { $('#pause-icon').classList.remove('hidden'); showOsd(true); }
  }

  function toggle() {
    if (!playerReady) return;
    var s = player.getPlayerState();  // 1 = đang phát, 3 = đang tải (vd. ngay sau khi tua)
    if (s === 1 || s === 3) player.pauseVideo(); else player.playVideo();
  }

  function seek(sec) {
    if (!playerReady) return;
    var t = Math.max(0, Math.min(player.getDuration() - 1, player.getCurrentTime() + sec));
    player.seekTo(t, true);
    showOsd();
  }

  function fmt(s) {
    s = Math.floor(s || 0);
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function tick() {
    if (!playerReady || !player.getDuration) return;
    var d = player.getDuration();
    if (wl && player.getPlayerState() === 1) { wl.played += 1; if (d > 0) wl.duration = d; watchFlush(wl, false); countSec(d); }
    if (zone === 'player' && !$('#osd').classList.contains('off')) paintOsd();
  }

  // Đếm giờ xem; báo trước lúc còn 5 phút và 1 phút (qua OSD, lớp duy nhất được hiện trên video).
  function countSec(d) {
    sinceHello++;
    usage.n++;
    if (usage.n % 10 === 0) saveDay('ct-usage', usage);
    qzCount();
    if (qzDue() && zone === 'player' && !grace && leftSec() > 120) startQuiz(function () { if (playerReady) player.playVideo(); showOsd(); });
    if (!quota.limit) return;
    var left = leftSec();
    if (left > 360) warned = 0;
    else if (left <= 60 && left > 0 && warned < 2) { warned = 2; showOsd(); }
    else if (left <= 300 && left > 0 && warned < 1) { warned = 1; showOsd(); }
    if (left <= 0 && !grace) {
      if (d > 0 && d - player.getCurrentTime() <= 600) { grace = true; showOsd(); }   // còn ≤ 10 phút: cho xem nốt video này
      else showLimit();
    }
  }
  function paintOsd() {
    if (!playerReady || !player.getDuration) return;
    var d = player.getDuration(), t = player.getCurrentTime();
    if (d > 0) {
      $('#osd-fill').style.width = (t / d * 100) + '%';
      $('#osd-time').textContent = fmt(t) + ' / ' + fmt(d);
    }
  }

  function showOsd(stay) {
    var left = leftSec(), w = $('#osd-warn');
    if (quota.limit && left <= 300) {
      w.textContent = left > 0 ? '⏰ Còn ' + mins(left) + ' phút nữa thôi nhé' : '⏰ Xem nốt video này rồi nghỉ nhé';
      w.classList.remove('hidden');
    } else w.classList.add('hidden');
    $('#osd').classList.remove('off');
    paintOsd();
    clearTimeout(osdTimer);
    if (!stay) osdTimer = setTimeout(function () { $('#osd').classList.add('off'); }, 4000);
  }

  function playerKey(k) {
    if (k === K.ENTER || k === K.PLAYPAUSE) toggle();
    else if (k === K.PLAY) player.playVideo();
    else if (k === K.PAUSE) player.pauseVideo();
    else if (k === K.LEFT || k === K.RW) seek(-10);
    else if (k === K.RIGHT || k === K.FF) seek(10);
    else if (k === K.STOP || BACK.indexOf(k) >= 0) stop();
    else showOsd();
  }

  // ---------- PIN bố mẹ ----------
  var PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];

  function openPin() {
    pin = '';
    pinIdx = 0;
    $('#pin-pad').innerHTML = PAD.map(function (d, i) { return '<button class="key" data-i="' + i + '">' + d + '</button>'; }).join('');
    $('#pin-msg').textContent = '';
    drawPin();
    $('#pin').classList.remove('hidden');
    zone = 'pin';
    focus();
  }

  function drawPin() { $('#pin-dots').innerHTML = new Array(pin.length + 1).join('<i></i>'); }

  function closeModal() {
    $('#pin').classList.add('hidden');
    $('#parent').classList.add('hidden');
    var fromLimit = !$('#limit').classList.contains('hidden');
    zone = 'side';
    sideIdx = fromLimit ? chIdx : lib.length;
    if (timeUp()) { showLimit(); return; }
    $('#limit').classList.add('hidden');
    focus();
  }

  function pressPad(d) {
    if (d === '⌫') pin = pin.slice(0, -1);
    else if (d === 'OK') return submitPin();
    else if (pin.length < 6) pin += d;
    $('#pin-msg').textContent = '';
    drawPin();
  }

  function submitPin() {
    if (Date.now() < pinLockUntil) { $('#pin-msg').textContent = 'Sai nhiều lần, đợi ' + Math.ceil((pinLockUntil - Date.now()) / 1000) + ' giây'; return; }
    if (pin.length < 4) { $('#pin-msg').textContent = 'Mã PIN có 4–6 số'; return; }
    rpc('ct_tv_pin', { p_device: device.id, p_secret: device.secret, p_pin: pin }).then(function (ok) {
      if (ok && qzPin) { pinFails = 0; qzPin = false; $('#pin').classList.add('hidden'); qzEnd(); return; }   // bố mẹ cho bỏ qua giải lao
      if (ok) { pinFails = 0; $('#pin').classList.add('hidden'); openParent(); return; }
      if (++pinFails >= 5) { pinFails = 0; pinLockUntil = Date.now() + 60000; }
      pin = '';
      drawPin();
      $('#pin-msg').textContent = 'Sai mã PIN';
    }).catch(function () { $('#pin-msg').textContent = 'Không kết nối được, thử lại'; });
  }

  function pinKey(k) {
    if (k >= 48 && k <= 57) { pressPad(String(k - 48)); return; }
    if (k === 8 && pin) { pressPad('⌫'); return; }
    if (k === K.LEFT && pinIdx % 3 > 0) pinIdx--;
    else if (k === K.RIGHT && pinIdx % 3 < 2) pinIdx++;
    else if (k === K.UP && pinIdx >= 3) pinIdx -= 3;
    else if (k === K.DOWN && pinIdx < 9) pinIdx += 3;
    else if (k === K.ENTER) pressPad(PAD[pinIdx]);
    else if (BACK.indexOf(k) >= 0) {
      if (qzPin) { qzPin = false; $('#pin').classList.add('hidden'); zone = 'qz'; focus(); return; }
      closeModal(); return;
    }
    focus();
  }

  function openParent() {
    $('#admin-url').textContent = APP_URL.replace(/^https?:\/\//, '');
    $('#parent-msg').textContent = '';
    var btns = quota.limit ? [['more15', 'Cho xem thêm 15 phút'], ['more30', 'Cho xem thêm 30 phút']] : [];
    btns.push(['refresh', 'Tải lại danh sách'], ['exit', 'Thoát ứng dụng'], ['close', 'Đóng']);
    $('#parent-btns').innerHTML = btns.map(function (b) { return '<button class="pbtn" data-act="' + b[0] + '">' + b[1] + '</button>'; }).join('');
    $('#parent-time').textContent = quota.limit ? 'Hôm nay bé đã xem ' + Math.floor(usedSec() / 60) + ' / ' + (quota.limit + extra.n) + ' phút' : '';
    $('#parent').classList.remove('hidden');
    zone = 'parent';
    parentIdx = 0;
    focus();
  }

  function parentAct(act) {
    if (act === 'close') return closeModal();
    if (act === 'more15' || act === 'more30') {
      extra.n += act === 'more15' ? 15 : 30;
      saveDay('ct-extra', extra);
      return closeModal();
    }
    if (act === 'refresh') {
      $('#parent-msg').textContent = 'Đang tải lại…';
      hello().then(function () { $('#parent-msg').textContent = 'Đã cập nhật.'; });
    }
    if (act === 'exit') {
      try { tizen.application.getCurrentApplication().exit(); return; } catch (e) { /* không phải TV */ }
      $('#parent-msg').textContent = 'Hãy bấm nút Home trên remote để thoát.';
    }
  }

  function parentKey(k) {
    var n = $('#parent-btns').children.length;
    if ((k === K.UP || k === K.LEFT) && parentIdx > 0) parentIdx--;
    else if ((k === K.DOWN || k === K.RIGHT) && parentIdx < n - 1) parentIdx++;
    else if (k === K.ENTER) { parentAct($('#parent-btns').children[parentIdx].getAttribute('data-act')); return; }
    else if (BACK.indexOf(k) >= 0) { closeModal(); return; }
    focus();
  }

  // ---------- Bàn phím / remote ----------
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (!k && /^\d$/.test(e.key)) k = 48 + +e.key;
    if (k >= 112 && k <= 123) return;  // F1–F12: để trình duyệt xử lý khi thử trên máy tính
    document.body.classList.remove('mouse');
    e.preventDefault();
    if (zone === 'qz') { qzKey(k); return; }
    if (zone === 'upnext') { if (k === K.ENTER || k === K.PLAY || k === K.PLAYPAUSE) unGo(true); else if (BACK.indexOf(k) >= 0 || k === K.STOP) unGo(false); return; }
    if (zone === 'player') playerKey(k);
    else if (zone === 'pin') pinKey(k);
    else if (zone === 'parent') parentKey(k);
    else if (zone === 'side' || zone === 'grid') homeKey(k);
    else if (zone === 'ov') ovKey(k);
    else if (zone === 'rm') rmKey(k);
    else if (zone === 'ph') phKey(k);
    else if (zone === 'phv') phvKey(k);
    else if (zone === 'phbtn') {
      if (k === K.ENTER) showPhotos('side');
      else if (k === K.UP) { zone = 'rmbtn'; focus(); }
      else if (k === K.DOWN || k === K.RIGHT) { zone = 'side'; sideIdx = 0; focus(); }
      else if (BACK.indexOf(k) >= 0) showOverview();
    }
    else if (zone === 'rmbtn') {
      if (k === K.ENTER) showRoad('side');
      else if (k === K.DOWN || k === K.RIGHT) { zone = 'phbtn'; focus(); }
      else if (BACK.indexOf(k) >= 0) showOverview();
    }
    else if (zone === 'end') endKey(k);
    else if (zone === 'limit') limitKey(k);
    else if (zone === 'pair' && k === 10009) { try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* không phải TV */ } }
  });

  // ---------- Chuột (để thử trên máy tính) ----------
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (s) {
      var el = this;
      while (el && el.nodeType === 1) { if (el.matches ? el.matches(s) : el.webkitMatchesSelector(s)) return el; el = el.parentNode; }
      return null;
    };
  }
  document.addEventListener('mousemove', function () { document.body.classList.add('mouse'); });
  document.addEventListener('click', function (e) {
    var t = e.target;
    var ch = t.closest('.ch'), card = t.closest('.card'), key = t.closest('.key'), pb = t.closest('.pbtn');
    if (zone === 'player') { if (t.closest('#osd-back')) stop(); else toggle(); return; }
    if (zone === 'ov') { var ob = t.closest('.obtn'); if (ob) ovAct(ob); return; }
    if (zone === 'rm') { var rb = t.closest('.obtn'); if (rb) rmAct(rb); return; }
    if (t.closest('#rm-btn')) { showRoad('side'); return; }
    if (t.closest('#ph-btn')) { showPhotos('side'); return; }
    if (zone === 'phv') { closeViewer(); return; }
    if (zone === 'ph') { var pc = t.closest('.ph-cell'), pk = t.closest('.ph-chip'); if (pc) openViewer(+pc.getAttribute('data-k'), false); else if (pk) { if (pk.getAttribute('data-act') === 'show') openViewer(0, true); else { ph.who = pk.getAttribute('data-who'); paintPhotos(); } } return; }
    if (t.closest('#who')) { showOverview(); return; }
    if (zone === 'pin') { if (key) { pinIdx = +key.getAttribute('data-i'); focus(); pressPad(PAD[pinIdx]); } else if (t === $('#pin')) closeModal(); return; }
    if (zone === 'parent') { if (pb) parentAct(pb.getAttribute('data-act')); else if (t === $('#parent')) closeModal(); return; }
    if (zone === 'end') { var eb = t.closest('.ebtn'); if (eb) endAct(eb.getAttribute('data-act')); return; }
    if (zone === 'limit') { if (t.closest('.ebtn')) openPin(); return; }
    if (ch) {
      var i = +ch.getAttribute('data-i');
      if (i === lib.length) { openPin(); return; }
      zone = 'side';
      sideIdx = Array.prototype.indexOf.call(sideItems(), ch);
      showChannel(i); focus();
    } else if (card) {
      zone = 'grid'; gridIdx = +card.getAttribute('data-i'); focus();
      if (isLocked(lib[chIdx], gridIdx)) { toast('Hãy xem bài trước nhé! 🔒'); return; }
      play(lib[chIdx].videos, gridIdx);
    }
  });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var cached = null;
  try { cached = JSON.parse(localStorage.getItem('ct-lib')); } catch (e) { cached = null; }
  if (cached && cached.screen) setQuota(cached.screen, true);
  if (cached && cached.rows && cached.rows.length) showHome(cached.rows, cached.family);
  hello().then(checkVersion).then(schedule, schedule);
})();
