/**
 * Practice selection (WF-05): what to check, how to run it, and which
 * exercise, in the order the dashboard's rules recommend.
 *
 * Coaching: pitch only (by ear, even with the camera on), string and fret
 * (the camera too, when it can tell), or freestyle (no exercise: play, and see
 * what was heard and where). Mode: loop on mistake, or play through. Input:
 * built-in microphone or plugged in, which decides whether the count-in clicks.
 */

import type { Coaching, Settings } from "../app/settings";
import type { Translate, TranslationKey } from "../i18n";
import { exerciseById, exerciseSubtitleKey, exerciseTitleKey, type NoteExercise } from "../lesson/exercises";
import type { Profile } from "../lesson/profile";
import { recommend } from "../lesson/recommend";
import type { SessionRecord } from "../lesson/sessionStore";
import { element } from "./dom";
import { segmented } from "./segmented";

export interface ChooserContext {
  t: Translate;
  settings: Settings;
  history: readonly SessionRecord[];
  profile: Profile | null;
  cameraOn: boolean;
  testSource: string | null;
  /** A setting changed: save it and draw again. */
  changed(): void;
  play(exercise: NoteExercise): void;
  freestyle(): void;
  /** "My songs": bring your own tab. */
  songs(): void;
  close(): void;
}

export function chooserView(ctx: ChooserContext): HTMLElement[] {
  const { t, settings } = ctx;
  const nodes: HTMLElement[] = [element("h2", { text: t("notes.title") }), element("p", { text: t("notes.intro") })];
  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => {
    settings[key] = value;
    ctx.changed();
  };

  nodes.push(
    segmented<Coaching>(
      t("notes.coaching"),
      [
        ["pitch", t("notes.coaching.pitch")],
        ["place", t("notes.coaching.place")],
        ["free", t("notes.coaching.free")],
      ],
      settings.coaching,
      set("coaching"),
    ),
    element("p", { className: "quiet", text: coachingNote(t, settings.coaching, ctx.cameraOn) }),
  );
  if (settings.coaching !== "free") {
    nodes.push(
      segmented(
        t("notes.mode"),
        [
          ["loop", t("notes.mode.loop")],
          ["playThrough", t("notes.mode.playThrough")],
        ],
        settings.practiceMode,
        set("practiceMode"),
      ),
      element("p", { className: "quiet", text: t(settings.practiceMode === "loop" ? "notes.mode.loop.body" : "notes.mode.playThrough.body") }),
    );
  }
  nodes.push(
    segmented(
      t("notes.input"),
      [
        ["builtin", t("notes.input.builtin")],
        ["plugged", t("notes.input.plugged")],
      ],
      settings.inputKind,
      set("inputKind"),
    ),
    element("p", { className: "quiet", text: t(settings.inputKind === "builtin" ? "notes.input.builtin.body" : "notes.input.plugged.body") }),
  );
  if (ctx.testSource) nodes.push(element("p", { className: "start-warn", text: t("notes.testSource", { source: ctx.testSource }) }));

  const songs = element("button", { className: "lesson", attrs: { type: "button" } }, [
    element("div", { className: "grow" }, [element("div", { className: "title", text: t("songs.entry") }), element("div", { className: "sub", text: t("songs.entry.body") })]),
  ]);
  songs.addEventListener("click", () => ctx.songs());
  nodes.push(element("div", { className: "lesson-list" }, [songs]));

  if (settings.coaching === "free") {
    const go = element("button", { className: "primary", text: t("notes.free.start"), attrs: { type: "button" } });
    go.addEventListener("click", () => ctx.freestyle());
    nodes.push(element("div", { className: "row" }, [go]));
  } else {
    nodes.push(exerciseList(ctx));
  }

  const close = element("button", { className: "ghost", text: t("notes.close"), attrs: { type: "button" } });
  close.addEventListener("click", () => ctx.close());
  nodes.push(element("div", { className: "row" }, [close]));
  return nodes;
}

function coachingNote(t: Translate, coaching: Coaching, cameraOn: boolean): string {
  if (coaching === "pitch") return t("notes.coaching.pitch.body");
  if (coaching === "free") return t("notes.coaching.free.body");
  return t(cameraOn ? "notes.coaching.place.body" : "notes.coaching.place.noCamera");
}

/** The exercises, recommended first; the first one says why. */
function exerciseList(ctx: ChooserContext): HTMLElement {
  const { t } = ctx;
  const list = element("div", { className: "lesson-list" });
  recommend(ctx.profile, ctx.history).forEach((pick, rank) => {
    const exercise = exerciseById(pick.exerciseId);
    if (!exercise) return;
    const text = element("div", { className: "grow" }, [
      element("div", { className: "title", text: t(exerciseTitleKey(exercise.id)) }),
      element("div", {
        className: "sub",
        text: `${t(exerciseSubtitleKey(exercise.id))} · ${t("notes.meta", { notes: exercise.steps.length, tempo: exercise.tempo })}`,
      }),
    ]);
    if (rank === 0 && pick.reason !== "mastered") {
      text.prepend(element("div", { className: "tag", text: t(`home.reason.${pick.reason}` as TranslationKey) }));
    }
    const row = element("button", { className: "lesson", attrs: { type: "button" } }, [text]);
    if (pick.best !== null) {
      const label = pick.reason === "mastered" ? t("notes.mastered") : t("notes.best", { percent: Math.round(pick.best * 100) });
      row.append(element("div", { className: "score", text: label }));
    }
    row.addEventListener("click", () => ctx.play(exercise));
    list.append(row);
  });
  return list;
}
