/**
 * Keeping the neck where it really is, after the guitar moves: the tracking
 * itself, over greyscale frames (`NeckTracker` feeds it from the camera).
 *
 * The calibration is a photograph of a moment: four corners, marked once. A
 * guitar on a lap does not stay in that moment — it drifts as you shift, tilts
 * as you reach for a barre, and by the fourth chord the grid is a few
 * centimetres from the wood. Re-marking it every time is not a class.
 *
 * This is image registration pointed at one object: the transform between the
 * view the student marked and the view the camera has now. We already know
 * where every point of the guitar *was*, which is a much smaller question than
 * the detector's.
 *
 *   1. When the neck is marked, points are laid out in *board* coordinates
 *      (exact, never re-estimated) over the fretboard and the body around the
 *      soundhole. The marked frame is kept.
 *   2. Every pass, each point's square of the marked frame (or of the learned
 *      view nearest the pose expected, below) is warped to how it
 *      should look now (`warpedPatch`) and looked for around where the current
 *      transform predicts it: first at half size over a wide search, then at
 *      full size over a narrow one.
 *   3. The transform most of them agree on is found by consensus, fitted over
 *      exactly those, and checked against what a guitar can do in 66 ms.
 *
 * Measured on a student's recording (BITACORA 2026-11-05), the first version
 * lost an acoustic within seconds and then kept drawing the grid where it
 * had last been — over the body, above the neck. What changed and why:
 *
 *   - **The body too.** Frets and strings repeat, so a fretboard square matches
 *     the next fret along nearly as well and the fit can slide a fret. The
 *     rosette, the soundhole and the body's grain do not repeat, and they are
 *     on the same rigid object.
 *   - **Warped templates**, so a neck turned 20° still matches.
 *   - **Coarse, then fine**, with the motion predicted from the last two fits,
 *     so a quick move is followed instead of lost.
 *   - **Lost is said, not hidden.** With no trusted fit for `LOST_MS`, `lost()`
 *     is true and the app takes the grid down instead of drawing it in the
 *     wrong place. A wrong grid is worse than none: it teaches the wrong fret.
 *
 * Two things from the first version stand: templates never come from the
 * previous frame (that drifts), and outliers are found by consensus before
 * fitting (`npm run track-check`). Anchors under a hand are never used: a
 * patch of skin moves with the hand, not the neck.
 *
 * **Learned views.** One marked frame does not look like the guitar after the
 * student leans in over it: on their recording, at 52.7 s, 25 points still
 * agreed on the right transform, but they matched the marked frame so weakly
 * that the support check turned the fit down, and from there the neck stayed
 * lost. So while tracking is going well, a frame whose pose is new enough is
 * kept as another view, with only the points that agreed on that pass (they
 * are on the guitar, not an arm over it), and every pass matches against the
 * view nearest the pose it expects. A view is only ever learned from a pass
 * that was clearly good, and a chain of views learned from views stops at
 * `MAX_DEPTH`, so an error cannot grow into a drift.
 */

import { applyHomography, homographyFrom, invert, type Matrix3 } from "../vision/homography";
import type { Point } from "../vision/landmarks";
import { commonShift, halve, peakIn, scoreMap, warpedPatch, type Grey, type ScoreMap } from "../vision/patches";
import type { BoardPoint, GuitarSpec } from "./geometry";
import { fitRobust, layout, measure, MIN_TRACKED, multiply, poseDistance, REFERENCE_POINTS, turned, type View } from "./neckPose";
import { WireFinder } from "./neckRefind";
import type { Box } from "./neckWires";

/** Of the points found, at least this share must agree on one transform; fewer is two objects moving, not one. */
const MIN_AGREEING = 0.45;

/**
 * The two levels. Coarse: half size, 11-pixel squares; one shift for all of
 * them found over a 10-pixel search (20 working pixels, 6% of the frame, per
 * pass; 22 while lost), then each point within 3 of it. Fine: full size,
 * 15-pixel squares, 3 either way, which is all the coarse answer leaves.
 * Outliers in each level's own pixels; 2.5 working pixels is about 5 mm on a
 * neck that spans half the frame, a sixth of a fret at the 12th.
 */
const COARSE = { patch: 11, search: 10, window: 3, outlier: 1.5 };
/**
 * While lost: quarter size, 7-pixel squares, a 40-pixel search — 160 working
 * pixels, half the frame either way — so a guitar that comes back anywhere is
 * found again, then handed to the coarse level with a short search.
 */
const WIDE = { patch: 7, search: 40, window: 2, outlier: 1, thenCoarse: 5 };

/**
 * A shift alone does not find a guitar that came back turned: 6° moves the
 * ends of the neck 7 quarter-size pixels against each other and nothing lines
 * up. So while lost each pass tries one of these turns (radians) and sizes
 * about the neck's middle, most likely first: all of them in under a second.
 * Steps of 0.1 leave at most 0.05 (4 quarter-size pixels at the ends), which
 * the wide level's own fit takes up.
 */
const RECOVERY = [
  [0, 1], [0.1, 1], [-0.1, 1], [0, 0.85], [0, 1.18], [0.2, 1], [-0.2, 1], [0, 1.4], [0, 0.72],
  [0.1, 0.85], [-0.1, 0.85], [0.1, 1.18], [-0.1, 1.18], [0.1, 1.4], [-0.1, 1.4], [0.2, 1.18], [-0.2, 1.18],
  [0.2, 0.85], [-0.2, 0.85], [0.3, 1], [-0.3, 1], [0.4, 1], [-0.4, 1],
] as const;
const FINE = { patch: 15, search: 3, window: 3, outlier: 2.5 };

/** The common shift needs a mean correlation of this over every point, hidden ones counting 0: weaker is not the guitar. */
const SHIFT_MIN = 0.3;

/**
 * The points a fit agrees on must reach this far along the guitar (in scale
 * lengths; nut to 12th is 0.5). A tight cluster — the body alone — fits many
 * transforms that pivot about it, and the nut, extrapolated from there, can
 * land anywhere: on synthetic video that let a fit 18 px off through.
 */
const MIN_SPAN = 0.3;

/**
 * No trusted fit for this long and the neck is lost: the grid comes down.
 * Two missed passes: one blurred frame does not blink the grid, but a grid
 * that has stopped following is never shown for more than a sixth of a second.
 */
const LOST_MS = 150;

/** After a loss there is no last pass to compare with, so a fit must be within this factor of the marked neck's length. */
const MAX_RECOVERED_SCALE = 2;

/**
 * Frets crowd by 2^(-n/12), so stretching the neck about the bridge by
 * 2^(k/12) lays every wire on another one, k frets along, and points near the
 * bridge barely move: a fit k frets out satisfies almost every anchor. A
 * found-again fit is therefore scored against these stretches of itself, and
 * kept only if it beats every one of them by `ALIAS_MARGIN` mean correlation.
 * (On synthetic video a recovery settled three frets out — the nut on the
 * third fret, 20 px — with 37 of 40 anchors agreeing. Four either way covers
 * the recovery sizes tried, 0.85-1.18, which is 2^(±3/12).)
 */
const ALIASES = [-4, -3, -2, -1, 1, 2, 3, 4];
const ALIAS_MARGIN = 0.03;

/**
 * How well a fit explains the picture — the mean correlation of every visible
 * anchor where it puts them (`support`) — against the running level while
 * tracking well. Not every wrong fit is a fret alias: with the nut off the
 * picture, a change of tilt along the neck slides the visible frets onto
 * their neighbours too while the body stays put, and on synthetic video that
 * held 15 px off with every anchor agreeing. Its support was 0.53 against the
 * truth's 0.75. A pass under `KEEP_SUPPORT` of the running level is a miss; a
 * found-again fit needs `FIND_SUPPORT`, stricter because nothing nearby
 * vouches for it.
 */
const KEEP_SUPPORT = 0.75;
const FIND_SUPPORT = 0.85;
/** How fast the running level follows: a tenth per pass, so a second of slow change in the light, not one bad frame. */
const SUPPORT_EASE = 0.1;

/** What a guitar on a lap can do in one pass: grow or shrink by a third, turn by 25°. More is a wrong fit. */
const MAX_STEP_SCALE = 1.35;
const MAX_STEP_TURN = 0.45;

/** Nut-to-12th at least twice the fretboard's width (6.5 square on): flatter is a fit that has folded, not a neck. */
const MIN_SHAPE = 2;

/**
 * Learning views. A pose this different from every view kept (`poseDistance`:
 * 0.08 is a turn of about 9° or growing by a sixth) is worth keeping, from a
 * pass whose support is at least `LEARN_SUPPORT` of its view's running level
 * and on which `LEARN_AGREEING` of the points found agreed — a clearly good
 * pass, not one that scraped through. Eight views (the marked one and seven
 * learned) cover a lap's worth of postures; the learned view matched longest
 * ago makes room for a new one.
 */
const NEW_VIEW = 0.08;
const LEARN_SUPPORT = 0.9;
const LEARN_AGREEING = 0.8;
const MAX_VIEWS = 8;
/**
 * Views learned from views learned from views...: each copies its parent's
 * fit, error and all. Each pass's error is a fraction of a pixel (track-check
 * means of 0.2-0.5 px), so four steps keep it under 2; past that a view is
 * not learned and the nearest one is matched as it is.
 */
const MAX_DEPTH = 4;
/** Between two views about as near, the one fewer steps from the marked frame: it carries less copied error. */
const DEPTH_COST = 0.02;

/** Points this close to a hand's landmark box (working pixels) are left out: half a square, plus landmark error. */
const HAND_MARGIN = Math.ceil(FINE.patch / 2) + 2;

export type { Box } from "./neckWires";

interface Fit {
  h: Matrix3;
  at: number;
}

/** One level's answer: the transform, and the points that agreed on it. */
interface Found {
  h: Matrix3;
  inliers: BoardPoint[];
}

/** The tracking itself, over greyscale frames: no canvas, so `track-check` can run it on synthetic video. */
export class NeckFollower {
  /** The marked view first, then any learned ones. */
  private views: View[] = [];
  private last: Fit | null = null;
  private before: Fit | null = null;
  private lastGood = -Infinity;
  /** Which of `RECOVERY` the next lost pass tries. */
  private attempt = 0;
  private spec: GuitarSpec | null = null;
  private farFret = 12;
  /** Finds the neck by its wires when the kept pictures do not know it. */
  private wires = new WireFinder();
  /** Points found on the last pass, and how many agreed: for the status line. */
  held = 0;
  agreed = 0;
  /** Which check the last pass failed, "" if none, with what the last level looked at and how well its points agreed on one shift: for `?debug` and for measuring. */
  miss = "";
  looked = 0;
  shift = 0;

  get ready(): boolean {
    return this.views.length > 0 && this.views[0].anchors.length >= MIN_TRACKED;
  }

  /** Passes the wires decided, since the neck was marked: for `?debug` and for measuring. */
  get byWires(): number {
    return this.wires.found;
  }

  /** Views learned since the neck was marked: for `?debug` and for measuring. */
  get learned(): number {
    return Math.max(0, this.views.length - 1);
  }

  forget() {
    this.views = [];
    this.wires.forget();
    this.last = this.before = null;
    this.lastGood = -Infinity;
    this.held = this.agreed = 0;
  }

  /** True when no fit has been trusted for `LOST_MS`: draw nothing on the neck. */
  lost(nowMs: number): boolean {
    return this.ready && nowMs - this.lastGood > LOST_MS;
  }

  /** The reference: this frame, where `boardToFrame` says the neck is. Hands' boxes are in frame pixels. */
  anchor(frame: Grey, boardToFrame: Matrix3, spec: GuitarSpec, farFret: number, hands: readonly Box[], nowMs: number) {
    this.forget();
    const half = halve(frame);
    const identity: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const anchors = layout(spec, farFret).filter((point) => {
      const at = applyHomography(boardToFrame, point);
      // Under a hand, featureless or off the picture: skipped rather than tracked badly.
      return !under(hands, at, HAND_MARGIN) && warpedPatch(frame, identity, at, FINE.patch) !== null;
    });
    this.views = [{ pyramid: [frame, half, halve(half)], toView: boardToFrame, anchors, depth: 0, healthy: 0, used: nowMs }];
    this.spec = spec;
    this.farFret = farFret;
    this.wires.mark(frame, boardToFrame, spec, hands);
    this.last = { h: boardToFrame, at: nowMs };
    this.lastGood = nowMs;
  }

  /**
   * Board -> frame pixels now, or null for "keep what you have" (see `lost`).
   * The kept pictures first; when they do not recognise the guitar, its
   * wires (`WireFinder`), from what the pictures nearly found, from where
   * the neck was heading, or from where it last was.
   */
  track(frame: Grey, nowMs: number, hands: readonly Box[]): Matrix3 | null {
    if (!this.ready || !this.last) return null;
    const lost = this.lost(nowMs);
    const half = halve(frame);
    const guess: Matrix3 | null = lost ? turned(this.last.h, RECOVERY[this.attempt++ % RECOVERY.length]) : this.predict(nowMs);
    const pictures = guess ? this.byPictures(frame, half, guess, lost, hands, nowMs) : { h: null, near: null };
    if (pictures.h) return this.trusted(pictures.h, lost, nowMs);
    const previous = lost ? this.views[0].toView : this.last.h;
    // While held, the neck is near where it was heading; once lost, anywhere
    // along the band near where it was last seen.
    const seeds = lost ? [pictures.near] : [pictures.near, guess, this.last.h];
    const fits = (h: Matrix3) => this.plausible(h, previous, lost ? MAX_RECOVERED_SCALE : MAX_STEP_SCALE, lost ? Math.PI : MAX_STEP_TURN);
    const h = this.wires.find(frame, seeds, this.last.h, lost, hands, nowMs, fits);
    if (!h) {
      this.miss = `${this.miss}; ${this.wires.miss}`;
      return null;
    }
    // The kept pictures did not know it: keep this one, so they will next time.
    this.keep(frame, half, h, hands, nowMs);
    this.miss = "";
    return this.trusted(h, lost, nowMs);
  }

  private trusted(h: Matrix3, lost: boolean, nowMs: number): Matrix3 {
    this.attempt = 0;
    this.before = lost ? null : this.last;
    this.last = { h, at: nowMs };
    this.lastGood = nowMs;
    return h;
  }

  /**
   * The kept pictures' answer, with every check passed (`h`), or else the
   * nearest they came (`near`: a fit they made but turned down), to start the
   * wires from.
   */
  private byPictures(frame: Grey, half: Grey, start: Matrix3, lost: boolean, hands: readonly Box[], nowMs: number): { h: Matrix3 | null; near: Matrix3 | null } {
    const none = { h: null, near: null };
    this.miss = "wide";
    const view = this.nearest(start);
    const guess = lost ? (this.refine(view, halve(half), 2, start, WIDE.patch, WIDE.search, WIDE.window, WIDE.outlier, hands)?.h ?? null) : start;
    if (!guess) return none;
    this.miss = "coarse";
    const coarse = this.refine(view, half, 1, guess, COARSE.patch, lost ? WIDE.thenCoarse : COARSE.search, COARSE.window, COARSE.outlier, hands);
    if (!coarse) return none;
    this.miss = "fine";
    const fine = this.refine(view, frame, 0, coarse.h, FINE.patch, FINE.search, FINE.window, FINE.outlier, hands);
    if (!fine) return { h: null, near: coarse.h };
    const found = this.held;
    // A learned view's positions copy whatever error the pass that learned it
    // had (on synthetic video, up to 4 px three views on). So where the marked
    // frame can still see the guitar, it has the last word; the learned view
    // found the guitar, and decides only when the marked frame cannot.
    const h = view === this.views[0] ? fine.h : (this.refine(this.views[0], frame, 0, fine.h, FINE.patch, FINE.search, FINE.window, FINE.outlier, hands)?.h ?? fine.h);
    const near = { h: null, near: h };
    this.miss = "shape";
    if (!this.plausible(h, lost ? this.views[0].toView : this.last!.h, lost ? MAX_RECOVERED_SCALE : MAX_STEP_SCALE, lost ? Math.PI : MAX_STEP_TURN)) return near;
    this.miss = "alias";
    if (lost && !this.unlikeItsAliases(view, frame, h, hands)) return near;
    const support = this.support(view, frame, h, hands);
    this.miss = `support ${support.toFixed(2)}/${view.healthy.toFixed(2)}`;
    if (view.healthy > 0 && support < view.healthy * (lost ? FIND_SUPPORT : KEEP_SUPPORT)) return near;
    this.miss = "";
    // Learned before the level moves, so "clearly good" means against the level it had.
    if (!lost && support >= view.healthy * LEARN_SUPPORT) this.learn(frame, half, { h, inliers: fine.inliers }, found, view, nowMs);
    view.healthy = view.healthy > 0 ? view.healthy + (support - view.healthy) * SUPPORT_EASE : support;
    view.used = nowMs;
    return { h, near: null };
  }

  /** Keeps a frame the wires found the neck in as a view, at `h`: the pictures will know it next time. */
  private keep(frame: Grey, half: Grey, h: Matrix3, hands: readonly Box[], nowMs: number) {
    if (!this.spec) return;
    const identity: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const anchors = layout(this.spec, this.farFret).filter((point) => {
      const at = applyHomography(h, point);
      return !under(hands, at, HAND_MARGIN) && warpedPatch(frame, identity, at, FINE.patch) !== null;
    });
    if (anchors.length < 2 * MIN_TRACKED) return;
    const near = this.nearest(h);
    const view: View = { pyramid: [frame, half, halve(half)], toView: h, anchors, depth: 1, healthy: this.views[0].healthy, used: nowMs };
    // A learned view at this pose that no longer matches is replaced, not kept beside it.
    if (near !== this.views[0] && poseDistance(near.toView, h) < NEW_VIEW) this.views[this.views.indexOf(near)] = view;
    else this.add(view);
  }

  /** The view whose pose is nearest `h`, the marked one when about as near. */
  private nearest(h: Matrix3): View {
    let best = this.views[0];
    let bestCost = Infinity;
    for (const view of this.views) {
      const cost = poseDistance(view.toView, h) + view.depth * DEPTH_COST;
      if (cost < bestCost) {
        best = view;
        bestCost = cost;
      }
    }
    return best;
  }

  /** Keeps this frame as another view if the pose is new enough and the pass clearly good (see `NEW_VIEW`). */
  private learn(frame: Grey, half: Grey, fine: Found, found: number, from: View, nowMs: number) {
    if (from.depth >= MAX_DEPTH || fine.inliers.length < LEARN_AGREEING * found || fine.inliers.length < 2 * MIN_TRACKED) return;
    if (this.views.some((view) => poseDistance(view.toView, fine.h) < NEW_VIEW)) return;
    // Its level starts at its parent's: matching a fresher picture scores at
    // least that, and the running level climbs to what it really scores.
    this.add({ pyramid: [frame, half, halve(half)], toView: fine.h, anchors: fine.inliers, depth: from.depth + 1, healthy: from.healthy, used: nowMs });
  }

  /** Another learned view; when full, it replaces the learned view matched longest ago. */
  private add(view: View) {
    if (this.views.length < MAX_VIEWS) {
      this.views.push(view);
      return;
    }
    let oldest = 1;
    for (let i = 2; i < this.views.length; i++) if (this.views[i].used < this.views[oldest].used) oldest = i;
    this.views[oldest] = view;
  }

  /** Where the last two fits say the neck is now, assuming it keeps moving the same way (for at most one more pass). */
  private predict(nowMs: number): Matrix3 {
    const last = this.last!;
    const before = this.before;
    if (!before || last.at - before.at <= 0) return last.h;
    const k = Math.min(1, (nowMs - last.at) / (last.at - before.at));
    const now = REFERENCE_POINTS.map((p) => applyHomography(last.h, p));
    const then = REFERENCE_POINTS.map((p) => applyHomography(before.h, p));
    const ahead = now.map((p, i) => ({ x: p.x + (p.x - then[i].x) * k, y: p.y + (p.y - then[i].y) * k }));
    return homographyFrom(REFERENCE_POINTS, ahead) ?? last.h;
  }

  /**
   * One level: look for every anchor around where `guess` puts it — first
   * the one shift they share, when `radius` is wider than `window`, then each
   * within `window` of that — and fit what agrees. Pixels at full working
   * size in and out.
   */
  private refine(view: View, grey: Grey, level: number, guess: Matrix3, size: number, radius: number, window: number, outlier: number, hands: readonly Box[]): Found | null {
    const s = 1 / 2 ** level;
    const scale = (h: Matrix3, k: number): Matrix3 => [h[0] * k, h[1] * k, h[2] * k, h[3] * k, h[4] * k, h[5] * k, h[6], h[7], h[8]];
    const now = scale(guess, s);
    const back = invert(now);
    if (!back) return null;
    // Current pixel -> board -> the view's pixel, at this level.
    const map = multiply(scale(view.toView, s), back);
    const reference = view.pyramid[level];

    const looked: { point: BoardPoint; map: ScoreMap }[] = [];
    for (const point of view.anchors) {
      const at = applyHomography(now, point);
      if (under(hands, { x: at.x / s, y: at.y / s }, HAND_MARGIN)) continue;
      const patch = warpedPatch(reference, map, at, size);
      if (patch) looked.push({ point, map: scoreMap(patch, grey, at, radius) });
    }
    this.looked = looked.length;
    if (looked.length < MIN_TRACKED) return null;
    const shift =
      radius > window
        ? commonShift(
            looked.map((x) => x.map),
            radius,
          )
        : { dx: 0, dy: 0, score: 1 };
    this.shift = shift?.score ?? 0;
    if (!shift || shift.score < SHIFT_MIN) return null;

    const board: BoardPoint[] = [];
    const image: Point[] = [];
    for (const { point, map } of looked) {
      const found = peakIn(map, shift.dx, shift.dy, window);
      if (!found) continue;
      board.push(point);
      image.push(found.at);
    }
    this.held = board.length;
    if (board.length < MIN_TRACKED) return null;
    const fit = fitRobust(board, image, outlier);
    this.agreed = fit?.inliers.length ?? 0;
    if (!fit || fit.inliers.length < Math.max(MIN_TRACKED, MIN_AGREEING * board.length)) return null;
    const along = fit.inliers.map((i) => board[i].x);
    if (Math.max(...along) - Math.min(...along) < MIN_SPAN) return null;
    return { h: scale(fit.h, 1 / s), inliers: fit.inliers.map((i) => board[i]) };
  }

  /** Does `h` explain the picture clearly better than the same neck stretched a fret or two along? */
  private unlikeItsAliases(view: View, frame: Grey, h: Matrix3, hands: readonly Box[]): boolean {
    const own = this.support(view, frame, h, hands);
    return ALIASES.every((k) => {
      const s = Math.pow(2, k / 12);
      const alias = multiply(h, [s, 0, 1 - s, 0, s, 0, 0, 0, 1]);
      return own > this.support(view, frame, alias, hands) + ALIAS_MARGIN;
    });
  }

  /** Mean correlation of the view's anchors `h` puts in the picture and clear of hands (best within ±2 pixels; a miss counts 0). */
  private support(view: View, frame: Grey, h: Matrix3, hands: readonly Box[]): number {
    const back = invert(h);
    if (!back) return 0;
    const map = multiply(view.toView, back);
    let total = 0;
    let seen = 0;
    for (const point of view.anchors) {
      const at = applyHomography(h, point);
      if (under(hands, at, HAND_MARGIN)) continue;
      const patch = warpedPatch(view.pyramid[0], map, at, FINE.patch);
      if (!patch) continue;
      const map2 = scoreMap(patch, frame, at, 2);
      if (!map2.scores.some(Number.isFinite)) continue;
      seen++;
      const found = peakIn(map2, 0, 0, 2, -1);
      if (found) total += Math.max(0, found.score);
    }
    return seen >= MIN_TRACKED ? total / seen : 0;
  }

  /** Is this a neck, and one `previous` could have become: grown by less than `maxScale`, turned by less than `maxTurn`? */
  private plausible(h: Matrix3, previous: Matrix3, maxScale: number, maxTurn: number): boolean {
    const shape = measure(h);
    if (!shape || shape.length < MIN_SHAPE * shape.width) return false;
    const was = measure(previous);
    if (!was) return true;
    const grow = shape.length / was.length;
    let turn = Math.abs(shape.angle - was.angle);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    return grow < maxScale && grow > 1 / maxScale && turn <= maxTurn;
  }
}

function under(boxes: readonly Box[], point: Point, margin: number): boolean {
  return boxes.some((box) => point.x >= box.x0 - margin && point.x <= box.x1 + margin && point.y >= box.y0 - margin && point.y <= box.y1 + margin);
}
