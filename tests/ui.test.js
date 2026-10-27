// Headless Chrome UI test with simulated geolocation.
// Run: (cd repo && python3 -m http.server 8123 &) ; NODE_PATH=<dir with puppeteer-core,@xmldom> node tests/ui.test.js [baseUrl] [shotDir]
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), assert = require('assert');
const GEO = require('../geo.js');
const tileStub = require('./tile-stub.js');
const BASE = process.argv[2] || 'http://localhost:8123/';
const SHOTS = process.argv[3] || '/workspace/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const DL = fs.mkdtempSync('/tmp/dl-');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = { lat: -27.5, lon: 153.0 };
const P = (b, d) => GEO.destination(T0, b, d);

// sample KML in the app's own format + foreign points
const own = require('../kml.js').buildKml({ marks: [
  { side: 'L', n: 1, name: 'L-1', ...P(0, 60), acc: 4, ts: 1700000000000 },
  { side: 'R', n: 2, name: 'R-2', ...P(0, 150), acc: 4, ts: 1700000100000 }], track: [] });
const foreign = own.replace('</Folder>', '<Placemark><name>Gum tree 9</name><Point><coordinates>' + P(90, 80).lon + ',' + P(90, 80).lat + ',0</coordinates></Point></Placemark></Folder>');
fs.writeFileSync('/tmp/sample.kml', foreign);

(async () => {
  const tiles = await tileStub.start();
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, ['geolocation']);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.evaluateOnNewDocument(() => { try { if (!localStorage.getItem('agronica-mistletoe-share-v1')) localStorage.setItem('agronica-mistletoe-share-v1', '{"asked":true}'); } catch (e) { /* ignore */ } });   // welcome sheet is covered by tests/share.ui.test.js
  await page.evaluateOnNewDocument((u, l) => { try { localStorage.setItem('mm-tile-url', u); localStorage.setItem('mm-label-url', l); } catch (e) { /* opaque/error documents */ } }, tiles.imagery, tiles.labels);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: false });
  // record vibration / beeps / speech; hide canShare so exports use plain download
  await page.evaluateOnNewDocument(() => {
    window.__ev = [];
    navigator.vibrate = p => { window.__ev.push(['vib', JSON.stringify(p)]); return true; };
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    const OC = window.AudioContext;
    window.AudioContext = class extends OC { createOscillator() { const o = super.createOscillator(); const f = o.start.bind(o); o.start = t => { window.__ev.push(['beep', Math.round(o.frequency.value)]); f(t); }; return o; } };
    window.speechSynthesis.speak = u => window.__ev.push(['say', u.text]);
    window.SpeechSynthesisUtterance = window.SpeechSynthesisUtterance || function (t) { this.text = t; };
  });
  const setPos = async p => cdp.send('Emulation.setGeolocationOverride', { latitude: p.lat, longitude: p.lon, accuracy: 5 });
  await setPos(T0);
  const txt = id => page.$eval('#' + id, e => e.textContent.trim());
  const evs = () => page.evaluate(() => { const e = window.__ev; window.__ev = []; return e; });

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await sleep(500);
  await page.screenshot({ path: SHOTS + '/1-mark-idle.png' });

  // ----- Mark mode -----
  await page.click('#startStop'); await sleep(1500);
  assert.strictEqual(await txt('status'), 'GPS OK');
  await page.click('#btnL'); await sleep(100); await page.click('#btnR'); await sleep(400);
  assert.ok((await txt('nmarks')).startsWith('2 (L1 / R1)'), await txt('nmarks'));
  await page.screenshot({ path: SHOTS + '/2-mark-running.png' });
  const big = await page.$eval('#btnL', e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
  assert.ok(big[0] > 150 && big[1] > 250, 'LEFT button is huge: ' + big);
  // ad strip (slim, ~44px) + About/Help links never cover or shrink the controls
  const lay = await page.evaluate(() => {
    const r = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const hit = (a, b) => !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);
    const ctr = ['#btnL', '#btnR', '#btnOL', '#btnOR', '#startStop', '#undo', '#menuBtn', '#info'].map(s => [s, r(s)]);
    const over = ['#helpFab', '#aboutLink'].map(s => [s, r(s)]);
    return { ad: r('#adbar'), tabs: r('.tabs'), over: over.map(o => [o[0], ctr.filter(c => hit(o[1], c[1])).map(c => c[0])]), helpFab: r('#helpFab'), about: r('#aboutLink'), vis: !document.querySelector('#adbar').classList.contains('hidden') };
  });
  console.log('Layout:', JSON.stringify(lay));
  assert.ok(lay.vis && lay.ad.h >= 42 && lay.ad.h <= 46, 'ad strip is ~44px: ' + lay.ad.h);
  assert.ok(Math.abs(lay.ad.b - lay.tabs.y) < 2, 'ad strip sits directly above the tab bar');
  assert.deepStrictEqual(lay.over.flatMap(o => o[1]), [], 'help/about links do not cover controls: ' + JSON.stringify(lay.over));
  assert.ok(lay.helpFab.w >= 40 && lay.helpFab.h >= 40 && lay.about.h >= 24, 'help + about links are tappable');
  await page.click('#undo');
  // ----- Other Left / Other Right (category marks) -----
  const ob = await page.$$eval('#otherBtns button', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), r.width, r.height]; }));
  assert.deepStrictEqual(ob.map(o => o[0]), ['Other Left', 'Other Right']);
  assert.ok(ob.every(o => o[1] > 120 && o[2] >= 56), 'Other buttons are big enough to hit: ' + JSON.stringify(ob));
  const bigH = await page.$eval('#btnL', e => e.getBoundingClientRect().height), othH = ob[0][2];
  assert.ok(othH < bigH / 2, 'Other buttons are smaller than LEFT/RIGHT: ' + othH + ' vs ' + bigH);
  const marksBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('agronica-mistletoe-session-v1')).marks.length);
  await page.click('#btnOL'); await sleep(300);
  assert.ok(await page.$eval('#catSheet', e => !e.classList.contains('hidden')), 'category sheet opens');
  assert.deepStrictEqual(await page.$$eval('.cat-opt', o => o.map(x => x.textContent.trim())), ['Broken irrigation', 'Phytophthora treatment', 'Nutritional issue']);
  assert.strictEqual(await txt('catCancel'), 'Cancel'); assert.strictEqual(await txt('catTitle'), 'Other Left');
  assert.ok((await page.$$eval('.cat-opt', o => o.map(x => x.getBoundingClientRect().height))).every(h => h >= 60), 'big options');
  await page.screenshot({ path: SHOTS + '/2b-mark-category-sheet.png' });
  await page.click('#catCancel'); await sleep(200);          // cancel records nothing
  assert.ok(await page.$eval('#catSheet', e => e.classList.contains('hidden')));
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('agronica-mistletoe-session-v1')).marks.length), marksBefore);
  // mark taken at the position where the button was tapped (even if we move before choosing)
  await setPos(T0); await sleep(500);
  await page.click('#btnOL'); await sleep(200);
  await setPos(P(0, 25)); await sleep(700);
  await page.click('.cat-opt[data-cat="irrigation"]'); await sleep(400);
  await setPos(T0); await sleep(500);
  await page.click('#btnOR'); await sleep(200); assert.strictEqual(await txt('catTitle'), 'Other Right');
  await page.click('.cat-opt[data-cat="phytophthora"]'); await sleep(300);
  await page.click('#btnOL'); await sleep(200); await page.click('.cat-opt[data-cat="nutrition"]'); await sleep(300);
  const sess = await page.evaluate(() => JSON.parse(localStorage.getItem('agronica-mistletoe-session-v1')));
  const oth = sess.marks.slice(marksBefore);
  assert.deepStrictEqual(oth.map(m => [m.side, m.cat]), [['L', 'irrigation'], ['R', 'phytophthora'], ['L', 'nutrition']]);
  assert.ok(/^L-\d+ Broken irrigation$/.test(oth[0].name) && /^R-\d+ Phytophthora treatment$/.test(oth[1].name) && /^L-\d+ Nutritional issue$/.test(oth[2].name), oth.map(m => m.name).join('|'));
  assert.ok(Math.abs(oth[0].lat - T0.lat) < 2e-5, 'category mark uses the position at tap time');
  assert.ok(/\+ 3 other$/.test(await txt('nmarks')), await txt('nmarks'));
  // menu list shows the category; export carries styles/category and round-trips
  await page.click('#menuBtn'); await sleep(400);
  const lst = await page.$$eval('#list li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(lst.some(x => x.includes('Broken irrigation')) && lst.some(x => x.includes('Phytophthora treatment')) && lst.some(x => x.includes('Nutritional issue')), JSON.stringify(lst));
  await sleep(1200);
  const mm = await page.evaluate(() => window.__menuMap().stats());
  console.log('Menu map:', JSON.stringify({ ...mm, markers: mm.markers.length }));
  assert.ok(mm.built && mm.marks === marksBefore + 3 && mm.tracks >= 1, 'menu map shows track + all marks: ' + JSON.stringify({ ...mm, markers: 0 }));
  assert.ok(mm.hasPos && mm.hasAccuracy, 'menu map shows current position + accuracy circle');
  assert.ok(mm.loadedTiles > 0 && mm.tileSrc.startsWith('http://127.0.0.1:'), 'satellite tiles loaded (stubbed): ' + mm.tileSrc);
  assert.ok(mm.attribution.includes('Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'), 'Esri attribution: ' + mm.attribution);
  assert.ok(await page.$eval('#plotLegend', e => e.querySelectorAll('.lg').length >= 5), 'legend kept in menu');
  assert.ok(mm.markers.some(m => /<polygon points="14,3.5/.test(m.html)) && mm.markers.some(m => /<polygon points="14,3.8/.test(m.html)) && mm.markers.some(m => /<rect/.test(m.html)), 'per-type marker shapes (diamond/triangle/square)');
  assert.ok(mm.markers.some(m => /#0a8fb5/.test(m.html)) && mm.markers.some(m => /#c19bff/.test(m.html)), 'L darker / R lighter per-type colours on the map');
  await page.screenshot({ path: SHOTS + '/2c-menu-categories.png' });
  await page.evaluate(() => document.querySelector('#menuMap').scrollIntoView()); await sleep(300);
  await page.screenshot({ path: SHOTS + '/2d-menu-map.png' });
  // tap a mark -> popup with details
  await page.click('#menuMap .mm-mark'); await sleep(400);
  const pop = await page.$eval('.leaflet-popup-content', e => e.textContent.replace(/\s+/g, ' '));
  assert.ok(/Side/.test(pop) && /Position/.test(pop) && /Marked/.test(pop), 'mark popup shows details: ' + pop);
  assert.strictEqual(await page.$$eval('.mm-pop .pp-a button', b => b.length), 0, 'no Found/Treated buttons in the menu map');
  await page.screenshot({ path: SHOTS + '/2e-menu-popup.png' });
  // labels toggle + follow-me
  await page.click('#menuMap [data-act=labels]'); await sleep(500);
  assert.ok((await page.evaluate(() => window.__menuMap().stats())).labelsLayer, 'labels overlay on');
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('agronica-mistletoe-map-v1')).labels === true), 'labels preference remembered');
  await page.click('#menuMap [data-act=labels]'); await sleep(200);
  await page.click('#menuMap [data-act=follow]'); await sleep(300);
  assert.ok((await page.evaluate(() => window.__menuMap().stats())).follow, 'follow-me on');
  await page.click('#menuMap [data-act=follow]');
  // "Save map area for offline": zoom out a little, save, check the saved tile cache (zoom <= 19, within the limit)
  await page.evaluate(() => { const m = window.__menuMap().getMap(); m.setZoom(16, { animate: false }); }); await sleep(500);
  await page.click('#menuMap [data-act=save]');
  await page.waitForFunction(() => /^Saved \d+ of \d+ tiles/.test(document.querySelector('#menuMap .mapstatus').textContent), { timeout: 30000 });
  const saveTxt = await page.$eval('#menuMap .mapstatus', e => e.textContent);
  const savedInfo = await page.evaluate(async () => {
    const c = await caches.open('mistletoe-tiles-saved'), ks = await c.keys();
    const zs = ks.map(k => +new URL(k.url).pathname.split('/')[3]);
    return { n: ks.length, zmin: Math.min(...zs), zmax: Math.max(...zs), last: window.__menuMap().stats().lastSave };
  });
  console.log('Save area:', saveTxt, JSON.stringify(savedInfo));
  assert.ok(savedInfo.n > 100 && savedInfo.n <= 1500 && savedInfo.zmax === 19 && savedInfo.zmin <= 16 && savedInfo.last.fail === 0, 'saved tiles up to zoom 19 within limit');
  const stubHits = tiles.stats.imagery;
  await page.evaluate(() => { const m = window.__menuMap().getMap(); m.setZoom(18, { animate: false }); }); await sleep(800);
  assert.ok(tiles.stats.imagery === stubHits, 'tiles in the saved area come from the cache, not the network (' + (tiles.stats.imagery - stubHits) + ' new requests)');
  await page.click('#closeSheet');
  const mkml = await page.evaluate(() => KML.buildKml(JSON.parse(localStorage.getItem('agronica-mistletoe-session-v1')), {}));
  ['cat-irrigation-L', 'cat-phytophthora-R', 'cat-nutrition-L'].forEach(id => assert.ok(mkml.includes('<styleUrl>#' + id + '</styleUrl>'), id));
  assert.strictEqual((mkml.match(/<Style id="(mark[LR]|cat-\w+-[LR])"/g) || []).length, 8, 'eight mark styles');
  assert.ok(/Category: Broken irrigation/.test(mkml) && /<name>R-\d+ Phytophthora treatment<\/name>/.test(mkml));
  const { DOMParser: DP } = require('@xmldom/xmldom');
  const mrt = require('../kml.js').parseKml(mkml, DP);
  assert.deepStrictEqual(mrt.marks.slice(-3).map(m => [m.side, m.cat]), [['L', 'irrigation'], ['R', 'phytophthora'], ['L', 'nutrition']]);
  fs.writeFileSync('/tmp/cats.kml', require('../kml.js').buildKml({ marks: [
    { side: 'L', n: 1, cat: 'irrigation', ...P(180, 40), acc: 4, ts: 1700000000000 },
    { side: 'R', n: 2, cat: 'phytophthora', ...P(180, 120), acc: 4, ts: 1700000100000 },
    { side: 'L', n: 3, cat: 'nutrition', ...P(180, 200), acc: 4, ts: 1700000200000 },
    { side: 'R', n: 4, ...P(180, 300), acc: 4, ts: 1700000300000 }], track: [] }));
  console.log('Other Left/Right category marks OK:', oth.map(m => m.name).join(' | '));
  await page.click('#startStop');
  console.log('Mark mode OK; LEFT button size', big.map(Math.round));

  // ----- Find mode -----
  await page.click('#tabFind'); await sleep(400);
  await page.screenshot({ path: SHOTS + '/3-find-empty.png' });
  const input = await page.$('#findFile'); await input.uploadFile('/tmp/sample.kml'); await sleep(600);
  assert.strictEqual(await txt('progTxt'), '0 of 3 found');
  await page.click('#findStart'); await sleep(1500);
  await page.evaluate(() => document.querySelector('#tgVoice').click());   // voice on
  assert.strictEqual(await txt('findStart'), 'STOP TRACKING');
  await sleep(1200);
  console.log('Initial dist:', await txt('tDist'), '| side', await txt('tSide'), '| rel', await txt('tRel'));
  assert.strictEqual(await txt('tDist'), '60 m'); assert.strictEqual(await txt('tSide'), 'LEFT'); assert.strictEqual(await txt('tName'), 'L-1');
  await evs();
  await page.screenshot({ path: SHOTS + '/4-find-60m.png' });

  // walk north toward L-1 (60 m): alerts at 30 / 15 / ~5
  const seen = [];
  for (let d = 5; d <= 58; d += 3) {
    await setPos(P(0, d)); await sleep(450);
    const e = await evs(); if (e.length) seen.push({ distLeft: 60 - d, events: e, shown: await txt('tDist') });
    if (d === 35) await page.screenshot({ path: SHOTS + '/5-find-25m.png' });
  }
  console.log('Alert events:', JSON.stringify(seen));
  const flat = seen.flatMap(s => s.events);
  const says = flat.filter(e => e[0] === 'say').map(e => e[1]);
  assert.strictEqual(says.length, 3, 'three speech alerts: ' + says);
  assert.ok(/^Mistletoe left, (30|25) metres$/.test(says[0]) || /left, \d+ metres/.test(says[0]));
  assert.ok(/^Mistletoe left, \d+ metres$/.test(says[1])); assert.strictEqual(says[2], 'Mistletoe left, arrived');
  assert.deepStrictEqual(flat.filter(e => e[0] === 'vib').map(e => e[1]), ['[200]', '[150,100,150]', '[400,100,400,100,400]']);
  assert.strictEqual(flat.filter(e => e[0] === 'beep').length, 1 + 2 + 3);
  await page.screenshot({ path: SHOTS + '/6-find-arrived.png' });
  // Found
  await page.click('#btnFound'); await sleep(500);
  assert.strictEqual(await txt('progTxt'), '1 of 3 found');
  // from P(0,58): R-2 is 92 m away, foreign 'Gum tree 9' (80 m east) is ~99 m away
  assert.strictEqual(await txt('tName'), 'R-2'); assert.strictEqual(await txt('tSide'), 'RIGHT');
  await page.click('#btnTreated'); await sleep(400);
  assert.strictEqual(await txt('progTxt'), '2 of 3 found'); assert.ok((await txt('progSub')).includes('1 treated'));
  assert.strictEqual(await txt('tName'), 'Gum tree 9');
  const side = await txt('tSide'), rel = await txt('tRel'); console.log('Foreign point: side chip', side, '| direction', rel, '| dist', await txt('tDist'));
  assert.strictEqual(side, 'RIGHT');   // heading north (movement), point is east -> right
  await page.click('#btnFound'); await sleep(400);
  assert.strictEqual(await txt('progTxt'), '3 of 3 found'); assert.ok(await page.$eval('#target', e => e.classList.contains('done')));
  await page.screenshot({ path: SHOTS + '/6b-find-done.png' });
  await page.evaluate(() => document.querySelector('#ptList button.on').click());  // undo one found from list
  await sleep(400); assert.strictEqual(await txt('progTxt'), '2 of 3 found');
  // list sorted & map drawn
  const rows = await page.$$eval('#ptList li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  console.log('List:', JSON.stringify(rows));
  assert.strictEqual(rows.length, 3);
  await sleep(1000);
  const fm = await page.evaluate(() => window.Find._map().stats());
  console.log('Find map:', JSON.stringify({ ...fm, markers: fm.markers.map(m => m.cls) }));
  assert.ok(fm.built && fm.marks === 3 && fm.tracks === 1, 'find map: track + 3 marks');
  assert.ok(fm.hasPos && fm.hasAccuracy && fm.accRadius > 0 && fm.hasRadius && fm.radiusM === 30 && fm.posHeading, 'find map: position + accuracy circle + heading + alert radius circle');
  assert.ok(fm.markers.filter(m => /done/.test(m.cls)).length === 2 && fm.markers.some(m => /treated/.test(m.cls)), 'found/treated styling on the map');
  assert.ok(fm.loadedTiles > 0 && fm.tileSrc.startsWith('http://127.0.0.1:') && /\/imagery\/tile\/\d+\/\d+\/\d+/.test(fm.tileSrc), 'satellite tiles drawn under the find map');
  assert.ok(fm.attribution.includes('Tiles © Esri'), 'attribution shown');
  assert.ok(await page.$eval('#findLegend', e => e.querySelectorAll('.lg').length >= 8), 'legend kept in find');
  await page.evaluate(() => document.querySelector('#findMap').scrollIntoView());
  await sleep(400); await page.screenshot({ path: SHOTS + '/7-find-map.png' });
  // tap an unfound mark -> popup with Found / Treated; Found marks it, the popup then offers UNDO
  const unf = await page.$('#findMap .mm-mark:not(.done)');
  await unf.click(); await sleep(500);
  assert.ok(await page.$eval('.mm-pop .found-btn', b => /FOUND/.test(b.textContent)) && await page.$('.mm-pop .treated-btn'), 'popup has Found + Treated');
  assert.ok(/Distance/.test(await page.$eval('.mm-pop', e => e.textContent)), 'popup shows distance in Find');
  await page.screenshot({ path: SHOTS + '/7b-find-popup.png' });
  await page.click('.mm-pop button[data-status=found]'); await sleep(500);
  assert.strictEqual(await txt('progTxt'), '3 of 3 found');
  await (await page.$('#findMap .mm-mark.done.found, #findMap .mm-mark.done:not(.treated)')).click(); await sleep(400);
  assert.ok(await page.$eval('.mm-pop .found-btn', b => /UNDO/.test(b.textContent)), 'popup offers undo for a found mark');
  await page.click('.mm-pop button[data-status=found]'); await sleep(500);
  assert.strictEqual(await txt('progTxt'), '2 of 3 found');
  // follow-me: map centre tracks the position
  await page.click('#findMap [data-act=follow]'); await sleep(300);
  await setPos(P(0, 40)); await sleep(1500);
  const fc = await page.evaluate(() => window.Find._map().stats());
  assert.ok(fc.follow && GEO.haversine({ lat: fc.center[0], lon: fc.center[1] }, P(0, 40)) < 8, 'follow-me centres the map on you: ' + JSON.stringify({ follow: fc.follow, c: fc.center, want: P(0, 40), pos: await page.evaluate(() => window.Find._debug().pos) }));
  await page.click('#findMap [data-act=follow]'); await page.click('#findMap [data-act=fit]'); await sleep(300);
  assert.ok((await page.evaluate(() => window.Find._map().stats())).autoFit, 'fit re-enables auto-fit');
  // radius slider
  await page.$eval('#radius', e => { e.value = 60; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  assert.strictEqual(await txt('radiusVal'), '60 m');
  // export found
  await page.evaluate(() => document.querySelector('#exportFound').scrollIntoView());
  await page.click('#exportFound'); await sleep(1000);
  const dl = fs.readdirSync(DL).filter(f => f.endsWith('.kml'));
  assert.ok(dl.length === 1, 'downloaded ' + dl);
  const out = fs.readFileSync(path.join(DL, dl[0]), 'utf8');
  assert.ok(/Status: found/.test(out) && /Status: treated/.test(out) && /not found/.test(out));
  const { DOMParser } = require('@xmldom/xmldom');
  const rt = require('../kml.js').parseKml(out, DOMParser);
  assert.deepStrictEqual(rt.marks.map(m => m.status).sort(), ['', 'found', 'treated']);
  console.log('Export OK:', dl[0], rt.marks.length, 'points,', rt.tracks.length, 'track');

  // persistence across reload
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('agronica-mistletoe-find-v1')));
  assert.strictEqual(saved.sessions.length, 1); assert.strictEqual(saved.sessions[0].points.filter(p => p.status).length, 2);
  assert.ok(saved.sessions[0].track.length > 3); assert.strictEqual(saved.settings.radius, 60);
  assert.strictEqual(await txt('progTxt'), '2 of 3 found');
  console.log('Persistence OK; track points saved:', saved.sessions[0].track.length);

  // KML re-import of exported file restores found status in a new session
  await page.$eval('#tabFind', e => e.click());
  await (await page.$('#findFile')).uploadFile(path.join(DL, dl[0])); await sleep(500);
  assert.strictEqual(await txt('progTxt'), '2 of 3 found');
  console.log('Re-import of exported KML restores found status OK');

  // ----- Find mode: category points, speech label and category filter -----
  await (await page.$('#findFile')).uploadFile('/tmp/cats.kml'); await sleep(600);
  assert.strictEqual(await txt('progTxt'), '0 of 4 found');
  assert.strictEqual(await page.$$eval('#catFilter .fchip', c => c.length), 4);
  assert.strictEqual(await page.$$eval('#catFilter .fchip.on', c => c.length), 4, 'all categories on by default');
  await setPos(T0); await sleep(300);
  await evs();
  await page.click('#findStart'); await sleep(1800);
  assert.strictEqual(await txt('tName'), 'L-1 Broken irrigation'); assert.strictEqual(await txt('tCat'), 'Broken irrigation');
  const sp = (await evs()).filter(e => e[0] === 'say').map(e => e[1]);
  assert.strictEqual(sp[0], 'Broken irrigation left, 40 metres', JSON.stringify(sp));
  const rows2 = await page.$$eval('#ptList li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(rows2.length === 4 && rows2.some(r => r.includes('Phytophthora treatment')) && rows2.some(r => r.includes('Nutritional issue')), JSON.stringify(rows2));
  await page.screenshot({ path: SHOTS + '/8-find-categories.png' });
  const chip = id => page.click('#catFilter .fchip[data-cat="' + id + '"]');
  await chip('irrigation'); await sleep(500);
  assert.strictEqual(await txt('progTxt'), '0 of 3 found'); assert.strictEqual(await txt('tName'), 'R-2 Phytophthora treatment');
  assert.strictEqual(await page.$$eval('#ptList li', l => l.length), 3);
  await chip('phytophthora'); await chip('mistletoe'); await sleep(500);
  assert.strictEqual(await txt('progTxt'), '0 of 1 found'); assert.strictEqual(await txt('tName'), 'L-3 Nutritional issue');
  assert.strictEqual(await txt('tCat'), 'Nutritional issue');
  await evs(); await setPos(P(180, 190)); await sleep(700);            // 10 m from the nutrition point, others filtered out
  const sp2 = (await evs()).filter(e => e[0] === 'say').map(e => e[1]);
  assert.ok(sp2.length >= 1 && sp2.every(s => s.startsWith('Nutritional issue left')), JSON.stringify(sp2));
  await page.screenshot({ path: SHOTS + '/8b-find-filtered.png' });
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem('agronica-mistletoe-find-v1')).settings.cats);
  assert.deepStrictEqual(saved2, { irrigation: false, phytophthora: false, mistletoe: false });
  await chip('irrigation'); await chip('phytophthora'); await chip('mistletoe'); await sleep(400);
  assert.strictEqual(await txt('progTxt'), '0 of 4 found');
  const fk2 = await page.evaluate(() => { const F = window.Find._debug().F; return KML.buildFindKml(F.sessions.find(s => s.id === F.activeId), {}); });
  const frt = require('../kml.js').parseKml(fk2, DP);
  assert.deepStrictEqual(frt.marks.map(m => m.cat), ['irrigation', 'phytophthora', 'nutrition', '']);
  await page.click('#findStart'); await sleep(300);
  console.log('Find categories + filter + speech OK');

  // ----- service worker / share target -----
  const swInfo = await page.evaluate(async () => {
    const names = await caches.keys(); const c = await caches.open('mistletoe-marker-v11');
    return { names, urls: (await c.keys()).map(r => new URL(r.url).pathname.split('/').pop() || '/') };
  });
  console.log('Caches:', JSON.stringify(swInfo));
  assert.ok(swInfo.names.includes('mistletoe-marker-v11') && !swInfo.names.includes('mistletoe-marker-v10') && !swInfo.names.includes('mistletoe-marker-v9') && !swInfo.names.includes('mistletoe-marker-v8') && !swInfo.names.includes('mistletoe-marker-v7'));
  assert.ok(swInfo.names.includes('mistletoe-tiles-viewed') && swInfo.names.includes('mistletoe-tiles-saved'), 'separate tile caches: ' + swInfo.names);
  ['geo.js', 'find.js', 'kml.js', 'app.js', 'style.css', 'index.html', 'bg-harvester.webp', 'bg-orchard-sunset.webp', 'bg-macadamia-grove.webp', 'harvest-nuts.webp', 'logo.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'maskable-192.png', 'maskable-512.png', 'favicon.svg', 'favicon-32.png', 'agronica-logo.svg', 'map.js', 'extras.js', 'leaflet.js', 'leaflet.css', 'helper.png', 'ads.json', 'centris-logo.png', 'corteva-logo.jpg', 'example-1.svg'].forEach(f => assert.ok(swInfo.urls.includes(f), 'cached ' + f));
  // Agronica logo: full-strength in header, >=35% opacity brand mark in both views, not an overlay above buttons
  const logoInfo = await page.evaluate(() => {
    const q = s => document.querySelector(s), cs = e => getComputedStyle(e);
    const h = q('.hlogo'), b = q('#viewMark .brand'), f = q('#viewFind .brand');
    return { hOp: +cs(h).opacity, hH: h.getBoundingClientRect().height, hOk: h.complete && h.naturalWidth > 0,
      bOp: +cs(b).opacity, bH: parseFloat(cs(b).height), bOk: b.complete && b.naturalWidth > 0, fOp: +cs(f).opacity,
      overlay: cs(q('#viewMark'), '::after').content };
  });
  console.log('Logo:', JSON.stringify(logoInfo));
  assert.ok(logoInfo.hOk && logoInfo.hOp === 1 && logoInfo.hH >= 24 && logoInfo.bOk && logoInfo.bOp >= 0.35 && logoInfo.fOp >= 0.35 && logoInfo.bH >= 28);
  assert.ok(logoInfo.overlay === 'none' || logoInfo.overlay === 'normal', 'no overlay pseudo-element over the buttons');
  // mistletoe icons: header logo loads at 512, manifest icons all resolve with the declared size, favicon/apple-touch linked
  const iconInfo = await page.evaluate(async () => {
    const img = document.querySelector('header img.logo');
    const man = await (await fetch('./manifest.json')).json();
    const sizes = await Promise.all(man.icons.map(i => new Promise(r => { const m = new Image(); m.onload = () => r(m.naturalWidth + 'x' + m.naturalHeight); m.onerror = () => r('ERR'); m.src = i.src; })));
    return { logo: img.src.split('/').pop(), logoW: img.naturalWidth, declared: man.icons.map(i => i.sizes), sizes, purposes: man.icons.map(i => i.purpose),
      links: [...document.querySelectorAll('link[rel~=icon],link[rel=apple-touch-icon]')].map(l => l.getAttribute('href')) };
  });
  assert.strictEqual(iconInfo.logo, 'logo.png'); assert.strictEqual(iconInfo.logoW, 512);
  assert.deepStrictEqual(iconInfo.sizes, iconInfo.declared, 'manifest icon sizes match');
  assert.ok(iconInfo.purposes.filter(x => x === 'maskable').length === 2);
  assert.ok(iconInfo.links.includes('icons/favicon.svg') && iconInfo.links.includes('icons/icon-180.png'));
  console.log('Icons OK');
  await page.evaluate(async (kmlText) => {
    const fd = new FormData(); fd.append('kml', new File([kmlText], 'shared-block.kml', { type: 'application/vnd.google-earth.kml+xml' }));
    await fetch('./share-target', { method: 'POST', body: fd });
  }, foreign);
  await page.goto(BASE + '?shared=1', { waitUntil: 'networkidle0' }); await sleep(700);
  const sessNames = await page.$$eval('#sessSel option', o => o.map(x => x.textContent));
  console.log('Sessions after share:', JSON.stringify(sessNames));
  assert.ok(sessNames.some(n => n.startsWith('shared-block')), 'shared file loaded as session');
  assert.strictEqual(await page.evaluate(() => document.body.dataset.view), 'find');


  // ----- satellite tile runtime cache: viewed tiles cached + capped (~2000), saved area kept separately -----
  const tc = await page.evaluate(async () => {
    const v = await caches.open('mistletoe-tiles-viewed'), ks = await v.keys();
    return { viewed: ks.length, sample: ks[0] && new URL(ks[0].url).pathname };
  });
  console.log('Tile cache:', JSON.stringify(tc), 'stub served', tiles.stats.imagery, 'imagery +', tiles.stats.labels, 'label tiles');
  assert.ok(tc.viewed >= 5 && /\/imagery\/tile\//.test(tc.sample), 'viewed tiles are cached at runtime');
  const capInfo = await page.evaluate(async () => {
    const v = await caches.open('mistletoe-tiles-viewed');
    for (let i = 0; i < 2150; i++) await v.put('http://127.0.0.1:1/dummy/tile/1/' + i + '/0', new Response('x'));
    const before = (await v.keys()).length;
    const reg = await navigator.serviceWorker.ready;
    await new Promise(res => { navigator.serviceWorker.addEventListener('message', function f(e) { if (e.data && e.data.type === 'tiles-trimmed') { navigator.serviceWorker.removeEventListener('message', f); res(); } }); reg.active.postMessage({ type: 'trim-tiles' }); });
    const ks = await v.keys();
    return { before, after: ks.length, firstDummyGone: !(await v.match('http://127.0.0.1:1/dummy/tile/1/0/0')), lastKept: !!(await v.match('http://127.0.0.1:1/dummy/tile/1/2149/0')) };
  });
  console.log('Tile cap:', JSON.stringify(capInfo));
  assert.ok(capInfo.before > 2000 && capInfo.after === 2000 && capInfo.firstDummyGone && capInfo.lastKept, 'tile cache trimmed to 2000 (oldest evicted)');

  // ----- About Agronica -----
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.click('#tabMark'); await sleep(300);
  await page.click('#aboutLink'); await sleep(900);
  assert.ok(await page.$eval('#about', e => !e.classList.contains('hidden')), 'About opens from the small link on the main screen');
  const ab = await page.evaluate(() => ({
    tel: document.querySelector('#abCall').getAttribute('href'), mails: [...document.querySelectorAll('[id^=abMail]')].map(a => a.getAttribute('href').split('?')[0]),
    maps: document.querySelector('#abMaps').href, web: document.querySelector('#abWeb').href, webTarget: document.querySelector('#abWeb').target,
    text: document.querySelector('#about').textContent.replace(/\s+/g, ' '), map: window.Extras.aboutMapStats() }));
  console.log('About:', JSON.stringify({ ...ab, text: ab.text.length, map: { ...ab.map, markers: 0 } }));
  assert.strictEqual(ab.tel, 'tel:+61475570872'); assert.deepStrictEqual(ab.mails, ['mailto:jonathan@agronicaag.com', 'mailto:admin@agronicaag.com']);
  assert.ok(/google\.com\/maps\/search\/.*Goodwood%20Road/.test(ab.maps) && ab.web === 'https://www.agronicaag.com/' && ab.webTarget === '_blank');
  assert.ok(/4468 Goodwood Road, Alloway QLD/.test(ab.text) && /\(\+61\) 475 570 872/.test(ab.text) && /Pest and Disease Management/.test(ab.text) && /Soil and Nutrition Management/.test(ab.text) && /Data Management and ESG/.test(ab.text));
  assert.ok(ab.map && ab.map.built && ab.map.loadedTiles > 0, 'About map shows satellite tiles');
  await page.screenshot({ path: SHOTS + '/9-about.png' });
  await page.click('#closeAbout'); await sleep(200);
  await page.click('#menuBtn'); await sleep(300); await page.click('#menuAbout'); await sleep(400);
  assert.ok(await page.$eval('#about', e => !e.classList.contains('hidden')) && await page.$eval('#sheet', e => e.classList.contains('hidden')), 'About opens from the menu');
  await page.click('#closeAbout');

  // ----- Help bot (offline FAQ) -----
  await page.click('#helpFab'); await sleep(500);
  assert.ok(await page.$eval('#help', e => !e.classList.contains('hidden')));
  assert.strictEqual(await page.$eval('.help-head img', i => i.getAttribute('src')), 'img/helper.png');
  assert.ok((await page.$eval('.help-head b', b => b.textContent)) === 'Macca the Mistletoe Marker Helper', 'helper named Macca');
  assert.ok(await page.$eval('.help-head img', i => i.complete && i.naturalWidth === 256), 'helper avatar is the 256px cartoon');
  const chipTxt = await page.$$eval('#helpChips .qchip', c => c.map(x => x.textContent));
  console.log('Help chips:', JSON.stringify(chipTxt));
  ['Starting', 'Marking L / R', 'Other categories', 'Undo / delete', 'Export / share KML', 'Import / merge maps', 'Find mode', 'Alerts', 'Satellite & offline maps', 'iPhone vs Android', 'Add to home screen', 'Privacy & data', 'Contact Agronica'].forEach(c => assert.ok(chipTxt.includes(c), 'chip ' + c));
  const qa = [['how do I start', 'start'], ['how do I mark left and right', 'mark'], ['what are the other buttons for irrigation', 'other'], ['I made a mistake, how do I undo', 'undo'], ['how do I email my KML to someone', 'export'],
    ['how do two people merge their maps', 'import'], ['how does find mode guide me back', 'find'], ['how do I change the alert radius', 'alerts'], ['does the satellite map work with no signal', 'maps'],
    ['is it different on iPhone', 'phones'], ['how do I add it to my home screen', 'install'], ['is my data private', 'privacy']];
  const wrong = await page.evaluate(qa => qa.filter(q => { const r = window.Extras.answer(q[0]); return !r.faq || r.faq.id !== q[1]; }).map(q => q[0]), qa);
  assert.deepStrictEqual(wrong, [], 'FAQ keyword matching');
  await page.type('#helpInput', 'how do I share my kml with a colleague'); await page.click('#helpSend'); await sleep(600);
  let log = await page.$eval('#helpLog', e => e.textContent);
  assert.ok(/Export \/ Share KML/.test(log), 'bot answers the export question offline');
  await page.click('#helpChips [data-faq=install]'); await sleep(500);
  assert.ok(/Add to Home Screen/.test(await page.$eval('#helpLog', e => e.textContent)));
  await page.type('#helpInput', 'what is the weather tomorrow'); await page.click('#helpSend'); await sleep(600);
  assert.ok(await page.$('#helpLog #helpContact'), 'unknown question falls back to Contact Agronica');
  await page.screenshot({ path: SHOTS + '/10-help.png' });
  await page.click('#helpLog #helpContact'); await sleep(900);
  assert.ok(await page.$eval('#about', e => !e.classList.contains('hidden')) && await page.$eval('#help', e => e.classList.contains('hidden')), 'Contact Agronica opens About');
  await page.click('#closeAbout');
  await page.click('#menuBtn'); await sleep(300); await page.click('#menuHelp'); await sleep(400);
  assert.ok(await page.$eval('#help', e => !e.classList.contains('hidden')), 'Help opens from the menu'); await page.click('#closeHelp');

  // ----- ad strip -----
  const adInfo = await page.evaluate(() => {
    const ads = window.Extras.ads();
    return { names: ads.map(a => a.name + (a.by ? ' by ' + a.by : '')), keys: ads.map(a => Object.keys(a).sort().join()), first: ads[0], href: document.querySelector('#adLink').href, target: document.querySelector('#adLink').target,
      rel: document.querySelector('#adLink').rel, img: document.querySelector('#adImg').naturalWidth, idx: window.Extras.adIndex(), name: document.querySelector('#adName').textContent };
  });
  console.log('Ads:', JSON.stringify(adInfo.names));
  assert.deepStrictEqual(adInfo.names, ['Kimura by Centris', 'Zimba by Centris', 'Define 250 EC by Centris', 'Transform by Corteva', 'N-Boost by Centris', 'Example product — your ad here', 'Example product — your ad here', 'Example product — your ad here']);
  assert.ok(adInfo.target === '_blank' && /noopener/.test(adInfo.rel) && adInfo.img > 0 && adInfo.name === adInfo.names[adInfo.idx] && /^https:\/\//.test(adInfo.href) && adInfo.first.name === 'Kimura' && adInfo.first.url.includes('centrissolutions.com.au'), JSON.stringify(adInfo));
  const idx0 = adInfo.idx; await sleep(7000);
  const idx1 = await page.evaluate(() => window.Extras.adIndex());
  assert.ok(idx1 === (idx0 + 1) % 8, 'ad strip auto-cycles every ~6 s: ' + idx0 + ' -> ' + idx1);
  await page.evaluate(() => document.querySelector('#btnL').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await page.evaluate(() => window.Extras.tick()); await sleep(100);
  assert.strictEqual(await page.evaluate(() => window.Extras.adIndex()), idx1, 'cycling pauses while the user is marking');
  await page.screenshot({ path: SHOTS + '/11-adbar.png' });

  // offline reload from cache
  tiles.kill();   // the service worker's own fetches are not covered by page.setOfflineMode, so really take the tile server away
  await page.setOfflineMode(true);
  await page.goto(BASE, { waitUntil: 'load' }); await sleep(500);
  await page.click('#tabFind'); await sleep(2000);
  assert.ok((await txt('progTxt')).includes('of 3'));
  const off = await page.evaluate(async () => {
    const hit = u => fetch(u).then(async r => ({ ok: r.ok, fb: (await r.blob()).size < 100 ? '1' : '' })).catch(e => ({ err: String(e) }));
    const v = await caches.open('mistletoe-tiles-saved'), k = (await v.keys())[0].url;
    return { saved: await hit(k), unseen: await hit(k.replace(/\/tile\/\d+\//, '/tile/3/')), note: document.querySelector('#findMap .mapnote').textContent, onLine: navigator.onLine, st: window.Find._map().stats(), adOk: window.Extras.ads().length };
  });
  console.log('Offline map:', JSON.stringify({ ...off, st: { ...off.st, markers: 0 } }));
  assert.ok(off.saved.ok && !off.saved.fb, 'saved tile served offline'); assert.ok(off.unseen.ok && off.unseen.fb === '1', 'uncached tile -> blank fallback (dark background), no error');
assert.ok(off.st.built && off.st.marks === 3 && off.st.loadedTiles > 0, 'map + cached tiles still render offline: ' + off.st.loadedTiles);
  assert.ok(off.adOk === 8, 'ads.json served from cache offline');
  await page.screenshot({ path: SHOTS + '/12-offline-map.png' });
  // pan somewhere never viewed: no tiles offline -> dark background + a note, no errors
  await page.evaluate(() => window.Find._map().getMap().setView([10, 10], 12, { animate: false })); await sleep(2500);
  const dark = await page.evaluate(() => ({ note: document.querySelector('#findMap .mapnote').textContent, shown: getComputedStyle(document.querySelector('#findMap .mapnote')).display, bg: getComputedStyle(document.querySelector('#findMap .mapcanvas')).backgroundColor }));
  console.log('Offline, no tiles:', JSON.stringify(dark));
  assert.ok(/imagery/.test(dark.note) && dark.shown !== 'none' && dark.bg === 'rgb(13, 13, 13)', 'graceful dark fallback with a note');
  await page.screenshot({ path: SHOTS + '/13-offline-no-tiles.png' });
  await page.setOfflineMode(false);
  console.log('Offline reload OK');

  const real = errors.filter(e => !/favicon/.test(e)); if (real.length) console.log('Console errors:', JSON.stringify(real)); assert.deepStrictEqual(real, [], 'no console errors');
  console.log('UI tests passed. Screenshots in', SHOTS);
  await browser.close(); tiles.close();
})().catch(e => { console.error('UI TEST FAILED:', e); process.exit(1); });
