// v14: "Find these marks" / "Use my current marks" - Find uses the live marking session in memory.
// Run: (cd repo && python3 -m http.server 8123 &) ; NODE_PATH=<dir with puppeteer-core> node tests/live.ui.test.js [baseUrl] [shotDir]
const puppeteer = require('puppeteer-core');
const fs = require('fs'), assert = require('assert');
const GEO = require('../geo.js');
const tileStub = require('./tile-stub.js');
const BASE = process.argv[2] || 'http://localhost:8123/';
const SHOTS = process.argv[3] || '/workspace/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = { lat: -27.5, lon: 153.0 };
(async () => {
  const tiles = await tileStub.start();
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  await browser.defaultBrowserContext().overridePermissions(new URL(BASE).origin, ['geolocation']);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument((u, l) => { try { localStorage.setItem('agronica-mistletoe-share-v1', '{"asked":true}'); localStorage.setItem('mm-tile-url', u); localStorage.setItem('mm-label-url', l); } catch (e) {} }, tiles.imagery, tiles.labels);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await page.createCDPSession();
  const setPos = p => cdp.send('Emulation.setGeolocationOverride', { latitude: p.lat, longitude: p.lon, accuracy: 5 });
  await setPos(T0);
  const txt = id => page.$eval('#' + id, e => e.textContent.trim());
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await sleep(500);
  await page.click('#startStop'); await sleep(1500);
  await page.click('#btnL'); await sleep(150);
  await setPos(GEO.destination(T0, 0, 20)); await sleep(2200);
  await page.click('#btnR'); await sleep(150);
  await page.click('#btnOL'); await sleep(300); await page.click('.cat-opt[data-cat="irrigation"]'); await sleep(300);
  assert.strictEqual(await txt('findTheseN'), '3');
  // layout: new button must not overlap LEFT/RIGHT, Other, controls
  const ov = await page.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const f = r('#findThese');
    return { h: f.height, hits: ['#btnL', '#btnR', '#btnOL', '#btnOR', '#startStop', '#undo', '#menuBtn', '#info', '#helpFab', '#msg'].filter(s => hit(f, r(s))), bigH: r('#btnL').height };
  });
  assert.deepStrictEqual(ov.hits, [], 'Find these overlaps: ' + ov.hits); assert.ok(ov.h >= 40 && ov.bigH > 200, JSON.stringify(ov));
  await page.screenshot({ path: SHOTS + '/mm-v14-mark-find-these.png' });
  const trackBefore = +(await txt('npts'));
  await page.click('#findThese'); await sleep(800);
  assert.strictEqual(await page.evaluate(() => document.body.getAttribute('data-view')), 'find');
  assert.strictEqual(await txt('progTxt'), '0 of 3 found');
  const dbg = await page.evaluate(() => { const d = Find._debug(); const s = d.F.sessions.find(x => x.id === d.F.activeId); return { id: s.id, cats: s.points.map(p => p.cat), n: d.F.sessions.length }; });
  assert.strictEqual(dbg.id, 'live'); assert.deepStrictEqual(dbg.cats, ['', '', 'irrigation']);
  assert.ok((await page.$eval('#catFilter', e => e.textContent)).includes('Broken irrigation1'), 'irrigation chip counted');
  // marking keeps running in background
  assert.strictEqual(await txt('status'), 'GPS OK');
  await page.click('#findStart'); await sleep(1200);
  // mark one found, then go back and add a mark: live refresh, status kept
  await page.click('#btnFound'); await sleep(300);
  assert.strictEqual(await txt('progTxt'), '1 of 3 found');
  await sleep(1500);
  await page.screenshot({ path: SHOTS + '/mm-v14-find-current.png' });
  await page.click('#tabMark'); await sleep(300);
  assert.ok(+(await txt('npts')) >= trackBefore, 'track continues');
  assert.strictEqual(await page.$eval('#startStop span', e => e.textContent), 'STOP', 'still marking');
  await setPos(GEO.destination(T0, 0, 40)); await sleep(2200);
  await page.click('#btnR'); await sleep(400);
  await page.click('#tabFind'); await sleep(500);
  assert.strictEqual(await txt('progTxt'), '1 of 4 found', 'new mark appears live in Find');
  // Use my current marks button in Find re-selects the live session without duplicating it
  await page.click('#useCurrent'); await sleep(300);
  assert.strictEqual(await page.evaluate(() => Find._debug().F.sessions.filter(s => s.id === 'live').length), 1);
  // still in marking session; reload keeps everything
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(600);
  assert.strictEqual(await txt('progTxt'), '1 of 4 found', 'persists across reload');
  assert.deepStrictEqual(errors, []);
  console.log('live.ui.test: all assertions passed');
  await browser.close(); tiles.close && tiles.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
