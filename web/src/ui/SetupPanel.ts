/**
 * Check your setup (WF-04): five checks in one card, about a minute.
 *
 *   1. Input: built-in microphone or plugged in, and which device.
 *   2. Level: the loudest recent peak, against what the judge needs.
 *   3. Room noise: three seconds of silence, measured on request.
 *   4. Note test: the open A string, named back.
 *   5. Camera: lighting and whether the neck is marked; or skip it and
 *      practise by ear.
 *
 * The verdicts are pure (`audio/setupChecks.ts`); this only measures and
 * shows. The microphone is open while the card is, and released on close and
 * when the tab is hidden, like every other listener here.
 */

import { listInputs, loadInputChoice, saveInputChoice, type AudioInput } from "../audio/mic";
import { NoteListener } from "../audio/NoteListener";
import type { ListenEvent } from "../audio/noteEvents";
import { dbfs, levelVerdict, lightVerdict, noiseVerdict, NOTE_TEST_MIDI, noteTestVerdict } from "../audio/setupChecks";
import { synthSource } from "../audio/synthSource";
import type { InputKind, Settings } from "../app/settings";
import { noteName, octaveOf } from "../guitar/tuning";
import { LOCALES, type Language, type Translate } from "../i18n";
import { clear, element, requireElement } from "./dom";
import { segmented } from "./segmented";

export interface CameraStatus {
  running: boolean;
  /** Mean luma of the picture, 0 to 1, when measured. */
  brightness: number | null;
  calibrated: boolean;
}

export interface SetupActions {
  camera(): CameraStatus;
  startCamera(): void;
  markNeck(): void;
  openTuner(): void;
  practiseByEar(): void;
}

/** The level verdict looks at this much playing: a few plucks' worth. */
const LEVEL_WINDOW_MS = 4000;
/** Long enough for a median to ignore a cough; short enough to sit through. */
const NOISE_MS = 3000;

export class SetupPanel {
  private root = requireElement("setup");
  private card = requireElement("setup-card");
  private toggle = requireElement<HTMLButtonElement>("setup-toggle");
  private listener = new NoteListener();
  private readonly synthetic: boolean;
  private inputs: AudioInput[] = [];
  private error = "";
  private peaks: { at: number; peak: number }[] = [];
  private noise: { until: number; readings: number[] } | null = null;
  private noiseResult: ReturnType<typeof noiseVerdict> = null;
  private heard: number | null = null;
  private timer = 0;
  private openedHandler: () => void = () => {};
  private actions: SetupActions | null = null;

  private meterFill = element("span", { className: "fill" });
  private levelLine = element("p", { attrs: { "aria-live": "polite" } });
  private noiseLine = element("p", { attrs: { "aria-live": "polite" } });
  private noteLine = element("p", { attrs: { "aria-live": "polite" } });
  private cameraBox = element("div", { className: "setup-camera" });

  constructor(
    private t: () => Translate,
    private language: () => Language,
    private settings: () => Settings,
    private saveSettings: () => void,
  ) {
    const query = new URLSearchParams(location.search);
    this.synthetic = query.has("debug") && query.get("source") !== null;
    this.toggle.addEventListener("click", () => void this.setOpen(!this.open));
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) void this.setOpen(false);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.open) void this.setOpen(false);
    });
    this.listener.onEvent((event) => this.onEvent(event));
  }

  get open(): boolean {
    return !this.root.classList.contains("gone");
  }

  /** The other listeners close when this opens: one microphone. */
  whenOpened(handler: () => void) {
    this.openedHandler = handler;
  }

  connect(actions: SetupActions) {
    this.actions = actions;
  }

  async setOpen(open: boolean) {
    if (!open) {
      this.listener.stop();
      clearInterval(this.timer);
      this.root.classList.add("gone");
      this.toggle.setAttribute("aria-pressed", "false");
      return;
    }
    this.openedHandler();
    this.root.classList.remove("gone");
    this.toggle.setAttribute("aria-pressed", "true");
    this.peaks = [];
    this.noise = null;
    this.noiseResult = null;
    this.heard = null;
    this.render();
    clearInterval(this.timer);
    // The camera's state changes on its own (lighting, a neck marked meanwhile).
    this.timer = window.setInterval(() => this.updateCamera(), 500);
    await this.listen();
  }

  private async listen() {
    this.error = "";
    try {
      if (!NoteListener.supported()) throw new Error("unsupported");
      await this.listener.start(loadInputChoice(), this.synthetic ? synthSource : undefined);
      this.inputs = this.synthetic ? [] : await listInputs();
    } catch {
      this.error = this.t()(NoteListener.supported() ? "listen.denied" : "listen.unsupported");
    }
    if (this.open) this.render();
  }

  private onEvent(event: ListenEvent) {
    const t = this.t();
    if (event.kind === "level") {
      const now = event.time * 1000;
      this.meterFill.style.width = `${Math.max(0, Math.min(100, (1 + Math.log10(Math.max(event.rms, 1e-6)) / 3) * 100))}%`;
      this.peaks.push({ at: now, peak: event.peak });
      while (this.peaks.length > 0 && this.peaks[0].at < now - LEVEL_WINDOW_MS) this.peaks.shift();
      const max = Math.max(0, ...this.peaks.map((p) => p.peak));
      const verdict = levelVerdict(max);
      this.levelLine.textContent = t(`setup.level.${verdict}`, { db: Math.round(dbfs(max)) });
      this.levelLine.className = `setup-verdict verdict-${verdict === "good" ? "ok" : verdict === "waiting" ? "wait" : "bad"}`;

      if (this.noise) {
        if (now < this.noise.until) this.noise.readings.push(event.rms);
        else {
          this.noiseResult = noiseVerdict(this.noise.readings);
          this.noise = null;
          this.renderNoise();
        }
      }
      return;
    }
    if (event.kind === "note") {
      this.heard = event.midi;
      this.renderNote();
    }
  }

  private nameOf(midi: number): string {
    return `${noteName(midi, LOCALES[this.language()].notation)}${octaveOf(midi)}`;
  }

  render() {
    const t = this.t();
    const settings = this.settings();
    clear(this.card);
    this.card.classList.add("wide");
    this.card.append(element("h2", { text: t("setup.title") }), element("p", { className: "quiet", text: t("setup.intro") }));
    if (this.error) this.card.append(element("p", { className: "start-error", text: this.error }));

    // 1. Input
    const input = element("section", { className: "setup-step" }, [
      element("h3", { text: t("setup.input") }),
      segmented<InputKind>(
        t("notes.input"),
        [
          ["builtin", t("notes.input.builtin")],
          ["plugged", t("notes.input.plugged")],
        ],
        settings.inputKind,
        (kind) => {
          settings.inputKind = kind;
          this.saveSettings();
          this.render();
        },
      ),
      element("p", { className: "quiet", text: t(settings.inputKind === "builtin" ? "notes.input.builtin.body" : "notes.input.plugged.body") }),
    ]);
    const picker = this.inputPicker();
    if (picker) input.append(picker);

    // 2. Level
    const meter = element("div", { className: "listen-meter", attrs: { role: "meter", "aria-label": t("listen.level") } }, [this.meterFill]);
    if (!this.levelLine.textContent) this.levelLine.textContent = t("setup.level.waiting");
    const level = element("section", { className: "setup-step" }, [element("h3", { text: t("setup.level") }), meter, this.levelLine]);

    // 3. Noise, 4. Note, 5. Camera
    const noise = element("section", { className: "setup-step" }, [element("h3", { text: t("setup.noise") }), this.noiseLine]);
    const note = element("section", { className: "setup-step" }, [element("h3", { text: t("setup.note") }), this.noteLine]);
    const camera = element("section", { className: "setup-step" }, [element("h3", { text: t("setup.camera") }), this.cameraBox]);
    this.renderNoise();
    this.renderNote();
    this.updateCamera(true);

    this.card.append(element("div", { className: "setup-grid" }, [input, level, noise, note, camera]));

    const byEar = element("button", { className: "ghost", text: t("setup.skipCamera"), attrs: { type: "button" } });
    byEar.addEventListener("click", () => {
      void this.setOpen(false);
      this.actions?.practiseByEar();
    });
    const done = element("button", { className: "primary", text: t("setup.done"), attrs: { type: "button" } });
    done.addEventListener("click", () => void this.setOpen(false));
    this.card.append(element("div", { className: "row" }, [done, byEar]));
  }

  private inputPicker(): HTMLElement | null {
    if (this.inputs.length === 0) return null;
    const t = this.t();
    const chosen = loadInputChoice();
    const select = element("select", { attrs: { "aria-label": t("setup.device") } });
    select.append(element("option", { text: t("listen.input.default"), attrs: { value: "" } }));
    this.inputs.forEach((input, index) => {
      const option = element("option", { text: input.label || t("listen.input.unnamed", { index: index + 1 }), attrs: { value: input.deviceId } });
      if (input.deviceId === chosen) option.selected = true;
      select.append(option);
    });
    select.addEventListener("change", () => {
      saveInputChoice(select.value || null);
      this.peaks = [];
      void this.listen();
    });
    return element("label", { className: "listen-input" }, [element("span", { text: t("setup.device") }), select]);
  }

  private renderNoise() {
    const t = this.t();
    clear(this.noiseLine);
    if (this.noise) {
      this.noiseLine.append(t("setup.noise.measuring"));
      return;
    }
    const result = this.noiseResult;
    if (result) {
      this.noiseLine.append(
        element("span", {
          className: `setup-verdict verdict-${result.verdict === "quiet" ? "ok" : result.verdict === "fair" ? "wait" : "bad"}`,
          text: t(`setup.noise.${result.verdict}`, { db: Math.round(dbfs(result.rms)) }),
        }),
        " ",
      );
    }
    const measure = element("button", { className: "ghost", text: t("setup.noise.measure"), attrs: { type: "button" } });
    measure.addEventListener("click", () => {
      this.noise = { until: this.listener.nowMs() + NOISE_MS, readings: [] };
      this.renderNoise();
    });
    this.noiseLine.append(measure);
  }

  private renderNote() {
    const t = this.t();
    clear(this.noteLine);
    const heard = this.heard;
    if (heard === null) {
      this.noteLine.append(t("setup.note.ask"));
      return;
    }
    const verdict = noteTestVerdict(heard, NOTE_TEST_MIDI);
    this.noteLine.append(
      element("span", {
        className: `setup-verdict verdict-${verdict === "ok" ? "ok" : "bad"}`,
        text: t(`setup.note.${verdict}`, { note: this.nameOf(heard) }),
      }),
    );
    if (verdict === "off") {
      const tuner = element("button", { className: "link", text: t("setup.note.tuner"), attrs: { type: "button" } });
      tuner.addEventListener("click", () => {
        void this.setOpen(false);
        this.actions?.openTuner();
      });
      this.noteLine.append(" ", tuner);
    }
  }

  /** Rebuilt only when what it says changes, so its buttons stay clickable. */
  private cameraKey = "";
  private updateCamera(force = false) {
    const t = this.t();
    const status = this.actions?.camera() ?? { running: false, brightness: null, calibrated: false };
    const light = status.brightness === null ? null : lightVerdict(status.brightness);
    const key = `${status.running}:${light}:${status.calibrated}`;
    if (!force && key === this.cameraKey) return;
    this.cameraKey = key;
    clear(this.cameraBox);
    if (!status.running) {
      const start = element("button", { className: "ghost", text: t("setup.camera.start"), attrs: { type: "button" } });
      start.addEventListener("click", () => {
        void this.setOpen(false);
        this.actions?.startCamera();
      });
      this.cameraBox.append(element("p", { className: "quiet", text: t("setup.camera.off") }), start);
      return;
    }
    this.cameraBox.append(
      element("p", {
        className: `setup-verdict verdict-${light === "ok" ? "ok" : light === null ? "wait" : "bad"}`,
        text: t(light === null ? "setup.light.unknown" : `setup.light.${light}`),
      }),
      element("p", { className: `setup-verdict verdict-${status.calibrated ? "ok" : "bad"}`, text: t(status.calibrated ? "setup.neck.ok" : "setup.neck.missing") }),
    );
    if (!status.calibrated) {
      const mark = element("button", { className: "ghost", text: t("setup.neck.mark"), attrs: { type: "button" } });
      mark.addEventListener("click", () => {
        void this.setOpen(false);
        this.actions?.markNeck();
      });
      this.cameraBox.append(mark);
    }
  }
}
