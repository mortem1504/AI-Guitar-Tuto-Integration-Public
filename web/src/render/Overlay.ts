/**
 * Everything drawn on top of the camera.
 *
 * One canvas, redrawn from scratch every frame, in device pixels. It knows
 * nothing about lessons or chords: it is handed shapes already worked out in
 * camera coordinates and puts them on screen through the viewport, which is
 * the only place the `object-fit: cover` crop is accounted for.
 */

import { BONES, type Point } from "../vision/landmarks";
import type { HandReading } from "../vision/types";
import { edgeMark } from "./offPicture";
import { coverViewport, type Viewport } from "./viewport";
import { DIM, GRID, GRID_STRONG, INK, SKELETON } from "./palette";

export interface Marker {
  /** Where it sits, in camera coordinates. */
  at: Point;
  colour: string;
  /** Filled markers read as "this is done"; hollow ones as "go here". */
  filled: boolean;
  /** Radius in canvas pixels, before the display scale. */
  radius?: number;
  label?: string;
  /**
   * A dot asking for a finger names a point further up its string. Off the
   * picture, it is then drawn where its string leaves the picture, pointing
   * on (`offPicture.ts`); a dot without one is simply not seen.
   */
  along?: Point;
}

export class Overlay {
  private context: CanvasRenderingContext2D;
  /** Recomputed on every resize and whenever the camera reports its size. */
  private viewport: Viewport = coverViewport(0, 0, 1, 1);
  private videoWidth = 0;
  private videoHeight = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser has no 2D canvas.");
    this.context = context;
    this.resize();
  }

  /** The mapping in force, so callers can turn clicks back into camera points. */
  get view(): Viewport {
    return this.viewport;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /** Follows the window, and the camera once it reports its real dimensions. */
  resize(videoWidth = this.videoWidth, videoHeight = this.videoHeight) {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.canvas.clientWidth * ratio);
    this.canvas.height = Math.round(this.canvas.clientHeight * ratio);
    this.videoWidth = videoWidth;
    this.videoHeight = videoHeight;
    this.viewport = coverViewport(videoWidth, videoHeight, this.canvas.width, this.canvas.height);
  }

  clear() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Scale for anything measured in points rather than camera fractions. */
  private get unit(): number {
    return Math.max(1, this.canvas.width / 1280);
  }

  drawHands(hands: HandReading[]) {
    const context = this.context;
    context.save();
    context.strokeStyle = SKELETON;
    context.lineWidth = 2 * this.unit;
    context.lineCap = "round";

    for (const hand of hands) {
      for (const [from, to] of BONES) {
        const a = this.viewport.toCanvas(hand.points[from]);
        const b = this.viewport.toCanvas(hand.points[to]);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      context.fillStyle = SKELETON;
      for (const point of hand.points) {
        const p = this.viewport.toCanvas(point);
        context.beginPath();
        context.arc(p.x, p.y, 2.5 * this.unit, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  /** The quadrilateral of the fretboard, plus its fret and string lines. */
  drawFretboard(outline: Point[], frets: [Point, Point][], strings: [Point, Point][]) {
    const context = this.context;
    context.save();
    context.lineWidth = 1.2 * this.unit;
    context.strokeStyle = GRID;

    for (const [a, b] of [...frets, ...strings]) {
      const from = this.viewport.toCanvas(a);
      const to = this.viewport.toCanvas(b);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }

    if (outline.length >= 3) {
      context.strokeStyle = GRID_STRONG;
      context.lineWidth = 2 * this.unit;
      context.beginPath();
      outline.forEach((point, i) => {
        const p = this.viewport.toCanvas(point);
        if (i === 0) context.moveTo(p.x, p.y);
        else context.lineTo(p.x, p.y);
      });
      context.closePath();
      context.stroke();
    }
    context.restore();
  }

  /**
   * Draws them; one that asks for a finger (`along`) and falls off the
   * picture is drawn at the edge with a pointer (`offPicture.ts`). Returns how
   * many were, so the app can say so in words.
   */
  drawMarkers(markers: Marker[]): number {
    const context = this.context;
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    let off = 0;

    for (const marker of markers) {
      let p = this.viewport.toCanvas(marker.at);
      const radius = (marker.radius ?? 15) * this.unit;
      const pointer = 10 * this.unit;
      const edge = marker.along ? edgeMark(p, this.canvas.width, this.canvas.height, radius + pointer + 4 * this.unit, this.viewport.toCanvas(marker.along)) : null;
      if (edge) {
        off++;
        p = edge.at;
        // A solid wedge just outside the circle, aimed at the real spot.
        const tip = radius + pointer;
        context.fillStyle = marker.colour;
        context.beginPath();
        context.moveTo(p.x + Math.cos(edge.angle) * tip, p.y + Math.sin(edge.angle) * tip);
        context.lineTo(p.x + Math.cos(edge.angle + 0.5) * (radius + 2 * this.unit), p.y + Math.sin(edge.angle + 0.5) * (radius + 2 * this.unit));
        context.lineTo(p.x + Math.cos(edge.angle - 0.5) * (radius + 2 * this.unit), p.y + Math.sin(edge.angle - 0.5) * (radius + 2 * this.unit));
        context.closePath();
        context.fill();
      }

      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      if (marker.filled) {
        context.fillStyle = marker.colour;
        context.fill();
      } else {
        context.strokeStyle = marker.colour;
        context.lineWidth = 3 * this.unit;
        context.setLineDash([5 * this.unit, 4 * this.unit]);
        context.stroke();
        context.setLineDash([]);
      }

      if (marker.label) {
        context.fillStyle = marker.filled ? "#0b0a0f" : marker.colour;
        context.font = `${Math.round(radius * 1.05)}px ui-sans-serif, system-ui, sans-serif`;
        context.fillText(marker.label, p.x, p.y + 0.5 * this.unit);
      }
    }
    context.restore();
    return off;
  }

  /**
   * An arrow from where a finger is to where it should be.
   *
   * This is the single most useful thing on the screen. A red dot says the
   * finger is wrong; an arrow says which way to move it, which is the whole
   * correction in one glance and in no language.
   */
  drawNudge(from: Point, to: Point, colour: string) {
    const context = this.context;
    const a = this.viewport.toCanvas(from);
    const b = this.viewport.toCanvas(to);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    // Too short to point anywhere: the dot already says it.
    if (length < 12 * this.unit) return;

    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    // Stop short of the target so the arrowhead does not sit inside the circle.
    const stop = { x: b.x - Math.cos(angle) * 16 * this.unit, y: b.y - Math.sin(angle) * 16 * this.unit };

    context.save();
    context.strokeStyle = colour;
    context.fillStyle = colour;
    context.lineWidth = 2.5 * this.unit;
    context.lineCap = "round";

    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(stop.x, stop.y);
    context.stroke();

    const head = 9 * this.unit;
    context.beginPath();
    context.moveTo(stop.x, stop.y);
    context.lineTo(stop.x - Math.cos(angle - 0.4) * head, stop.y - Math.sin(angle - 0.4) * head);
    context.lineTo(stop.x - Math.cos(angle + 0.4) * head, stop.y - Math.sin(angle + 0.4) * head);
    context.closePath();
    context.fill();
    context.restore();
  }

  /**
   * Small labels pinned to points in the picture — the fret numbers along the
   * edge of the neck.
   *
   * Drawn with a dark backing rather than a plain fill: the numbers sit over
   * whatever the room happens to be, and a bare white glyph on a pale wall is
   * invisible exactly when a student is looking for it.
   */
  drawLabels(labels: { at: Point; text: string }[], colour = DIM) {
    if (labels.length === 0) return;
    const context = this.context;
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${Math.round(13 * this.unit)}px ui-sans-serif, system-ui, sans-serif`;

    for (const label of labels) {
      const p = this.viewport.toCanvas(label.at);
      const radius = 10 * this.unit;
      context.fillStyle = "rgba(10, 9, 14, 0.55)";
      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = colour;
      context.fillText(label.text, p.x, p.y);
    }
    context.restore();
  }

  /** A short line of guidance, centred low in the frame. */
  drawHint(text: string, fromTop = 0.86) {
    if (!text) return;
    const context = this.context;
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${Math.round(20 * this.unit)}px ui-sans-serif, system-ui, sans-serif`;
    const x = this.canvas.width / 2;
    const y = this.canvas.height * fromTop;

    const width = context.measureText(text).width + 34 * this.unit;
    const height = 40 * this.unit;
    context.fillStyle = "rgba(10, 9, 14, 0.62)";
    context.beginPath();
    context.roundRect(x - width / 2, y - height / 2, width, height, height / 2);
    context.fill();

    context.fillStyle = INK;
    context.fillText(text, x, y);
    context.restore();
  }

  /** The dots dropped while marking the neck by hand. */
  drawCalibrationPoints(points: Point[]) {
    const context = this.context;
    context.save();
    context.strokeStyle = INK;
    context.fillStyle = "rgba(10, 9, 14, 0.7)";
    context.lineWidth = 2 * this.unit;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${Math.round(13 * this.unit)}px ui-sans-serif, system-ui, sans-serif`;

    points.forEach((point, i) => {
      const p = this.viewport.toCanvas(point);
      context.beginPath();
      context.arc(p.x, p.y, 12 * this.unit, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = INK;
      context.fillText(String(i + 1), p.x, p.y);
      context.fillStyle = "rgba(10, 9, 14, 0.7)";
    });

    if (points.length > 1) {
      context.strokeStyle = DIM;
      context.lineWidth = 1.5 * this.unit;
      context.beginPath();
      points.forEach((point, i) => {
        const p = this.viewport.toCanvas(point);
        if (i === 0) context.moveTo(p.x, p.y);
        else context.lineTo(p.x, p.y);
      });
      if (points.length === 4) context.closePath();
      context.stroke();
    }
    context.restore();
  }
}
