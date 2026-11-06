/**
 * The exercise as tab: six lines, thin E on top, fret numbers on the line to
 * play, the way every tab book writes it.
 *
 * A window of the exercise around the current note, so a 24-note spider walk
 * still fits a laptop screen. Past notes carry their result's icon above them
 * (not only a colour); the current one is outlined.
 */

import type { NoteStep } from "../lesson/exercises";
import type { FeedbackState } from "../lesson/noteJudge";
import { element } from "./dom";
import { FEEDBACK_ICON } from "./feedback";

/** Columns shown: enough to read ahead, few enough to stay big from a metre away. */
const VISIBLE = 12;
/** Of which this many are behind the current note. */
const BEHIND = 3;

const STRING_LETTERS = ["", "e", "B", "G", "D", "A", "E"];

export function tabStrip(steps: readonly NoteStep[], current: number, results: ReadonlyMap<number, string>): HTMLElement {
  const first = Math.max(0, Math.min(current - BEHIND, steps.length - VISIBLE));
  const last = Math.min(steps.length, first + VISIBLE);

  const grid = element("div", { className: "tab", attrs: { role: "img" } });
  grid.style.gridTemplateColumns = `1.6em repeat(${last - first}, minmax(1.8em, 1fr))`;

  // The row of results.
  grid.append(element("span"));
  for (let i = first; i < last; i++) {
    const state = results.get(i) as FeedbackState | undefined;
    grid.append(element("span", { className: `mark ${state ? `state-${state}` : ""}`, text: state ? FEEDBACK_ICON[state] : "" }));
  }

  for (let string = 1; string <= 6; string++) {
    grid.append(element("span", { className: "letter", text: STRING_LETTERS[string] }));
    for (let i = first; i < last; i++) {
      const step = steps[i];
      const classes = ["cell"];
      if (i === current) classes.push("now");
      if (i < current || results.has(i)) classes.push("past");
      grid.append(element("span", { className: classes.join(" "), text: step.string === string ? String(step.fret) : "" }));
    }
  }

  const label = steps
    .slice(first, last)
    .map((s) => `${s.string}/${s.fret}`)
    .join(" ");
  grid.setAttribute("aria-label", label);
  return grid;
}
