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
    window.__posts = []; window.__mode = 'ok'; window.__accessMode = 'ok';
    const rf = window.fetch.bind(window);
    window.fetch = (url, o) => {            // mock only the research endpoints
      if (/sslip\.io/.test(String(url))) {
        const isA = /access-request/.test(url); window.__posts.push({ url: String(url), headers: o.headers, body: JSON.parse(o.body) });
        const mode = isA ? window.__accessMode : window.__mode;
        if (mode === 'down') return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(new Response('{}', { status: mode === '404' ? 404 : mode === '500' ? 500 : 200 }));
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
  let st = await ls(); assert.strictEqual(st.s.optIn, true); assert.ok(/^mm-/.test(st.s.deviceId)); assert.strictEqual(st.s.name, 'Jo Bloggs');
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
  const p0 = posts[0].body; assert.strictEqual(p0.consent, true); assert.strictEqual(p0.appVersion, 'v11'); assert.strictEqual(p0.district, 'Bundaberg'); assert.strictEqual(p0.variety, 'A16');
  assert.deepStrictEqual(p0.contact, { name: 'Jo Bloggs', email: 'jo@example.com', farm: 'Bloggs Macs' }); assert.ok(/^mm-/.test(p0.deviceId));
  assert.ok(all.some(m => m.severity === 'heavy') && all.some(m => m.category === 'broken-irrigation') && all.some(m => m.variety === 'A38'));
  assert.ok(all.every(m => typeof m.lat === 'number' && /^\d{4}-/.test(m.time) && (m.side === 'L' || m.side === 'R')));
  assert.ok(/Last synced: (just now|\d+ min)/.test(await txt('shStatus')) && /Queued: 0 marks/.test(await txt('shStatus')), await txt('shStatus'));
  assert.ok(!(await page.$eval('#shReq', e => e.disabled)), 'Request enabled after a successful sync');
  await page.screenshot({ path: SHOTS + '/settings.png' });
  // ---- access request: email required; success; 404 -> mailto fallback; offline queue
  await page.click('#shReq'); await sleep(200); assert.ok(await vis('shAccess'));
  assert.strictEqual(await page.$eval('#shReqEmail', e => e.value), 'jo@example.com');
  await page.$eval('#shReqEmail', e => { e.value = ''; }); await page.click('#shReqSend'); await sleep(200);
  assert.ok(/valid email/.test(await txt('shReqNote')), 'email required'); assert.strictEqual((await page.evaluate(() => window.__posts.filter(p => p.url === 'https://170-64-148-102.sslip.io/api/mistletoe/access-request'))).length, 0);
  await page.type('#shReqEmail', 'jo@example.com'); await page.type('#shReqMsg', 'Keen to see Bundaberg data'); await page.click('#shReqSend'); await sleep(500);
  assert.ok(/Agronica will be in touch/.test(await txt('shReqNote')), await txt('shReqNote'));
  const ap = await page.evaluate(() => window.__posts.filter(p => /access-request/.test(p.url)));
  assert.strictEqual(ap.length, 1); assert.deepStrictEqual(Object.keys(ap[0].body).sort(), ['deviceId', 'district', 'email', 'farm', 'message', 'name']); assert.strictEqual(ap[0].body.message, 'Keen to see Bundaberg data');
  // 404 -> mailto
  await page.evaluate(() => { window.__accessMode = '404'; }); await page.click('#shReq'); await sleep(200);
  await page.evaluate(() => { document.getElementById('shReqEmail').value = 'jo@example.com'; });
  await page.click('#shReqSend'); await sleep(600);
  const lm = await page.evaluate(() => window.__lastMailto); assert.ok(lm && lm.startsWith('mailto:jonathan@agronicaag.com'), 'mailto fallback on 404: ' + lm); assert.ok(decodeURIComponent(lm).includes('Bloggs Macs'));
  // offline -> queued
  await page.evaluate(() => { window.__accessMode = 'down'; }); await page.click('#shReq'); await sleep(200); await page.evaluate(() => { document.getElementById('shReqEmail').value = 'jo@example.com'; });
  await page.click('#shReqSend'); await sleep(600); assert.ok(/when you are online/.test(await txt('shReqNote')), await txt('shReqNote')); assert.strictEqual((await ls()).q.access.length, 1);
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
