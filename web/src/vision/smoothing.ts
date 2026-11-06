/**
 * Landmark smoothing.
 *
 * The raw output of the model jitters by a pixel or two every frame. That is
 * invisible on a video overlay but very audible once you map it to pitch or
 * volume, so every coordinate goes through a One Euro filter first.
 *
 * A plain low-pass filter forces a choice between jitter and lag. The One Euro
 * filter avoids it by making the cutoff depend on speed: when the hand is
 * almost still it filters hard, and when you move it fast it barely filters at
 * all. Slow gestures come out steady, fast ones stay responsive.
 *
 * Casiez, Roussel & Vogel, "1€ Filter" (CHI 2012).
 */

import type { Point } from "./landmarks";

const TWO_PI = Math.PI * 2;

export interface OneEuroConfig {
  /** Cutoff in Hz while the value is still. Lower means steadier and laggier. */
  minCutoff: number;
  /** How much speed raises the cutoff. Higher means less lag when moving fast. */
  beta: number;
  /** Cutoff for the speed estimate itself. */
  derivativeCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroConfig = { minCutoff: 1.2, beta: 0.035, derivativeCutoff: 1 };

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (TWO_PI * cutoff);
  return 1 / (1 + tau / dt);
}

class OneEuroFilter {
  private value: number | null = null;
  private derivative = 0;

  constructor(private config: OneEuroConfig) {}

  filter(x: number, dt: number): number {
    if (this.value === null || !Number.isFinite(dt) || dt <= 0) {
      this.value = x;
      return x;
    }
    const rawDerivative = (x - this.value) / dt;
    const dAlpha = alpha(this.config.derivativeCutoff, dt);
    this.derivative += dAlpha * (rawDerivative - this.derivative);

    const cutoff = this.config.minCutoff + this.config.beta * Math.abs(this.derivative);
    const a = alpha(cutoff, dt);
    this.value += a * (x - this.value);
    return this.value;
  }

  reset() {
    this.value = null;
    this.derivative = 0;
  }
}

/** One pair of filters (x and y) per landmark of one hand. */
export class HandSmoother {
  private filters: { x: OneEuroFilter; y: OneEuroFilter }[] = [];
  private lastTime = 0;

  /**
   * The config object is shared with the pool and read on every sample, so
   * changing its fields retunes every filter already running.
   */
  constructor(private config: OneEuroConfig = DEFAULT_ONE_EURO) {}

  smooth(points: Point[], timeMs: number): Point[] {
    const dt = this.lastTime > 0 ? (timeMs - this.lastTime) / 1000 : 1 / 30;
    this.lastTime = timeMs;

    while (this.filters.length < points.length) {
      this.filters.push({ x: new OneEuroFilter(this.config), y: new OneEuroFilter(this.config) });
    }

    return points.map((p, i) => ({
      x: this.filters[i].x.filter(p.x, dt),
      y: this.filters[i].y.filter(p.y, dt),
    }));
  }

  /** Called when the hand disappears, so it does not glide in from its old spot. */
  reset() {
    for (const f of this.filters) {
      f.x.reset();
      f.y.reset();
    }
    this.lastTime = 0;
  }
}

/**
 * Keeps one smoother per tracked hand.
 *
 * MediaPipe gives no stable identity across frames, so hands are matched to
 * their smoother by whichever one was closest last frame. That survives the
 * handedness label flickering, which it does whenever you turn a palm over.
 */
export class HandSmootherPool {
  private slots: { smoother: HandSmoother; lastPalm: Point; lastSeen: number }[] = [];
  /** Shared by every smoother, so retuning is a single assignment. */
  readonly config: OneEuroConfig = { ...DEFAULT_ONE_EURO };

  constructor(private capacity = 2) {}

  /** Higher cutoffs follow the hand more closely; lower ones hold it steadier. */
  tune(minCutoff: number, beta: number) {
    this.config.minCutoff = minCutoff;
    this.config.beta = beta;
  }

  /** Returns the smoothed points for a hand whose palm is near `palm`. */
  smooth(points: Point[], palm: Point, timeMs: number, claimed: Set<number>): { points: Point[]; slot: number } {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      if (claimed.has(i)) continue;
      const slot = this.slots[i];
      // A hand cannot teleport; anything further than this is a different hand.
      if (timeMs - slot.lastSeen > 500) continue;
      const d = Math.hypot(slot.lastPalm.x - palm.x, slot.lastPalm.y - palm.y);
      if (d < bestDistance && d < 0.35) {
        best = i;
        bestDistance = d;
      }
    }

    if (best === -1) {
      if (this.slots.length < this.capacity) {
        this.slots.push({ smoother: new HandSmoother(this.config), lastPalm: palm, lastSeen: timeMs });
        best = this.slots.length - 1;
      } else {
        // Reuse the slot that has been idle longest.
        best = this.slots.reduce((oldest, s, i) => (s.lastSeen < this.slots[oldest].lastSeen ? i : oldest), 0);
        if (claimed.has(best)) best = (best + 1) % this.slots.length;
        this.slots[best].smoother.reset();
      }
    }

    const slot = this.slots[best];
    slot.lastPalm = palm;
    slot.lastSeen = timeMs;
    claimed.add(best);
    return { points: slot.smoother.smooth(points, timeMs), slot: best };
  }
}
