// DexDiffusion service worker: caches ONLY static application assets so the shell can start.
// It never touches /api/* (prompts, jobs, images, tokens), non-GET requests or cross-origin requests,
// so no private data is ever stored by the worker. Generation still needs the compute machine; see pwa.js for the offline notice.
const CACHE = 'dexdiffusion-static-v1';
const STATIC = /\.(?:js|css|png|jpg|jpeg|svg|webmanifest|woff2?)$/i;
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (!STATIC.test(url.pathname)) return;           // HTML and everything else: straight to the network
  e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; }).catch(() => caches.match(req)));
});
