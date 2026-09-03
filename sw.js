// Service Worker：app shell 快取（cache-first），API 一律走網路
const CACHE = 'autobook-v1.29.0';
// 音節音檔獨立持久快取：檔案不變，cache-first；版本更新時不清除（不用重抓 25MB）
const SYL_CACHE = 'autobook-syl-1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/theme.js',
  './js/icons.js',
  './js/nav.js',
  './js/wait.js',
  './js/parent.js',
  './js/onboarding.js',
  './js/rescue.js',
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
  './icons/demo-cat.svg',
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
  // 只快取「型別對得上」的回應：captive portal 會對任何路徑回 200 的 HTML，
  // 不檢查的話 js/main.js 會被存成一頁登入網頁，之後離線就白畫面
  const wantsHtml = e.request.mode === 'navigate' || /\/$|\.html?$/.test(url.pathname);
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && e.request.method === 'GET') {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const isHtml = ct.includes('text/html');
        if (isHtml === wantsHtml) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
        }
      }
      return res;
    }).catch(() => caches.match(e.request)),
  );
});
