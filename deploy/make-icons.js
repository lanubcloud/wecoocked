'use strict';
/*
 * Genera los iconos PNG de la aplicacion sin dependencias externas.
 * Node no trae canvas, asi que se pintan pixel a pixel y se codifican como
 * PNG con zlib, que si viene de serie.
 *
 *   node deploy/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** px: array RGBA de size*size*4 */
function png(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;                     // filtro "none"
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Icono: fondo oscuro redondeado + nigiri (arroz con lomo de salmon). */
function dibujar(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size;
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    const na = a / 255;
    px[i] = px[i] * (1 - na) + r * na;
    px[i + 1] = px[i + 1] * (1 - na) + g * na;
    px[i + 2] = px[i + 2] * (1 - na) + b * na;
    px[i + 3] = Math.max(px[i + 3], a);
  };
  const rad = S * 0.22;
  const dentroRedondeado = (x, y) => {
    const cx = Math.min(Math.max(x, rad), S - rad);
    const cy = Math.min(Math.max(y, rad), S - rad);
    return Math.hypot(x - cx, y - cy) <= rad;
  };
  // fondo con degradado vertical
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!dentroRedondeado(x + 0.5, y + 0.5)) continue;
      const t = y / S;
      set(x, y, 26 + t * 14, 22 + t * 12, 40 + t * 16, 255);
    }
  }
  // elipse del arroz
  const ecx = S * 0.5, ecy = S * 0.60, erx = S * 0.30, ery = S * 0.19;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - ecx) / erx, dy = (y + 0.5 - ecy) / ery;
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        const sombra = Math.max(0, 1 - d) * 0.25;
        set(x, y, 250 - sombra * 30, 249 - sombra * 30, 240 - sombra * 30, 255);
      }
    }
  }
  // lomo de salmon encima
  const scx = S * 0.5, scy = S * 0.44, srx = S * 0.32, sry = S * 0.16;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - scx) / srx, dy = (y + 0.5 - scy) / sry;
      if (dx * dx + dy * dy <= 1) {
        const veta = Math.sin((x / S) * 26) > 0.72 ? 40 : 0;
        set(x, y, 252, 129 + veta, 97 + veta, 255);
      }
    }
  }
  // tira de nori
  for (let y = Math.floor(S * 0.42); y < Math.floor(S * 0.72); y++) {
    for (let x = Math.floor(S * 0.44); x < Math.floor(S * 0.56); x++) {
      const dx = (x + 0.5 - ecx) / erx, dy = (y + 0.5 - ecy) / ery;
      if (dx * dx + dy * dy <= 1.05) set(x, y, 32, 74, 46, 255);
    }
  }
  return png(px, S);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  const f = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(f, dibujar(size));
  console.log('OK ' + f + '  (' + fs.statSync(f).size + ' bytes)');
}
