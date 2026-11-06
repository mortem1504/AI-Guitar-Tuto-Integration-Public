/**
 * The dashboard (WF-03) and the onboarding survey, drawn into the start card.
 *
 * Dashboard: continue the last exercise, three recommended ones with the
 * reason for each, recent sessions, and the accuracy trend as bars (with the
 * same trend said in words, so it is never carried by a picture alone).
 * Survey: three questions, skippable, that only reorder the recommendations.
 */

import type { Translate, TranslationKey } from "../i18n";
import { exerciseById, exerciseTitleKey } from "../lesson/exercises";
import { GOALS, LEVELS, STYLES, type Profile } from "../lesson/profile";
import { accuracyTrend, continueWith, recommend } from "../lesson/recommend";
import type { SessionRecord } from "../lesson/sessionStore";
import type { SongSummary } from "./songOverview";
import { element } from "./dom";
import { segmented } from "./segmented";

export interface DashboardContext {
  t: Translate;
  records: readonly SessionRecord[];
  /** Null when the survey was skipped: the recommendations then follow a beginner's order. */
  profile: Profile | null;
  openExercise(id: string): void;
  openChords(): void;
  /** The imported songs; `openSong("")` opens the library. */
  songs: readonly SongSummary[];
  openSong(id: string): void;
  editProfile(): void;
}

const percent = (accuracy: number) => `${Math.round(accuracy * 100)}%`;
const titleOf = (t: Translate, id: string) => (exerciseById(id) ? t(exerciseTitleKey(id)) : id);

export function dashboardView(ctx: DashboardContext): HTMLElement[] {
  const { t, records, profile } = ctx;
  const nodes: HTMLElement[] = [];

  const last = continueWith(records);
  if (last && exerciseById(last.exerciseId)) {
    const button = element("button", { className: "lesson continue", attrs: { type: "button" } }, [
      element("div", { className: "grow" }, [
        element("div", { className: "title", text: t("home.continue", { title: titleOf(t, last.exerciseId) }) }),
        element("div", {
          className: "sub",
          text: records[0].attempted > 0 ? t("home.continue.last", { percent: Math.round(last.accuracy * 100) }) : t("home.continue.lastNone"),
        }),
      ]),
    ]);
    button.addEventListener("click", () => ctx.openExercise(last.exerciseId));
    nodes.push(button);
  }

  // Recommended: the top three not yet mastered, with the reason that put each there.
  const picks = recommend(profile, records).filter((r) => r.reason !== "mastered" && r.exerciseId !== last?.exerciseId).slice(0, 3);
  const list = element("div", { className: "lesson-list" });
  if (profile?.goal === "chords") {
    const chords = element("button", { className: "lesson", attrs: { type: "button" } }, [
      element("div", { className: "grow" }, [
        element("div", { className: "tag", text: t("home.reason.goal") }),
        element("div", { className: "title", text: t("home.chords") }),
      ]),
    ]);
    chords.addEventListener("click", () => ctx.openChords());
    list.append(chords);
  }
  for (const pick of picks) {
    const row = element("button", { className: "lesson", attrs: { type: "button" } }, [
      element("div", { className: "grow" }, [
        element("div", { className: "tag", text: t(`home.reason.${pick.reason}` as TranslationKey) }),
        element("div", { className: "title", text: titleOf(t, pick.exerciseId) }),
      ]),
    ]);
    if (pick.best !== null) row.append(element("div", { className: "score", text: t("notes.best", { percent: Math.round(pick.best * 100) }) }));
    row.addEventListener("click", () => ctx.openExercise(pick.exerciseId));
    list.append(row);
  }
  nodes.push(element("h3", { text: t("home.recommended") }), list);

  nodes.push(element("h3", { text: t("home.songs") }));
  const songs = element("div", { className: "lesson-list" });
  for (const song of ctx.songs.slice(0, 3)) {
    const row = element("button", { className: "lesson", attrs: { type: "button" } }, [
      element("div", { className: "grow" }, [element("div", { className: "title", text: song.title })]),
      element("div", { className: "score", text: t("songs.progress", { percent: song.percent }) }),
    ]);
    row.addEventListener("click", () => ctx.openSong(song.id));
    songs.append(row);
  }
  const library = element("button", { className: "link", text: ctx.songs.length ? t("songs.title") : t("home.songs.none"), attrs: { type: "button" } });
  library.addEventListener("click", () => ctx.openSong(""));
  nodes.push(songs, element("p", { className: "quiet" }, [library]));

  nodes.push(...trendView(t, records));

  nodes.push(element("h3", { text: t("home.recent") }));
  if (records.length === 0) {
    nodes.push(element("p", { className: "quiet", text: t("home.recent.none") }));
  } else {
    const dates = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: "short", day: "numeric" });
    const recent = element("ul", { className: "recent" });
    for (const record of records.slice(0, 5)) {
      const title = record.mistakesOnly ? t("notes.mistakesTitle", { title: titleOf(t, record.exerciseId) }) : titleOf(t, record.exerciseId);
      recent.append(
        element("li", {}, [
          element("span", { className: "at", text: dates.format(record.startedAt) }),
          element("span", { className: "grow", text: `${title} · ${t(record.mode === "loop" ? "notes.mode.loop" : "notes.mode.playThrough")}` }),
          element("b", { text: record.attempted > 0 ? percent(record.accuracy) : "—" }),
        ]),
      );
    }
    nodes.push(recent);
  }

  const change = element("button", { className: "link", text: t(profile ? "home.profile.change" : "survey.title"), attrs: { type: "button" } });
  change.addEventListener("click", () => ctx.editProfile());
  const line = element("p", { className: "quiet profile-line" });
  if (profile) {
    line.append(
      t("home.profile", {
        level: t(`survey.level.${profile.level}`),
        goal: t(`survey.goal.${profile.goal}`),
        style: t(`survey.style.${profile.style}`),
      }),
      " · ",
    );
  }
  line.append(change);
  nodes.push(line);
  return nodes;
}

/** Bars for the last sessions' accuracy, oldest on the left, and the same said in words. */
function trendView(t: Translate, records: readonly SessionRecord[]): HTMLElement[] {
  const trend = accuracyTrend(records);
  if (trend.points.length === 0) return [];
  const bars = element(
    "div",
    { className: "trend", attrs: { "aria-hidden": "true" } },
    trend.points.map((accuracy) => {
      const bar = element("span", { attrs: { title: percent(accuracy) } });
      bar.style.height = `${Math.max(4, Math.round(accuracy * 100))}%`;
      return bar;
    }),
  );
  const points = trend.change === null ? 0 : Math.round(trend.change * 100);
  const words =
    trend.change === null
      ? t("home.trend.few")
      : points >= 3
        ? t("home.trend.up", { points })
        : points <= -3
          ? t("home.trend.down", { points: -points })
          : t("home.trend.flat");
  return [element("h3", { text: t("home.trend", { count: trend.points.length }) }), bars, element("p", { className: "quiet", text: words })];
}

export interface SurveyContext {
  t: Translate;
  /** The answers so far (the current profile when changing them). */
  draft: Partial<Profile>;
  changed(): void;
  save(profile: Profile): void;
  skip(): void;
}

export function surveyView(ctx: SurveyContext): HTMLElement[] {
  const { t, draft } = ctx;
  const question = <K extends keyof Profile>(key: K, options: readonly Profile[K][]) =>
    segmented<Profile[K]>(
      t(`survey.${key}`),
      options.map((option) => [option, t(`survey.${key}.${option}` as TranslationKey)]),
      draft[key] ?? ("" as Profile[K]),
      (value) => {
        draft[key] = value;
        ctx.changed();
      },
    );
  const nodes: HTMLElement[] = [
    element("h3", { text: t("survey.title") }),
    element("p", { className: "quiet", text: t("survey.intro") }),
    element("div", { className: "survey" }, [question("level", LEVELS), question("goal", GOALS), question("style", STYLES)]),
  ];
  const save = element("button", { className: "primary", text: t("survey.save"), attrs: { type: "button" } });
  const complete = draft.level && draft.goal && draft.style ? { level: draft.level, goal: draft.goal, style: draft.style } : null;
  save.disabled = complete === null;
  save.addEventListener("click", () => complete && ctx.save(complete));
  const skip = element("button", { className: "ghost", text: t("survey.skip"), attrs: { type: "button" } });
  skip.addEventListener("click", () => ctx.skip());
  nodes.push(element("div", { className: "row" }, [save, skip]));
  return nodes;
}
