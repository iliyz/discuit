const CACHE = 'biscuit-v5';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.webmanifest', '/biscuit.svg',
  '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API 不缓存（数据同步靠 D1）；第三方发音不走 SW
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;

  // 同源静态资源：cache-first，后台更新
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => {
        if (res.ok && url.origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
