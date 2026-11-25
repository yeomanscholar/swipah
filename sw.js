// Service worker: makes Swipah installable and usable offline.
// Network-first for the app's own files (always fresh when online), with a
// cache fallback when offline. User files are never cached: they're read
// straight from the folder and never pass through here.

const CACHE = 'swipah-v0.1.0';
const SHELL = [
  './',
  'index.html',
  'test.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/config.js',
  'js/naming.js',
  'js/filetypes.js',
  'js/store.js',
  'js/settings.js',
  'js/log.js',
  'js/session.js',
  'js/gestures.js',
  'js/card.js',
  'js/toasts.js',
  'js/demo.js',
  'js/export.js',
  'js/zip.js',
  'js/test-page.js',
  'js/adapters/fs-access.js',
  'js/adapters/memory.js',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
