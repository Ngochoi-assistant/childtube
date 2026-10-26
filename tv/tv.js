// ChildTube — màn hình của bé trên TV. Điều khiển bằng remote (mũi tên, OK, Back) hoặc chuột.
// Viết kiểu JS đơn giản (không async/await, không ?.) để chạy được trên TV Samsung đời 2017+.
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412 };
  var BACK = [10009, 27, 8, 461];
  var COLS = 4;
  var SEC = { collection: 'Giáo trình', topic: 'Playlist', source: 'Kênh' };
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
              end: s && s.end === 'next' ? 'next' : 'stop', day: stale ? today() : day };
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
    else if (zone === 'limit') el = $('#limit-btns').children[0];
    else if (zone === 'ov') el = $('#ov-btns').children[ovIdx];
    else if (zone === 'rm') el = $('#rm-btns').children[rmIdx];
    else if (zone === 'rmbtn') el = $('#rm-btn');
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
      if (k === K.UP && sideIdx === 0) { zone = 'rmbtn'; focus(); return; }
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
    if (curList().length) btns.push('<button class="obtn" data-act="road">🧭 Xem lộ trình</button>');
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
    var chips = pl.slice(0, 10).map(function (g) { return '<span class="ov-chip">' + esc((g.emoji ? g.emoji + ' ' : '') + g.title) + ' · ' + g.videos.length + '</span>'; }).join('');
    return '<div class="ov-kid ov-fam"><div class="ov-kh"><span class="ov-av">👨‍👩‍👧</span><div><h2>Cả nhà đang học</h2><div class="ov-sub">Thêm hồ sơ bé (tên, ngày sinh) trong app ChildTube → Gia đình để thấy lộ trình riêng của từng bé ở đây.</div></div></div>' +
      (rows || '<div class="ov-none">Chưa có giáo trình nào.</div>') + (chips ? '<div class="ov-plh">Playlist & kênh</div><div class="ov-chips">' + chips + '</div>' : '') + '</div>';
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
  var rmIdx = 0, rmFrom = 'side';
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
  var comp = null, rmStage = 0;
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
  function screenRule(age) {
    if (age <= 2) return ['Xem cùng bố mẹ, không để bé xem một mình', 'Tối đa 15–20 phút, chia 2–3 lần', 'Vừa xem vừa nói chuyện, chỉ vào hình'];
    if (age <= 5) return ['Tổng cộng không quá 1 giờ mỗi ngày', 'Xem cùng và hỏi lại bé sau mỗi bài', 'Không xem trong bữa ăn và 1 giờ trước khi ngủ'];
    return ['Giờ xem cố định, xong bài tập mới xem', 'Cân bằng: mỗi 30 phút xem có 30 phút vận động', 'Không xem 1 giờ trước khi ngủ'];
  }
  function showRoad(from) {
    rmFrom = from || 'side';
    $('#home').classList.add('hidden');
    $('#ov').classList.add('hidden');
    $('#rm').classList.remove('hidden');
    zone = 'rm';
    $('#rm-body').innerHTML = '<div class="rm-empty">Đang tải lộ trình…</div>';
    $('#rm-btns').innerHTML = '';
    loadComp().then(function () {
      rmStage = -1; rmIdx = 0;
      paintRoad();
    }, function () { $('#rm-body').innerHTML = '<div class="rm-empty">Chưa tải được lộ trình, hãy thử lại sau.</div>'; });
    loadOverview().then(function () { if (zone === 'rm' && comp) paintRoad(); });
  }
  function hideRoad() {
    $('#rm').classList.add('hidden');
    if (rmFrom === 'ov') { showOverview(); return; }
    $('#home').classList.remove('hidden');
    zone = 'side';
    sideIdx = chIdx < 0 ? 0 : chIdx;
    focus();
  }
  function rmLi(cls, ic, text) { return '<div class="rm-li ' + cls + '"><i>' + ic + '</i><span>' + text + '</span></div>'; }
  function paintRoad() {
    if (!comp) return;
    var cs = curList(), g = cs.length ? lib[cs[0]] : null, kid = ov && ov.kids && ov.kids[0];
    var age = kidAge(kid, g), st = roadStages(age), ls = g ? curLessons(g) : [], done = 0, cur = null, i;
    for (i = 0; i < ls.length; i++) { if (ls[i].done) done++; else if (!cur) cur = ls[i]; }
    // Bé đang ở giai đoạn nào: theo mốc đã đạt (nếu bố mẹ đã nhập) hoặc tiến độ học
    // Chỉ dựa vào mốc phát triển bố mẹ đã ghi nhận (không dựa vào số video đã xem); chưa có mốc thì bắt đầu từ giai đoạn 1.
    var hasMs = kid && kid.road && kid.road.progress && kid.road.progress.total, prog = hasMs ? kid.road.progress.done / kid.road.progress.total : 0;
    var now = prog >= 0.67 ? 2 : prog >= 0.34 ? 1 : 0;
    if (rmStage < 0) { rmStage = now; rmIdx = now; }
    var S = st[rmStage];
    $('#rm-kids').innerHTML = '<em>' + (kid ? esc((kid.emoji || '🧒') + ' ' + kid.name) + ' · ' : '') + (age <= 2 ? '1–2' : age >= 7 ? '7–8' : age) + ' tuổi</em>';
    // Đường 3 giai đoạn
    var road = '<div class="rg-road">' + st.map(function (x, k) {
      return '<div class="rg-st' + (k < now ? ' past' : k === now ? ' now' : '') + (k === rmStage ? ' sel' : '') + '"><div class="rg-dot">' + (k < now ? '✓' : k === now ? '★' : k + 1) + '</div>' +
        '<b>Giai đoạn ' + (k + 1) + ' · ' + x.name + '</b><span>' + (k === now ? (hasMs ? 'Bé đang ở đây' : 'Bắt đầu từ đây') : x.sub) + '</span></div>'; }).join('') + '</div>';
    // Mục tiêu (bé cần đạt) + hành động (bố mẹ làm)
    var goals = S.items.map(function (x) { var d = domOf(x.d); return rmLi('goal', d.emoji, esc(x.t) + '<em> · ' + esc(d.short || d.name) + '</em>'); }).join('');
    var kg = rmStage === now && kid && kid.road ? (kid.road.goals || []).slice(0, 2).map(function (x) { return rmLi('goal', '🎯', esc(x.title)); }).join('') : '';
    var acts = S.items.map(function (x, k) { return '<div class="rg-act"><b>' + (k + 1) + '</b><span>' + esc(x.tip) + '</span></div>'; }).join('');
    // Màn hình: quy tắc theo tuổi + bài nên học tiếp
    var used = Math.floor(usedSec() / 60), rule = screenRule(age);
    var scr = rule.map(function (r) { return rmLi('', '•', esc(r)); }).join('') +
      '<div class="rm-more">Hôm nay đã xem ' + used + ' phút' + (quota.limit ? ' / ' + (quota.limit + extra.n) + ' phút' : '') + '.</div>' +
      (cur ? '<div class="rm-sub">Bài học tiếp theo</div>' + rmLi('', '▶', 'Bài ' + cur.n + ' · ' + esc(cur.title)) : '');
    $('#rm-body').innerHTML =
      '<div class="rg-head"><h2>Giai đoạn ' + (rmStage + 1) + ' · ' + S.name + '</h2><span>' + S.sub + '</span></div>' + road +
      '<div class="rm-grid">' +
        '<section class="rm-card"><div class="rm-h"><b>🎯 Bé cần đạt</b><span>' + S.items.length + ' mục tiêu</span></div>' + kg + goals + '</section>' +
        '<section class="rm-card rg-wide"><div class="rm-h"><b>👨‍👩‍👧 Bố mẹ làm cùng bé mỗi ngày</b></div>' + acts +
          '<div class="rm-more">Khen sự cố gắng của bé (“con đã thử nhiều cách”) thay vì khen thông minh.</div></section>' +
        '<section class="rm-card"><div class="rm-h"><b>📺 Dùng màn hình đúng cách</b></div>' + scr + '</section>' +
      '</div>';
    var btns = st.map(function (x, k) { return '<button class="obtn rg-tab' + (k === rmStage ? ' on' : '') + '" data-act="rm-st" data-k="' + k + '">' + (k + 1) + '. ' + x.name + '</button>'; });
    if (cur) btns.push('<button class="obtn main" data-act="rm-next">▶ Học tiếp: Bài ' + cur.n + '</button>');
    btns.push('<button class="obtn" data-act="rm-back">' + (rmFrom === 'ov' ? '← Quay lại' : '← Thư viện') + '</button>');
    $('#rm-btns').innerHTML = btns.join('');
    if (rmIdx >= btns.length) rmIdx = rmStage;
    focus();
  }
  function rmAct(b) {
    var act = b.getAttribute('data-act');
    if (act === 'rm-back') return hideRoad();
    if (act === 'rm-st') { rmStage = +b.getAttribute('data-k'); rmIdx = rmStage; paintRoad(); return; }
    var gi = curList()[0], g = lib[gi];
    if (!g) return hideRoad();
    var ls = curLessons(g), cur = null;
    for (var i = 0; i < ls.length; i++) if (!ls[i].done) { cur = ls[i]; break; }
    $('#rm').classList.add('hidden');
    $('#home').classList.remove('hidden');
    zone = 'side';
    chIdx = -1; showChannel(gi); sideIdx = gi;
    if (!cur) { focus(); return; }
    if (isLocked(g, cur.idx)) { focus(); toast('Hãy xem bài trước nhé! 🔒'); return; }
    play(g.videos, cur.idx);
  }
  function rmKey(k) {
    var n = $('#rm-btns').children.length;
    if ((k === K.LEFT || k === K.UP) && rmIdx > 0) rmIdx--;
    else if ((k === K.RIGHT || k === K.DOWN) && rmIdx < n - 1) rmIdx++;
    else if (k === K.ENTER) { rmAct($('#rm-btns').children[rmIdx]); return; }
    else if (BACK.indexOf(k) >= 0) { hideRoad(); return; }
    focus();
    // Di chuyển qua các nút giai đoạn: xem luôn nội dung giai đoạn đó
    var b = $('#rm-btns').children[rmIdx];
    if (b && b.getAttribute('data-act') === 'rm-st' && +b.getAttribute('data-k') !== rmStage) { rmStage = +b.getAttribute('data-k'); paintRoad(); }
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
    if (quota.end === 'next') { next(); return; }
    showEnd();
  }

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
    else if (BACK.indexOf(k) >= 0) { closeModal(); return; }
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
    if (zone === 'player') playerKey(k);
    else if (zone === 'pin') pinKey(k);
    else if (zone === 'parent') parentKey(k);
    else if (zone === 'side' || zone === 'grid') homeKey(k);
    else if (zone === 'ov') ovKey(k);
    else if (zone === 'rm') rmKey(k);
    else if (zone === 'rmbtn') {
      if (k === K.ENTER) showRoad('side');
      else if (k === K.DOWN || k === K.RIGHT) { zone = 'side'; sideIdx = 0; focus(); }
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
