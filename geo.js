/* Geo maths + alert logic (usable in browser and node). */
(function (root) {
  'use strict';
  var R = 6371008.8; // mean earth radius, metres
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function norm360(a) { a = a % 360; return a < 0 ? a + 360 : a; }
  // smallest signed difference to - from, in (-180, 180]
  function diffAngle(from, to) { var d = norm360(to - from); return d > 180 ? d - 360 : d; }

  function haversine(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // initial bearing a -> b, degrees clockwise from true north (0..360)
  function bearing(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return norm360(Math.atan2(y, x) * R2D);
  }
  function destination(a, brg, dist) {
    var d = dist / R, t = brg * D2R, p1 = a.lat * D2R, l1 = a.lon * D2R;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 * R2D, lon: ((l2 * R2D + 540) % 360) - 180 };
  }
  // east/north metres of b relative to a (small-area equirectangular)
  function enu(a, b) {
    return { x: (b.lon - a.lon) * D2R * R * Math.cos(a.lat * D2R), y: (b.lat - a.lat) * D2R * R };
  }

  // W3C DeviceOrientation -> compass heading (deg clockwise from north) of the device's top edge
  function compassHeading(alpha, beta, gamma) {
    var x = (beta || 0) * D2R, y = (gamma || 0) * D2R, z = (alpha || 0) * D2R;
    var cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
    var Vx = -cZ * sY - sZ * sX * cY, Vy = -sZ * sY + cZ * sX * cY;
    // nearly flat: the camera vector is vertical (undefined heading) - use the top edge instead
    if (Math.sqrt(Vx * Vx + Vy * Vy) < 0.35) return norm360(360 - (alpha || 0));
    var h = Math.atan(Vx / Vy);
    if (Vy < 0) h += Math.PI; else if (Vx < 0) h += 2 * Math.PI;
    return norm360(h * R2D);
  }
  // circular low-pass: move prev toward next by factor k (0..1)
  function smoothAngle(prev, next, k) {
    if (prev == null) return norm360(next);
    return norm360(prev + diffAngle(prev, next) * k);
  }

  // alert thresholds for a given alert radius: [radius, half radius, arrived]
  function thresholds(radius) { return { r1: radius, r2: radius / 2, r3: Math.min(5, radius / 3) }; }
  function alertLevel(dist, radius) {
    var t = thresholds(radius);
    return dist <= t.r3 ? 3 : dist <= t.r2 ? 2 : dist <= t.r1 ? 1 : 0;
  }

  // points: [{lat, lon, status?}]; returns [{p, dist, brg}] sorted by distance (all points)
  function withDistances(points, pos) {
    return points.map(function (p) {
      return { p: p, dist: haversine(pos, p), brg: bearing(pos, p) };
    }).sort(function (a, b) { return a.dist - b.dist; });
  }
  function nearestUnfound(points, pos) {
    var best = null;
    points.forEach(function (p) {
      if (p.status) return;
      var d = haversine(pos, p);
      if (!best || d < best.dist) best = { p: p, dist: d, brg: bearing(pos, p) };
    });
    return best;
  }

  // Decide which alert (if any) to fire. alerted: {id: level}, mutated. Only the nearest unfound point alerts.
  // Points beyond 1.2 x radius reset so they can alert again later. Returns level fired (0 = none).
  function nextAlert(points, pos, radius, alerted) {
    points.forEach(function (p) {
      if (alerted[p.id] && (p.status || haversine(pos, p) > radius * 1.2)) delete alerted[p.id];
    });
    var n = nearestUnfound(points, pos);
    if (!n) return null;
    var lvl = alertLevel(n.dist, radius);
    if (lvl > (alerted[n.p.id] || 0)) {
      alerted[n.p.id] = lvl;
      return { level: lvl, p: n.p, dist: n.dist, brg: n.brg };
    }
    return null;
  }

  function fmtDist(d) {
    if (d >= 10000) return (d / 1000).toFixed(0) + ' km';
    if (d >= 1000) return (d / 1000).toFixed(1) + ' km';
    return Math.round(d) + ' m';
  }
  function spokenDist(d) {
    var n = d < 20 ? Math.round(d) : Math.round(d / 5) * 5;
    return n + (n === 1 ? ' metre' : ' metres');
  }
  function sideWord(side) { return side === 'L' ? 'left' : side === 'R' ? 'right' : ''; }
  function speechText(side, dist, level, label) {
    var s = (label || 'Mistletoe') + (sideWord(side) ? ' ' + sideWord(side) : '');
    return level >= 3 ? s + ', arrived' : s + ', ' + spokenDist(dist);
  }
  // relative direction wording for an arrow angle (-180..180, 0 = straight ahead)
  function relWord(rel) {
    var a = Math.abs(rel);
    if (a < 15) return 'ahead';
    if (a > 165) return 'behind';
    var side = rel > 0 ? 'right' : 'left';
    return a < 60 ? 'ahead ' + side : a < 120 ? side : 'behind ' + side;
  }

  var api = { haversine: haversine, bearing: bearing, destination: destination, enu: enu, norm360: norm360,
    diffAngle: diffAngle, compassHeading: compassHeading, smoothAngle: smoothAngle, thresholds: thresholds,
    alertLevel: alertLevel, withDistances: withDistances, nearestUnfound: nearestUnfound, nextAlert: nextAlert,
    fmtDist: fmtDist, spokenDist: spokenDist, speechText: speechText, relWord: relWord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GEO = api;
})(typeof self !== 'undefined' ? self : this);
