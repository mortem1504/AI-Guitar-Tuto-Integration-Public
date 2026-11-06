/**
 * Where the class happens.
 *
 * One animation frame does four things, and this file is the only place that
 * knows about all of them:
 *
 *   1. Read the hands the camera sees.
 *   2. Put them on the fretboard.
 *   3. Judge them against the chord being taught, and let the lesson advance.
 *   4. Draw the result, on the neck and on the strip.
 *
 * Everything below the first line is delegated. App is a switchboard, not a
 * brain: the moment it starts deciding what a correct chord looks like, the
 * rules stop being checkable on their own.
 */

import { chordById, shapesFor, targetOf, type ChordShape, type ChordTarget } from "../guitar/chords";
import { FretReader, type NeckReading } from "../guitar/FretReader";
import { NeckTracker } from "../guitar/NeckTracker";
import { markingProblem } from "../guitar/corners";
import { Fretboard, type CornerKind, type Corners } from "../guitar/Fretboard";
import { fretCentre, GUITARS, halfWidthAt } from "../guitar/geometry";
import { firstProblem, judge, slackFor, type ChordJudgement, type Verdict } from "../guitar/judge";
import { fuse, TipHistory } from "../fusion/fuse";
import { VisionHealth } from "../fusion/visionHealth";
import { createTranslator, LOCALES, type Translate, type TranslationKey } from "../i18n";
import { lessonById, type Lesson } from "../lesson/curriculum";
import { loadProgress, recordResult, type Progress } from "../lesson/progress";
import { Session } from "../lesson/Session";
import { chordLayer } from "../render/chordLayer";
import { DIM, RIGHT, TARGET, WRONG } from "../render/palette";
import { Overlay } from "../render/Overlay";
import { Calibrator } from "../ui/Calibrator";
import { Coach, type CoachTone } from "../ui/Coach";
import { requireElement } from "../ui/dom";
import { Help } from "../ui/Help";
import { LessonList } from "../ui/LessonList";
import { ListenPanel } from "../ui/ListenPanel";
import { NotesPanel } from "../ui/NotesPanel";
import type { VisionLink } from "../fusion/visionLink";
import { SetupPanel } from "../ui/SetupPanel";
import { listSessions } from "../lesson/sessionStore";
import { listSongs } from "../song/library";
import { guidanceLayer } from "../render/guidanceLayer";
import { songSummaries } from "../ui/songOverview";
import { Brightness } from "../vision/brightness";
import { cameraProblem } from "../vision/cameraError";
import { Panel } from "../ui/Panel";
import { SongPanel } from "../ui/SongPanel";
import { StartScreen } from "../ui/StartScreen";
import { TunerPanel } from "../ui/TunerPanel";
import { HandTracker } from "../vision/HandTracker";
import { localVideo, VideoRun } from "./videoRun";
import type { Point } from "../vision/landmarks";
import type { HandReading } from "../vision/types";
import { NeckDetector } from "../vision/NeckDetector";
import { clearCalibration, loadCalibration, saveCalibration } from "./calibration";
import { loadSettings, responseFor, saveSettings, type SettingKey, type Settings } from "./settings";

/** A song loaded from a chart is a lesson too, just one nobody wrote down. */
const SONG_LESSON_ID = "song";

/** Lost this long (ms) and the hint suggests marking the neck again: past a few seconds the guitar has usually moved too far to be found where it was. */
const LOST_LONG_MS = 3000;

export class App {
  private settings: Settings = loadSettings();
  private t: Translate = createTranslator(this.settings.language);
  private progress: Progress = loadProgress();

  private stage = requireElement("stage");
  private video = requireElement<HTMLVideoElement>("video");
  /** `?debug`: the camera's frame rate goes to the console every 10 s, for the evaluation. */
  private readonly debug = new URLSearchParams(location.search).has("debug");
  /** `?debug&video=`: a recorded file instead of the camera, and its readings recorded (app/videoRun.ts). */
  private readonly videoFile = this.debug ? localVideo(new URLSearchParams(location.search)) : null;
  private readonly videoRun = this.videoFile ? new VideoRun(this.video) : null;
  private canvas = requireElement<HTMLCanvasElement>("canvas");

  private overlay = new Overlay(this.canvas);
  private tracker = new HandTracker(this.video, { maxHands: 2, videoFile: this.videoFile ?? undefined });
  private detector = new NeckDetector();
  private reader = new FretReader();
  private tracker2 = new NeckTracker();
  /** When the tracker last tried to take its reference frame. */
  private anchoredAt = 0;
  /** When the followed neck was lost (page clock), 0 while it is held. */
  private lostSince = 0;
  /** Where the fingertips were over the last few hundred ms, for placing notes. */
  private tips = new TipHistory();
  private health = new VisionHealth();

  private start = new StartScreen();
  private calibrator = new Calibrator();
  private coach = new Coach();
  private help = new Help(() => this.t);
  private lessons = new LessonList(
    () => this.progress,
    () => this.t,
  );
  private songs = new SongPanel(() => this.t);
  private tunerPanel = new TunerPanel(
    () => this.t,
    () => this.settings.language,
  );
  private listenPanel = new ListenPanel(
    () => this.t,
    () => this.settings.language,
  );
  private notesPanel = new NotesPanel(
    () => this.t,
    () => this.settings.language,
    () => this.settings,
    () => saveSettings(this.settings),
  );
  private setupPanel = new SetupPanel(
    () => this.t,
    () => this.settings.language,
    () => this.settings,
    () => saveSettings(this.settings),
  );
  private brightness = new Brightness();
  private fpsLoggedAt = 0;
  private panel: Panel;

  /** Null until the neck has been marked or found. */
  private fretboard: Fretboard | null = null;
  /** Null when nothing is being taught: no lesson, no free chord. */
  private session: Session | null = null;
  /** In free practice this is the chord being worked on. */
  private freeChord: ChordShape | null = null;
  /** Where in the library free practice has walked to. */
  private freeIndex = 0;

  private running = false;
  private searchingUntil = 0;
  /** Shown for a moment after a lesson ends. */
  private notice = "";
  private noticeUntil = 0;

  constructor() {
    this.panel = new Panel(
      this.settings,
      (key) => this.onSettingChanged(key),
      () => this.beginCalibration(),
    );

    this.restoreCalibration();

    this.start.whenStarted(() => void this.begin());
    this.start.whenListenAsked(() => void this.listenPanel.setOpen(true));
    this.start.whenNotesAsked(() => this.openNotes());
    this.start.whenHomeAsked({
      openExercise: (id) => this.openNotes(id),
      openSong: (id) => {
        if (this.running) this.start.hide();
        void this.notesPanel.setOpen(true, undefined, id);
      },
      openChords: () => {
        if (!this.running) return void this.begin();
        this.start.hide();
        this.lessons.setOpen(true);
      },
      setup: () => void this.setupPanel.setOpen(true),
    });
    this.setupPanel.connect({
      camera: () => ({ running: this.running, brightness: this.brightness.latest, calibrated: this.fretboard !== null }),
      startCamera: () => void this.begin(),
      markNeck: () => (this.running ? this.beginCalibration() : void this.begin()),
      openTuner: () => void this.tunerPanel.setOpen(true),
      practiseByEar: () => this.openNotes(),
    });
    this.notesPanel.whenSaved(() => void this.refreshHome());
    void this.refreshHome();

    // One microphone, one listener at a time: the tuner, the note listener,
    // the note exercises and the setup check each release it when another opens.
    const listeners = [this.tunerPanel, this.listenPanel, this.notesPanel, this.setupPanel];
    for (const owner of listeners) {
      owner.whenOpened(() => {
        for (const other of listeners) if (other !== owner) void other.setOpen(false);
      });
    }

    this.calibrator.whenDone((corners, farFret, at, nearFret) => this.acceptCorners(corners, farFret, at, nearFret));
    this.calibrator.whenClosed(() => this.stage.classList.remove("calibrating"));
    this.calibrator.whenAutoAsked(() => this.searchForNeck());

    this.lessons.whenChosen((lesson) => this.startLesson(lesson));
    this.lessons.whenFreeChosen(() => this.startFreePractice());
    this.lessons.whenNotesChosen(() => void this.notesPanel.setOpen(true));
    this.songs.whenLoaded((load) => this.startSong(load.chords));

    // The same button means "I cannot get this one today" inside a lesson and
    // "show me another" in free practice — one button, because to the student
    // it is the same gesture: move on.
    this.coach.whenSkipped(() => (this.session ? this.session.skip() : this.nextFreeChord()));
    this.coach.whenLeft(() => this.stopLesson());

    requireElement("calibrate-toggle").addEventListener("click", () => this.beginCalibration());
    this.canvas.addEventListener("click", (event) => this.onCanvasClick(event));

    this.applyResponse();
    this.renderInterface();
    window.addEventListener("resize", () => this.resize());
  }

  private renderInterface() {
    document.documentElement.lang = this.settings.language;
    requireElement("calibrate-toggle").textContent = this.t("calibrate.title");
    requireElement("lesson-toggle").textContent = this.t("lesson.toggle");
    requireElement("listen-toggle").textContent = this.t("listen.toggle");
    requireElement("notes-toggle").textContent = this.t("notes.toggle");
    requireElement("tuner-toggle").textContent = this.t("tuner.toggle");
    requireElement("song-toggle").textContent = this.t("song.toggle");
    requireElement("help-toggle").textContent = this.t("help.toggle");
    requireElement("panel-toggle").textContent = this.t("panel.toggle");
    requireElement("home-toggle").textContent = this.t("home.toggle");
    requireElement("setup-toggle").textContent = this.t("setup.toggle");

    this.start.render(this.t);
    this.panel.render(this.t);
    this.coach.render(this.t);
    this.calibrator.render(this.t);
    // The cards render themselves when opened, so only the open ones need
    // rebuilding — which is what makes switching language mid-session work.
    this.help.render();
    if (this.lessons.open) this.lessons.render();
    if (this.tunerPanel.open) this.tunerPanel.render();
    if (this.listenPanel.open) this.listenPanel.render();
    if (this.notesPanel.open) this.notesPanel.render();
    if (this.setupPanel.open) this.setupPanel.render();
  }

  /** The dashboard's sessions, newest first. */
  private async refreshHome() {
    this.start.setRecords(await listSessions(50));
    this.start.setSongs(songSummaries(await listSongs()));
  }

  /** Note exercises, from anywhere: over the class when the camera runs, the home card put away. */
  private openNotes(exerciseId?: string) {
    if (this.running) this.start.hide();
    void this.notesPanel.setOpen(true, exerciseId);
  }

  /** One slider, three places: the filter, the hysteresis, and the model rate. */
  private applyResponse() {
    const response = responseFor(this.settings.smoothness);
    this.tracker.setSmoothing(response.minCutoff, response.beta);
    this.tracker.setInferenceInterval(response.inferenceInterval);
    this.reader.setFramesNeeded(response.framesNeeded);
  }

  private onSettingChanged(key: SettingKey) {
    switch (key) {
      case "language":
        this.t = createTranslator(this.settings.language);
        this.renderInterface();
        break;
      case "smoothness":
        this.applyResponse();
        break;
      case "guitar":
        // A different instrument is a different neck: the stored corners
        // describe widths that are no longer true, so the class asks again.
        this.fretboard = null;
        clearCalibration();
        this.reader.reset();
        this.tracker2.forget();
        this.beginCalibration();
        break;
      default:
        break;
    }
    saveSettings(this.settings);
  }

  // --- The neck -----------------------------------------------------------

  private restoreCalibration() {
    const stored = loadCalibration();
    if (!stored || stored.guitar !== this.settings.guitar) return;
    this.fretboard = Fretboard.from(
      GUITARS[this.settings.guitar],
      stored.corners,
      stored.farFret,
      stored.cornersAt,
    );
  }

  private acceptCorners(corners: Corners, farFret: number, cornersAt: CornerKind, nearFret = 0) {
    const board = Fretboard.from(GUITARS[this.settings.guitar], corners, farFret, cornersAt, nearFret);
    if (!board) return;
    this.fretboard = board;
    this.reader.reset();
    // The board's own corners: at the nut, even when the near pair was marked
    // on a fret because the nut was off the picture (Fretboard.from).
    saveCalibration({ guitar: this.settings.guitar, corners: board.corners, farFret, cornersAt });

    // The marked position is also the reference the tracker registers against,
    // so it is taken now, from the frame the student was looking at.
    if (this.running) this.tracker2.anchor(this.video, board, GUITARS[this.settings.guitar]);
  }

  private beginCalibration() {
    this.panel.setOpen(false);
    if (this.calibrator.open) {
      this.calibrator.close();
      return;
    }
    // Starting over from scratch: the old neck is forgotten so a stale grid is
    // never left sitting on screen half-replaced by a new one.
    clearCalibration();
    this.fretboard = null;
    this.tracker2.forget();
    this.stage.classList.add("calibrating");
    this.calibrator.offerAuto(this.settings.autoDetect);
    this.calibrator.start(this.t);
    if (this.running && this.settings.autoDetect) this.searchForNeck();
  }

  /**
   * Gives the detector a second of frames to find the neck.
   *
   * A second rather than one frame because a hand crossing the strings, or a
   * moment of glare, ruins a single frame often enough to be the normal case;
   * the first frame that yields a confident answer wins, and the search stops.
   */
  private searchForNeck() {
    if (!this.running) return;
    this.searchingUntil = performance.now() + 1000;
    this.calibrator.setSearching(this.t);
  }

  private tickSearch(now: number) {
    if (now > this.searchingUntil) {
      this.searchingUntil = 0;
      this.calibrator.setNotFound(this.t);
      return;
    }
    const found = this.detector.detect(this.video);
    // Below about half confidence the quad is usually a table edge or a door
    // frame, and offering it costs more trust than saying nothing.
    if (!found || found.confidence < 0.5) return;
    this.searchingUntil = 0;
    this.calibrator.setFound(found.corners, found.farFret, found.cornersAt, this.t);
  }

  private onCanvasClick(event: MouseEvent) {
    if (!this.calibrator.open) return;
    const rect = this.canvas.getBoundingClientRect();
    // Client pixels to canvas pixels to camera coordinates: the canvas is drawn
    // at device resolution and the video is cropped to cover, so both steps are
    // needed and neither is a no-op.
    const inCanvas: Point = {
      x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * this.canvas.height,
    };
    this.calibrator.addPoint(this.overlay.view.toCamera(inCanvas), this.t, this.video.videoWidth / this.video.videoHeight);
  }

  // --- Lessons ------------------------------------------------------------

  private startLesson(lesson: Lesson) {
    this.freeChord = null;
    this.session = new Session(lesson);
    this.reader.reset();
  }

  private startSong(chords: string[]) {
    this.startLesson({ id: SONG_LESSON_ID, kind: "changes", chords, rounds: 1, requires: null });
  }

  /**
   * Free practice: no sequence, no scoring, one chord held as long as you like.
   *
   * Reachable from the first minute, including chords the course has not
   * unlocked. The locking orders a course; it was never meant to withhold a C
   * from someone who wants to try one.
   */
  private startFreePractice() {
    this.session = null;
    this.freeIndex = 0;
    this.freeChord = this.freeLibrary()[0] ?? chordById("Em") ?? null;
    this.reader.reset();
  }

  /** Only shapes this guitar can reach: an acoustic runs out of neck sooner. */
  private freeLibrary(): ChordShape[] {
    return shapesFor(GUITARS[this.settings.guitar]);
  }

  private nextFreeChord() {
    const library = this.freeLibrary();
    if (library.length === 0) return;
    this.freeIndex = (this.freeIndex + 1) % library.length;
    this.freeChord = library[this.freeIndex];
  }

  private stopLesson() {
    this.session = null;
    this.freeChord = null;
    this.coach.hide();
  }

  private finishLesson(session: Session) {
    const state = session.state;
    this.showNotice(
      this.t("lesson.done.body", {
        correct: state.firstTryCount,
        total: state.total,
        streak: state.bestStreak,
      }),
    );
    // A song is a lesson while it is being played but never part of the course,
    // so it unlocks nothing and is not written down.
    if (lessonById(session.lesson.id)) {
      this.progress = recordResult(this.progress, session.lesson.id, state.firstTryCount, state.bestStreak);
    }
    this.stopLesson();
    this.lessons.setOpen(true);
  }

  private showNotice(text: string) {
    this.notice = text;
    this.noticeUntil = performance.now() + 6000;
  }

  // --- Running ------------------------------------------------------------

  private resize() {
    this.overlay.resize(this.video.videoWidth, this.video.videoHeight);
  }

  private async begin() {
    if (this.running) return;
    this.start.setStarting(true, this.t);
    this.start.showError("", this.t);
    try {
      await this.tracker.start();
    } catch (error) {
      this.start.setStarting(false, this.t);
      const problem = cameraProblem(error, window.isSecureContext, !!navigator.mediaDevices?.getUserMedia);
      console.warn("[camera] could not start:", error);
      this.start.showError(
        problem === "other"
          ? this.t("app.error.generic", { message: error instanceof Error ? error.message : String(error) })
          : this.t(`app.error.camera.${problem}`),
        this.t,
      );
      return;
    }

    this.start.hide();
    this.start.setRunning(true, this.t);
    this.resize();
    this.running = true;
    this.notesPanel.setVision(this.visionLink());

    // A neck remembered from before the marking was checked may be squeezed
    // into one fret (corners.ts, MIN_MARKED_RATIO); the frame's shape is only
    // known now, so it is checked here, and asked for again rather than drawn.
    const remembered = this.fretboard;
    if (remembered?.cornersAt === "edges" && markingProblem(remembered.corners, this.video.videoWidth / this.video.videoHeight)) {
      this.fretboard = null;
      clearCalibration();
    }

    // Nothing can be taught until the neck is known, so the class opens on it —
    // and, if asked to, tries to spare the student the four clicks entirely.
    if (!this.fretboard) this.beginCalibration();
    else this.lessons.setOpen(true);

    requestAnimationFrame((time) => this.frame(time));
  }

  /**
   * Registers the calibrated view against the current one, so the grid stays on
   * the guitar as it moves.
   *
   * A null answer means "not confident", not "gone": the previous position
   * stands. A guitar behind a hand for a second must not blank the lesson, and
   * a tracker that gives up loudly is worse than one that waits.
   */
  private followNeck(nowMs: number, hands: readonly HandReading[]) {
    const board = this.fretboard;
    if (!board || !this.settings.trackNeck || this.calibrator.open) return;

    const spec = GUITARS[this.settings.guitar];

    // A neck remembered from a previous session arrives before the camera
    // does: `restoreCalibration` runs in the constructor, where there is no
    // frame to take a reference from, so the tracker had no anchors and the
    // grid sat exactly where it was left, for the whole session. Anchoring
    // here — the first live frame in which a neck is known — is what makes a
    // remembered calibration follow the guitar at all. It also picks the
    // anchors back up if they are ever thrown away.
    if (!this.tracker2.ready) {
      if (nowMs - this.anchoredAt < 500) return;
      this.anchoredAt = nowMs;
      this.tracker2.anchor(this.video, board, spec, hands.map((hand) => hand.points), nowMs);
      return;
    }

    const corners = this.tracker2.track(this.video, nowMs, spec, board.farFret, hands.map((hand) => hand.points));
    if (!corners) return;

    const moved = Fretboard.from(spec, corners, board.farFret, board.cornersAt);
    if (moved) this.fretboard = moved;
  }

  /** How long the followed neck has been lost (ms), or 0 while it is held, not followed, or being marked. */
  private neckLostFor(time: number): number {
    if (!this.settings.trackNeck || this.calibrator.open || !this.fretboard || !this.tracker2.lost(time)) {
      this.lostSince = 0;
      return 0;
    }
    if (this.lostSince === 0) this.lostSince = time;
    return Math.max(1, time - this.lostSince);
  }

  private frame(time: number) {
    if (!this.running) return;
    requestAnimationFrame((next) => this.frame(next));

    const hands = this.tracker.read(time);
    if (this.setupPanel.open) this.brightness.sample(this.video, time);
    if (this.debug && time - this.fpsLoggedAt > 10_000) {
      this.fpsLoggedAt = time;
      console.info(`[camera] ${this.tracker.fps} fps, note session ${this.notesPanel.overlay ? "running (audio on)" : "off"}`);
    }
    if (this.searchingUntil > 0) this.tickSearch(time);
    this.followNeck(time, hands);
    // The tuner throttles its own analysis; this only has to keep asking.
    this.tunerPanel.tick(time);

    this.overlay.clear();

    // A neck the tracker has lost is not drawn, read or judged against: a grid
    // in the wrong place teaches the wrong fret, which is worse than no grid.
    const lostFor = this.neckLostFor(time);
    const board = lostFor > 0 ? null : this.fretboard;
    const target = this.currentTarget();

    let reading: NeckReading | null = null;
    if (board && hands.length > 0) {
      const fretting = this.reader.pick(hands, board, this.settings.handedness);
      if (fretting) reading = this.reader.read(fretting, board);
    }

    this.videoRun?.frame(reading, board);
    this.health.frame(time, reading?.fingers.some((finger) => finger.onBoard) ?? false, board !== null);
    if (reading) {
      this.tips.push({
        atMs: time,
        tips: reading.fingers.map((finger) => ({ finger: finger.finger, position: finger.position, onBoard: finger.onBoard })),
      });
    }

    const judgement = board && target ? judge(target, reading, this.settings.tolerance) : null;

    if (this.session && judgement) {
      const state = this.session.update(judgement, time, this.settings.holdSeconds);
      if (state.phase === "finished") this.finishLesson(this.session);
    }

    this.draw(board, target, judgement, hands, reading, time);
    if (lostFor > 0) this.overlay.drawHint(this.t(lostFor > LOST_LONG_MS ? "neck.lostLong" : "neck.lost"), 0.12);
    this.updateCoach(target, judgement);
    this.start.setStatus(this.statusLine(time, hands.length, judgement));
  }

  /**
   * What a note session asks of the camera: whether it can be trusted now
   * (VisionHealth's one-second rule), and where a note heard at a given
   * moment was played (`fuse`, against the fingertips nearest that moment).
   */
  private visionLink(): VisionLink {
    return {
      reason: (now) => this.health.reason(now),
      placeOf: (midi, at) => {
        const spec = GUITARS[this.settings.guitar];
        const fused = fuse(midi, this.tips.closest(at), {
          calibrated: this.fretboard !== null,
          // A little past where lessons go: beyond the far calibration fret the
          // homography is extrapolated, and less trustworthy the further it goes.
          maxFret: spec.maxTeachableFret + 3,
        });
        return { source: fused.source, string: fused.string, fret: fused.fret, confidence: fused.confidence };
      },
    };
  }

  /** The chord being asked for right now, whatever is asking for it. */
  private currentShape(): ChordShape | null {
    // A note exercise has the neck while it runs.
    if (this.notesPanel.overlay) return null;
    if (this.session && !this.session.finished) return chordById(this.session.state.chordId) ?? null;
    return this.freeChord;
  }

  private currentTarget(): ChordTarget | null {
    const shape = this.currentShape();
    return shape ? targetOf(shape) : null;
  }

  private draw(
    board: Fretboard | null,
    target: ChordTarget | null,
    judgement: ChordJudgement | null,
    hands: HandReading[],
    reading: NeckReading | null,
    time: number,
  ) {
    // While the neck is being marked the picture belongs to the marking. Fret
    // numbers and chord targets sit exactly where the corners have to be
    // clicked, and a student cannot click through a number they cannot see
    // past — so during calibration only the grid and the dots are drawn.
    const marking = this.calibrator.open;

    if (board && this.settings.showFretboard) {
      const spec = GUITARS[this.settings.guitar];
      const lastFret = spec.maxTeachableFret;
      this.overlay.drawFretboard(board.outline(lastFret), board.fretLines(lastFret), board.stringLines(lastFret));

      // The frets, numbered along the thick-E edge. Being told "it goes on the
      // second fret" is only useful to someone who can already count frets on
      // sight, and the whole point of this app is that they cannot yet.
      const numbers = [];
      if (!marking) {
        for (let fret = 1; fret <= lastFret; fret++) {
          const x = fretCentre(fret);
          numbers.push({
            at: board.toCamera({ x, y: halfWidthAt(spec, x) * 1.75 }),
            text: String(fret),
          });
        }
      }
      this.overlay.drawLabels(numbers);
    }

    if (this.settings.showSkeleton && !marking) this.overlay.drawHands(hands);

    let offPicture = 0;
    if (board && target && judgement && !marking) {
      const layer = chordLayer(board, target, judgement, {
        showNoteNames: this.settings.showNoteNames,
        notation: LOCALES[this.settings.language].notation,
      });
      // Arrows first: a marker drawn over an arrowhead reads as a target, and
      // an arrowhead drawn over a marker reads as clutter.
      for (const nudge of layer.nudges) this.overlay.drawNudge(nudge.from, nudge.to, nudge.colour);
      offPicture += this.overlay.drawMarkers(layer.markers);
    }

    if (board && !marking) offPicture += this.drawNotes(board, reading, time);
    // Those dots sit on the edge, pointing out; this says why.
    if (offPicture > 0) this.overlay.drawHint(this.t("overlay.offPicture"), 0.2);

    if (this.calibrator.open) this.overlay.drawCalibrationPoints(this.calibrator.marked);
  }

  /**
   * A note exercise on the neck: the note asked for (hollow, its fret
   * number), and where the last one the camera could place was played
   * (filled: green when it was the right note in the right spot).
   */
  /** Returns how many of its dots were off the picture. */
  private drawNotes(board: Fretboard, reading: NeckReading | null, time: number): number {
    const notes = this.notesPanel.overlay;
    if (!notes) return 0;
    if (notes.guide) {
      // A song lesson: its finger guidance, only while the camera can be trusted
      // (neck marked and followed, a hand seen within the last second). The
      // lesson card says "Camera guidance paused" the rest of the time.
      const trusted = this.health.reason(time) === "ok" && (this.tracker2.ready || !this.settings.trackNeck);
      if (!this.settings.cameraGuidance || !trusted) return 0;
      const layer = guidanceLayer(board, { ...notes.guide, numbers: this.settings.showFingerNumbers }, reading, slackFor(this.settings.tolerance), this.t);
      if (layer.nudge) this.overlay.drawNudge(layer.nudge.from, layer.nudge.to, layer.nudge.colour);
      const off = this.overlay.drawMarkers(layer.markers);
      this.overlay.drawHint(layer.message, 0.12);
      return off;
    }
    const markers = [];
    const last = notes.last;
    if (last?.place) {
      const right = last.state === "clean" || last.state === "timing";
      markers.push({
        at: board.pointFor(last.place.string, last.place.fret),
        colour: right ? RIGHT : last.state === "wrongNote" || last.state === "wrongSpot" ? WRONG : DIM,
        filled: true,
        radius: 11,
      });
    }
    if (notes.target) {
      markers.push({
        at: board.pointFor(notes.target.string, notes.target.fret),
        colour: TARGET,
        filled: false,
        label: String(notes.target.fret),
        along: notes.target.fret > 0 ? board.pointFor(notes.target.string, 12) : undefined,
      });
    }
    return this.overlay.drawMarkers(markers);
  }

  private updateCoach(target: ChordTarget | null, judgement: ChordJudgement | null) {
    // The coach lives at the bottom of the screen and so does the marking
    // card: both at once is two panels on top of each other, and the lesson
    // underneath is not the thing being done right now.
    if (this.calibrator.open || !target || !judgement) {
      this.coach.hide();
      return;
    }

    const state = this.session?.state;
    const verdicts = new Map<number, Verdict>();
    for (const entry of judgement.perFinger) verdicts.set(entry.placement.finger, entry.verdict);

    const meta: string[] = [];
    if (state) {
      meta.push(this.t("lesson.progress", { done: Math.min(state.index + 1, state.total), total: state.total }));
      if (state.streak > 1) meta.push(this.t("lesson.streak", { count: state.streak }));
    }

    this.coach.show({
      shape: target.shape,
      title: this.t("chord.play", { name: target.shape.name }),
      line: this.adviceFor(target, judgement),
      tone: this.toneFor(judgement),
      hold: state?.hold ?? (judgement.complete ? 1 : 0),
      meta,
      verdicts,
    });
  }

  private toneFor(judgement: ChordJudgement): CoachTone {
    if (judgement.complete) return "right";
    return judgement.perFinger.some((entry) => entry.verdict === "wrongFret" || entry.verdict === "wrongString")
      ? "wrong"
      : "neutral";
  }

  /**
   * The one sentence worth saying.
   *
   * A barre gets its own line because "index: wrong fret" is a useless thing to
   * tell someone whose whole problem is that a barre is one finger doing six
   * jobs; naming it as a barre is what makes the instruction match the hand.
   */
  private adviceFor(target: ChordTarget, judgement: ChordJudgement): string {
    if (judgement.complete) return this.t("judge.allGood");

    const problem = firstProblem(judgement);
    if (!problem) return this.t("judge.allGood");

    const { placement, verdict } = problem;
    if (placement.underBarre && target.barre) {
      return this.t("chord.barre", { fret: target.barre.fret });
    }

    const finger = this.t(`finger.${placement.finger}` as TranslationKey);
    const stringName = this.t(`string.${placement.string}` as TranslationKey);
    switch (verdict) {
      case "missing":
        return this.t("judge.missing", { finger, fret: placement.fret, string: stringName });
      case "wrongFret":
        return this.t("judge.wrongFret", { finger, fret: placement.fret });
      case "wrongString":
        return this.t("judge.wrongString", { finger, string: stringName });
      default:
        return this.t("judge.correct", { finger });
    }
  }

  private statusLine(now: number, handCount: number, judgement: ChordJudgement | null): string {
    if (now < this.noticeUntil) return this.notice;
    if (this.searchingUntil > 0) return this.t("status.searching");
    if (!this.fretboard) return this.t("status.calibrate");
    if (handCount === 0) return this.t("status.noHand");
    if (judgement?.complete) return this.t("status.good");
    const shape = this.currentShape();
    return this.t("status.ready", { fps: this.tracker.fps, name: shape?.name ?? "—" });
  }
}
