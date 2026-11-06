/**
 * Whether the camera can be trusted to say *where* right now.
 *
 * The brief's fallback: if there has been no fretting hand for more than a
 * second, or the neck is not calibrated, the session judges by ear alone and
 * says so; it switches back by itself as soon as both are there again. Audio
 * keeps working throughout; the student never has to do anything.
 *
 * Pure: fed the time and what the frame saw, asked for the mode.
 */

export type VisionMode = "fused" | "audio-only";
export type VisionReason = "ok" | "noCamera" | "noCalibration" | "noHand";

/** The brief's "more than 1 s". A blink of the tracker (GRACE_MS in HandTracker) is far shorter. */
export const NO_HAND_MS = 1000;

export class VisionHealth {
  private lastHandMs = -Infinity;
  private calibrated = false;
  private running = false;

  /** One camera frame: was the fretting hand over the neck, and is there a neck. */
  frame(nowMs: number, handOnNeck: boolean, calibrated: boolean) {
    this.running = true;
    this.calibrated = calibrated;
    if (handOnNeck) this.lastHandMs = nowMs;
  }

  /** The camera stopped (or never started). */
  stop() {
    this.running = false;
  }

  reason(nowMs: number): VisionReason {
    if (!this.running) return "noCamera";
    if (!this.calibrated) return "noCalibration";
    if (nowMs - this.lastHandMs > NO_HAND_MS) return "noHand";
    return "ok";
  }

  mode(nowMs: number): VisionMode {
    return this.reason(nowMs) === "ok" ? "fused" : "audio-only";
  }
}
