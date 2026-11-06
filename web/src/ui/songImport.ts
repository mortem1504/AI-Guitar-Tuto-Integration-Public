/**
 * Bringing a tab in: the import screen (paste, upload, drop) and the preview
 * where the player checks what was read and fixes the obvious things
 * (title, tuning, capo, tempo, track, section names) before it is taught.
 *
 * Files are read here, in the browser, and never sent anywhere. Every file is
 * untrusted: size-capped before reading, and parsed by readers that never
 * throw. alphaTab (Guitar Pro, MusicXML) loads only when such a file arrives.
 */

import type { Translate, TranslationKey } from "../i18n";
import { breakDown } from "../song/breakdown";
import type { TrackChoice } from "../song/importers/score";
import { importText, MAX_FILE_BYTES, type SongRecord } from "../song/library";
import { midiOfName, nameOfMidi, retune, STANDARD, type Song } from "../song/model";
import { ASSUMED_TEMPO } from "../song/plan";
import { parseTextTab } from "../song/textTab";
import { element } from "./dom";
import { songTab } from "./SongTab";

/** What was read, and the player's corrections to it, until "Teach me this song". */
export interface Draft {
  fileName: string;
  /** The chosen track as read, before corrections. */
  read: Song;
  tracks: TrackChoice[];
  track: number;
  songFor: ((track: number) => Song) | null;
  title: string;
  tuning: string[];
  capo: number;
  tempo: number | null;
  sectionNames: string[];
}

export function draftOf(read: Song, fileName: string, tracks: TrackChoice[] = [], track = -1, songFor: Draft["songFor"] = null): Draft {
  return { fileName, read, tracks, track, songFor, title: read.title, tuning: [...read.tuning], capo: read.capo, tempo: read.tempo, sectionNames: [] };
}

/** The song as it will be taught: the corrections applied, every pitch recomputed. */
export function draftSong(draft: Draft): Song {
  return retune({ ...draft.read, title: draft.title.trim().slice(0, 120) || draft.read.title, tempo: draft.tempo }, draft.tuning, draft.capo);
}

export type FileResult = { draft: Draft } | { record: SongRecord } | { error: TranslationKey; message?: string };

const SCORE = /\.(gp|gp3|gp4|gp5|gpx|musicxml|xml|mxl)$/i;
const TEXT = /\.(txt|tab|text)$/i;
const SONG_FILE = /\.json$/i;

/** A file the player chose or dropped, read on this device. */
export async function readSongFile(file: File, now: number): Promise<FileResult> {
  if (file.size > MAX_FILE_BYTES) return { error: "import.tooBig" };
  if (SONG_FILE.test(file.name)) {
    const record = importText(await file.text(), now);
    return record ? { record } : { error: "import.badSong" };
  }
  if (TEXT.test(file.name) || file.type === "text/plain") return draftResult(draftOf(parseTextTab(await file.text()), file.name));
  if (!SCORE.test(file.name)) return { error: "import.unsupported" };
  try {
    const { importScore } = await import("../song/importers/score");
    const score = await importScore(new Uint8Array(await file.arrayBuffer()), file.name);
    return draftResult(draftOf(score.song, file.name, score.tracks, score.track, score.songFor));
  } catch (error) {
    return { error: "import.failed", message: error instanceof Error ? error.message : String(error) };
  }
}

export function pastedDraft(text: string): FileResult {
  return draftResult(draftOf(parseTextTab(text.slice(0, MAX_FILE_BYTES)), ""));
}

function draftResult(draft: Draft): FileResult {
  // An unreadable score says why in its warnings; show the first, which is the reason.
  if (draft.read.events.length === 0) return draft.read.warnings[0] && draft.read.source !== "text" ? { error: "import.failed", message: draft.read.warnings[0] } : { error: "import.empty" };
  return { draft };
}

// --- The import screen ----------------------------------------------------------------

export interface ImportContext {
  t: Translate;
  busy: string;
  error: string;
  paste(text: string): void;
  file(file: File): void;
  back(): void;
}

export function importView(ctx: ImportContext): HTMLElement[] {
  const { t } = ctx;
  const box = element("textarea", { attrs: { rows: "10", spellcheck: "false", "aria-label": t("import.paste"), placeholder: t("import.paste") } });
  const read = element("button", { className: "primary", text: t("import.read"), attrs: { type: "button" } });
  read.addEventListener("click", () => box.value.trim() && ctx.paste(box.value));
  const input = element("input", { attrs: { type: "file", accept: ".txt,.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.json", hidden: "" } });
  input.addEventListener("change", () => input.files?.[0] && ctx.file(input.files[0]));
  const upload = element("button", { className: "ghost", text: t("import.file"), attrs: { type: "button" } });
  upload.addEventListener("click", () => input.click());
  const back = element("button", { className: "ghost", text: t("songs.back"), attrs: { type: "button" } });
  back.addEventListener("click", () => ctx.back());

  const zone = element("div", { className: "song-drop" }, [
    element("h2", { text: t("import.title") }),
    element("p", { text: t("import.intro") }),
    box,
    element("div", { className: "row" }, [read, upload, input]),
    element("p", { className: "quiet", text: t("import.drop") }),
  ]);
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("over");
    const file = event.dataTransfer?.files[0];
    if (file) ctx.file(file);
  });
  if (ctx.busy) zone.append(element("p", { className: "quiet", text: ctx.busy, attrs: { "aria-live": "polite" } }));
  if (ctx.error) zone.append(element("p", { className: "start-error", text: ctx.error, attrs: { role: "alert" } }));
  return [zone, element("div", { className: "row" }, [back])];
}

// --- The preview ---------------------------------------------------------------------

const TUNINGS: [TranslationKey, readonly string[]][] = [
  ["tuning.standard", STANDARD],
  ["tuning.dropD", ["D2", "A2", "D3", "G3", "B3", "E4"]],
  ["tuning.ebStandard", ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"]],
  ["tuning.dadgad", ["D2", "A2", "D3", "G3", "A3", "D4"]],
];

/** "E A D G B E", the way a tuning is said aloud. */
export const tuningText = (tuning: readonly string[]) => tuning.map((name) => nameOfMidi(midiOfName(name) ?? 0).replace(/-?\d+$/, "")).join(" ");

export interface PreviewContext {
  t: Translate;
  draft: Draft;
  error: string;
  /** Something that changes what is drawn (the track) was changed. */
  redraw(): void;
  teach(): void;
  cancel(): void;
}

export function previewView(ctx: PreviewContext): HTMLElement[] {
  const { t, draft } = ctx;
  const song = draftSong(draft);
  const breakdown = breakDown(song);
  const field = (label: string, control: HTMLElement, note?: string) =>
    element("label", { className: "song-field" }, [element("span", { text: label }), control, ...(note ? [element("small", { className: "quiet", text: note })] : [])]);

  const title = element("input", { attrs: { type: "text", maxlength: "120", value: draft.title } });
  title.addEventListener("input", () => (draft.title = title.value));

  const tuning = element("select");
  const current = draft.tuning.join(" ");
  const known = TUNINGS.some(([, names]) => names.join(" ") === current);
  if (!known) tuning.append(element("option", { text: t("preview.tuning.asRead", { tuning: tuningText(draft.tuning) }), attrs: { value: current } }));
  for (const [key, names] of TUNINGS) tuning.append(element("option", { text: t(key), attrs: { value: names.join(" ") } }));
  tuning.value = current;
  tuning.addEventListener("change", () => (draft.tuning = tuning.value.split(" ")));

  const capo = element("input", { attrs: { type: "number", min: "0", max: "12", step: "1", value: String(draft.capo) } });
  capo.addEventListener("change", () => {
    draft.capo = Math.min(12, Math.max(0, Math.round(Number(capo.value)) || 0));
    capo.value = String(draft.capo);
  });

  const tempo = element("input", { attrs: { type: "number", min: "20", max: "400", step: "1", value: draft.tempo === null ? "" : String(draft.tempo), placeholder: String(ASSUMED_TEMPO) } });
  tempo.addEventListener("change", () => {
    const value = Math.round(Number(tempo.value));
    draft.tempo = tempo.value.trim() && value >= 20 && value <= 400 ? value : null;
    tempo.value = draft.tempo === null ? "" : String(draft.tempo);
  });

  const nodes: HTMLElement[] = [element("h2", { text: t("preview.title") }), field(t("preview.name"), title)];
  if (draft.tracks.length > 1 && draft.songFor) {
    const track = element("select");
    for (const choice of draft.tracks) {
      const option = element("option", { text: t("preview.track.option", { name: choice.name || choice.instrument, notes: choice.notes }), attrs: { value: String(choice.index) } });
      if (!choice.guitar) option.disabled = true;
      track.append(option);
    }
    track.value = String(draft.track);
    track.addEventListener("change", () => {
      const read = draft.songFor!(Number(track.value));
      Object.assign(draft, draftOf(read, draft.fileName, draft.tracks, Number(track.value), draft.songFor), { title: draft.title });
      ctx.redraw();
    });
    nodes.push(field(t("preview.track"), track));
  }
  nodes.push(
    element("div", { className: "song-fields" }, [
      field(t("preview.tuning"), tuning),
      field(t("preview.capo"), capo),
      field(t("preview.tempo"), tempo, draft.tempo === null ? t("preview.tempo.none", { bpm: ASSUMED_TEMPO }) : undefined),
    ]),
    element("p", {
      className: "quiet",
      text: t("preview.counts", { sections: breakdown.song.sections.length, notes: song.events.length, chords: song.events.filter((e) => e.notes.length > 1).length }),
    }),
    songTab(song.events, song.events.map((e) => e.index)),
  );

  const names = element("div", { className: "song-fields" });
  breakdown.song.sections.forEach((section, s) => {
    const input = element("input", { attrs: { type: "text", maxlength: "40", value: draft.sectionNames[s] || section.name, "aria-label": section.name } });
    input.addEventListener("input", () => (draft.sectionNames[s] = input.value.trim() === section.name ? "" : input.value.trim()));
    names.append(input);
  });
  nodes.push(element("h3", { text: t("preview.sections") }), names, element("h3", { text: t("preview.warnings") }));
  nodes.push(
    song.warnings.length
      ? element("ul", { className: "song-warnings" }, song.warnings.map((w) => element("li", { text: w })))
      : element("p", { className: "quiet", text: t("preview.noWarnings") }),
  );
  if (ctx.error) nodes.push(element("p", { className: "start-warn", text: ctx.error, attrs: { role: "alert" } }));

  const teach = element("button", { className: "primary", text: t("preview.teach"), attrs: { type: "button" } });
  teach.addEventListener("click", () => ctx.teach());
  const cancel = element("button", { className: "ghost", text: t("preview.cancel"), attrs: { type: "button" } });
  cancel.addEventListener("click", () => ctx.cancel());
  nodes.push(element("p", { className: "quiet", text: t("songs.private") }), element("div", { className: "row" }, [teach, cancel]));
  return nodes;
}
