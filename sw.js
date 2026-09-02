const CACHE_NAME = 'lunaby-static-v1';
const APP_PATH = new URL('./', self.location).pathname;
const INDEX_URL = new URL('./index.html', self.location).href;

self.addEventListener('install', event => {
  event.waitUntil(
    // 初回インストールで大量の先読みをせず、必要な静的ファイルだけ
    // fetch時にキャッシュする。待機状態は残さない。
    self.skipWaiting()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => (key.startsWith('lunaby-shell-') || key.startsWith('lunaby-static-')) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url, request) {
  if (url.pathname.startsWith(APP_PATH) === false) return false;
  if (request.destination === 'script' || request.destination === 'style' || request.destination === 'image') return true;
  return /\.(?:js|mjs|css|json|png|webp|svg|ico|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // SW自身はブラウザの更新確認に任せ、キャッシュしない。
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate' && url.pathname.endsWith('/update.html')) {
    // 更新入口だけは常に通信する。
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    // 通常起動は保存済みHTMLを優先し、初回や未保存時だけ通信する。
    event.respondWith(
      caches.match(request)
        .then(cached => cached || caches.match(INDEX_URL))
        .then(cached => cached || fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(INDEX_URL, copy)).catch(() => {});
          }
          return response;
        }))
    );
    return;
  }

  if (!isStaticAsset(url, request)) return;

  // 静的ファイルは復帰を優先。index.html側の?rev=変更で新URLを使う。
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        });
      })
  );
});