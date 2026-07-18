// Service Worker - セッションデータ保持対応
const CACHE_NAME = 'pachinko-checker-v7';
const CACHE_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

// インストール時にキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_FILES).catch(() => {
        // ネットワーク無くても進める
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// 古いキャッシュの削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// フェッチ: ネットワークファースト、失敗時はキャッシュ
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 成功時はキャッシュに保存
        if (response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // ネットワーク失敗時はキャッシュ利用
        return caches.match(event.request)
          .then((cached) => cached || caches.match('./index.html'));
      })
  );
});
