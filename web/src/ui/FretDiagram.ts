/**
 * The fretboard diagram under "Play this": a horizontal neck, nut on the left
 * (on the right for a left-handed player), the thick E at the bottom as a
 * player looking down at their guitar sees it, with frets spaced by the real
 * `1 - 2^(-n/12)` rule so the boxes shrink up the neck as they do on the
 * instrument.
 *
 * On it: the note to play now (a big filled dot with the finger number), the
 * next ones (small, hollow, faded), open strings (a ring at the nut with 0),
 * the hand's four-fret window, the shift before the next note, and the
 * technique (curved arrow for hammer-on/pull-off, straight for a slide, an
 * upward arrow for a bend, a wave for vibrato). After a note is heard, its
 * dot flashes with the result's icon, and a wrong note shows where it was
 * played as a grey dot. Nothing relies on colour alone: every state has a
 * shape, an icon or a word, and the line under the diagram says it all in
 * words.
 *
 * SVG built with createElementNS and textContent, never markup. Colours are
 * the stylesheet's tokens (main.css, `.fret-diagram`).
 */

import type { Translate } from "../i18n";
import { fretLine } from "../guitar/geometry";
import type { FeedbackState } from "../lesson/noteJudge";
import type { FingerTarget, Guidance } from "../song/guidance";
import { element } from "./dom";
import { FEEDBACK_ICON } from "./feedback";

const NS = "http://www.w3.org/2000/svg";

/** Frets shown at once: 0-15, the brief's default, which covers most of what a first song asks for. */
const SHOWN = 15;
const HIGHEST = 24;
const WIDTH = 720;
const HEIGHT = 200;
/** Room left of the nut for the open-string rings and the string letters. */
const LEFT = 46;
const RIGHT = 12;
/** Room above the board for the shift arrow and its words. */
const TOP = 40;
/** 22 px between strings at a 720 px width: dots of 13 px radius stay clear of their neighbours, readable from a metre. */
const GAP = 22;
const EDGE = 12;
const BOTTOM = TOP + EDGE * 2 + GAP * 5;
const STRING_LETTERS = ["", "e", "B", "G", "D", "A", "E"];
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

export interface DiagramFeedback {
  state: FeedbackState;
  target: { string: number; fret: number };
  /** Where the wrong note was played, when it can be said. */
  played: { string: number; fret: number } | null;
}

export interface DiagramOptions {
  t: Translate;
  /** Left-handed: the nut on the right. */
  mirrored: boolean;
  /** Finger numbers inside the dots. */
  numbers: boolean;
}

type Attrs = Record<string, string | number>;
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, children: (SVGElement | string)[] = []): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  for (const child of children) node.append(child);
  return node;
}

/** The frets on screen: 0-15, or a 15-fret stretch ending just past the highest fret needed. */
export function visibleFrets(guidance: Guidance): { first: number; last: number } {
  const frets = guidance.targets.flatMap((x) => [x.fret, x.techniqueTarget?.fret ?? 0]);
  const needed = Math.max(guidance.handWindow.toFret, guidance.shift ? guidance.shift.to + 3 : 0, ...frets);
  const last = Math.min(HIGHEST, Math.max(SHOWN, needed + 1));
  return { first: last - SHOWN, last };
}

export function fretDiagram(guidance: Guidance, feedback: DiagramFeedback | null, options: DiagramOptions): SVGSVGElement {
  const { t } = options;
  const { first, last } = visibleFrets(guidance);
  const span = fretLine(last) - fretLine(first);
  const flip = (x: number) => (options.mirrored ? WIDTH - x : x);
  /** Where the wire of fret n is drawn. */
  const wire = (n: number) => flip(LEFT + ((fretLine(n) - fretLine(first)) / span) * (WIDTH - LEFT - RIGHT));
  /** The middle of the box a finger presses for fret n; open strings sit on a ring beside the nut. */
  const box = (n: number) => (n <= first ? flip(LEFT - 18) : (wire(n - 1) + wire(n)) / 2);
  const y = (string: number) => TOP + EDGE + (string - 1) * GAP;
  const mid = TOP + EDGE + 2.5 * GAP;

  const root = svg("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: "fret-diagram", role: "img", "aria-label": guidance.text });
  const left = Math.min(wire(first), wire(last));
  root.append(svg("rect", { x: left, y: TOP, width: Math.abs(wire(last) - wire(first)), height: BOTTOM - TOP, class: "board", rx: 4 }));

  // The hand's window, under everything else.
  const from = Math.max(first, guidance.handWindow.fromFret - 1);
  const to = Math.min(last, guidance.handWindow.toFret);
  if (to > from) {
    const a = wire(from);
    const b = wire(to);
    root.append(
      svg("rect", { x: Math.min(a, b), y: TOP - 4, width: Math.abs(b - a), height: BOTTOM - TOP + 8, class: "hand-window", rx: 6 }),
      svg("text", { x: Math.min(a, b) + 4, y: TOP - 8, class: "hand-label" }, [t("guide.hand")]),
    );
  }

  for (const fret of INLAYS) if (fret > first && fret <= last) root.append(svg("circle", { cx: box(fret), cy: mid, r: 5, class: "inlay" }));
  if (12 > first && 12 <= last) root.append(svg("circle", { cx: box(12), cy: mid - GAP, r: 5, class: "inlay" }), svg("circle", { cx: box(12), cy: mid + GAP, r: 5, class: "inlay" }));
  for (let fret = first; fret <= last; fret++) {
    root.append(svg("line", { x1: wire(fret), y1: TOP, x2: wire(fret), y2: BOTTOM, class: fret === 0 ? "nut" : "wire" }));
    if (fret > first) root.append(svg("text", { x: box(fret), y: BOTTOM + 15, class: `fret-number${INLAYS.includes(fret) || fret === 12 ? " marked" : ""}` }, [String(fret)]));
  }
  for (let string = 1; string <= 6; string++) {
    // Thicker lines for thicker strings, as they look.
    root.append(svg("line", { x1: wire(first), y1: y(string), x2: wire(last), y2: y(string), class: "string", "stroke-width": 0.8 + (string - 1) * 0.35 }));
    root.append(svg("text", { x: flip(8), y: y(string) + 4, class: "letter" }, [STRING_LETTERS[string]]));
  }

  // The shift before the next note: an arrow along the neck with the words.
  if (guidance.shift) {
    const a = box(guidance.shift.from);
    const b = box(guidance.shift.to);
    root.append(arrow(`M ${a} ${TOP - 18} L ${b} ${TOP - 18}`, b, TOP - 18, b > a ? 0 : Math.PI, "shift"), svg("text", { x: (a + b) / 2, y: TOP - 26, class: "shift-label" }, [t("guide.moveTo", { fret: guidance.shift.to })]));
  }

  // Later, then next, then now on top.
  const order = { later: 0, next: 1, now: 2 } as const;
  for (const target of [...guidance.targets].sort((a, b) => order[a.role] - order[b.role])) {
    if (target.role === "now") root.append(...technique(target, box, y, t));
    root.append(dot(target, box(target.fret), y(target.string), options.numbers, target.fret <= first));
  }

  if (feedback) {
    const at = { x: box(feedback.target.fret), y: y(feedback.target.string) };
    const good = feedback.state === "clean" || feedback.state === "timing";
    root.append(svg("circle", { cx: at.x, cy: at.y, r: 19, class: `flash ${good ? "good" : "bad"}` }), svg("text", { x: at.x, y: at.y - 24, class: `flash-icon ${good ? "good" : "bad"}` }, [FEEDBACK_ICON[feedback.state]]));
    if (feedback.played && feedback.played.fret >= first && feedback.played.fret <= last) {
      const p = { x: box(feedback.played.fret), y: y(feedback.played.string) };
      root.append(svg("circle", { cx: p.x, cy: p.y, r: 9, class: "played" }), svg("text", { x: p.x, y: p.y + 24, class: "played-label" }, [t("guide.played")]));
    }
  }
  return root;
}

function dot(target: FingerTarget, x: number, y: number, numbers: boolean, open: boolean): SVGGElement {
  const group = svg("g", { class: `target ${target.role}${open ? " open" : ""}` });
  // An open string is a ring with 0 whatever its role: the shape says "no finger".
  const radius = target.role === "now" ? 13 : 9;
  group.append(svg("circle", { cx: x, cy: y, r: open ? 9 : radius }));
  const label = open ? "0" : numbers && target.finger > 0 ? String(target.finger) : "";
  if (label) group.append(svg("text", { x, y: y + (target.role === "now" && !open ? 5 : 4) }, [label]));
  return group;
}

/** A path with an arrowhead at (x, y), pointing along `angle` (radians). */
function arrow(path: string, x: number, y: number, angle: number, className: string): SVGGElement {
  const head = 7;
  const tip = `M ${x} ${y} L ${x - Math.cos(angle - 0.45) * head} ${y - Math.sin(angle - 0.45) * head} L ${x - Math.cos(angle + 0.45) * head} ${y - Math.sin(angle + 0.45) * head} Z`;
  return svg("g", { class: `arrow ${className}` }, [svg("path", { d: path, class: "line" }), svg("path", { d: tip, class: "head" })]);
}

function technique(target: FingerTarget, box: (fret: number) => number, y: (string: number) => number, t: Translate): SVGElement[] {
  const x = box(target.fret);
  const sy = y(target.string);
  const kind = target.technique;
  if (!kind) return [];
  if ((kind === "hammer" || kind === "pull") && target.techniqueTarget) {
    // Curved: the finger hammers on or pulls off without the pick, over the string.
    const tx = box(target.techniqueTarget.fret);
    const ty = y(target.techniqueTarget.string);
    const apex = Math.min(sy, ty) - 26;
    const end = { x: tx, y: ty - 14 };
    const angle = Math.atan2(end.y - apex, end.x - (x + tx) / 2);
    return [arrow(`M ${x} ${sy - 14} Q ${(x + tx) / 2} ${apex} ${end.x} ${end.y}`, end.x, end.y, angle, "technique"), svg("text", { x: (x + tx) / 2, y: apex + 6, class: "technique-label" }, [kind === "hammer" ? "h" : "p"])];
  }
  if ((kind === "slideUp" || kind === "slideDown") && target.techniqueTarget) {
    // Straight, along the string: the finger keeps pressing all the way.
    const tx = box(target.techniqueTarget.fret);
    const ly = sy + 15;
    const stop = tx - Math.sign(tx - x) * 4;
    return [arrow(`M ${x} ${ly} L ${stop} ${ly}`, stop, ly, tx > x ? 0 : Math.PI, "technique"), svg("text", { x: (x + tx) / 2, y: ly + 13, class: "technique-label" }, [kind === "slideUp" ? "/" : "\\"])];
  }
  if (kind === "bend") {
    const amount = target.bendSemitones ?? 2;
    const label = amount === 1 ? t("guide.bend.half") : amount === 2 ? t("guide.bend.full") : `${amount / 2}`;
    return [arrow(`M ${x + 16} ${sy} L ${x + 16} ${sy - 24}`, x + 16, sy - 26, -Math.PI / 2, "technique"), svg("text", { x: x + 16, y: sy - 32, class: "technique-label" }, [label])];
  }
  if (kind === "vibrato") {
    const wave = Array.from({ length: 7 }, (_, k) => `${k === 0 ? "M" : "L"} ${x + 17 + k * 4} ${sy - 18 + (k % 2 ? -3 : 3)}`).join(" ");
    return [svg("path", { d: wave, class: "technique wave" })];
  }
  if (kind === "release") {
    return [arrow(`M ${x + 16} ${sy - 24} L ${x + 16} ${sy - 4}`, x + 16, sy - 2, Math.PI / 2, "technique")];
  }
  return [];
}

/** The legend, as text under the diagram: what the numbers mean, and that they are suggestions. */
export function diagramLegend(t: Translate): HTMLElement {
  return element("div", { className: "fret-legend", text: t("guide.legend") });
}
