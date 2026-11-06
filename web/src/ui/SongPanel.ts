/**
 * Practising a real song.
 *
 * The parser this leans on was written for a different app and learnt its
 * lessons there: lyrics can look like chords ("Do you?"), websites wrap chords
 * in punctuation, and chord lines carry annotations that must not disqualify
 * them. All of that is reused untouched — what is new is the last step, turning
 * each parsed chord into a shape the class can actually teach, and being honest
 * about the ones it cannot.
 *
 * Consecutive repeats collapse. A chart that says "C C C C" over four bars is
 * one thing to learn, and asking a student to place the same shape four times
 * in a row teaches nothing but patience.
 */

import { findShape } from "../guitar/chords";
import { parseSong } from "../song/parse";
import type { Translate } from "../i18n";
import { clear, element, requireElement } from "./dom";

const STORAGE_KEY = "guitar.song.v1";

export interface SongLoad {
  /** Chord ids from the library, in playing order. */
  chords: string[];
  /** How many chords in the chart had no shape to teach. */
  skipped: number;
}

export class SongPanel {
  private root = requireElement("song");
  private card = requireElement("song-card");
  private toggle = requireElement<HTMLButtonElement>("song-toggle");
  private text = "";
  private notice = "";

  private loadHandler: ((load: SongLoad) => void) | null = null;

  constructor(private t: () => Translate) {
    this.text = readStoredText();
    this.toggle.addEventListener("click", () => this.setOpen(this.root.classList.contains("gone")));
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) this.setOpen(false);
    });
  }

  whenLoaded(handler: (load: SongLoad) => void) {
    this.loadHandler = handler;
  }

  setOpen(open: boolean) {
    this.root.classList.toggle("gone", !open);
    this.toggle.setAttribute("aria-pressed", String(open));
    if (open) this.render();
  }

  render() {
    const t = this.t();
    clear(this.card);

    const area = element("textarea", { attrs: { placeholder: t("song.placeholder"), spellcheck: "false" } });
    area.value = this.text;
    area.addEventListener("input", () => {
      this.text = area.value;
    });

    const load = element("button", { className: "primary", text: t("song.load"), attrs: { type: "button" } });
    load.addEventListener("click", () => this.load());

    const clearButton = element("button", { className: "ghost", text: t("song.clear"), attrs: { type: "button" } });
    clearButton.addEventListener("click", () => {
      this.text = "";
      this.notice = "";
      store("");
      this.render();
    });

    this.card.append(
      element("h2", { text: t("song.title") }),
      element("p", { text: t("song.intro") }),
      area,
    );
    if (this.notice) this.card.append(element("p", { className: "quiet", text: this.notice }));
    this.card.append(element("div", { className: "row" }, [load, clearButton]));
  }

  private load() {
    const t = this.t();
    const parsed = parseSong(this.text);
    store(this.text);

    const chords: string[] = [];
    let skipped = 0;

    for (const chord of parsed.sequence) {
      const shape = findShape(chord.pc, chord.shape);
      if (!shape) {
        skipped++;
        continue;
      }
      // The same shape twice in a row is one thing to learn, not two.
      if (chords[chords.length - 1] === shape.id) continue;
      chords.push(shape.id);
    }

    if (chords.length === 0) {
      this.notice = t("song.empty");
      this.render();
      return;
    }

    this.notice = skipped > 0 ? t("song.unknown", { count: skipped }) : t("song.loaded", { count: chords.length });
    this.render();
    this.setOpen(false);
    this.loadHandler?.({ chords, skipped });
  }
}

function readStoredText(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // A chart is text a student pasted; it is rendered with textContent and
    // parsed with a strict grammar, so the only thing worth guarding is size.
    return typeof raw === "string" && raw.length < 40000 ? raw : "";
  } catch {
    return "";
  }
}

function store(text: string) {
  try {
    if (text) localStorage.setItem(STORAGE_KEY, text.slice(0, 40000));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing worth interrupting anyone over.
  }
}
