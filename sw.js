const CACHE = 'mistletoe-marker-v6';
const SHARED = 'mistletoe-shared'; // holds a KML shared to the app (Android share target); kept across versions
const ASSETS = ['./', './index.html', './style.css', './app.js', './kml.js', './geo.js', './find.js', './manifest.json',
  './icons/logo.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-192.png', './icons/maskable-512.png', './icons/favicon.svg', './icons/favicon-32.png',
  './img/bg-harvester.webp', './img/bg-orchard-sunset.webp', './img/bg-macadamia-grove.webp', './img/harvest-nuts.webp', './img/agronica-logo.svg'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARED).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
async function handleShare(req) {
  try {
    const fd = await req.formData();
    const files = fd.getAll('kml').filter(f => f && typeof f !== 'string');
    if (files.length) {
      const f = files[0];
      const c = await caches.open(SHARED);
      await c.put('shared-kml', new Response(await f.text(), { headers: { 'X-Filename': encodeURIComponent(f.name || 'Shared KML') } }));
    }
  } catch (err) { /* fall through to the app anyway */ }
  return Response.redirect(self.registration.scope + '?shared=1', 303);
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true, cacheName: CACHE }).then(hit => hit ||
    fetch(e.request).then(res => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html', { cacheName: CACHE }))));
});
