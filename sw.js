const CACHE_NAME = 'lunaby-shell-r24';
const SHELL = [
  './index.html',
  './text-list.css?rev=lunaby-v2-r24',
  './text-list-v2-only-entry.mjs?rev=lunaby-v2-r24',
  './text-list-v2-only-gate.mjs?rev=lunaby-v2-r24',
  './text-list.js?rev=lunaby-v2-r24',
  './lunaby-v2-store.mjs?rev=lunaby-v2-r24',
  './lunaby-v2-first-launch.mjs?rev=lunaby-v2-r24',
  './abyss-runtime-core.mjs?rev=lunaby-v2-r24',
  './starleap-lite-core.mjs?rev=lunaby-v2-r24',
  './starleap-state.mjs?rev=lunaby-v2-r24',
  './manifest.json?rev=lunaby-v2-r24',
  './lunaby-mascot-192.png',
  './lunaby-mascot-512.webp',
  './lunaby-mascot-maskable-512.webp'
];
const APP_PATH = new URL('./', self.location).pathname;
const INDEX_URL = new URL('./index.html', self.location).href;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      // 待機状態を残さず、ページの強制リロードは行わない。
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('lunaby-shell-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // SW自身はブラウザの更新確認に任せる。古いSWをキャッシュしない。
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate' && (url.pathname === APP_PATH || url.pathname === APP_PATH + 'index.html')) {
    event.respondWith(
      caches.match(INDEX_URL)
        .then(cached => cached || fetch(request))
    );
    return;
  }

  // 更新ページは常にネットワークから取得し、古い更新処理を再利用しない。
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (!response || !response.ok) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
          return response;
        });
      })
  );
});