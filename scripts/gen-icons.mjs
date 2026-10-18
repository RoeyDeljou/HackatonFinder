// Generates the PNG app icons with no dependencies (radar motif on a gradient).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => Math.round(a + (b - a) * t);
const smooth = (edge, w, d) => Math.max(0, Math.min(1, (edge - d) / w + 0.5));

// scale: how much of the canvas the motif uses (maskable icons need a safe zone)
function icon({ rounded, scale = 1, mono = false }) {
  return (x, y, s) => {
    const nx = x / s, ny = y / s;
    const cx = 0.5, cy = 0.5;
    // Background: indigo → violet diagonal gradient.
    const t = (nx + ny) / 2;
    let bg = [mix(79, 124, t), mix(70, 58, t), mix(229, 237, t), 255];
    let alpha = 1;
    if (rounded) {
      const r = 0.22, qx = Math.abs(nx - 0.5) - (0.5 - r), qy = Math.abs(ny - 0.5) - (0.5 - r);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      alpha = smooth(0, 1.5 / s, d);
    }
    if (mono) { bg = [0, 0, 0, 0]; alpha = 1; }
    const dist = Math.hypot(nx - cx, ny - cy) / scale;
    // Rings + sweep + center dot + target blip.
    let w = 0;
    for (const rr of [0.36, 0.24]) w = Math.max(w, smooth(0.022, 1.5 / s, Math.abs(dist - rr)));
    w = Math.max(w, smooth(0.075, 1.5 / s, dist));
    const ang = Math.atan2(ny - cy, nx - cx);
    if (dist < 0.36 && ang > -Math.PI / 2 && ang < -Math.PI / 2 + 0.9) w = Math.max(w, 0.28 * (1 - (ang + Math.PI / 2) / 0.9));
    const blip = Math.hypot(nx - (cx + 0.2 * scale), ny - (cy - 0.17 * scale)) / scale;
    const b = smooth(0.05, 1.5 / s, blip);
    const white = Math.max(w, b);
    if (mono) return [255, 255, 255, Math.round(255 * white)];
    let px = [mix(bg[0], 255, white), mix(bg[1], 255, white), mix(bg[2], 255, white)];
    if (b > 0.01) px = [mix(px[0], 52, b), mix(px[1], 211, b), mix(px[2], 153, b)];
    return [...px, Math.round(255 * alpha)];
  };
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, icon({ rounded: true })));
writeFileSync('public/icons/icon-512.png', png(512, icon({ rounded: true })));
writeFileSync('public/icons/icon-maskable-512.png', png(512, icon({ rounded: false, scale: 0.78 })));
writeFileSync('public/icons/apple-touch-icon.png', png(180, icon({ rounded: false })));
writeFileSync('public/icons/badge-72.png', png(72, icon({ mono: true })));
console.log('icons written to public/icons');
