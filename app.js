(function () {
  'use strict';
  var KEY = 'agronica-mistletoe-session-v1';
  var $ = function (id) { return document.getElementById(id); };

  var state = load();       // persisted: marks, track, extraTracks
  var watchId = null, tickTimer = null, wakeLock = null;
  var lastPos = null;       // {lat, lon, acc, ts}
  var running = false;

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.marks) && Array.isArray(s.track)) {
        s.extraTracks = s.extraTracks || [];
        return s;
      }
    } catch (e) { /* ignore */ }
    return { marks: [], track: [], extraTracks: [], created: Date.now() };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { msg('Storage full! Export KML now.'); }
  }
  var msgT;
  function msg(t, ms) {
    $('msg').textContent = t || '';
    clearTimeout(msgT);
    if (t) msgT = setTimeout(function () { $('msg').textContent = ''; }, ms || 4000);
  }

  // ---------- shared GPS (used by Mark and Find modes) ----------
  var owners = {}, listeners = [], statusKind = 'off';
  function anyOwner() { return Object.keys(owners).length > 0; }
  function setStatus(txt, cls) {
    var s = $('status'); s.className = 'pill ' + cls; s.querySelector('b').textContent = txt; statusKind = cls;
  }
  function onPos(p) {
    lastPos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now(),
      heading: p.coords.heading, speed: p.coords.speed };
    $('lat').textContent = lastPos.lat.toFixed(6);
    $('lon').textContent = lastPos.lon.toFixed(6);
    $('acc').textContent = '±' + Math.round(lastPos.acc) + ' m';
    setStatus('GPS OK', 'on');
    listeners.forEach(function (fn) { try { fn(lastPos); } catch (e) { console.error(e); } });
  }
  function onErr(e) {
    var m = { 1: 'Location permission denied', 2: 'Position unavailable', 3: 'GPS timeout' }[e.code] || e.message;
    msg(m + (location.protocol === 'http:' && location.hostname !== 'localhost' ? ' (GPS needs HTTPS)' : ''), 6000);
    if (anyOwner()) setStatus('NO FIX', 'wait');
  }
  function gpsStart(owner) {
    if (!('geolocation' in navigator)) { msg('Geolocation not supported'); return false; }
    var had = anyOwner();
    owners[owner] = true;
    if (!had) {
      setStatus('WAITING GPS', 'wait');
      watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
      requestWake();
    }
    return true;
  }
  function gpsStop(owner) {
    delete owners[owner];
    if (!anyOwner()) {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null; releaseWake(); setStatus('STOPPED', 'off');
    }
  }
  function tick() {
    if (!lastPos) return;
    if (Date.now() - lastPos.ts > 15000) return; // stale fix: skip
    state.track.push({ lat: lastPos.lat, lon: lastPos.lon, acc: lastPos.acc, ts: Date.now() });
    save();
    render();
  }
  function start() {
    if (!gpsStart('mark')) return;
    running = true;
    tickTimer = setInterval(tick, 2000);
    setStartBtn(true);
    render();
  }
  function stop() {
    running = false;
    clearInterval(tickTimer); tickTimer = null;
    gpsStop('mark');
    setStartBtn(false);
    render();
  }
  function setStartBtn(on) {
    var b = $('startStop');
    b.className = on ? 'stop' : 'start';
    b.querySelector('span').textContent = on ? 'STOP' : 'START';
    b.querySelector('use').setAttribute('href', on ? '#i-stop' : '#i-play');
  }

  // ---------- wake lock ----------
  function requestWake() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l;
      l.addEventListener('release', function () { if (wakeLock === l) wakeLock = null; });
    }).catch(function () { /* not allowed – ignore */ });
  }
  function releaseWake() { if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && anyOwner() && !wakeLock) requestWake();
  });

  // ---------- tabs ----------
  function setView(v) {
    document.body.setAttribute('data-view', v);
    $('viewMark').classList.toggle('active', v === 'mark');
    $('viewFind').classList.toggle('active', v === 'find');
    [['tabMark', 'mark'], ['tabFind', 'find']].forEach(function (t) {
      var b = $(t[0]); b.classList.toggle('active', t[1] === v); b.setAttribute('aria-selected', t[1] === v);
    });
    try { localStorage.setItem('agronica-mistletoe-view', v); } catch (e) {}
    if (window.Find && v === 'find') window.Find.shown();
  }
  var toastT;
  function toast(t, ms) {
    var e = $('toast'); e.textContent = t; e.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { e.classList.remove('show'); }, ms || 3500);
  }

  // ---------- marks ----------
  function nextN() { return state.marks.reduce(function (mx, m) { return Math.max(mx, m.n || 0); }, 0) + 1; }
  function addMark(side) {
    if (!running) { msg('Press START first'); return; }
    if (!lastPos || Date.now() - lastPos.ts > 30000) { msg('No GPS fix yet – mark not recorded', 5000); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); return; }
    var m = { side: side, n: nextN(), lat: lastPos.lat, lon: lastPos.lon, acc: lastPos.acc, ts: Date.now() };
    m.name = KML.markName(m);
    state.marks.push(m);
    save();
    if (navigator.vibrate) navigator.vibrate(side === 'L' ? 80 : [60, 40, 60]);
    flash(side, m.name);
    render();
  }
  var flashT;
  function flash(side, txt) {
    var f = $('flash'); f.className = 'show ' + side; f.textContent = txt;
    clearTimeout(flashT);
    flashT = setTimeout(function () { f.className = side; f.textContent = txt; f.style.opacity = ''; f.classList.remove('show'); }, 250);
  }
  function undo() {
    if (!state.marks.length) { msg('Nothing to undo'); return; }
    // undo the most recently recorded mark
    var idx = state.marks.length - 1;
    var m = state.marks.splice(idx, 1)[0];
    save(); render();
    msg('Removed ' + KML.markName(m));
    if (navigator.vibrate) navigator.vibrate(30);
  }

  // ---------- rendering ----------
  function render() {
    var L = state.marks.filter(function (m) { return m.side === 'L'; }).length;
    var R = state.marks.length - L;
    $('npts').textContent = state.track.length;
    $('nmarks').textContent = state.marks.length + ' (L' + L + ' / R' + R + ')';
    var lastL, lastR;
    state.marks.forEach(function (m) { if (m.side === 'L') lastL = m; else lastR = m; });
    $('lastL').textContent = lastL ? 'last: ' + KML.markName(lastL) : '';
    $('lastR').textContent = lastR ? 'last: ' + KML.markName(lastR) : '';
    if (!$('sheet').classList.contains('hidden')) renderList();
  }
  function renderList() {
    var ul = $('list'); ul.innerHTML = '';
    var sorted = state.marks.map(function (m, i) { return { m: m, i: i }; })
      .sort(function (a, b) { return (b.m.ts || 0) - (a.m.ts || 0); });
    $('listCount').textContent = state.marks.length + ' total';
    sorted.forEach(function (o) {
      var m = o.m, li = document.createElement('li');
      var tag = document.createElement('span'); tag.className = 'tag ' + m.side; tag.textContent = KML.markName(m);
      var meta = document.createElement('span'); meta.className = 'meta';
      meta.textContent = (m.ts ? KML.fmtLocal(m.ts) : 'no time') + ' · ' + m.lat.toFixed(6) + ', ' + m.lon.toFixed(6) +
        (m.acc != null ? ' · ±' + Math.round(m.acc) + 'm' : '') + (m.imported ? ' · imported' : '');
      var del = document.createElement('button'); del.className = 'del'; del.textContent = 'Delete';
      del.onclick = function () {
        if (confirm('Delete ' + KML.markName(m) + '?')) { state.marks.splice(o.i, 1); save(); render(); }
      };
      li.appendChild(tag); li.appendChild(meta); li.appendChild(del); ul.appendChild(li);
    });
    drawPlot();
  }
  function drawPlot() {
    var c = $('plot'), g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    var tracks = [state.track].concat(state.extraTracks.map(function (t) { return t.pts; }));
    var pts = [];
    tracks.forEach(function (t) { pts = pts.concat(t); });
    pts = pts.concat(state.marks);
    if (!pts.length) { g.fillStyle = '#fff8'; g.font = '20px sans-serif'; g.fillText('No data yet', 20, 40); return; }
    var minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
    pts.forEach(function (p) {
      minLa = Math.min(minLa, p.lat); maxLa = Math.max(maxLa, p.lat);
      minLo = Math.min(minLo, p.lon); maxLo = Math.max(maxLo, p.lon);
    });
    var midLa = (minLa + maxLa) / 2, kx = Math.cos(midLa * Math.PI / 180);
    var w = Math.max((maxLo - minLo) * kx, 1e-6), h = Math.max(maxLa - minLa, 1e-6), pad = 20;
    var sc = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
    var ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
    function X(lon) { return ox + (lon - minLo) * kx * sc; }
    function Y(lat) { return H - (oy + (lat - minLa) * sc); }
    g.lineWidth = 2; g.strokeStyle = '#98b603';
    tracks.forEach(function (t) {
      if (t.length < 2) return;
      g.beginPath(); t.forEach(function (p, i) { i ? g.lineTo(X(p.lon), Y(p.lat)) : g.moveTo(X(p.lon), Y(p.lat)); }); g.stroke();
    });
    state.marks.forEach(function (m) {
      g.fillStyle = m.side === 'L' ? '#2d62ff' : '#ffb400'; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(X(m.lon), Y(m.lat), 7, 0, 7); g.fill(); g.stroke();
    });
  }

  // ---------- export / import ----------
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  var KML_TYPE = 'application/vnd.google-earth.kml+xml';
  function shareKml(kml, fname, title, text) {
    var file;
    try { file = new File([kml], fname, { type: KML_TYPE }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: title, text: text })
        .catch(function (e) { if (e && e.name !== 'AbortError') download(kml, fname, KML_TYPE); });
    } else {
      download(kml, fname, KML_TYPE);
    }
  }
  function exportKml() {
    if (!state.marks.length && !state.track.length) { msg('Nothing to export yet'); return; }
    shareKml(KML.buildKml(state, { name: 'Mistletoe ' + stamp() }), 'mistletoe-' + stamp() + '.kml',
      'Mistletoe marks', state.marks.length + ' mistletoe marks (KML)');
  }
  function download(text, fname, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = document.createElement('a'); a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    msg('Downloaded ' + fname, 6000); toast('Downloaded ' + fname);
  }
  function key(m) { return (m.side || 'L') + '|' + m.ts + '|' + m.lat.toFixed(6) + '|' + m.lon.toFixed(6); }
  function importKml(text) {
    var res;
    try { res = KML.parseKml(text); } catch (e) { msg('Could not read KML: ' + e.message, 6000); return; }
    var have = {}; state.marks.forEach(function (m) { have[key(m)] = 1; });
    var added = 0;
    res.marks.forEach(function (m) {
      if (have[key(m)]) return;
      have[key(m)] = 1; m.side = m.side || 'L'; delete m.status; delete m.foundTs; m.name = m.name || KML.markName(m); state.marks.push(m); added++;
    });
    var tAdded = 0;
    res.tracks.forEach(function (t) {
      var sig = t.pts.length + '|' + t.pts[0].lat + '|' + t.pts[0].lon;
      var dup = state.extraTracks.some(function (x) { return x.sig === sig; });
      if (!dup) { t.sig = sig; state.extraTracks.push(t); tAdded++; }
    });
    state.marks.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    save(); render();
    msg('Imported ' + added + ' new marks (' + (res.marks.length - added) + ' duplicates skipped), ' + tAdded + ' tracks', 7000);
  }

  // ---------- wiring ----------
  $('startStop').onclick = function () { running ? stop() : start(); };
  $('btnL').onclick = function () { addMark('L'); };
  $('btnR').onclick = function () { addMark('R'); };
  $('undo').onclick = undo;
  $('menuBtn').onclick = function () { $('sheet').classList.remove('hidden'); renderList(); };
  $('closeSheet').onclick = function () { $('sheet').classList.add('hidden'); };
  $('exportBtn').onclick = exportKml;
  $('importBtn').onclick = function () { $('importFile').click(); };
  $('importFile').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader(); r.onload = function () { importKml(String(r.result)); };
    r.readAsText(f); e.target.value = '';
  };
  $('clearBtn').onclick = function () {
    if (confirm('Delete ALL marks and track? Export KML first!') && confirm('Really clear everything?')) {
      state = { marks: [], track: [], extraTracks: [], created: Date.now() }; save(); render();
    }
  };

  $('tabMark').onclick = function () { setView('mark'); };
  $('tabFind').onclick = function () { setView('find'); };
  var sw = null;
  try { sw = localStorage.getItem('agronica-mistletoe-view'); } catch (e) {}
  window.App = { gps: { start: gpsStart, stop: gpsStop, subscribe: function (fn) { listeners.push(fn); },
      last: function () { return lastPos; }, status: function () { return statusKind; } },
    shareKml: shareKml, download: download, toast: toast, setView: setView, stamp: stamp };

  if (!window.isSecureContext && location.hostname !== 'localhost') msg('GPS requires HTTPS – open the https:// address', 10000);
  render();
  if (sw === 'find') setView('find');
  if ('serviceWorker' in navigator) {
    var hadCtl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadCtl) toast('App updated - reload to use the new version', 8000);
    });
  }
})();
