// Minimal PNG icon generator — no dependencies beyond Node core (zlib).
// Draws a rounded-square bookmark glyph at several sizes for the extension icons.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, pixelFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function drawIcon(size) {
  const bgTop = [124, 92, 255]; // indigo
  const bgBottom = [79, 70, 229];
  const radius = size * 0.22;

  function inRoundedSquare(x, y) {
    const cx = x + 0.5;
    const cy = y + 0.5;
    const left = radius, top = radius, right = size - radius, bottom = size - radius;
    if (cx >= left && cx <= right) return true;
    if (cy >= top && cy <= bottom) return true;
    const corners = [
      [left, top], [right, top], [left, bottom], [right, bottom],
    ];
    for (const [ccx, ccy] of corners) {
      if (Math.hypot(cx - ccx, cy - ccy) <= radius) return true;
    }
    return false;
  }

  // Bookmark/link glyph geometry (in unit square 0..1)
  function bookmarkCoverage(x, y) {
    const u = (x + 0.5) / size;
    const v = (y + 0.5) / size;
    const bx0 = 0.32, bx1 = 0.68;
    const by0 = 0.22, by1 = 0.8;
    if (u < bx0 || u > bx1 || v < by0 || v > by1) return 0;
    const notchStart = by1 - (bx1 - bx0) * 0.55;
    if (v < notchStart) return 1;
    // triangular notch at the bottom
    const t = (v - notchStart) / (by1 - notchStart);
    const mid = (bx0 + bx1) / 2;
    const half = (bx1 - bx0) / 2 * (1 - t);
    if (u >= mid - half && u <= mid + half) return 0;
    return 1;
  }

  return (x, y) => {
    if (!inRoundedSquare(x, y)) return [0, 0, 0, 0];
    const t = y / size;
    const r = Math.round(lerp(bgTop[0], bgBottom[0], t));
    const g = Math.round(lerp(bgTop[1], bgBottom[1], t));
    const b = Math.round(lerp(bgTop[2], bgBottom[2], t));
    const glyph = bookmarkCoverage(x, y);
    if (glyph) return [255, 255, 255, 255];
    return [r, g, b, 255];
  };
}

const outDir = path.join(__dirname, "..", "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = encodePNG(size, size, drawIcon(size));
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log("wrote", file);
}
