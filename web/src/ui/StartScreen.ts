/**
 * The card that stands between a cold page and a running camera, and the
 * home screen after it.
 *
 * It says what the app is, what it needs, and — when the browser or the device
 * is a poor fit — says so honestly without taking the button away. Nobody is
 * blocked from trying; they are just not surprised when it stutters.
 *
 * Below that, the first visit asks the three survey questions (skippable), and
 * every visit after shows the dashboard (`dashboard.ts`). With the camera
 * running, the "home" button brings this back over the class, and the main
 * button returns to it.
 */

import type { Translate } from "../i18n";
import { loadProfile, saveProfile, skipSurvey, surveySkipped, type Profile } from "../lesson/profile";
import type { SessionRecord } from "../lesson/sessionStore";
import { dashboardView, surveyView } from "./dashboard";
import { element, clear, requireElement } from "./dom";
import { environmentHint } from "./environment";
import type { SongSummary } from "./songOverview";

export interface HomeActions {
  openExercise(id: string): void;
  openChords(): void;
  openSong(id: string): void;
  setup(): void;
}

export class StartScreen {
  private root = requireElement("start");
  private card = requireElement("start-card");
  private status = requireElement("status");
  private toggle = requireElement<HTMLButtonElement>("home-toggle");
  private startHandler: (() => void) | null = null;
  private listenHandler: (() => void) | null = null;
  private notesHandler: (() => void) | null = null;
  private actions: HomeActions | null = null;
  private starting = false;
  private running = false;
  private error = "";
  private records: readonly SessionRecord[] = [];
  private songs: readonly SongSummary[] = [];
  private profile: Profile | null = loadProfile();
  /** The survey's answers while it is open; null when it is not. */
  private draft: Partial<Profile> | null = null;
  private t: Translate | null = null;

  constructor() {
    this.toggle.addEventListener("click", () => (this.open ? this.hide() : this.show()));
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root && this.running) this.hide();
    });
  }

  whenStarted(handler: () => void) {
    this.startHandler = handler;
  }

  /** Note detection needs no camera, so it can be tried before (or without) one. */
  whenListenAsked(handler: () => void) {
    this.listenHandler = handler;
  }

  /** The single-note exercises are audio-only too: Release 1's safety net. */
  whenNotesAsked(handler: () => void) {
    this.notesHandler = handler;
  }

  whenHomeAsked(actions: HomeActions) {
    this.actions = actions;
  }

  get open(): boolean {
    return !this.root.classList.contains("gone");
  }

  /** The song library, opened most recently first. */
  setSongs(songs: readonly SongSummary[]) {
    this.songs = songs;
    if (this.t) this.render(this.t);
  }

  /** Newest first, from IndexedDB. */
  setRecords(records: readonly SessionRecord[]) {
    this.records = records;
    if (this.t) this.render(this.t);
  }

  render(t: Translate) {
    this.t = t;
    clear(this.card);
    this.card.classList.add("wide");
    const hint = environmentHint();

    this.card.append(element("h2", { className: "start-title", text: t("app.title") }));
    if (!this.running) {
      this.card.append(
        element("p", { className: "start-lead", text: t("app.tagline") }),
        element("p", { className: "start-note", text: t("app.privacy") }),
      );
      if (hint) this.card.append(element("p", { className: "start-warn", text: t(`app.hint.${hint}`) }));
    }

    const button = element("button", {
      className: "primary",
      text: this.running ? t("home.back") : this.starting ? t("app.starting") : t("app.start"),
      attrs: { type: "button" },
    });
    button.disabled = this.starting;
    button.addEventListener("click", () => (this.running ? this.hide() : this.startHandler?.()));

    const notes = element("button", { className: "ghost", text: this.running ? t("notes.title") : t("notes.start"), attrs: { type: "button" } });
    notes.addEventListener("click", () => this.notesHandler?.());
    const setup = element("button", { className: "ghost", text: t("home.setup"), attrs: { type: "button" } });
    setup.addEventListener("click", () => this.actions?.setup());
    const row = element("div", { className: "row" }, [button, notes, setup]);
    if (!this.running) {
      const listen = element("button", { className: "ghost", text: t("app.listenOnly"), attrs: { type: "button" } });
      listen.addEventListener("click", () => this.listenHandler?.());
      row.append(listen);
    }
    this.card.append(row);

    if (this.error) {
      this.card.append(element("p", { className: "start-error", text: this.error }));
    }

    if (this.draft === null && !this.profile && !surveySkipped()) this.draft = {};
    if (this.draft !== null) this.card.append(...this.survey(t, this.draft));
    else this.card.append(...this.dashboard(t));
  }

  private survey(t: Translate, draft: Partial<Profile>): HTMLElement[] {
    return surveyView({
      t,
      draft,
      changed: () => this.render(t),
      save: (profile) => {
        saveProfile(profile);
        this.profile = profile;
        this.draft = null;
        this.render(t);
      },
      skip: () => {
        skipSurvey();
        this.draft = null;
        this.render(t);
      },
    });
  }

  private dashboard(t: Translate): HTMLElement[] {
    return dashboardView({
      t,
      records: this.records,
      profile: this.profile,
      openExercise: (id) => this.actions?.openExercise(id),
      openChords: () => this.actions?.openChords(),
      songs: this.songs,
      openSong: (id) => this.actions?.openSong(id),
      editProfile: () => {
        this.draft = { ...this.profile };
        this.render(t);
      },
    });
  }

  setStarting(starting: boolean, t: Translate) {
    this.starting = starting;
    this.render(t);
  }

  /** The camera is on: the card becomes the home screen, shown on request. */
  setRunning(running: boolean, t: Translate) {
    this.running = running;
    this.toggle.classList.toggle("gone", !running);
    this.render(t);
  }

  showError(message: string, t: Translate) {
    this.error = message;
    this.render(t);
  }

  show() {
    this.root.classList.remove("gone");
    this.toggle.setAttribute("aria-pressed", "true");
  }

  hide() {
    this.root.classList.add("gone");
    this.toggle.setAttribute("aria-pressed", "false");
  }

  setStatus(text: string) {
    if (this.status.textContent !== text) this.status.textContent = text;
  }
}
