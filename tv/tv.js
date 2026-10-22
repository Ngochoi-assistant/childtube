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
  var zone = 'loading';   // loading | pair | side | grid | pin | parent | player
  var sideIdx = 0, gridIdx = 0, pinIdx = 0, parentIdx = 0;
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
    $('#home').classList.remove('hidden');
    if (zone === 'loading' || zone === 'pair') zone = 'side';
    setLib(rows, family);
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

  function schedule() {
    clearTimeout(pollTimer);
    // Chưa ghép: hỏi mỗi 4 giây. Đã ghép: mỗi 2 phút (chỉ khi bé đang ở trang chủ).
    var wait = zone === 'pair' || zone === 'loading' ? 4000 : 120000;
    pollTimer = setTimeout(function () {
      if (zone === 'pair' || zone === 'loading' || zone === 'side' || zone === 'grid' || zone === 'limit') hello().then(schedule, schedule); else schedule();
    }, wait);
  }
  // TV bật lại từ chế độ chờ / quay lại app: cập nhật ngay.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && zone !== 'player') hello().then(schedule, schedule);
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
      var badges = (g.numbered ? '<span class="num">Bài ' + (i + 1) + '</span>' : '') + (v.done ? '<span class="tick">✓</span>' : '') + (locked ? '<span class="lock-ic">🔒</span>' : '<span class="play"></span>');
      return '<div class="card' + (locked ? ' locked' : '') + (v.done ? ' done' : '') + '" data-i="' + i + '"><div class="thumb"><img src="' + thumb(v.id) + '" alt="" loading="lazy" decoding="async">' + badges + '</div><div class="t">' + esc(v.title) + '</div></div>';
    }).join('') : '';
    $('#grid').scrollTop = 0;
  }

  // Banner của nhóm đang chọn: loại nhóm, tên, ghi chú, tiến độ giáo trình, ảnh bài nên xem tiếp.
  var heroImg = '';
  function paintHero(g) {
    $('#hero').classList.toggle('hidden', !g);
    if (!g) return;
    var n = g.videos.length;
    $('#hero-kicker').innerHTML = '<i></i>' + esc((g.section === 'fav' ? 'Yêu thích' : SEC[g.section] || 'Video') + ' · ' + n + (g.numbered ? ' bài' : ' video'));
    $('#ch-title').textContent = (g.emoji ? g.emoji + ' ' : '') + g.title;
    $('#ch-note').textContent = g.note || '';
    $('#hero-prog').classList.toggle('hidden', !g.numbered);
    if (g.numbered) {
      var d = doneCount(g);
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
    var name = family || 'Gia đình', w = name.replace(/^(nhà|gia đình)\s+/i, '').split(/\s+/);
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
      if (k === K.UP && sideIdx > 0) sideIdx--;
      else if (k === K.DOWN && sideIdx < n - 1) sideIdx++;
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
    if (playerReady) player.loadVideoById(videos[idx].id); else pending = videos[idx].id;
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
      btns.push(['next', left < 300 ? '▶ Xem video cuối cùng' : g && g.numbered ? '▶ Bài tiếp: Bài ' + (queue.idx + 2) : '▶ Video tiếp']);
    }
    $('#end-title').textContent = (g && g.numbered ? 'Bài ' + (queue.idx + 1) + ' · ' : '') + v.title;
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
  hello().then(schedule, schedule);
})();
