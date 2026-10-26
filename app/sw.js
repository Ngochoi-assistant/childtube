// Service worker tối giản: cho phép cài app ra màn hình chính và mở nhanh khi mạng chậm.
const CACHE = 'childtube-v29';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'wizard.js', 'library.js', 'library.css', 'ai-chat.js', 'family.js', 'portal.js', 'v2.css', 'charts.js', 'shell.js', 'today.js', 'learn.js', 'feed.js', 'familyhub.js', '../config.js', '../ct-client.js', 'icon-192.png', 'logo.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Ưu tiên mạng (luôn có bản mới nhất), mất mạng mới dùng bản lưu.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
