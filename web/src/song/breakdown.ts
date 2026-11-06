/**
 * A song broken into pieces small enough to learn: the teacher's first job.
 *
 *   sections  the tab's own labels when it has them; otherwise its staves
 *             (text) or four-bar phrases (scores), small ones merged.
 *   chunks    4-12 notes each, cut where the music breathes (a rest, a bar
 *             line, a new staff) rather than at a fixed count.
 *   difficulty per chunk, 0-100, from things that can be counted on the tab,
 *             each with a sentence the UI can show.
 *   hot spots the 1-3 hardest note-to-note moves of each section, to drill;
 *             none when nothing in it is hard (HOT_SPOT_MIN).
 *
 * Pure and deterministic: the same song always gives the same breakdown
 * (`npm run breakdown-check`). Numbers are in notes = events, so a chord
 * counts once.
 */

import { pressed, suggestFingering, type Fingering } from "./fingering";
import type { Section, Song, TabEvent, Technique } from "./model";

/** Chunk sizes the brief asks for: below 4 is not a phrase, above 12 does not fit in the head at once. */
export const MIN_CHUNK = 4;
export const MAX_CHUNK = 12;
/** The size chunks are pulled towards: two bars of quavers, a typical riff. */
const IDEAL_CHUNK = 8;

/** Scores without labels are cut into phrases of this many bars, the usual length of a musical phrase. */
const BARS_PER_PHRASE = 4;

/**
 * A move must cost at least this to be a hot spot: a 3-fret jump, a bend, or
 * a skip with a shift. A lone hammer-on or slide is not worth a drill of its own.
 */
export const HOT_SPOT_MIN = 1.5;

/** A hand move of more than this many frets is a "large" shift (the brief's definition). */
const LARGE_SHIFT = 4;

/** How much each counted thing adds to a chunk's difficulty. They sum to 100. */
const WEIGHTS = { jumps: 25, shifts: 20, speed: 20, skips: 15, techniques: 10, highFrets: 10 } as const;

/** What each technique asks of the hands, relative to a plain picked note (0). */
const TECHNIQUE_LOAD: Readonly<Record<Technique, number>> = {
  bend: 3, // pitch by feel, with strength
  tap: 3,
  harmonic: 2, // exact spot over the wire, light touch
  slideUp: 2,
  slideDown: 2,
  hammer: 1.5,
  pull: 1.5,
  release: 1,
  vibrato: 1,
  palmMute: 0.5,
  dead: 0.5,
};

export type FactorKey = keyof typeof WEIGHTS;

export interface Factor {
  key: FactorKey;
  /** 0-100: how hard this one thing is in the chunk. */
  score: number;
  /** The number the sentence is built on (frets, count, notes a second, share). */
  value: number;
  /** English sentence for the UI; `key` and `value` are there to translate it. */
  text: string;
}

export interface Difficulty {
  /** 0-100. */
  score: number;
  /** Hardest contribution first. `speed` is absent when the tab has no rhythm. */
  factors: Factor[];
}

export interface Chunk {
  index: number;
  section: number;
  firstEvent: number;
  lastEvent: number;
  difficulty: Difficulty;
  /** Chords in the chunk: shown and heard, not graded (the detector hears one note at a time). */
  listenOnly: number;
}

export interface HotSpot {
  section: number;
  /** The move from `fromEvent` to `toEvent` (= fromEvent + 1). */
  fromEvent: number;
  toEvent: number;
  cost: number;
  /** English: "jump of 7 frets", "hand shift to fret 9". */
  reasons: string[];
  /** The same reasons, for translating: what kind, and its number or names. */
  why: HotSpotReason[];
}

export type HotSpotReason =
  | { kind: "jump"; frets: number }
  | { kind: "skip"; strings: number }
  | { kind: "shift"; fret: number }
  | { kind: "technique"; techniques: Technique[] }
  | { kind: "chord" }
  | { kind: "fast"; seconds: number };

export interface Breakdown {
  /** The song with `sections` filled in. */
  song: Song;
  fingering: Fingering;
  chunks: Chunk[];
  hotSpots: HotSpot[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const fretted = (event: TabEvent) => event.notes.filter(pressed);
/** Where the fretting hand is for an event: the mean fretted fret; null for open strings only. */
function anchor(event: TabEvent): number | null {
  const frets = fretted(event).map((note) => note.fret);
  return frets.length ? frets.reduce((a, b) => a + b, 0) / frets.length : null;
}
const rhythmic = (song: Song) => song.events.length > 0 && song.events.every((e) => e.beat !== null && e.durationBeats !== null);

// --- Sections -------------------------------------------------------------------

function sectionsOf(song: Song): Section[] {
  const n = song.events.length;
  if (n === 0) return [];
  let starts: { at: number; name: string }[];
  if (song.labels.length > 0) {
    starts = [];
    for (const label of [...song.labels].sort((a, b) => a.beforeEvent - b.beforeEvent)) {
      if (label.beforeEvent >= n) continue;
      const same = starts.find((s) => s.at === label.beforeEvent);
      if (same) same.name = label.name; // two labels in a row: the one nearest the notes names them
      else starts.push({ at: label.beforeEvent, name: label.name });
    }
    if (starts.length === 0 || starts[0].at > 0) starts.unshift({ at: 0, name: "Opening" });
  } else {
    // Natural seams: a new staff in a text tab, a new phrase in a score.
    const phraseOf = (event: TabEvent) => Math.floor((event.sourceLine - 1) / BARS_PER_PHRASE);
    const seam = (i: number) => (rhythmic(song) ? phraseOf(song.events[i]) !== phraseOf(song.events[i - 1]) : song.events[i].spacing === null);
    const cuts = [0];
    for (let i = 1; i < n; i++) if (seam(i)) cuts.push(i);
    // A seam that leaves fewer than MIN_CHUNK notes on either side is dropped: the piece joins its neighbour.
    const kept: number[] = [0];
    for (const cut of cuts.slice(1)) if (cut - kept[kept.length - 1] >= MIN_CHUNK) kept.push(cut);
    if (kept.length > 1 && n - kept[kept.length - 1] < MIN_CHUNK) kept.pop();
    starts = kept.map((at, k) => ({ at, name: `Part ${k + 1}` }));
  }
  return starts.map((start, k) => ({ name: start.name, firstEvent: start.at, lastEvent: (starts[k + 1]?.at ?? n) - 1 }));
}

// --- Chunks ---------------------------------------------------------------------

/**
 * What it costs to start a chunk at event `i`: 0 where the music stops (a
 * rest, a new staff), 1 at a softer seam (a bar line, a long note, a wide gap
 * in the text), 3 in the middle of a run.
 */
function seamCost(song: Song, i: number, typicalSpacing: number): number {
  const event = song.events[i];
  const previous = song.events[i - 1];
  if (rhythmic(song)) {
    const end = previous.beat! + previous.durationBeats!;
    if (event.beat! > end + 1e-6) return 0;
    if (event.sourceLine !== previous.sourceLine) return 1;
    return previous.durationBeats! >= 1.5 ? 1 : 3;
  }
  if (event.spacing === null) return 0;
  return event.spacing >= 2 * typicalSpacing ? 1 : 3;
}

/** Splits events [first, last] into chunks of MIN_CHUNK..MAX_CHUNK, as near IDEAL_CHUNK as the seams allow. */
function chunkRanges(song: Song, first: number, last: number, typicalSpacing: number): [number, number][] {
  const n = last - first + 1;
  if (n <= MAX_CHUNK && n < 2 * MIN_CHUNK) return [[first, last]];
  // best[j]: cheapest split of the first j events; sizes cost ((size - 8) / 4)^2, so 8 is free and 4 or 12 cost 1.
  const best = new Array<number>(n + 1).fill(Infinity);
  const size = new Array<number>(n + 1).fill(0);
  best[0] = 0;
  for (let j = MIN_CHUNK; j <= n; j++) {
    for (let s = MIN_CHUNK; s <= Math.min(MAX_CHUNK, j); s++) {
      if (best[j - s] === Infinity) continue;
      const seam = j < n ? seamCost(song, first + j, typicalSpacing) : 0;
      const cost = best[j - s] + ((s - IDEAL_CHUNK) / 4) ** 2 + seam;
      if (cost < best[j] - 1e-9) {
        best[j] = cost;
        size[j] = s;
      }
    }
  }
  const ranges: [number, number][] = [];
  for (let j = n; j > 0; j -= size[j]) ranges.unshift([first + j - size[j], first + j - 1]);
  return ranges;
}

// --- Difficulty -------------------------------------------------------------------

function difficultyOf(song: Song, fingering: Fingering, first: number, last: number): Difficulty {
  const events = song.events.slice(first, last + 1);
  const factors: Factor[] = [];
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // Fret jumps between fretted notes (open strings need no move of the fretting hand).
  const jumps: number[] = [];
  let lastAnchor: number | null = null;
  for (const event of events) {
    const at = anchor(event);
    if (at === null) continue;
    if (lastAnchor !== null) jumps.push(Math.abs(at - lastAnchor));
    lastAnchor = at;
  }
  const maxJump = jumps.length ? Math.round(Math.max(...jumps)) : 0;
  const meanJump = jumps.length ? jumps.reduce((a, b) => a + b, 0) / jumps.length : 0;
  // A 12-fret leap is the longest move on the neck; 4 frets on average means the hand never settles.
  factors.push({ key: "jumps", score: Math.round(50 * clamp01(maxJump / 12) + 50 * clamp01(meanJump / 4)), value: maxJump, text: maxJump ? `Biggest fret jump: ${plural(maxJump, "fret")}` : "No fret jumps" });

  // Hand shifts, from the suggested fingering.
  let shifts = 0;
  let large = 0;
  for (let i = first + 1; i <= last; i++) {
    if (!fingering.events[i].shift) continue;
    shifts++;
    let j = i - 1; // the last note the hand fretted
    while (j > 0 && fretted(song.events[j]).length === 0) j--;
    if (Math.abs(fingering.events[i].position - fingering.events[j].position) > LARGE_SHIFT) large++;
  }
  // Four moves in one short chunk (large ones count twice) is as busy as a hand gets.
  factors.push({ key: "shifts", score: Math.round(100 * clamp01((shifts + large) / 4)), value: shifts, text: shifts ? `${plural(shifts, "hand shift")}${large ? ` (${large} large)` : ""}` : "The hand stays in one place" });

  // String skips between single notes.
  let moves = 0;
  let skips = 0;
  for (let i = 1; i < events.length; i++) {
    if (events[i].notes.length !== 1 || events[i - 1].notes.length !== 1) continue;
    moves++;
    if (Math.abs(events[i].notes[0].string - events[i - 1].notes[0].string) >= 2) skips++;
  }
  // When half the moves skip a string, picking accuracy is the whole game.
  factors.push({ key: "skips", score: Math.round(100 * clamp01(moves ? (2 * skips) / moves : 0)), value: skips, text: skips ? plural(skips, "string skip") : "No string skips" });

  // Speed, when the tab has rhythm and a tempo.
  if (rhythmic(song) && song.tempo) {
    const end = events[events.length - 1];
    const beats = end.beat! + end.durationBeats! - events[0].beat!;
    const perSecond = beats > 0 ? (events.length / beats) * (song.tempo / 60) : 0;
    // 2 notes a second is a beginner's pace; 8 is sixteenths at 120 BPM.
    factors.push({ key: "speed", score: Math.round(100 * clamp01((perSecond - 2) / 6)), value: Math.round(perSecond * 10) / 10, text: `${(Math.round(perSecond * 10) / 10).toFixed(1)} notes a second at full speed` });
  }

  // Techniques.
  const used = new Set<Technique>();
  let load = 0;
  for (const event of events)
    for (const note of event.notes)
      for (const technique of note.techniques) {
        used.add(technique);
        load += TECHNIQUE_LOAD[technique];
      }
  // Two bends (or three slides) in one short chunk is already a lot to think about.
  factors.push({ key: "techniques", score: Math.round(100 * clamp01(load / 6)), value: used.size, text: used.size ? `Techniques: ${[...used].sort().join(", ")}` : "Plain picked notes" });

  // High frets: narrow, and far from the open-position landmarks.
  const notes = events.flatMap(fretted);
  const high = notes.filter((note) => note.fret > 12).length;
  factors.push({ key: "highFrets", score: Math.round(100 * (notes.length ? high / notes.length : 0)), value: high, text: high ? `${high} of ${notes.length} notes above the 12th fret` : "Nothing above the 12th fret" });

  const weight = factors.reduce((sum, f) => sum + WEIGHTS[f.key], 0);
  const score = Math.round(factors.reduce((sum, f) => sum + f.score * WEIGHTS[f.key], 0) / weight);
  factors.sort((a, b) => b.score * WEIGHTS[b.key] - a.score * WEIGHTS[a.key] || a.key.localeCompare(b.key));
  return { score, factors };
}

// --- Hot spots ----------------------------------------------------------------------

/** The cost of moving from event i-1 to event i, and why. */
function moveCost(song: Song, fingering: Fingering, i: number): { cost: number; reasons: string[]; why: HotSpotReason[] } {
  const a = song.events[i - 1];
  const b = song.events[i];
  const reasons: string[] = [];
  const why: HotSpotReason[] = [];
  let cost = 0;
  const from = anchor(a);
  const to = anchor(b);
  if (from !== null && to !== null && Math.abs(to - from) >= 3) {
    // Half a point a fret: a 7-fret jump (3.5) outweighs a string skip (1).
    cost += Math.abs(to - from) / 2;
    reasons.push(`jump of ${Math.round(Math.abs(to - from))} frets`);
    why.push({ kind: "jump", frets: Math.round(Math.abs(to - from)) });
  }
  if (a.notes.length === 1 && b.notes.length === 1) {
    const skipped = Math.abs(a.notes[0].string - b.notes[0].string) - 1;
    if (skipped > 0) {
      cost += skipped;
      reasons.push(`skips ${skipped} string${skipped === 1 ? "" : "s"}`);
      why.push({ kind: "skip", strings: skipped });
    }
  }
  if (fingering.events[i].shift) {
    cost += 1;
    reasons.push(`hand shift to fret ${fingering.events[i].position}`);
    why.push({ kind: "shift", fret: fingering.events[i].position });
  }
  const techniques = [...new Set(b.notes.flatMap((note) => note.techniques))];
  const load = techniques.reduce((sum, t) => sum + TECHNIQUE_LOAD[t], 0);
  if (load >= 1.5) {
    cost += load / 2;
    reasons.push(techniques.sort().join(" + "));
    why.push({ kind: "technique", techniques });
  }
  if (b.notes.length > 1 && a.notes.length === 1) {
    cost += 1;
    reasons.push("into a chord");
    why.push({ kind: "chord" });
  }
  if (rhythmic(song) && song.tempo) {
    const seconds = ((b.beat! - a.beat!) * 60) / song.tempo;
    // Under a quarter of a second there is no time to look; under an eighth, none to think.
    if (seconds < 0.25) {
      cost += seconds < 0.125 ? 3 : 1.5;
      reasons.push(`only ${seconds.toFixed(2)} s apart`);
      why.push({ kind: "fast", seconds: Math.round(seconds * 100) / 100 });
    }
  }
  return { cost: Math.round(cost * 100) / 100, reasons, why };
}

function hotSpotsOf(song: Song, fingering: Fingering, sections: Section[]): HotSpot[] {
  const out: HotSpot[] = [];
  sections.forEach((section, s) => {
    const moves: HotSpot[] = [];
    for (let i = section.firstEvent + 1; i <= section.lastEvent; i++) {
      const { cost, reasons, why } = moveCost(song, fingering, i);
      if (cost >= HOT_SPOT_MIN) moves.push({ section: s, fromEvent: i - 1, toEvent: i, cost, reasons, why });
    }
    moves.sort((a, b) => b.cost - a.cost || a.fromEvent - b.fromEvent);
    // The hardest hard move; up to two more when they are nearly as hard (60% of it).
    const top = moves[0];
    const picked = top ? [top, ...moves.slice(1, 3).filter((m) => m.cost >= 0.6 * top.cost)] : [];
    out.push(...picked.sort((a, b) => a.fromEvent - b.fromEvent));
  });
  return out;
}

// --- All together -----------------------------------------------------------------

export function breakDown(input: Song): Breakdown {
  const sections = sectionsOf(input);
  const song: Song = { ...input, sections };
  const fingering = suggestFingering(song);
  const spacings = song.events.map((e) => e.spacing).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const typicalSpacing = spacings.length ? spacings[spacings.length >> 1] : 1;
  const chunks: Chunk[] = [];
  sections.forEach((section, s) => {
    for (const [first, last] of chunkRanges(song, section.firstEvent, section.lastEvent, typicalSpacing)) {
      chunks.push({
        index: chunks.length,
        section: s,
        firstEvent: first,
        lastEvent: last,
        difficulty: difficultyOf(song, fingering, first, last),
        listenOnly: song.events.slice(first, last + 1).filter((e) => e.notes.length > 1).length,
      });
    }
  });
  return { song, fingering, chunks, hotSpots: hotSpotsOf(song, fingering, sections) };
}
