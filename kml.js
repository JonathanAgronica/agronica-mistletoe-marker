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
  function markName(m) { return m.name || ((m.side === 'L' ? 'L-' : 'R-') + m.n); }

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
    out.push('<Style id="trackStyle"><LineStyle><color>ff03b698</color><width>3</width></LineStyle></Style>');

    out.push('<Folder><name>Marks</name>');
    marks.forEach(function (m) {
      var acc = (m.acc == null || isNaN(m.acc)) ? 'n/a' : Math.round(m.acc * 10) / 10 + ' m';
      var desc = 'Side: ' + (m.side === 'L' ? 'LEFT' : 'RIGHT') + '\nTime: ' + fmtLocal(m.ts) +
        ' (' + new Date(m.ts).toISOString() + ')\nAccuracy: ' + acc;
      out.push('<Placemark>');
      out.push('<name>' + esc(markName(m)) + '</name>');
      out.push('<description>' + esc(desc) + '</description>');
      out.push('<TimeStamp><when>' + new Date(m.ts).toISOString() + '</when></TimeStamp>');
      out.push('<styleUrl>#mark' + (m.side === 'L' ? 'L' : 'R') + '</styleUrl>');
      out.push('<ExtendedData>' +
        '<Data name="side"><value>' + m.side + '</value></Data>' +
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
  function parseKmlDoc(doc) {
    var marks = [], tracks = [];
    kids(doc, 'Placemark').forEach(function (pm) {
      var pt = pm.getElementsByTagName('Point')[0];
      var ls = pm.getElementsByTagName('LineString')[0];
      var name = text(pm, 'name');
      if (pt) {
        var c = text(pt, 'coordinates').split(',');
        var lon = parseFloat(c[0]), lat = parseFloat(c[1]);
        if (isNaN(lat) || isNaN(lon)) return;
        var data = {};
        kids(pm, 'Data').forEach(function (d) { data[d.getAttribute('name')] = text(d, 'value'); });
        var side = data.side || (/^\s*r/i.test(name) ? 'R' : 'L');
        if (!data.side) {
          var su = text(pm, 'styleUrl');
          if (/markR/.test(su)) side = 'R'; else if (/markL/.test(su)) side = 'L';
        }
        var ts = parseInt(data.ts, 10);
        if (!ts) { var w = text(pm, 'when'); ts = w ? Date.parse(w) : NaN; }
        if (!ts || isNaN(ts)) ts = 0;
        var nm = /(\d+)\s*$/.exec(name);
        var n = parseInt(data.n, 10) || (nm ? parseInt(nm[1], 10) : 0);
        var acc = data.accuracy === '' || data.accuracy == null ? null : parseFloat(data.accuracy);
        marks.push({ side: side === 'R' ? 'R' : 'L', n: n, name: name, lat: lat, lon: lon,
          acc: isNaN(acc) ? null : acc, ts: ts, imported: true });
      } else if (ls) {
        var pts = text(ls, 'coordinates').split(/\s+/).map(function (s) {
          var p = s.split(',');
          return { lon: parseFloat(p[0]), lat: parseFloat(p[1]) };
        }).filter(function (p) { return !isNaN(p.lat) && !isNaN(p.lon); });
        if (pts.length) tracks.push({ name: name || 'Imported track', pts: pts });
      }
    });
    return { marks: marks, tracks: tracks };
  }
  function parseKml(str, DOMParserCtor) {
    var P = DOMParserCtor || root.DOMParser;
    var doc = new P().parseFromString(str, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid KML/XML');
    return parseKmlDoc(doc);
  }

  var api = { buildKml: buildKml, parseKml: parseKml, markName: markName, fmtLocal: fmtLocal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KML = api;
})(typeof self !== 'undefined' ? self : this);
