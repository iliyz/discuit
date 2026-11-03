const CACHE = 'biscuit-v11';
const PRECACHE = ['/', '/index.html', '/style.css?v=1103c', '/app.js?v=1103c', '/manifest.webmanifest', '/biscuit.svg',
  '/icons/icon-192.png', '/icons/icon-512.png'];
// 联网优先清单（按去查询串后的路径匹配）：在线必拿最新，离线回退缓存
const FRESH = new Set(['/index.html', '/app.js', '/style.css']);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
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

  // HTML/JS/CSS：network-first——在线必拿最新，离线回退缓存
  if (FRESH.has(url.pathname)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 其余静态资源（图标等）：cache-first，后台更新
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
