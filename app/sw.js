// Service worker tối giản: cho phép cài app ra màn hình chính và mở nhanh khi mạng chậm.
const CACHE = 'childtube-v52';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'wizard.js', 'library.js', 'library.css', 'ai-chat.js', 'family.js', 'portal.js', 'v2.css', 'charts.js', 'shell.js', 'today.js', 'learn.js', 'upload.js', 'feeling.js', 'feed.js', 'journey.js', 'familyhub.js', 'chat.js', 'watch.js', 'lunar.js', 'events.js', 'remind.js', '../config.js', '../ct-client.js', 'icon-192.png', 'logo.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Mở app lấy ngay bản đã lưu trong máy (nhanh, không chờ mạng), đồng thời tải bản mới về để lần mở sau dùng.
// Bản mới có tên CACHE khác → cài lại toàn bộ, nên sau mỗi lần cập nhật app chỉ chậm một lần.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => (e.request.mode === 'navigate' ? c.match('index.html') : Response.error()));
  })));
});

// Thông báo nhắc từ máy chủ (remind.ts): hiện ngay, kể cả khi app đang đóng
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || 'ChildTube', { body: m.body || '', tag: m.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: m.url || './' } }));
});
// Bấm thông báo: app đang mở thì chuyển tới đó và mở khung ghi; chưa mở thì mở app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((x) => x.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ go: url.search }); return c.focus(); }
    return self.clients.openWindow(url.href);
  }));
});
