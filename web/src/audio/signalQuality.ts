/**
 * The live screen's signal line: is the guitar coming through, too quiet, or
 * clipping. Fed every level message (~every 46 ms); pure, so lesson-check
 * drives it.
 *
 * Judged on recent *peaks*, not on the moment: between notes the input is
 * quiet by nature, and saying "too quiet" every time the student breathes
 * would be noise.
 */

import { WEAK_PEAK } from "../lesson/noteJudge";

export type SignalState = "good" | "quiet" | "clipping";

/** Digital full scale, give or take one step of a 16-bit converter: the sample has nowhere left to go. */
export const CLIP_PEAK = 0.99;
/** A clip is shown this long, so a single one is seen at all. */
export const CLIP_HOLD_MS = 2000;
/**
 * Nothing above WEAK_PEAK (the judge's "too quiet to be a pluck") for this
 * long while the student is meant to be playing: the input is not reaching
 * us. Five seconds is LOOP_IDLE_MS, the same patience loop mode has.
 */
export const QUIET_AFTER_MS = 5000;

export class SignalQuality {
  private lastHeardMs = -Infinity;
  private lastClipMs = -Infinity;
  private startedMs: number | null = null;

  add(nowMs: number, peak: number) {
    if (this.startedMs === null) this.startedMs = nowMs;
    if (peak >= WEAK_PEAK) this.lastHeardMs = nowMs;
    if (peak >= CLIP_PEAK) this.lastClipMs = nowMs;
  }

  state(nowMs: number): SignalState {
    if (nowMs - this.lastClipMs < CLIP_HOLD_MS) return "clipping";
    const since = Math.max(this.lastHeardMs, this.startedMs ?? nowMs);
    return nowMs - since > QUIET_AFTER_MS ? "quiet" : "good";
  }

  reset() {
    this.lastHeardMs = -Infinity;
    this.lastClipMs = -Infinity;
    this.startedMs = null;
  }
}
