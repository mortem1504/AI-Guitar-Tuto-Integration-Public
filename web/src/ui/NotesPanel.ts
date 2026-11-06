/**
 * Single-note exercises: choose one, play it, see how it went.
 *
 * Four views in one card. **Choose** (`notesChooser.ts`): coaching, mode,
 * input, and the exercises in recommended order. **Play** (the live screen):
 * the note to play now, where it is, a tab strip of what comes next, the
 * count-in, the feedback (icon, word, coaching line), the signal, and the
 * loop toggle. **Free**: no exercise, every note named with where it was
 * played. **Review** (`notesReview.ts`).
 *
 * Works without the camera (the audio-only safety net); with it, notes are
 * placed on the neck (`VisionLink`). The microphone is open only while playing,
 * and released on leaving, on close and when the tab is hidden. Finished
 * sessions go to IndexedDB, results only.
 *
 * Feedback latency is measured the way the brief asks: the worklet's onset to
 * the animation frame after the feedback is in the DOM. p50 and p95 are shown
 * in the review and stored with the session; `?debug` shows them live.
 */

import { LatencyStats, pluckToScreenMs } from "../audio/latency";
import { loadInputChoice } from "../audio/mic";
import { NoteListener, type Arrival } from "../audio/NoteListener";
import type { ListenEvent, NoteEvent } from "../audio/noteEvents";
import { PARAMS } from "../audio/params";
import { reconcileWithTarget } from "../audio/prior";
import { SignalQuality } from "../audio/signalQuality";
import { scriptedSource, synthSource } from "../audio/synthSource";
import type { PracticeMode, Settings } from "../app/settings";
import { SoakRun } from "../app/soak";
import { noteName, octaveOf } from "../guitar/tuning";
import { LOCALES, type Language, type Translate } from "../i18n";
import { demoPerformance } from "../lesson/demo";
import { exerciseById, exerciseTitleKey, NOTE_EXERCISES, type NoteExercise } from "../lesson/exercises";
import type { VisionReason } from "../fusion/visionHealth";
import type { PlacedNote, VisionLink } from "../fusion/visionLink";
import type { Attempt, NoteVerdict, Place } from "../lesson/noteJudge";
import { NoteSession, summarize, type SessionSummary } from "../lesson/NoteSession";
import { loadProfile } from "../lesson/profile";
import { listSessions, recordOf, saveSession, type SessionRecord } from "../lesson/sessionStore";
import { clear, element, requireElement } from "./dom";
import { feedbackText, type FeedbackText } from "./feedback";
import { chooserView } from "./notesChooser";
import { reviewView } from "./notesReview";
import { NotesLive, type FreeNote } from "./notesLive";
import { segmented } from "./segmented";
import { SongCoach, type SongRun } from "./SongCoach";
import type { GuideOverlay } from "./songLesson";

type View = "choose" | "play" | "free" | "review" | "songs";

/** After Listen ends, its last note is still ringing in the room for about this long: keep not listening. */
const MUTE_TAIL_MS = 400;

/** Freestyle keeps this many notes on screen: about one bar of quavers. */
const FREE_HISTORY = 8;

export class NotesPanel {
  private root = requireElement("notes");
  private card = requireElement("notes-card");
  private toggle = requireElement<HTMLButtonElement>("notes-toggle");
  private listener = new NoteListener();
  private latency = new LatencyStats(5000);
  private readonly debug: boolean;
  private readonly source: string | null;
  /** `?debug&source=soak`: the unattended 30-minute run (app/soak.ts). */
  private soak: SoakRun | null = null;

  private view: View = "choose";
  private exercise: NoteExercise | null = null;
  private session: NoteSession | null = null;
  private startedWall = 0;
  private feedback: { text: FeedbackText; state: string } | null = null;
  private priorFired = 0;
  private error = "";
  private history: SessionRecord[] = [];
  private summary: SessionSummary | null = null;
  private saved: SessionRecord | null = null;
  private frame = 0;
  private lastPeak = 0;
  private signal = new SignalQuality();
  /** Freestyle: the newest notes first. */
  private freeNotes: FreeNote[] = [];
  private live = new NotesLive(
    () => this.t(),
    (midi) => this.nameOf(midi),
  );
  private vision: VisionLink | null = null;
  /** The last verdict with a place, for the overlay. */
  private lastPlaced: PlacedNote | null = null;
  /** "Bring your own tab" (view "songs"), and the song step being played, if one is. */
  private songs: SongCoach;
  private run: SongRun | null = null;
  private mutedUntil = 0;
  private muteTimer = 0;

  private openedHandler: () => void = () => {};
  private savedHandler: () => void = () => {};

  constructor(
    private t: () => Translate,
    private language: () => Language,
    private settings: () => Settings,
    private saveSettings: () => void,
  ) {
    const query = new URLSearchParams(location.search);
    this.debug = query.has("debug");
    this.source = this.debug ? query.get("source") : null;
    if (this.source === "soak") this.soak = new SoakRun(Math.max(1, Number(query.get("minutes")) || 30));

    this.toggle.addEventListener("click", () => void this.setOpen(!this.open));
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root && this.view !== "play") void this.setOpen(false);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.view === "play") this.stop();
    });
    this.listener.onEvent((event, arrival) => this.onEvent(event, arrival));
    this.live.pauseButton.addEventListener("click", () => this.togglePause());
    this.songs = new SongCoach({
      t: () => this.t(),
      nameOf: (midi) => this.nameOf(midi),
      guide: () => {
        const settings = this.settings();
        return { mirrored: settings.handedness === "left", numbers: settings.showFingerNumbers, ahead: settings.nextNotes, camera: settings.cameraGuidance };
      },
      render: () => this.render(),
      play: (exercise, run) => void this.play(exercise, run),
      abandon: () => this.abandon(),
      setMode: (mode) => this.switchMode(mode),
      mute: (ms) => this.mute(ms),
      unmute: () => this.unmute(),
      back: () => {
        this.view = "choose";
        this.render();
      },
      changed: () => this.savedHandler(),
    });
  }

  get open(): boolean {
    return !this.root.classList.contains("gone");
  }

  /** The tuner and the note listener close when this opens: one microphone. */
  whenOpened(handler: () => void) {
    this.openedHandler = handler;
  }

  /** `songId`: open "my songs" instead ("" for the library, an id for that song). */
  async setOpen(open: boolean, exerciseId?: string, songId?: string) {
    if (!open) {
      this.songs.close();
      this.abandon();
      this.root.classList.add("gone");
      this.toggle.setAttribute("aria-pressed", "false");
      return;
    }
    this.openedHandler();
    this.root.classList.remove("gone");
    this.toggle.setAttribute("aria-pressed", "true");
    this.view = "choose";
    this.history = await listSessions(100);
    const chosen = exerciseId ? exerciseById(exerciseId) : undefined;
    if (songId !== undefined) await this.openSongs(songId);
    else if (chosen) await this.play(chosen);
    else this.render();
  }

  /** A session was stored: the dashboard has something new to show. */
  whenSaved(handler: () => void) {
    this.savedHandler = handler;
  }

  /** The camera is running: notes are placed on the neck, and the card moves aside. */
  setVision(link: VisionLink | null) {
    this.vision = link;
    this.root.classList.toggle("with-camera", link !== null);
  }

  /** What the overlay draws while playing: the note asked for, and where the last one was played. */
  get overlay(): { target: { string: number; fret: number } | null; last: PlacedNote | null; guide?: GuideOverlay & { capo: number } } | null {
    if (this.view === "free") return { target: null, last: this.lastPlaced };
    if (this.view !== "play" || !this.session) return null;
    const target = this.session.target;
    const capo = this.run?.capo ?? 0;
    const guide = this.run?.overlay();
    return { target: target && { string: target.string, fret: target.fret + capo }, last: this.lastPlaced, ...(guide ? { guide: { ...guide, capo } } : {}) };
  }

  private async openSongs(songId: string) {
    this.reset("songs");
    await this.songs.open(songId || undefined);
  }

  /** Ends a song run without a result: nothing is counted or stored. */
  private abandon() {
    this.session = null;
    this.run = null;
    this.unmute();
    this.leavePlay();
  }

  /** Listen is playing: what the microphone hears is not the player. The session waits, then counts in again. */
  private mute(ms: number) {
    const session = this.session;
    if (session && session.phase(this.listener.nowMs()) !== "paused") session.pause(this.listener.nowMs());
    this.mutedUntil = performance.now() + ms + MUTE_TAIL_MS;
    clearTimeout(this.muteTimer);
    this.muteTimer = window.setTimeout(() => this.unmute(), ms + MUTE_TAIL_MS);
    this.updateLive();
  }

  private unmute() {
    clearTimeout(this.muteTimer);
    if (this.mutedUntil === 0) return;
    this.mutedUntil = 0;
    const session = this.session;
    if (session && this.view === "play" && session.phase(this.listener.nowMs()) === "paused") {
      session.resume(this.listener.nowMs());
      this.scheduleClicks();
    }
    this.updateLive();
  }

  // --- Playing -----------------------------------------------------------------

  /** Opens the microphone (or the test source); false, with the error shown, when it cannot. */
  private async openMic(synthetic: ((context: AudioContext) => AudioNode) | undefined): Promise<boolean> {
    try {
      if (!NoteListener.supported()) throw new Error("unsupported");
      await this.listener.start(loadInputChoice(), synthetic);
      return true;
    } catch {
      this.error = this.t()(NoteListener.supported() ? "listen.denied" : "listen.unsupported");
      this.render();
      return false;
    }
  }

  private reset(view: View) {
    this.leavePlay();
    this.view = view;
    this.feedback = null;
    this.lastPlaced = null;
    this.priorFired = 0;
    this.error = "";
    this.latency.reset();
    this.signal.reset();
    this.live.reset();
  }

  private async play(exercise: NoteExercise, run?: SongRun) {
    this.reset("play");
    this.exercise = exercise;
    this.run = run ?? null;
    this.render();

    const mode = run?.mode ?? this.settings().practiceMode;
    const started = { ms: 0 };
    const scripted = scriptedSource(demoPerformance(exercise, mode), started);
    const synthetic =
      this.source === "exercise" || this.soak
        ? (context: AudioContext) => {
            const from = performance.now();
            const node = scripted(context);
            this.soak?.exclude(from, performance.now());
            return node;
          }
        : this.source === "synth"
          ? synthSource
          : undefined;
    if (!(await this.openMic(synthetic))) return;
    if (this.view !== "play" || this.exercise !== exercise) return;

    const now = this.source === "exercise" || this.soak ? started.ms : this.listener.nowMs() + 100;
    this.session = new NoteSession(exercise, mode, now);
    this.startedWall = Date.now();
    this.scheduleClicks();
    this.render();
    this.loop();
  }

  /** The count-in clicks, when the input cannot hear them. */
  private scheduleClicks() {
    const session = this.session;
    if (!session || this.settings().inputKind !== "plugged" || this.source) return;
    session.countInTimes().forEach((at, k) => this.listener.click(at, k === 0));
  }

  /** Freestyle: no exercise, every note named and placed. */
  private async freestyle() {
    this.reset("free");
    this.freeNotes = [];
    this.render();
    if (!(await this.openMic(this.source ? synthSource : undefined))) return;
    if (this.view !== "free") return;
    const step = () => {
      if (this.view !== "free") return;
      this.live.signal(this.signal.state(this.listener.nowMs()));
      this.live.vision(this.visionReason());
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /** The loop toggle: the session carries on from the same note in the other mode. */
  private switchMode(mode: PracticeMode) {
    if (this.run) this.run.mode = mode;
    else {
      this.settings().practiceMode = mode;
      this.saveSettings();
    }
    if (this.session) {
      this.session.setMode(mode, this.listener.nowMs());
      this.scheduleClicks();
    }
    this.render();
  }

  private loop() {
    cancelAnimationFrame(this.frame);
    const step = () => {
      if (this.view !== "play" || !this.session) return;
      this.updateLive();
      if (this.session.finished) {
        void this.finish();
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private onEvent(event: ListenEvent, arrival: Arrival) {
    const now = arrival.contextTime * 1000;
    if (event.kind === "level") {
      this.lastPeak = event.peak;
      this.signal.add(now, event.peak);
      this.live.level(event.rms);
    }
    if (this.view === "free") {
      if (event.kind === "note") this.hearFree(event, arrival);
      return;
    }
    const session = this.session;
    if (!session || this.view !== "play" || performance.now() < this.mutedUntil) return;
    if (event.kind === "level") {
      for (const verdict of session.tick(now, event.peak, event.time * 1000)) this.show(verdict, null, arrival);
      return;
    }
    const attempt = this.attemptOf(event, session, arrival);
    const verdict = session.hear(attempt, now);
    if (verdict) this.show(verdict, event.kind === "note" ? event : null, arrival);
  }

  /**
   * The detector's answer as an attempt, after the exercise-aware prior: a
   * note exactly 12, 19 or 24 semitones from the target, heard with low
   * confidence, is judged as the target. Every firing is logged.
   */
  private attemptOf(event: Exclude<ListenEvent, { kind: "level" }>, session: NoteSession, arrival: Arrival): Attempt {
    if (event.kind === "unclear") return { kind: "unclear", onsetMs: event.onsetTime * 1000, rms: event.rms };
    let midi = event.midi;
    const target = session.target;
    if (target) {
      const reconciled = reconcileWithTarget(midi, event.confidence, target.midi, PARAMS);
      if (reconciled.fired) {
        this.priorFired++;
        console.info(`[prior] heard ${midi} (confidence ${event.confidence.toFixed(3)}), target ${target.midi}: judged as the target`);
        midi = reconciled.midi;
      }
      if (this.run) midi = this.run.accept(session.current, midi);
    }
    const place = this.settings().coaching === "pitch" || this.run?.earOnly ? undefined : this.placeOf(midi, event, arrival);
    return { kind: "note", midi, onsetMs: event.onsetTime * 1000, rms: event.rms, confidence: event.confidence, place };
  }

  /** Where the camera saw the note played, when it can say. */
  private placeOf(midi: number, event: NoteEvent, arrival: Arrival): Place | undefined {
    // The pluck on the page clock, where the hand readings live: the audio
    // clock's onset, moved by the two clocks' difference at arrival.
    const pluckPerfMs = arrival.perfMs - (arrival.contextTime - event.onsetTime) * 1000;
    const vision = this.vision;
    return vision && vision.reason(pluckPerfMs) === "ok" ? vision.placeOf(midi, pluckPerfMs) : undefined;
  }

  private hearFree(event: NoteEvent, arrival: Arrival) {
    const place = this.placeOf(event.midi, event, arrival);
    const placed = place?.source === "fused" && place.string !== null && place.fret !== null ? place : null;
    this.freeNotes = [{ midi: event.midi, place: placed }, ...this.freeNotes].slice(0, FREE_HISTORY);
    if (placed) this.lastPlaced = { state: "clean", place: { string: placed.string!, fret: placed.fret! } };
    this.live.free(this.freeNotes, this.error);
    requestAnimationFrame(() => {
      this.addLatency(pluckToScreenMs(event.onsetTime, arrival.contextTime, arrival.perfMs, performance.now()));
      if (this.debug) this.showDebug();
    });
  }

  private show(verdict: NoteVerdict, note: NoteEvent | null, arrival: Arrival) {
    this.feedback = { text: feedbackText(this.t(), verdict, (midi) => this.nameOf(midi)), state: verdict.state };
    if (verdict.place) this.lastPlaced = { state: verdict.state, place: verdict.place };
    this.live.feedback(this.feedback);
    this.updateLive();
    if (!note) return;
    // In the DOM now; on screen at the next frame.
    requestAnimationFrame(() => {
      this.addLatency(pluckToScreenMs(note.onsetTime, arrival.contextTime, arrival.perfMs, performance.now()));
      if (this.debug) this.showDebug();
    });
  }

  private togglePause() {
    const session = this.session;
    if (!session || session.finished) return;
    const now = this.listener.nowMs();
    if (session.phase(now) === "paused") {
      session.resume(now);
      this.scheduleClicks();
    } else {
      session.pause(now);
    }
    this.updateLive();
  }

  /** Ends the session; it is reviewed if anything was played. */
  private stop() {
    const session = this.session;
    if (this.view === "free" || !session) {
      this.leavePlay();
      this.view = "choose";
      this.render();
      return;
    }
    session.stop(this.listener.nowMs());
    void this.finish();
  }

  private async finish() {
    const session = this.session;
    const exercise = this.exercise;
    if (!session || !exercise) return;
    this.session = null;
    this.leavePlay();
    const run = this.run;
    if (run) {
      // A song's progress is the song library's; the note-session history stays the exercises'.
      this.run = null;
      this.unmute();
      this.view = "songs";
      run.finished(session, session.current >= session.steps.length);
      this.render();
      return;
    }
    const summary = summarize(session);
    this.summary = summary;
    this.saved = null;
    if (this.soak) return this.nextSoak(summary, exercise);
    if (summary.attempted + summary.notCaught + summary.weakSignal > 0) {
      const stats = this.latency;
      const latency = stats.count > 0 ? { p50: stats.percentile(50), p95: stats.percentile(95), count: stats.count } : null;
      const record = recordOf(summary, {
        exerciseId: exercise.id,
        mode: session.mode,
        tempo: exercise.tempo,
        steps: exercise.steps.length,
        startedAt: this.startedWall,
        latency,
      });
      console.info(
        `[session] ${exercise.id} ${session.mode}: ${summary.clean}/${summary.attempted} clean, ` +
          `latency p50 ${latency?.p50.toFixed(0) ?? "—"} ms p95 ${latency?.p95.toFixed(0) ?? "—"} ms (n=${latency?.count ?? 0}), prior fired ${this.priorFired}`,
      );
      this.saved = record;
      if (await saveSession(record)) {
        this.history = [record, ...this.history];
        this.savedHandler();
      }
    }
    this.view = "review";
    this.render();
  }

  private addLatency(ms: number) {
    this.latency.add(ms);
    this.soak?.addLatency(ms);
  }

  /** The soak run: the next exercise, in the other mode, until the time is up. Nothing is stored. */
  private nextSoak(summary: SessionSummary, exercise: NoteExercise) {
    const soak = this.soak!;
    soak.sessionDone(summary);
    this.summary = summary;
    this.saved = null;
    this.view = "review";
    this.render();
    if (soak.done) return;
    const settings = this.settings();
    settings.practiceMode = settings.practiceMode === "loop" ? "playThrough" : "loop";
    const next = NOTE_EXERCISES[(NOTE_EXERCISES.findIndex((e) => e.id === exercise.id) + 1) % NOTE_EXERCISES.length];
    setTimeout(() => void this.play(next), 1000);
  }

  private leavePlay() {
    cancelAnimationFrame(this.frame);
    this.listener.stop();
  }

  // --- Rendering -------------------------------------------------------------------

  private nameOf(midi: number): string {
    return `${noteName(midi, LOCALES[this.language()].notation)}${octaveOf(midi)}`;
  }

  private titleOf(exercise: NoteExercise): string {
    const t = this.t();
    const base = exercise.id.endsWith(".mistakes") ? exercise.id.slice(0, -".mistakes".length) : exercise.id;
    const title = t(exerciseTitleKey(base));
    return exercise.id === base ? title : t("notes.mistakesTitle", { title });
  }

  render() {
    clear(this.card);
    this.card.classList.toggle("wide", this.view !== "choose");
    // With the camera running, the play view docks out of the neck's way (main.css).
    this.root.dataset.view = this.view;
    if (this.view === "songs") this.card.append(...this.songs.view());
    else if (this.view === "choose") this.renderChoose();
    else if (this.view === "play") this.renderPlay();
    else if (this.view === "free") this.renderFree();
    else this.renderReview();
  }

  private renderChoose() {
    this.card.append(
      ...chooserView({
        t: this.t(),
        settings: this.settings(),
        history: this.history,
        profile: loadProfile(),
        cameraOn: this.vision !== null,
        testSource: this.source,
        changed: () => {
          this.saveSettings();
          this.render();
        },
        play: (exercise) => void this.play(exercise),
        freestyle: () => void this.freestyle(),
        songs: () => void this.openSongs(""),
        close: () => void this.setOpen(false),
      }),
    );
  }

  private renderPlay() {
    const t = this.t();
    const exercise = this.exercise!;
    const mode = this.session?.mode ?? this.run?.mode ?? this.settings().practiceMode;
    const run = this.run;
    const loopToggle = segmented<PracticeMode>(
      `${exercise.tempo} bpm`,
      [
        ["loop", t("notes.mode.loop")],
        ["playThrough", t("notes.mode.playThrough")],
      ],
      mode,
      (next) => this.switchMode(next),
    );
    const buttons: HTMLElement[] = [this.live.pauseButton];
    if (mode === "loop") {
      const skip = element("button", { className: "ghost", text: t("notes.skip"), attrs: { type: "button" } });
      skip.addEventListener("click", () => {
        this.session?.skip(this.listener.nowMs());
        this.updateLive();
      });
      buttons.push(skip);
    }
    buttons.push(this.stopButton());
    this.live.pauseButton.textContent = t("notes.pause");
    const head = run ? run.head() : [element("h2", { text: this.titleOf(exercise) }), loopToggle];
    this.card.append(...this.live.playView(head, this.error, buttons, this.debug, run?.extra()));
    this.live.feedback(this.feedback);
    this.updateLive();
  }

  private renderFree() {
    this.card.append(...this.live.freeView(this.error, [this.stopButton()], this.debug));
    this.live.free(this.freeNotes, this.error);
    this.live.vision(this.visionReason());
    this.live.signal(this.signal.state(this.listener.nowMs()));
  }

  private stopButton(): HTMLElement {
    const stop = element("button", { className: "ghost", text: this.t()("notes.stop"), attrs: { type: "button" } });
    stop.addEventListener("click", () => this.stop());
    return stop;
  }

  /** Per frame while playing. */
  private updateLive() {
    if (!this.exercise) return;
    const session = this.session;
    if (!session) return this.live.opening(this.error);
    this.live.vision(this.visionReason());
    this.live.signal(this.signal.state(this.listener.nowMs()));
    this.live.play(session, this.listener.nowMs());
    this.run?.frame(session, this.visionReason());
  }

  /** Null when no camera is in play (none running, or "pitch only" chosen). */
  private visionReason(): VisionReason | null {
    const vision = this.settings().coaching === "pitch" && this.view === "play" ? null : this.vision;
    return vision ? vision.reason(performance.now()) : null;
  }

  private showDebug() {
    const fmt = (ms: number) => (Number.isFinite(ms) ? `${Math.round(ms)}` : "—");
    this.live.debug(
      `pluck→feedback  last ${fmt(this.latency.last)} ms  p50 ${fmt(this.latency.percentile(50))}  p95 ${fmt(this.latency.percentile(95))}  (n=${this.latency.count})` +
        `\nprior fired ${this.priorFired}  peak ${this.lastPeak.toFixed(3)}  output latency ${this.listener.outputLatencyMs.toFixed(0)} ms`,
    );
  }

  private renderReview() {
    const summary = this.summary;
    const exercise = this.exercise;
    if (!summary || !exercise) return;
    this.card.append(
      ...reviewView({
        t: this.t(),
        summary,
        exercise,
        title: this.titleOf(exercise),
        latency: this.saved?.latency ?? null,
        nameOf: (midi) => this.nameOf(midi),
        practise: (mistakes) => {
          this.settings().practiceMode = "loop";
          this.saveSettings();
          void this.play(mistakes);
        },
        again: () => void this.play(exercise),
        back: () => {
          this.view = "choose";
          this.render();
        },
      }),
    );
  }
}
