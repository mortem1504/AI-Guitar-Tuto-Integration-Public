/**
 * Fast Fourier transforms for the note detector.
 *
 * A plain iterative radix-2 FFT, used twice: as a magnitude spectrum for the
 * onset detector, and as fast correlation for the pitch detectors. Everything
 * is allocated once in a constructor, because this runs on the audio thread
 * and a garbage-collector pause there is a glitch for everything else in the
 * graph. Float64 throughout: correlation sums thousands of products, and the
 * pitch detectors divide those sums by each other.
 */

export class Fft {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reversed: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reversed[i] = r;
    }
  }

  /** In place. The inverse is unscaled: divide by `size` afterwards if it matters. */
  transform(re: Float64Array, im: Float64Array, inverse = false) {
    const { size, reversed } = this;
    for (let i = 0; i < size; i++) {
      const j = reversed[i];
      if (j > i) {
        let swap = re[i];
        re[i] = re[j];
        re[j] = swap;
        swap = im[i];
        im[i] = im[j];
        im[j] = swap;
      }
    }

    const sign = inverse ? 1 : -1;
    for (let half = 1; half < size; half *= 2) {
      const step = size / (half * 2);
      for (let start = 0; start < size; start += half * 2) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = sign * this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = wr * re[b] - wi * im[b];
          const ti = wr * im[b] + wi * re[b];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

/** Magnitude spectrum of a Hann-windowed frame, for the onset detector. */
export class Spectrum {
  readonly size: number;
  private readonly fft: Fft;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(size: number) {
    this.size = size;
    this.fft = new Fft(size);
    this.window = new Float64Array(size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    // Hann: without a window, the edges of every frame look like a click, and
    // a click is exactly what the onset detector is listening for.
    for (let i = 0; i < size; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  }

  /** Writes |X[k]| for k = 0 .. size/2 - 1. `frame` must hold `size` samples. */
  magnitudes(frame: Float32Array, out: Float32Array) {
    const { size, re, im } = this;
    for (let i = 0; i < size; i++) {
      re[i] = frame[i] * this.window[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);
    for (let k = 0; k < size / 2; k++) out[k] = Math.hypot(re[k], im[k]);
  }
}

/**
 * Σᵢ a[i]·b[i+τ] for every τ in 0..maxLag, in O(n log n) instead of
 * O(n·maxLag): conj(FFT(a))·FFT(b), transformed back. With `a === b` this is
 * the autocorrelation the pitch detectors need.
 *
 * The FFT is sized to at least the two lengths added, so the circular
 * correlation an FFT computes never wraps round onto the lags being read.
 */
export class Correlator {
  private readonly fft: Fft;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;
  private readonly bRe: Float64Array;
  private readonly bIm: Float64Array;

  constructor(maxTotalLength: number) {
    const size = Math.pow(2, Math.ceil(Math.log2(Math.max(2, maxTotalLength))));
    this.fft = new Fft(size);
    this.aRe = new Float64Array(size);
    this.aIm = new Float64Array(size);
    this.bRe = new Float64Array(size);
    this.bIm = new Float64Array(size);
  }

  /** Writes the correlation for lags 0..maxLag into `out`. */
  correlate(
    a: Float64Array,
    aLength: number,
    b: Float64Array,
    bLength: number,
    maxLag: number,
    out: Float64Array,
  ) {
    const { aRe, aIm, bRe, bIm } = this;
    const size = this.fft.size;
    if (aLength + bLength > size) throw new Error("Correlator too small for these lengths");

    aRe.fill(0);
    aIm.fill(0);
    for (let i = 0; i < aLength; i++) aRe[i] = a[i];
    this.fft.transform(aRe, aIm);

    if (a === b && aLength === bLength) {
      // Autocorrelation: one transform, |A|².
      for (let k = 0; k < size; k++) {
        bRe[k] = aRe[k] * aRe[k] + aIm[k] * aIm[k];
        bIm[k] = 0;
      }
    } else {
      bRe.fill(0);
      bIm.fill(0);
      for (let i = 0; i < bLength; i++) bRe[i] = b[i];
      this.fft.transform(bRe, bIm);
      for (let k = 0; k < size; k++) {
        // conj(A)·B
        const re = aRe[k] * bRe[k] + aIm[k] * bIm[k];
        const im = aRe[k] * bIm[k] - aIm[k] * bRe[k];
        bRe[k] = re;
        bIm[k] = im;
      }
    }

    this.fft.transform(bRe, bIm, true);
    for (let tau = 0; tau <= maxLag; tau++) out[tau] = bRe[tau] / size;
  }
}
