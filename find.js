/* Find mode: guide the user to previously marked mistletoe from a loaded KML. */
(function () {
  'use strict';
  var KEY = 'agronica-mistletoe-find-v1';
  var $ = function (id) { return document.getElementById(id); };
  var TRACK_MAX = 5000;

  // ---------- persisted state ----------
  var F = load();
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.sessions)) {
        s.settings = Object.assign({ radius: 30, vibrate: true, beep: true, voice: false, mapMode: 'near' }, s.settings || {});
        s.settings.cats = Object.assign({}, s.settings.cats || {});
        return s;
      }
    } catch (e) { /* ignore */ }
    return { sessions: [], activeId: null, settings: { radius: 30, vibrate: true, beep: true, voice: false, mapMode: 'near', cats: {} } };
  }
  var saveT = 0;
  function save(force) {
    var now = Date.now();
    if (!force && now - saveT < 10000) return;
    saveT = now;
    try { localStorage.setItem(KEY, JSON.stringify(F)); }
    catch (e) { fmsg('Storage full - export found KML now!', 6000); }
  }
  function active() {
    for (var i = 0; i < F.sessions.length; i++) if (F.sessions[i].id === F.activeId) return F.sessions[i];
    return null;
  }

  // ---------- runtime ----------
  var tracking = false;
  var pos = null;                 // latest position {lat, lon, acc, ts}
  var compassHdg = null, compassTs = 0, compassOn = false;
  var moveHdg = null;             // heading from movement
  var alerted = {};               // point id -> highest level alerted
  var arrowRot = 0;
  var dirty = true, listAt = 0, rafId = 0;
  var lastMovePos = null;
  var settings = F.settings;

  var fmT;
  function fmsg(t, ms) {
    $('findMsg').textContent = t || '';
    clearTimeout(fmT);
    if (t) fmT = setTimeout(function () { $('findMsg').textContent = ''; }, ms || 5000);
  }
  // category filter: default all on; points without a category count as "mistletoe"
  var FCATS = KML.TYPES;
  function catOn(id) { return settings.cats[id || 'mistletoe'] !== false; }
  function vis(s) { return s ? s.points.filter(function (p) { return catOn(p.cat); }) : []; }
  function pointId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- loading KML ----------
  function loadKmlText(text, name) {
    var res;
    try { res = KML.parseKml(text); } catch (e) { fmsg('Could not read KML: ' + e.message, 7000); return false; }
    if (!res.marks.length) { fmsg('No points found in that KML' + (res.tracks.length ? ' (it only has lines)' : ''), 7000); return false; }
    var pts = res.marks.map(function (m, i) {
      return { id: pointId(), n: m.n || (i + 1), name: m.name || ((m.side || 'M') + '-' + (m.n || i + 1) + (m.cat ? ' ' + KML.catLabel(m.cat) : '')), side: m.side || '', cat: m.cat || '',
        lat: m.lat, lon: m.lon, ts: m.ts || 0, status: m.status || '', foundTs: m.foundTs || 0, sev: m.sev || '', variety: m.variety || '' };
    });
    var s = { id: 's' + Date.now().toString(36), name: (name || 'KML').replace(/\.(kml|xml)$/i, ''), created: Date.now(),
      points: pts, track: [] };
    F.sessions.push(s); F.activeId = s.id; alerted = {};
    save(true); renderAll();
    var nf = pts.filter(function (p) { return p.status; }).length;
    fmsg('Loaded ' + pts.length + ' points' + (nf ? ' (' + nf + ' already found)' : '') + ' from ' + s.name, 6000);
    window.App.toast('Loaded ' + pts.length + ' points');
    return true;
  }
  // ---------- current marking session (live, in memory) ----------
  var LIVE = 'live';
  function liveSession() { for (var i = 0; i < F.sessions.length; i++) if (F.sessions[i].id === LIVE) return F.sessions[i]; return null; }
  function markKey(m) { return m.id || ((m.side || 'L') + '|' + m.ts + '|' + m.lat.toFixed(6) + '|' + m.lon.toFixed(6)); }
  // rebuild the live session's points from App marks, keeping found/treated status. Returns true if anything changed.
  function syncLive(s) {
    var marks = (window.App && window.App.marks) ? window.App.marks() : [];
    var old = {}; s.points.forEach(function (p) { old[p.key] = p; });
    var changed = s.points.length !== marks.length;
    s.points = marks.map(function (m, i) {
      var k = markKey(m), o = old[k];
      if (!o || o.lat !== m.lat || o.lon !== m.lon || o.cat !== (m.cat || '')) changed = true;
      return { id: o ? o.id : 'lv-' + k, key: k, n: m.n || (i + 1), name: m.name || KML.markName(m), side: m.side || '', cat: m.cat || '',
        lat: m.lat, lon: m.lon, ts: m.ts || 0, status: o ? o.status : '', foundTs: o ? o.foundTs : 0, sev: m.sev || '', variety: m.variety || '' };
    });
    if (window.App && window.App.sessionName) s.name = window.App.sessionName();
    return changed;
  }
  function useCurrent() {
    var s = liveSession();
    if (!s) { s = { id: LIVE, live: true, name: 'Current marks', created: Date.now(), points: [], track: [] }; F.sessions.push(s); }
    syncLive(s);
    if (!s.points.length) { fmsg('No marks in the current session yet - mark some first', 6000); }
    F.activeId = LIVE; alerted = {}; save(true); renderAll();
    if (s.points.length) { fmsg('Using ' + s.points.length + ' current marks - new marks are added live', 6000); window.App.toast('Finding ' + s.points.length + ' current marks'); }
    return s;
  }
  var liveT = 0;
  function marksChanged() {
    var s = liveSession(); if (!s) return;
    clearTimeout(liveT);
    liveT = setTimeout(function () {
      if (!syncLive(s)) return;
      save(false); if (F.activeId === LIVE) { renderSessions(); renderCats(); listAt = 0; pump(true); }
    }, 50);
  }
  function readFile(f) {
    var r = new FileReader();
    r.onload = function () { loadKmlText(String(r.result), f.name); };
    r.onerror = function () { fmsg('Could not read file'); };
    r.readAsText(f);
  }

  // ---------- heading ----------
  function screenAngle() { return (screen.orientation && screen.orientation.angle) || window.orientation || 0; }
  function onOrient(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading + screenAngle();           // iOS: already clockwise from magnetic north
    } else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) {
      h = GEO.compassHeading(e.alpha, e.beta, e.gamma) + screenAngle();
    }
    if (h == null) return;
    compassHdg = GEO.smoothAngle(compassHdg, h, 0.25); compassTs = Date.now(); pump(false);
  }
  function enableCompass() {
    if (compassOn) return;
    var DOE = window.DeviceOrientationEvent;
    function attach() {
      if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient, true);
      else window.addEventListener('deviceorientation', onOrient, true);
      compassOn = true;
    }
    try {
      if (DOE && typeof DOE.requestPermission === 'function') {   // iOS 13+: must be called from a user gesture
        DOE.requestPermission().then(function (r) {
          if (r === 'granted') attach(); else fmsg('Compass permission denied - using movement direction', 7000);
        }).catch(function () { fmsg('Compass unavailable - using movement direction', 7000); });
      } else if (DOE) attach();
    } catch (e) { /* no compass */ }
  }
  function currentHeading() {
    if (compassHdg != null && Date.now() - compassTs < 3000) return { h: compassHdg, src: 'compass' };
    if (moveHdg != null) return { h: moveHdg, src: 'movement' };
    return { h: null, src: 'none' };
  }

  // ---------- audio / vibration / speech ----------
  var actx = null;
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* ignore */ }
  }
  function beep(freq, startS, durS, vol) {
    if (!actx) return;
    var t0 = actx.currentTime + startS, o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
    o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + durS + 0.02);
  }
  var PATTERNS = {
    1: { vib: [200], beeps: [[880, 0, 0.18]] },
    2: { vib: [150, 100, 150], beeps: [[1040, 0, 0.14], [1040, 0.22, 0.14]] },
    3: { vib: [400, 100, 400, 100, 400], beeps: [[1320, 0, 0.25], [1320, 0.33, 0.25], [1760, 0.66, 0.5]] }
  };
  function fireAlert(level, side, dist, cat) {
    var p = PATTERNS[level];
    if (settings.vibrate && navigator.vibrate) { try { navigator.vibrate(p.vib); } catch (e) {} }
    if (settings.beep) { unlockAudio(); p.beeps.forEach(function (b) { beep(b[0], b[1], b[2], 0.35); }); }
    if (settings.voice && 'speechSynthesis' in window) {
      try {
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(GEO.speechText(side, dist, level, cat ? KML.catLabel(cat) : ''));
        speechSynthesis.speak(u);
      } catch (e) { /* ignore */ }
    }
    var t = $('target'); t.classList.remove('a1', 'a2', 'a3'); void t.offsetWidth; t.classList.add('a' + level);
  }

  // ---------- position handling ----------
  function onPosition(p) {
    var prev = pos;
    pos = { lat: p.lat, lon: p.lon, acc: p.acc, ts: p.ts };
    var s = active();
    // movement heading
    if (p.heading != null && !isNaN(p.heading) && p.speed != null && p.speed > 0.7) {
      moveHdg = GEO.smoothAngle(moveHdg, p.heading, 0.5);
    } else if (!lastMovePos) lastMovePos = pos;
    else if (GEO.haversine(lastMovePos, pos) >= 3) {
      moveHdg = GEO.smoothAngle(moveHdg, GEO.bearing(lastMovePos, pos), 0.6); lastMovePos = pos;
    }
    if (tracking && s) {
      var last = s.track[s.track.length - 1];
      if (!last || GEO.haversine(last, pos) >= 2 || pos.ts - last.ts > 15000) {
        s.track.push({ lat: pos.lat, lon: pos.lon, ts: pos.ts });
        if (s.track.length > TRACK_MAX) s.track.splice(0, s.track.length - TRACK_MAX);
        save(false);
      }
      var a = GEO.nextAlert(vis(s), pos, settings.radius, alerted);
      if (a) { fireAlert(a.level, a.p.side, a.dist, a.p.cat); }
    }
    pump(false);
  }

  // ---------- found / treated ----------
  function setStatus(pt, status) {
    pt.status = status; pt.foundTs = status ? Date.now() : 0;
    if (status) delete alerted[pt.id];
    save(true); dirty = true; listAt = 0;
    if (status && navigator.vibrate && settings.vibrate) try { navigator.vibrate(60); } catch (e) {}
    pump(true);
  }
  function targetPoint() {
    var s = active(); if (!s) return null;
    var pts = vis(s);
    if (pos) return GEO.nearestUnfound(pts, pos);
    // no fix yet: first unfound point
    for (var i = 0; i < pts.length; i++) if (!pts[i].status) return { p: pts[i], dist: NaN, brg: NaN };
    return null;
  }

  // ---------- rendering ----------
  function pump(force) {
    dirty = true;
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; if (dirty) { dirty = false; renderLive(force); } });
  }
  function renderAll() { $('findLegend').innerHTML = KML.legendHtml('<span class="lg"><i class="sp circle" style="background:#cfcfcf"></i>Unknown</span><span class="lg"><i class="sp circle" style="background:#98b60055;box-shadow:inset 0 0 0 2px #98b603"></i>Found</span><span class="lg"><i class="sp circle" style="background:#98b603"></i>Treated</span><span class="lg"><i class="sp circle" style="background:#2d9cff;box-shadow:0 0 0 2px #fff"></i>You</span><span class="lg"><i class="sp ring"></i>Alert radius</span>'); renderSessions(); renderSettings(); renderCats(); pump(true); }
  function renderSessions() {
    var sel = $('sessSel'); sel.innerHTML = '';
    if (!F.sessions.length) { var o = document.createElement('option'); o.textContent = '(no sessions - load a KML)'; sel.appendChild(o); sel.disabled = true; return; }
    sel.disabled = false;
    F.sessions.forEach(function (s) {
      var o = document.createElement('option'); o.value = s.id;
      var nf = s.points.filter(function (p) { return p.status; }).length;
      o.textContent = s.name + ' (' + nf + '/' + s.points.length + ')'; if (s.id === F.activeId) o.selected = true; sel.appendChild(o);
    });
  }
  function renderSettings() {
    $('radius').value = settings.radius; $('radiusVal').textContent = settings.radius + ' m';
    var t = GEO.thresholds(settings.radius);
    $('radiusHint').textContent = 'Alerts at ' + Math.round(t.r1) + ' m, ' + (Math.round(t.r2 * 10) / 10) + ' m and arrived at ' + (Math.round(t.r3 * 10) / 10) + ' m';
    $('tgVib').checked = !!settings.vibrate; $('tgBeep').checked = !!settings.beep; $('tgVoice').checked = !!settings.voice;
    $('mapMode').textContent = settings.mapMode === 'all' ? 'Fit all' : 'Nearby';
  }
  function renderCats() {
    var box = $('catFilter'), s = active(); box.innerHTML = '';
    var present = {};
    if (s) s.points.forEach(function (p) { var k = p.cat || 'mistletoe'; present[k] = (present[k] || 0) + 1; });
    FCATS.forEach(function (c) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'fchip' + (catOn(c.id) ? ' on' : '');
      b.style.setProperty('--c', c.R); b.style.setProperty('--cl', c.L); b.style.setProperty('--cr', c.R); b.setAttribute('data-cat', c.id); b.setAttribute('aria-pressed', catOn(c.id));
      b.innerHTML = '<i class="sp ' + c.shape + '"></i><span></span><em></em>'; b.querySelector('span').textContent = c.label; b.querySelector('em').textContent = present[c.id] || 0;
      b.onclick = function () {
        settings.cats[c.id] = !catOn(c.id); alerted = {}; save(true); renderCats(); dirty = true; listAt = 0; pump(true);
      };
      box.appendChild(b);
    });
    var on = FCATS.filter(function (c) { return catOn(c.id); }).length;
    $('catHint').textContent = on === FCATS.length ? 'all categories' : on + ' of ' + FCATS.length + ' selected';
  }
  function setArrow(deg) {
    var d = GEO.diffAngle(arrowRot, deg); arrowRot += d;
    $('arrow').style.transform = 'rotate(' + arrowRot + 'deg)';
  }
  function renderLive(force) {
    var s = active();
    var tgt = $('target');
    var vp = vis(s);
    var total = vp.length;
    var found = vp.filter(function (p) { return p.status; }).length;
    var treated = vp.filter(function (p) { return p.status === 'treated'; }).length;
    $('progTxt').textContent = found + ' of ' + total + ' found';
    $('progSub').textContent = treated ? treated + ' treated' : '';
    $('progBar').style.width = total ? (100 * found / total) + '%' : '0%';
    var t = s ? targetPoint() : null;
    tgt.classList.toggle('empty', !s);
    tgt.classList.toggle('done', !!s && !t);
    tgt.classList.toggle('live', !!t);
    var hd = currentHeading();
    $('arrowN').style.opacity = hd.src === 'none' ? 1 : 0;
    if (t) {
      var p = t.p;
      $('tName').textContent = p.name;
      var tc = $('tCat'), cd = p.cat && KML.catById(p.cat);
      tc.textContent = cd ? cd.label : ''; tc.style.display = cd ? '' : 'none'; if (cd) tc.style.setProperty('--c', KML.typeColor(p.cat, p.side));
      var chip = $('tSide');
      var rel = (hd.h != null && !isNaN(t.brg)) ? GEO.diffAngle(hd.h, t.brg) : null;
      var side = p.side;
      if (!side && rel != null) side = rel >= 0 ? 'R' : 'L';
      chip.textContent = side === 'L' ? 'LEFT' : side === 'R' ? 'RIGHT' : '?';
      chip.className = 'chip ' + (side === 'L' ? 'L' : side === 'R' ? 'R' : 'U') + (p.side ? '' : ' rel');
      chip.title = p.side ? 'Side marked' : 'Foreign point - side relative to your heading';
      $('tDist').textContent = isNaN(t.dist) ? 'Waiting for GPS…' : GEO.fmtDist(t.dist);
      if (!isNaN(t.brg)) {
        setArrow(hd.h != null ? t.brg - hd.h : t.brg);
        $('tRel').textContent = hd.h != null ? GEO.relWord(rel) : 'bearing ' + Math.round(t.brg) + '°';
      } else $('tRel').textContent = tracking ? 'waiting for GPS' : 'press START TRACKING';
      $('tHead').textContent = hd.src === 'compass' ? 'compass heading' : hd.src === 'movement' ? 'direction of travel' : 'north up - walk or enable compass';
      $('tAcc').textContent = pos ? 'GPS ±' + Math.round(pos.acc) + ' m' + (pos.acc > 25 ? ' - weak fix' : '') : '';
      tgt.dataset.near = !isNaN(t.dist) ? GEO.alertLevel(t.dist, settings.radius) : 0;
      tgt.dataset.id = p.id;
    }
    drawMap();
    var now = Date.now();
    if (force || now - listAt > 2000) { listAt = now; renderList(); }
  }
  function renderList() {
    var ul = $('ptList'), s = active();
    ul.innerHTML = '';
    if (!s) { $('ptCount').textContent = ''; return; }
    var vpts = vis(s);
    var rows = pos ? GEO.withDistances(vpts, pos) : vpts.map(function (p) { return { p: p, dist: NaN, brg: NaN }; });
    rows.sort(function (a, b) {
      if (!!a.p.status !== !!b.p.status) return a.p.status ? 1 : -1;      // unfound first
      return pos ? a.dist - b.dist : (a.p.n - b.p.n);
    });
    $('ptCount').textContent = vpts.length + (vpts.length === s.points.length ? '' : ' of ' + s.points.length) + ' total';
    var hd = currentHeading();
    rows.slice(0, 300).forEach(function (r) {
      var li = document.createElement('li'); if (r.p.status) li.className = 'done';
      var chip = document.createElement('span'); chip.className = 'chip sm ' + (r.p.side || 'U'); chip.textContent = r.p.side || '?';
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.p.name;
      var sub = document.createElement('small');
      var rc = r.p.cat && KML.catById(r.p.cat);
      sub.textContent = (rc ? rc.label + (r.p.status ? ' · ' : '') : '') + (r.p.status ? r.p.status + (r.p.foundTs ? ' ' + KML.fmtLocal(r.p.foundTs).slice(11, 16) : '') : '');
      if (rc) { sub.style.color = rc.color; chip.style.background = KML.typeColor(r.p.cat, r.p.side); chip.style.color = r.p.side === 'L' ? '#fff' : '#222'; }
      nm.appendChild(sub);
      var d = document.createElement('span'); d.className = 'dst'; d.textContent = isNaN(r.dist) ? '' : GEO.fmtDist(r.dist);
      var b = document.createElement('button'); b.className = 'sq small ' + (r.p.status ? 'on' : '');
      b.setAttribute('aria-label', r.p.status ? 'Mark not found' : 'Mark found');
      b.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>';
      b.onclick = function () { setStatus(r.p, r.p.status ? '' : 'found'); renderSessions(); };
      li.appendChild(chip); li.appendChild(nm); li.appendChild(d); li.appendChild(b); ul.appendChild(li);
    });
    if (rows.length > 300) { var more = document.createElement('li'); more.className = 'more'; more.textContent = '+ ' + (rows.length - 300) + ' more'; ul.appendChild(more); }
  }

  // ---------- map (Leaflet + Esri World Imagery satellite tiles, see map.js) ----------
  var fmap = null;
  function drawMap() {
    var host = $('findMap'), s = active();
    if (!host.offsetWidth || !window.MMap || !window.L) return;
    if (!fmap) fmap = window.MMap.create(host, { find: true, onStatus: function (pt, status) { setStatus(pt, status); renderSessions(); } });
    var vpts = vis(s), t = pos && s ? GEO.nearestUnfound(vpts, pos) : null, hd = currentHeading();
    var fit = [];
    if (settings.mapMode === 'all' || !pos) { fit = vpts.slice(); if (pos) fit.push(pos); }
    else {
      fit.push(pos);
      GEO.withDistances(vpts.filter(function (p) { return !p.status; }), pos).slice(0, 4).forEach(function (n) { fit.push(n.p); });
      var m = Math.max(settings.radius * 1.3, 20);
      [0, 90, 180, 270].forEach(function (b) { fit.push(GEO.destination(pos, b, m)); });
    }
    fmap.update({
      marks: vpts, tracks: s && s.track.length > 1 ? [s.track] : [], target: t ? t.p.id : null, targetPoint: t ? t.p : null,
      pos: pos ? { lat: pos.lat, lon: pos.lon, acc: pos.acc } : null, heading: hd.h, radius: settings.radius, fitPoints: fit,
      fitKey: (s ? s.id : '') + '|' + settings.mapMode + '|' + (t ? t.p.id : '') + '|' + vpts.length + '|' + (pos ? 1 : 0)
    });
  }

  // ---------- export ----------
  function exportFound() {
    var s = active(); if (!s) { fmsg('Load a KML first'); return; }
    var kml = KML.buildFindKml(s, { name: s.name + ' - found ' + window.App.stamp() });
    var nf = s.points.filter(function (p) { return p.status; }).length;
    window.App.shareKml(kml, 'mistletoe-found-' + window.App.stamp() + '.kml', 'Mistletoe found status', nf + ' of ' + s.points.length + ' found (KML)');
  }

  // ---------- tracking ----------
  function startTracking() {
    // these must run synchronously inside the tap (iOS compass permission, audio unlock)
    enableCompass(); unlockAudio();
    if (!active()) { fmsg('Load a KML first'); return; }
    if (!window.App.gps.start('find')) return;
    tracking = true; lastMovePos = null;
    setBtn(true); pump(true);
    var l = window.App.gps.last(); if (l && Date.now() - l.ts < 15000) onPosition(l);
  }
  function stopTracking() { tracking = false; window.App.gps.stop('find'); setBtn(false); save(true); pump(true); }
  function setBtn(on) {
    var b = $('findStart'); b.className = on ? 'stop' : 'start';
    b.querySelector('span').textContent = on ? 'STOP TRACKING' : 'START TRACKING';
    b.querySelector('use').setAttribute('href', on ? '#i-stop' : '#i-play');
  }

  // ---------- wiring ----------
  window.App.gps.subscribe(function (p) { if (tracking || document.body.getAttribute('data-view') === 'find') onPosition(p); });
  $('findStart').onclick = function () { tracking ? stopTracking() : startTracking(); };
  $('useCurrent').onclick = function () { useCurrent(); };
  $('loadKml').onclick = function () { $('findFile').click(); };
  $('findFile').onchange = function (e) { var f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; };
  $('exportFound').onclick = exportFound;
  $('sessSel').onchange = function (e) { F.activeId = e.target.value; alerted = {}; save(true); renderAll(); };
  $('sessDel').onclick = function () {
    var s = active(); if (!s) return;
    if (!confirm('Delete session "' + s.name + '"? Export found KML first if needed.')) return;
    F.sessions = F.sessions.filter(function (x) { return x !== s; });
    F.activeId = F.sessions.length ? F.sessions[F.sessions.length - 1].id : null; alerted = {};
    save(true); renderAll();
  };
  $('btnFound').onclick = function () { var t = targetPoint(); if (t) { setStatus(t.p, 'found'); renderSessions(); } };
  $('btnTreated').onclick = function () { var t = targetPoint(); if (t) { setStatus(t.p, 'treated'); renderSessions(); } };
  $('radius').oninput = function (e) { settings.radius = +e.target.value; alerted = {}; save(false); renderSettings(); pump(true); };
  $('radius').onchange = function () { save(true); };
  ['Vib:vibrate', 'Beep:beep', 'Voice:voice'].forEach(function (x) {
    var p = x.split(':');
    $('tg' + p[0]).onchange = function (e) {
      settings[p[1]] = e.target.checked; save(true);
      if (e.target.checked) unlockAudio();
      if (p[1] === 'voice' && e.target.checked && !('speechSynthesis' in window)) fmsg('Speech not supported on this device', 5000);
    };
  });
  $('testAlert').onclick = function () {
    unlockAudio(); enableCompass();
    var s = active(), p0 = s && s.points[0], side = (p0 && p0.side) || 'L', cat = p0 && p0.cat;
    fireAlert(1, side, settings.radius, cat);
    setTimeout(function () { fireAlert(2, side, settings.radius / 2, cat); }, 1500);
    setTimeout(function () { fireAlert(3, side, 3, cat); }, 3200);
    fmsg('Test: radius, half-radius, arrived' + (navigator.vibrate ? '' : ' (vibration not supported on this device)'), 5000);
  };
  $('mapMode').onclick = function () { settings.mapMode = settings.mapMode === 'all' ? 'near' : 'all'; save(true); renderSettings(); pump(true); };
  window.addEventListener('resize', function () { pump(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') save(true); else pump(true); });
  window.addEventListener('pagehide', function () { save(true); });

  // drag & drop (desktop)
  ['dragover', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files[0]) { window.App.setView('find'); readFile(e.dataTransfer.files[0]); }
    });
  });
  // files opened with the installed app (Chromium file handlers)
  if ('launchQueue' in window && window.launchQueue.setConsumer) {
    window.launchQueue.setConsumer(function (params) {
      (params.files || []).forEach(function (h) { h.getFile().then(function (f) { window.App.setView('find'); readFile(f); }); });
    });
  }
  // files shared to the installed app (Android share target; stored by the service worker)
  function checkShared() {
    if (!/[?&]shared=1/.test(location.search) || !('caches' in window)) return;
    window.App.setView('find');
    caches.open('mistletoe-shared').then(function (c) {
      return c.match('shared-kml').then(function (r) {
        if (!r) { fmsg('No shared file found'); return; }
        var name = r.headers.get('X-Filename') || 'Shared KML';
        return r.text().then(function (t) { c.delete('shared-kml'); loadKmlText(t, decodeURIComponent(name)); });
      });
    }).catch(function () { fmsg('Could not open shared file'); });
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  }

  window.Find = { shown: function () { var s = liveSession(); if (s && syncLive(s)) { save(true); renderSessions(); renderCats(); } pump(true); }, useCurrent: useCurrent, marksChanged: marksChanged, _map: function () { return fmap; },
    _debug: function () { return { F: F, pos: pos, alerted: alerted }; } };
  (function () { var s = liveSession(); if (s) syncLive(s); })();
  renderAll();
  checkShared();
})();
