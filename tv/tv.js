// ChildTube — màn hình của bé trên TV. Điều khiển bằng remote (mũi tên, OK, Back) hoặc chuột.
// Viết kiểu JS đơn giản (không async/await, không ?.) để chạy được trên TV Samsung đời 2017+.
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412 };
  var BACK = [10009, 27, 8, 461];
  var COLS = 4;
  var SEC = { collection: 'Bộ sưu tập', topic: 'Chủ đề', source: 'Kênh' };
  var APP_URL = new URL('../app/', location.href).href;

  var lib = [];           // [{section,id,title,emoji,thumb,videos:[{id,title}]}]
  var chIdx = 0;
  var zone = 'loading';   // loading | pair | side | grid | pin | parent | player
  var sideIdx = 0, gridIdx = 0, pinIdx = 0, parentIdx = 0;
  var pin = '', pinFails = 0, pinLockUntil = 0;
  var player = null, playerReady = false, pending = null;
  var queue = null;
  var osdTimer = null, tickTimer = null, toastTimer = null, pollTimer = null;

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

  function rpc(fn, args) {
    return fetch(CT_CONFIG.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CT_CONFIG.key, Authorization: 'Bearer ' + CT_CONFIG.key },
      body: JSON.stringify(args)
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || 'Lỗi'); return j; });
    });
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
  function hello() {
    return rpc('ct_tv_hello', { p_device: device.id, p_secret: device.secret }).then(function (r) {
      if (!r.paired) return showPair(r.code);
      $('#pair').classList.add('hidden');
      $('#home').classList.remove('hidden');
      if (zone === 'loading' || zone === 'pair') zone = 'side';
      setLib(r.rows || [], r.family);
    }).catch(function () {
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
    $('#home').classList.add('hidden');
    $('#pair').classList.remove('hidden');
    $('#pair-url').textContent = APP_URL.replace(/^https?:\/\//, '');
    if (code) { $('#pair-code').textContent = code; drawQr(code); }
    $('#pair-msg').textContent = 'Màn hình sẽ tự chuyển khi ghép xong.';
  }

  function schedule() {
    clearTimeout(pollTimer);
    // Chưa ghép: hỏi mỗi 4 giây. Đã ghép: mỗi 2 phút (chỉ khi bé đang ở trang chủ).
    var wait = zone === 'pair' || zone === 'loading' ? 4000 : 120000;
    pollTimer = setTimeout(function () {
      if (zone === 'pair' || zone === 'loading' || zone === 'side' || zone === 'grid') hello().then(schedule); else schedule();
    }, wait);
  }

  function setLib(rows, family) {
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
    $('#ch-title').textContent = g ? (g.emoji ? g.emoji + ' ' : '') + g.title : '';
    $('#empty').classList.toggle('hidden', !!lib.length);
    if (!lib.length) {
      $('#empty').innerHTML = 'Chưa có video nào' + (family ? ' cho <b>' + esc(family) + '</b>' : '') +
        '.<br>Bố mẹ hãy mở app ChildTube trên điện thoại<br>để chọn video cho bé nhé!';
    }
    $('#grid').innerHTML = g ? g.videos.map(function (v, i) {
      return '<div class="card" data-i="' + i + '"><div class="thumb"><img src="' + thumb(v.id) + '" alt=""></div><div class="t">' + esc(v.title) + '</div></div>';
    }).join('') : '';
    $('#grid').scrollTop = 0;
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
    if (el) el.classList.add('focus');
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
      if (k === K.UP && sideIdx > 0) sideIdx--;
      else if (k === K.DOWN && sideIdx < n - 1) sideIdx++;
      else if ((k === K.RIGHT || k === K.ENTER) && sideIdx < lib.length) {
        if (gridItems().length) { zone = 'grid'; gridIdx = 0; }
      } else if (k === K.ENTER && sideIdx === lib.length) { openPin(); return; }
      showChannel(sideIdx);
    } else if (zone === 'grid') {
      n = gridItems().length;
      if (k === K.LEFT) { if (gridIdx % COLS === 0) { zone = 'side'; sideIdx = chIdx; } else gridIdx--; }
      else if (k === K.RIGHT && gridIdx % COLS < COLS - 1 && gridIdx + 1 < n) gridIdx++;
      else if (k === K.UP && gridIdx >= COLS) gridIdx -= COLS;
      else if (k === K.DOWN && Math.floor(gridIdx / COLS) < Math.floor((n - 1) / COLS)) gridIdx = Math.min(gridIdx + COLS, n - 1);
      else if (k === K.ENTER || k === K.PLAY || k === K.PLAYPAUSE) { play(lib[chIdx].videos, gridIdx); return; }
      else if (BACK.indexOf(k) >= 0) { zone = 'side'; sideIdx = chIdx; }
    }
    focus();
  }

  // ---------- Trình phát ----------
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('yt', {
      host: 'https://www.youtube-nocookie.com',
      width: '100%', height: '100%',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, cc_load_policy: 0, origin: location.origin },
      events: {
        onReady: function () { playerReady = true; window.ctPlayer = player; if (pending) { player.loadVideoById(pending); pending = null; } },
        onStateChange: onState,
        onError: function () {
          toast('Video này không xem được, chuyển video khác…');
          setTimeout(next, 2000);
        }
      }
    });
  };

  function play(videos, idx) {
    queue = { videos: videos, idx: idx };
    zone = 'player';
    $('#player').classList.remove('hidden');
    $('#pause-icon').classList.add('hidden');
    $('#osd-fill').style.width = '0';
    $('#osd-time').textContent = '';
    $('#osd-title').textContent = videos[idx].title;
    showOsd();
    if (playerReady) player.loadVideoById(videos[idx].id); else pending = videos[idx].id;
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 500);
  }

  function next() {
    if (!queue || zone !== 'player') return;
    if (queue.idx + 1 < queue.videos.length) {
      play(queue.videos, queue.idx + 1);
      gridIdx = queue.idx;
    } else stop();
  }

  function stop() {
    clearInterval(tickTimer);
    pending = null;
    if (playerReady) player.stopVideo();
    $('#player').classList.add('hidden');
    zone = gridItems().length ? 'grid' : 'side';
    focus();
  }

  function onState(e) {
    if (e.data === 0) next();
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
    tick();
    showOsd();
  }

  function fmt(s) {
    s = Math.floor(s || 0);
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function tick() {
    if (!playerReady || !player.getDuration) return;
    var d = player.getDuration(), t = player.getCurrentTime();
    if (d > 0) {
      $('#osd-fill').style.width = (t / d * 100) + '%';
      $('#osd-time').textContent = fmt(t) + ' / ' + fmt(d);
    }
  }

  function showOsd(stay) {
    $('#osd').classList.remove('off');
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
    zone = 'side';
    sideIdx = lib.length;
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
    $('#parent').classList.remove('hidden');
    zone = 'parent';
    parentIdx = 0;
    focus();
  }

  function parentAct(act) {
    if (act === 'close') return closeModal();
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
    if (zone === 'pin') { if (key) { pinIdx = +key.getAttribute('data-i'); focus(); pressPad(PAD[pinIdx]); } else if (t === $('#pin')) closeModal(); return; }
    if (zone === 'parent') { if (pb) parentAct(pb.getAttribute('data-act')); else if (t === $('#parent')) closeModal(); return; }
    if (ch) {
      var i = +ch.getAttribute('data-i');
      if (i === lib.length) { openPin(); return; }
      zone = 'side';
      sideIdx = Array.prototype.indexOf.call(sideItems(), ch);
      showChannel(i); focus();
    } else if (card) {
      zone = 'grid'; gridIdx = +card.getAttribute('data-i'); focus();
      play(lib[chIdx].videos, gridIdx);
    }
  });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  hello().then(schedule);
})();
