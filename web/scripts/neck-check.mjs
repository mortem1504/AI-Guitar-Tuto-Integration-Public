/**
 * Runs the neck detector against a still photograph, with no browser.
 *
 *   npm run neck-check -- path/to/photo.png
 *
 * This exists because the detector was written, shipped, and only then pointed
 * at a real guitar in a real room, where it failed completely. Every constant
 * in NeckDetector.ts that has a number in its comment was set by running this.
 *
 * PNG only, 8-bit, decoded here so the repo stays at one dependency. Camera
 * frames arrive as JPEG, so convert first — on Windows, without installing
 * anything:
 *
 *   Add-Type -AssemblyName System.Drawing
 *   $i = [System.Drawing.Image]::FromFile("shot.jpg")
 *   $i.Save("shot.png", [System.Drawing.Imaging.ImageFormat]::Png)
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { detectInGrey, WORK_WIDTH } from "../src/vision/NeckDetector.ts";

function decodePng(path) {
  const buf = readFileSync(path);
  let pos = 8; // skip signature
  let width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("only 8-bit PNGs here, got " + bitDepth);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = inflateSync(Buffer.concat(idat));

  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    out.set(cur, y * stride);
    prev = cur;
  }
  return { pixels: out, width, height, channels };
}

// Same shrink-and-grey the detector does, minus the canvas.
function greyDownscale(png, targetWidth) {
  const scale = png.width / targetWidth;
  const w = targetWidth;
  const h = Math.round(png.height / scale);
  const grey = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(png.width - 1, Math.floor(x * scale));
      const sy = Math.min(png.height - 1, Math.floor(y * scale));
      const i = (sy * png.width + sx) * png.channels;
      grey[y * w + x] = 0.299 * png.pixels[i] + 0.587 * png.pixels[i + 1] + 0.114 * png.pixels[i + 2];
    }
  }
  return { grey, width: w, height: h };
}

const path = process.argv[2];
const png = decodePng(path);
console.log(`image ${png.width}x${png.height}, ${png.channels} channels`);

const { grey, width, height } = greyDownscale(png, WORK_WIDTH);
const found = detectInGrey(grey, width, height);
if (!found) {
  console.log("DETECTOR RETURNED NULL");
} else {
  const px = (p) => `(${Math.round(p.x * png.width)}, ${Math.round(p.y * png.height)})`;
  console.log(`confidence ${found.confidence.toFixed(2)}, far pair called fret ${found.farFret}`);
  console.log(`  nut side   ${px(found.corners[0])}  ${px(found.corners[1])}`);
  console.log(`  far side   ${px(found.corners[2])}  ${px(found.corners[3])}`);
}
