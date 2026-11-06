/**
 * The songs a player has imported, with their progress, kept in IndexedDB on
 * this device. Nothing is uploaded; a song leaves only when the player
 * exports it as a file.
 *
 * Its own database (`guitar-coach-songs`), so the note sessions' store and
 * its version are left alone. What comes back out, from the database or from
 * an imported file, is hostile: `parseSongRecord` rebuilds every field,
 * clamps every number, recomputes every pitch from the tuning, and drops a
 * record it cannot rebuild rather than throwing. Pure apart from the last
 * section; `npm run song-check` exercises it.
 */

import { midiOfName, retune, TECHNIQUES, type RepeatHint, type SectionLabel, type Song, type TabEvent, type TabNote, type Technique } from "./model";
import { MAX_PERCENT, MIN_PERCENT, type TempoState } from "./plan";

const DB_NAME = "guitar-coach-songs";
const DB_VERSION = 1;
const STORE = "songs";
/** A library, not an archive: past this, the song opened longest ago goes. */
const KEEP = 200;
/** A long solo is a few thousand notes; this is far past any real tab, and keeps a hostile file small. */
const MAX_EVENTS = 20000;
/** What an imported song file may weigh. A 20 000-note song is about 3 MB of JSON. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const FILE_FORMAT = "ai-guitar-coach/song";
const FILE_VERSION = 1;

/** One chunk's history: enough for new / learning / clean / mastered. */
export interface ChunkProgress {
  runs: number;
  cleanRuns: number;
  /** The fastest tempo (% of the song's) of a clean run; 0 when there has been none. */
  bestPercent: number;
}

export interface SongProgress {
  /** The plan step to continue from. */
  step: number;
  /** Where the tempo stood in that step; null to start it fresh. */
  tempo: TempoState | null;
  /** By chunk index. */
  chunks: ChunkProgress[];
}

export interface SongRecord {
  id: string;
  /** Wall-clock ms. */
  savedAt: number;
  openedAt: number;
  /** The file it came from, or "" when pasted. */
  fileName: string;
  /** The song with the player's corrections (tuning, capo, tempo) applied. */
  song: Song;
  /** The player's names for the sections, by index; "" keeps the found one. */
  sectionNames: string[];
  progress: SongProgress;
}

/** Time plus a random tail: unique on one device, which is all a local library needs. */
const newId = (now: number) => `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function newRecord(song: Song, fileName: string, now: number): SongRecord {
  return {
    id: newId(now),
    savedAt: now,
    openedAt: now,
    fileName: fileName.slice(0, 120),
    song,
    sectionNames: [],
    progress: { step: 0, tempo: null, chunks: [] },
  };
}

// --- Reading hostile data back ------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const int = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
const real = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
/** Text kept as text: trimmed, cut to length, control characters out. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

/** In the model's own key order, so a song read back is the song stored. Pitch is filled in by `retune`. */
function parseNote(value: unknown): TabNote | null {
  if (!isObject(value)) return null;
  const string = int(value.string, 1, 6);
  const fret = int(value.fret, 0, 24);
  if (string === null || fret === null || !Array.isArray(value.techniques)) return null;
  const techniques = [...new Set(value.techniques.filter((t): t is Technique => TECHNIQUES.includes(t as Technique)))];
  const bend = real(value.bendSemitones, 0, 4);
  return { string, fret, midi: 0, techniques, ...(bend !== null && techniques.includes("bend") ? { bendSemitones: bend } : {}) };
}

function parseEvent(value: unknown, index: number): TabEvent | null {
  if (!isObject(value) || !Array.isArray(value.notes) || value.notes.length === 0 || value.notes.length > 6) return null;
  const notes = value.notes.map(parseNote);
  if (notes.some((n) => n === null) || new Set(notes.map((n) => n!.string)).size !== notes.length) return null;
  const beat = value.beat === null ? null : real(value.beat, 0, 1e6);
  const durationBeats = value.durationBeats === null ? null : real(value.durationBeats, 1e-3, 1e4);
  if ((value.beat !== null && beat === null) || (value.durationBeats !== null && durationBeats === null) || (beat === null) !== (durationBeats === null)) return null;
  const spacing = value.spacing === null || value.spacing === undefined ? null : int(value.spacing, 0, 1e5);
  return {
    index,
    notes: (notes as TabNote[]).sort((a, b) => a.string - b.string),
    beat,
    durationBeats,
    spacing,
    sourceLine: int(value.sourceLine, 1, 1e6) ?? 1,
    sourceColumn: int(value.sourceColumn, 0, 1e6) ?? 0,
  };
}

/** A stored or imported song, rebuilt; null when it is not one. Pitches are recomputed, never trusted. */
export function parseSong(value: unknown): Song | null {
  if (!isObject(value) || !Array.isArray(value.events) || value.events.length > MAX_EVENTS || !Array.isArray(value.tuning)) return null;
  const tuning = value.tuning.map((name) => (typeof name === "string" && /^[A-G][#b]?-?\d$/.test(name) ? name : null));
  // Open strings from a low B (35) to a high G (67): every guitar tuning in use, and nothing absurd.
  if (tuning.length !== 6 || tuning.some((name) => name === null || !(midiOfName(name)! >= 35 && midiOfName(name)! <= 67))) return null;
  const events: TabEvent[] = [];
  for (const raw of value.events) {
    const event = parseEvent(raw, events.length);
    if (!event) return null; // a song with a hole in it would teach the wrong thing
    events.push(event);
  }
  // Rhythm is all or nothing, and in order.
  const rhythmic = events.length > 0 && events[0].beat !== null;
  if (events.some((e, i) => (e.beat !== null) !== rhythmic || (i > 0 && rhythmic && e.beat! < events[i - 1].beat!))) return null;
  const capo = int(value.capo, 0, 12);
  const tempo = value.tempo === null ? null : int(value.tempo, 20, 400);
  if (capo === null || (value.tempo !== null && tempo === null)) return null;
  let timeSignature: [number, number] | null = null;
  if (Array.isArray(value.timeSignature)) {
    const top = int(value.timeSignature[0], 1, 32);
    const bottom = int(value.timeSignature[1], 1, 32);
    if (top !== null && bottom !== null && [1, 2, 4, 8, 16, 32].includes(bottom)) timeSignature = [top, bottom];
  }
  const labels: SectionLabel[] = [];
  for (const raw of Array.isArray(value.labels) ? value.labels.slice(0, 500) : []) {
    if (!isObject(raw)) continue;
    const name = text(raw.name, 40);
    const beforeEvent = int(raw.beforeEvent, 0, events.length - 1);
    if (name && beforeEvent !== null) labels.push({ name, beforeEvent, sourceLine: int(raw.sourceLine, 1, 1e6) ?? 1 });
  }
  const repeats: RepeatHint[] = [];
  for (const raw of Array.isArray(value.repeats) ? value.repeats.slice(0, 500) : []) {
    if (!isObject(raw)) continue;
    const fromEvent = int(raw.fromEvent, 0, events.length - 1);
    const toEvent = int(raw.toEvent, 0, events.length - 1);
    const times = int(raw.times, 2, 64);
    if (fromEvent !== null && toEvent !== null && times !== null && toEvent >= fromEvent) repeats.push({ fromEvent, toEvent, times, sourceLine: int(raw.sourceLine, 1, 1e6) ?? 1 });
  }
  const warnings = (Array.isArray(value.warnings) ? value.warnings.slice(0, 50) : []).map((w) => text(w, 300)).filter((w): w is string => !!w);
  const source = value.source === "text" || value.source === "guitarpro" || value.source === "musicxml" ? value.source : "text";
  const artist = text(value.artist, 120);
  const song: Song = {
    title: text(value.title, 120) || "Untitled",
    ...(artist ? { artist } : {}),
    tuning: tuning as string[],
    capo,
    tempo,
    timeSignature,
    events,
    sections: [], // always recomputed by the breakdown
    labels,
    repeats,
    warnings,
    source,
  };
  return retune(song, song.tuning, capo);
}

function parseProgress(value: unknown): SongProgress {
  const fresh: SongProgress = { step: 0, tempo: null, chunks: [] };
  if (!isObject(value)) return fresh;
  let tempo: TempoState | null = null;
  if (isObject(value.tempo)) {
    const percent = int(value.tempo.percent, MIN_PERCENT, MAX_PERCENT);
    const clean = int(value.tempo.clean, 0, 100);
    const failed = int(value.tempo.failed, 0, 100);
    if (percent !== null && clean !== null && failed !== null) tempo = { percent, clean, failed };
  }
  const chunks: ChunkProgress[] = [];
  for (const raw of Array.isArray(value.chunks) ? value.chunks.slice(0, MAX_EVENTS) : []) {
    const runs = isObject(raw) ? int(raw.runs, 0, 1e6) : null;
    const cleanRuns = isObject(raw) ? int(raw.cleanRuns, 0, 1e6) : null;
    const bestPercent = isObject(raw) ? int(raw.bestPercent, 0, MAX_PERCENT) : null;
    chunks.push(runs !== null && cleanRuns !== null && bestPercent !== null ? { runs, cleanRuns: Math.min(cleanRuns, runs), bestPercent } : { runs: 0, cleanRuns: 0, bestPercent: 0 });
  }
  return { step: int(value.step, 0, 1e6) ?? 0, tempo, chunks };
}

export function parseSongRecord(stored: unknown): SongRecord | null {
  if (!isObject(stored)) return null;
  const id = typeof stored.id === "string" && /^[a-z0-9-]{1,40}$/.test(stored.id) ? stored.id : null;
  const savedAt = int(stored.savedAt, 0, 1e14);
  const song = parseSong(stored.song);
  if (!id || savedAt === null || !song) return null;
  const sectionNames = (Array.isArray(stored.sectionNames) ? stored.sectionNames.slice(0, 500) : []).map((n) => text(n, 40) ?? "");
  return { id, savedAt, openedAt: int(stored.openedAt, 0, 1e14) ?? savedAt, fileName: text(stored.fileName, 120) ?? "", song, sectionNames, progress: parseProgress(stored.progress) };
}

// --- Song files -------------------------------------------------------------------------

/** The file a song is exported as: the song, its section names and its progress. */
export function exportText(record: SongRecord): string {
  const { song, sectionNames, progress, fileName } = record;
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, song, sectionNames, progress, fileName });
}

/** An exported song file read back, as a new record; null when it is not one of ours, or broken. */
export function importText(textValue: string, now: number): SongRecord | null {
  if (textValue.length > MAX_FILE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(textValue);
  } catch {
    return null;
  }
  if (!isObject(value) || value.format !== FILE_FORMAT || value.version !== FILE_VERSION) return null;
  return parseSongRecord({ ...value, id: newId(now), savedAt: now, openedAt: now });
}

/** A safe file name for the export: letters, digits and dashes. */
export function exportFileName(record: SongRecord): string {
  const base = record.song.title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 60);
  return `${base || "song"}.song.json`;
}

// --- IndexedDB ------------------------------------------------------------------------

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }).createIndex("openedAt", "openedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | void, fallback: T, read?: (result: unknown) => T): Promise<T> {
  let db: IDBDatabase;
  try {
    db = await open();
  } catch {
    return fallback;
  }
  try {
    const transaction = db.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    await done(transaction);
    return read ? read(request ? request.result : undefined) : fallback;
  } catch {
    return fallback;
  } finally {
    db.close();
  }
}

/** Opened most recently first, every record validated. An unavailable store reads as empty. */
export function listSongs(): Promise<SongRecord[]> {
  return withStore("readonly", (store) => store.index("openedAt").getAll(), [] as SongRecord[], (all) =>
    (Array.isArray(all) ? all : [])
      .map(parseSongRecord)
      .filter((r): r is SongRecord => r !== null)
      .sort((a, b) => b.openedAt - a.openedAt),
  );
}

export function getSong(id: string): Promise<SongRecord | null> {
  return withStore("readonly", (store) => store.get(id), null as SongRecord | null, parseSongRecord);
}

/** Saves a song and trims the library past KEEP. False when it could not be stored. */
export function putSong(record: SongRecord): Promise<boolean> {
  return withStore(
    "readwrite",
    (store) => {
      store.put(record);
      const keys = store.index("openedAt").getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result.slice(0, Math.max(0, keys.result.length - KEEP))) store.delete(key);
      };
    },
    false,
    () => true,
  );
}

export function deleteSong(id: string): Promise<boolean> {
  return withStore("readwrite", (store) => void store.delete(id), false, () => true);
}
