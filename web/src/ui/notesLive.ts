/**
 * The live screen's elements (WF-07/08), built once and updated in place so a
 * frame costs nothing when nothing changed: "play this" (the note, where it
 * is, the count-in), the tab strip, the feedback, the camera's line, the level
 * meter with the signal line, and freestyle's list of notes.
 *
 * `NotesPanel` owns the session and the microphone; this only shows them.
 */

import type { SignalState } from "../audio/signalQuality";
import { candidatesFor } from "../fusion/candidates";
import type { VisionReason } from "../fusion/visionHealth";
import type { Translate, TranslationKey } from "../i18n";
import type { Place } from "../lesson/noteJudge";
import type { NoteSession } from "../lesson/NoteSession";
import { clear, element } from "./dom";
import { positionText, type FeedbackText } from "./feedback";
import { tabStrip } from "./TabStrip";

export interface FreeNote {
  midi: number;
  place: Place | null;
}

export class NotesLive {
  readonly pauseButton = element("button", { className: "ghost", attrs: { type: "button" } });
  private big = element("div", { className: "notes-target" });
  private where = element("div", { className: "notes-where" });
  private count = element("div", { className: "notes-count", attrs: { "aria-live": "assertive" } });
  private strip = element("div", { className: "tab-strip" });
  private feedbackBox = element("div", { className: "notes-feedback", attrs: { "aria-live": "polite" } });
  private meterFill = element("span", { className: "fill" });
  private signalLine = element("span", { className: "signal" });
  private debugLine = element("pre", { className: "listen-debug" });
  private visionLine = element("div", { className: "notes-vision" });
  private freeList = element("div", { className: "free-notes" });
  private lastStripKey = "";

  constructor(
    private t: () => Translate,
    private nameOf: (midi: number) => string,
  ) {}

  reset() {
    this.lastStripKey = "";
  }

  /** The play view: a heading row, the note, the strip (or `extra` in its place), the feedback, the level, the buttons. */
  playView(head: HTMLElement[], error: string, buttons: HTMLElement[], debug: boolean, extra: HTMLElement[] = []): HTMLElement[] {
    const t = this.t();
    const nodes: HTMLElement[] = [element("div", { className: "notes-head" }, head)];
    if (error) nodes.push(element("p", { className: "start-error", text: error }));
    nodes.push(
      element("div", { className: "notes-now" }, [element("div", { className: "notes-label", text: t("notes.playThis") }), this.big, this.where, this.count]),
      ...(extra.length ? extra : [this.strip]),
      this.feedbackBox,
      this.visionLine,
      this.levelRow(),
    );
    if (debug) nodes.push(this.debugLine);
    nodes.push(element("div", { className: "row" }, buttons));
    return nodes;
  }

  /** Freestyle: the newest note big, the ones before it small. */
  freeView(error: string, buttons: HTMLElement[], debug: boolean): HTMLElement[] {
    const t = this.t();
    const nodes: HTMLElement[] = [element("div", { className: "notes-head" }, [element("h2", { text: t("notes.free.title") })])];
    if (error) nodes.push(element("p", { className: "start-error", text: error }));
    nodes.push(
      element("div", { className: "notes-now" }, [element("div", { className: "notes-label", text: t("notes.free.heard") }), this.big, this.where]),
      this.freeList,
      this.visionLine,
      this.levelRow(),
    );
    if (debug) nodes.push(this.debugLine);
    nodes.push(element("div", { className: "row" }, buttons));
    return nodes;
  }

  private levelRow(): HTMLElement {
    const t = this.t();
    const meter = element("div", { className: "listen-meter", attrs: { role: "meter", "aria-label": t("listen.level") } }, [this.meterFill]);
    return element("div", { className: "listen-level" }, [element("span", { text: t("listen.level") }), meter, this.signalLine]);
  }

  level(rms: number) {
    // Three decades of RMS, -60 to 0 dBFS, across the bar.
    this.meterFill.style.width = `${Math.max(0, Math.min(100, (1 + Math.log10(Math.max(rms, 1e-6)) / 3) * 100))}%`;
  }

  /** Good, too quiet, clipping: beside the meter, in words and colour. */
  signal(state: SignalState) {
    const text = this.t()(`notes.signal.${state}`);
    if (this.signalLine.textContent !== text) this.signalLine.textContent = text;
    this.signalLine.className = `signal signal-${state}`;
  }

  /** "Ear + camera", or why it is ear only: the brief's audio-only banner. `null`: no camera in play. */
  vision(reason: VisionReason | null) {
    const key = reason === null ? "notes.vision.earOnly" : reason === "ok" ? "notes.vision.fused" : `notes.vision.${reason}`;
    const text = this.t()(key as TranslationKey);
    if (this.visionLine.textContent !== text) this.visionLine.textContent = text;
    this.visionLine.classList.toggle("fallback", reason !== null && reason !== "ok");
  }

  feedback(feedback: { text: FeedbackText; state: string } | null) {
    clear(this.feedbackBox);
    this.feedbackBox.className = `notes-feedback ${feedback ? `state-${feedback.state}` : ""}`;
    if (!feedback) {
      this.feedbackBox.append(element("div", { className: "line", text: this.t()("notes.waiting") }));
      return;
    }
    this.feedbackBox.append(
      element("div", { className: "word" }, [
        element("span", { className: "icon", text: feedback.text.icon, attrs: { "aria-hidden": "true" } }),
        element("span", { text: feedback.text.word }),
      ]),
      element("div", { className: "line", text: feedback.text.line }),
    );
  }

  /** Before the session exists: the microphone is opening, or could not. */
  opening(error: string) {
    this.big.textContent = "…";
    this.where.textContent = error ? "" : this.t()("notes.opening");
  }

  /** Per frame: the count-in, the target, the strip. Cheap when nothing changed. */
  play(session: NoteSession, nowMs: number) {
    const t = this.t();
    const phase = session.phase(nowMs);
    const left = session.countInLeft(nowMs);
    const count = phase === "paused" ? t("notes.paused") : left > 0 ? String(left) : "";
    if (this.count.textContent !== count) this.count.textContent = count;
    this.count.classList.toggle("on", phase === "paused" || left > 0);
    const pause = t(phase === "paused" ? "notes.resume" : "notes.pause");
    if (this.pauseButton.textContent !== pause) this.pauseButton.textContent = pause;

    const target = session.target;
    if (target) {
      const name = this.nameOf(target.midi);
      if (this.big.textContent !== name) this.big.textContent = name;
      const where = positionText(t, target);
      if (this.where.textContent !== where) this.where.textContent = where;
    }
    const key = `${session.current}:${session.judged.length}`;
    if (key !== this.lastStripKey) {
      this.lastStripKey = key;
      const states = new Map<number, string>();
      for (const judged of session.judged) states.set(judged.index, judged.verdict.state);
      this.strip.replaceChildren(tabStrip(session.steps, session.current, states));
    }
  }

  /** The newest note, where it was played (or where it could have been), and the ones before it. */
  free(notes: readonly FreeNote[], error: string) {
    const t = this.t();
    const [last, ...before] = notes;
    if (!last) {
      this.big.textContent = "…";
      this.where.textContent = error ? "" : t("notes.free.play");
    } else {
      this.big.textContent = this.nameOf(last.midi);
      this.where.textContent =
        last.place && last.place.string !== null && last.place.fret !== null
          ? positionText(t, { string: last.place.string, fret: last.place.fret })
          : t("notes.free.canBe", {
              places: candidatesFor(last.midi, 12)
                .slice(0, 3)
                .map((c) => positionText(t, c))
                .join(" · "),
            });
    }
    this.freeList.replaceChildren(...before.map((note) => element("span", { className: "chip", text: this.nameOf(note.midi) })));
  }

  debug(text: string) {
    this.debugLine.textContent = text;
  }
}
