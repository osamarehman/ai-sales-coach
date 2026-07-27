/**
 * Generates a 1024x1024 placeholder app icon (source.png) with no image libraries —
 * pure Node zlib + hand-rolled PNG chunks. Run once: `bun run generate-source.ts`.
 * Then `bunx @tauri-apps/cli@^2 icon source.png` fans out .png/.icns/.ico for bundling.
 * Replace source.png with the real brand icon when design delivers one.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 1024;

// CRC32 (PNG chunk checksum).
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = new TextEncoder().encode(type);
  const body = new Uint8Array(t.length + data.length);
  body.set(t, 0);
  body.set(data, t.length);
  const out = new Uint8Array(4 + body.length + 4); // length(4) + type+data + crc(4)
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(body, 4);
  dv.setUint32(4 + body.length, crc32(body));
  return out;
}

// Raster: indigo background (#4F46E5) with a soft white coaching dot in the center.
const raw = new Uint8Array(SIZE * (1 + SIZE * 4));
const cx = SIZE / 2,
  cy = SIZE / 2,
  r = SIZE * 0.3;
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const o = rowStart + 1 + x * 4;
    const d = Math.hypot(x - cx, y - cy);
    const t = Math.min(1, Math.max(0, (r - d) / 40)); // 0 outside, 1 inside, soft edge
    // background gradient indigo -> violet down the y axis
    const bg = [0x4f + (y / SIZE) * 0x20, 0x46, 0xe5];
    raw[o] = Math.round(bg[0] * (1 - t) + 0xff * t);
    raw[o + 1] = Math.round(bg[1] * (1 - t) + 0xff * t);
    raw[o + 2] = Math.round(bg[2] * (1 - t) + 0xff * t);
    raw[o + 3] = 0xff;
  }
}

const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = new Uint8Array(13);
const dv = new DataView(ihdr.buffer);
dv.setUint32(0, SIZE);
dv.setUint32(4, SIZE);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const idat = deflateSync(raw);
const png = new Uint8Array([...sig, ...chunk("IHDR", ihdr), ...chunk("IDAT", idat), ...chunk("IEND", new Uint8Array(0))]);
writeFileSync(new URL("./source.png", import.meta.url), png);
console.log(`wrote source.png (${SIZE}x${SIZE}, ${png.length} bytes)`);
