/* Satellite maps (Leaflet + Esri World Imagery) used by Find mode, the menu map and the About map.
   Leaflet is vendored (vendor/leaflet) - no CDN at runtime. Tiles are cached by the service worker (sw.js). */
(function (root) {
  'use strict';
  var BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var TILE_URL = BASE + 'World_Imagery/MapServer/tile/{z}/{y}/{x}';
  var LABEL_URL = BASE + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
  var ATTR = 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
  var MAX_NATIVE = 19, MAX_ZOOM = 20;
  var SAVE_LIMIT = 1500;          // max tiles fetched by one "Save map area for offline"
  var SAVED_CACHE = 'mistletoe-tiles-saved', SAVED_MAX = 4000, VIEWED_CACHE = 'mistletoe-tiles-viewed';
  var PREF_KEY = 'agronica-mistletoe-map-v1';
  var DEFAULT_VIEW = [-24.87, 152.35];   // Bundaberg district, used until there is data
  var LIME = '#98b603';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function prefs() { try { return JSON.parse(lsGet(PREF_KEY)) || {}; } catch (e) { return {}; } }
  function setPref(k, v) { var p = prefs(); p[k] = v; try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }
  // test hook: tile templates can be overridden (headless tests serve stub tiles from a local server)
  function imageryUrl() { return lsGet('mm-tile-url') || TILE_URL; }
  function labelsUrl() { return lsGet('mm-label-url') || LABEL_URL; }

  // ---------- tile maths (for "save area offline") ----------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function tileX(lon, z) { return clamp(Math.floor((lon + 180) / 360 * Math.pow(2, z)), 0, Math.pow(2, z) - 1); }
  function tileY(lat, z) {
    var r = clamp(lat, -85.0511, 85.0511) * Math.PI / 180;
    return clamp(Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)), 0, Math.pow(2, z) - 1);
  }
  function countAt(b, z) { return (tileX(b.e, z) - tileX(b.w, z) + 1) * (tileY(b.s, z) - tileY(b.n, z) + 1); }
  // bounds {n,s,e,w}, current zoom -> zoom range whose tile count (x layers) is within the limit
  function planSave(b, zoom, layers, limit) {
    limit = limit || SAVE_LIMIT; layers = layers || 1;
    var z0 = clamp(Math.floor(zoom), 8, MAX_NATIVE), z1 = z0, total = countAt(b, z0) * layers;
    for (var z = z0 + 1; z <= MAX_NATIVE; z++) {
      var add = countAt(b, z) * layers;
      if (total + add > limit) break;
      total += add; z1 = z;
    }
    return { z0: z0, z1: z1, count: total, capped: z1 < MAX_NATIVE, tooBig: total > limit };
  }
  function tileList(b, z0, z1) {
    var out = [];
    for (var z = z0; z <= z1; z++) {
      var x0 = tileX(b.w, z), x1 = tileX(b.e, z), y0 = tileY(b.n, z), y1 = tileY(b.s, z);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) out.push({ z: z, x: x, y: y });
    }
    return out;
  }
  function fillUrl(t, z, x, y) { return t.replace('{z}', z).replace('{y}', y).replace('{x}', x); }

  // ---------- marker icons ----------
  var SHAPES = {
    circle: function (a) { return '<circle cx="14" cy="14" r="8" ' + a + '/>'; },
    diamond: function (a) { return '<polygon points="14,3.5 24.5,14 14,24.5 3.5,14" ' + a + '/>'; },
    triangle: function (a) { return '<polygon points="14,3.8 24,21.5 4,21.5" ' + a + ' stroke-linejoin="round"/>'; },
    square: function (a) { return '<rect x="5.5" y="5.5" width="17" height="17" rx="2" ' + a + '/>'; }
  };
  function markIcon(m, isTarget) {
    var K = root.KML, cat = m.cat && K.catById(m.cat) ? m.cat : '';
    var shape = K.typeShape(cat), fill, stroke = '#fff', sw = 2.4, extra = '';
    if (m.status === 'treated') { fill = LIME; stroke = '#fff'; extra = '<path d="M9.5 14.3l3.2 3.2 6-6.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'; }
    else if (m.status) { fill = LIME + '66'; stroke = LIME; sw = 3; }
    else if (cat) fill = K.typeColor(cat, m.side);
    else fill = m.side === 'L' ? '#2d62ff' : m.side === 'R' ? '#ffb400' : '#cfcfcf';
    var sz = isTarget ? 38 : 30;
    var svg = '<svg viewBox="0 0 28 28" width="' + sz + '" height="' + sz + '" xmlns="http://www.w3.org/2000/svg">' +
      SHAPES[shape]('fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"') + extra + '</svg>';
    return L.divIcon({ className: 'mm-mark' + (isTarget ? ' target' : '') + (m.status ? ' done ' + m.status : ''), html: svg, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2], popupAnchor: [0, -sz / 2] });
  }
  function posIcon(heading) {
    var h = heading != null && !isNaN(heading);
    var svg = h
      ? '<svg viewBox="0 0 40 40" width="40" height="40"><g transform="rotate(' + Math.round(heading) + ' 20 20)"><path d="M20 3L31 31 20 25 9 31z" fill="#2d9cff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></g></svg>'
      : '<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="9" fill="#2d9cff" stroke="#fff" stroke-width="4"/></svg>';
    return L.divIcon({ className: 'mm-pos' + (h ? ' hd' : ''), html: svg, iconSize: [40, 40], iconAnchor: [20, 20] });
  }

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // ---------- map component ----------
  // opts: { find: bool, onStatus(raw, 'found'|'treated'|''), height, noSave, noFollow, legend }
  function create(host, opts) {
    opts = opts || {};
    var K = root.KML, G = root.GEO;
    host.classList.add('mmap');
    host.innerHTML = '';
    var bar = el('div', 'mapbar'), box = el('div', 'mapbox'), canvas = el('div', 'mapcanvas'), note = el('div', 'mapnote'), status = el('div', 'mapstatus');
    function btn(act, label) { var b = el('button', 'chip-btn', label); b.type = 'button'; b.setAttribute('data-act', act); bar.appendChild(b); return b; }
    var bFollow = opts.noFollow ? null : btn('follow', 'Follow me'), bFit = btn('fit', 'Fit'), bLabels = btn('labels', 'Labels'), bSave = opts.noSave ? null : btn('save', 'Save map area for offline');
    box.appendChild(canvas); box.appendChild(note);
    host.appendChild(bar); host.appendChild(box); host.appendChild(status);

    var map = null, tiles = null, labels = null, layers = {}, busy = false;
    var st = { follow: false, autoFit: true, labels: !!prefs().labels, key: null, sig: '', trackSig: '', data: null, tileErr: 0, tileErrAt: 0, saving: false };

    function build() {
      map = L.map(canvas, { zoomControl: true, attributionControl: true, maxZoom: MAX_ZOOM, minZoom: 3, zoomSnap: 0.5, tap: true });
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
      map.createPane('labels'); map.getPane('labels').style.zIndex = 250; map.getPane('labels').style.pointerEvents = 'none';
      tiles = L.tileLayer(imageryUrl(), { attribution: ATTR, maxZoom: MAX_ZOOM, maxNativeZoom: MAX_NATIVE, crossOrigin: true, className: 'mm-tiles', updateWhenIdle: false, keepBuffer: 2 });
      tiles.on('tileerror', function () { st.tileErr++; st.tileErrAt = Date.now(); refreshNote(); });
      // offline with no cached tile the service worker answers with a 1x1 transparent PNG (dark background shows through)
      tiles.on('tileload', function (e) {
        if (e.tile.naturalWidth < 2) { st.tileErr++; st.tileErrAt = Date.now(); refreshNote(); }
        else if (st.tileErr) { st.tileErr = 0; refreshNote(); }
      });
      tiles.addTo(map);
      labels = L.tileLayer(labelsUrl(), { pane: 'labels', attribution: ATTR, maxZoom: MAX_ZOOM, maxNativeZoom: MAX_NATIVE, crossOrigin: true });
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
      layers.tracksCase = L.layerGroup().addTo(map); layers.tracks = L.layerGroup().addTo(map);
      layers.marks = L.layerGroup().addTo(map); layers.over = L.layerGroup().addTo(map);
      map.setView(DEFAULT_VIEW, 11);
      map.on('dragstart', function () { if (!busy) { st.follow = false; st.autoFit = false; syncBtns(); } });
      map.on('zoomstart', function () { if (!busy) { st.autoFit = false; syncBtns(); } });
      setLabels(st.labels, true);
    }
    function programmatic(fn) { busy = true; try { fn(); } finally { busy = false; } }
    function setLabels(on, init) {
      st.labels = !!on; if (!init) setPref('labels', st.labels);
      if (map) { if (on && !map.hasLayer(labels)) labels.addTo(map); if (!on && map.hasLayer(labels)) map.removeLayer(labels); }
      syncBtns();
    }
    function syncBtns() {
      if (bFollow) { bFollow.classList.toggle('on', st.follow); bFollow.setAttribute('aria-pressed', st.follow); }
      bFit.classList.toggle('on', st.autoFit); bLabels.classList.toggle('on', st.labels); bLabels.setAttribute('aria-pressed', st.labels);
    }
    function refreshNote() {
      var off = typeof navigator !== 'undefined' && navigator.onLine === false;
      var blank = st.tileErr > 2 && Date.now() - st.tileErrAt < 8000;
      var msg = blank ? (off ? 'Offline - no saved satellite imagery for this area' : 'Satellite imagery not loading - check your connection / save the area when online') : off ? 'Offline - satellite imagery only where saved' : '';
      note.textContent = msg; note.style.display = msg ? 'block' : 'none';
    }
    window.addEventListener('online', refreshNote); window.addEventListener('offline', refreshNote);
    setInterval(refreshNote, 4000); refreshNote();

    // ----- popup -----
    function popup(m, d) {
      var raw = m.raw || m, d0 = d || {};
      var c = el('div', 'mm-pop');
      var cat = m.cat && K.catById(m.cat);
      var h = el('div', 'pp-h'); var sw = el('i', 'sp ' + K.typeShape(cat ? m.cat : '')); sw.style.background = K.typeColor(cat ? m.cat : '', m.side);
      h.appendChild(sw); h.appendChild(el('b', null, m.name || K.markName(m))); c.appendChild(h);
      var rows = [];
      if (cat) rows.push(['Type', cat.label]);
      rows.push(['Side', m.side === 'L' ? 'LEFT' : m.side === 'R' ? 'RIGHT' : 'unknown']);
      if (m.status) rows.push(['Status', m.status + (m.foundTs ? ' ' + K.fmtLocal(m.foundTs).slice(11, 16) : '')]);
      if (m.ts) rows.push(['Marked', K.fmtLocal(m.ts)]);
      rows.push(['Position', m.lat.toFixed(6) + ', ' + m.lon.toFixed(6)]);
      if (m.acc != null) rows.push(['GPS', '±' + Math.round(m.acc) + ' m']);
      if (m.imported) rows.push(['Source', 'imported']);
      if (st.data && st.data.pos) rows.push(['Distance', G.fmtDist(G.haversine(st.data.pos, m)) + ' away']);
      rows.forEach(function (r) { var p = el('div', 'pp-r'); p.appendChild(el('span', null, r[0])); p.appendChild(el('b', null, r[1])); c.appendChild(p); });
      if (opts.find && opts.onStatus) {
        var a = el('div', 'pp-a');
        [['found', 'FOUND'], ['treated', 'TREATED']].forEach(function (x) {
          var b = el('button', x[0] === 'found' ? 'found-btn' : 'treated-btn', m.status === x[0] ? 'UNDO ' + x[1] : x[1]); b.type = 'button'; b.setAttribute('data-status', x[0]);
          b.onclick = function () { map.closePopup(); opts.onStatus(raw, m.status === x[0] ? '' : x[0]); };
          a.appendChild(b);
        });
        c.appendChild(a);
      }
      return c;
    }

    // ----- drawing -----
    function markSig(d) {
      return (d.marks || []).map(function (m) { return [m.id || '', m.lat, m.lon, m.side, m.cat, m.status || '', d.target && d.target === (m.id || m) ? 1 : 0].join(','); }).join(';');
    }
    function drawMarks(d) {
      layers.marks.clearLayers();
      (d.marks || []).forEach(function (m) {
        var isT = d.target != null && (m.id ? d.target === m.id : false);
        var mk = L.marker([m.lat, m.lon], { icon: markIcon(m, isT), keyboard: false, zIndexOffset: isT ? 1000 : m.status ? -200 : 0, title: m.name || '' });
        mk.bindPopup(function () { return popup(m); }, { minWidth: 190, maxWidth: 260, autoPanPadding: [20, 20] });
        mk._mm = m; mk.addTo(layers.marks);
      });
    }
    function drawTracks(d) {
      layers.tracks.clearLayers(); layers.tracksCase.clearLayers();
      (d.tracks || []).forEach(function (t) {
        if (!t || t.length < 2) return;
        var ll = t.map(function (p) { return [p.lat, p.lon]; });
        L.polyline(ll, { color: '#000', weight: 6.5, opacity: 0.45, interactive: false, lineJoin: 'round' }).addTo(layers.tracksCase);
        L.polyline(ll, { color: LIME, weight: 3.5, opacity: 0.95, interactive: false, lineJoin: 'round' }).addTo(layers.tracks);
      });
    }
    var pm = null, acc = null, rad = null, tl = null;
    function drawPos(d) {
      var p = d.pos;
      if (!p) { layers.over.clearLayers(); pm = acc = rad = tl = null; st.posOn = false; return; }
      var ll = [p.lat, p.lon];
      if (!acc) {
        acc = L.circle(ll, { radius: p.acc || 5, color: '#2d9cff', weight: 1.5, fillColor: '#2d9cff', fillOpacity: 0.16, interactive: false }).addTo(layers.over);
        pm = L.marker(ll, { icon: posIcon(d.heading), interactive: false, keyboard: false, zIndexOffset: 2000 }).addTo(layers.over); pm._hd = d.heading;
      }
      acc.setLatLng(ll); acc.setRadius(Math.max(p.acc || 5, 1));
      pm.setLatLng(ll);
      var hk = d.heading == null ? null : Math.round(d.heading / 3);
      if (pm._hk !== hk) { pm.setIcon(posIcon(d.heading)); pm._hk = hk; }
      if (opts.find && d.radius) {
        if (!rad) rad = L.circle(ll, { radius: d.radius, color: '#ffb400', weight: 2.5, dashArray: '8 7', fillColor: '#ffb400', fillOpacity: 0.07, interactive: false }).addTo(layers.over);
        rad.setLatLng(ll); rad.setRadius(d.radius);
      } else if (rad) { layers.over.removeLayer(rad); rad = null; }
      var tp = d.targetPoint;
      if (tp && opts.find) {
        if (!tl) tl = L.polyline([ll, [tp.lat, tp.lon]], { color: '#fff', weight: 2, dashArray: '2 6', opacity: 0.9, interactive: false }).addTo(layers.over);
        tl.setLatLngs([ll, [tp.lat, tp.lon]]);
      } else if (tl) { layers.over.removeLayer(tl); tl = null; }
      st.posOn = true;
    }
    function fit(d, force) {
      var pts = (d.fitPoints || []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lon); });
      if (!pts.length) return;
      var b = L.latLngBounds(pts.map(function (p) { return [p.lat, p.lon]; }));
      programmatic(function () {
        if (!b.isValid()) return;
        var single = b.getSouthWest().equals(b.getNorthEast());
        if (single) map.setView(b.getCenter(), 18, { animate: false });
        else map.fitBounds(b, { padding: [28, 28], maxZoom: MAX_NATIVE, animate: false });
      });
    }
    function update(d) {
      if (!map) { if (!host.offsetWidth) return; build(); }
      invalidate();
      st.data = d;
      var sig = markSig(d) + '|' + (d.target || '');
      if (sig !== st.sig) { st.sig = sig; drawMarks(d); }
      var tsig = (d.tracks || []).map(function (t) { return t.length; }).join(',');
      if (tsig !== st.trackSig) { st.trackSig = tsig; drawTracks(d); }
      drawPos(d);
      var hasData = (d.fitPoints || []).length > 0;
      if (st.follow && d.pos) {
        programmatic(function () { if (map.getZoom() < 17) map.setView([d.pos.lat, d.pos.lon], 18, { animate: false }); else map.panTo([d.pos.lat, d.pos.lon], { animate: false }); });
      } else if (st.autoFit && hasData) {
        var inner = map.getBounds().pad(-0.12), out = d.pos && !inner.contains([d.pos.lat, d.pos.lon]);
        if (d.fitKey !== st.key || out || st.needFit) { fit(d); st.needFit = false; }
      }
      st.key = d.fitKey;
      if (!hasData && !d.pos && !st.empty) { st.empty = true; }
    }
    var lw = 0, lh = 0;
    function invalidate() {
      if (!map) return;
      var w = canvas.offsetWidth, h = canvas.offsetHeight;
      if (w && h && (w !== lw || h !== lh)) { lw = w; lh = h; map.invalidateSize(false); }
    }

    // ----- buttons -----
    bFit.onclick = function () { st.autoFit = true; st.follow = false; st.needFit = true; syncBtns(); if (st.data) update(st.data); };
    bLabels.onclick = function () { setLabels(!st.labels); };
    if (bFollow) bFollow.onclick = function () {
      st.follow = !st.follow; if (st.follow) { st.autoFit = false; } syncBtns();
      if (st.follow && !(st.data && st.data.pos)) { setStatus('Follow me needs a GPS fix - press START first'); st.follow = false; syncBtns(); }
      else if (st.data) update(st.data);
    };
    var stT;
    function setStatus(t, ms) { status.textContent = t || ''; clearTimeout(stT); if (t && ms !== 0) stT = setTimeout(function () { status.textContent = ''; }, ms || 7000); }
    function savedCount() {
      if (!('caches' in window)) return Promise.resolve(0);
      return caches.open(SAVED_CACHE).then(function (c) { return c.keys(); }).then(function (k) { return k.length; }).catch(function () { return 0; });
    }
    function showSaved() { savedCount().then(function (n) { if (n && !st.saving) setStatus(n + ' satellite tiles saved for offline', 0); }); }
    if (bSave) bSave.onclick = function () {
      if (st.saving || !map) return;
      if (!('caches' in window)) { setStatus('Offline saving is not supported on this browser'); return; }
      if (navigator.onLine === false) { setStatus('You are offline - connect to save map tiles'); return; }
      var bb = map.getBounds(), b = { n: bb.getNorth(), s: bb.getSouth(), e: bb.getEast(), w: bb.getWest() };
      var urls = [imageryUrl()]; if (st.labels) urls.push(labelsUrl());
      var plan = planSave(b, map.getZoom(), urls.length), list = tileList(b, plan.z0, plan.z1), jobs = [];
      list.forEach(function (t) { urls.forEach(function (u) { jobs.push(fillUrl(u, t.z, t.x, t.y)); }); });
      st.saving = true; bSave.disabled = true; var done = 0, fail = 0, total = jobs.length;
      setStatus('Saving ' + total + ' tiles (zoom ' + plan.z0 + '-' + plan.z1 + ')...', 0);
      var q = jobs.slice(), cachePromise = caches.open(SAVED_CACHE);
      function next(c) {
        var u = q.shift(); if (!u) return Promise.resolve();
        return c.match(u, { ignoreVary: true }).then(function (hit) {
          if (hit) return;
          return fetch(u, { mode: 'cors', cache: 'force-cache' }).then(function (r) { if (!r.ok) throw 0; return c.put(u, r); });
        }).catch(function () { fail++; }).then(function () { done++; if (done % 10 === 0) setStatus('Saving tiles ' + done + ' / ' + total + '...', 0); return next(c); });
      }
      cachePromise.then(function (c) { return Promise.all([1, 2, 3, 4, 5, 6].map(function () { return next(c); })).then(function () { return trimCache(c, SAVED_MAX); }); })
        .then(function () { return savedCount(); })
        .then(function (n) {
          st.saving = false; bSave.disabled = false;
          setStatus('Saved ' + (total - fail) + ' of ' + total + ' tiles (zoom ' + plan.z0 + '-' + plan.z1 + ')' + (fail ? ', ' + fail + ' failed' : '') +
            (plan.capped ? ' - zoom in closer and save again to also get zoom ' + (plan.z1 + 1) + '-' + MAX_NATIVE : '') + '. ' + n + ' tiles stored in total.', 15000);
          st._lastSave = { total: total, fail: fail, z0: plan.z0, z1: plan.z1 };
        }).catch(function () { st.saving = false; bSave.disabled = false; setStatus('Could not save tiles'); });
    };
    function trimCache(c, max) {
      return c.keys().then(function (k) { var extra = k.length - max; var ps = []; for (var i = 0; i < extra; i++) ps.push(c.delete(k[i])); return Promise.all(ps); });
    }
    syncBtns();

    return {
      update: update, invalidate: invalidate, host: host, showSaved: showSaved,
      getMap: function () { return map; },
      stats: function () {
        return { built: !!map, zoom: map ? map.getZoom() : null, marks: layers.marks ? layers.marks.getLayers().length : 0,
          tracks: layers.tracks ? layers.tracks.getLayers().length : 0, hasPos: !!pm, hasAccuracy: !!acc, accRadius: acc ? acc.getRadius() : null, radiusM: rad ? rad.getRadius() : null, posHeading: !!(pm && pm.getElement() && /hd/.test(pm.getElement().className)), hasRadius: !!rad, hasTargetLine: !!tl,
          labels: st.labels, follow: st.follow, autoFit: st.autoFit, saving: st.saving, lastSave: st._lastSave || null,
          tileCount: canvas.querySelectorAll('img.leaflet-tile').length, loadedTiles: canvas.querySelectorAll('img.leaflet-tile-loaded').length,
          tileSrc: (canvas.querySelector('img.leaflet-tile') || {}).src || '', labelsLayer: !!(map && map.hasLayer(labels)),
          attribution: (canvas.querySelector('.leaflet-control-attribution') || {}).textContent || '',
          center: map ? [map.getCenter().lat, map.getCenter().lng] : null,
          markers: layers.marks ? layers.marks.getLayers().map(function (l) { return { id: l._mm.id, html: l.getElement() && l.getElement().innerHTML, cls: l.getElement() && l.getElement().className }; }) : [] };
      }
    };
  }

  root.MMap = { create: create, TILE_URL: TILE_URL, LABEL_URL: LABEL_URL, ATTR: ATTR, MAX_NATIVE: MAX_NATIVE, SAVE_LIMIT: SAVE_LIMIT,
    SAVED_CACHE: SAVED_CACHE, VIEWED_CACHE: VIEWED_CACHE, planSave: planSave, tileList: tileList, countAt: countAt, tileX: tileX, tileY: tileY, fillUrl: fillUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MMap;
})(typeof self !== 'undefined' ? self : this);
