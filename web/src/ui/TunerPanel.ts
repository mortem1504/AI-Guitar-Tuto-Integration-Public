/**
 * The tuner.
 *
 * Six rows, one per string, and a needle. The rows are the point: a beginner
 * does not know that the thickest string is an E, and a tuner that only shows a
 * note name leaves them guessing which peg to turn. Each row ticks green and
 * stays ticked, so tuning becomes a list of six things to finish rather than an
 * open-ended fiddle.
 *
 * A string has to *stay* in tune for a moment before it is ticked, for the same
 * reason a chord has to be held: a peg passing through the right tension on its
 * way somewhere else is not a tuned string.
 *
 * The microphone is opened when this opens and released when it closes. That is
 * the whole contract, and the browser's recording indicator is the honest
 * public account of it.
 */

import { noteAt, noteName } from "../guitar/tuning";
import { LOCALES, type Translate, type TranslationKey } from "../i18n";
import type { Language } from "../i18n";
import { Tuner } from "../tuner/Tuner";
import { matchString, STRING_NUMBERS, type StringMatch } from "../tuner/strings";
import { clear, element, requireElement } from "./dom";

/** How long a string must sit in tune before it is ticked off. */
const SETTLE_MS = 700;

/** The needle spans this many cents either side of the mark. */
const NEEDLE_RANGE = 50;

export class TunerPanel {
  private root = requireElement("tuner");
  private card = requireElement("tuner-card");
  private toggle = requireElement<HTMLButtonElement>("tuner-toggle");
  private tuner = new Tuner();

  /** Which strings have been tuned this session. Not persisted: it is a chore. */
  private tuned = new Set<number>();
  private rows = new Map<number, HTMLElement>();
  private note = element("div", { className: "tuner-note" });
  private detail = element("div", { className: "coach-line" });
  private needle = element("span");
  private error = "";

  private openedHandler: () => void = () => {};

  /** When the current string first went in tune, for the settle timer. */
  private inTuneSince = 0;
  private held: number | null = null;

  constructor(
    private t: () => Translate,
    private language: () => Language,
  ) {
    this.toggle.addEventListener("click", () => void this.setOpen(this.root.classList.contains("gone")));
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) void this.setOpen(false);
    });
    // A tab that goes away should not keep the microphone. This is belt and
    // braces on top of closing the panel, because a student who switches tabs
    // mid-tune never closes anything.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.open) void this.setOpen(false);
    });
  }

  get open(): boolean {
    return !this.root.classList.contains("gone");
  }

  /** Something else that wants the microphone (the listener) closes when this opens. */
  whenOpened(handler: () => void) {
    this.openedHandler = handler;
  }

  async setOpen(open: boolean) {
    if (open) {
      this.openedHandler();
      this.error = "";
      try {
        await this.tuner.start();
      } catch {
        // Refused, or no microphone at all. The panel still opens and says so:
        // silently doing nothing after a click is the worse failure.
        this.error = this.t()("tuner.denied");
      }
      this.root.classList.remove("gone");
      this.toggle.setAttribute("aria-pressed", "true");
      this.render();
      return;
    }

    this.tuner.stop();
    this.held = null;
    this.root.classList.add("gone");
    this.toggle.setAttribute("aria-pressed", "false");
  }

  /** Called every frame while the panel is open. */
  tick(nowMs: number) {
    if (!this.open || !this.tuner.listening) return;

    const reading = this.tuner.read(nowMs);
    const match = reading ? matchString(reading.frequency) : null;

    this.updateNeedle(match);
    this.updateSettle(match, nowMs);
  }

  private updateSettle(match: StringMatch | null, nowMs: number) {
    if (!match || !match.inTune) {
      this.inTuneSince = 0;
      return;
    }
    if (this.held !== match.string) {
      this.held = match.string;
      this.inTuneSince = nowMs;
      return;
    }
    if (this.inTuneSince === 0) this.inTuneSince = nowMs;
    if (nowMs - this.inTuneSince >= SETTLE_MS && !this.tuned.has(match.string)) {
      this.tuned.add(match.string);
      this.markRow(match.string);
    }
  }

  private updateNeedle(match: StringMatch | null) {
    const t = this.t();

    if (!match) {
      this.note.textContent = "—";
      this.note.className = "tuner-note";
      this.detail.textContent = t("tuner.silence");
      this.detail.className = "coach-line";
      this.needle.style.left = "50%";
      this.needle.style.background = "";
      return;
    }

    const cents = Math.round(match.cents);
    this.note.textContent = noteName(match.midi, LOCALES[this.language()].notation);
    this.note.className = `tuner-note ${match.inTune ? "right" : "wrong"}`;

    this.detail.textContent = match.inTune
      ? t("tuner.ok")
      : cents < 0
        ? t("tuner.flat", { cents: Math.abs(cents) })
        : t("tuner.sharp", { cents });
    this.detail.className = `coach-line ${match.inTune ? "right" : "wrong"}`;

    // Clamped so a wildly slack string pins the needle instead of leaving it.
    const offset = Math.max(-1, Math.min(1, match.cents / NEEDLE_RANGE));
    this.needle.style.left = `${50 + offset * 50}%`;
  }

  private markRow(stringNumber: number) {
    const row = this.rows.get(stringNumber);
    row?.classList.add("done");
  }

  render() {
    const t = this.t();
    const notation = LOCALES[this.language()].notation;
    clear(this.card);
    this.rows.clear();

    this.card.append(element("h2", { text: t("tuner.title") }), element("p", { text: t("tuner.intro") }));

    if (this.error) {
      this.card.append(element("p", { className: "start-error", text: this.error }));
    }

    // The dial: the note, how far out it is, and a needle against a centre mark.
    const scale = element("div", { className: "tuner-scale" }, [
      element("span", { className: "mark" }),
      this.needle,
    ]);
    this.needle.className = "pip";
    this.card.append(element("div", { className: "tuner-dial" }, [this.note, this.detail, scale]));

    // One row per string, thick E first — the order a hand walks the pegs.
    const list = element("div", { className: "tuner-strings" });
    for (const stringNumber of [...STRING_NUMBERS].reverse()) {
      const row = element("div", { className: "tuner-string" }, [
        element("span", { className: "name", text: noteName(noteAt(stringNumber, 0), notation) }),
        element("span", { className: "which", text: t(`string.${stringNumber}` as TranslationKey) }),
        element("span", { className: "tick", text: "✓" }),
      ]);
      if (this.tuned.has(stringNumber)) row.classList.add("done");
      this.rows.set(stringNumber, row);
      list.append(row);
    }
    this.card.append(list);

    this.card.append(element("p", { className: "quiet", text: t("tuner.reference") }));

    const close = element("button", { className: "primary", text: t("tuner.close"), attrs: { type: "button" } });
    close.addEventListener("click", () => void this.setOpen(false));

    const again = element("button", { className: "ghost", text: t("tuner.again"), attrs: { type: "button" } });
    again.addEventListener("click", () => {
      this.tuned.clear();
      this.render();
    });

    this.card.append(element("div", { className: "row" }, [close, again]));
  }
}
