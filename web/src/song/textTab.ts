/**
 * Reading a plain-text guitar tab (the kind tab sites print) into a `Song`.
 *
 * Text tabs are hand-typed and inconsistent, so this reader is tolerant and
 * honest: it never throws, it reads what it can, and everything it had to
 * guess goes into `warnings` in plain words with a line number. It never
 * invents rhythm: a text tab has none, so `beat` is null and only the spacing
 * between columns is kept, as a hint.
 *
 * What it understands:
 *   - Staves: six consecutive string lines (`e|--0--`, `|--0--`, `E-0-`).
 *     Four lines (bass) and other counts are reported and skipped.
 *   - Frets 0-24, two digits read together; notes in one column are a chord.
 *   - h p / \ s b r ~ x t, <12> [12] 12* harmonics, a PM line over the staff.
 *   - Tuning (a `Tuning:` line, or the string names), capo, tempo, title.
 *   - Section labels ([Intro], Chorus, Riff 1) and repeats (x2, |: :|),
 *     recorded as hints for the breakdown, not expanded.
 *
 * Pure: text in, `Song` out. `npm run tab-check` runs it over test/tabs/.
 */

import {
  NAMED_TUNINGS,
  pitchClassOf,
  retune,
  STANDARD,
  tuningFromPitchClasses,
  type RepeatHint,
  type SectionLabel,
  type Song,
  type TabEvent,
  type TabNote,
  type Technique,
} from "./model";

/** Characters a string line is made of. Anything else in quantity means it is not one. */
const TAB_CHARS = /^[-0-9|:hpbrst/\\~xX<>()[\]*.^=v ]*$/;

/** The highest fret read from two digits; "35" is 3 then 5. Guitars stop at 24. */
const MAX_FRET = 24;

/** A bend written without its target ("7b") is taken as a whole tone, the usual "full" bend. */
const DEFAULT_BEND = 2;

/** When no repeat count is written ("repeat", "|: :|"), it is played twice. */
const DEFAULT_TIMES = 2;

/** "Verse 2", "Chorus:", "Riff 1 (x2)", "Solo B": a section word, at most a number or letter, maybe a repeat. */
const SECTION_LINE =
  /^(intro|verse|chorus|pre-?chorus|bridge|solo|outro|riff|main riff|interlude|break|coda|ending|lick|theme|melody)(?:\s*(?:\d+|[IVX]+|[A-D]))?(?:\s*\(?\s*x\s*\d+\s*\)?)?\s*:?$/i;
/** "Am", "G/B", "Cmaj7", "F#m7b5": a chord name, so a line of only these is a chord line. */
const CHORD_NAME = /^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|M)?\d*(?:b5|#5|b9|#9|sus\d)?(?:\/[A-G][#b]?)?$/;
const REPEAT_ONLY = /^\(?\s*(?:x\s*(\d+)|(\d+)\s*x|repeat(?:\s+(\d+)\s*(?:times|x))?|play\s+(\d+)\s+times)\s*\)?$/i;
const TRAILING_REPEAT = /\s+\(?\s*(?:x\s*(\d+)|(\d+)\s*x)\s*\)?\s*$/i;

interface StringLine {
  line: number; // 0-based
  text: string;
  name: string | null;
  /** Raw column where the body starts (just after the opening bar). */
  start: number;
  body: string;
  repeatTimes: number | null;
}

interface RawNote {
  string: number;
  from: number; // body column
  to: number;
  raw: number; // raw column of the first character
  line: number;
  fret: number;
  techniques: Set<Technique>;
  bendSemitones?: number;
}

function asStringLine(text: string, line: number): StringLine | null {
  const match = /^(\s*)([A-Ga-g][#b]?)?\s*([|:]|(?=-))/.exec(text);
  if (!match) return null;
  const start = match[0].length;
  let body = text.slice(start).replace(/\s+$/, "");
  let repeatTimes: number | null = null;
  const trailing = TRAILING_REPEAT.exec(body);
  if (trailing) {
    repeatTimes = Number(trailing[1] ?? trailing[2]);
    body = body.slice(0, trailing.index);
  }
  const bare = body.replace(/\s/g, "");
  // Two dashes at least: a fast run ("12-14-15-14") has few, prose has none.
  if (bare.length < 4 || !TAB_CHARS.test(body) || (bare.match(/-/g)?.length ?? 0) < 2) return null;
  return { line, text, name: match[2] ?? null, start, body, repeatTimes };
}

/** "PM----|  P.M.---": the raw columns each palm-mute marking covers, or null when it is not a PM line. */
function palmMuteSpans(text: string): [number, number][] | null {
  if (!/^\s*P\.?\s?M\.?/i.test(text) || !/^[\sPpMm.\-~|=]*$/.test(text)) return null;
  const spans: [number, number][] = [];
  for (const match of text.matchAll(/P\.?\s?M\.?[-~.|=]*/gi)) spans.push([match.index!, match.index! + match[0].length - 1]);
  return spans;
}

/** A tuning written in words or notes; null when it cannot be read. */
export function tuningFromText(value: string): string[] | null {
  const key = value.toLowerCase().replace(/tuning|[()]/g, "").replace(/\s+/g, " ").trim().replace(/[.,;]$/, "");
  if (NAMED_TUNINGS[key]) return [...NAMED_TUNINGS[key]];
  for (const [name, tuning] of Object.entries(NAMED_TUNINGS)) if (key.startsWith(name)) return [...tuning];
  // Notes: "D A D G B E", "DADGAD", "Eb Ab Db Gb Bb Eb". A lowercase b is a
  // flat only straight after an upper-case letter, so "Bb" is B flat and the
  // b in "e b g" is a note.
  const tokens = /\s|,/.test(value.trim())
    ? value.trim().split(/[\s,]+/)
    : [...value.trim().matchAll(/[A-Ga-g](?:#|(?<=[A-G])b)?/g)].map((m) => m[0]);
  const classes = tokens.map(pitchClassOf);
  if (classes.length !== 6 || classes.some((pc) => pc === null)) return null;
  // Written high string first when it starts with a lower-case e (as on a staff).
  const lowFirst = tokens[0] === "e" && tokens[5] !== "e" ? [...classes].reverse() : classes;
  return tuningFromPitchClasses(lowFirst as number[]);
}

function capoFrom(text: string): number | null {
  if (!/\bcapo\b/i.test(text)) return null;
  if (/\bno\s+capo\b|capo\s*[:\-]?\s*(?:none|no|0)\b/i.test(text)) return 0;
  const digits = /capo\D{0,12}?(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)?\s*fret/i.exec(text);
  if (digits) return Number(digits[1] ?? digits[2]);
  const roman = /capo\s*(?:on\s*)?(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/i.exec(text);
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  return roman ? numerals.indexOf(roman[1].toUpperCase()) + 1 : null;
}

/** Reads one string line's body into notes, with the techniques written around them. */
function readNotes(entry: StringLine, stringNumber: number, warnings: string[]): RawNote[] {
  const { body } = entry;
  const notes: RawNote[] = [];
  const lineNo = entry.line + 1;
  let pending: Technique[] = []; // connectors waiting for the next note: h p / \ s t
  let i = 0;
  const digitsAt = (at: number): [number, number] | null => {
    if (!/\d/.test(body[at] ?? "")) return null;
    if (/\d/.test(body[at + 1] ?? "") && Number(body.slice(at, at + 2)) <= MAX_FRET) return [Number(body.slice(at, at + 2)), 2];
    return [Number(body[at]), 1];
  };
  while (i < body.length) {
    const c = body[i];
    let fret: number | null = null;
    let from = i;
    let to = i;
    const techniques = new Set<Technique>();
    if (c === "<" || c === "[") {
      const close = c === "<" ? ">" : "]";
      const m = new RegExp(`^\\${c}(\\d{1,2})\\${close}`).exec(body.slice(i));
      if (m) {
        fret = Number(m[1]);
        techniques.add("harmonic");
        from = i;
        to = i + m[0].length - 1;
      }
    } else if (c === "x" || c === "X") {
      fret = 0;
      techniques.add("dead");
    } else {
      const d = digitsAt(i);
      if (d) {
        fret = d[0];
        to = i + d[1] - 1;
        const previous = notes[notes.length - 1];
        if (previous && previous.to === i - 1 && !previous.techniques.has("dead"))
          warnings.push(`Line ${lineNo}: digits run together ("${body.slice(previous.from, to + 1)}"); read as ${previous.fret} then ${fret}.`);
      }
    }
    if (fret === null) {
      if (c === "h") pending.push("hammer");
      else if (c === "p") pending.push("pull");
      else if (c === "/") pending.push("slideUp");
      else if (c === "\\") pending.push("slideDown");
      else if (c === "s") pending.push("slideUp"); // direction settled below from the frets
      else if (c === "t") pending.push("tap");
      i++;
      continue;
    }
    // After the note: bend (with its target, which is not a new note), release, vibrato, harmonic star, tap.
    let j = to + 1;
    let bendSemitones: number | undefined;
    const bend = /^b\(?(\d{1,2})?\)?(?:r\(?(\d{1,2})?\)?)?/.exec(body.slice(j));
    if (bend && techniques.has("dead") === false) {
      techniques.add("bend");
      if (bend[1] !== undefined && Number(bend[1]) > fret) bendSemitones = Number(bend[1]) - fret;
      else {
        bendSemitones = DEFAULT_BEND;
        warnings.push(`Line ${lineNo}: a bend on fret ${fret} has no target above it; taken as a whole tone.`);
      }
      if (bend[0].includes("r")) techniques.add("release");
      j += bend[0].length;
    }
    while (j < body.length && /[~*]/.test(body[j])) {
      techniques.add(body[j] === "~" ? "vibrato" : "harmonic");
      j++;
    }
    const previous = notes[notes.length - 1];
    for (const technique of pending) {
      if ((technique === "slideUp" || technique === "slideDown") && previous && !previous.techniques.has("dead") && previous.fret !== fret)
        techniques.add(fret > previous.fret ? "slideUp" : "slideDown");
      else techniques.add(technique);
    }
    pending = [];
    notes.push({ string: stringNumber, from, to, raw: entry.start + from, line: entry.line, fret, techniques, bendSemitones });
    i = j;
  }
  return notes;
}

/** Names on a staff (top line first) -> the tuning they spell, low string first; null if they do not. */
function tuningFromNames(names: (string | null)[]): string[] | null {
  if (names.some((name) => name === null)) return null;
  const classes = names.map((name) => pitchClassOf(name!));
  if (classes.some((pc) => pc === null)) return null;
  return tuningFromPitchClasses([...(classes as number[])].reverse());
}

const sameTuning = (a: readonly string[], b: readonly string[]) => a.every((note, i) => note === b[i]);

export function parseTextTab(input: string): Song {
  const lines = input.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const warnings: string[] = [];
  const events: TabEvent[] = [];
  const labels: SectionLabel[] = [];
  const repeats: RepeatHint[] = [];
  let title: string | null = null;
  let artist: string | undefined;
  let lineTuning: string[] | null = null;
  let staffTuning: string[] | null = null;
  let capo: number | null = null;
  let tempo: number | null = null;
  // A label waits for the staff it names; "Riff 1 (x2)" also repeats that staff.
  let pendingLabel: { name: string; line: number; times: number | null } | null = null;
  let lastStaff: { from: number; to: number } | null = null;
  let seenStaff = false;

  const repeat = (times: number, line: number, staff: { from: number; to: number } | null) => {
    if (staff && staff.to >= staff.from) repeats.push({ fromEvent: staff.from, toEvent: staff.to, times, sourceLine: line + 1 });
  };

  let n = 0;
  while (n < lines.length) {
    // A run of string lines.
    const run: StringLine[] = [];
    for (let k = n; k < lines.length; k++) {
      const entry = asStringLine(lines[k], k);
      if (!entry) break;
      run.push(entry);
    }
    if (run.length > 0) {
      // A row of dashes drawn as a separator, touching the staff, is not a string.
      const lines6 = [...run];
      const isRule = (entry: StringLine) => entry.name === null && /^-+$/.test(entry.body.trim());
      while (lines6.length % 6 !== 0 && isRule(lines6[lines6.length - 1])) lines6.pop();
      while (lines6.length % 6 !== 0 && isRule(lines6[0])) lines6.shift();
      if (lines6.length % 6 !== 0 || lines6.length === 0) {
        warnings.push(
          run.length === 4
            ? `Line ${run[0].line + 1}: a 4-string staff (bass tab?) is not supported yet; skipped.`
            : `Line ${run[0].line + 1}: ${run.length} string lines together; a guitar staff has 6. Skipped.`,
        );
      }
      for (let s = 0; lines6.length % 6 === 0 && s < lines6.length; s += 6) {
        const staffLine = lines6[s].line + 1;
        const from = events.length;
        const staff = readStaff(lines6.slice(s, s + 6), lines, events, warnings);
        const to = events.length - 1;
        seenStaff = true;
        if (pendingLabel) {
          labels.push({ name: pendingLabel.name, beforeEvent: from, sourceLine: pendingLabel.line + 1 });
          if (pendingLabel.times !== null) repeat(pendingLabel.times, pendingLabel.line, { from, to });
          pendingLabel = null;
        }
        const names = staff.map((entry) => entry.name);
        const fromNames = tuningFromNames(names);
        if (fromNames && !staffTuning) staffTuning = fromNames;
        else if (fromNames && staffTuning && !sameTuning(fromNames, staffTuning))
          warnings.push(`Line ${staffLine}: this staff's string names spell a different tuning from the first staff's; kept the first.`);
        lastStaff = { from, to };
        for (const [a, b, times] of barRepeats(staff, from, events)) repeats.push({ fromEvent: a, toEvent: b, times, sourceLine: staffLine });
        const trailing = staff.find((entry) => entry.repeatTimes !== null);
        if (trailing && !staff.some((entry) => /\|:|:\|/.test(entry.text))) repeat(trailing.repeatTimes!, trailing.line, lastStaff);
      }
      n += run.length;
      continue;
    }

    const text = lines[n].trim();
    n++;
    if (!text) continue;
    if (palmMuteSpans(lines[n - 1])) continue; // read with its staff
    const tuningLine = /^tuning\s*[:=\-]?\s*(.+)$/i.exec(text);
    if (tuningLine) {
      lineTuning = tuningFromText(tuningLine[1]);
      if (!lineTuning) warnings.push(`Line ${n}: could not read the tuning "${tuningLine[1]}"; assuming standard.`);
      continue;
    }
    const capoHere = capoFrom(text);
    if (capoHere !== null) {
      capo = capoHere;
      continue;
    }
    const bpm = /(?:tempo|bpm)\s*[:=]?\s*(\d{2,3})\b|\b(\d{2,3})\s*bpm\b/i.exec(text);
    if (bpm) {
      tempo = Number(bpm[1] ?? bpm[2]);
      continue;
    }
    const titleLine = /^(?:title|song)\s*[:\-]\s*(.+)$/i.exec(text);
    if (titleLine) {
      title = titleLine[1].trim();
      continue;
    }
    const artistLine = /^(?:artist|band|by)\s*[:\-]\s*(.+)$/i.exec(text);
    if (artistLine) {
      artist = artistLine[1].trim();
      continue;
    }
    const repeatOnly = REPEAT_ONLY.exec(text);
    if (repeatOnly) {
      const times = Number(repeatOnly[1] ?? repeatOnly[2] ?? repeatOnly[3] ?? repeatOnly[4] ?? DEFAULT_TIMES);
      // After a staff it repeats that staff; before any, it is noted and dropped.
      if (lastStaff) repeat(times, n - 1, lastStaff);
      continue;
    }
    const bracketed = /^\[([^\]]{1,30})\]$/.exec(text);
    if (bracketed || SECTION_LINE.test(text)) {
      const raw = bracketed ? bracketed[1] : text.replace(/:$/, "");
      const times = /\(?\s*x\s*(\d+)\s*\)?\s*$/i.exec(raw);
      pendingLabel = { name: raw.replace(/\(?\s*x\s*\d+\s*\)?\s*$/i, "").trim(), line: n - 1, times: times ? Number(times[1]) : null };
      lastStaff = null;
      continue;
    }
    const chordLine = text.split(/\s+/).every((token) => CHORD_NAME.test(token) || /^[|/%.-]+$/.test(token));
    if (!seenStaff && title === null && text.length <= 60 && !chordLine) {
      const by = /^(.+?)\s+by\s+(.+)$/i.exec(text);
      title = by ? by[1].trim() : text;
      if (by) artist = by[2].trim();
    }
    // Anything else (lyrics, chord names, comments) is not ours to read.
  }

  repeats.sort((a, b) => a.fromEvent - b.fromEvent || a.sourceLine - b.sourceLine);

  if (events.length === 0 && !warnings.some((w) => w.includes("Skipped") || w.includes("skipped")))
    warnings.push("No guitar tab found. A tab has six lines like e|---0---3---|, one per string.");

  let tuning: string[] = [...STANDARD];
  if (lineTuning) {
    tuning = lineTuning;
    if (staffTuning && !sameTuning(staffTuning, STANDARD) && !sameTuning(staffTuning, lineTuning))
      warnings.push("The tuning line and the string names disagree; used the tuning line.");
  } else if (staffTuning) tuning = staffTuning;
  else if (events.length > 0) warnings.push("No tuning written; assuming standard (E A D G B E).");

  const song: Song = {
    title: title ?? "Untitled tab",
    artist,
    tuning,
    capo: capo ?? 0,
    tempo,
    timeSignature: null,
    events,
    sections: [],
    labels,
    repeats,
    warnings,
    source: "text",
  };
  return retune(song, tuning, song.capo);
}

/**
 * Reads one six-line staff (top line = string 1) into events, appended to
 * `events`. Returns the lines in the order read: high string first.
 */
function readStaff(staff: StringLine[], lines: string[], events: TabEvent[], warnings: string[]): StringLine[] {
  const staffLine = staff[0].line + 1;
  // Low string on top ("E A D G B e" downwards) is read upside down.
  const names = staff.map((entry) => entry.name);
  const forward = tuningFromNames(names);
  const backward = tuningFromNames([...names].reverse());
  let ordered = staff;
  if (forward && backward && !sameTuning(forward, STANDARD) && sameTuning(backward, STANDARD)) {
    ordered = [...staff].reverse();
    warnings.push(`Line ${staffLine}: the low string is written on top; read the staff upside down.`);
  }
  const lengths = ordered.map((entry) => entry.body.length);
  if (Math.max(...lengths) !== Math.min(...lengths))
    warnings.push(`Line ${staffLine}: the string lines have different lengths; the short ones were read as rests to the end.`);

  const notes = ordered.flatMap((entry, k) => readNotes(entry, k + 1, warnings));
  // Palm mutes: a PM line just above or below the staff, by raw column.
  const muteLines = [staff[0].line - 1, staff[staff.length - 1].line + 1].map((k) => (k >= 0 && k < lines.length ? palmMuteSpans(lines[k]) : null));
  for (const spans of muteLines) {
    if (!spans) continue;
    for (const note of notes) if (spans.some(([a, b]) => note.raw >= a && note.raw <= b)) note.techniques.add("palmMute");
  }

  // Notes whose columns overlap are one event (a two-digit fret over a one-digit one included).
  notes.sort((a, b) => a.from - b.from || a.string - b.string);
  const groups: RawNote[][] = [];
  let reach = -1;
  for (const note of notes) {
    const group = groups[groups.length - 1];
    if (group && note.from <= reach && !group.some((other) => other.string === note.string)) {
      group.push(note);
      reach = Math.max(reach, note.to);
    } else {
      groups.push([note]);
      reach = note.to;
    }
  }
  let previousStart: number | null = null;
  for (const group of groups) {
    const first = group.reduce((a, b) => (b.from < a.from || (b.from === a.from && b.string < a.string) ? b : a));
    const tabNotes: TabNote[] = group
      .sort((a, b) => a.string - b.string)
      .map((note) => ({
        string: note.string,
        fret: note.fret,
        midi: 0, // set from the tuning once the whole tab is read
        techniques: [...note.techniques],
        ...(note.bendSemitones !== undefined ? { bendSemitones: note.bendSemitones } : {}),
      }));
    events.push({
      index: events.length,
      notes: tabNotes,
      beat: null,
      durationBeats: null,
      spacing: previousStart === null ? null : first.from - previousStart,
      sourceLine: first.line + 1,
      sourceColumn: first.raw,
    });
    previousStart = first.from;
  }
  return ordered;
}

/** `|: … :|` inside a staff: [first event, last event, times] for each pair of bars. */
function barRepeats(staff: StringLine[], from: number, events: TabEvent[]): [number, number, number][] {
  const starts = new Set<number>();
  const ends = new Set<number>();
  for (const entry of staff) {
    for (const m of entry.text.matchAll(/\|:/g)) starts.add(m.index!);
    for (const m of entry.text.matchAll(/:\|/g)) ends.add(m.index!);
  }
  if (ends.size === 0) return [];
  const times = staff.find((entry) => entry.repeatTimes !== null)?.repeatTimes ?? DEFAULT_TIMES;
  const staffEvents = events.slice(from);
  const out: [number, number, number][] = [];
  const startList = [...starts].sort((a, b) => a - b);
  for (const end of [...ends].sort((a, b) => a - b)) {
    const start = startList.filter((s) => s < end).pop() ?? -1;
    const inside = staffEvents.filter((event) => event.sourceColumn > start && event.sourceColumn < end);
    if (inside.length > 0) out.push([inside[0].index, inside[inside.length - 1].index, times]);
  }
  return out;
}
