/* KML build/parse helpers (usable in browser and node). */
(function (root) {
  'use strict';
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtLocal(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  // "Other" issue categories recorded with the Other Left / Other Right buttons
  var CATS = [
    { id: 'irrigation', label: 'Broken irrigation', color: '#00c8ff', kml: 'ffffc800', icon: 'water' },
    { id: 'phytophthora', label: 'Phytophthora treatment', color: '#b266ff', kml: 'ffff66b2', icon: 'triangle' },
    { id: 'nutrition', label: 'Nutritional issue', color: '#ff5ca8', kml: 'ffa85cff', icon: 'square' }
  ];
  function catById(id) { for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i]; return null; }
  function catLabel(id) { var c = catById(id); return c ? c.label : ''; }
  function markName(m) {
    return m.name || ((m.side === 'L' ? 'L-' : 'R-') + m.n + (m.cat && catById(m.cat) ? ' ' + catLabel(m.cat) : ''));
  }
  function catStyles(out) {
    CATS.forEach(function (c) {
      out.push('<Style id="cat-' + c.id + '"><IconStyle><color>' + c.kml + '</color><scale>1.3</scale><Icon><href>' +
        'http://maps.google.com/mapfiles/kml/shapes/' + c.icon + '.png</href></Icon></IconStyle>' +
        '<LabelStyle><color>' + c.kml + '</color></LabelStyle></Style>');
    });
  }

  // KML colours are aabbggrr
  var COLOURS = { L: 'ffff622d', R: 'ff00b4ff' }; // L = blue (#2d62ff), R = Agronica orange (#ffb400)
  var ICON = 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png';

  function buildKml(session, opts) {
    opts = opts || {};
    var marks = (session.marks || []).slice().sort(function (a, b) { return a.ts - b.ts; });
    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
    out.push('<Document>');
    out.push('<name>' + esc(opts.name || 'Agronica Mistletoe Marker') + '</name>');
    out.push('<description>Exported ' + esc(fmtLocal(Date.now())) + ' - ' + marks.length + ' marks</description>');
    ['L', 'R'].forEach(function (s) {
      out.push('<Style id="mark' + s + '"><IconStyle><color>' + COLOURS[s] + '</color><scale>1.2</scale>' +
        '<Icon><href>' + ICON + '</href></Icon></IconStyle>' +
        '<LabelStyle><color>' + COLOURS[s] + '</color></LabelStyle></Style>');
    });
    catStyles(out);
    out.push('<Style id="trackStyle"><LineStyle><color>ff03b698</color><width>3</width></LineStyle></Style>');

    out.push('<Folder><name>Marks</name>');
    marks.forEach(function (m) {
      var acc = (m.acc == null || isNaN(m.acc)) ? 'n/a' : Math.round(m.acc * 10) / 10 + ' m';
      var desc = (m.cat && catById(m.cat) ? 'Category: ' + catLabel(m.cat) + '\n' : '') + 'Side: ' + (m.side === 'L' ? 'LEFT' : 'RIGHT') + '\nTime: ' + fmtLocal(m.ts) +
        ' (' + new Date(m.ts).toISOString() + ')\nAccuracy: ' + acc;
      out.push('<Placemark>');
      out.push('<name>' + esc(markName(m)) + '</name>');
      out.push('<description>' + esc(desc) + '</description>');
      out.push('<TimeStamp><when>' + new Date(m.ts).toISOString() + '</when></TimeStamp>');
      out.push('<styleUrl>#' + (m.cat && catById(m.cat) ? 'cat-' + m.cat : 'mark' + (m.side === 'L' ? 'L' : 'R')) + '</styleUrl>');
      out.push('<ExtendedData>' +
        '<Data name="side"><value>' + m.side + '</value></Data>' +
        (m.cat && catById(m.cat) ? '<Data name="cat"><value>' + m.cat + '</value></Data>' + '<Data name="category"><value>' + esc(catLabel(m.cat)) + '</value></Data>' : '') +
        '<Data name="n"><value>' + m.n + '</value></Data>' +
        '<Data name="accuracy"><value>' + (m.acc == null ? '' : m.acc) + '</value></Data>' +
        '<Data name="ts"><value>' + m.ts + '</value></Data>' +
        '</ExtendedData>');
      out.push('<Point><coordinates>' + m.lon.toFixed(7) + ',' + m.lat.toFixed(7) + ',0</coordinates></Point>');
      out.push('</Placemark>');
    });
    out.push('</Folder>');

    var tracks = [];
    if (session.track && session.track.length) tracks.push({ name: 'Track', pts: session.track });
    (session.extraTracks || []).forEach(function (t, i) {
      if (t.pts && t.pts.length) tracks.push({ name: t.name || ('Imported track ' + (i + 1)), pts: t.pts });
    });
    tracks.forEach(function (t) {
      if (t.pts.length < 2) return; // LineString needs >= 2 points
      out.push('<Placemark><name>' + esc(t.name) + '</name><styleUrl>#trackStyle</styleUrl>' +
        '<LineString><tessellate>1</tessellate><coordinates>');
      out.push(t.pts.map(function (p) { return p.lon.toFixed(7) + ',' + p.lat.toFixed(7) + ',0'; }).join(' '));
      out.push('</coordinates></LineString></Placemark>');
    });
    out.push('</Document></kml>');
    return out.join('\n');
  }

  // parser: a DOM Document (browser DOMParser result or @xmldom/xmldom result)
  function kids(el, tag) {
    var res = [], all = el.getElementsByTagName(tag);
    for (var i = 0; i < all.length; i++) res.push(all[i]);
    return res;
  }
  function text(el, tag) {
    var c = el.getElementsByTagName(tag);
    return c.length ? (c[0].textContent || '').trim() : '';
  }
  function sideFrom(data, name, desc, styleUrl) {
    if (data.side === 'L' || data.side === 'R') return data.side;
    if (/^\s*([LR])[-_ ]?\d+(\s|$)/i.test(name)) return /^\s*l/i.test(name) ? 'L' : 'R';
    if (/mark([LR])\b/.test(styleUrl)) return /markL/.test(styleUrl) ? 'L' : 'R';
    var t = name + ' ' + desc;
    var l = /\bleft\b/i.test(t), r = /\bright\b/i.test(t);
    if (l && !r) return 'L';
    if (r && !l) return 'R';
    return ''; // unknown (foreign KML)
  }
  function catFrom(data, name, styleUrl) {
    if (data.cat && catById(data.cat)) return data.cat;
    var m = /#cat-(\w+)/.exec(styleUrl || '');
    if (m && catById(m[1])) return m[1];
    for (var i = 0; i < CATS.length; i++) if (name.toLowerCase().indexOf(CATS[i].label.toLowerCase()) >= 0) return CATS[i].id;
    return '';
  }
  function parseKmlDoc(doc) {
    var marks = [], tracks = [];
    kids(doc, 'Placemark').forEach(function (pm) {
      var name = text(pm, 'name'), desc = text(pm, 'description');
      var pts = kids(pm, 'Point');
      var lss = kids(pm, 'LineString');
      pts.forEach(function (pt, pi) {
        var c = text(pt, 'coordinates').split(/[,\s]+/);
        var lon = parseFloat(c[0]), lat = parseFloat(c[1]);
        if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        var data = {};
        kids(pm, 'Data').forEach(function (d) { data[d.getAttribute('name')] = text(d, 'value'); });
        kids(pm, 'SimpleData').forEach(function (d) { data[d.getAttribute('name')] = (d.textContent || '').trim(); });
        var side = sideFrom(data, name, desc, text(pm, 'styleUrl'));
        var ts = parseInt(data.ts, 10);
        if (!ts) { var w = text(pm, 'when'); ts = w ? Date.parse(w) : NaN; }
        if (!ts || isNaN(ts)) ts = 0;
        var nm = /^\s*[LR][-_ ]?(\d+)(\s|$)/i.exec(name) || /(\d+)\s*$/.exec(name);
        var cat = catFrom(data, name, text(pm, 'styleUrl'));
        var n = parseInt(data.n, 10) || (nm ? parseInt(nm[1], 10) : 0);
        var acc = data.accuracy === '' || data.accuracy == null ? null : parseFloat(data.accuracy);
        var status = data.status === 'found' || data.status === 'treated' ? data.status : (data.found === '1' ? 'found' : '');
        var foundTs = parseInt(data.foundTs, 10) || 0;
        marks.push({ side: side, cat: cat, n: n, name: pts.length > 1 ? (name || '') + ' #' + (pi + 1) : name, lat: lat, lon: lon,
          acc: isNaN(acc) ? null : acc, ts: ts, imported: true, status: status, foundTs: foundTs });
      });
      if (!pts.length) lss.forEach(function (ls) {
        var p = text(ls, 'coordinates').split(/\s+/).map(function (s) {
          var q = s.split(',');
          return { lon: parseFloat(q[0]), lat: parseFloat(q[1]) };
        }).filter(function (q) { return !isNaN(q.lat) && !isNaN(q.lon); });
        if (p.length) tracks.push({ name: name || 'Imported track', pts: p });
      });
    });
    return { marks: marks, tracks: tracks };
  }
  function parseKml(str, DOMParserCtor) {
    var P = DOMParserCtor || root.DOMParser;
    var doc = new P().parseFromString(str, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid KML/XML');
    return parseKmlDoc(doc);
  }

  // Export a Find session (points + found status) as KML. Re-importable by this app.
  function buildFindKml(session, opts) {
    opts = opts || {};
    var pts = session.points || [];
    var nFound = pts.filter(function (p) { return p.status; }).length;
    var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2">', '<Document>'];
    out.push('<name>' + esc(opts.name || session.name || 'Mistletoe find session') + '</name>');
    out.push('<description>Find session exported ' + esc(fmtLocal(Date.now())) + ' - ' + nFound + ' of ' + pts.length + ' found/treated</description>');
    ['L', 'R'].forEach(function (s) {
      out.push('<Style id="mark' + s + '"><IconStyle><color>' + COLOURS[s] + '</color><scale>1.2</scale>' +
        '<Icon><href>' + ICON + '</href></Icon></IconStyle><LabelStyle><color>' + COLOURS[s] + '</color></LabelStyle></Style>');
    });
    catStyles(out);
    out.push('<Style id="markU"><IconStyle><color>ffcccccc</color><scale>1.2</scale><Icon><href>' + ICON + '</href></Icon></IconStyle></Style>');
    out.push('<Style id="found"><IconStyle><color>ff03b698</color><scale>1.0</scale><Icon><href>' + ICON + '</href></Icon></IconStyle>' +
      '<LabelStyle><color>ff03b698</color></LabelStyle></Style>');
    out.push('<Style id="trackStyle"><LineStyle><color>ff03b698</color><width>3</width></LineStyle></Style>');
    out.push('<Folder><name>Marks</name>');
    pts.forEach(function (p, i) {
      var nm = p.name || ((p.side === 'L' ? 'L-' : p.side === 'R' ? 'R-' : 'M-') + (p.n || i + 1));
      var status = p.status || 'not found';
      var desc = (p.cat && catById(p.cat) ? 'Category: ' + catLabel(p.cat) + '\n' : '') + 'Side: ' + (p.side === 'L' ? 'LEFT' : p.side === 'R' ? 'RIGHT' : 'unknown') + '\nStatus: ' + status +
        (p.foundTs ? '\nFound: ' + fmtLocal(p.foundTs) + ' (' + new Date(p.foundTs).toISOString() + ')' : '');
      out.push('<Placemark><name>' + esc(nm) + '</name><description>' + esc(desc) + '</description>');
      if (p.ts) out.push('<TimeStamp><when>' + new Date(p.ts).toISOString() + '</when></TimeStamp>');
      out.push('<styleUrl>#' + (p.status ? 'found' : p.cat && catById(p.cat) ? 'cat-' + p.cat : 'mark' + (p.side || 'U')) + '</styleUrl>');
      out.push('<ExtendedData><Data name="side"><value>' + (p.side || '') + '</value></Data>' +
        (p.cat && catById(p.cat) ? '<Data name="cat"><value>' + p.cat + '</value></Data><Data name="category"><value>' + esc(catLabel(p.cat)) + '</value></Data>' : '') +
        '<Data name="n"><value>' + (p.n || '') + '</value></Data>' +
        '<Data name="accuracy"><value>' + (p.acc == null ? '' : p.acc) + '</value></Data>' +
        '<Data name="ts"><value>' + (p.ts || '') + '</value></Data>' +
        '<Data name="found"><value>' + (p.status ? 1 : 0) + '</value></Data>' +
        '<Data name="status"><value>' + (p.status || '') + '</value></Data>' +
        '<Data name="foundTs"><value>' + (p.foundTs || '') + '</value></Data></ExtendedData>');
      out.push('<Point><coordinates>' + p.lon.toFixed(7) + ',' + p.lat.toFixed(7) + ',0</coordinates></Point></Placemark>');
    });
    out.push('</Folder>');
    var tr = session.track || [];
    if (tr.length >= 2) {
      out.push('<Placemark><name>Search track</name><styleUrl>#trackStyle</styleUrl><LineString><tessellate>1</tessellate><coordinates>');
      out.push(tr.map(function (q) { return q.lon.toFixed(7) + ',' + q.lat.toFixed(7) + ',0'; }).join(' '));
      out.push('</coordinates></LineString></Placemark>');
    }
    out.push('</Document></kml>');
    return out.join('\n');
  }

  var api = { CATS: CATS, catById: catById, catLabel: catLabel, buildKml: buildKml, buildFindKml: buildFindKml, parseKml: parseKml, markName: markName, fmtLocal: fmtLocal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KML = api;
})(typeof self !== 'undefined' ? self : this);
