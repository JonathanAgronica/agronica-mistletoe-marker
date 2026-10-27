// Local stub for the Esri tile servers so headless tests never touch the internet.
// Serves /imagery/tile/{z}/{y}/{x} and /labels/tile/{z}/{y}/{x} (256px PNG, CORS enabled) and counts requests.
const http = require('http'), zlib = require('zlib');
function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
function png(seed, labels) {
  const W = 256, raw = Buffer.alloc((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const i = y * (W * 3 + 1) + 1 + x * 3, n = ((x * 7 + y * 13 + seed * 31) % 29) / 29;
      raw[i] = 40 + 50 * n + (seed % 3) * 10; raw[i + 1] = 80 + 60 * n; raw[i + 2] = 35 + 30 * n;      // greenish "orchard" texture
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
exports.start = function () {
  const stats = { imagery: 0, labels: 0, urls: [] };
  const srv = http.createServer((req, res) => {
    const m = /^\/(imagery|labels)\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(req.url);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!m) { res.statusCode = 404; return res.end(); }
    stats[m[1]]++; stats.urls.push(req.url);
    res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'no-store');
    res.end(png(+m[2] + +m[3] + +m[4], m[1] === 'labels'));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => {
    const base = 'http://127.0.0.1:' + srv.address().port;
    r({ stats, close: () => srv.close(), kill: () => { srv.close(); srv.closeAllConnections(); }, imagery: base + '/imagery/tile/{z}/{y}/{x}', labels: base + '/labels/tile/{z}/{y}/{x}' });
  }));
};
