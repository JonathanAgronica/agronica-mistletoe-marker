// Headless Chrome UI test with simulated geolocation.
// Run: (cd repo && python3 -m http.server 8123 &) ; NODE_PATH=<dir with puppeteer-core,@xmldom> node tests/ui.test.js [baseUrl] [shotDir]
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), assert = require('assert');
const GEO = require('../geo.js');
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
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, ['geolocation']);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
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
  await page.screenshot({ path: SHOTS + '/2c-menu-categories.png' });
  await page.click('#closeSheet');
  const mkml = await page.evaluate(() => KML.buildKml(JSON.parse(localStorage.getItem('agronica-mistletoe-session-v1')), {}));
  ['cat-irrigation', 'cat-phytophthora', 'cat-nutrition'].forEach(id => assert.ok(mkml.includes('<styleUrl>#' + id + '</styleUrl>'), id));
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
  const mapPix = await page.$eval('#map', c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  assert.ok(mapPix > 1000, 'map has content');
  await page.evaluate(() => document.querySelector('#map').scrollIntoView());
  await sleep(300); await page.screenshot({ path: SHOTS + '/7-find-map.png' });
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
    const names = await caches.keys(); const c = await caches.open('mistletoe-marker-v5');
    return { names, urls: (await c.keys()).map(r => new URL(r.url).pathname.split('/').pop() || '/') };
  });
  console.log('Caches:', JSON.stringify(swInfo));
  assert.ok(swInfo.names.includes('mistletoe-marker-v5') && !swInfo.names.includes('mistletoe-marker-v4'));
  ['geo.js', 'find.js', 'kml.js', 'app.js', 'style.css', 'index.html', 'bg-harvester.webp', 'bg-orchard-sunset.webp', 'bg-macadamia-grove.webp', 'harvest-nuts.webp', 'logo.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'maskable-192.png', 'maskable-512.png', 'favicon.svg', 'favicon-32.png'].forEach(f => assert.ok(swInfo.urls.includes(f), 'cached ' + f));
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

  // offline reload from cache
  await page.setOfflineMode(true);
  await page.goto(BASE, { waitUntil: 'load' }); await sleep(500);
  assert.ok((await txt('progTxt')).includes('of 3'));
  await page.setOfflineMode(false);
  console.log('Offline reload OK');

  const real = errors.filter(e => !/favicon/.test(e)); if (real.length) console.log('Console errors:', JSON.stringify(real)); assert.deepStrictEqual(real, [], 'no console errors');
  console.log('UI tests passed. Screenshots in', SHOTS);
  await browser.close();
})().catch(e => { console.error('UI TEST FAILED:', e); process.exit(1); });
