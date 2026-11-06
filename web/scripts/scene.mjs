/**
 * Draws synthetic rooms with a guitar in them, as PNGs, for `neck-check`.
 *
 *   node scripts/scene.mjs out-dir
 *
 * The detector's problem has never been a constant: it is telling a fretboard
 * from everything else in a bedroom that has stripes on it. Real photographs
 * are the only real evidence, but they are slow to collect and impossible to
 * vary one thing at a time — so this draws the cases on purpose: a neck alone,
 * a striped blanket alone, and the two in one frame at similar angles, which is
 * exactly the picture the first version of the detector failed on.
 *
 * Deliberately crude. A perspective trapezoid with six strings and frets at
 * 2^(-n/12), plus blocks of even stripes. If the detector cannot pass this it
 * has no business being pointed at a room.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const WIDTH = 1280;
const HEIGHT = 720;

function canvas(background = 150) {
  const pixels = new Uint8Array(WIDTH * HEIGHT).fill(background);
  // A little noise, because a perfectly flat wall makes edge percentiles lie.
  for (let i = 0; i < pixels.length; i++) pixels[i] = clamp(pixels[i] + (Math.random() - 0.5) * 10);
  return pixels;
}

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

function line(pixels, a, b, value, thickness = 1) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    for (let dy = -thickness; dy <= thickness; dy++) {
      for (let dx = -thickness; dx <= thickness; dx++) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) continue;
        pixels[py * WIDTH + px] = clamp(value);
      }
    }
  }
}

function quad(pixels, corners, value) {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(HEIGHT - 1, Math.ceil(Math.max(...ys))); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(WIDTH - 1, Math.ceil(Math.max(...xs))); x++) {
      if (inside(corners, x, y)) pixels[y * WIDTH + x] = clamp(value + (Math.random() - 0.5) * 8);
    }
  }
}

function inside(corners, x, y) {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}

const fretAt = (n) => 1 - Math.pow(2, -n / 12);

/**
 * A neck: the nut at `nut`, running to `end`, `halfNut`/`halfEnd` wide, with
 * frets up to `frets` drawn where they really fall and six strings across it.
 */
function neck(pixels, { nut, end, frets = 9, wood = 55, wire = 215 }) {
  const axis = { x: end.x - nut.x, y: end.y - nut.y };
  const length = Math.hypot(axis.x, axis.y);
  const unit = { x: axis.x / length, y: axis.y / length };
  const across = { x: -unit.y, y: unit.x };
  // The scale length, of which the drawn stretch is only the first frets.
  const scale = length / fretAt(frets + 0.6);
  // To scale, which the first version of this file was not: it drew a neck a
  // twenty-fourth of its own scale length across, where a guitar is a
  // sixteenth. The detector uses that ratio to work out which fret is which
  // (see SCALE_OVER_WIDTH), so a drawing out of proportion made it read frets
  // 1 to 9 as 3 to 12 — a failure of the test, not of the thing being tested.
  const halfNut = scale / 32;
  const halfEnd = halfNut * 1.3;

  const at = (alongPixels, side) => {
    const t = alongPixels / length;
    const half = halfNut + (halfEnd - halfNut) * t;
    return {
      x: nut.x + unit.x * alongPixels + across.x * half * side,
      y: nut.y + unit.y * alongPixels + across.y * half * side,
    };
  };

  quad(pixels, [at(0, 1), at(0, -1), at(length, -1), at(length, 1)], wood);

  for (let fret = 0; fret <= frets; fret++) {
    const alongPixels = scale * fretAt(fret);
    if (alongPixels > length) break;
    line(pixels, at(alongPixels, 1), at(alongPixels, -1), wire, fret === 0 ? 2 : 1);
  }

  for (let string = 0; string < 6; string++) {
    const side = -1 + (2 * string) / 5;
    line(pixels, at(0, side * 0.82), at(length, side * 0.82), wire, 0);
  }
}

/** Even stripes over a rectangle, at an angle: a blanket, a blind, a radiator. */
function stripes(pixels, { from, to, gap, angleDeg, value = 90, thickness = 1 }) {
  const angle = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const count = Math.floor(length / gap);
  const nx = -dy;
  const ny = dx;
  for (let i = 0; i <= count; i++) {
    const base = { x: from.x + nx * i * gap, y: from.y + ny * i * gap };
    line(pixels, base, { x: base.x + dx * 520, y: base.y + dy * 520 }, value, thickness);
  }
}

// --- PNG out (greyscale, 8-bit) ---

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function writePng(path, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const raw = Buffer.alloc((WIDTH + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    raw[y * (WIDTH + 1)] = 0;
    raw.set(pixels.subarray(y * WIDTH, (y + 1) * WIDTH), y * (WIDTH + 1) + 1);
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

// --- The scenes ---

const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });

const scenes = {
  "neck-alone": () => {
    const pixels = canvas();
    neck(pixels, { nut: { x: 1080, y: 300 }, end: { x: 300, y: 430 } });
    return pixels;
  },
  "blanket-alone": () => {
    const pixels = canvas();
    stripes(pixels, { from: { x: 120, y: 380 }, to: { x: 120, y: 700 }, gap: 26, angleDeg: 8 });
    return pixels;
  },
  "neck-and-blanket": () => {
    const pixels = canvas();
    stripes(pixels, { from: { x: 100, y: 430 }, to: { x: 100, y: 700 }, gap: 24, angleDeg: 9 });
    neck(pixels, { nut: { x: 1080, y: 300 }, end: { x: 300, y: 430 } });
    return pixels;
  },
  "neck-hand-over-frets": () => {
    const pixels = canvas();
    neck(pixels, { nut: { x: 1080, y: 300 }, end: { x: 300, y: 430 } });
    // A hand across the middle of the neck: frets 4 to 7 simply gone.
    quad(
      pixels,
      [
        { x: 640, y: 300 },
        { x: 780, y: 300 },
        { x: 800, y: 470 },
        { x: 660, y: 470 },
      ],
      175,
    );
    return pixels;
  },
};

for (const [name, draw] of Object.entries(scenes)) {
  const path = `${out}/${name}.png`;
  writePng(path, draw());
  console.log(path);
}
