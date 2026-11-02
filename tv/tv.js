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
    if (zone === 'side' || zone === 'grid') $('#home').classList.remove('hidden');
    if (tab === 'ov' && (zone === 'ov' || zone === 'tab')) paintOverview();   // danh sách giáo trình đổi: nút chọn giáo trình đổi theo
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
      if (v <= MY_V || !(zone === 'ov' || zone === 'tab' || zone === 'fd' || zone === 'side' || zone === 'grid' || zone === 'pair' || zone === 'limit')) return;
      try { tried = sessionStorage.getItem('ct-upd'); sessionStorage.setItem('ct-upd', String(v)); } catch (e) { /* bỏ qua */ }
      if (tried !== String(v)) location.replace(location.pathname + '?v=' + v);   // mỗi bản chỉ thử một lần, tránh tải lại liên tục
    }).catch(function () { /* mạng chậm: để lần sau */ });
  }

  function schedule() {
    clearTimeout(pollTimer);
    // Chưa ghép: hỏi mỗi 4 giây. Đã ghép: mỗi 2 phút (chỉ khi bé đang ở trang chủ).
    var wait = zone === 'pair' || zone === 'loading' ? 4000 : 120000;
    pollTimer = setTimeout(function () {
      if (zone === 'pair' || zone === 'loading' || zone === 'ov' || zone === 'tab' || zone === 'fd' || zone === 'side' || zone === 'grid' || zone === 'limit') hello().then(function () { if (tab === 'ov' && (zone === 'ov' || zone === 'tab')) return loadOverview(); }).then(checkVersion).then(schedule, schedule); else schedule();
    }, wait);
  }
  // TV bật lại từ chế độ chờ / quay lại app: cập nhật ngay.
  // Tắt quá 30 phút rồi bật lại (thường là lần xem mới): quay về màn tổng quan.
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (zone === 'player') return;
    if (hiddenAt && Date.now() - hiddenAt > 30 * 60000 && (zone === 'side' || zone === 'grid' || zone === 'fd' || zone === 'tab')) showOverview();
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
    else if (zone === 'ov') el = ovItems()[ovIdx];
    else if (zone === 'tab') el = $('#tabbar').children[TABS.indexOf(tab)];
    else if (zone === 'fd') el = fdFocus();
    else if (zone === 'rm') el = mapRow === 'btn' ? $('#rm-btns').children[rmIdx2] : null;
    else if (zone === 'rmbtn') el = $('#rm-btn');
    else if (zone === 'albtn') el = $('#al-btn');
    else if (zone === 'al') el = alFocusEl();
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
      else if (k === K.DOWN || BACK.indexOf(k) >= 0) { zone = 'tab'; focus(); return; }
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
      else if (k === K.DOWN) { zone = 'tab'; focus(); return; }
      else if (k === K.ENTER || k === K.PLAY || k === K.PLAYPAUSE) {
        if (isLocked(lib[chIdx], gridIdx)) { toast('Hãy xem bài trước nhé! 🔒'); return; }
        play(lib[chIdx].videos, gridIdx); return;
      }
      else if (BACK.indexOf(k) >= 0) { zone = 'side'; sideIdx = chIdx; }
    }
    focus();
  }

  // ---------- Thanh dưới: Trang chính · Xem video · Bảng tin ----------
  // Mỗi tab là một màn hình; các màn phụ (Hành trình, Album) mở toàn màn hình và ẩn thanh dưới.
  // Remote: Back từ nội dung → xuống thanh dưới; ◀ ▶ đổi tab ngay; ▲ hoặc OK → vào nội dung.
  var tab = 'ov', TABS = ['ov', 'home', 'fd'];
  function screen(id) {
    ['ov', 'home', 'fd', 'rm', 'al', 'end'].forEach(function (s) { $('#' + s).classList.toggle('hidden', s !== id); });
    $('#tabbar').classList.toggle('hidden', TABS.indexOf(id) < 0);
    if (id !== 'fd') fdStop();
    if (TABS.indexOf(id) >= 0) tab = id;
    var b = $('#tabbar').children;
    for (var i = 0; i < b.length; i++) b[i].classList.toggle('on', b[i].getAttribute('data-tab') === tab);
  }
  // stay: giữ con trỏ ở thanh dưới (đang lướt qua các tab)
  function goTab(t, stay) {
    clearTimeout(endTimer);
    if (t === 'ov') showOverview();
    else if (t === 'fd') showFeed();
    else {
      screen('home'); zone = 'side'; sideIdx = chIdx < 0 ? 0 : chIdx;
      if (!stay && timeUp()) { showLimit(); return; }
    }
    if (stay) zone = 'tab';
    focus();
  }
  function tabKey(k) {
    var i = TABS.indexOf(tab);
    if (k === K.LEFT && i > 0) goTab(TABS[i - 1], true);
    else if (k === K.RIGHT && i < TABS.length - 1) goTab(TABS[i + 1], true);
    else if (k === K.UP || k === K.ENTER) goTab(tab, false);
    else if (BACK.indexOf(k) >= 0) {
      if (tab !== 'ov') goTab('ov', true);
      else try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* không phải TV */ }
    }
  }
  // Chọn ô kế bên theo vị trí trên màn hình (các nút xếp nhiều hàng, không theo một dãy)
  function nearest(list, i, k) {
    if (!list[i]) return -1;
    var a = list[i].getBoundingClientRect(), best = -1, bd = 1e9, j, b, dx, dy, ok, d;
    for (j = 0; j < list.length; j++) {
      if (j === i) continue;
      b = list[j].getBoundingClientRect();
      dx = b.left + b.width / 2 - (a.left + a.width / 2); dy = b.top + b.height / 2 - (a.top + a.height / 2);
      ok = k === K.LEFT ? dx < -2 && Math.abs(dy) < a.height : k === K.RIGHT ? dx > 2 && Math.abs(dy) < a.height : k === K.UP ? dy < -a.height / 2 : dy > a.height / 2;
      if (!ok) continue;
      d = k === K.LEFT || k === K.RIGHT ? Math.abs(dx) : Math.abs(dy) * 2 + Math.abs(dx);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  // ---------- Trang chính ----------
  // Mở TV: mỗi bé một thẻ gọn — lộ trình tuần này đúng hay lệch, gợi ý điều chỉnh, và các giáo trình để chọn luôn.
  try { ov = JSON.parse(localStorage.getItem('ct-ov')); } catch (e) { ov = null; }
  function showOverview() {
    clearTimeout(endTimer);
    screen('ov');
    zone = 'ov';
    ovIdx = 0;
    paintOverview();
    loadOverview();
  }
  function loadOverview() {
    return rpc('ct_tv_overview', { p_device: device.id, p_secret: device.secret }).then(function (r) {
      ov = r;
      try { localStorage.setItem('ct-ov', JSON.stringify(r)); } catch (e) { /* bộ nhớ đầy */ }
      if (zone === 'ov' || (zone === 'tab' && tab === 'ov')) paintOverview();
    }).catch(function () { /* mạng chậm: giữ bản đã lưu */ });
  }
  var MOOD = { 'vui': '😄', 'bình thường': '🙂', 'mệt': '🥱', 'buồn': '😢', 'cáu': '😠' };
  function hi() { var h = new Date().getHours(); return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; }

  // Bảng thông báo lộ trình: tuần này xem đúng hướng hay lệch, vì sao, và gợi ý điều chỉnh (tính ở máy chủ: ct_tv_overview → watch)
  var WLV = { ok: ['🟢', 'Đúng hướng'], mild: ['🟡', 'Hơi lệch hướng'], high: ['🔴', 'Đang lệch hướng'], little: ['⚪', 'Mới xem ít'] };
  // % thời gian xem theo loại nội dung: một thanh nhiều màu + chú thích
  var SHARE = [['cur', 'Giáo trình'], ['topic', 'Playlist gia đình'], ['fav', 'Yêu thích'], ['free', 'Kênh, video khác']];
  function shareBar(w) {
    var sh = w.share || { cur: w.cur, free: 100 - w.cur };
    var seg = SHARE.filter(function (s) { return sh[s[0]] > 0; });
    return '<div class="ow-share">' + seg.map(function (s) { return '<i class="' + s[0] + '" style="width:' + sh[s[0]] + '%"></i>'; }).join('') + '</div>' +
      '<div class="ow-leg">' + seg.map(function (s) { return '<span><i class="' + s[0] + '"></i>' + s[1] + ' <b>' + sh[s[0]] + '%</b></span>'; }).join('') + '</div>';
  }
  // Biểu đồ 7 ngày: mỗi cột là số phút xem trong ngày (xanh = bài giáo trình, cam = ngoài giáo trình), vạch trắng = giới hạn mỗi ngày
  var WD_S = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  function dayChart(w) {
    var ser = w.series || [], max = w.limit || 0, i;
    for (i = 0; i < ser.length; i++) max = Math.max(max, ser[i].cur + ser[i].other);
    if (!max) max = 1;
    var cols = ser.map(function (d, j) {
      var x = String(d.day).split('-'), wd = x.length === 3 ? new Date(Date.UTC(+x[0], +x[1] - 1, +x[2])).getUTCDay() : 0, tot = d.cur + d.other, last = j === ser.length - 1;
      return '<div class="ow-d' + (last ? ' now' : '') + '"><b>' + (tot ? tot + "'" : '') + '</b><span class="ow-col">' +
        '<i class="o" style="height:' + (d.other / max * 100) + '%"></i><i class="c" style="height:' + (d.cur / max * 100) + '%"></i>' +
        (w.limit ? '<s style="bottom:' + (w.limit / max * 100) + '%"></s>' : '') + '</span><em>' + (last ? 'Hôm nay' : WD_S[wd]) + '</em></div>';
    }).join('');
    return '<div class="ow-chart"><div class="ow-plot">' + cols + '</div>' +
      '<div class="ow-leg"><span><i class="cur"></i>Bài giáo trình</span><span><i class="free"></i>Ngoài giáo trình</span>' + (w.limit ? '<span><i class="lim"></i>Giới hạn ' + w.limit + "'/ngày</span>" : '') + '</div></div>';
  }
  function roadNotice(k) {
    var w = k.watch; if (!w) return '';
    var lv = WLV[w.level] || WLV.little;
    return '<div class="ov-watch ' + w.level + '"><div class="ow-l"><div class="ow-h"><b>🗺 Lộ trình 7 ngày qua</b><span class="ow-lv">' + lv[0] + ' ' + lv[1] + '</span></div>' +
      (w.minutes ? '<div class="ow-txt"><b>' + w.cur + '%</b> đúng giáo trình · ' + w.minutes + ' phút xem</div>' + shareBar(w) +
        (w.reason && w.level !== 'ok' ? '<div class="ow-txt"><em>' + esc(w.reason) + '</em></div>' : '') : '<div class="ow-txt">Tuần này chưa xem video nào.</div>') +
      (w.tip ? '<div class="ow-tip">💡 ' + esc(w.tip) + '</div>' : '') + '</div>' +
      ((w.series || []).length ? dayChart(w) : '') + '</div>';
  }
  // Nút chọn giáo trình ngay trên trang chính: giáo trình được gợi ý đứng đầu
  function curBtn(c, sug) {
    return '<button class="obtn cur' + (sug ? ' sug' : '') + '" data-act="cur" data-id="' + esc(c.id) + '">' + (sug ? '<em>Gợi ý</em>' : '') +
      esc((c.emoji || '📘') + ' ' + c.name) + '<small>' + (c.total ? c.done + '/' + c.total + ' bài' : '') + '</small></button>';
  }
  function kidActs(k, i) {
    var w = k.watch || {}, cs = (w.curriculum || []).slice(), out = [], j;
    for (j = 0; j < cs.length; j++) if (cs[j].id === w.tip_id) { cs.unshift(cs.splice(j, 1)[0]); break; }
    if (k.next && findLesson(k.next)) out.push('<button class="obtn main" data-act="next" data-i="' + i + '">▶ Học tiếp: ' + esc(k.next.lesson) + '</button>');
    cs.forEach(function (c) { if (libIndex(c.id) >= 0) out.push(curBtn(c, c.id === w.tip_id)); });
    if (!out.length) out.push('<button class="obtn main" data-act="lib">📚 Chọn giáo trình</button>');
    return '<div class="ov-acts">' + out.join('') + '</div>';
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
    $('#ov-kids').innerHTML = kids.length ? kids.slice(0, 3).map(function (k, i) {
      return '<div class="ov-kid">' +
        '<div class="ov-kh"><span class="ov-av">' + esc(k.emoji || '🧒') + '</span><div><h2>' + esc(k.name) + '</h2><div class="ov-sub">' + (k.age != null ? k.age + ' tuổi · ' : '') +
          ((k.paths || []).length ? 'đang học ' + k.paths.length + ' giáo trình' : 'chưa có giáo trình') + (k.streak ? ' · 🔥 ' + k.streak + ' ngày liên tiếp' : '') + '</div></div></div>' +
        roadNotice(k) + kidActs(k, i) + '</div>';
    }).join('') : familyCard();
    $('#ov-btns').innerHTML = curList().length ? '<button class="obtn" data-act="road">🗺 Hành trình của bé</button>' : '';
    if (ovIdx >= ovItems().length) ovIdx = 0;
    if (zone === 'ov') focus();
  }
  // Chưa có hồ sơ bé: chọn thẳng giáo trình của cả nhà
  function familyCard() {
    var cur = lib.filter(function (g) { return g.numbered; }).slice(0, 4);
    return '<div class="ov-kid ov-fam"><div class="ov-kh"><span class="ov-av">👨‍👩‍👧</span><div><h2>Cả nhà đang học</h2><div class="ov-sub">Thêm hồ sơ bé trong app ChildTube → Gia đình để thấy lộ trình và gợi ý riêng của từng bé.</div></div></div>' +
      '<div class="ov-acts">' + (cur.length ? cur.map(function (g) { return curBtn({ id: g.id, emoji: g.emoji, name: g.title, done: doneCount(g), total: g.videos.length }, false); }).join('')
        : '<button class="obtn main" data-act="lib">📚 Xem video</button>') + '</div></div>';
  }
  function libIndex(id) { for (var i = 0; i < lib.length; i++) if (lib[i].id === id) return i; return -1; }
  // Bài tiếp theo của bé nằm ở đâu trong danh sách của TV
  function findLesson(n) {
    var i = libIndex(n.group_id);
    if (i >= 0) for (var j = 0; j < lib[i].videos.length; j++) if (lib[i].videos[j].id === n.video) return { ch: i, idx: j };
    return null;
  }
  // Mở một giáo trình trong tab Xem video, con trỏ đứng ở bài nên học tiếp
  function openCur(i) {
    goTab('home');
    if (zone !== 'side') return;                            // hết giờ xem
    chIdx = -1; showChannel(i); sideIdx = i;
    zone = 'grid'; gridIdx = startIndex(lib[i]);
    focus();
  }
  function ovItems() { return $('#ov').querySelectorAll('.obtn'); }
  function ovAct(b) {
    var act = b.getAttribute('data-act');
    if (act === 'lib') { goTab('home'); return; }
    if (act === 'road') { showRoad('ov'); return; }
    if (act === 'cur') { var ci = libIndex(b.getAttribute('data-id')); if (ci >= 0) openCur(ci); else goTab('home'); return; }
    var k = ov && ov.kids[+b.getAttribute('data-i')], at = k && findLesson(k.next);
    if (!at) { goTab('home'); return; }
    openCur(at.ch);
    if (zone !== 'grid') return;
    gridIdx = at.idx; focus();
    if (isLocked(lib[at.ch], at.idx)) { toast('Hãy xem bài trước nhé! 🔒'); return; }
    play(lib[at.ch].videos, at.idx);
  }
  function ovKey(k) {
    var items = ovItems(), j;
    if (k === K.ENTER) { if (items[ovIdx]) ovAct(items[ovIdx]); return; }
    if (BACK.indexOf(k) >= 0) { zone = 'tab'; focus(); return; }
    if (k === K.LEFT || k === K.RIGHT || k === K.UP || k === K.DOWN) {
      j = nearest(items, ovIdx, k);
      if (j >= 0) ovIdx = j;
      else if (k === K.DOWN) { zone = 'tab'; }
    }
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
    screen('rm');
    zone = 'rm'; mapRow = 'map'; mapSel = -1; mapMoved = false;
    paintRoad();
    loadComp().then(function () { if (zone === 'rm') paintRoad(); }, function () {});
    loadFeed().then(function () { if (zone === 'rm') paintRoad(); }, function () { if (zone === 'rm') paintRoad(); });
    loadOverview().then(function () { if (zone === 'rm') paintRoad(); });
  }
  function hideRoad() {
    if (rmFrom === 'ov') { showOverview(); return; }
    screen('home');
    zone = 'rmbtn'; focus();
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
    btns.push('<button class="obtn" data-act="rm-feed">📰 Bảng tin</button>');
    btns.push('<button class="obtn" data-act="rm-back">' + (rmFrom === 'ov' ? '← Quay lại' : '← Thư viện') + '</button>');
    $('#rm-btns').innerHTML = btns.join('');
    if (rmIdx2 >= btns.length) rmIdx2 = 0;
    focus();
  }
  function rmAct(b) {
    var act = b.getAttribute('data-act');
    if (act === 'rm-back') return hideRoad();
    if (act === 'rm-feed') { goTab('fd'); return; }
    var gi = curList()[0], g = lib[gi];
    if (!g) return hideRoad();
    var ls = curLessons(g), cur = null;
    for (var i = 0; i < ls.length; i++) if (!ls[i].done) { cur = ls[i]; break; }
    screen('home');
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

  // ---------- Ảnh, video gia đình: link có ký, ngày, vai trò người đăng ----------
  var ROLE = { owner: 'Bố mẹ', parent: 'Bố mẹ', relative: 'Người thân', teacher: 'Giáo viên' };
  function phUrl(p) { return /^https?:/.test(p.url) ? p.url : CT_CONFIG.url + p.url; }
  function phDay(d) { var x = (d || '').split('-'); return x.length === 3 ? +x[2] + '/' + +x[1] + '/' + x[0] : ''; }

  // ---------- Album của bé: xem lại từng ngày + video người thân dạy ----------
  // Mỗi ngày là một dải thẻ (ảnh, video, ghi nhanh) theo giờ đăng; "Xem lại cả ngày" chạy như story.
  // Video người thân dạy: các mục bố mẹ đánh dấu 🎓 trong app. Xem album không tính vào giờ xem YouTube.
  var al = { data: null, err: false, tab: 1, at: 'tabs', idx: 0, from: 'side', slides: [], vIdx: 0, chain: true, timer: null, paused: false };
  var WD = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  var KIND_I = { checkin: '☀️', note: '📝', milestone: '🌟', achievement: '🏆', feedback: '🧑‍🏫', activity: '🎨' };
  function alDayName(d) {
    if (!d) return 'Hôm nay';
    var t = al.data && al.data.today, x = d.split('-'), dt = new Date(Date.UTC(+x[0], +x[1] - 1, +x[2]));
    var diff = t ? Math.round((Date.parse(t) - dt.getTime()) / 864e5) : 99;
    var dm = +x[2] + '/' + +x[1];
    return diff === 0 ? 'Hôm nay' : diff === 1 ? 'Hôm qua' : WD[dt.getUTCDay()] + ' ' + dm;
  }
  // Thẻ trên TV: tab 0 = Người thân dạy, tab 1 = Hôm nay, rồi các ngày trước
  function alTabs() {
    var d = (al.data && al.data.days) || [], today = al.data && al.data.today, tabs = [{ k: 'lesson' }];
    tabs.push({ k: 'day', day: today, items: d.length && d[0].day === today ? d[0].items : [] });
    d.forEach(function (g) { if (g.day !== today) tabs.push({ k: 'day', day: g.day, items: g.items }); });
    return tabs.slice(0, 22);
  }
  // Mỗi ảnh/video là một khung; mục chỉ có chữ (ghi nhanh, cột mốc…) là một khung chữ
  function alSlides(tab) {
    var out = [];
    if (tab.k === 'lesson') {
      ((al.data && al.data.lessons) || []).forEach(function (v) { out.push({ m: v, it: v, day: v.day, lesson: true }); });
      return out;
    }
    tab.items.forEach(function (it) {
      if (it.media.length) it.media.forEach(function (m) { out.push({ m: m, it: it, day: tab.day }); });
      else out.push({ m: null, it: it, day: tab.day });
    });
    return out;
  }
  function showAlbum(from) {
    al.from = from || 'side';
    screen('al');
    zone = 'al'; al.tab = 1; al.at = 'row'; al.idx = 0;
    paintAlbum();
    loadAlbum().then(function (r) {
      al.at = 'row'; al.idx = 0;
      if (!alSlides(alTabs()[1]).length && (r.lessons || []).length) { al.tab = 0; }   // hôm nay chưa có gì: mở video dạy bé
      if (zone === 'al') paintAlbum();
    }, function () { if (zone === 'al') paintAlbum(); });
  }
  function hideAlbum() {
    if (al.from === 'ov') { showOverview(); return; }
    screen('home');
    zone = 'albtn'; focus();
  }
  function alThumb(s, k) {
    var it = s.it, m = s.m, cap = '<div class="al-cap"><b>' + esc(it.title || it.text || (it.child ? 'Khoảnh khắc của ' + it.child : 'Khoảnh khắc gia đình')) + '</b>' +
      '<span>' + (s.lesson ? phDay(s.day) : '') + (it.by ? (s.lesson ? ' · ' : '') + (s.lesson ? '🎓 ' : '📸 ') + esc(it.by) : '') + '</span></div>';
    if (s.lesson) return '<div class="al-card al-les c' + (k % 5) + '" data-k="' + k + '"><div class="al-les-i">🎓</div><i class="al-play">▶</i>' + cap + '</div>';
    if (!m) {
      var chips = (it.acts || []).map(function (a) { return '<em>' + esc(a) + '</em>'; }).join('');
      return '<div class="al-card al-txt c' + (k % 5) + '" data-k="' + k + '"><div class="al-txt-i">' + (it.mood && MOOD[it.mood] ? MOOD[it.mood] : KIND_I[it.kind] || '📝') + '</div>' +
        '<div class="al-txt-b">' + esc(it.title || it.text || (it.kind === 'checkin' ? (it.child ? it.child + ' hôm nay' : 'Hôm nay') : '')) + '</div>' + (chips ? '<div class="al-acts">' + chips + '</div>' : '') +
        '<div class="al-cap"><span>' + (it.by ? '✍️ ' + esc(it.by) : '') + '</span></div></div>';
    }
    return '<div class="al-card" data-k="' + k + '">' + (m.type === 'video' ? '<video src="' + phUrl(m) + '#t=0.5" preload="metadata" muted></video><i class="al-play">▶</i>' : '<img src="' + phUrl(m) + '" alt="" decoding="async">') + cap + '</div>';
  }
  function paintAlbum() {
    var tabs = alTabs();
    if (al.tab >= tabs.length) al.tab = 1;
    var nL = ((al.data && al.data.lessons) || []).length;
    $('#al-tabs').innerHTML = tabs.map(function (t, i) {
      var n = t.k === 'lesson' ? nL : alSlides(t).length;
      return '<button class="obtn al-tab' + (t.k === 'lesson' ? ' les' : '') + (i === al.tab ? ' on' : '') + '">' + (t.k === 'lesson' ? '🎓 Người thân dạy' : alDayName(t.day || '')) + (n ? ' · ' + n : '') + '</button>';
    }).join('');
    var tab = tabs[al.tab], sl = al.data ? alSlides(tab) : [], head = '';
    if (!al.data) head = '<div class="al-empty">' + (al.err ? 'Chưa tải được album, hãy thử lại sau.' : 'Đang mở album…') + '</div>';
    else if (tab.k === 'lesson') head = '<h2>🎓 Video người thân dạy bé</h2><p>' + (nL ? 'Ông bà, bố mẹ, cô chú quay lại những điều dạy bé. Chọn một video để xem lại.'
      : 'Chưa có video nào.<br>Trong app ChildTube, khi đăng video vào Nhật ký, bố mẹ tích ô “🎓 Video người thân dạy bé”.') + '</p>';
    else {
      var acts = [], mood = '';
      tab.items.forEach(function (it) { (it.acts || []).forEach(function (a) { if (acts.indexOf(a) < 0) acts.push(a); }); if (!mood && it.mood) mood = it.mood; });
      head = '<h2>' + alDayName(tab.day) + (al.tab === 1 ? '' : '') + '<small>' + phDay(tab.day) + '</small></h2>' +
        (sl.length ? '<p>' + (acts.length ? 'Bé đã: ' + acts.slice(0, 6).map(esc).join(' · ') : sl.length + ' khoảnh khắc') + (mood && MOOD[mood] ? ' · ' + MOOD[mood] + ' ' + esc(mood) : '') + '</p>'
          : '<p>' + (al.data.enabled === false ? 'Gia đình chưa bật lưu ảnh, video. Trong app: Cài đặt → Quyền riêng tư → bật “Lưu ảnh, video của bé”.<br>' : '') +
            'Hôm nay chưa có ảnh hay video nào. Bố mẹ đăng vào Nhật ký trong app ChildTube (mức “Gia đình”) để bé xem lại ở đây.</p>');
    }
    $('#al-head').innerHTML = head;
    var cards = sl.map(alThumb);
    if (sl.length > 1 && tab.k === 'day') cards.unshift('<div class="al-card al-all" data-k="-1"><div class="al-all-i">▶</div><b>Xem lại cả ngày</b><span>' + sl.length + ' khoảnh khắc</span></div>');
    $('#al-row').innerHTML = cards.join('');
    al.slides = sl;
    if (al.idx >= cards.length) al.idx = Math.max(0, cards.length - 1);
    if (!cards.length) al.at = 'tabs';
    focus();
  }
  function alCards() { return $('#al-row').children; }
  function alReveal(el) {
    var box = $('#al-row'), l = el.offsetLeft, r = l + el.offsetWidth, pad = box.clientWidth * 0.06;
    if (l - pad < box.scrollLeft) box.scrollLeft = Math.max(0, l - pad);
    else if (r + pad > box.scrollLeft + box.clientWidth) box.scrollLeft = r + pad - box.clientWidth;
  }
  function alFocusEl() {
    var el = al.at === 'tabs' ? $('#al-tabs').children[al.tab] : alCards()[al.idx];
    if (el && al.at === 'tabs') { var b = $('#al-tabs'); if (el.offsetLeft + el.offsetWidth > b.scrollLeft + b.clientWidth) b.scrollLeft = el.offsetLeft + el.offsetWidth - b.clientWidth; else if (el.offsetLeft < b.scrollLeft) b.scrollLeft = el.offsetLeft; }
    if (el && al.at === 'row') alReveal(el);
    return el;
  }
  function alOpen(card) {
    var k = +card.getAttribute('data-k');
    openStory(k < 0 ? 0 : k, k < 0 || !al.slides[k].lesson);
  }
  function alKey(k) {
    var cards = alCards(), n = $('#al-tabs').children.length;
    if (BACK.indexOf(k) >= 0) { hideAlbum(); return; }
    if (al.at === 'tabs') {
      if (k === K.LEFT && al.tab > 0) { al.tab--; al.idx = 0; $('#al-row').scrollLeft = 0; paintAlbum(); al.at = 'tabs'; focus(); return; }
      if (k === K.RIGHT && al.tab < n - 1) { al.tab++; al.idx = 0; $('#al-row').scrollLeft = 0; paintAlbum(); al.at = 'tabs'; focus(); return; }
      if ((k === K.DOWN || k === K.ENTER) && cards.length) al.at = 'row';
    } else {
      if (k === K.UP) al.at = 'tabs';
      else if (k === K.LEFT && al.idx > 0) al.idx--;
      else if (k === K.RIGHT && al.idx < cards.length - 1) al.idx++;
      else if ((k === K.ENTER || k === K.PLAY || k === K.PLAYPAUSE) && cards[al.idx]) { alOpen(cards[al.idx]); return; }
    }
    focus();
  }

  // Xem toàn màn hình kiểu story: ảnh/chữ 7 giây, video chạy hết rồi sang khung sau.
  // Video dạy bé: xem xong một video thì dừng lại (◀ ▶ để xem video khác).
  function openStory(k, chain) {
    if (zone === 'al') al.back = 'al';
    zone = 'alv'; al.chain = chain; al.paused = false;
    $('#alv').classList.remove('hidden');
    alShow(k);
  }
  function alShow(k) {
    var sl = al.slides, v = $('#alv-vid');
    if (k < 0) k = 0;
    if (k >= sl.length) { closeStory(); return; }
    al.vIdx = k; al.paused = false;
    clearTimeout(al.timer);
    var s = sl[k], it = s.it, m = s.m;
    v.pause(); v.removeAttribute('src'); v.load();
    $('#alv').className = m ? (m.type === 'video' ? 'vid' : 'img') : 'txt';
    $('#alv-img').src = m && m.type === 'img' ? phUrl(m) : '';
    if (m && m.type === 'video') { v.src = phUrl(m); var p = v.play(); if (p && p.catch) p.catch(function () { /* TV tự xử lý */ }); }
    $('#alv-txt').innerHTML = m ? '' : '<div class="alt-i">' + (it.mood && MOOD[it.mood] ? MOOD[it.mood] : KIND_I[it.kind] || '📝') + '</div><b>' + esc(it.title || (it.child ? it.child + ' hôm nay' : 'Hôm nay')) + '</b>' +
      (it.title && it.text ? '<p>' + esc(it.text) + '</p>' : !it.title && it.text ? '<p>' + esc(it.text) + '</p>' : '') +
      ((it.acts || []).length ? '<div class="al-acts">' + it.acts.map(function (a) { return '<em>' + esc(a) + '</em>'; }).join('') + '</div>' : '');
    $('#alv-cap').innerHTML = m ? '<b>' + esc(it.title || (it.child ? 'Khoảnh khắc của ' + it.child : 'Khoảnh khắc gia đình')) + '</b>' + (it.text && it.title ? '<em>' + esc(it.text) + '</em>' : '') +
      '<span>' + phDay(s.day) + (it.by ? ' · ' + (s.lesson ? '🎓 ' : '📸 ') + esc(it.by) + (ROLE[it.role] && it.by !== ROLE[it.role] ? ' (' + ROLE[it.role] + ')' : '') : '') + '</span>' : '';
    $('#alv-bar').innerHTML = al.chain && sl.length > 1 && sl.length <= 40 ? sl.map(function (x, i) { return '<i class="' + (i < k ? 'done' : i === k ? 'now' : '') + '"></i>'; }).join('') : '';
    $('#alv-n').textContent = (k + 1) + ' / ' + sl.length + ' · ◀ ▶ đổi · OK ' + (m && m.type === 'video' ? 'tạm dừng' : 'dừng lại');
    if (!m || m.type === 'img') alTimer();
  }
  function alTimer() {
    clearTimeout(al.timer);
    if (al.chain && !al.paused) al.timer = setTimeout(function () { if (zone === 'alv') alShow(al.vIdx + 1); }, 7000);
  }
  function closeStory() {
    clearTimeout(al.timer);
    var v = $('#alv-vid'); v.pause(); v.removeAttribute('src'); v.load();
    $('#alv').classList.add('hidden');
    if (al.back === 'fd') { zone = 'fd'; focus(); return; }   // mở từ Bảng tin
    zone = 'al'; al.at = 'row';
    var off = al.slides.length > 1 && !al.slides[0].lesson ? 1 : 0;
    al.idx = Math.min(al.vIdx + off, alCards().length - 1);
    focus();
  }
  function alvKey(k) {
    var s = al.slides[al.vIdx], v = $('#alv-vid'), vid = s && s.m && s.m.type === 'video';
    if (BACK.indexOf(k) >= 0 || k === K.STOP) { closeStory(); return; }
    if (k === K.LEFT || k === K.RW) alShow(Math.max(0, al.vIdx - 1));
    else if (k === K.RIGHT || k === K.FF) { if (al.vIdx < al.slides.length - 1) alShow(al.vIdx + 1); }
    else if (k === K.ENTER || k === K.PLAYPAUSE || k === K.PLAY || k === K.PAUSE) {
      if (vid) { if (v.paused) v.play(); else v.pause(); }
      else { al.paused = !al.paused; $('#alv-n').textContent = (al.vIdx + 1) + ' / ' + al.slides.length + (al.paused ? ' · ⏸ đang dừng · OK chạy tiếp' : ' · ▶ đang chạy'); alTimer(); }
    }
  }
  (function () {
    var v = $('#alv-vid');
    v.addEventListener('ended', function () {
      if (zone !== 'alv') return;
      if (al.chain && al.vIdx < al.slides.length - 1) alShow(al.vIdx + 1);
      else $('#alv-n').textContent = 'Hết video · OK xem lại · ◀ ▶ video khác · Back quay lại';
    });
    v.addEventListener('error', function () {
      if (zone !== 'alv' || !v.getAttribute('src')) return;
      $('#alv-n').textContent = 'TV chưa mở được video này 😕';
      clearTimeout(al.timer);
      if (al.chain) al.timer = setTimeout(function () { if (zone === 'alv') alShow(al.vIdx + 1); }, 3000);
    });
  })();

  // ---------- Bảng tin (tab dưới): như trên điện thoại, mỗi bài tràn hết bề ngang ----------
  // Cùng dữ liệu với Album (ct_tv_album, mức "Gia đình", 45 ngày). ▲ ▼ lướt từng bài.
  // Bài có video: video tự chạy ngay trong bảng tin (tắt tiếng), OK bật tiếng → tạm dừng → chạy tiếp. Bài chỉ có ảnh: OK xem toàn màn hình.
  // Ảnh/video chỉ tải cho vài bài quanh bài đang chọn để TV không bị nặng.
  var fd = { idx: 0, posts: [], sound: false };
  var ROLE_I = { owner: '👤', parent: '👤', relative: '👵', teacher: '🧑‍🏫' };
  var KIND_T = { milestone: '🌟 Cột mốc', achievement: '🏆 Thành tích', feedback: '🎤 Nhận xét', activity: '🎨 Hoạt động' };
  function loadAlbum() {
    return rpc('ct_tv_album', { p_device: device.id, p_secret: device.secret }).then(function (r) { al.data = r; al.err = false; return r; },
      function (e) { al.err = true; throw e; });
  }
  function fdPosts() {
    var out = [];
    ((al.data && al.data.days) || []).forEach(function (g) {
      g.items.slice().sort(function (a, b) { return String(b.time || '').localeCompare(String(a.time || '')); })
        .forEach(function (it) { out.push({ it: it, day: g.day }); });
    });
    return out;
  }
  function showFeed() {
    screen('fd'); zone = 'fd';
    if (!fd.posts.length) paintFeed();
    loadAlbum().then(function () { if (tab === 'fd') paintFeed(); }, function () { if (tab === 'fd' && !fd.posts.length) paintFeed(); });
  }
  function fdMedia(ms) {
    if (!ms.length) return '';
    var tile = function (m, i, more) {
      return '<div class="fm' + (m.type === 'video' ? ' v' : '') + '"><' + (m.type === 'video' ? 'video muted preload="metadata"' : 'img alt=""') + ' data-src="' + esc(phUrl(m) + (m.type === 'video' ? '#t=0.5' : '')) + '">' +
        (m.type === 'video' ? '</video><i class="al-play">▶</i><span class="fm-snd"></span>' : '') + (more ? '<span class="fm-more">+' + more + '</span>' : '') + '</div>';
    };
    var n = Math.min(ms.length, 4), more = ms.length - 4;
    if (n === 1) {
      // Một ảnh/video: tràn bề ngang, cao theo tỉ lệ ảnh (tối đa ~3/4 màn hình). Ảnh ngang phủ kín bề ngang;
      // ảnh dọc để nguyên cả ảnh ở giữa, hai bên là nền mờ của chính ảnh.
      var m = ms[0], W = window.innerWidth, H = m.w && m.h ? Math.round(W * m.h / m.w) : Math.round(W * 9 / 16), tall = m.w && m.h && m.h > m.w;
      return '<div class="fd-media n1' + (tall ? ' tall' : '') + '" style="height:' + Math.min(H, Math.round(window.innerHeight * 0.74)) + 'px">' +
        (tall && m.type === 'img' ? '<div class="fm-bg" data-bg="' + esc(phUrl(m)) + '"></div>' : '') + tile(m, 0) + '</div>';
    }
    if (n === 2) return '<div class="fd-media n2">' + tile(ms[0]) + tile(ms[1]) + '</div>';
    if (n === 3) return '<div class="fd-media n3">' + tile(ms[0]) + '<div class="fm-col">' + tile(ms[1]) + tile(ms[2]) + '</div></div>';
    return '<div class="fd-media n4"><div class="fm-col">' + tile(ms[0]) + tile(ms[1]) + '</div><div class="fm-col">' + tile(ms[2]) + tile(ms[3], 3, more > 0 ? more : 0) + '</div></div>';
  }
  function fdPost(p, i) {
    var it = p.it, special = it.kind === 'milestone' || it.kind === 'achievement' || it.kind === 'feedback';
    var rx = it.reacts || {}, rk = Object.keys(rx), rn = 0, j;
    for (j = 0; j < rk.length; j++) rn += rx[rk[j]];
    var feel = it.mood ? (MOOD[it.mood] || '🙂') + ' đang cảm thấy ' + esc(it.mood) : '';
    var head = '<div class="fp-head"><span class="fp-av">' + (ROLE_I[it.role] || '👤') + '</span><div class="fp-who"><div><b>' + esc(it.by || 'Gia đình') + '</b>' +
      (it.child ? ' cùng <b>' + esc((it.emoji || '🧒') + ' ' + it.child) + '</b>' : '') + (feel ? ' <span class="fp-feel">— ' + feel + '</span>' : '') + '</div>' +
      '<span class="fp-when">' + alDayName(p.day) + (it.time ? ' lúc ' + it.time : '') + ' · 👨‍👩‍👧 Gia đình</span></div></div>';
    var body = special
      ? '<div class="fp-mile"><span>' + (it.kind === 'feedback' ? '🎤' : it.kind === 'achievement' ? '🏆' : '🌟') + '</span><div><b>' + esc(it.title || KIND_T[it.kind]) + '</b>' + (it.text ? '<p>' + esc(it.text) + '</p>' : '') + '</div></div>'
      : (it.title || it.text || (it.acts || []).length ? '<div class="fp-text">' + (KIND_T[it.kind] ? '<span class="fp-tag">' + KIND_T[it.kind] + '</span>' : '') +
        (it.title ? '<b>' + esc(it.title) + '</b> ' : '') + esc(it.text || '') +
        ((it.acts || []).length ? '<div class="fp-chips">' + it.acts.map(function (a) { return '<span>✔ ' + esc(a) + '</span>'; }).join('') + '</div>' : '') + '</div>' : '');
    var sum = rn || it.n_cm ? '<div class="fp-sum"><span>' + (rn ? rk.join('') + ' ' + rn : '') + '</span><span>' + (it.n_cm ? it.n_cm + ' bình luận' : '') + '</span></div>' : '';
    var cms = (it.comments || []).map(function (c) { return '<div class="fp-cm"><b>' + esc(c.by || 'Người thân') + '</b>' + esc(c.body) + '</div>'; }).join('');
    return '<article class="fp" data-i="' + i + '">' + head + body + fdMedia(it.media || []) + sum + (cms ? '<div class="fp-cms">' + cms + '</div>' : '') + '</article>';
  }
  function paintFeed() {
    fd.posts = fdPosts();
    var list = $('#fd-list');
    if (!fd.posts.length) {
      list.innerHTML = '<div class="fd-empty">' + (!al.data ? (al.err ? 'Chưa tải được bảng tin, hãy thử lại sau.' : 'Đang mở bảng tin…')
        : (al.data.enabled === false ? 'Gia đình chưa bật lưu ảnh, video. Trong app: Cài đặt → Quyền riêng tư → bật “Lưu ảnh, video của bé”.<br>' : '') +
          'Chưa có bài nào gần đây.<br>Bố mẹ, ông bà đăng vào Nhật ký trong app ChildTube (mức “Gia đình”) để bài hiện ở đây.') + '</div>';
      return;
    }
    list.innerHTML = '<h1 class="fd-h">📰 Bảng tin gia đình</h1>' + fd.posts.map(fdPost).join('');
    if (fd.idx >= fd.posts.length) fd.idx = 0;
    if (zone === 'fd') focus(); else fdNear();
  }
  function fdItems() { return $('#fd-list').querySelectorAll('.fp'); }
  // Gắn ảnh/video cho bài đang chọn và 2 bài kế tiếp
  function fdNear() {
    var ps = fdItems(), i, j, el, src;
    for (i = Math.max(0, fd.idx - 1); i <= Math.min(ps.length - 1, fd.idx + 2); i++) {
      el = ps[i].querySelectorAll('[data-src], [data-bg]');
      for (j = 0; j < el.length; j++) {
        src = el[j].getAttribute('data-src');
        if (src) { el[j].src = src; el[j].removeAttribute('data-src'); }
        else { el[j].style.backgroundImage = 'url("' + el[j].getAttribute('data-bg') + '")'; el[j].removeAttribute('data-bg'); }
      }
    }
  }
  function fdFocus() {
    var el = fdItems()[fd.idx], box = $('#fd');
    if (!el) return null;
    box.scrollTop = fd.idx ? el.offsetTop - box.clientHeight * 0.03 : 0;
    fdNear();
    fdPlay(el);
    return el;
  }
  // Chỉ video của bài đang chọn được chạy; rời bài hoặc rời bảng tin thì dừng
  function fdStop(keep) {
    var vs = $('#fd').querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) if (vs[i] !== keep) { vs[i].removeAttribute('data-hold'); if (!vs[i].paused) vs[i].pause(); }
  }
  function fdPlay(el) {
    var v = el && el.querySelector('video');
    fdStop(v);
    if (!v || v.getAttribute('data-err') || v.getAttribute('data-hold')) return;
    v.loop = true; v.muted = !fd.sound;
    var p = v.play(); if (p && p.catch) p.catch(function () { /* TV tự xử lý */ });
    fdSnd(v);
  }
  function fdSnd(v) {
    var t = v.parentNode, b = t.querySelector('.fm-snd');
    t.classList.toggle('on', !v.paused);
    if (b) b.textContent = v.getAttribute('data-err') ? 'TV chưa mở được video này 😕' : v.paused ? '⏸ OK: chạy tiếp' : v.muted ? '🔇 OK: bật tiếng' : '🔊 OK: tạm dừng';
  }
  // OK trên bài có video: bật tiếng → tạm dừng → chạy tiếp
  function fdToggle(v) {
    if (v.getAttribute('data-err')) return;
    if (v.muted && !v.paused) { fd.sound = true; v.muted = false; }
    else if (!v.paused) { v.pause(); v.setAttribute('data-hold', '1'); }
    else { v.removeAttribute('data-hold'); v.muted = !fd.sound; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    fdSnd(v);
  }
  (function () {
    var box = $('#fd');
    box.addEventListener('play', function (e) { fdSnd(e.target); }, true);
    box.addEventListener('pause', function (e) { fdSnd(e.target); }, true);
    box.addEventListener('error', function (e) { if (e.target.tagName === 'VIDEO') { e.target.setAttribute('data-err', '1'); fdSnd(e.target); } }, true);
  })();
  function fdOpen(i) {
    var p = fd.posts[i], v = fdItems()[i] && fdItems()[i].querySelector('video'); if (!p) return;
    if (v) { fdToggle(v); return; }
    fdStop();
    al.slides = p.it.media && p.it.media.length ? p.it.media.map(function (m) { return { m: m, it: p.it, day: p.day }; }) : [{ m: null, it: p.it, day: p.day }];
    al.back = 'fd';
    openStory(0, true);
  }
  function fdKey(k) {
    var n = fdItems().length;
    if (BACK.indexOf(k) >= 0) { zone = 'tab'; focus(); return; }
    if (k === K.UP && fd.idx > 0) fd.idx--;
    else if (k === K.DOWN) { if (fd.idx < n - 1) fd.idx++; else zone = 'tab'; }
    else if (k === K.UP && !n) zone = 'tab';
    else if (k === K.ENTER || k === K.PLAY || k === K.PLAYPAUSE) { fdOpen(fd.idx); return; }
    focus();
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
    else if (zone === 'tab') tabKey(k);
    else if (zone === 'fd') fdKey(k);
    else if (zone === 'rm') rmKey(k);
    else if (zone === 'al') alKey(k);
    else if (zone === 'alv') alvKey(k);
    else if (zone === 'albtn') {
      if (k === K.ENTER) goTab('fd');   // Album theo ngày đã thay bằng Bảng tin lướt liền các ngày
      else if (k === K.DOWN || k === K.RIGHT) { zone = 'rmbtn'; focus(); }
      else if (BACK.indexOf(k) >= 0) { zone = 'tab'; focus(); }
    }
    else if (zone === 'rmbtn') {
      if (k === K.ENTER) showRoad('side');
      else if (k === K.UP) { zone = 'albtn'; focus(); }
      else if (k === K.DOWN || k === K.RIGHT) { zone = 'side'; sideIdx = 0; focus(); }
      else if (BACK.indexOf(k) >= 0) { zone = 'tab'; focus(); }
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
    var tb = t.closest('.tb');
    if (tb) { goTab(tb.getAttribute('data-tab')); return; }
    if (zone === 'ov' || (zone === 'tab' && tab === 'ov')) { var ob = t.closest('.obtn'); if (ob) ovAct(ob); return; }
    if (zone === 'fd' || (zone === 'tab' && tab === 'fd')) { var fp = t.closest('.fp'); if (fp) { zone = 'fd'; fd.idx = +fp.getAttribute('data-i'); focus(); fdOpen(fd.idx); } return; }
    if (zone === 'rm') { var rb = t.closest('.obtn'); if (rb) rmAct(rb); return; }
    if (t.closest('#rm-btn')) { showRoad('side'); return; }
    if (t.closest('#al-btn')) { goTab('fd'); return; }
    if (zone === 'alv') { closeStory(); return; }
    if (zone === 'al') {
      var ac = t.closest('.al-card'), at = t.closest('.al-tab');
      if (ac) alOpen(ac);
      else if (at) { al.tab = [].indexOf.call($('#al-tabs').children, at); al.idx = 0; paintAlbum(); }
      return;
    }
    if (t.closest('#who')) { goTab('ov'); return; }
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
