/**
 * What the microphone hears, one note at a time.
 *
 * Phase 1's whole visible product: play a note, see its name. The big label is
 * the note with its octave (E2, not just E), because on a guitar the octave is
 * the difference between the thick string and the thin one. Below it, the
 * input picker and a level meter, since "it doesn't hear me" is nearly always
 * the wrong input or a level too low to read.
 *
 * With `?debug`, a readout adds Hz, cents, confidence and latency. Latency is
 * pluck (the worklet's onset) to the first animation frame after the note is
 * on screen, with p50 and p95 over the session. `?debug&source=synth` swaps the
 * microphone for a looping test signal, to check the pipeline with no guitar.
 *
 * The microphone opens when this opens and is released when it closes or the
 * tab is hidden, like the tuner's.
 */

import { listInputs, loadInputChoice, saveInputChoice, type AudioInput } from "../audio/mic";
import { LatencyStats, pluckToScreenMs } from "../audio/latency";
import { NoteListener, type Arrival } from "../audio/NoteListener";
import type { ListenEvent, NoteEvent } from "../audio/noteEvents";
import { PARAMS } from "../audio/params";
import { SYNTH_SEQUENCE, synthSource } from "../audio/synthSource";
import { noteName, octaveOf } from "../guitar/tuning";
import { LOCALES, type Language, type Translate } from "../i18n";
import { clear, element, requireElement } from "./dom";

/** The meter spans this many decibels below full scale. */
const METER_FLOOR_DB = -60;

function dbfs(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

export class ListenPanel {
  private root = requireElement("listen");
  private card = requireElement("listen-card");
  private toggle = requireElement<HTMLButtonElement>("listen-toggle");
  private listener = new NoteListener();
  private latency = new LatencyStats();
  /** Onset to the message reaching this thread: the audio half, unaffected by rendering. */
  private audioLatency = new LatencyStats();
  private readonly debug: boolean;
  private readonly synthetic: boolean;

  private note = element("div", { className: "tuner-note" });
  private line = element("div", { className: "coach-line" });
  private meterFill = element("span", { className: "fill" });
  private meterFloor = element("span", { className: "floor" });
  private debugLines = element("pre", { className: "listen-debug" });

  private inputs: AudioInput[] = [];
  private chosenInput: string | null = loadInputChoice();
  private error = "";
  private lastNote: NoteEvent | null = null;
  private lastLevel = { rms: 0, noiseFloor: 0 };
  private openedHandler: () => void = () => {};

  constructor(
    private t: () => Translate,
    private language: () => Language,
  ) {
    const query = new URLSearchParams(location.search);
    this.debug = query.has("debug");
    this.synthetic = this.debug && query.get("source") === "synth";

    this.toggle.addEventListener("click", () => void this.setOpen(!this.open));
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) void this.setOpen(false);
    });
    // A tab that goes away should not keep the microphone.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.open) void this.setOpen(false);
    });
    this.listener.onEvent((event, arrival) => this.onEvent(event, arrival));
  }

  get open(): boolean {
    return !this.root.classList.contains("gone");
  }

  /** Something else that wants the microphone (the tuner) closes when this opens. */
  whenOpened(handler: () => void) {
    this.openedHandler = handler;
  }

  async setOpen(open: boolean) {
    if (!open) {
      this.listener.stop();
      this.root.classList.add("gone");
      this.toggle.setAttribute("aria-pressed", "false");
      return;
    }

    this.openedHandler();
    this.root.classList.remove("gone");
    this.toggle.setAttribute("aria-pressed", "true");
    await this.listen();
  }

  private async listen() {
    this.error = "";
    this.lastNote = null;
    this.latency.reset();
    this.audioLatency.reset();
    if (!NoteListener.supported()) {
      this.error = this.t()("listen.unsupported");
    } else {
      try {
        await this.listener.start(this.chosenInput, this.synthetic ? synthSource : undefined);
        // Labels only exist once the microphone has been granted.
        this.inputs = this.synthetic ? [] : await listInputs();
      } catch {
        // Refused, unplugged, or no microphone at all. The panel stays open
        // and says so: doing nothing after a click is the worse failure.
        this.error = this.t()("listen.denied");
      }
    }
    this.render();
  }

  private onEvent(event: ListenEvent, arrival: Arrival) {
    switch (event.kind) {
      case "level":
        this.lastLevel = { rms: event.rms, noiseFloor: event.noiseFloor };
        this.showLevel();
        return;
      case "unclear":
        this.note.textContent = "?";
        this.note.className = "tuner-note";
        this.line.textContent = this.t()("listen.unclear");
        this.line.className = "coach-line";
        return;
      case "note":
        this.lastNote = event;
        this.audioLatency.add((arrival.contextTime - event.onsetTime) * 1000);
        this.showNote(event);
        // The note is in the DOM now; it is on screen at the next frame.
        requestAnimationFrame(() => {
          this.latency.add(pluckToScreenMs(event.onsetTime, arrival.contextTime, arrival.perfMs, performance.now()));
          this.showDebug();
        });
        return;
    }
  }

  private nameOf(midi: number): string {
    return `${noteName(midi, LOCALES[this.language()].notation)}${octaveOf(midi)}`;
  }

  private showNote(event: NoteEvent) {
    this.note.textContent = this.nameOf(event.midi);
    this.note.className = "tuner-note right";
    const cents = Math.round(event.cents);
    this.line.textContent = this.t()("listen.hz", { hz: event.hz.toFixed(1), cents: cents > 0 ? `+${cents}` : String(cents) });
    this.line.className = "coach-line";
  }

  private showLevel() {
    const toPercent = (rms: number) => Math.max(0, Math.min(100, (1 - dbfs(rms) / METER_FLOOR_DB) * 100));
    this.meterFill.style.width = `${toPercent(this.lastLevel.rms)}%`;
    this.meterFloor.style.left = `${toPercent(this.lastLevel.noiseFloor)}%`;
    if (this.debug && !this.lastNote) this.showDebug();
  }

  private showDebug() {
    if (!this.debug) return;
    const note = this.lastNote;
    const fmt = (ms: number) => (Number.isFinite(ms) ? `${Math.round(ms)}` : "—");
    const lines = [
      note
        ? `${this.nameOf(note.midi)}  ${note.hz.toFixed(2)} Hz  ${note.cents >= 0 ? "+" : ""}${note.cents.toFixed(1)} c  conf ${note.confidence.toFixed(2)}  rms ${dbfs(note.rms).toFixed(0)} dBFS`
        : "no note yet",
      `pluck→screen  last ${fmt(this.latency.last)} ms  p50 ${fmt(this.latency.percentile(50))}  p95 ${fmt(this.latency.percentile(95))}  (n=${this.latency.count})  + input ~${this.listener.baseLatencyMs.toFixed(1)} ms`,
      `  of which audio (onset→main thread)  p50 ${fmt(this.audioLatency.percentile(50))}  p95 ${fmt(this.audioLatency.percentile(95))}${document.hidden ? "  · tab hidden: screen time is throttled" : ""}`,
      `${this.listener.sampleRate} Hz  ${PARAMS.method}  level ${dbfs(this.lastLevel.rms).toFixed(0)} dBFS  floor ${dbfs(this.lastLevel.noiseFloor).toFixed(0)} dBFS`,
    ];
    this.debugLines.textContent = lines.join("\n");
  }

  private inputPicker(): HTMLElement | null {
    if (this.synthetic || this.inputs.length === 0) return null;
    const t = this.t();
    const select = element("select", { attrs: { "aria-label": t("listen.input") } });
    const current = this.listener.deviceId ?? this.chosenInput;
    select.append(element("option", { text: t("listen.input.default"), attrs: { value: "" } }));
    this.inputs.forEach((input, index) => {
      const option = element("option", {
        text: input.label || t("listen.input.unnamed", { index: index + 1 }),
        attrs: { value: input.deviceId },
      });
      if (input.deviceId === current && this.chosenInput) option.selected = true;
      select.append(option);
    });
    select.addEventListener("change", () => {
      this.chosenInput = select.value || null;
      saveInputChoice(this.chosenInput);
      void this.listen();
    });
    return element("label", { className: "listen-input" }, [element("span", { text: t("listen.input") }), select]);
  }

  render() {
    const t = this.t();
    clear(this.card);

    this.card.append(element("h2", { text: t("listen.title") }), element("p", { text: t("listen.intro") }));
    if (this.error) this.card.append(element("p", { className: "start-error", text: this.error }));
    if (this.synthetic) {
      const names = SYNTH_SEQUENCE.map((midi) => this.nameOf(midi)).join(" ");
      this.card.append(element("p", { className: "start-warn", text: t("listen.synth", { notes: names }) }));
    }

    if (this.lastNote) this.showNote(this.lastNote);
    else {
      this.note.textContent = "—";
      this.note.className = "tuner-note";
      this.line.textContent = t("listen.silence");
      this.line.className = "coach-line";
    }
    this.card.append(element("div", { className: "tuner-dial" }, [this.note, this.line]));

    const meter = element("div", { className: "listen-meter", attrs: { role: "meter", "aria-label": t("listen.level") } }, [
      this.meterFill,
      this.meterFloor,
    ]);
    this.card.append(element("div", { className: "listen-level" }, [element("span", { text: t("listen.level") }), meter]));

    const picker = this.inputPicker();
    if (picker) this.card.append(picker);

    if (this.debug) {
      this.card.append(this.debugLines);
      this.showDebug();
    }

    const close = element("button", { className: "primary", text: t("listen.close"), attrs: { type: "button" } });
    close.addEventListener("click", () => void this.setOpen(false));
    this.card.append(element("div", { className: "row" }, [close]));
  }
}
