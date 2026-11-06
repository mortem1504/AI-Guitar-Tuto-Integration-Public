/**
 * A song's events drawn as tab again, cleanly: six lines, thin e on top, a
 * column per event (a chord's notes stacked), each note with its technique's
 * usual symbol. The import preview wraps the whole song in rows; the lesson
 * shows a window around the current note, with each played note's result
 * above it as an icon, never only a colour. Same grid and classes as
 * `TabStrip`, so it looks like the rest of the lessons.
 */

import type { FeedbackState } from "../lesson/noteJudge";
import type { TabEvent, TabNote } from "../song/model";
import { element } from "./dom";
import { FEEDBACK_ICON } from "./feedback";

const STRING_LETTERS = ["", "e", "B", "G", "D", "A", "E"];
/** Columns per row in the preview: a bar or two of quavers, readable on a laptop. */
const ROW = 16;
/** The lesson's window, and how much of it is behind the current note (as TabStrip). */
const VISIBLE = 14;
const BEHIND = 3;

/** How a note is written in a tab: the fret, with its technique's symbol. */
export function noteText(note: TabNote): string {
  const has = (t: string) => note.techniques.includes(t as never);
  if (has("dead")) return "x";
  let text = String(note.fret);
  if (has("harmonic")) text = `<${text}>`;
  if (has("hammer")) text = `h${text}`;
  else if (has("pull")) text = `p${text}`;
  else if (has("slideUp")) text = `/${text}`;
  else if (has("slideDown")) text = `\\${text}`;
  else if (has("tap")) text = `t${text}`;
  if (has("bend")) text += "b";
  if (has("release")) text += "r";
  if (has("vibrato")) text += "~";
  if (has("palmMute")) text = `${text}·`;
  return text;
}

export interface SongTabOptions {
  /** The column being asked for: outlined, and the window follows it. */
  current?: number;
  /** Results by column. */
  states?: ReadonlyMap<number, string>;
  /** Columns that are heard, not graded: dimmed. */
  listenOnly?: ReadonlySet<number>;
  /** A window around `current` instead of the whole thing in rows. */
  window?: boolean;
}

/** `order` is the event index of each column (a hot spot repeats its two). */
export function songTab(events: readonly TabEvent[], order: readonly number[], options: SongTabOptions = {}): HTMLElement {
  const current = options.current ?? -1;
  if (options.window) {
    const first = Math.max(0, Math.min(current - BEHIND, order.length - VISIBLE));
    return grid(events, order, first, Math.min(order.length, first + VISIBLE), options);
  }
  const rows = element("div", { className: "song-tab" });
  for (let first = 0; first < order.length; first += ROW) rows.append(grid(events, order, first, Math.min(order.length, first + ROW), options));
  return rows;
}

function grid(events: readonly TabEvent[], order: readonly number[], first: number, last: number, options: SongTabOptions): HTMLElement {
  const current = options.current ?? -1;
  const tab = element("div", { className: "tab", attrs: { role: "img" } });
  tab.style.gridTemplateColumns = `1.6em repeat(${Math.max(1, last - first)}, minmax(1.8em, 1fr))`;
  if (options.states) {
    tab.append(element("span"));
    for (let c = first; c < last; c++) {
      const state = options.states.get(c) as FeedbackState | undefined;
      tab.append(element("span", { className: `mark ${state ? `state-${state}` : ""}`, text: state ? FEEDBACK_ICON[state] : "" }));
    }
  }
  for (let string = 1; string <= 6; string++) {
    tab.append(element("span", { className: "letter", text: STRING_LETTERS[string] }));
    for (let c = first; c < last; c++) {
      const note = events[order[c]].notes.find((n) => n.string === string);
      const classes = ["cell"];
      if (c === current) classes.push("now");
      if (current >= 0 && c < current) classes.push("past");
      if (options.listenOnly?.has(c)) classes.push("listen-only");
      tab.append(element("span", { className: classes.join(" "), text: note ? noteText(note) : "" }));
    }
  }
  tab.setAttribute(
    "aria-label",
    order
      .slice(first, last)
      .map((i) => events[i].notes.map((n) => `${n.string}/${noteText(n)}`).join("+"))
      .join(" "),
  );
  return tab;
}
