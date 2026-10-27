// Sharing core + KML severity/variety tests with a mocked fetch (no network). Run: NODE_PATH=<dir with @xmldom/xmldom> node tests/share.test.js
const assert = require('assert');
const { DOMParser } = require('@xmldom/xmldom');
const SH = require('../share.js'), KML = require('../kml.js'), CFG = require('../config.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// config
eq(CFG.INGEST_URL, 'https://170-64-148-102.sslip.io/api/mistletoe/submit'); eq(CFG.INGEST_KEY, ''); ok(/access-request$/.test(CFG.ACCESS_URL));

function mem() { const d = {}; return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, _d: d }; }
function mk(opts = {}) {
  const st = opts.storage || mem(), calls = [], t = { now: 1700000000000, online: true, timers: [] };
  const responder = opts.responder || (() => ({ ok: true, status: 200 }));
  const core = SH.createCore({ cfg: Object.assign({}, CFG, opts.cfg), storage: st, now: () => t.now, online: () => t.online,
    fetch: (url, o) => { calls.push({ url, o, body: JSON.parse(o.body) }); const r = responder(url, o, calls.length); return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); },
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
  a.core.setOptIn(true); ok(/^mm-[0-9a-f]{24}$/.test(a.core.deviceId()), 'random device id');
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
  eq(c.url, CFG.INGEST_URL); eq(c.o.method, 'POST'); eq(c.o.headers['Content-Type'], 'application/json'); ok(!('X-Ingest-Key' in c.o.headers), 'no key header when INGEST_KEY empty');
  eq(Object.keys(p).sort(), ['appVersion', 'consent', 'contact', 'deviceId', 'district', 'marks', 'sessionId', 'submittedAt', 'track', 'variety'].sort());
  eq(p.consent, true); eq(p.appVersion, 'v11'); eq(p.sessionId, 'S1'); eq(p.contact, { name: 'Jo', email: 'jo@x.com', farm: 'Jo Farm' }); eq(p.district, 'Bundaberg'); eq(p.variety, 'A16');
  eq(p.marks[0], { id: 'm1', lat: -25.1, lon: 152.3, accuracy: 4.2, side: 'L', category: 'mistletoe', time: '2023-11-14T22:13:20.000Z', status: 'found', severity: 'heavy', variety: 'A4' });
  eq(p.marks.map(m => m.category), ['mistletoe', 'broken-irrigation', 'nutrition', 'phytophthora']); eq(p.marks[1].side, 'R'); ok(!('severity' in p.marks[1]) && !('sid' in p.marks[1]) && !('qts' in p.marks[1]));
  eq(p.track.length, 2); eq(Object.keys(p.track[0]).sort(), ['lat', 'lon', 'time']);
  eq(a.core.status().queuedMarks, 0); eq(a.core.status().lastSync, a.t.now); eq(a.core.status().canRequest, true);
  // already sent -> never re-sent; later severity change re-queues just that mark
  a.core.enqueueMark(mark('m1'), 'S1'); eq(a.core.status().queuedMarks, 0);
  a.core.updateMark(mark('m1', { sev: 'light' }), 'S1'); eq(a.core.status().queuedMarks, 1);
  eq((await a.core.flush(true)).sentMarks, 1); eq(a.calls[1].body.marks[0].severity, 'light');

  // key header
  let b = mk({ cfg: { INGEST_KEY: 'sekrit' } }); b.core.setOptIn(true); b.core.enqueueMark(mark('k1'), 'S1'); await b.core.flush(true);
  eq(b.calls[0].o.headers['X-Ingest-Key'], 'sekrit'); ok(!b.calls[0].body.contact && !b.calls[0].body.district && !b.calls[0].body.variety, 'optional fields omitted when empty');

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
  // batches and multiple sessions
  let big = mk(); big.core.setOptIn(true);
  for (let i = 0; i < 450; i++) big.core.enqueueMark(mark('b' + i, { ts: 1700000000000 + i }), 'SA'); big.core.enqueueMark(mark('z1'), 'SB');
  const br = await big.core.flush(true); eq(br.sentMarks, 451); eq(big.calls.map(x => x.body.marks.length), [200, 200, 50, 1]); eq(big.calls.map(x => x.body.sessionId), ['SA', 'SA', 'SA', 'SB']);
  // remove (undo) before upload
  let u = mk(); u.core.setOptIn(true); u.core.enqueueMark(mark('u1'), 'S1'); u.core.removeMark('u1'); eq(u.core.status().queuedMarks, 0);

  // opt out stops uploads and clears queue (and pending access requests)
  let oo = mk({ responder: () => ({ ok: false, status: 500 }) }); oo.core.setOptIn(true); oo.core.enqueueMark(mark('x1'), 'S1'); oo.core.addTrack({ lat: 1, lon: 1, ts: 1 }, 'S1'); await oo.core.flush(true);
  oo.core.setOptIn(false); const q = oo.core.queue(); eq([q.marks.length, q.track.length, q.access.length], [0, 0, 0]); eq(oo.t.timers.length, 0, 'retry timer cancelled');
  const n0 = oo.calls.length; oo.core.enqueueMark(mark('x2'), 'S1'); eq((await oo.core.flush(true)).skipped, 'opted-out'); eq(oo.calls.length, n0);
  eq(JSON.parse(oo.st._d['agronica-mistletoe-queue-v1']).marks.length, 0, 'persisted queue cleared');

  // ---- collaborative data access request
  let ar = mk(); ar.core.setProfile({ name: 'Jo', farm: 'F', district: 'D' });
  eq((await ar.core.requestAccess({ email: 'a@b.co' })).error, 'not-opted-in'); ar.core.setOptIn(true);
  eq((await ar.core.requestAccess({ email: 'a@b.co' })).error, 'no-sync');
  ar.core.enqueueMark(mark('a1'), 'S1'); await ar.core.flush(true);
  eq((await ar.core.requestAccess({ email: 'nope' })).error, 'email'); eq((await ar.core.requestAccess({ email: '' })).error, 'email');
  const nCalls = ar.calls.length; const rr = await ar.core.requestAccess({ email: ' a@b.co ', message: 'please' });
  ok(rr.ok && rr.sent); eq(ar.calls[nCalls].url, CFG.ACCESS_URL);
  eq(ar.calls[nCalls].body, { deviceId: ar.core.deviceId(), name: 'Jo', email: 'a@b.co', farm: 'F', district: 'D', message: 'please' });
  // offline -> queued -> sent after sync cycle
  ar.t.online = false; const qr = await ar.core.requestAccess({ email: 'a@b.co' }); ok(qr.queued); eq(ar.core.status().pendingAccess, 1);
  ar.t.online = true; ar.core.enqueueMark(mark('a2'), 'S1'); await ar.core.flush(true); eq(ar.core.status().pendingAccess, 0); eq(ar.calls[ar.calls.length - 1].url, CFG.ACCESS_URL);
  // 404 -> mailto fallback with details prefilled
  let a4 = mk({ responder: u => (u === CFG.ACCESS_URL ? { ok: false, status: 404 } : { ok: true, status: 200 }) }); a4.core.setProfile({ name: 'Jo Bloggs', farm: 'Bloggs Mac', district: 'Gympie' }); a4.core.setOptIn(true); a4.core.enqueueMark(mark('a1'), 'S1'); await a4.core.flush(true);
  const fb = await a4.core.requestAccess({ email: 'jo@x.com', message: 'Hello & thanks' });
  ok(!fb.ok && fb.fallback === 'mailto' && fb.mailto.startsWith('mailto:jonathan@agronicaag.com?subject='), fb.mailto);
  const body = decodeURIComponent(fb.mailto.split('&body=')[1]); ok(/Name: Jo Bloggs/.test(body) && /Email: jo@x.com/.test(body) && /Farm\/business: Bloggs Mac/.test(body) && /District: Gympie/.test(body) && /Hello & thanks/.test(body) && body.includes(a4.core.deviceId()));
  eq(a4.core.status().pendingAccess, 0);
  // server error (5xx) -> queued
  let a5 = mk({ responder: u => (u === CFG.ACCESS_URL ? { ok: false, status: 502 } : { ok: true, status: 200 }) }); a5.core.setOptIn(true); a5.core.enqueueMark(mark('a1'), 'S1'); await a5.core.flush(true);
  ok((await a5.core.requestAccess({ email: 'jo@x.com' })).queued);

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
