/**
 * The camera side of following the neck: frames off the video, shrunk to a
 * working size and greyed, handed to `NeckFollower` (the tracking itself,
 * pure, in NeckFollower.ts, where the method and its measurements are
 * described), and its answer turned back into the 0-1 camera corners the
 * rest of the app speaks.
 */

import { applyHomography, homographyFrom } from "../vision/homography";
import type { Point } from "../vision/landmarks";
import type { Grey } from "../vision/patches";
import type { Corners, Fretboard } from "./Fretboard";
import { halfWidthAt, type GuitarSpec } from "./geometry";
import { NeckFollower, type Box } from "./NeckFollower";
import { REFERENCE_POINTS } from "./neckPose";

/** The frame is shrunk to this width before anything is matched. */
const WORK_WIDTH = 320;

/** About 15 passes a second: at 10 a strummed guitar moved past the search between two looks. */
const INTERVAL_MS = 66;

/** The camera side: frames off the video, and corners in the 0-1 camera coordinates the rest of the app speaks. */
export class NeckTracker {
  private canvas = document.createElement("canvas");
  private follower = new NeckFollower();
  private width = 0;
  private height = 0;
  private lastRun = 0;

  get ready(): boolean {
    return this.follower.ready;
  }

  /** Anchors matched on the last pass, for the status line. */
  get held(): number {
    return this.follower.held;
  }

  lost(nowMs: number): boolean {
    return this.follower.lost(nowMs);
  }

  forget() {
    this.follower.forget();
  }

  anchor(video: HTMLVideoElement, board: Fretboard, spec: GuitarSpec, hands: readonly (readonly Point[])[] = [], nowMs = performance.now()) {
    this.forget();
    const frame = this.grab(video);
    if (!frame) return;
    const points = REFERENCE_POINTS.map((p) => board.toCamera(p));
    const toFrame = homographyFrom(
      REFERENCE_POINTS,
      points.map((p) => ({ x: p.x * this.width, y: p.y * this.height })),
    );
    if (!toFrame) return;
    this.follower.anchor(frame, toFrame, spec, board.farFret, this.boxes(hands), nowMs);
  }

  /** Fresh corners when confident; null means "keep what you have" — and `lost` says when that is no longer true. */
  track(video: HTMLVideoElement, nowMs: number, spec: GuitarSpec, farFret: number, hands: readonly (readonly Point[])[] = []): Corners | null {
    if (!this.ready || nowMs - this.lastRun < INTERVAL_MS) return null;
    this.lastRun = nowMs;
    const frame = this.grab(video);
    if (!frame) return null;
    const h = this.follower.track(frame, nowMs, this.boxes(hands));
    if (!h) return null;
    // Back out to the four corners, the shape the rest of the app speaks in,
    // so a tracked neck passes the same checks as a marked one.
    const farX = 1 - Math.pow(2, -farFret / 12);
    return [
      { x: 0, y: halfWidthAt(spec, 0) },
      { x: 0, y: -halfWidthAt(spec, 0) },
      { x: farX, y: -halfWidthAt(spec, farX) },
      { x: farX, y: halfWidthAt(spec, farX) },
    ].map((point) => {
      const image = applyHomography(h, point);
      return { x: image.x / this.width, y: image.y / this.height };
    }) as Corners;
  }

  private boxes(hands: readonly (readonly Point[])[]): Box[] {
    return hands
      .filter((points) => points.length > 0)
      .map((points) => {
        const xs = points.map((point) => point.x * this.width);
        const ys = points.map((point) => point.y * this.height);
        return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      });
  }

  /** One frame, shrunk and greyed. */
  private grab(video: HTMLVideoElement): Grey | null {
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    this.width = WORK_WIDTH;
    this.height = Math.max(2, Math.round((video.videoHeight / video.videoWidth) * WORK_WIDTH));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, this.width, this.height);
    const pixels = context.getImageData(0, 0, this.width, this.height).data;
    const data = new Float32Array(this.width * this.height);
    for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    return { data, width: this.width, height: this.height };
  }
}
