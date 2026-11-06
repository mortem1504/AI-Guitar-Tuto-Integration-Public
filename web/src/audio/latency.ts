/**
 * Pluck-to-screen latency, kept as a running sample for p50 and p95.
 *
 * The goal on the slides is 200 ms from pluck to feedback. What can be
 * measured from inside the browser is: the worklet's onset (AudioContext
 * time) → the message arriving on the main thread (the context's clock read
 * on arrival) → the next animation frame after the feedback was put on screen.
 * What it cannot see is the input hardware's own delay before the samples
 * reach the worklet; `AudioContext.baseLatency` is shown next to it as the
 * browser's own estimate of part of that.
 */

export class LatencyStats {
  private readonly samples: number[] = [];

  constructor(private readonly capacity = 500) {}

  add(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get count(): number {
    return this.samples.length;
  }

  get last(): number {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1] : NaN;
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return NaN;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  }

  reset() {
    this.samples.length = 0;
  }
}

/**
 * Milliseconds from an onset to now, in two parts that use two clocks:
 * the audio clock up to the message's arrival, and the page clock after it.
 */
export function pluckToScreenMs(onsetTime: number, arrivalContextTime: number, arrivalPerfMs: number, shownPerfMs: number): number {
  return (arrivalContextTime - onsetTime) * 1000 + (shownPerfMs - arrivalPerfMs);
}
