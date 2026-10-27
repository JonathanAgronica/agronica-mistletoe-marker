// Run: NODE_PATH=<dir with @xmldom/xmldom> node tests/logic.test.js
const assert = require('assert');
const { DOMParser } = require('@xmldom/xmldom');
const GEO = require('../geo.js');
const KML = require('../kml.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, (m || '') + ' got ' + a + ' want ' + b); n++; };

// --- haversine / bearing
const A = { lat: -27.4698, lon: 153.0251 };          // Brisbane
near(GEO.haversine(A, A), 0, 1e-9, 'zero dist');
near(GEO.haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 111195, 20, '1deg lon at equator');
near(GEO.haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111195, 20, '1deg lat');
near(GEO.haversine(A, { lat: -33.8688, lon: 151.2093 }), 732000, 4000, 'Brisbane-Sydney ~732 km');
near(GEO.bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 0, 1e-6, 'north');
near(GEO.bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90, 1e-6, 'east');
near(GEO.bearing({ lat: 0, lon: 0 }, { lat: -1, lon: 0 }), 180, 1e-6, 'south');
near(GEO.bearing({ lat: 0, lon: 0 }, { lat: 0, lon: -1 }), 270, 1e-6, 'west');
near(GEO.bearing(A, { lat: -33.8688, lon: 151.2093 }), 192, 3, 'Brisbane->Sydney ~SSW');
[0, 45, 90, 137, 200, 271, 359].forEach(b => [3, 20, 150].forEach(d => {
  const B = GEO.destination(A, b, d);
  near(GEO.haversine(A, B), d, 0.01, 'dest dist ' + b + '/' + d);
  near(GEO.diffAngle(GEO.bearing(A, B), b), 0, 0.05, 'dest bearing ' + b);
}));
near(GEO.diffAngle(350, 10), 20, 1e-9); near(GEO.diffAngle(10, 350), -20, 1e-9); near(GEO.diffAngle(0, 180), 180, 1e-9);
near(GEO.norm360(-90), 270, 1e-9);
// ENU
const e = GEO.enu(A, GEO.destination(A, 90, 100)); near(e.x, 100, 0.2); near(e.y, 0, 0.2);
// compass heading: device flat (beta=gamma=0): heading = 360 - alpha
near(GEO.compassHeading(0, 0, 0), 0, 1e-6); near(GEO.compassHeading(90, 0, 0), 270, 1e-6); near(GEO.compassHeading(270, 0, 0), 90, 1e-6);
near(GEO.compassHeading(90, 90, 0), 270, 0.5, 'upright phone pointing west');
// smoothing across wrap
near(GEO.smoothAngle(350, 10, 0.5), 0, 1e-9); near(GEO.smoothAngle(null, 123, .5), 123, 1e-9);

// --- alert levels
[[31, 0], [30, 1], [16, 1], [15, 2], [5.01, 2], [5, 3], [0, 3]].forEach(([d, l]) => assert.strictEqual(GEO.alertLevel(d, 30), l, 'lvl ' + d)); n += 7;
assert.deepStrictEqual(GEO.thresholds(100), { r1: 100, r2: 50, r3: 5 }); n++;
near(GEO.thresholds(5).r3, 5 / 3, 1e-9); n;
assert.strictEqual(GEO.fmtDist(23.4), '23 m'); assert.strictEqual(GEO.fmtDist(1500), '1.5 km');
assert.strictEqual(GEO.speechText('L', 20, 1), 'Mistletoe left, 20 metres');
assert.strictEqual(GEO.speechText('R', 12.4, 2), 'Mistletoe right, 12 metres');
assert.strictEqual(GEO.speechText('', 47, 1), 'Mistletoe, 45 metres');
assert.strictEqual(GEO.speechText('R', 3, 3), 'Mistletoe right, arrived'); n += 5;
assert.strictEqual(GEO.relWord(0), 'ahead'); assert.strictEqual(GEO.relWord(-90), 'left'); assert.strictEqual(GEO.relWord(40), 'ahead right'); assert.strictEqual(GEO.relWord(180), 'behind'); n += 4;

// --- nearest unfound & alert sequence (walk toward a point, dead ahead, 120 m north)
const pts = [
  { id: 'a', lat: 0, lon: 0, side: 'L', status: '' },
  { id: 'b', lat: 0, lon: 0, side: 'R', status: 'found' },
  { id: 'c', lat: 0, lon: 0, side: 'R', status: '' }];
const T = { lat: -27.5, lon: 153.0 };
pts[0] = Object.assign(pts[0], GEO.destination(T, 0, 120));
pts[1] = Object.assign(pts[1], GEO.destination(T, 0, 125));      // found (closer to walker than c) must be ignored
pts[2] = Object.assign(pts[2], GEO.destination(T, 0, 400));
const nu = GEO.nearestUnfound(pts, T); assert.strictEqual(nu.p.id, 'a'); near(nu.dist, 120, 0.1); near(nu.brg, 0, 0.01); n += 3;
const alerted = {}, fired = [];
for (let d = 120; d >= 0; d -= 1) {      // walk north 1 m steps
  const pos = GEO.destination(T, 0, 120 - d);
  const a = GEO.nextAlert(pts, pos, 30, alerted);
  if (a) fired.push([a.level, Math.round(a.dist), a.p.id]);
}
assert.deepStrictEqual(fired.map(f => f[0]), [1, 2, 3]); assert.deepStrictEqual(fired.map(f => f[2]), ['a', 'a', 'a']); n += 2;
console.log('  alerts fired (level, dist m):', JSON.stringify(fired));
near(fired[0][1], 30, 1); near(fired[1][1], 15, 1); near(fired[2][1], 5, 1);
// mark found -> no more alerts for it; nearest becomes c (far)
pts[0].status = 'found';
assert.strictEqual(GEO.nextAlert(pts, GEO.destination(T, 0, 120), 30, alerted), null); n++;
// walk away beyond 1.2*radius, then come back: re-alerts
const al2 = {}; const P = pts.map(p => Object.assign({}, p)); P[0].status = '';
const seq = [60, 25, 60, 40, 25, 10]; const out = [];
seq.forEach(d => { const a = GEO.nextAlert(P, GEO.destination(P[0], 180, d), 30, al2); out.push(a ? a.level : 0); });
assert.deepStrictEqual(out, [0, 1, 0, 0, 1, 2]); n++;
// all found -> null
P.forEach(p => p.status = 'found'); assert.strictEqual(GEO.nextAlert(P, T, 30, {}), null); n++;

// --- KML export / parse round trip (own format)
const session = { marks: [
  { side: 'L', n: 1, name: 'L-1', lat: -27.1234567, lon: 153.7654321, acc: 3.2, ts: 1700000000000 },
  { side: 'R', n: 2, name: 'R-2', lat: -27.12346, lon: 153.76544, acc: null, ts: 1700000060000 }],
  track: [{ lat: -27.1, lon: 153.1 }, { lat: -27.2, lon: 153.2 }] };
const kml = KML.buildKml(session, { name: 'T & <test>' });
let r = KML.parseKml(kml, DOMParser);
assert.strictEqual(r.marks.length, 2); assert.strictEqual(r.tracks.length, 1); assert.strictEqual(r.tracks[0].pts.length, 2);
assert.strictEqual(r.marks[0].side, 'L'); assert.strictEqual(r.marks[1].side, 'R'); assert.strictEqual(r.marks[0].ts, 1700000000000);
near(r.marks[0].lat, -27.1234567, 1e-7); near(r.marks[0].lon, 153.7654321, 1e-7); assert.strictEqual(r.marks[1].acc, null); n += 8;
// find export: status round trip
const fs = { name: 'S', points: [
  { name: 'L-1', side: 'L', n: 1, lat: -27.1, lon: 153.1, ts: 1700000000000, status: 'treated', foundTs: 1700001000000 },
  { name: 'Foreign', side: '', n: 0, lat: -27.2, lon: 153.2, ts: 0, status: '' },
  { name: 'R-3', side: 'R', n: 3, lat: -27.3, lon: 153.3, ts: 1700000000000, status: 'found', foundTs: 1700002000000 }],
  track: [{ lat: -27.1, lon: 153.1, ts: 1 }, { lat: -27.1001, lon: 153.1001, ts: 2 }] };
const fk = KML.buildFindKml(fs, {}); r = KML.parseKml(fk, DOMParser);
assert.strictEqual(r.marks.length, 3); assert.deepStrictEqual(r.marks.map(m => m.status), ['treated', '', 'found']);
assert.deepStrictEqual(r.marks.map(m => m.side), ['L', '', 'R']); assert.strictEqual(r.marks[0].foundTs, 1700001000000); assert.strictEqual(r.tracks.length, 1); n += 5;
assert.ok(/<styleUrl>#found<\/styleUrl>/.test(fk)); assert.ok(/Status: treated/.test(fk)); n += 2;
assert.throws(() => KML.parseKml('<kml><oops></kml>', DOMParser)) ; n++;

// --- foreign KML (Google Earth style): folders, no ExtendedData, MultiGeometry, extra whitespace, altitudes
const foreign = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Block 7</name>
<Style id="s1"><IconStyle><Icon><href>x.png</href></Icon></IconStyle></Style>
<Folder><name>Trees</name>
 <Placemark><name>Rose tree</name><styleUrl>#s1</styleUrl><Point><coordinates>
   153.0301, -27.4801, 25 </coordinates></Point></Placemark>
 <Placemark><name>Mistletoe</name><description><![CDATA[<b>Left</b> side of row 12]]></description><Point><coordinates>153.0302,-27.4802,0</coordinates></Point></Placemark>
 <Placemark><name>R12</name><Point><coordinates>153.0303,-27.4803</coordinates></Point></Placemark>
 <Placemark><name>No coords</name><Point><coordinates></coordinates></Point></Placemark>
 <Placemark><name>Two</name><MultiGeometry><Point><coordinates>153.04,-27.49</coordinates></Point><Point><coordinates>153.05,-27.5</coordinates></Point></MultiGeometry></Placemark>
 <Placemark><name>Boundary</name><LineString><coordinates>153.0,-27.4,0 153.1,-27.5,0</coordinates></LineString></Placemark>
</Folder>
<Placemark><name>Bad lat</name><Point><coordinates>153,-127</coordinates></Point></Placemark>
</Document></kml>`;
r = KML.parseKml(foreign, DOMParser);
assert.strictEqual(r.marks.length, 5, 'foreign mark count ' + r.marks.length);
assert.deepStrictEqual(r.marks.map(m => m.side), ['', 'L', 'R', '', ''], 'foreign sides ' + r.marks.map(m => m.side));
near(r.marks[0].lat, -27.4801, 1e-9); near(r.marks[0].lon, 153.0301, 1e-9); assert.strictEqual(r.tracks.length, 1);
assert.strictEqual(r.marks[3].name, 'Two #1'); assert.strictEqual(r.marks[4].name, 'Two #2'); assert.ok(r.marks.every(m => m.status === '')); n += 8;

// --- "Other" categories: names, KML styles, round trip, speech label
assert.deepStrictEqual(KML.CATS.map(c => c.label), ['Broken irrigation', 'Phytophthora treatment', 'Nutritional issue']); n++;
assert.strictEqual(new Set(KML.CATS.map(c => c.kmlL).concat(KML.CATS.map(c => c.kmlR))).size, 6); assert.strictEqual(new Set(KML.CATS.map(c => c.icon)).size, 3); n += 2;
assert.strictEqual(KML.markName({ side: 'L', n: 5, cat: 'irrigation' }), 'L-5 Broken irrigation');
assert.strictEqual(KML.markName({ side: 'R', n: 6 }), 'R-6');
const cs = { marks: [
  { side: 'L', n: 1, name: 'L-1', lat: -27.1, lon: 153.1, acc: 3, ts: 1700000000000 },
  { side: 'L', n: 5, cat: 'irrigation', name: 'L-5 Broken irrigation', lat: -27.2, lon: 153.2, acc: 3, ts: 1700000100000 },
  { side: 'R', n: 6, cat: 'phytophthora', name: 'R-6 Phytophthora treatment', lat: -27.3, lon: 153.3, acc: 3, ts: 1700000200000 },
  { side: 'R', n: 7, cat: 'nutrition', name: 'R-7 Nutritional issue', lat: -27.4, lon: 153.4, acc: 3, ts: 1700000300000 }], track: [] };
const ck = KML.buildKml(cs, {});
// 8 distinct styles: markL, markR + (irrigation, phytophthora, nutrition) x (L, R), each with its own colour; used marks reference them
const STYLE_IDS = ['markL', 'markR'].concat([].concat(...['irrigation', 'phytophthora', 'nutrition'].map(c => ['L', 'R'].map(s => 'cat-' + c + '-' + s))));
const styleCols = STYLE_IDS.map(id => { const m = new RegExp('<Style id="' + id + '"><IconStyle><color>([0-9a-f]{8})</color>').exec(ck); ok(m, 'style ' + id); return m[1]; });
assert.strictEqual(STYLE_IDS.length, 8); assert.strictEqual(new Set(styleCols).size, 8, 'eight distinct style colours: ' + styleCols); n += 2;
assert.strictEqual(new Set(KML.CATS.map(c => c.shape).concat('circle')).size, 4); n++;      // distinct marker shape per type (colour-blind aid)
// left is the darker shade, right the lighter shade of the same type
const lum = h => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
KML.CATS.forEach(c => { ok(lum(KML.typeColor(c.id, 'L')) < lum(KML.typeColor(c.id, 'R')), c.id + ' L darker than R'); });
assert.strictEqual(KML.typeColor('', 'L'), '#2d62ff'); assert.strictEqual(KML.typeColor('', 'R'), '#ffb400'); n += 2;
ok(ck.includes('<styleUrl>#cat-irrigation-L</styleUrl>') && ck.includes('<styleUrl>#cat-phytophthora-R</styleUrl>') && ck.includes('<styleUrl>#cat-nutrition-R</styleUrl>'));
ok(/<Style id="cat-nutrition-L">/.test(KML.buildFindKml({ points: [], track: [] }, {})), 'find export carries the same 8 styles');
ok(/Category: Broken irrigation/.test(ck) && /Category: Phytophthora treatment/.test(ck) && /Category: Nutritional issue/.test(ck));
ok(ck.includes('<styleUrl>#markL</styleUrl>'));
r = KML.parseKml(ck, DOMParser);
assert.deepStrictEqual(r.marks.map(m => m.cat), ['', 'irrigation', 'phytophthora', 'nutrition']);
assert.deepStrictEqual(r.marks.map(m => m.side), ['L', 'L', 'R', 'R']); assert.deepStrictEqual(r.marks.map(m => m.n), [1, 5, 6, 7]); n += 3;
// import of a KML without our ExtendedData: category/side from name or style
const bare = ck.replace(/<ExtendedData>[\s\S]*?<\/ExtendedData>/g, '');
r = KML.parseKml(bare, DOMParser);
assert.deepStrictEqual(r.marks.map(m => m.cat), ['', 'irrigation', 'phytophthora', 'nutrition']);
assert.deepStrictEqual(r.marks.map(m => m.side), ['L', 'L', 'R', 'R']); assert.deepStrictEqual(r.marks.map(m => m.n), [1, 5, 6, 7]); n += 3;
const cf = KML.buildFindKml({ name: 'C', points: cs.marks.map(m => Object.assign({}, m, { status: m.cat === 'nutrition' ? 'found' : '' })), track: [] }, {});
r = KML.parseKml(cf, DOMParser);
assert.deepStrictEqual(r.marks.map(m => m.cat), ['', 'irrigation', 'phytophthora', 'nutrition']); assert.deepStrictEqual(r.marks.map(m => m.status), ['', '', '', 'found']);
ok(cf.includes('<styleUrl>#cat-irrigation-L</styleUrl>') && cf.includes('<styleUrl>#found</styleUrl>')); n += 2;
r = KML.parseKml(bare.replace(/#cat-(\w+)-[LR]</g, '#cat-$1<'), DOMParser);
assert.deepStrictEqual(r.marks.map(m => m.cat), ['', 'irrigation', 'phytophthora', 'nutrition']); n++;   // v5 exports (#cat-<id>) still import
assert.strictEqual(GEO.speechText('L', 20, 1, 'Broken irrigation'), 'Broken irrigation left, 20 metres');
assert.strictEqual(GEO.speechText('R', 3, 3, 'Nutritional issue'), 'Nutritional issue right, arrived'); n += 2;

console.log('geo/kml tests passed:', n, 'assertions');
