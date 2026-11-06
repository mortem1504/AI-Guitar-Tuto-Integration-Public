/**
 * Where a point in the camera's picture lands on the screen.
 *
 * The model reports landmarks from 0 to 1 across the *video frame*, but the
 * video is displayed with `object-fit: cover` — scaled up until it fills the
 * window, with the overflow cropped off the sides or the top. Drawing at
 * `x * canvasWidth` would therefore miss the hand by the width of that crop,
 * and everything this app does depends on the overlay sitting exactly on top
 * of what the camera saw.
 *
 * The inverse matters just as much: calibration is four mouse clicks, and a
 * click arrives in screen pixels that have to become camera coordinates before
 * they mean anything.
 *
 * Pure on purpose — it takes numbers and returns numbers, so the crop maths can
 * be checked without a camera.
 */

import type { Point } from "../vision/landmarks";

export interface Viewport {
  /** Camera coordinates (0..1) to canvas pixels. */
  toCanvas(point: Point): Point;
  /** Canvas pixels back to camera coordinates (0..1, may fall outside if cropped). */
  toCamera(point: Point): Point;
  /** How many canvas pixels one unit of camera width covers. */
  readonly scaleX: number;
  readonly scaleY: number;
}

export function coverViewport(videoW: number, videoH: number, canvasW: number, canvasH: number): Viewport {
  // A degenerate camera (not ready yet) must not produce NaNs downstream.
  if (videoW <= 0 || videoH <= 0) {
    return {
      scaleX: canvasW,
      scaleY: canvasH,
      toCanvas: (p) => ({ x: p.x * canvasW, y: p.y * canvasH }),
      toCamera: (p) => ({ x: p.x / (canvasW || 1), y: p.y / (canvasH || 1) }),
    };
  }

  const scale = Math.max(canvasW / videoW, canvasH / videoH);
  const drawnW = videoW * scale;
  const drawnH = videoH * scale;
  const offsetX = (canvasW - drawnW) / 2;
  const offsetY = (canvasH - drawnH) / 2;

  return {
    scaleX: drawnW,
    scaleY: drawnH,
    toCanvas: (p) => ({ x: offsetX + p.x * drawnW, y: offsetY + p.y * drawnH }),
    toCamera: (p) => ({ x: (p.x - offsetX) / drawnW, y: (p.y - offsetY) / drawnH }),
  };
}
