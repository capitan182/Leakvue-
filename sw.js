/* Leakvue service worker: lets the app open with no signal (basements, crawl spaces, rural sites).
   Serves the cached copy right away and refreshes it in the background. Bump VERSION when you
   deploy so old caches are cleared. Job data is in IndexedDB and is never touched here. */
const VERSION = 'leakvue-v1';
const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/util.js',
  'js/catalog.js',
  'js/db.js',
  'js/form.js',
  'js/photos.js',
  'js/signature.js',
  'js/views/jobs.js',
  'js/views/job.js',
  'js/views/report.js',
  'js/views/settings.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = req.mode === 'navigate' ? 'index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
