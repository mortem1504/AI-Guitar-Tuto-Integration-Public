/**
 * Marking the neck: four clicks.
 *
 * The order asked for is nut thick-E, nut thin-E, far thin-E, far thick-E, but
 * it is a suggestion rather than a contract — `orderCorners` works the real
 * order out from the shape of what was clicked, because trusting the order was
 * a bug that cost a whole session of confusing feedback. See `corners.ts`.
 *
 * The near pair is the nut unless the nut is off the picture — a laptop
 * camera often cuts the headstock off, and a nut that cannot be clicked got
 * four clicks round one fret box instead (BITACORA 2026-11-05). So the near
 * pair can be put on a fret wire, said before or after clicking, and checked
 * the same way as the far one, against the grid drawn over the real neck.
 *
 * What cannot be worked out from the shape is which fret the far pair sits on.
 * A fretboard has corners at its far *end*, not at the 12th fret, and asking
 * for "the corners of the fretboard" got exactly that — a neck stretched to
 * nearly twice its length, with every chord's fingers spread across it. So the
 * marked fret is adjustable, live, against the grid drawn over the real neck.
 *
 * The card explains; the clicking happens on the canvas itself, which App
 * routes here. This class owns the four points and nothing else.
 */

import { renderEmphasis, type Translate, type TranslationKey } from "../i18n";
import { markingProblem, orderCorners } from "../guitar/corners";
import type { CornerKind, Corners } from "../guitar/Fretboard";
import { fretLine } from "../guitar/geometry";
import type { Point } from "../vision/landmarks";
import { clear, element, requireElement } from "./dom";

export type CalibratorPhase = "idle" | "marking" | "searching";

/** The fret the far pair may be claimed to sit on. */
const MIN_FAR_FRET = 5;
const MAX_FAR_FRET = 19;

/**
 * The near pair: the nut (0) or a fret up to the 5th. A camera that misses
 * more than five frets misses the chords a beginner plays; and the two pairs
 * stay at least `MIN_GAP` frets apart, so the span pins the perspective down.
 */
const MAX_NEAR_FRET = 5;
const MIN_GAP = 7;

/**
 * Where the card may sit.
 *
 * No corner is safe: a guitar can be pointing either way and lie anywhere in
 * the frame, so wherever this card is parked it will sometimes be sitting on
 * the very corner that has to be clicked. Rather than guess, the student moves
 * it — one button, four corners, no dragging to get wrong on a phone.
 */
const CORNERS = ["bl", "br", "tr", "tl"] as const;

export class Calibrator {
  private root = requireElement("calibrate");
  private card = requireElement("calibrate-card");
  private points: Point[] = [];
  private phase: CalibratorPhase = "idle";
  private notice = "";
  private corner = 0;
  private t: Translate | null = null;

  /** Which fret the far pair sits on: 12 by hand, whatever the detector saw. */
  private farFret = 12;
  /** Which fret the near pair sits on: 0, the nut, unless the student says otherwise. */
  private nearFret = 0;
  /** By hand a student marks the wood; the detector can only see the strings. */
  private cornersAt: CornerKind = "edges";
  private doneHandler: ((corners: Corners, farFret: number, cornersAt: CornerKind, nearFret: number) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private autoHandler: (() => void) | null = null;
  /** "Find it for me" only with the experimental `autoDetect` on: the detector finds nothing on real webcams yet. */
  private autoOffered = false;

  whenDone(handler: (corners: Corners, farFret: number, cornersAt: CornerKind, nearFret: number) => void) {
    this.doneHandler = handler;
  }

  whenClosed(handler: () => void) {
    this.closeHandler = handler;
  }

  whenAutoAsked(handler: () => void) {
    this.autoHandler = handler;
  }

  offerAuto(on: boolean) {
    this.autoOffered = on;
  }

  get open(): boolean {
    return this.phase !== "idle";
  }

  /** The points marked so far, for the overlay to draw. */
  get marked(): Point[] {
    return this.points;
  }

  start(t: Translate, keepPoints = false) {
    this.t = t;
    if (!keepPoints) {
      this.points = [];
      this.farFret = 12;
      this.nearFret = 0;
      this.cornersAt = "edges";
    }
    this.phase = "marking";
    this.notice = "";
    this.root.classList.remove("gone");
    this.applyCorner();
    this.render(t);
  }

  close() {
    this.phase = "idle";
    this.root.classList.add("gone");
    this.closeHandler?.();
  }

  /** Parks the card in the next corner, for when it covers what is being marked. */
  private moveCard(t: Translate) {
    this.corner = (this.corner + 1) % CORNERS.length;
    this.applyCorner();
    this.render(t);
  }

  private applyCorner() {
    for (const name of CORNERS) this.root.classList.toggle(`at-${name}`, name === CORNERS[this.corner]);
  }

  /** Called by App for every click on the canvas while marking; `aspect` is the video's width / height. */
  addPoint(point: Point, t: Translate, aspect: number) {
    if (this.phase !== "marking" || this.points.length >= 4) return;
    this.points.push(point);
    this.notice = "";
    if (this.points.length === 4) {
      // Whatever order they arrived in, the shape says which pair is the nut.
      const ordered = orderCorners(this.points.slice(0, 4) as Corners);
      // Four points too close together for nut-to-12th are thrown away, not
      // saved: a squeezed grid looks like the tracker drifting, and nothing
      // else would tell the student the marking was the problem.
      if (markingProblem(ordered, aspect, fretLine(this.farFret) - fretLine(this.nearFret))) {
        this.points = [];
        this.notice = t("calibrate.tooClose");
        this.render(t);
        return;
      }
      this.points = ordered;
      // Clicked by hand means the edge of the wood, which is what was asked for.
      this.cornersAt = "edges";
      this.emit();
    }
    this.render(t);
  }

  /** Feedback from the automatic detector, which runs outside this class. */
  setSearching(t: Translate) {
    this.phase = "searching";
    this.notice = t("calibrate.auto.searching");
    this.render(t);
  }

  setFound(corners: Corners, farFret: number, cornersAt: CornerKind, t: Translate) {
    this.points = [...corners];
    this.farFret = farFret;
    this.nearFret = 0;
    this.cornersAt = cornersAt;
    this.phase = "marking";
    this.notice = t("calibrate.auto.found");
    this.emit();
    this.render(t);
  }

  /**
   * Swaps which side of the neck is the thick E.
   *
   * Nothing in the geometry says which side is which — a neck is the same
   * shape either way round — so when the detector guesses, this is how a
   * student says "the other way". Both ends swap together, or the quad folds
   * over on itself into a bow tie.
   */
  private flip(t: Translate) {
    if (this.points.length < 4) return;
    const [a, b, c, d] = this.points;
    this.points = [b, a, d, c];
    this.emit();
    this.render(t);
  }

  /**
   * Corrects which fret the far pair was actually put on.
   *
   * The grid redraws on the next frame, over the real neck, so this is checked
   * by looking rather than by trusting: when the drawn wires sit on the real
   * wires, the number is right.
   */
  private nudgeFret(delta: number, t: Translate) {
    const next = Math.min(MAX_FAR_FRET, Math.max(MIN_FAR_FRET, this.nearFret + MIN_GAP, this.farFret + delta));
    if (next === this.farFret) return;
    this.farFret = next;
    this.emit();
    this.render(t);
  }

  /** Which fret the near pair is on: before clicking, so the steps name it; after, checked against the grid like the far one. */
  private nudgeNear(delta: number, t: Translate) {
    const next = Math.min(MAX_NEAR_FRET, this.farFret - MIN_GAP, Math.max(0, this.nearFret + delta));
    if (next === this.nearFret) return;
    this.nearFret = next;
    this.emit();
    this.render(t);
  }

  private emit() {
    if (this.points.length < 4) return;
    this.doneHandler?.(this.points.slice(0, 4) as Corners, this.farFret, this.cornersAt, this.nearFret);
  }

  setNotFound(t: Translate) {
    this.phase = "marking";
    this.notice = t("calibrate.auto.failed");
    this.render(t);
  }

  private undo(t: Translate) {
    this.points.pop();
    this.notice = "";
    this.render(t);
  }

  private reset(t: Translate) {
    this.points = [];
    this.notice = "";
    this.render(t);
  }

  /** Which fret the far pair sits on, with a way to correct it. */
  private fretStepper(t: Translate): HTMLElement {
    return stepper(
      t("calibrate.fret", { fret: this.farFret }),
      this.farFret <= Math.max(MIN_FAR_FRET, this.nearFret + MIN_GAP),
      this.farFret >= MAX_FAR_FRET,
      (delta) => this.nudgeFret(delta, t),
    );
  }

  /** Which fret the near pair sits on: the nut, or a fret when the nut is off the picture. */
  private nearStepper(t: Translate): HTMLElement {
    return stepper(
      t("calibrate.near", { place: this.nearPlace(t) }),
      this.nearFret <= 0,
      this.nearFret >= Math.min(MAX_NEAR_FRET, this.farFret - MIN_GAP),
      (delta) => this.nudgeNear(delta, t),
    );
  }

  /** "the nut" or "fret 3", for the steps and the stepper. */
  private nearPlace(t: Translate): string {
    return this.nearFret === 0 ? t("calibrate.place.nut") : t("calibrate.place.fret", { fret: this.nearFret });
  }

  render(t: Translate = this.t ?? (() => "")) {
    this.t = t;
    clear(this.card);

    this.card.append(
      element("h2", { text: t("calibrate.title") }),
      element("p", { text: t("calibrate.intro") }),
    );

    // The step being asked for right now, in bold where it matters.
    if (this.points.length < 4) {
      const step = element("p", { className: "step" });
      step.append(renderEmphasis(t(`calibrate.step.${this.points.length + 1}` as TranslationKey, { near: this.nearPlace(t) })));
      this.card.append(step, element("p", { className: "quiet", text: t("calibrate.hint") }));
      // Said before the first click, so the steps already name the right wire.
      if (this.points.length === 0) this.card.append(element("p", { className: "quiet", text: t("calibrate.near.hint") }), this.nearStepper(t));
    } else {
      this.card.append(
        element("p", { className: "step", text: t("calibrate.saved") }),
        this.nearStepper(t),
        this.fretStepper(t),
        element("p", { className: "quiet", text: t("calibrate.fret.hint") }),
      );
    }

    if (this.notice) this.card.append(element("p", { className: "quiet", text: this.notice }));

    const row = element("div", { className: "row" });

    const auto = element("button", { className: "ghost", text: t("calibrate.auto"), attrs: { type: "button" } });
    auto.disabled = this.phase === "searching";
    auto.addEventListener("click", () => this.autoHandler?.());

    const flip = element("button", { className: "ghost", text: t("calibrate.flip"), attrs: { type: "button" } });
    flip.disabled = this.points.length < 4;
    flip.addEventListener("click", () => this.flip(t));

    const undo = element("button", { className: "ghost", text: t("calibrate.undo"), attrs: { type: "button" } });
    undo.disabled = this.points.length === 0;
    undo.addEventListener("click", () => this.undo(t));

    const reset = element("button", { className: "ghost", text: t("calibrate.reset"), attrs: { type: "button" } });
    reset.disabled = this.points.length === 0;
    reset.addEventListener("click", () => this.reset(t));

    const move = element("button", { className: "ghost", text: t("calibrate.move"), attrs: { type: "button" } });
    move.addEventListener("click", () => this.moveCard(t));

    const done = element("button", { className: "primary", text: t("calibrate.done"), attrs: { type: "button" } });
    done.disabled = this.points.length < 4;
    done.addEventListener("click", () => this.close());

    if (this.autoOffered) row.append(auto);
    row.append(flip, undo, reset, move, done);
    this.card.append(row);
  }
}

/** A label with − and + after it. */
function stepper(label: string, atLeast: boolean, atMost: boolean, nudge: (delta: number) => void): HTMLElement {
  const down = element("button", { className: "ghost", text: "−", attrs: { type: "button" } });
  down.disabled = atLeast;
  down.addEventListener("click", () => nudge(-1));
  const up = element("button", { className: "ghost", text: "+", attrs: { type: "button" } });
  up.disabled = atMost;
  up.addEventListener("click", () => nudge(1));
  return element("div", { className: "row stepper" }, [element("span", { text: label }), down, up]);
}
