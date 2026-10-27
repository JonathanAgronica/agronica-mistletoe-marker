// Sharing core + KML severity/variety tests with a mocked fetch (no network). Run: NODE_PATH=<dir with @xmldom/xmldom> node tests/share.test.js
const assert = require('assert');
const { DOMParser } = require('@xmldom/xmldom');
const SH = require('../share.js'), KML = require('../kml.js'), CFG = require('../config.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// config
eq(CFG.INGEST_URL, 'https://170-64-148-102.sslip.io/api/mistletoe/submit'); eq(CFG.INGEST_KEY, 'mm-f1e22c16ccf1fe6050906fae'); eq(CFG.APP_VERSION, 'v12'); ok(/access-status$/.test(CFG.ACCESS_STATUS_URL)); ok(/access-request$/.test(CFG.ACCESS_URL));

function mem() { const d = {}; return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, _d: d }; }
function mk(opts = {}) {
  const st = opts.storage || mem(), calls = [], t = { now: 1700000000000, online: true, timers: [] };
  const responder = opts.responder || (() => ({ ok: true, status: 200 }));
  const core = SH.createCore({ cfg: Object.assign({}, CFG, opts.cfg), storage: st, now: () => t.now, online: () => t.online,
    fetch: (url, o) => { calls.push({ url, o, body: o.body ? JSON.parse(o.body) : null }); const r = responder(url, o, calls.length); return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); },
    schedule: (fn, ms) => { const h = { fn, ms }; t.timers.push(h); return h; }, unschedule: h => { t.timers = t.timers.filter(x => x !== h); } });
  return { core, st, calls, t };
}
const mark = (id, o = {}) => Object.assign({ id, side: 'L', n: 1, lat: -25.1, lon: 152.3, acc: 4.2, ts: 1700000000000 }, o);

(async () => {
  // opted out: nothing queued / sent
  let a = mk();
  a.core.enqueueMark(mark('m1'), 'S1'); a.core.addTrack({ lat: 1, lon: 1, ts: 1 }, 'S1');
  eq(a.core.status().queuedMarks, 0); eq((await a.core.flush(true)).skipped, 'opted-out'); eq(a.calls.length, 0);

  // opt in; queue; dedupe; imported skipped; category mapping
  a.core.setProfile({ name: 'Jo', email: 'jo@x.com', farm: 'Jo Farm', district: 'Bundaberg', variety: 'A16' });
  a.core.setOptIn(true); ok(SH.UUID_RE.test(a.core.deviceId()), 'device id is a UUID');
  a.core.enqueueMark(mark('m1', { sev: 'heavy', variety: 'A4', status: 'found' }), 'S1');
  a.core.enqueueMark(mark('m1'), 'S1');                                    // duplicate id ignored
  a.core.enqueueMark(mark('m2', { cat: 'irrigation', side: 'R' }), 'S1');
  a.core.enqueueMark(mark('m3', { cat: 'nutrition' }), 'S1'); a.core.enqueueMark(mark('m4', { cat: 'phytophthora' }), 'S1');
  a.core.enqueueMark(mark('m5', { imported: true }), 'S1'); a.core.enqueueMark({ lat: 1, lon: 1, side: 'L' }, 'S1');   // imported / no id: skipped
  eq(a.core.status().queuedMarks, 4);
  a.core.addTrack({ lat: -25.1, lon: 152.3, ts: 1700000000000 }, 'S1'); a.core.addTrack({ lat: -25.10001, lon: 152.3, ts: 1700000002000 }, 'S1');   // ~1 m: thinned out
  a.core.addTrack({ lat: -25.1003, lon: 152.3, ts: 1700000010000 }, 'S1');                                                                   // ~33 m: kept
  eq(a.core.status().queuedTrack, 2);
  // auto flush waits for marks to settle (severity chips window); force flush sends everything
  a.t.now += 1000; eq((await a.core.flush(false)).sentMarks, 0); eq(a.calls.length, 0);
  const r = await a.core.flush(true);
  ok(r.ok && r.sentMarks === 4 && r.sentTrack === 2, JSON.stringify(r)); eq(a.calls.length, 1);
  const c = a.calls[0], p = c.body;
  eq(c.url, CFG.INGEST_URL); eq(c.o.method, 'POST'); eq(c.o.headers['Content-Type'], 'application/json'); eq(c.o.headers['X-Ingest-Key'], 'mm-f1e22c16ccf1fe6050906fae');
  ok(SH.UUID_RE.test(p.deviceId)); eq(Object.keys(p).sort(), ['appVersion', 'consent', 'contact', 'deviceId', 'district', 'marks', 'sessionId', 'submittedAt', 'track', 'variety'].sort());
  eq(p.consent, true); eq(p.appVersion, 'v12'); eq(p.sessionId, 'S1'); eq(p.contact, { name: 'Jo', email: 'jo@x.com', farm: 'Jo Farm' }); eq(p.district, 'Bundaberg'); eq(p.variety, 'A16');
  eq(p.marks[0], { id: 'm1', lat: -25.1, lon: 152.3, accuracy: 4.2, side: 'L', category: 'mistletoe', time: '2023-11-14T22:13:20.000Z', status: 'found', severity: 'heavy', variety: 'A4' });
  eq(p.marks.map(m => m.category), ['mistletoe', 'broken-irrigation', 'nutrition', 'phytophthora']); eq(p.marks[1].side, 'R'); ok(!('severity' in p.marks[1]) && !('sid' in p.marks[1]) && !('qts' in p.marks[1]));
  eq(p.track.length, 2); eq(Object.keys(p.track[0]).sort(), ['lat', 'lon', 'time']);
  eq(a.core.status().queuedMarks, 0); eq(a.core.status().lastSync, a.t.now); eq(a.core.status().canRequest, true);
  // already sent -> never re-sent; later severity change re-queues just that mark
  a.core.enqueueMark(mark('m1'), 'S1'); eq(a.core.status().queuedMarks, 0);
  a.core.updateMark(mark('m1', { sev: 'light' }), 'S1'); eq(a.core.status().queuedMarks, 1);
  eq((await a.core.flush(true)).sentMarks, 1); eq(a.calls[1].body.marks[0].severity, 'light');

  // key header
  let b = mk({ cfg: { INGEST_KEY: '' } }); b.core.setOptIn(true); b.core.enqueueMark(mark('k1'), 'S1'); await b.core.flush(true);
  ok(!('X-Ingest-Key' in b.calls[0].o.headers), 'no key header when INGEST_KEY empty'); ok(!b.calls[0].body.contact && !b.calls[0].body.district && !b.calls[0].body.variety, 'optional fields omitted when empty');

  // failure keeps the queue, backs off; recovers
  let n500 = 0; let f = mk({ responder: () => (n500++ < 2 ? { ok: false, status: 503 } : new Error('x') && { ok: true, status: 200 }) });
  f.core.setOptIn(true); f.core.enqueueMark(mark('f1'), 'S1');
  let fr = await f.core.flush(true); ok(!fr.ok && /503/.test(fr.error)); eq(f.core.status().queuedMarks, 1); eq(f.core.status().fails, 1); eq(f.t.timers.length, 1); eq(f.t.timers[0].ms, 15000);
  fr = await f.core.flush(true); eq(f.core.status().fails, 2); eq(f.t.timers[f.t.timers.length - 1].ms, 30000);
  fr = await f.core.flush(true); ok(fr.ok); eq(f.core.status().queuedMarks, 0); eq(f.core.status().fails, 0);
  eq([1, 2, 3, 4, 5, 9, 12].map(x => SH.backoffMs(x)), [15000, 30000, 60000, 120000, 240000, 3600000, 3600000]);
  // network error (server not ready / CORS): queue kept, no throw
  let ne = mk({ responder: () => new TypeError('Failed to fetch') }); ne.core.setOptIn(true); ne.core.enqueueMark(mark('e1'), 'S1');
  fr = await ne.core.flush(true); ok(!fr.ok && /Failed to fetch/.test(ne.core.status().lastError)); eq(ne.core.status().queuedMarks, 1);
  // 404 (endpoint not live yet): queue kept too
  let nf = mk({ responder: () => ({ ok: false, status: 404 }) }); nf.core.setOptIn(true); nf.core.enqueueMark(mark('n1'), 'S1'); await nf.core.flush(true); eq(nf.core.status().queuedMarks, 1); eq(nf.core.status().canRequest, false);
  // offline: not attempted
  let off = mk(); off.core.setOptIn(true); off.core.enqueueMark(mark('o1'), 'S1'); off.t.online = false; eq((await off.core.flush(true)).skipped, 'offline'); eq(off.calls.length, 0);
  // persistence across reload
  const again = mk({ storage: off.st }); eq(again.core.status().queuedMarks, 1); eq(again.core.deviceId(), off.core.deviceId());
  // batches: <=5000 marks and <1 MB per request, several sessions; every mark sent exactly once
  let big = mk(); big.core.setOptIn(true);
  for (let i = 0; i < 5200; i++) big.core.enqueueMark(mark('b' + i, { ts: 1700000000000 + i, variety: 'A16', sev: 'light' }), 'SA'); big.core.enqueueMark(mark('z1'), 'SB');
  const br = await big.core.flush(true); eq(br.sentMarks, 5201);
  ok(big.calls.length >= 3 && big.calls.every(x => x.body.marks.length <= 5000 && Buffer.byteLength(x.o.body) <= 1000000), 'chunked under 5000 marks / 1 MB: ' + big.calls.map(x => x.body.marks.length + '/' + Buffer.byteLength(x.o.body)));
  const ids = big.calls.flatMap(x => x.body.marks.map(m => m.id)); eq(new Set(ids).size, 5201); eq(big.calls.map(x => x.body.sessionId).pop(), 'SB');
  ok(big.calls.every(x => new Set(x.body.marks.map(m => m.id)).size === x.body.marks.length), 'ids unique per submission');
  // 20000 track point limit per request (chunking)
  let tk = mk(); tk.core.setOptIn(true); const TQ = tk.core.queue(); for (let i = 0; i < 4000; i++) TQ.track.push({ lat: -25 + i * 1e-4, lon: 152, time: new Date(1700000000000 + i * 1000).toISOString(), sid: 'T' });
  await tk.core.flush(true); ok(tk.calls.length >= 1 && tk.calls.every(c => (c.body.track || []).length <= 20000), 'track chunk limit'); eq(tk.core.queue().track.length, 0);

  // remove (undo) before upload
  let u = mk(); u.core.setOptIn(true); u.core.enqueueMark(mark('u1'), 'S1'); u.core.removeMark('u1'); eq(u.core.status().queuedMarks, 0);

  // opt out stops uploads and clears queue (and pending access requests)
  let oo = mk({ responder: () => ({ ok: false, status: 500 }) }); oo.core.setOptIn(true); oo.core.enqueueMark(mark('x1'), 'S1'); oo.core.addTrack({ lat: 1, lon: 1, ts: 1 }, 'S1'); await oo.core.flush(true);
  oo.core.setOptIn(false); const q = oo.core.queue(); eq([q.marks.length, q.track.length, q.access.length], [0, 0, 0]); eq(oo.t.timers.length, 0, 'retry timer cancelled');
  const n0 = oo.calls.length; oo.core.enqueueMark(mark('x2'), 'S1'); eq((await oo.core.flush(true)).skipped, 'opted-out'); eq(oo.calls.length, n0);
  eq(JSON.parse(oo.st._d['agronica-mistletoe-queue-v1']).marks.length, 0, 'persisted queue cleared');

  // ---- collaborative data access request
  let ar = mk(); ar.core.setProfile({ name: 'Jo', farm: 'F', district: 'D' });
  eq((await ar.core.requestAccess({ name: 'Jo', email: 'a@b.co' })).error, 'not-opted-in'); ar.core.setOptIn(true);
  eq((await ar.core.requestAccess({ name: 'Jo', email: 'a@b.co' })).error, 'no-sync');
  ar.core.enqueueMark(mark('a1'), 'S1'); await ar.core.flush(true);
  eq((await ar.core.requestAccess({ name: 'Jo', email: 'nope' })).error, 'email'); eq((await ar.core.requestAccess({ name: 'Jo', email: '' })).error, 'email');
  const nCalls = ar.calls.length; const rr = await ar.core.requestAccess({ name: 'Jo', email: ' a@b.co ', message: 'please' });
  ok(rr.ok && rr.sent); eq(ar.calls[nCalls].url, CFG.ACCESS_URL);
  eq(ar.calls[nCalls].body, { deviceId: ar.core.deviceId(), name: 'Jo', email: 'a@b.co', farm: 'F', district: 'D', message: 'please' });
  // offline -> queued -> sent after sync cycle
  ar.t.online = false; const qr = await ar.core.requestAccess({ name: 'Jo', email: 'a@b.co' }); ok(qr.queued); eq(ar.core.status().pendingAccess, 1);
  ar.t.online = true; ar.core.enqueueMark(mark('a2'), 'S1'); await ar.core.flush(true); eq(ar.core.status().pendingAccess, 0); eq(ar.calls[ar.calls.length - 1].url, CFG.ACCESS_URL);
  // 404 -> mailto fallback with details prefilled
  let a4 = mk({ responder: u => (u === CFG.ACCESS_URL ? { ok: false, status: 404 } : { ok: true, status: 200 }) }); a4.core.setProfile({ name: 'Jo Bloggs', farm: 'Bloggs Mac', district: 'Gympie' }); a4.core.setOptIn(true); a4.core.enqueueMark(mark('a1'), 'S1'); await a4.core.flush(true);
  const fb = await a4.core.requestAccess({ name: 'Jo Bloggs', email: 'jo@x.com', message: 'Hello & thanks' });
  ok(!fb.ok && fb.fallback === 'mailto' && fb.mailto.startsWith('mailto:jonathan@agronicaag.com?subject='), fb.mailto);
  const body = decodeURIComponent(fb.mailto.split('&body=')[1]); ok(/Name: Jo Bloggs/.test(body) && /Email: jo@x.com/.test(body) && /Farm\/business: Bloggs Mac/.test(body) && /District: Gympie/.test(body) && /Hello & thanks/.test(body) && body.includes(a4.core.deviceId()));
  eq(a4.core.status().pendingAccess, 0);
  // server error (5xx) -> queued
  let a5 = mk({ responder: u => (u === CFG.ACCESS_URL ? { ok: false, status: 502 } : { ok: true, status: 200 }) }); a5.core.setOptIn(true); a5.core.enqueueMark(mark('a1'), 'S1'); await a5.core.flush(true);
  ok((await a5.core.requestAccess({ name: 'Jo', email: 'jo@x.com' })).queued);

  // ---- AgronicaWorld ingest contract
  const R = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => headers[k] ?? headers[k.toLowerCase()] ?? null }, json: () => Promise.resolve(body), text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });
  // deviceId: crypto.randomUUID, old non-UUID ids migrated (also when read from storage)
  ok(SH.UUID_RE.test(SH.uuid()) && SH.uuid() !== SH.uuid(), 'uuid()');
  const ms = mem(); ms.setItem('agronica-mistletoe-share-v1', JSON.stringify({ optIn: true, asked: true, deviceId: 'mm-0123456789abcdef01234567' }));
  let mg = mk({ storage: ms }); ok(SH.UUID_RE.test(mg.core.deviceId()) && mg.core.deviceId() !== 'mm-0123456789abcdef01234567', 'old id migrated'); ok(SH.UUID_RE.test(JSON.parse(ms._d['agronica-mistletoe-share-v1']).deviceId), 'migration persisted');
  mg.core.enqueueMark(mark('g1'), 'S1'); await mg.core.flush(true); ok(SH.UUID_RE.test(mg.calls[0].body.deviceId));
  // appVersion <= 32, sessionId <= 64 of [A-Za-z0-9._:-], consent === true, ids <= 64
  let sn = mk({ cfg: { APP_VERSION: 'x'.repeat(50) } }); sn.core.setOptIn(true); sn.core.enqueueMark(mark('i'.repeat(100)), 'S ome/odd\u00e9 session' + 'y'.repeat(100)); await sn.core.flush(true);
  const sp = sn.calls[0].body; eq(sp.appVersion.length, 32); ok(/^[A-Za-z0-9._:-]{1,64}$/.test(sp.sessionId) && sp.sessionId.length === 64, sp.sessionId); eq(sp.consent, true); ok(sp.marks[0].id.length === 64);
  eq(SH.cleanSid('a b/c?'), 'a-b-c-'); eq(SH.cleanSid(''), 'unknown'); ok(!('accuracy' in mk().core.buildPayload('S', [{ id: 'q', lat: 1, lon: 1, side: 'L', category: 'mistletoe', time: 't' }], []).marks[0]));
  // 429 + Retry-After: no more attempts until then; resumes afterwards
  let t429 = 0; let rl = mk({ responder: () => (t429++ === 0 ? R(429, { ok: false, error: 'rate limited' }, { 'Retry-After': '120' }) : R(200, { ok: true, received: 1 })) });
  rl.core.setOptIn(true); rl.core.enqueueMark(mark('r1'), 'S1'); let rr1 = await rl.core.flush(true);
  ok(!rr1.ok && /rate limited/.test(rr1.error)); eq(rl.core.status().queuedMarks, 1); eq(rl.t.timers[rl.t.timers.length - 1].ms, 120000, 'timer = Retry-After');
  rr1 = await rl.core.flush(true); eq(rr1.skipped, 'rate-limited'); eq(rl.calls.length, 1, 'no request while rate limited'); ok(rr1.waitMs > 100000 && rr1.waitMs <= 120000);
  rl.t.now += 121000; rr1 = await rl.core.flush(true); ok(rr1.ok); eq(rl.calls.length, 2); eq(rl.core.status().queuedMarks, 0);
  rl = mk({ responder: () => R(429, { ok: false, error: 'slow down' }, { 'Retry-After': new Date(1700000000000 + 30000).toUTCString() }) }); rl.core.setOptIn(true); rl.core.enqueueMark(mark('r1'), 'S1'); await rl.core.flush(true); eq(rl.core.status().retryAt, 1700000030000, 'HTTP-date Retry-After');
  // 400: bad marks are dropped (and logged), the good ones still go through; not retried forever
  const BAD = new Set(['bad2', 'bad7']); let badCalls = 0;
  let bd = mk({ responder: (u, o) => { badCalls++; const b = JSON.parse(o.body); return b.marks.some(m => BAD.has(m.id)) ? R(400, { ok: false, error: 'invalid mark' }) : R(200, { ok: true, received: b.marks.length }); } });
  bd.core.setOptIn(true); for (let i = 0; i < 10; i++) bd.core.enqueueMark(mark(i === 2 ? 'bad2' : i === 7 ? 'bad7' : 'good' + i), 'S1');
  const warn = console.warn; const warned = []; console.warn = (...a) => warned.push(a.join(' '));
  let br2 = await bd.core.flush(true); console.warn = warn;
  ok(br2.ok && br2.sentMarks === 8, JSON.stringify(br2)); eq(bd.core.queue().dropped.map(d => d.id).sort(), ['bad2', 'bad7']); eq(bd.core.status().queuedMarks, 0); eq(bd.core.status().dropped, 2); eq(warned.length, 2, 'logged');
  const before = badCalls; await bd.core.flush(true); eq(badCalls, before, 'dropped marks are not retried');
  // 400 for everything (payload-wide, e.g. bad key/format): do NOT throw the queue away
  let all400 = mk({ responder: () => R(400, { ok: false, error: 'bad payload' }) }); all400.core.setOptIn(true); for (let i = 0; i < 40; i++) all400.core.enqueueMark(mark('w' + i), 'S1');
  let ar4 = await all400.core.flush(true); ok(!ar4.ok); eq(all400.core.status().queuedMarks, 40); eq(all400.core.status().dropped, 0); ok(all400.calls.length <= 8, 'bounded requests: ' + all400.calls.length);
  // 413 -> split smaller
  let c413 = mk({ responder: (u, o) => (JSON.parse(o.body).marks.length > 3 ? R(413, { ok: false, error: 'too large' }) : R(200, { ok: true })) }); c413.core.setOptIn(true); for (let i = 0; i < 10; i++) c413.core.enqueueMark(mark('l' + i), 'S1');
  ok((await c413.core.flush(true)).ok); eq(c413.core.status().queuedMarks, 0); eq(c413.core.status().dropped, 0);
  // 401 / 403 / 405: keep the queue, back off
  for (const code of [401, 403, 405]) { const e = mk({ responder: () => R(code, { ok: false, error: 'nope' }) }); e.core.setOptIn(true); e.core.enqueueMark(mark('e'), 'S1'); const r = await e.core.flush(true); ok(!r.ok && r.error.includes('(' + code + ')')); eq(e.core.status().queuedMarks, 1); eq(e.core.status().dropped, 0); }
  // success body {ok:true,received:n}; {ok:false} with 200 is a failure
  let o200 = mk({ responder: () => R(200, { ok: false, error: 'weird' }) }); o200.core.setOptIn(true); o200.core.enqueueMark(mark('e'), 'S1'); ok(!(await o200.core.flush(true)).ok);

  // ---- access request needs a name; status check; downloads
  let ac = mk({ responder: (u, o) => (u === CFG.ACCESS_URL ? R(200, { ok: true, status: 'pending' }) : R(200, { ok: true, received: 1 })) }); ac.core.setOptIn(true); ac.core.enqueueMark(mark('a1'), 'S1'); await ac.core.flush(true);
  eq((await ac.core.requestAccess({ email: 'a@b.co' })).error, 'name'); eq((await ac.core.requestAccess({ name: '  ', email: 'a@b.co' })).error, 'name');
  const nreq = ac.calls.length; const ra = await ac.core.requestAccess({ name: 'Jo Bloggs', email: 'a@b.co', message: 'hi' }); ok(ra.ok && ra.status === 'pending');
  eq(ac.calls[nreq].body, { deviceId: ac.core.deviceId(), name: 'Jo Bloggs', email: 'a@b.co', farm: '', district: '', message: 'hi' }); eq(ac.calls[nreq].o.headers['X-Ingest-Key'], CFG.INGEST_KEY);
  eq(ac.core.accessInfo().status, 'pending'); eq(ac.core.canRequest(), false, 'no duplicate request while pending');
  const mkStatus = (j, code = 200) => { const g = []; const m = mk({ responder: (u, o) => { g.push({ u, o }); return u.startsWith(CFG.ACCESS_STATUS_URL) ? R(code, j) : R(200, { ok: true, received: 1 }); } }); m.g = g; return m; };
  for (const st of ['none', 'pending', 'rejected', 'revoked', 'expired']) { const x = mkStatus({ ok: true, status: st }); x.core.setOptIn(true); const i = await x.core.checkAccess(); eq(i.status, st); eq(x.g[0].u, CFG.ACCESS_STATUS_URL + '?deviceId=' + x.core.deviceId()); eq(x.g[0].o.method, 'GET'); eq(x.g[0].o.headers['X-Ingest-Key'], CFG.INGEST_KEY); eq(Object.keys(i.downloadUrls).length, 0); }
  const dls = { kml: 'https://170-64-148-102.sslip.io/api/mistletoe/pooled.kml?t=abc', csv: '/api/mistletoe/pooled.csv?t=abc' };
  const fut = new Date(1700000000000 + 86400000 * 5).toISOString(); let ap = mkStatus({ ok: true, status: 'approved', expiresAt: fut, downloadUrls: dls }); ap.core.setOptIn(true);
  let ai = await ap.core.checkAccess(); eq(ai.status, 'approved'); eq(ai.expiresAt, fut); eq(ai.downloadUrls, dls);
  ap.t.now += 86400000 * 6; eq(ap.core.accessInfo().status, 'expired', 'approved past expiresAt shows expired'); eq(Object.keys(ap.core.accessInfo().downloadUrls).length, 0); ap.t.now -= 86400000 * 6;
  const dlr = []; let dd = mk({ responder: (u, o) => { dlr.push({ u, o }); return u.startsWith(CFG.ACCESS_STATUS_URL) ? R(200, { ok: true, status: 'approved', expiresAt: fut, downloadUrls: dls }) : R(200, '<kml>pooled</kml>'); } }); dd.core.setOptIn(true); await dd.core.checkAccess();
  eq(await dd.core.fetchDownload('kml'), '<kml>pooled</kml>'); eq(await dd.core.fetchDownload('csv'), '<kml>pooled</kml>'); eq(dlr[dlr.length - 1].u, 'https://170-64-148-102.sslip.io/api/mistletoe/pooled.csv?t=abc'); eq(dlr[dlr.length - 1].o.headers['X-Ingest-Key'], CFG.INGEST_KEY);
  let off2 = mkStatus({ ok: true, status: 'approved', expiresAt: fut, downloadUrls: { kml: 'https://evil.example/x.kml' } }); off2.core.setOptIn(true); await off2.core.checkAccess(); await off2.core.fetchDownload('kml').catch(() => 0);
  ok(!off2.g.some(c => c.u.startsWith('https://evil.example') && c.o.headers['X-Ingest-Key']), 'ingest key never sent to another origin');
  let sf = mkStatus({ ok: false, error: 'Forbidden' }, 403); sf.core.setOptIn(true); eq((await sf.core.checkAccess()).status, 'none'); ok(/Forbidden/.test(sf.core.accessInfo().error));
  let opt = mkStatus({ ok: true, status: 'pending' }); eq((await opt.core.checkAccess()).status, 'none'); eq(opt.g.length, 0, 'no status call while opted out');
  opt.core.setOptIn(true); await opt.core.checkAccess(); opt.core.setOptIn(false); eq(opt.core.accessInfo().status, 'none', 'opt-out forgets access status');

  // ---- KML severity / variety round trip
  const sess = { marks: [
    { side: 'L', n: 1, name: 'L-1', lat: -27.1, lon: 153.1, acc: 3, ts: 1700000000000, sev: 'heavy', variety: 'A16' },
    { side: 'R', n: 2, name: 'R-2', lat: -27.2, lon: 153.2, acc: 3, ts: 1700000060000 },
    { side: 'R', n: 3, name: 'R-3', lat: -27.3, lon: 153.3, acc: 3, ts: 1700000120000, sev: 'light', variety: 'My <own> & variety' }], track: [] };
  const kml = KML.buildKml(sess, {});
  ok(/<Data name="severity"><value>heavy<\/value>/.test(kml) && /<Data name="variety"><value>A16<\/value>/.test(kml) && /Severity: Heavy/.test(kml) && /Variety: A16/.test(kml));
  eq((kml.match(/name="severity"/g) || []).length, 2);
  let pr = KML.parseKml(kml, DOMParser);
  eq(pr.marks.map(m => m.sev), ['heavy', undefined, 'light']); eq(pr.marks.map(m => m.variety), ['A16', undefined, 'My <own> & variety']);
  const fk = KML.buildFindKml({ points: pr.marks, track: [] }, {}); pr = KML.parseKml(fk, DOMParser); eq(pr.marks.map(m => m.sev), ['heavy', undefined, 'light']); eq(pr.marks[2].variety, 'My <own> & variety');
  eq(KML.parseKml(kml.replace(/<value>heavy</, '<value>BOGUS<'), DOMParser).marks[0].sev, undefined, 'unknown severity ignored');
  eq(KML.parseKml(kml.replace(/<value>heavy</, '<value>Heavy<'), DOMParser).marks[0].sev, 'heavy');

  // ---- Macca FAQ covers data sharing (extras.js needs a DOM; check source + keyword routing)
  const src = require('fs').readFileSync(require('path').join(__dirname, '../extras.js'), 'utf8');
  ok(/id: 'sharing'/.test(src) && /id: 'collab'/.test(src) && /id: 'severity'/.test(src) && /Nothing is uploaded/.test(src) === false, 'FAQ entries present, old "nothing is uploaded" claim removed');
  ok(/Sharers? can|combined district/.test(src));
  console.log('share tests passed:', n, 'assertions');
})().catch(e => { console.error('SHARE TEST FAILED', e); process.exit(1); });
