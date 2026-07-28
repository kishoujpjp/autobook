// Service Worker：app shell 快取（cache-first），API 一律走網路
const CACHE = 'autobook-v1.13.1';
// 音節音檔獨立持久快取：檔案不變，cache-first；版本更新時不清除（不用重抓 25MB）
const SYL_CACHE = 'autobook-syl-1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/main.js',
  './js/i18n.js',
  './js/store.js',
  './js/sfx.js',
  './js/gemini.js',
  './js/zhconv.js',
  './js/wordbank.js',
  './js/flash.js',
  './js/avatars.js',
  './js/account.js',
  './js/repeat.js',
  './js/phonemes.js',
  './js/ui.js',
  './js/fog.js',
  './js/voice.js',
  './js/readings.js',
  './js/story.js',
  './js/game.js',
  './js/words.js',
  './js/settings.js',
  './manifest.webmanifest',
  './icons/icon2-192.png',
  './icons/icon2-512.png',
  './icons/icon2-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SYL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// network-first：線上永遠拿最新檔（cache:'no-cache' 強制向伺服器驗證，
// 避免瀏覽器 HTTP 快取回舊檔），離線時退回 SW 快取
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API 請求不快取
  if (url.origin !== location.origin) return;
  // 音節音檔：cache-first（檔案內容不變，抓過就不再連網）
  if (url.pathname.includes('/syl/')) {
    e.respondWith(
      caches.open(SYL_CACHE).then((c) =>
        c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        }))),
    );
    return;
  }
  const req = e.request.mode === 'navigate'
    ? new Request(e.request.url, { cache: 'no-cache' })
    : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request)),
  );
});
