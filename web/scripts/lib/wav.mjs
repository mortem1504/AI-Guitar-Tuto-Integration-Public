/**
 * Reads a WAV file's first channel as floats in [-1, 1].
 *
 * Enough of RIFF/WAVE for what the lab records (soundfile writes 16-bit PCM)
 * and what an audio interface's own software exports: PCM 8/16/24/32 bit and
 * 32/64-bit float, including WAVE_FORMAT_EXTENSIBLE. Samples are scaled the
 * way libsndfile scales them, so the TS and Python detectors see the same
 * numbers.
 */

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

export function readWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tag = (offset) => String.fromCharCode(...buffer.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");

  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      let code = view.getUint16(body, true);
      if (code === EXTENSIBLE) code = view.getUint16(body + 24, true);
      format = {
        code,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      data = { offset: body, size: Math.min(size, buffer.length - body) };
    }
    offset = body + size + (size % 2);
  }
  if (!format || !data) throw new Error("missing fmt or data chunk");

  const { code, channels, sampleRate, bits } = format;
  const bytes = bits / 8;
  const frame = bytes * channels;
  const count = Math.floor(data.size / frame);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const at = data.offset + i * frame;
    if (code === FLOAT && bits === 32) samples[i] = view.getFloat32(at, true);
    else if (code === FLOAT && bits === 64) samples[i] = view.getFloat64(at, true);
    else if (code === PCM && bits === 8) samples[i] = (view.getUint8(at) - 128) / 128;
    else if (code === PCM && bits === 16) samples[i] = view.getInt16(at, true) / 32768;
    else if (code === PCM && bits === 24) {
      const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
      samples[i] = value / 8388608;
    } else if (code === PCM && bits === 32) samples[i] = view.getInt32(at, true) / 2147483648;
    else throw new Error(`unsupported WAV format ${code}, ${bits} bit`);
  }
  return { samples, sampleRate };
}
