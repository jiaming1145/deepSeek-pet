// Generates apps/desktop/resources/tray.png — a 16x16 RGBA disc — with no dependencies.
// Run: node scripts/make-tray-icon.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const W = 16, H = 16;
const rows = [];
for (let y = 0; y < H; y++) {
  const row = [0];
  for (let x = 0; x < W; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const inside = dx * dx + dy * dy <= 6.5 * 6.5;
    row.push(inside ? 0xff : 0x00, inside ? 0x8c : 0x00, inside ? 0xb4 : 0x00, inside ? 0xff : 0x00);
  }
  rows.push(...row);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0)),
]);
const out = join(root, 'apps/desktop/resources/tray.png');
mkdirSync(join(root, 'apps/desktop/resources'), { recursive: true });
writeFileSync(out, png);
console.log('wrote apps/desktop/resources/tray.png', png.length, 'bytes');
