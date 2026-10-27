const CACHE = 'mistletoe-marker-v14';
const SHARED = 'mistletoe-shared'; // holds a KML shared to the app (Android share target); kept across versions
const VIEWED = 'mistletoe-tiles-viewed'; // satellite tiles seen while browsing maps (runtime cache, capped, kept across versions)
const SAVED = 'mistletoe-tiles-saved';   // tiles pre-cached with "Save map area for offline" (written by the page, kept across versions)
const VIEWED_MAX = 2000, SAVED_MAX = 4000;
const ASSETS = ['./', './index.html', './style.css', './app.js', './kml.js', './geo.js', './find.js', './map.js', './extras.js', './config.js', './share.js', './manifest.json', './ads.json',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css', './img/helper.png',
  './img/ads/centris-logo.png', './img/ads/corteva-logo.jpg', './img/ads/example-1.svg', './img/ads/example-2.svg', './img/ads/example-3.svg',
  './icons/logo.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-192.png', './icons/maskable-512.png', './icons/favicon.svg', './icons/favicon-32.png',
  './img/bg-harvester.webp', './img/bg-orchard-sunset.webp', './img/bg-macadamia-grove.webp', './img/harvest-nuts.webp', './img/agronica-logo.svg'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARED && k !== VIEWED && k !== SAVED).map(k => caches.delete(k))))
    .then(() => trim(VIEWED, VIEWED_MAX)).then(() => self.clients.claim()));
});
// ---- satellite tiles: cache-first from the saved + viewed caches, else network (then cached, oldest evicted past the cap);
// offline with no cached tile -> a transparent 1x1 PNG so the map shows its dark background instead of broken images
const BLANK = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const isTile = url => /(^|\.)arcgisonline\.com$/.test(url.hostname) || /\/tile\/\d+\/\d+\/\d+(\.\w+)?$/.test(url.pathname) && url.origin !== location.origin;
async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
let tilePuts = 0;
async function tileFetch(req) {
  const key = req.url;
  const hit = (await caches.match(key, { cacheName: SAVED, ignoreVary: true })) || (await caches.match(key, { cacheName: VIEWED, ignoreVary: true }));
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== 'opaque') {
      const copy = res.clone();
      caches.open(VIEWED).then(c => c.put(key, copy)).then(() => { if (++tilePuts % 25 === 0) trim(VIEWED, VIEWED_MAX); });
    }
    return res;
  } catch (err) {
    return new Response(BLANK, { status: 200, headers: { 'Content-Type': 'image/png', 'X-Tile-Fallback': '1' } });
  }
}
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'trim-tiles') e.waitUntil(Promise.all([trim(VIEWED, VIEWED_MAX), trim(SAVED, SAVED_MAX)]).then(() => e.source && e.source.postMessage({ type: 'tiles-trimmed' })));
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
// App shell (html/js/css/manifest) is network-first (3 s timeout, then cache) so updates show up promptly yet it works offline;
// images/icons are cache-first.
const SHELL = /\.(html|js|css|json)$|\/$/;   // includes ads.json (network-first so ads can be swapped without a release)
function fromNetwork(req, url) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(reject, 3000);
    fetch(req, { cache: 'no-cache' }).then(res => {
      clearTimeout(t);
      if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      resolve(res);
    }, err => { clearTimeout(t); reject(err); });
  });
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;
  if (isTile(url)) {
    if (e.request.cache === 'force-cache') return;   // "Save map area" downloads go straight to the network; the page stores them itself
    e.respondWith(tileFetch(e.request));
    return;
  }
  const cached = () => caches.match(e.request, { ignoreSearch: true, cacheName: CACHE });
  if (url.origin === location.origin && SHELL.test(url.pathname)) {
    e.respondWith(fromNetwork(e.request, url).catch(() => cached().then(hit => hit || caches.match('./index.html', { cacheName: CACHE }))));
    return;
  }
  e.respondWith(cached().then(hit => hit ||
    fetch(e.request).then(res => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html', { cacheName: CACHE }))));
});
