/**
 * "Bring your own tab": the song library, import, overview and lessons,
 * inside the notes card. `NotesPanel` owns the card, the session and the
 * microphone; this decides what is shown when its view is "songs", and turns
 * a plan step into a run of the ordinary note lesson (`SongRun`).
 *
 * Progress is saved after every run, on this device only.
 */

import { ListenSynth } from "../audio/listenSynth";
import type { PracticeMode } from "../app/settings";
import type { Translate } from "../i18n";
import type { NoteExercise } from "../lesson/exercises";
import type { NoteSession } from "../lesson/NoteSession";
import { breakDown, type Breakdown } from "../song/breakdown";
import { exerciseFor, firstStepOf, listenMoments, recordRun, tempoFor, wasClean, type StepExercise } from "../song/lesson";
import { deleteSong, exportFileName, exportText, listSongs, newRecord, putSong, type SongRecord } from "../song/library";
import { STANDARD } from "../song/model";
import { bpmOf, teachingPlan, type Plan, type PlanStep } from "../song/plan";
import { element } from "./dom";
import type { VisionReason } from "../fusion/visionHealth";
import { SongLessonView, type GuideOptions, type GuideOverlay } from "./songLesson";
import { draftSong, importView, pastedDraft, previewView, readSongFile, type Draft, type FileResult } from "./songImport";
import { libraryView, overviewView, resultText, resultView, stepTitle } from "./songOverview";

/** A looped part starts again this long after a run, long enough to read the result. */
const LOOP_PAUSE_MS = 1800;

/** What `NotesPanel` needs from a song run, on top of the exercise. */
export interface SongRun {
  mode: PracticeMode;
  /** Alternate tuning or a capo: the fretboard model assumes standard tuning, so the camera is not asked where. */
  earOnly: boolean;
  /** Added to every fret for the overlay: tab frets are counted from the capo. */
  capo: number;
  head(): HTMLElement[];
  extra(): HTMLElement[];
  frame(session: NoteSession, vision: VisionReason | null): void;
  /** The fingers for the camera overlay, when there is a note to play. */
  overlay(): GuideOverlay | null;
  /** A bend's target heard where its picked note was due counts as the note. */
  accept(step: number, midi: number): number;
  /** The session ended; `completed` when every note was played or skipped. */
  finished(session: NoteSession, completed: boolean): void;
}

export interface SongHost {
  t(): Translate;
  nameOf(midi: number): string;
  /** The diagram and camera settings, read live. */
  guide(): GuideOptions;
  render(): void;
  play(exercise: NoteExercise, run: SongRun): void;
  /** Ends a run without its result counting (restart, skip, leaving). */
  abandon(): void;
  setMode(mode: PracticeMode): void;
  /** Stops grading what the microphone hears for this long (Listen is playing). */
  mute(ms: number): void;
  unmute(): void;
  back(): void;
  /** The library changed: the dashboard has something new to show. */
  changed(): void;
}

type Screen = "library" | "import" | "preview" | "overview" | "result" | "chords";

export class SongCoach {
  private screen: Screen = "library";
  private records: SongRecord[] = [];
  private record: SongRecord | null = null;
  private breakdown: Breakdown | null = null;
  private plan: Plan | null = null;
  private draft: Draft | null = null;
  private busy = "";
  private error = "";
  private confirmDelete = false;
  private synth = new ListenSynth();
  private listening = false;
  // The step being played.
  private step: PlanStep | null = null;
  private made: StepExercise | null = null;
  private mode: PracticeMode = "loop";
  private loop = false;
  private last = "";
  private result: { title: string; text: string; score: string } | null = null;
  private loopTimer = 0;

  constructor(private host: SongHost) {}

  /** Opens the library, or one song straight away. */
  async open(songId?: string) {
    this.records = await listSongs();
    const chosen = songId ? this.records.find((r) => r.id === songId) : undefined;
    if (chosen) return this.openRecord(chosen);
    this.go("library");
  }

  /** Leaving the card: nothing keeps playing. */
  close() {
    clearTimeout(this.loopTimer);
    this.stopListening();
  }

  view(): HTMLElement[] {
    const t = this.host.t();
    switch (this.screen) {
      case "library":
        return libraryView({
          t,
          songs: this.records.map((record) => {
            const breakdown = breakDown(record.song);
            return { record, chunks: breakdown.chunks.length, sections: breakdown.song.sections.length };
          }),
          open: (record) => this.openRecord(record),
          importTab: () => this.go("import"),
          back: () => this.host.back(),
        });
      case "import":
        return importView({ t, busy: this.busy, error: this.error, paste: (text) => this.took(pastedDraft(text)), file: (file) => void this.readFile(file), back: () => this.go("library") });
      case "preview":
        return previewView({ t, draft: this.draft!, error: this.error, redraw: () => this.host.render(), teach: () => void this.teach(), cancel: () => this.go("import") });
      case "overview":
        return overviewView({
          t,
          record: this.record!,
          breakdown: this.breakdown!,
          plan: this.plan!,
          listening: this.listening,
          confirmDelete: this.confirmDelete,
          error: this.error,
          start: (step) => this.startStep(step),
          section: (section) => this.startStep(firstStepOf(this.plan!, section)),
          listen: () => void this.listenTo(0, this.record!.song.events.length - 1),
          exportFile: () => this.exportFile(),
          remove: () => void this.remove(),
          back: () => void this.open(),
        });
      case "result":
        return resultView({
          t,
          ...this.result!,
          next: () => this.startStep(this.record!.progress.step),
          again: () => this.startStep(this.step!.index),
          back: () => this.go("overview"),
        });
      case "chords":
        return this.chordsView();
    }
  }

  private go(screen: Screen) {
    clearTimeout(this.loopTimer);
    this.stopListening();
    this.screen = screen;
    this.error = "";
    this.busy = "";
    this.confirmDelete = false;
    this.host.render();
  }

  // --- Import ------------------------------------------------------------------------

  private async readFile(file: File) {
    this.busy = this.host.t()("import.reading", { name: file.name.slice(0, 80) });
    this.error = "";
    this.host.render();
    this.took(await readSongFile(file, Date.now()));
  }

  private took(result: FileResult) {
    this.busy = "";
    if ("error" in result) {
      this.error = this.host.t()(result.error, { message: result.message ?? "" });
      this.host.render();
    } else if ("record" in result) {
      void this.keep(result.record).then(() => this.openRecord(result.record));
    } else {
      this.draft = result.draft;
      this.screen = "preview";
      this.error = "";
      this.host.render();
    }
  }

  private async teach() {
    const draft = this.draft!;
    const record = newRecord(draftSong(draft), draft.fileName, Date.now());
    record.sectionNames = [...draft.sectionNames];
    const kept = await this.keep(record);
    this.openRecord(record);
    if (!kept) {
      this.error = this.host.t()("preview.saveFailed");
      this.host.render();
    }
  }

  private async keep(record: SongRecord): Promise<boolean> {
    const ok = await putSong(record);
    if (ok) {
      this.records = [record, ...this.records.filter((r) => r.id !== record.id)];
      this.host.changed();
    }
    return ok;
  }

  // --- One song ----------------------------------------------------------------------

  private openRecord(record: SongRecord) {
    this.record = { ...record, openedAt: Date.now() };
    void putSong(this.record);
    this.breakdown = breakDown(record.song);
    this.plan = teachingPlan(this.breakdown);
    this.go("overview");
  }

  private exportFile() {
    const record = this.record!;
    const url = URL.createObjectURL(new Blob([exportText(record)], { type: "application/json" }));
    const link = element("a", { attrs: { href: url, download: exportFileName(record) } });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async remove() {
    if (!this.confirmDelete) {
      this.confirmDelete = true;
      return this.host.render();
    }
    await deleteSong(this.record!.id);
    this.records = this.records.filter((r) => r.id !== this.record!.id);
    this.record = null;
    this.host.changed();
    this.go("library");
  }

  // --- Listen ------------------------------------------------------------------------

  private async listenTo(from: number, to: number, made?: StepExercise) {
    if (this.listening) return this.stopListening();
    if (!ListenSynth.supported()) return;
    const step = this.step;
    const order = made?.order ?? Array.from({ length: to - from + 1 }, (_, k) => from + k);
    const beats = made?.beats ?? order.map((_, k) => k);
    const fromSong = !made && this.breakdown!.song.events[0]?.beat !== null;
    const events = this.breakdown!.song.events;
    const timing = fromSong ? { order, beats: order.map((i) => events[i].beat! - events[order[0]].beat!) } : { order, beats };
    const percent = made && step ? tempoFor(this.record!.progress, step).percent : 100;
    this.listening = true;
    const ms = await this.synth.play(listenMoments(events, timing, bpmOf(this.plan!, percent)), () => this.stopListening());
    if (made) this.host.mute(ms);
    this.host.render();
  }

  private stopListening() {
    if (!this.listening) return;
    this.listening = false;
    this.synth.stop();
    this.host.unmute();
    this.host.render();
  }

  // --- Lessons -----------------------------------------------------------------------

  /** Wait-for-me for finding the notes, play along once there is a tempo to reach. */
  private defaultMode(step: PlanStep): PracticeMode {
    return step.kind === "meet" || step.kind === "learn" ? "loop" : "playThrough";
  }

  private startStep(index: number, keepMode = false) {
    const plan = this.plan!;
    const step = plan.steps[Math.max(0, Math.min(index, plan.steps.length - 1))];
    if (!step) return;
    clearTimeout(this.loopTimer);
    if (!keepMode || this.step?.index !== step.index) {
      this.mode = this.defaultMode(step);
      this.last = "";
    }
    this.step = step;
    const percent = tempoFor(this.record!.progress, step).percent;
    this.made = exerciseFor(this.record!.id, this.breakdown!, plan, step, percent);
    if (this.made.exercise.steps.length === 0) {
      this.screen = "chords";
      return this.host.render();
    }
    this.host.play(this.made.exercise, this.runFor(step, this.made, percent));
  }

  private runFor(step: PlanStep, made: StepExercise, percent: number): SongRun {
    const t = this.host.t();
    const record = this.record!;
    const song = record.song;
    const view = new SongLessonView(this.breakdown!, made, {
      t,
      nameOf: (midi) => this.host.nameOf(midi),
      title: stepTitle(t, record, this.breakdown!, step),
      stepCount: t("step.count", { n: step.index + 1, total: this.plan!.steps.length }),
      mode: () => this.mode,
      percent,
      bpm: (p) => bpmOf(this.plan!, p),
      loop: this.loop,
      last: this.last,
      earOnly: song.capo > 0 || song.tuning.join() !== STANDARD.join(),
      listening: () => this.listening,
      guide: () => this.host.guide(),
      setMode: (mode) => {
        this.mode = mode;
        this.host.setMode(mode);
      },
      setPercent: (p) => {
        this.save({ ...record, progress: { ...this.record!.progress, step: step.index, tempo: { percent: p, clean: 0, failed: 0 } } });
        this.restart();
      },
      setLoop: (loop) => (this.loop = loop),
      listen: () => void this.listenTo(step.fromEvent, step.toEvent, made),
      restart: () => this.restart(),
      skipStep: () => {
        const next = Math.min(step.index + 1, this.plan!.steps.length - 1);
        this.save({ ...this.record!, progress: { ...this.record!.progress, step: next, tempo: null } });
        this.host.abandon();
        if (next > step.index) this.startStep(next);
        else this.go("overview");
      },
    });
    return {
      mode: this.mode,
      earOnly: song.capo > 0 || song.tuning.join() !== STANDARD.join(),
      capo: song.capo,
      head: () => view.head(),
      extra: () => view.extra(),
      frame: (session, vision) => view.frame(session, vision),
      overlay: () => view.overlay(),
      accept: (k, midi) => (midi === made.alsoAccept[k] ? made.exercise.steps[k].midi : midi),
      finished: (session, completed) => this.finished(step, made, session, completed),
    };
  }

  private restart() {
    this.stopListening();
    this.host.abandon();
    this.startStep(this.step!.index, true);
  }

  private save(record: SongRecord) {
    this.record = record;
    void putSong(record);
  }

  private finished(step: PlanStep, made: StepExercise, session: NoteSession, completed: boolean) {
    this.stopListening();
    const t = this.host.t();
    const title = stepTitle(t, this.record!, this.breakdown!, step);
    if (!completed) {
      this.result = { title, text: t("result.stopped"), score: "" };
      this.screen = "result";
      return;
    }
    const clean = wasClean(made, session.judged, session.skippedSteps);
    const { record, result } = recordRun(this.record!, this.plan!, step, session.mode === "playThrough", clean, completed);
    this.save(record);
    this.host.changed();
    const next = this.plan!.steps[record.progress.step];
    const text = resultText(t, result, next ? stepTitle(t, record, this.breakdown!, next) : "");
    const cleanNotes = new Set(session.judged.filter((j) => j.verdict.state === "clean").map((j) => j.index)).size;
    const score = t("result.score", { clean: cleanNotes, total: made.exercise.steps.length });
    this.result = { title, text, score };
    if (this.loop) {
      // Looping: the result for a moment, then straight back into the same part.
      this.last = `${text} ${score}`;
      this.loopTimer = window.setTimeout(() => this.startStep(step.index, true), LOOP_PAUSE_MS);
    }
    this.screen = "result";
  }

  private chordsView(): HTMLElement[] {
    const t = this.host.t();
    const step = this.step!;
    const made = this.made!;
    const button = (text: string, className: string, onClick: () => void) => {
      const node = element("button", { className, text, attrs: { type: "button" } });
      node.addEventListener("click", onClick);
      return node;
    };
    return [
      element("h2", { text: stepTitle(t, this.record!, this.breakdown!, step) }),
      element("p", { text: t("lesson.chordsOnly") }),
      element("div", { className: "row" }, [
        button(t(this.listening ? "lesson.stopListening" : "lesson.listen"), "primary", () => void this.listenTo(step.fromEvent, step.toEvent, made)),
        button(t("lesson.markDone"), "ghost", () => {
          const next = Math.min(step.index + 1, this.plan!.steps.length - 1);
          this.save({ ...this.record!, progress: { ...this.record!.progress, step: next, tempo: null } });
          if (next > step.index) this.startStep(next);
          else this.go("overview");
        }),
        button(t("result.back"), "ghost", () => this.go("overview")),
      ]),
    ];
  }
}
