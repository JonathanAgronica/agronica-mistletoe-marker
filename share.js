/* Opt-in research data sharing: consent, local queue, batched upload with retry/backoff, access request,
   plus the welcome / "Research & data sharing" screen and the severity chips. Works in browser and node (core only). */
(function (root) {
  'use strict';
  var SKEY = 'agronica-mistletoe-share-v1', QKEY = 'agronica-mistletoe-queue-v1';
  var CATMAP = { '': 'mistletoe', irrigation: 'broken-irrigation', phytophthora: 'phytophthora', nutrition: 'nutrition' };
  var VARIETIES = ['A4', 'A16', 'A38', '741', '344', '246', '816', '842', '660', 'Other'];
  var SEVS = ['light', 'moderate', 'heavy'];
  var SETTLE_MS = 5000, MARK_BATCH = 200, TRACK_BATCH = 1000, TRACK_CAP = 5000, SENT_CAP = 5000, TRACK_MIN_M = 15;

  function iso(ts) { return new Date(ts).toISOString(); }
  function distM(a, b) {
    var R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function backoffMs(fails) { return Math.min(15000 * Math.pow(2, Math.max(0, fails - 1)), 3600000); }
  function effVariety(sel, other) { return sel === 'Other' ? ((other || '').trim() || 'Other') : (sel || ''); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim()); }
  function randHex(n) {
    var a = [], i;
    try { var u = new Uint8Array(n); (root.crypto || require('crypto').webcrypto).getRandomValues(u); for (i = 0; i < n; i++) a.push(('0' + u[i].toString(16)).slice(-2)); }
    catch (e) { for (i = 0; i < n; i++) a.push(('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2)); }
    return a.join('');
  }
  function newId() { return Date.now().toString(36) + randHex(4); }

  function createCore(env) {
    var cfg = env.cfg, store = env.storage;
    var now = env.now || Date.now;
    var online = env.online || function () { return true; };
    var schedule = env.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    var unschedule = env.unschedule || function (t) { clearTimeout(t); };
    var onChange = env.onChange || function () {};
    var timer = null, busy = null;

    function read(k, d) { try { var v = JSON.parse(store.getItem(k)); return v && typeof v === 'object' ? v : d; } catch (e) { return d; } }
    function write(k, v) { try { store.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full: queue stays in memory */ } }
    var S = Object.assign({ asked: false, optIn: false, deviceId: '', name: '', email: '', farm: '', district: '', variety: '', varietyOther: '',
      lastSync: 0, lastError: '', fails: 0, optInAt: 0 }, read(SKEY, {}));
    var Q = Object.assign({ marks: [], track: [], sent: [], access: [], lastTrack: null }, read(QKEY, {}));
    function saveS() { write(SKEY, S); onChange(); }
    function saveQ() { write(QKEY, Q); onChange(); }

    function deviceId() { if (!S.deviceId) { S.deviceId = 'mm-' + randHex(12); saveS(); } return S.deviceId; }
    function settings() { return Object.assign({}, S); }
    function setProfile(p) {
      ['name', 'email', 'farm', 'district', 'variety', 'varietyOther'].forEach(function (k) { if (p && p[k] != null) S[k] = String(p[k]).trim(); });
      saveS();
    }
    function markAsked() { S.asked = true; saveS(); }
    function setOptIn(on) {
      on = !!on;
      if (on && !S.optIn) { deviceId(); S.optIn = true; S.optInAt = now(); S.fails = 0; S.lastError = ''; saveS(); }
      else if (!on && S.optIn) {
        S.optIn = false; S.fails = 0; S.lastError = ''; saveS();
        Q.marks = []; Q.track = []; Q.access = []; Q.sent = []; Q.lastTrack = null; saveQ();
        if (timer) { unschedule(timer); timer = null; }
      }
    }
    function defaultVariety() { return effVariety(S.variety, S.varietyOther); }

    // ---- queue ----
    function isSent(id) { return Q.sent.indexOf(id) >= 0; }
    function findMark(id) { for (var i = 0; i < Q.marks.length; i++) if (Q.marks[i].id === id) return Q.marks[i]; return null; }
    function entryFor(m, sid) {
      var e = { id: m.id, lat: m.lat, lon: m.lon, accuracy: m.acc == null ? null : m.acc, side: m.side === 'L' ? 'L' : 'R',
        category: CATMAP[m.cat || ''] || 'mistletoe', time: iso(m.ts || now()), sid: sid, qts: now() };
      if (m.status) e.status = m.status;
      if (m.sev && SEVS.indexOf(m.sev) >= 0) e.severity = m.sev;
      if (m.variety) e.variety = m.variety;
      return e;
    }
    function enqueueMark(m, sid) {
      if (!S.optIn || !m || m.imported || !m.id || findMark(m.id) || isSent(m.id)) return false;
      Q.marks.push(entryFor(m, sid || 'unknown')); saveQ(); kick(); return true;
    }
    function updateMark(m, sid) {      // severity / variety / status changed after the mark was made
      if (!S.optIn || !m || !m.id) return;
      var q = findMark(m.id);
      if (q) { var e = entryFor(m, q.sid); e.qts = now(); Q.marks[Q.marks.indexOf(q)] = e; saveQ(); kick(); return; }
      if (isSent(m.id)) { Q.sent.splice(Q.sent.indexOf(m.id), 1); Q.marks.push(entryFor(m, sid || 'unknown')); saveQ(); kick(); }
    }
    function removeMark(id) { var q = findMark(id); if (q) { Q.marks.splice(Q.marks.indexOf(q), 1); saveQ(); } }
    function addTrack(p, sid) {
      if (!S.optIn || !p) return;
      var l = Q.lastTrack;
      if (l && l.sid === sid && distM(l, p) < TRACK_MIN_M) return;
      Q.track.push({ lat: p.lat, lon: p.lon, time: iso(p.ts || now()), sid: sid || 'unknown' });
      if (Q.track.length > TRACK_CAP) Q.track.splice(0, Q.track.length - TRACK_CAP);
      Q.lastTrack = { lat: p.lat, lon: p.lon, sid: sid }; saveQ();
    }

    // ---- payload / upload ----
    function contact() {
      var c = {}; if (S.name) c.name = S.name; if (S.email) c.email = S.email; if (S.farm) c.farm = S.farm;
      return Object.keys(c).length ? c : null;
    }
    function strip(e) { var o = Object.assign({}, e); delete o.sid; delete o.qts; return o; }
    function buildPayload(sid, marks, track) {
      var p = { deviceId: deviceId(), appVersion: cfg.APP_VERSION, sessionId: sid, submittedAt: iso(now()), consent: true };
      var c = contact(); if (c) p.contact = c;
      if (S.district) p.district = S.district;
      var v = defaultVariety(); if (v) p.variety = v;
      p.marks = marks.map(strip);
      if (track && track.length) p.track = track.map(function (t) { return { lat: t.lat, lon: t.lon, time: t.time }; });
      return p;
    }
    function headers() { var h = { 'Content-Type': 'application/json' }; if (cfg.INGEST_KEY) h['X-Ingest-Key'] = cfg.INGEST_KEY; return h; }
    function post(url, body) {
      var opt = { method: 'POST', headers: headers(), body: JSON.stringify(body), mode: 'cors', credentials: 'omit' };
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = null;
      if (ctl) { opt.signal = ctl.signal; t = setTimeout(function () { ctl.abort(); }, 25000); }
      return env.fetch(url, opt).then(function (r) { if (t) clearTimeout(t); return r; }, function (e) { if (t) clearTimeout(t); throw e; });
    }
    function pendingCount() { return Q.marks.length + Q.track.length; }
    function nextBatch(force) {
      var cutoff = now() - SETTLE_MS, sid = null, i;
      var ms = Q.marks.filter(function (m) { return force || m.qts <= cutoff; });
      if (ms.length) sid = ms[0].sid; else if (Q.track.length && !Q.marks.length) sid = Q.track[0].sid; else return null;   // marks still settling (severity window): wait
      var marks = ms.filter(function (m) { return m.sid === sid; }).slice(0, MARK_BATCH);
      var track = Q.track.filter(function (t) { return t.sid === sid; }).slice(0, TRACK_BATCH);
      return { sid: sid, marks: marks, track: track };
    }
    function done(b) {
      var ids = {}; b.marks.forEach(function (m) { ids[m.id] = 1; Q.sent.push(m.id); });
      Q.marks = Q.marks.filter(function (m) { return !ids[m.id]; });
      var tset = {}; b.track.forEach(function (t) { tset[t.time + '|' + t.lat + '|' + t.lon] = 1; });
      Q.track = Q.track.filter(function (t) { return !(t.sid === b.sid && tset[t.time + '|' + t.lat + '|' + t.lon]); });
      if (Q.sent.length > SENT_CAP) Q.sent.splice(0, Q.sent.length - SENT_CAP);
    }
    function fail(msg) {
      S.fails++; S.lastError = msg; saveS();
      if (S.optIn && (pendingCount() || Q.access.length)) { if (timer) unschedule(timer); timer = schedule(function () { timer = null; flush(false); }, backoffMs(S.fails)); }
      return { ok: false, error: msg };
    }
    function flush(force) {
      if (busy) return busy;
      if (!S.optIn) return Promise.resolve({ ok: false, skipped: 'opted-out' });
      if (!online()) return Promise.resolve({ ok: false, skipped: 'offline' });
      if (timer) { unschedule(timer); timer = null; }
      var sentMarks = 0, sentTrack = 0;
      function step() {
        var b = nextBatch(force);
        if (!b) return Promise.resolve({ ok: true, sentMarks: sentMarks, sentTrack: sentTrack });
        return post(cfg.INGEST_URL, buildPayload(b.sid, b.marks, b.track)).then(function (r) {
          if (!r.ok) return fail('Server replied ' + r.status);
          done(b); sentMarks += b.marks.length; sentTrack += b.track.length;
          S.lastSync = now(); S.fails = 0; S.lastError = ''; saveS(); saveQ();
          return step();
        }, function (e) { return fail('Network: ' + (e && e.message || e)); });
      }
      busy = step().then(function (res) {
        if (res.ok) { return flushAccess().then(function () { return res; }); }
        return res;
      }).then(function (res) { busy = null; if (res.ok) kick(); onChange(); return res; }, function (e) { busy = null; return fail(String(e)); });
      return busy;
    }
    function kick() {
      if (!S.optIn || timer || busy || !(pendingCount() || Q.access.length)) return;
      timer = schedule(function () { timer = null; flush(false); }, S.fails ? backoffMs(S.fails) : 8000);
    }

    // ---- collaborative data access request ----
    function canRequest() { return !!(S.optIn && S.lastSync); }
    function mailtoUrl(f) {
      var body = ['Hi Agronica,', '', 'I would like to request access to the combined (collaborative) district mistletoe data.', '',
        'Name: ' + (f.name || ''), 'Email: ' + (f.email || ''), 'Farm/business: ' + (f.farm || ''), 'District: ' + (f.district || ''),
        'Device ID: ' + (f.deviceId || ''), '', f.message || ''].join('\n');
      return 'mailto:' + cfg.ACCESS_MAILTO + '?subject=' + encodeURIComponent('Mistletoe Marker - collaborative data request') + '&body=' + encodeURIComponent(body);
    }
    function accessBody(f) {
      return { deviceId: deviceId(), name: (f.name != null ? f.name : S.name) || '', email: (f.email || '').trim(), farm: (f.farm != null ? f.farm : S.farm) || '',
        district: (f.district != null ? f.district : S.district) || '', message: (f.message || '').trim() };
    }
    function requestAccess(f) {
      f = f || {};
      if (!S.optIn) return Promise.resolve({ ok: false, error: 'not-opted-in' });
      if (!S.lastSync) return Promise.resolve({ ok: false, error: 'no-sync' });
      if (!validEmail(f.email)) return Promise.resolve({ ok: false, error: 'email' });
      var body = accessBody(f);
      function queue() { Q.access.push(Object.assign({ qts: now() }, body)); saveQ(); kick(); return { ok: true, queued: true }; }
      if (!online()) return Promise.resolve(queue());
      return post(cfg.ACCESS_URL, body).then(function (r) {
        if (r.ok) return { ok: true, sent: true };
        if (r.status === 404) return { ok: false, fallback: 'mailto', mailto: mailtoUrl(body) };
        return queue();
      }, function () { return queue(); });
    }
    function flushAccess() {
      if (!Q.access.length || !S.optIn || !online()) return Promise.resolve();
      var item = Q.access[0], body = Object.assign({}, item); delete body.qts;
      return post(cfg.ACCESS_URL, body).then(function (r) {
        if (r.ok) { Q.access.shift(); saveQ(); return flushAccess(); }
        S.lastError = 'Access request: server replied ' + r.status; saveS();
      }, function () { /* try again later */ });
    }

    function status() {
      return { optIn: S.optIn, asked: S.asked, queuedMarks: Q.marks.length, queuedTrack: Q.track.length, lastSync: S.lastSync, lastError: S.lastError, fails: S.fails,
        pendingAccess: Q.access.length, canRequest: canRequest(), deviceId: S.deviceId };
    }
    return { settings: settings, setProfile: setProfile, setOptIn: setOptIn, markAsked: markAsked, deviceId: deviceId, defaultVariety: defaultVariety,
      enqueueMark: enqueueMark, updateMark: updateMark, removeMark: removeMark, addTrack: addTrack, flush: flush, kick: kick, status: status,
      canRequest: canRequest, requestAccess: requestAccess, flushAccess: flushAccess, mailtoUrl: mailtoUrl, buildPayload: buildPayload, queue: function () { return Q; } };
  }

  var core = { createCore: createCore, CATMAP: CATMAP, VARIETIES: VARIETIES, SEVS: SEVS, backoffMs: backoffMs, effVariety: effVariety, validEmail: validEmail, newId: newId, distM: distM };
  if (typeof document === 'undefined') { if (typeof module !== 'undefined' && module.exports) module.exports = core; return; }

  // =================== browser UI ===================
  var $ = function (id) { return document.getElementById(id); };
  var C = createCore({ cfg: root.MM_CONFIG, storage: root.localStorage, fetch: function (u, o) { return root.fetch(u, o); },
    online: function () { return navigator.onLine !== false; }, onChange: function () { refresh(); } });
  var firstRun = false;

  function fillVarieties(sel) {
    sel.innerHTML = '<option value="">(not set)</option>' + VARIETIES.map(function (v) { return '<option value="' + v + '">' + v + '</option>'; }).join('');
  }
  function ago(ts) {
    if (!ts) return 'never';
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(ts).toLocaleDateString();
  }
  function refresh() {
    var st = C.status(), s = C.settings();
    var line;
    if (!st.optIn) line = 'Sharing is OFF. Nothing leaves your phone.';
    else line = 'Queued: ' + st.queuedMarks + ' mark' + (st.queuedMarks === 1 ? '' : 's') + (st.queuedTrack ? ' + ' + st.queuedTrack + ' track pts' : '') + ' · Last synced: ' + ago(st.lastSync) +
      (st.lastError ? ' · ' + st.lastError + ' (will retry)' : '');
    if ($('shStatus')) { $('shStatus').textContent = line; $('shSync').disabled = !st.optIn; $('shSyncCard').classList.toggle('off', !st.optIn);
      $('shReq').disabled = !st.canRequest;
      $('shReqHint').textContent = !st.optIn ? 'Turn sharing on (and save) to request access.' : !st.lastSync ? 'Available after your first successful sync.' : (st.pendingAccess ? 'Request queued - will send when online.' : 'Sharers can request the combined district data.'); }
    if ($('menuShareSub')) $('menuShareSub').textContent = st.optIn ? 'Sharing ON · ' + st.queuedMarks + ' queued' : 'Sharing OFF';
    if ($('shOpt')) { /* leave checkbox alone while editing */ }
    void s;
  }
  function loadForm() {
    var s = C.settings();
    $('shOpt').checked = !!s.optIn;
    $('shName').value = s.name; $('shEmail').value = s.email; $('shFarm').value = s.farm; $('shDistrict').value = s.district;
    $('shVar').value = s.variety || ''; $('shVarOther').value = s.varietyOther; $('shVarOther').classList.toggle('hidden', s.variety !== 'Other');
  }
  function openShare(first) {
    firstRun = !!first;
    loadForm(); refresh();
    $('shAccess').classList.add('hidden');
    $('shSyncCard').classList.toggle('hidden', firstRun);
    $('shTitle').textContent = firstRun ? 'Welcome' : 'Research & data sharing';
    $('shNotNow').textContent = firstRun ? 'Not now' : 'Cancel';
    $('shSave').textContent = firstRun ? 'Save & get started' : 'Save';
    $('sheet').classList.add('hidden'); if ($('help')) $('help').classList.add('hidden');
    $('share').classList.remove('hidden'); $('share').scrollTop = 0;
  }
  function closeShare() { $('share').classList.add('hidden'); if (firstRun) C.markAsked(); firstRun = false; }
  function save() {
    var on = $('shOpt').checked, was = C.settings().optIn;
    var email = $('shEmail').value.trim();
    if (email && !validEmail(email)) { $('shMsg').textContent = 'That email address does not look right - fix it or leave it blank.'; $('shEmail').focus(); return; }
    $('shMsg').textContent = '';
    C.setProfile({ name: $('shName').value, email: email, farm: $('shFarm').value, district: $('shDistrict').value, variety: $('shVar').value, varietyOther: $('shVarOther').value });
    C.setOptIn(on); C.markAsked();
    if (window.App && window.App.getVariety && !window.App.getVariety() && C.defaultVariety()) window.App.setVariety(C.defaultVariety());
    var msgTxt = on ? (was ? 'Saved - sharing stays ON' : 'Thanks! Sharing is ON - your new marks will be sent to Agronica') : (was ? 'Sharing turned OFF - queue cleared' : 'Saved - sharing is OFF');
    firstRun = false; $('share').classList.add('hidden');
    if (window.App && window.App.toast) window.App.toast(msgTxt, 4500);
    if (on) C.flush(true);
    refresh();
  }
  function reqValues() { return { email: $('shReqEmail').value, message: $('shReqMsg').value, name: $('shName').value || C.settings().name, farm: C.settings().farm, district: C.settings().district }; }
  function openAccess() {
    if (!C.status().canRequest) return;
    $('shReqEmail').value = C.settings().email || ''; $('shReqMsg').value = ''; $('shReqNote').textContent = '';
    $('shAccess').classList.remove('hidden'); $('shAccess').scrollIntoView({ block: 'center' });
    $('shReqEmail').focus();
  }
  function sendAccess() {
    var v = reqValues();
    if (!validEmail(v.email)) { $('shReqNote').textContent = 'Please enter a valid email address - Agronica needs it to reply.'; $('shReqEmail').focus(); return; }
    $('shReqSend').disabled = true; $('shReqNote').textContent = 'Sending...';
    C.requestAccess(v).then(function (r) {
      $('shReqSend').disabled = false;
      if (r.sent) { $('shReqNote').textContent = 'Request sent - Agronica will be in touch.'; $('shAccess').classList.add('hidden'); }
      else if (r.queued) { $('shReqNote').textContent = 'Saved - it will be sent when you are online. Agronica will be in touch.'; $('shAccess').classList.add('hidden'); }
      else if (r.fallback === 'mailto') { $('shReqNote').textContent = 'Opening your email app so you can send this to Agronica...'; root.__lastMailto = r.mailto; location.href = r.mailto; }
      else $('shReqNote').textContent = 'Could not send: ' + (r.error || 'unknown error');
      refresh();
    });
  }
  function syncNow() {
    $('shStatus').textContent = 'Syncing...';
    C.flush(true).then(function (r) {
      refresh();
      if (r.skipped === 'offline') $('shStatus').textContent += ' (offline - will sync when back online)';
      else if (r.ok) App.toast('Synced' + (r.sentMarks || r.sentTrack ? ': ' + r.sentMarks + ' marks sent' : ' - nothing waiting'), 3000);
    });
  }

  // ---- severity chips (after each mistletoe LEFT/RIGHT mark; non-blocking) ----
  var sevT = null, sevMark = null;
  function showSeverity(m) {
    sevMark = m.id; var row = $('sevRow');
    Array.prototype.forEach.call(row.querySelectorAll('button'), function (b) { b.classList.remove('on'); });
    $('sevLbl').textContent = m.name || ('Mark ' + m.n);
    row.classList.remove('hidden'); row.setAttribute('data-side', m.side);
    clearTimeout(sevT); sevT = setTimeout(hideSeverity, 4000);
  }
  function hideSeverity() { $('sevRow').classList.add('hidden'); sevMark = null; clearTimeout(sevT); }
  function pickSeverity(sev) {
    if (!sevMark) return;
    if (window.App.setSeverity(sevMark, sev)) {
      Array.prototype.forEach.call($('sevRow').querySelectorAll('button'), function (b) { b.classList.toggle('on', b.getAttribute('data-sev') === sev); });
      clearTimeout(sevT); sevT = setTimeout(hideSeverity, 900);
    }
  }

  // ---- session variety (menu) ----
  function syncVarietyUi() {
    var v = window.App && window.App.getVariety ? window.App.getVariety() : '';
    var known = VARIETIES.slice(0, -1).indexOf(v) >= 0;
    $('varSel').value = !v ? '' : known ? v : 'Other';
    $('varOther').classList.toggle('hidden', $('varSel').value !== 'Other');
    $('varOther').value = !v || known ? '' : v;
  }
  function varChanged() {
    var sel = $('varSel').value, other = $('varOther').value;
    $('varOther').classList.toggle('hidden', sel !== 'Other');
    window.App.setVariety(sel === 'Other' ? (other.trim() || 'Other') : sel);
  }

  function init() {
    fillVarieties($('shVar')); fillVarieties($('varSel'));
    $('shVar').onchange = function () { $('shVarOther').classList.toggle('hidden', $('shVar').value !== 'Other'); };
    $('shSave').onclick = save; $('shNotNow').onclick = closeShare; $('shClose').onclick = closeShare;
    $('shSync').onclick = syncNow; $('shReq').onclick = openAccess; $('shReqSend').onclick = sendAccess;
    $('shReqMail').onclick = function (e) { e.preventDefault(); var s = C.settings(); var v = reqValues(); location.href = C.mailtoUrl({ name: v.name, email: v.email, farm: s.farm, district: s.district, deviceId: s.deviceId, message: v.message }); };
    $('menuShare').onclick = function () { openShare(false); };
    Array.prototype.forEach.call($('sevRow').querySelectorAll('button'), function (b) { b.onclick = function () { pickSeverity(b.getAttribute('data-sev')); }; });
    $('varSel').onchange = varChanged; $('varOther').oninput = varChanged;
    $('menuBtn').addEventListener('click', syncVarietyUi);
    window.addEventListener('online', function () { C.flush(false); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') C.flush(false); });
    setInterval(function () { C.flush(false); }, 5 * 60 * 1000);
    refresh(); C.kick(); C.flush(false);
    if (!C.settings().asked) setTimeout(function () { if (!C.settings().asked) openShare(true); }, 500);
  }

  root.Share = { core: C, openShare: openShare, closeShare: closeShare, markAdded: function (m, sid) { C.enqueueMark(m, sid); },
    markUpdated: function (m, sid) { C.updateMark(m, sid); }, markRemoved: function (id) { C.removeMark(id); },
    trackPoint: function (p, sid) { C.addTrack(p, sid); }, showSeverity: showSeverity, hideSeverity: hideSeverity, newId: newId,
    defaultVariety: function () { return C.defaultVariety(); }, syncVarietyUi: syncVarietyUi, VARIETIES: VARIETIES };
  init();
})(typeof self !== 'undefined' ? self : this);
