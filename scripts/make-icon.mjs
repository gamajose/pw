// Gera build/icon.png (256x256) e build/icon.ico sem dependências externas.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'build');
fs.mkdirSync(out, { recursive: true });

const S = 256;
const px = Buffer.alloc(S * S * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const sa = px[i + 3] / 255;
  const oa = a + sa * (1 - a);
  px[i] = Math.round((r * a + px[i] * sa * (1 - a)) / (oa || 1));
  px[i + 1] = Math.round((g * a + px[i + 1] * sa * (1 - a)) / (oa || 1));
  px[i + 2] = Math.round((b * a + px[i + 2] * sa * (1 - a)) / (oa || 1));
  px[i + 3] = Math.round(oa * 255);
}

// Cobertura suavizada (antialiasing por supersampling 4x4).
function shape(inside, color) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hit++;
      if (hit) {
        const [r, g, b] = typeof color === 'function' ? color(x, y) : color;
        blend(x, y, r, g, b, hit / 16);
      }
    }
  }
}

const roundRect = (x0, y0, x1, y1, rad) => (x, y) => {
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
};
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

// Fundo: quadrado arredondado com degradê azul -> roxo.
shape(roundRect(8, 8, 248, 248, 52), (x, y) => {
  const t = (x + y) / (2 * S);
  return [Math.round(13 + (111 - 13) * t), Math.round(110 + (66 - 110) * t), Math.round(253 + (193 - 253) * t)];
});

// "Controle": corpo arredondado + direcional + botões.
const white = [255, 255, 255];
shape(roundRect(46, 92, 210, 176, 40), white);
const blue = [40, 80, 220];
shape((x, y) => (x >= 72 && x <= 112 && y >= 126 && y <= 142) || (x >= 84 && x <= 100 && y >= 114 && y <= 154), blue);
shape(circle(160, 122, 10), [220, 53, 69]);
shape(circle(182, 144, 10), [25, 135, 84]);

// PNG
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(out, 'icon.png'), png);

// ICO com a imagem PNG 256x256 embutida.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0;
entry[1] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, entry, png]));
console.log('build/icon.png e build/icon.ico gerados');
