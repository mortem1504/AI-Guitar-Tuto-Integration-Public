/**
 * What a song lesson adds to the live note screen: the step's controls
 * (wait for me or play along, tempo, loop, Listen, restart, skip), and under
 * "Play this" the suggested finger, the technique's tip, the next positions,
 * and the step's tab with each played note's result.
 *
 * Built once per run and updated per frame only when the note changes, like
 * `NotesLive`. The session and the microphone stay `NotesPanel`'s.
 */

import type { PracticeMode } from "../app/settings";
import type { VisionReason } from "../fusion/visionHealth";
import type { Translate, TranslationKey } from "../i18n";
import { fretMove } from "../lesson/noteJudge";
import type { JudgedNote, NoteSession } from "../lesson/NoteSession";
import type { Breakdown } from "../song/breakdown";
import { guidanceAt, type Guidance } from "../song/guidance";
import { gradedNote, type StepExercise } from "../song/lesson";
import { MAX_PERCENT, MIN_PERCENT, STEP_PERCENT } from "../song/plan";
import { element } from "./dom";
import { diagramLegend, fretDiagram, type DiagramFeedback } from "./FretDiagram";
import { segmented } from "./segmented";
import { songTab } from "./SongTab";

/** A heard note's result stays on its dot this long before the diagram moves on: long enough to see, short of the next note at 60 BPM. */
const FLASH_MS = 700;

/** How the diagram and the camera dots are shown, from the settings. */
export interface GuideOptions {
  mirrored: boolean;
  numbers: boolean;
  /** Notes shown after the current one, 0-2. */
  ahead: number;
  camera: boolean;
}

/** What the camera overlay draws: the guidance, and a note the microphone just confirmed. */
export interface GuideOverlay {
  targets: Guidance["targets"];
  confirmed: { string: number; fret: number } | null;
}

export interface LessonContext {
  t: Translate;
  nameOf(midi: number): string;
  title: string;
  stepCount: string;
  mode(): PracticeMode;
  percent: number;
  bpm(percent: number): number;
  loop: boolean;
  /** The last run's result, while looping. */
  last: string;
  earOnly: boolean;
  listening(): boolean;
  guide(): GuideOptions;
  setMode(mode: PracticeMode): void;
  setPercent(percent: number): void;
  setLoop(loop: boolean): void;
  listen(): void;
  restart(): void;
  skipStep(): void;
}

export class SongLessonView {
  private diagram = element("div", { className: "fret-diagram-box" });
  private said = element("div", { className: "fret-guide-text", attrs: { "aria-live": "polite" } });
  private tip = element("div", { className: "song-tip" });
  private paused = element("span", { className: "chip guide-paused", text: "" });
  private timeline = element("div", { className: "song-timeline" });
  private key = "";
  private guidance: Guidance | null = null;
  private flash: { until: number; feedback: DiagramFeedback } | null = null;
  private judgedSeen = 0;
  private readonly listenOnlyColumns: Set<number>;

  constructor(
    private breakdown: Breakdown,
    private made: StepExercise,
    private ctx: LessonContext,
  ) {
    const events = breakdown.song.events;
    this.listenOnlyColumns = new Set(made.order.map((e, c) => (gradedNote(events[e]) ? -1 : c)).filter((c) => c >= 0));
  }

  head(): HTMLElement[] {
    const { t } = this.ctx;
    const ctx = this.ctx;
    const mode = segmented<PracticeMode>(
      t("lesson.mode"),
      [
        ["loop", t("lesson.mode.wait")],
        ["playThrough", t("lesson.mode.along")],
      ],
      ctx.mode(),
      (next) => ctx.setMode(next),
    );
    const value = element("span", { text: t("lesson.tempo.value", { percent: ctx.percent, bpm: ctx.bpm(ctx.percent) }) });
    const slider = element("input", {
      attrs: { type: "range", min: String(MIN_PERCENT), max: String(MAX_PERCENT), step: String(STEP_PERCENT), value: String(ctx.percent), "aria-label": t("lesson.tempo") },
    });
    slider.addEventListener("input", () => (value.textContent = t("lesson.tempo.value", { percent: Number(slider.value), bpm: ctx.bpm(Number(slider.value)) })));
    slider.addEventListener("change", () => ctx.setPercent(Number(slider.value)));
    const tempo = element("div", { className: "notes-option song-tempo" }, [element("span", { text: t("lesson.tempo") }), slider, value]);

    const loop = element("input", { attrs: { type: "checkbox" } });
    loop.checked = ctx.loop;
    loop.addEventListener("change", () => ctx.setLoop(loop.checked));
    const button = (key: TranslationKey, onClick: () => void) => {
      const node = element("button", { className: "ghost", text: t(key), attrs: { type: "button" } });
      node.addEventListener("click", onClick);
      return node;
    };
    const controls = element("div", { className: "row song-controls" }, [
      button(ctx.listening() ? "lesson.stopListening" : "lesson.listen", () => ctx.listen()),
      element("label", { className: "song-loop" }, [loop, element("span", { text: t("lesson.loop") })]),
      button("lesson.restart", () => ctx.restart()),
      button("lesson.skipStep", () => ctx.skipStep()),
    ]);
    const nodes: HTMLElement[] = [
      element("div", { className: "grow" }, [element("h2", { text: ctx.title }), element("div", { className: "sub quiet", text: ctx.stepCount })]),
      mode,
      tempo,
      controls,
    ];
    if (ctx.listening()) nodes.push(element("p", { className: "start-warn", text: t("lesson.listening"), attrs: { "aria-live": "polite" } }));
    if (ctx.last) nodes.push(element("p", { className: "song-result", text: t("lesson.last", { result: ctx.last }) }));
    return nodes;
  }

  /** Under "Play this": what the hand does, what comes next, and the step's tab. */
  extra(): HTMLElement[] {
    const { t } = this.ctx;
    const notes: HTMLElement[] = [];
    if (this.made.listenOnly > 0) notes.push(element("p", { className: "quiet", text: t("lesson.listenOnly", { count: this.made.listenOnly }) }));
    if (this.ctx.earOnly) notes.push(element("p", { className: "quiet", text: t("lesson.earOnly") }));
    this.paused.textContent = t("guide.paused");
    this.paused.hidden = true;
    return [element("div", { className: "fret-guide" }, [this.diagram, this.said, this.tip, diagramLegend(t), this.paused]), this.timeline, ...notes];
  }

  /** For the camera: the dots, and the note just confirmed by ear (the camera alone never confirms one). */
  overlay(): GuideOverlay | null {
    if (!this.guidance) return null;
    const flash = this.flash && performance.now() < this.flash.until ? this.flash.feedback : null;
    const confirmed = flash && (flash.state === "clean" || flash.state === "timing") ? flash.target : null;
    return { targets: this.guidance.targets, confirmed };
  }

  /** The result of a heard note, for the diagram: where it was asked for and, if wrong, where it was played. */
  private feedbackOf(judged: JudgedNote): DiagramFeedback {
    const target = this.made.exercise.steps[judged.index];
    const verdict = judged.verdict;
    let played: DiagramFeedback["played"] = null;
    if (verdict.state === "wrongNote" || verdict.state === "wrongSpot") {
      if (verdict.place) played = { string: verdict.place.string, fret: verdict.place.fret };
      else if (verdict.played !== null) {
        // Same string, as "slide back one fret" says; unnamed when it cannot be reached there.
        const move = fretMove(verdict.played, target);
        if (move !== null) played = { string: target.string, fret: target.fret - move };
      }
    }
    return { state: verdict.state, target: { string: target.string, fret: target.fret }, played };
  }

  frame(session: NoteSession, vision: VisionReason | null) {
    const now = performance.now();
    if (session.judged.length > this.judgedSeen) {
      this.judgedSeen = session.judged.length;
      this.flash = { until: now + FLASH_MS, feedback: this.feedbackOf(session.judged[session.judged.length - 1]) };
    }
    const flashing = this.flash !== null && now < this.flash.until;
    const options = this.ctx.guide();
    const key = `${session.current}:${session.judged.length}:${flashing}:${vision}:${JSON.stringify(options)}`;
    if (key === this.key) return;
    this.key = key;
    const { t, nameOf } = this.ctx;
    const { song } = this.breakdown;
    const k = session.current;
    const event = this.made.eventOf[k];
    const column = this.made.columnOf[k] ?? this.made.order.length;
    this.guidance = event !== undefined ? guidanceAt(this.breakdown, this.made.order, column, options.ahead, t) : null;
    const feedback = flashing ? this.flash!.feedback : null;
    if (this.guidance) {
      this.diagram.replaceChildren(fretDiagram(this.guidance, feedback, { t, mirrored: options.mirrored, numbers: options.numbers }));
      this.said.textContent = this.guidance.text;
      const note = song.events[event].notes[0];
      const technique = note.techniques.find((x) => x !== "palmMute") ?? note.techniques[0];
      this.tip.textContent = technique ? t(`tip.${technique}` as TranslationKey, { target: nameOf(note.midi + Math.round(note.bendSemitones ?? 0)) }) : "";
    } else {
      this.diagram.replaceChildren();
      this.said.textContent = this.tip.textContent = "";
    }
    // The camera's dots are off while it cannot be trusted: no calibration, or no hand for a second.
    this.paused.hidden = !(options.camera && vision !== null && vision !== "ok");
    // In wait-for-me a note can be judged many times; its last verdict is the one shown.
    const states = new Map<number, string>();
    for (const judged of session.judged) states.set(this.made.columnOf[judged.index], judged.verdict.state);
    for (const step of session.skippedSteps) states.delete(this.made.columnOf[step]);
    this.timeline.replaceChildren(songTab(song.events, this.made.order, { window: true, current: column, states, listenOnly: this.listenOnlyColumns }));
  }
}
