const CACHE_NAME = 'lunaby-static-v1';
const STAGING_CACHE_NAME = 'lunaby-static-staging-v1';
const SHELL = [
  './index.html',
  './text-list.css?rev=lunaby-v2-r27',
  './text-list-v2-only-entry.mjs?rev=lunaby-v2-r27',
  './text-list-v2-only-gate.mjs?rev=lunaby-v2-r27',
  './text-list.js?rev=lunaby-v2-r27',
  './lunaby-v2-store.mjs?rev=lunaby-v2-r27',
  './lunaby-v2-first-launch.mjs?rev=lunaby-v2-r27',
  './abyss-runtime-core.mjs?rev=lunaby-v2-r27',
  './starleap-lite-core.mjs?rev=lunaby-v2-r27',
  './starleap-state.mjs?rev=lunaby-v2-r27',
  './manifest.json?rev=lunaby-v2-r27',
  './lunaby-mascot-192.png',
  './lunaby-mascot-512.webp',
  './lunaby-mascot-maskable-512.webp'
];
const APP_PATH = new URL('./', self.location).pathname;
const INDEX_URL = new URL('./index.html', self.location).href;

self.addEventListener('install', event => {
  event.waitUntil(
    // 通常起動時の通信を発生させない。初回の完全取得はLUNABYから行う。
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

async function repairShell() {
  await caches.delete(STAGING_CACHE_NAME);
  const staging = await caches.open(STAGING_CACHE_NAME);
  try {
    for (const resource of SHELL) {
      const request = new Request(new URL(resource, self.location).href, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const response = await fetch(request);
      if (!response || !response.ok) throw new Error('shell fetch failed');
      await staging.put(request, response);
    }

    // 全ファイル取得後にだけ本キャッシュへ反映する。
    const current = await caches.open(CACHE_NAME);
    const entries = await staging.keys();
    for (const request of entries) {
      const response = await staging.match(request);
      if (response) await current.put(request, response);
    }
    await caches.delete(STAGING_CACHE_NAME);
    return { ok:true, count:entries.length };
  } catch (error) {
    await caches.delete(STAGING_CACHE_NAME);
    throw error;
  }
}

function offlineMiss(request) {
  if (request.mode === 'navigate') {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>オフライン</title><main style="padding:2rem;font-family:system-ui,sans-serif"><h1>オフライン起動準備中</h1><p>必要なファイルがまだ保存されていません。通信できる状態でLUNABYを開いて修復してください。</p></main>',
      { status:503, headers:{ 'Content-Type':'text/html; charset=utf-8' } }
    );
  }
  return new Response('', { status:504, statusText:'Offline cache miss' });
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
    // 通常起動はキャッシュだけを使い、キャッシュミスでも通信しない。
    event.respondWith(
      caches.match(request)
        .then(cached => cached || caches.match(INDEX_URL))
        .then(cached => cached || offlineMiss(request))
    );
    return;
  }

  // 同一オリジンの通常リクエストもキャッシュだけを使う。
  event.respondWith(
    caches.match(request)
      .then(cached => cached || offlineMiss(request))
  );
});

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'REPAIR_SHELL') return;
  const port = event.ports && event.ports[0];
  event.waitUntil(
    repairShell()
      .then(result => { if (port) port.postMessage(result); })
      .catch(() => { if (port) port.postMessage({ ok:false }); })
  );
});