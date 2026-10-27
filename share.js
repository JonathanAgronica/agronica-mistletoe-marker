/* Opt-in research data sharing: consent, local queue, batched upload with retry/backoff, access request + status,
   plus the welcome / "Research & data sharing" screen and the severity chips. Works in browser and node (core only).
   Server contract (AgronicaWorld ingest): POST submit {deviceId(UUID), appVersion(<=32), sessionId(<=64 [A-Za-z0-9._:-]), consent:true, marks, track};
   <=1 MB body, <=5000 marks, <=20000 track pts per request; reply {ok:true,received:n} or {ok:false,error} with 400/401/403/405/413/429. */
(function (root) {
  'use strict';
  var SKEY = 'agronica-mistletoe-share-v1', QKEY = 'agronica-mistletoe-queue-v1';
  var CATMAP = { '': 'mistletoe', irrigation: 'broken-irrigation', phytophthora: 'phytophthora', nutrition: 'nutrition' };
  var VARIETIES = ['A4', 'A16', 'A38', '741', '344', '246', '816', '842', '660', 'Other'];
  var SEVS = ['light', 'moderate', 'heavy'];
  var SETTLE_MS = 5000, MARK_BATCH = 5000, TRACK_BATCH = 20000, MAX_BYTES = 900000, TRACK_CAP = 5000, SENT_CAP = 5000, DROP_CAP = 100, TRACK_MIN_M = 15;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function iso(ts) { return new Date(ts).toISOString(); }
  function distM(a, b) {
    var R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function backoffMs(fails) { return Math.min(15000 * Math.pow(2, Math.max(0, fails - 1)), 3600000); }
  function effVariety(sel, other) { return sel === 'Other' ? ((other || '').trim() || 'Other') : (sel || ''); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim()); }
  function cryptoObj() { try { return root.crypto || require('crypto').webcrypto; } catch (e) { return null; } }
  function randHex(n) {
    var a = [], i, c = cryptoObj();
    try { var u = new Uint8Array(n); c.getRandomValues(u); for (i = 0; i < n; i++) a.push(('0' + u[i].toString(16)).slice(-2)); }
    catch (e) { a = []; for (i = 0; i < n; i++) a.push(('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2)); }
    return a.join('');
  }
  function uuid() {
    var c = cryptoObj();
    try { if (c && typeof c.randomUUID === 'function') return c.randomUUID(); } catch (e) { /* insecure context: fall through */ }
    var h = randHex(16).split(''); h[12] = '4'; h[16] = '89ab'.charAt(parseInt(h[16], 16) & 3);
    h = h.join(''); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function newId() { return Date.now().toString(36) + randHex(4); }
  function cleanVersion(v) { return String(v == null ? '' : v).slice(0, 32); }
  function cleanSid(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 64) || 'unknown'; }
  function cleanId(s) { return String(s).slice(0, 64); }
  function byteLen(s) { try { if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length; } catch (e) { /* ignore */ } return s.length; }
  function tkey(t) { return t.time + '|' + t.lat + '|' + t.lon; }

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
      lastSync: 0, lastError: '', fails: 0, optInAt: 0, retryAt: 0, access: null, accessErr: '' }, read(SKEY, {}));
    var Q = Object.assign({ marks: [], track: [], sent: [], access: [], dropped: [], lastTrack: null }, read(QKEY, {}));
    if (S.deviceId && !UUID_RE.test(S.deviceId)) { S.migratedFrom = S.deviceId; S.deviceId = uuid(); write(SKEY, S); }   // old random "mm-..." ids -> UUID
    function saveS() { write(SKEY, S); onChange(); }
    function saveQ() { write(QKEY, Q); onChange(); }

    function deviceId() { if (!S.deviceId || !UUID_RE.test(S.deviceId)) { S.deviceId = uuid(); saveS(); } return S.deviceId; }
    function settings() { return Object.assign({}, S); }
    function setProfile(p) {
      ['name', 'email', 'farm', 'district', 'variety', 'varietyOther'].forEach(function (k) { if (p && p[k] != null) S[k] = String(p[k]).trim(); });
      saveS();
    }
    function markAsked() { S.asked = true; saveS(); }
    function setOptIn(on) {
      on = !!on;
      if (on && !S.optIn) { deviceId(); S.optIn = true; S.optInAt = now(); S.fails = 0; S.lastError = ''; S.retryAt = 0; saveS(); }
      else if (!on && S.optIn) {
        S.optIn = false; S.fails = 0; S.lastError = ''; S.retryAt = 0; S.access = null; S.accessErr = ''; saveS();
        Q.marks = []; Q.track = []; Q.access = []; Q.sent = []; Q.dropped = []; Q.lastTrack = null; saveQ();
        if (timer) { unschedule(timer); timer = null; }
      }
    }
    function defaultVariety() { return effVariety(S.variety, S.varietyOther); }

    // ---- queue ----
    function isSent(id) { return Q.sent.indexOf(id) >= 0; }
    function findMark(id) { for (var i = 0; i < Q.marks.length; i++) if (Q.marks[i].id === id) return Q.marks[i]; return null; }
    function entryFor(m, sid) {
      var e = { id: cleanId(m.id), lat: m.lat, lon: m.lon, side: m.side === 'L' ? 'L' : 'R',
        category: CATMAP[m.cat || ''] || 'mistletoe', time: iso(m.ts || now()), sid: sid, qts: now() };
      if (m.acc != null && isFinite(m.acc)) e.accuracy = m.acc;
      if (m.status) e.status = m.status;
      if (m.sev && SEVS.indexOf(m.sev) >= 0) e.severity = m.sev;
      if (m.variety) e.variety = String(m.variety).slice(0, 60);
      return e;
    }
    function enqueueMark(m, sid) {
      if (!S.optIn || !m || m.imported || !m.id || !isFinite(m.lat) || !isFinite(m.lon)) return false;
      var id = cleanId(m.id); if (findMark(id) || isSent(id)) return false;
      Q.marks.push(entryFor(m, sid || 'unknown')); saveQ(); kick(); return true;
    }
    function updateMark(m, sid) {      // severity / variety / status changed after the mark was made
      if (!S.optIn || !m || !m.id) return;
      var id = cleanId(m.id), q = findMark(id);
      if (q) { var e = entryFor(m, q.sid); e.qts = now(); Q.marks[Q.marks.indexOf(q)] = e; saveQ(); kick(); return; }
      if (isSent(id)) { Q.sent.splice(Q.sent.indexOf(id), 1); Q.marks.push(entryFor(m, sid || 'unknown')); saveQ(); kick(); }
    }
    function removeMark(id) { var q = findMark(cleanId(id)); if (q) { Q.marks.splice(Q.marks.indexOf(q), 1); saveQ(); } }
    function addTrack(p, sid) {
      if (!S.optIn || !p || !isFinite(p.lat) || !isFinite(p.lon)) return;
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
      var p = { deviceId: deviceId(), appVersion: cleanVersion(cfg.APP_VERSION), sessionId: cleanSid(sid), submittedAt: iso(now()), consent: true };
      var c = contact(); if (c) p.contact = c;
      if (S.district) p.district = S.district;
      var v = defaultVariety(); if (v) p.variety = v;
      var seen = {};
      p.marks = marks.filter(function (m) { if (seen[m.id]) return false; seen[m.id] = 1; return true; }).map(strip);   // ids unique within a submission
      if (track && track.length) p.track = track.map(function (t) { return { lat: t.lat, lon: t.lon, time: t.time }; });
      return p;
    }
    function keyHeaders(json) { var h = {}; if (json) h['Content-Type'] = 'application/json'; if (cfg.INGEST_KEY) h['X-Ingest-Key'] = cfg.INGEST_KEY; return h; }
    function req(url, opt) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = null;
      opt.mode = 'cors'; opt.credentials = 'omit';
      if (ctl) { opt.signal = ctl.signal; t = setTimeout(function () { ctl.abort(); }, 25000); }
      return env.fetch(url, opt).then(function (r) { if (t) clearTimeout(t); return r; }, function (e) { if (t) clearTimeout(t); throw e; });
    }
    function post(url, body) { return req(url, { method: 'POST', headers: keyHeaders(true), body: JSON.stringify(body) }); }
    function readBody(r) {
      try { if (r && typeof r.json === 'function') return r.json().then(function (j) { return j; }, function () { return null; }); } catch (e) { /* ignore */ }
      return Promise.resolve(null);
    }
    function retryAfterMs(r, fallback) {
      var v = null; try { v = r.headers && r.headers.get && r.headers.get('Retry-After'); } catch (e) { /* not exposed */ }
      var ms = NaN;
      if (v != null && v !== '') { ms = /^\d+(\.\d+)?$/.test(String(v).trim()) ? parseFloat(v) * 1000 : Date.parse(v) - now(); }
      if (!isFinite(ms)) ms = fallback;
      return Math.max(1000, Math.min(ms, 3600000));
    }
    function pendingCount() { return Q.marks.length + Q.track.length; }
    function nextBatch(force, skip) {
      var cutoff = now() - SETTLE_MS, sid = null;
      var ms = Q.marks.filter(function (m) { return !skip[m.id] && (force || m.qts <= cutoff); });
      var trk = Q.track.filter(function (t) { return !skip[tkey(t)]; });
      if (ms.length) sid = ms[0].sid; else if (trk.length && !Q.marks.length) sid = trk[0].sid; else return null;   // marks still settling (severity window): wait
      var marks = ms.filter(function (m) { return m.sid === sid; }).slice(0, MARK_BATCH);
      var track = trk.filter(function (t) { return t.sid === sid; }).slice(0, TRACK_BATCH);
      while ((marks.length > 1 || track.length > 1) && byteLen(JSON.stringify(buildPayload(sid, marks, track))) > MAX_BYTES) {   // keep under the 1 MB body limit
        if (track.length >= marks.length) track = track.slice(0, Math.ceil(track.length / 2)); else marks = marks.slice(0, Math.ceil(marks.length / 2));
      }
      return { sid: sid, marks: marks, track: track };
    }
    function done(b) {
      var ids = {}; b.marks.forEach(function (m) { ids[m.id] = 1; Q.sent.push(m.id); });
      Q.marks = Q.marks.filter(function (m) { return !ids[m.id]; });
      var tset = {}; b.track.forEach(function (t) { tset[tkey(t)] = 1; });
      Q.track = Q.track.filter(function (t) { return !(t.sid === b.sid && tset[tkey(t)]); });
      if (Q.sent.length > SENT_CAP) Q.sent.splice(0, Q.sent.length - SENT_CAP);
    }
    function drop(kind, item, error) {       // server says this item is invalid (400): remove it, keep a log, never retry it
      if (kind === 'mark') Q.marks = Q.marks.filter(function (m) { return m.id !== item.id; });
      else Q.track = Q.track.filter(function (t) { return !(t.sid === item.sid && tkey(t) === tkey(item)); });
      Q.dropped.push({ kind: kind, id: kind === 'mark' ? item.id : tkey(item), error: error, at: iso(now()) });
      if (Q.dropped.length > DROP_CAP) Q.dropped.splice(0, Q.dropped.length - DROP_CAP);
      try { console.warn('[MM] dropped invalid ' + kind + ' (' + (kind === 'mark' ? item.id : tkey(item)) + '): ' + error); } catch (e) { /* no console */ }
    }
    function trySend(b) {
      return post(cfg.INGEST_URL, buildPayload(b.sid, b.marks, b.track)).then(function (r) {
        return readBody(r).then(function (body) {
          var st = (r && r.status) | 0 || (r && r.ok ? 200 : 0);
          if (r.ok && !(body && body.ok === false)) return { kind: 'ok', received: body && body.received };
          var err = (body && body.error ? String(body.error) : 'Server replied') + ' (' + st + ')';
          if (st === 400 || st === 413) return { kind: 'split', status: st, error: err };
          if (st === 429) return { kind: 'rate', error: err, wait: retryAfterMs(r, backoffMs(S.fails + 1)) };
          return { kind: 'fail', status: st, error: err };
        });
      }, function (e) { return { kind: 'fail', error: 'Network: ' + (e && e.message || e) }; });
    }
    // send a chunk; on 400/413 isolate the offending item(s) by splitting; items still failing alone are "suspects"
    function sendChunk(b, acc) {
      return trySend(b).then(function (res) {
        if (res.kind === 'ok') {
          done(b); acc.sentMarks += b.marks.length; acc.sentTrack += b.track.length; acc.anyOk = true;
          S.lastSync = now(); S.fails = 0; S.lastError = ''; S.retryAt = 0; saveS(); saveQ(); return res;
        }
        if (res.kind !== 'split') return res;
        if (!acc.anyOk && ++acc.bad > 6) return { kind: 'fail', error: 'Server rejected the submission: ' + res.error };   // looks payload-wide, not one bad mark
        if (b.marks.length && b.track.length) {
          return sendChunk({ sid: b.sid, marks: b.marks, track: [] }, acc).then(function (r) {
            return r.kind === 'ok' || r.kind === 'suspect' ? sendChunk({ sid: b.sid, marks: [], track: b.track }, acc) : r;
          });
        }
        var list = b.marks.length ? b.marks : b.track, isM = !!b.marks.length;
        if (list.length > 1) {
          var h = Math.ceil(list.length / 2), mk = function (a) { return { sid: b.sid, marks: isM ? a : [], track: isM ? [] : a }; };
          return sendChunk(mk(list.slice(0, h)), acc).then(function (r) { return r.kind === 'ok' || r.kind === 'suspect' ? sendChunk(mk(list.slice(h)), acc) : r; });
        }
        acc.suspects.push({ kind: isM ? 'mark' : 'track', item: list[0], error: res.error });
        acc.skip[isM ? list[0].id : tkey(list[0])] = 1;
        return { kind: 'suspect' };
      });
    }
    function fail(msg, wait) {
      S.fails++; S.lastError = msg; if (wait) S.retryAt = now() + wait; saveS();
      if (S.optIn && (pendingCount() || Q.access.length)) { if (timer) unschedule(timer); timer = schedule(function () { timer = null; flush(false); }, wait || backoffMs(S.fails)); }
      return { ok: false, error: msg };
    }
    function flush(force) {
      if (busy) return busy;
      if (!S.optIn) return Promise.resolve({ ok: false, skipped: 'opted-out' });
      if (!online()) return Promise.resolve({ ok: false, skipped: 'offline' });
      if (S.retryAt && now() < S.retryAt) return Promise.resolve({ ok: false, skipped: 'rate-limited', waitMs: S.retryAt - now() });   // honour 429 Retry-After
      if (timer) { unschedule(timer); timer = null; }
      var acc = { sentMarks: 0, sentTrack: 0, anyOk: false, bad: 0, suspects: [], skip: {} };
      function step() {
        var b = nextBatch(force, acc.skip);
        if (!b) return Promise.resolve({ kind: 'ok' });
        return sendChunk(b, acc).then(function (res) { return res.kind === 'ok' || res.kind === 'suspect' ? step() : res; });
      }
      busy = step().then(function (res) {
        if (acc.suspects.length && acc.anyOk) { acc.suspects.forEach(function (s) { drop(s.kind, s.item, s.error); }); saveQ(); }   // a bad item among accepted ones: drop + log
        var out;
        if (res.kind === 'ok') out = acc.suspects.length && !acc.anyOk ? fail('Server rejected the submission: ' + acc.suspects[0].error) : { ok: true, sentMarks: acc.sentMarks, sentTrack: acc.sentTrack };
        else if (res.kind === 'rate') out = fail('Server busy - will retry (' + res.error + ')', res.wait);
        else out = fail(res.error);
        if (out.ok) { return flushAccess().then(function () { return out; }); }
        return out;
      }).then(function (out) { busy = null; if (out.ok) kick(); onChange(); return out; }, function (e) { busy = null; return fail(String(e)); });
      return busy;
    }
    function kick() {
      if (!S.optIn || timer || busy || !(pendingCount() || Q.access.length)) return;
      var d = S.retryAt && S.retryAt > now() ? S.retryAt - now() : S.fails ? backoffMs(S.fails) : 8000;
      timer = schedule(function () { timer = null; flush(false); }, d);
    }

    // ---- collaborative data: access request + status ----
    function accessState() {
      var a = S.access || {}, st = a.status || 'none';
      if (st === 'approved' && a.expiresAt && Date.parse(a.expiresAt) < now()) st = 'expired';
      return st;
    }
    function accessInfo() { var a = S.access || {}; return { status: accessState(), expiresAt: a.expiresAt || '', downloadUrls: accessState() === 'approved' ? (a.downloadUrls || {}) : {}, checkedAt: a.checkedAt || 0, error: S.accessErr }; }
    function canRequest() { return !!(S.optIn && S.lastSync && ['pending', 'approved'].indexOf(accessState()) < 0); }
    function mailtoUrl(f) {
      var body = ['Hi Agronica,', '', 'I would like to request access to the combined (collaborative) district mistletoe data.', '',
        'Name: ' + (f.name || ''), 'Email: ' + (f.email || ''), 'Farm/business: ' + (f.farm || ''), 'District: ' + (f.district || ''),
        'Device ID: ' + (f.deviceId || ''), '', f.message || ''].join('\n');
      return 'mailto:' + cfg.ACCESS_MAILTO + '?subject=' + encodeURIComponent('Mistletoe Marker - collaborative data request') + '&body=' + encodeURIComponent(body);
    }
    function accessBody(f) {
      return { deviceId: deviceId(), name: String(f.name != null ? f.name : S.name || '').trim(), email: (f.email || '').trim(), farm: String(f.farm != null ? f.farm : S.farm || '').trim(),
        district: String(f.district != null ? f.district : S.district || '').trim(), message: (f.message || '').trim() };
    }
    function setAccess(st, extra) { S.access = Object.assign({ status: st, checkedAt: now() }, extra || {}); S.accessErr = ''; saveS(); }
    function requestAccess(f) {
      f = f || {};
      if (!S.optIn) return Promise.resolve({ ok: false, error: 'not-opted-in' });
      if (!S.lastSync) return Promise.resolve({ ok: false, error: 'no-sync' });
      if (!String(f.name || '').trim()) return Promise.resolve({ ok: false, error: 'name' });
      if (!validEmail(f.email)) return Promise.resolve({ ok: false, error: 'email' });
      var body = accessBody(f);
      function queue() { Q.access.push(Object.assign({ qts: now() }, body)); saveQ(); kick(); return { ok: true, queued: true }; }
      if (!online()) return Promise.resolve(queue());
      return post(cfg.ACCESS_URL, body).then(function (r) {
        return readBody(r).then(function (j) {
          var st = (r && r.status) | 0 || (r.ok ? 200 : 0);
          if (r.ok && !(j && j.ok === false)) {
            var s = j && (j.status === 'approved' || j.status === 'pending') ? j.status : 'pending';
            setAccess(s); if (s === 'approved') return checkAccess().then(function () { return { ok: true, sent: true, status: s }; });
            return { ok: true, sent: true, status: s };
          }
          if (st === 404) return { ok: false, fallback: 'mailto', mailto: mailtoUrl(body) };
          if (st === 429 || st >= 500) return queue();
          return { ok: false, error: (j && j.error) || ('Server replied ' + st), status: st };
        });
      }, function () { return queue(); });
    }
    function flushAccess() {
      if (!Q.access.length || !S.optIn || !online()) return Promise.resolve();
      var item = Q.access[0], body = Object.assign({}, item); delete body.qts;
      return post(cfg.ACCESS_URL, body).then(function (r) {
        return readBody(r).then(function (j) {
          var st = (r && r.status) | 0 || (r.ok ? 200 : 0);
          if (r.ok && !(j && j.ok === false)) { Q.access.shift(); saveQ(); setAccess(j && j.status === 'approved' ? 'approved' : 'pending'); return flushAccess(); }
          if (st === 400 || st === 405) { Q.access.shift(); saveQ(); S.lastError = 'Access request rejected: ' + ((j && j.error) || st); saveS(); return flushAccess(); }
          S.lastError = 'Access request: server replied ' + st; saveS();
        });
      }, function () { /* try again later */ });
    }
    function checkAccess() {
      if (!S.optIn || !S.deviceId) return Promise.resolve(accessInfo());
      var url = cfg.ACCESS_STATUS_URL + '?deviceId=' + encodeURIComponent(deviceId());
      if (!online()) return Promise.resolve(accessInfo());
      return req(url, { method: 'GET', headers: keyHeaders(false) }).then(function (r) {
        return readBody(r).then(function (j) {
          var st = (r && r.status) | 0 || (r.ok ? 200 : 0);
          if (r.ok && j && typeof j.status === 'string') {
            var known = ['none', 'pending', 'approved', 'rejected', 'revoked', 'expired'];
            var s = known.indexOf(j.status) >= 0 ? j.status : 'none';
            setAccess(s, s === 'approved' ? { expiresAt: j.expiresAt || '', downloadUrls: j.downloadUrls || {} } : {});
          } else { S.accessErr = (j && j.error) ? String(j.error) + ' (' + st + ')' : 'Status check failed (' + st + ')'; saveS(); }
          return accessInfo();
        });
      }, function () { return accessInfo(); });
    }
    // fetch an approved download (KML / CSV). The key is only sent to the ingest server's own origin.
    function fetchDownload(kind) {
      var u = (accessInfo().downloadUrls || {})[kind];
      if (!u) return Promise.reject(new Error('No ' + kind + ' download available'));
      var abs; try { abs = new URL(u, cfg.ACCESS_STATUS_URL).href; } catch (e) { return Promise.reject(new Error('Bad download link')); }
      var same = false; try { same = new URL(abs).origin === new URL(cfg.INGEST_URL).origin; } catch (e) { /* ignore */ }
      function get(h) { return req(abs, { method: 'GET', headers: h }).then(function (r) { if (!r.ok) throw new Error('Download failed (' + r.status + ')'); return r.text(); }); }
      return same && cfg.INGEST_KEY ? get(keyHeaders(false)).catch(function (e) { if (e && /^Download failed/.test(e.message)) throw e; return get({}); }) : get({});
    }

    function status() {
      var a = accessInfo();
      return { optIn: S.optIn, asked: S.asked, queuedMarks: Q.marks.length, queuedTrack: Q.track.length, lastSync: S.lastSync, lastError: S.lastError, fails: S.fails,
        retryAt: S.retryAt, pendingAccess: Q.access.length, canRequest: canRequest(), deviceId: S.deviceId, dropped: Q.dropped.length, access: a.status };
    }
    return { settings: settings, setProfile: setProfile, setOptIn: setOptIn, markAsked: markAsked, deviceId: deviceId, defaultVariety: defaultVariety,
      enqueueMark: enqueueMark, updateMark: updateMark, removeMark: removeMark, addTrack: addTrack, flush: flush, kick: kick, status: status,
      canRequest: canRequest, requestAccess: requestAccess, flushAccess: flushAccess, checkAccess: checkAccess, accessInfo: accessInfo, fetchDownload: fetchDownload,
      mailtoUrl: mailtoUrl, buildPayload: buildPayload, queue: function () { return Q; } };
  }

  var core = { createCore: createCore, CATMAP: CATMAP, VARIETIES: VARIETIES, SEVS: SEVS, backoffMs: backoffMs, effVariety: effVariety, validEmail: validEmail, newId: newId, distM: distM,
    uuid: uuid, UUID_RE: UUID_RE, cleanSid: cleanSid, cleanVersion: cleanVersion };
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
  var ACC_TXT = { none: 'No request yet', pending: 'Pending - Agronica will be in touch', approved: 'Approved', rejected: 'Not approved - contact Agronica if you think this is a mistake', revoked: 'Access was revoked', expired: 'Access expired - you can request it again' };
  function refresh() {
    var st = C.status(), ai = C.accessInfo();
    var line;
    if (!st.optIn) line = 'Sharing is OFF. Nothing leaves your phone.';
    else line = 'Queued: ' + st.queuedMarks + ' mark' + (st.queuedMarks === 1 ? '' : 's') + (st.queuedTrack ? ' + ' + st.queuedTrack + ' track pts' : '') + ' · Last synced: ' + ago(st.lastSync) +
      (st.lastError ? ' · ' + st.lastError + ' (will retry)' : '') + (st.dropped ? ' · ' + st.dropped + ' rejected by server (dropped)' : '');
    if ($('shStatus')) {
      $('shStatus').textContent = line; $('shSync').disabled = !st.optIn; $('shSyncCard').classList.toggle('off', !st.optIn);
      $('shReq').disabled = !st.canRequest;
      $('shReqHint').textContent = !st.optIn ? 'Turn sharing on (and save) to request access.' : !st.lastSync && st.canRequest === false && ai.status !== 'pending' && ai.status !== 'approved' ? 'Available after your first successful sync.' :
        (st.pendingAccess ? 'Request queued - will send when online.' : ai.status === 'pending' || ai.status === 'approved' ? '' : 'Sharers can request the combined district data.');
      $('shAccStatus').textContent = !st.optIn ? '' : 'Collaborative data access: ' + (ACC_TXT[ai.status] || ai.status) + (ai.status === 'approved' && ai.expiresAt ? ' (until ' + new Date(ai.expiresAt).toLocaleDateString() + ')' : '');
      $('shAccStatus').setAttribute('data-status', ai.status);
      $('shAccOk').classList.toggle('hidden', !(st.optIn && ai.status === 'approved'));
      $('shPooledClear').classList.toggle('hidden', !(root.MMap && root.MMap.pooledCount && root.MMap.pooledCount()));
    }
    if ($('menuShareSub')) $('menuShareSub').textContent = st.optIn ? 'Sharing ON · ' + st.queuedMarks + ' queued' + (ai.status === 'approved' ? ' · data access approved' : '') : 'Sharing OFF';
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
    $('shSyncCard').classList.toggle('hidden', firstRun); $('share').classList.toggle('settings', !firstRun);
    $('shTitle').textContent = firstRun ? 'Welcome' : 'Research & data sharing';
    $('shNotNow').textContent = firstRun ? 'Not now' : 'Cancel';
    $('shSave').textContent = firstRun ? 'Save & get started' : 'Save';
    $('sheet').classList.add('hidden'); if ($('help')) $('help').classList.add('hidden');
    $('share').classList.remove('hidden'); $('share').scrollTop = 0;
    if (!firstRun) C.checkAccess().then(refresh);
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
    if (on) C.flush(true).then(function () { return C.checkAccess(); }).then(refresh);
    refresh();
  }
  function reqValues() { return { email: $('shReqEmail').value, message: $('shReqMsg').value, name: $('shReqName').value, farm: C.settings().farm, district: C.settings().district }; }
  function openAccess() {
    if (!C.status().canRequest) return;
    $('shReqName').value = C.settings().name || ''; $('shReqEmail').value = C.settings().email || ''; $('shReqMsg').value = ''; $('shReqNote').textContent = '';
    $('shAccess').classList.remove('hidden'); $('shAccess').scrollIntoView({ block: 'center' });
    ($('shReqName').value ? $('shReqEmail') : $('shReqName')).focus();
  }
  function sendAccess() {
    var v = reqValues();
    if (!v.name.trim()) { $('shReqNote').textContent = 'Please enter your name so Agronica knows who is asking.'; $('shReqName').focus(); return; }
    if (!validEmail(v.email)) { $('shReqNote').textContent = 'Please enter a valid email address - Agronica needs it to reply.'; $('shReqEmail').focus(); return; }
    $('shReqSend').disabled = true; $('shReqNote').textContent = 'Sending...';
    C.requestAccess(v).then(function (r) {
      $('shReqSend').disabled = false;
      if (r.sent) { $('shReqNote').textContent = r.status === 'approved' ? 'Access approved!' : 'Request sent - Agronica will be in touch.'; $('shAccess').classList.add('hidden'); }
      else if (r.queued) { $('shReqNote').textContent = 'Saved - it will be sent when you are online. Agronica will be in touch.'; $('shAccess').classList.add('hidden'); }
      else if (r.fallback === 'mailto') { $('shReqNote').textContent = 'Opening your email app so you can send this to Agronica...'; root.__lastMailto = r.mailto; location.href = r.mailto; }
      else $('shReqNote').textContent = 'Could not send: ' + (r.error || 'unknown error');
      refresh();
    });
  }
  function dl(kind) {
    var note = $('shAccNote'); note.textContent = 'Downloading ' + kind.toUpperCase() + '...';
    C.fetchDownload(kind).then(function (txt) {
      var fname = 'agronica-pooled-mistletoe-' + App.stamp() + '.' + kind;
      App.download(txt, fname, kind === 'kml' ? 'application/vnd.google-earth.kml+xml' : 'text/csv'); note.textContent = 'Downloaded ' + fname;
    }, function (e) { note.textContent = 'Could not download: ' + (e && e.message || e); });
  }
  function loadPooled() {
    var note = $('shAccNote'); note.textContent = 'Loading pooled data...';
    C.fetchDownload('kml').then(function (txt) {
      var res = root.KML.parseKml(txt);
      var n = root.MMap.setPooled(res.marks);
      note.textContent = 'Loaded ' + n + ' pooled marks as a read-only, anonymised layer on the Menu map and Find map.';
      refresh();
    }, function (e) { note.textContent = 'Could not load pooled data: ' + (e && e.message || e); });
  }
  function syncNow() {
    $('shStatus').textContent = 'Syncing...';
    C.flush(true).then(function (r) {
      refresh();
      if (r.skipped === 'offline') $('shStatus').textContent += ' (offline - will sync when back online)';
      else if (r.skipped === 'rate-limited') $('shStatus').textContent += ' (server asked us to wait - retrying in ' + Math.ceil(r.waitMs / 1000) + ' s)';
      else if (r.ok) App.toast('Synced' + (r.sentMarks || r.sentTrack ? ': ' + r.sentMarks + ' marks sent' : ' - nothing waiting'), 3000);
      return C.checkAccess().then(refresh);
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
    $('shDlKml').onclick = function () { dl('kml'); }; $('shDlCsv').onclick = function () { dl('csv'); }; $('shPooled').onclick = loadPooled;
    $('shPooledClear').onclick = function () { root.MMap.setPooled([]); $('shAccNote').textContent = 'Pooled layer removed.'; refresh(); };
    $('menuShare').onclick = function () { openShare(false); };
    Array.prototype.forEach.call($('sevRow').querySelectorAll('button'), function (b) { b.onclick = function () { pickSeverity(b.getAttribute('data-sev')); }; });
    $('varSel').onchange = varChanged; $('varOther').oninput = varChanged;
    $('menuBtn').addEventListener('click', syncVarietyUi);
    window.addEventListener('online', function () { C.flush(false); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { C.flush(false); C.checkAccess().then(refresh); } });
    setInterval(function () { C.flush(false); }, 5 * 60 * 1000);
    refresh(); C.kick(); C.flush(false); C.checkAccess().then(refresh);
    if (!C.settings().asked) setTimeout(function () { if (!C.settings().asked) openShare(true); }, 500);
  }

  root.Share = { core: C, openShare: openShare, closeShare: closeShare, markAdded: function (m, sid) { C.enqueueMark(m, sid); },
    markUpdated: function (m, sid) { C.updateMark(m, sid); }, markRemoved: function (id) { C.removeMark(id); },
    trackPoint: function (p, sid) { C.addTrack(p, sid); }, showSeverity: showSeverity, hideSeverity: hideSeverity, newId: newId,
    defaultVariety: function () { return C.defaultVariety(); }, syncVarietyUi: syncVarietyUi, VARIETIES: VARIETIES };
  init();
})(typeof self !== 'undefined' ? self : this);
