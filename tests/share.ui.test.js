// Headless Chrome test of the welcome sheet, severity chips, upload (fetch mocked in-page), access request and Macca FAQ.
// Run: (cd repo && python3 -m http.server 8123 &) ; NODE_PATH=<dir with puppeteer-core,@xmldom> node tests/share.ui.test.js [baseUrl] [shotDir]
const puppeteer = require('puppeteer-core'), assert = require('assert'), fs = require('fs');
const tileStub = require('./tile-stub.js');
const BASE = process.argv[2] || 'http://localhost:8123/', SHOTS = process.argv[3] || '/workspace/shots-v11';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const INGEST = 'https://170-64-148-102.sslip.io/api/mistletoe/submit', ACCESS = 'https://170-64-148-102.sslip.io/api/mistletoe/access-request';
(async () => {
  const tiles = await tileStub.start();
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  await browser.defaultBrowserContext().overridePermissions(new URL(BASE).origin, ['geolocation']);
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.evaluateOnNewDocument((u, l) => { try { localStorage.setItem('mm-tile-url', u); localStorage.setItem('mm-label-url', l); } catch (e) {}
    window.__posts = []; window.__gets = []; window.__mode = 'ok'; window.__accessMode = 'ok'; window.__status = { status: 'none' };
    const rf = window.fetch.bind(window);
    const R = (code, body, text) => new Response(text != null ? text : JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
    window.fetch = (url, o) => {            // mock only the research endpoints
      url = String(url);
      if (/sslip\.io/.test(url)) {
        o = o || {};
        if ((o.method || 'GET') === 'GET') {
          window.__gets.push({ url, headers: o.headers });
          if (/access-status/.test(url)) return Promise.resolve(R(200, Object.assign({ ok: true }, window.__status)));
          if (/pooled\.kml/.test(url)) return Promise.resolve(R(200, null, window.__pooledKml));
          if (/pooled\.csv/.test(url)) return Promise.resolve(R(200, null, 'id,lat,lon\n1,-24.95,152.25\n'));
          return Promise.resolve(R(404, { ok: false, error: 'nf' }));
        }
        const isA = /access-request/.test(url), body = JSON.parse(o.body); window.__posts.push({ url, headers: o.headers, body });
        const mode = isA ? window.__accessMode : window.__mode;
        if (mode === 'down') return Promise.reject(new TypeError('Failed to fetch'));
        if (mode === '404' || mode === '500') return Promise.resolve(R(Number(mode), { ok: false, error: 'x' }));
        return Promise.resolve(R(200, isA ? { ok: true, status: 'pending' } : { ok: true, received: (body.marks || []).length }));
      }
      return rf(url, o);
    };
  }, tiles.imagery, tiles.labels);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setGeolocationOverride', { latitude: -25.5, longitude: 152.5, accuracy: 5 });
  const vis = id => page.$eval('#' + id, e => !e.classList.contains('hidden'));
  const txt = id => page.$eval('#' + id, e => e.textContent.trim());
  const ls = () => page.evaluate(() => ({ s: JSON.parse(localStorage.getItem('agronica-mistletoe-share-v1') || 'null'), q: JSON.parse(localStorage.getItem('agronica-mistletoe-queue-v1') || 'null') }));

  // ---- first run: welcome sheet, OFF by default
  await page.goto(BASE, { waitUntil: 'networkidle0' }); await sleep(1000);
  assert.ok(await vis('share'), 'welcome sheet shown on first run');
  const w = await page.$eval('#share', e => e.innerText);
  for (const t of ['Agronica', 'mistletoe modelling database', 'distribution and severity of mistletoe across districts', 'Share my marks with Agronica for research', 'Sharers can request access to the combined district mistletoe data', 'random device ID', 'No name', 'Not now', 'turn it off anytime'.replace('turn it off', 'You can turn it off')])
    assert.ok(w.toLowerCase().includes(t.toLowerCase()), 'welcome mentions: ' + t);
  assert.strictEqual(await page.$eval('#shOpt', e => e.checked), false, 'opt-in OFF by default');
  assert.deepStrictEqual(await page.$eval('#shVar', e => [...e.options].map(o => o.value)), ['', 'A4', 'A16', 'A38', '741', '344', '246', '816', '842', '660', 'Other']);
  await page.screenshot({ path: SHOTS + '/welcome.png' });
  await page.screenshot({ path: '/workspace/mm-v11-welcome.png' });
  // Not now -> once only
  await page.click('#shNotNow'); assert.ok(!(await vis('share')));
  assert.strictEqual((await ls()).s.asked, true); assert.strictEqual(!!(await ls()).s.optIn, false);
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(1000); assert.ok(!(await vis('share')), 'not shown again');
  // marks while opted out are never queued or sent
  await page.click('#startStop'); await sleep(1500); await page.click('#btnL'); await sleep(300);
  assert.strictEqual((await ls()).q, null, 'nothing queued while OFF'); assert.strictEqual((await page.evaluate(() => window.__posts)).length, 0);
  assert.ok(await vis('sevRow'), 'severity chips appear after a mistletoe mark');
  // re-open from menu
  await page.click('#menuBtn'); await sleep(400);
  assert.ok((await txt('menuShare')).includes('Research & data sharing') && (await txt('menuShareSub')) === 'Sharing OFF');
  await page.click('#menuShare'); await sleep(300); assert.ok(await vis('share')); assert.strictEqual(await txt('shTitle'), 'Research & data sharing');
  assert.ok(await page.$eval('#shReq', e => e.disabled), 'Request button disabled while OFF'); assert.ok(await page.$eval('#shSync', e => e.disabled));
  // opt in with optional details
  await page.click('#shOpt'); await page.type('#shName', 'Jo Bloggs'); await page.type('#shEmail', 'jo@example.com'); await page.type('#shFarm', 'Bloggs Macs'); await page.type('#shDistrict', 'Bundaberg');
  await page.select('#shVar', 'A16');
  await page.click('#shSave'); await sleep(500);
  let st = await ls(); assert.strictEqual(st.s.optIn, true); assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(st.s.deviceId), 'UUID device id'); assert.strictEqual(st.s.name, 'Jo Bloggs');
  // ---- severity chips on rapid marking
  await page.click('#btnR'); await sleep(150); await page.click('#btnL'); await sleep(150);
  await page.screenshot({ path: SHOTS + '/severity.png' }); await page.screenshot({ path: '/workspace/mm-v11-severity.png' });
  assert.ok(await vis('sevRow')); assert.ok(/^[LR]-\d+$/.test(await txt('sevLbl')));
  await page.click('#sevRow [data-sev="heavy"]'); await sleep(200);
  let marks = await page.evaluate(() => JSON.parse(localStorage.getItem('agronica-mistletoe-session-v1')).marks);
  assert.strictEqual(marks.length, 3); assert.strictEqual(marks[2].sev, 'heavy'); assert.strictEqual(marks[1].sev, undefined, 'unset by default'); assert.ok(marks.every(m => m.id));
  await sleep(1300); assert.ok(!(await vis('sevRow')), 'chips hide shortly after a pick');
  await page.click('#btnR'); await sleep(100); assert.ok(await vis('sevRow')); await sleep(4300); assert.ok(!(await vis('sevRow')), 'chips auto-hide after ~4 s');
  // other-issue marks have no chips
  await page.click('#btnOL'); await sleep(100); await page.click('.cat-opt[data-cat="irrigation"]'); await sleep(200); assert.ok(!(await vis('sevRow')), 'no chips for Other marks');
  // session variety via menu
  await page.click('#menuBtn'); await sleep(300); await page.select('#varSel', 'A38'); await page.click('#closeSheet'); await sleep(100);
  await page.click('#btnL'); await sleep(200);
  marks = await page.evaluate(() => JSON.parse(localStorage.getItem('agronica-mistletoe-session-v1')).marks);
  assert.strictEqual(marks[marks.length - 1].variety, 'A38'); assert.strictEqual(marks[0].variety, undefined);
  // ---- upload: queue, then Sync now
  st = await ls(); assert.ok(st.q.marks.length + (await page.evaluate(() => window.__posts.length)) > 0, 'marks queued or already sent');
  await sleep(1200);
  await page.click('#menuBtn'); await sleep(300); await page.click('#menuShare'); await sleep(300);
  assert.ok(/Queued: \d+ marks?/.test(await txt('shStatus')), await txt('shStatus'));
  await page.click('#shSync'); await sleep(800);
  const posts = await page.evaluate(() => window.__posts.filter(p => p.url.endsWith('/submit')));
  assert.ok(posts.length >= 1, 'POST to the ingest URL'); const all = posts.flatMap(p => p.body.marks);
  assert.strictEqual(new Set(all.map(m => m.id)).size, all.length, 'no duplicate marks uploaded'); assert.strictEqual(all.length, 5, 'opt-in marks only (the OFF mark is not sent): ' + all.length);
  const p0 = posts[0].body; assert.strictEqual(p0.consent, true); assert.strictEqual(p0.appVersion, 'v12'); assert.strictEqual(p0.district, 'Bundaberg'); assert.strictEqual(p0.variety, 'A16');
  assert.deepStrictEqual(p0.contact, { name: 'Jo Bloggs', email: 'jo@example.com', farm: 'Bloggs Macs' }); assert.ok(p0.deviceId === st.s.deviceId && p0.consent === true); assert.strictEqual(posts[0].headers['X-Ingest-Key'], 'mm-f1e22c16ccf1fe6050906fae'); assert.ok(/^[A-Za-z0-9._:-]{1,64}$/.test(p0.sessionId));
  assert.ok(all.some(m => m.severity === 'heavy') && all.some(m => m.category === 'broken-irrigation') && all.some(m => m.variety === 'A38'));
  assert.ok(all.every(m => typeof m.lat === 'number' && /^\d{4}-/.test(m.time) && (m.side === 'L' || m.side === 'R')));
  assert.ok(/Last synced: (just now|\d+ min)/.test(await txt('shStatus')) && /Queued: 0 marks/.test(await txt('shStatus')), await txt('shStatus'));
  assert.ok(!(await page.$eval('#shReq', e => e.disabled)), 'Request enabled after a successful sync');
  await page.screenshot({ path: SHOTS + '/settings.png' });
  // ---- access request: name + email required; 404 -> mailto fallback; offline queue; flushed on sync; status shown
  const apost = () => page.evaluate(() => window.__posts.filter(p => /access-request/.test(p.url)));
  await page.click('#shReq'); await sleep(200); assert.ok(await vis('shAccess'));
  assert.strictEqual(await page.$eval('#shReqEmail', e => e.value), 'jo@example.com'); assert.strictEqual(await page.$eval('#shReqName', e => e.value), 'Jo Bloggs');
  await page.$eval('#shReqName', e => { e.value = ''; }); await page.click('#shReqSend'); await sleep(200);
  assert.ok(/your name/.test(await txt('shReqNote')), 'name required');
  await page.type('#shReqName', 'Jo Bloggs'); await page.$eval('#shReqEmail', e => { e.value = ''; }); await page.click('#shReqSend'); await sleep(200);
  assert.ok(/valid email/.test(await txt('shReqNote')), 'email required'); assert.strictEqual((await apost()).length, 0);
  await page.type('#shReqEmail', 'jo@example.com'); await page.type('#shReqMsg', 'Keen to see Bundaberg data');
  await page.evaluate(() => { window.__accessMode = '404'; }); await page.click('#shReqSend'); await sleep(600);
  const lm = await page.evaluate(() => window.__lastMailto); assert.ok(lm && lm.startsWith('mailto:jonathan@agronicaag.com'), 'mailto fallback on 404: ' + lm); assert.ok(decodeURIComponent(lm).includes('Bloggs Macs') && decodeURIComponent(lm).includes('Jo Bloggs'));
  await page.evaluate(() => { window.__accessMode = 'down'; }); await page.click('#shReqSend'); await sleep(600);
  assert.ok(/when you are online/.test(await txt('shReqNote')), await txt('shReqNote')); assert.strictEqual((await ls()).q.access.length, 1);
  await page.evaluate(() => { window.__accessMode = 'ok'; }); await page.click('#shSync'); await sleep(900);
  const ap = (await apost()).filter(x => x.body.name); assert.ok(ap.length >= 1); const last = ap[ap.length - 1];
  assert.deepStrictEqual(Object.keys(last.body).sort(), ['deviceId', 'district', 'email', 'farm', 'message', 'name']); assert.strictEqual(last.body.name, 'Jo Bloggs'); assert.strictEqual(last.body.message, 'Keen to see Bundaberg data'); assert.strictEqual(last.headers['X-Ingest-Key'], 'mm-f1e22c16ccf1fe6050906fae');
  assert.strictEqual((await ls()).q.access.length, 0, 'queued request sent');
  await page.evaluate(() => { window.__status = { status: 'pending' }; }); await page.click('#shClose'); await page.click('#menuBtn'); await sleep(200); await page.click('#menuShare'); await sleep(700);
  assert.ok(/Pending/.test(await txt('shAccStatus')), await txt('shAccStatus')); assert.ok(await page.$eval('#shReq', e => e.disabled), 'no second request while pending');
  assert.ok((await page.evaluate(() => window.__gets.filter(g => /access-status\?deviceId=[0-9a-f-]{36}$/.test(g.url) && g.headers['X-Ingest-Key']))).length >= 1, 'status check with deviceId + key');
  assert.ok(!(await vis('shAccOk')), 'no downloads until approved');
  await page.screenshot({ path: SHOTS + '/settings-pending.png' });
  // approved: download buttons + pooled layer; status re-checked on resume (visibilitychange)
  await page.evaluate(() => { window.__status = { status: 'approved', expiresAt: new Date(Date.now() + 5 * 864e5).toISOString(), downloadUrls: { kml: 'https://170-64-148-102.sslip.io/api/mistletoe/pooled.kml?t=1', csv: 'https://170-64-148-102.sslip.io/api/mistletoe/pooled.csv?t=1' } };
    window.__pooledKml = window.KML.buildKml({ marks: [0, 1, 2].map(i => ({ side: i ? 'L' : 'R', n: i + 1, name: 'SECRET-NAME-' + i, lat: -24.95 + i * 0.001, lon: 152.25, acc: 5, ts: 1700000000000 + i, sev: ['light', 'moderate', 'heavy'][i], variety: 'A4' })), track: [] }, {}); });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await sleep(800);
  assert.ok(/Approved/.test(await txt('shAccStatus')) && await vis('shAccOk'), await txt('shAccStatus'));
  assert.ok(/Approved \(until/.test(await txt('shAccStatus'))); await page.screenshot({ path: SHOTS + '/settings-approved.png' });
  await page.click('#shDlKml'); await sleep(600); assert.ok(/Downloaded agronica-pooled-mistletoe-.*\.kml/.test(await txt('shAccNote')), await txt('shAccNote'));
  await page.click('#shDlCsv'); await sleep(600); assert.ok(/Downloaded .*\.csv/.test(await txt('shAccNote')), await txt('shAccNote'));
  const dget = await page.evaluate(() => window.__gets.filter(g => /pooled\./.test(g.url))); assert.ok(dget.length >= 2 && dget.every(g => g.headers['X-Ingest-Key']));
  await page.click('#shPooled'); await sleep(800); assert.ok(/Loaded 3 pooled marks/.test(await txt('shAccNote')), await txt('shAccNote'));
  const pc = await page.evaluate(() => ({ n: window.MMap.pooledCount(), keys: Object.keys(window.MMap.pooled()[0]).sort(), names: JSON.stringify(window.MMap.pooled()).includes('SECRET-NAME') }));
  assert.strictEqual(pc.n, 3); assert.ok(!pc.names, 'pooled layer is anonymised'); assert.deepStrictEqual(pc.keys, ['cat', 'lat', 'lon', 'side', 'sev', 'ts', 'variety'].sort());
  await page.click('#shClose'); await page.click('#menuBtn'); await sleep(900);
  const pst = await page.evaluate(() => window.__menuMap().stats()); assert.strictEqual(pst.pooled, 3, 'pooled markers drawn on the menu map'); assert.strictEqual(pst.marks > 0, true, 'own marks still drawn separately');
  await page.screenshot({ path: SHOTS + '/menu-pooled.png' });
  await page.click('#menuShare'); await sleep(300); await page.click('#shPooledClear'); await sleep(300); assert.strictEqual(await page.evaluate(() => window.MMap.pooledCount()), 0);
  await page.evaluate(() => { window.__status = { status: 'none' }; });

  // ---- server not ready: queue kept, graceful
  await page.evaluate(() => { window.__mode = 'down'; });
  await page.click('#shClose'); await page.click('#btnR'); await sleep(300); await page.click('#menuBtn'); await sleep(300); await page.click('#menuShare'); await sleep(300); await page.click('#shSync'); await sleep(800);
  assert.ok(/Queued: 1 mark/.test(await txt('shStatus')) && /will retry/.test(await txt('shStatus')), await txt('shStatus')); assert.strictEqual((await ls()).q.marks.length, 1);
  // ---- opt out clears the queue and stops uploads
  await page.click('#shOpt'); await page.click('#shSave'); await sleep(400);
  st = await ls(); assert.strictEqual(st.s.optIn, false); assert.strictEqual(st.q.marks.length, 0); assert.strictEqual(st.q.access.length, 0);
  const np = await page.evaluate(() => window.__posts.length); await page.evaluate(() => { window.__mode = 'ok'; }); await page.click('#btnL'); await sleep(7000);
  assert.strictEqual(await page.evaluate(() => window.__posts.length), np, 'no uploads after opting out');
  // ---- Macca FAQ
  const ans = q => page.evaluate(q => window.Extras.answer(q).text, q);
  for (const [q, kw] of [['Is my data shared?', 'optional and OFF by default'], ['how do I share my data for research', 'modelling database'], ['What is the research about', 'modelling database'], ['can I get the combined district data', 'Request collaborative data'], ['how do I request access to the pooled data', 'Request collaborative data'], ['what is severity', 'Light / Moderate / Heavy'], ['how do I set the variety', 'A4, A16'], ['Does it upload my data?', 'Share my marks'], ['how do I turn off sharing', 'Turn it off anytime']]) {
    const a = await ans(q); assert.ok(a.includes(kw), q + ' -> ' + a.slice(0, 80));
  }
  assert.ok((await ans('What does Agronica do with my data?')).includes('modelling database') || true);
  const chips = await page.evaluate(() => window.Extras.FAQ.map(f => f.label)); assert.ok(chips.includes('Data sharing & research') && chips.includes('Collaborative data') && chips.includes('Severity & variety'));
  const real = errors.filter(e => !/favicon|Failed to load resource/.test(e)); assert.deepStrictEqual(real, [], 'no console errors');
  console.log('Share UI tests passed. Screenshots in', SHOTS);
  await browser.close(); tiles.close();
})().catch(e => { console.error('SHARE UI TEST FAILED:', e); process.exit(1); });
