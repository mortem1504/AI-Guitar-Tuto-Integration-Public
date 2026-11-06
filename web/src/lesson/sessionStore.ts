/**
 * Finished note sessions, kept in IndexedDB.
 *
 * IndexedDB rather than localStorage because a session carries its mistake
 * timeline and there will be hundreds of them; settings stay in localStorage.
 * Only derived results are kept (which note was asked for, which was heard,
 * when): never audio.
 *
 * What comes back out is treated like every other stored value here: hostile.
 * `parseRecord` rebuilds each record field by field, clamping numbers and
 * dropping anything unknown, and a record that cannot be rebuilt is skipped
 * rather than thrown. Pure, so `npm run lesson-check` exercises it.
 */

import type { FeedbackState } from "./noteJudge";
import type { PracticeMode, SessionSummary } from "./NoteSession";

const DB_NAME = "guitar-coach";
const DB_VERSION = 1;
const STORE = "sessions";
/** Enough for a year of daily practice; the oldest go first. */
const KEEP = 500;
/** A 30-minute play-through at 120 bpm is 3600 notes; the timeline keeps the first mistakes. */
const MAX_TIMELINE = 400;

const STATES: readonly FeedbackState[] = ["clean", "wrongNote", "wrongSpot", "timing", "notCaught", "weakSignal"];

export interface TimelineEntry {
  atMs: number;
  index: number;
  state: FeedbackState;
  target: number;
  played: number | null;
  offsetMs: number | null;
}

export interface SessionRecord {
  id: string;
  /** The exercise it came from ("spider", never "spider.mistakes"). */
  exerciseId: string;
  /** True when it was a "practise mistakes" run. */
  mistakesOnly: boolean;
  mode: PracticeMode;
  tempo: number;
  /** Wall-clock ms (Date.now()) when it started. */
  startedAt: number;
  durationMs: number;
  steps: number;
  attempted: number;
  clean: number;
  mistakes: number;
  notCaught: number;
  weakSignal: number;
  skipped: number;
  accuracy: number;
  mostMissed: { midi: number; count: number } | null;
  timeline: TimelineEntry[];
  /** Pluck to feedback on screen, ms. Null when no note was timed. */
  latency: { p50: number; p95: number; count: number } | null;
  /** Notes the camera placed, and how many at the target's string and fret. */
  fusedNotes: number;
  fusedAtTarget: number;
}

export function recordOf(
  summary: SessionSummary,
  details: { exerciseId: string; mode: PracticeMode; tempo: number; steps: number; startedAt: number; latency: SessionRecord["latency"] },
): SessionRecord {
  const mistakesOnly = details.exerciseId.endsWith(".mistakes");
  return {
    id: `${details.startedAt.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    exerciseId: mistakesOnly ? details.exerciseId.slice(0, -".mistakes".length) : details.exerciseId,
    mistakesOnly,
    mode: details.mode,
    tempo: details.tempo,
    startedAt: details.startedAt,
    durationMs: Math.round(summary.durationMs),
    steps: details.steps,
    attempted: summary.attempted,
    clean: summary.clean,
    mistakes: summary.mistakes,
    notCaught: summary.notCaught,
    weakSignal: summary.weakSignal,
    skipped: summary.skipped,
    accuracy: summary.accuracy,
    mostMissed: summary.mostMissed,
    timeline: summary.timeline.slice(0, MAX_TIMELINE).map((mark) => ({
      atMs: Math.round(mark.atMs),
      index: mark.index,
      state: mark.verdict.state,
      target: mark.verdict.target.midi,
      played: mark.verdict.played,
      offsetMs: mark.verdict.offsetMs === null ? null : Math.round(mark.verdict.offsetMs),
    })),
    latency: details.latency,
    fusedNotes: summary.fusedNotes,
    fusedAtTarget: summary.fusedAtTarget,
  };
}

// --- Reading hostile data back -----------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function count(value: unknown, max = 1e6): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : null;
}

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
}

function midiOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 127 ? value : null;
}

function text(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && value.length <= 80 && pattern.test(value) ? value : null;
}

export function parseRecord(stored: unknown): SessionRecord | null {
  if (!isRecord(stored)) return null;
  const id = text(stored.id, /^[a-z0-9-]+$/);
  const exerciseId = text(stored.exerciseId, /^[A-Za-z0-9]+$/);
  const mode = stored.mode === "loop" || stored.mode === "playThrough" ? stored.mode : null;
  const tempo = finite(stored.tempo, 30, 240);
  const startedAt = count(stored.startedAt, 1e14);
  const durationMs = count(stored.durationMs, 1e8);
  const fields = ["steps", "attempted", "clean", "mistakes", "notCaught", "weakSignal", "skipped"] as const;
  const counts = Object.fromEntries(fields.map((key) => [key, count(stored[key])]));
  const accuracy = finite(stored.accuracy, 0, 1);
  if (!id || !exerciseId || !mode || tempo === null || startedAt === null || durationMs === null || accuracy === null) return null;
  if (fields.some((key) => counts[key] === null)) return null;

  let mostMissed: SessionRecord["mostMissed"] = null;
  if (isRecord(stored.mostMissed)) {
    const midi = midiOrNull(stored.mostMissed.midi);
    const misses = count(stored.mostMissed.count);
    if (midi !== null && misses !== null) mostMissed = { midi, count: misses };
  }

  const timeline: TimelineEntry[] = [];
  if (Array.isArray(stored.timeline)) {
    for (const entry of stored.timeline.slice(0, MAX_TIMELINE)) {
      if (!isRecord(entry)) continue;
      const state = STATES.find((s) => s === entry.state);
      const target = midiOrNull(entry.target);
      const atMs = count(entry.atMs, 1e8);
      const index = count(entry.index, 1e5);
      if (!state || target === null || atMs === null || index === null) continue;
      timeline.push({ atMs, index, state, target, played: midiOrNull(entry.played), offsetMs: finite(entry.offsetMs, -1e5, 1e5) });
    }
  }

  let latency: SessionRecord["latency"] = null;
  if (isRecord(stored.latency)) {
    const p50 = finite(stored.latency.p50, 0, 1e5);
    const p95 = finite(stored.latency.p95, 0, 1e5);
    const n = count(stored.latency.count);
    if (p50 !== null && p95 !== null && n !== null) latency = { p50, p95, count: n };
  }

  return {
    id,
    exerciseId,
    mistakesOnly: stored.mistakesOnly === true,
    mode,
    tempo,
    startedAt,
    durationMs,
    steps: counts.steps!,
    attempted: counts.attempted!,
    clean: counts.clean!,
    mistakes: counts.mistakes!,
    notCaught: counts.notCaught!,
    weakSignal: counts.weakSignal!,
    skipped: counts.skipped!,
    accuracy,
    mostMissed,
    timeline,
    latency,
    // Added in Phase 4; records from before it have none.
    fusedNotes: count(stored.fusedNotes) ?? 0,
    fusedAtTarget: count(stored.fusedAtTarget) ?? 0,
  };
}

// --- IndexedDB ---------------------------------------------------------------

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" }).createIndex("startedAt", "startedAt");
      }
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

/** Newest first, every record validated. An unavailable store reads as empty. */
export async function listSessions(limit = 50): Promise<SessionRecord[]> {
  let db: IDBDatabase;
  try {
    db = await open();
  } catch {
    return [];
  }
  try {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).index("startedAt").openCursor(null, "prev");
    const records: SessionRecord[] = [];
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || records.length >= limit) return resolve();
        const record = parseRecord(cursor.value);
        if (record) records.push(record);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    return records;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Saves a session and trims the oldest beyond KEEP. Failure is silent: the lesson already happened. */
export async function saveSession(record: SessionRecord): Promise<boolean> {
  let db: IDBDatabase;
  try {
    db = await open();
  } catch {
    return false;
  }
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.put(record);
    const keys = store.index("startedAt").getAllKeys();
    keys.onsuccess = () => {
      const all = keys.result;
      for (const key of all.slice(0, Math.max(0, all.length - KEEP))) store.delete(key);
    };
    await done(transaction);
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}
