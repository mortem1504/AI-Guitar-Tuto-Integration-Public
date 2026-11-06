/**
 * The strip along the bottom: what to play, how it is going, and the one thing
 * to fix right now.
 *
 * Deliberately one line of advice, never a list. A student mid-chord can act on
 * exactly one instruction, and a panel that reports all four wrong fingers is a
 * panel they stop reading. The judge already knows everything; this shows the
 * next move.
 *
 * Built once and then updated in place. It is touched sixty times a second, and
 * rebuilding a dozen elements at that rate would make the page stutter for no
 * gain — the text changes, the structure never does.
 */

import type { ChordShape } from "../guitar/chords";
import type { Verdict } from "../guitar/judge";
import type { Translate } from "../i18n";
import { clear, element, requireElement } from "./dom";
import { Diagram } from "./Diagram";

export type CoachTone = "neutral" | "right" | "wrong";

export interface CoachView {
  shape: ChordShape | null;
  /** The big name: "Am". */
  title: string;
  /** The single correction, or the encouragement. */
  line: string;
  tone: CoachTone;
  /** 0 to 1: how much of the hold has been earned. */
  hold: number;
  /** Small capitals under the line: progress, streak. */
  meta: string[];
  verdicts: Map<number, Verdict>;
}

export class Coach {
  private root = requireElement("coach");
  private diagram = new Diagram();
  private title = element("div", { className: "coach-name" });
  private line = element("div", { className: "coach-line" });
  private meta = element("div", { className: "coach-meta" });
  private holdBar = element("span");
  private buttons = element("div", { className: "row" });

  private skipHandler: (() => void) | null = null;
  private leaveHandler: (() => void) | null = null;
  /** Only redrawn when the picture would actually change. */
  private lastDiagramKey = "";

  constructor() {
    const hold = element("div", { className: "hold" }, [this.holdBar]);
    const words = element("div", { className: "words" }, [this.title, this.line, hold, this.meta, this.buttons]);
    this.root.replaceChildren(this.diagram.canvas, words);
  }

  whenSkipped(handler: () => void) {
    this.skipHandler = handler;
  }

  whenLeft(handler: () => void) {
    this.leaveHandler = handler;
  }

  /** The two buttons only change with the language, so they are set apart. */
  render(t: Translate) {
    clear(this.buttons);
    const skip = element("button", { className: "ghost", text: t("lesson.skip"), attrs: { type: "button" } });
    skip.addEventListener("click", () => this.skipHandler?.());
    const leave = element("button", { className: "ghost", text: t("lesson.stop"), attrs: { type: "button" } });
    leave.addEventListener("click", () => this.leaveHandler?.());
    this.buttons.append(skip, leave);
  }

  show(view: CoachView) {
    this.root.classList.remove("gone");

    if (this.title.textContent !== view.title) this.title.textContent = view.title;
    if (this.line.textContent !== view.line) this.line.textContent = view.line;
    this.line.className = `coach-line ${view.tone === "neutral" ? "" : view.tone}`.trim();
    this.holdBar.style.width = `${Math.round(Math.min(1, Math.max(0, view.hold)) * 100)}%`;

    const meta = view.meta.join(" · ");
    if (this.meta.textContent !== meta) this.meta.textContent = meta;

    // The diagram is a picture of the shape plus the verdicts; anything else
    // changing is not a reason to repaint it.
    const key = `${view.shape?.id ?? ""}|${[...view.verdicts.entries()].sort().join(",")}`;
    if (key !== this.lastDiagramKey) {
      this.lastDiagramKey = key;
      this.diagram.render(view.shape, view.verdicts);
    }
  }

  hide() {
    this.root.classList.add("gone");
    this.lastDiagramKey = "";
  }
}
