/**
 * Guitar Pro (.gp, .gp5, .gpx, …) and MusicXML files into a `Song`.
 *
 * alphaTab (`@coderline/alphatab`, MPL-2.0) is used only to read the file
 * into its score model; everything after that is ours. It is about 1 MB, so
 * it is fetched the first time someone opens such a file, never at start-up.
 *
 * Scores have real rhythm, so `beat` and `durationBeats` are filled (in
 * quarter notes), and so are `tempo` and `timeSignature`. `sourceLine` is the
 * bar number and `sourceColumn` the beat within the bar. Like the text
 * reader, this never throws: an unreadable file is a song with no events and
 * a warning that says what to try.
 */

import type * as AlphaTab from "@coderline/alphatab";
import { nameOfMidi, retune, STANDARD, type RepeatHint, type SectionLabel, type Song, type TabEvent, type TabNote, type Technique } from "../model";

type AlphaTabModule = typeof AlphaTab;
type Score = AlphaTab.model.Score;
type Track = AlphaTab.model.Track;
type Staff = AlphaTab.model.Staff;
type Beat = AlphaTab.model.Beat;
type Note = AlphaTab.model.Note;

/** alphaTab's resolution: ticks per quarter note (the MIDI convention). */
const TICKS_PER_QUARTER = 960;

/** Beats are kept to a thousandth: enough for triplets, and stable in tests. */
const round = (beats: number) => Math.round(beats * 1000) / 1000;

/** The highest fret the rest of the app knows about. */
const MAX_FRET = 24;

/** General MIDI programs 24-31 are guitars, 32-39 basses. */
const GUITAR_PROGRAMS: Readonly<Record<number, string>> = {
  24: "Nylon guitar",
  25: "Steel guitar",
  26: "Jazz guitar",
  27: "Clean electric guitar",
  28: "Muted electric guitar",
  29: "Overdriven guitar",
  30: "Distortion guitar",
  31: "Guitar harmonics",
};

/** One track of the file, as the track picker shows it. */
export interface TrackChoice {
  index: number;
  name: string;
  /** "Clean electric guitar", "Bass", "Drums", … */
  instrument: string;
  /** 0 when it is not a fretted instrument. */
  strings: number;
  /** A 6-string guitar track: one the teacher can read. */
  guitar: boolean;
  notes: number;
}

export interface ImportedScore {
  tracks: TrackChoice[];
  /** The track `song` was read from: the first guitar track. -1 when there is none. */
  track: number;
  song: Song;
  /** Another track of the same file. Never throws. */
  songFor(track: number): Song;
}

let loading: Promise<AlphaTabModule> | null = null;
function loadAlphaTab(): Promise<AlphaTabModule> {
  loading ??= import("@coderline/alphatab").then(
    (at) => {
      // alphaTab logs through one global logger. Only the reader is used here, and a file it
      // cannot read is answered with a warning in the song, so its console noise is off.
      at.Logger.logLevel = at.LogLevel.None;
      return at;
    },
    (error: unknown) => {
      loading = null; // a failed fetch (offline) can be retried
      throw error;
    },
  );
  return loading;
}

/** Which kind of file it is, for `Song.source`. MusicXML can be plain XML or zipped (.mxl). */
function sourceOf(text: string): Song["source"] {
  if (/<score-(partwise|timewise)/.test(text)) return "musicxml";
  if (text.startsWith("PK") && !text.includes("score.gpif") && /\.(musicxml|xml)/.test(text)) return "musicxml";
  return "guitarpro";
}

/**
 * alphaTab 1.8.4 reads MusicXML hammer-ons and pull-offs, then loses them
 * (and would mark the note after as one), so they are announced instead.
 * Plain .musicxml only: a zipped .mxl is compressed and cannot be peeked at.
 */
const LEGATO_NOT_READ = "Hammer-ons and pull-offs in MusicXML files are not read yet; those notes are taught as picked notes.";

function emptySong(title: string, source: Song["source"], warning: string): Song {
  return { title, tuning: [...STANDARD], capo: 0, tempo: null, timeSignature: null, events: [], sections: [], labels: [], repeats: [], warnings: [warning], source };
}

/** The staff of a track that has tablature: stringed, not drums. */
function frettedStaff(track: Track): Staff | null {
  return track.staves.find((staff) => staff.isStringed && !staff.isPercussion && staff.tuning.length > 0) ?? null;
}

function choiceOf(track: Track): TrackChoice {
  const staff = frettedStaff(track);
  const strings = staff ? staff.tuning.length : 0;
  const program = track.playbackInfo.program;
  const notes = (staff?.bars ?? []).reduce((sum, bar) => sum + bar.voices.reduce((n, voice) => n + voice.beats.reduce((k, beat) => k + beat.notes.length, 0), 0), 0);
  const instrument = track.isPercussion
    ? "Drums"
    : (GUITAR_PROGRAMS[program] ?? (program >= 32 && program <= 39 ? "Bass" : strings === 6 ? "Guitar" : strings > 0 ? `${strings}-string instrument` : "Not a fretted instrument"));
  // A 6-string track with a non-guitar sound (some files leave it on piano) is still read as guitar.
  return { index: track.index, name: track.name.trim() || `Track ${track.index + 1}`, instrument, strings, guitar: strings === 6 && !(program >= 32 && program <= 39), notes };
}

function defaultTrack(tracks: TrackChoice[]): number {
  const pick = tracks.find((t) => t.guitar && t.notes > 0) ?? tracks.find((t) => t.guitar) ?? tracks.find((t) => t.strings > 6 && t.notes > 0);
  return pick ? pick.index : -1;
}

/** Reads a Guitar Pro or MusicXML file. `fileName` is only the fallback title. */
export async function importScore(bytes: Uint8Array, fileName = ""): Promise<ImportedScore> {
  const fallbackTitle = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "Untitled score";
  // Zip entry names are stored uncompressed, so the start and the end are enough to tell the kind.
  const latin1 = new TextDecoder("latin1");
  const peek = bytes.length <= 262144 ? latin1.decode(bytes) : latin1.decode(bytes.subarray(0, 131072)) + latin1.decode(bytes.subarray(bytes.length - 131072));
  const source = sourceOf(peek);
  const legatoLost = source === "musicxml" && /<(hammer-on|pull-off)\b/.test(peek);
  const failed = (warning: string): ImportedScore => {
    const song = emptySong(fallbackTitle, source, warning);
    return { tracks: [], track: -1, song, songFor: () => song };
  };
  let at: AlphaTabModule;
  try {
    at = await loadAlphaTab();
  } catch {
    return failed("Could not load the score reader. Check the connection and try again.");
  }
  let score: Score;
  try {
    score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
  } catch {
    return failed("This file could not be read as Guitar Pro or MusicXML. Try exporting it again, or paste the tab as text.");
  }
  const tracks = score.tracks.map(choiceOf);
  const track = defaultTrack(tracks);
  const songFor = (index: number): Song => {
    try {
      const song = songFromTrack(at, score, index, source, fallbackTitle);
      if (legatoLost && song.events.length > 0) song.warnings.push(LEGATO_NOT_READ);
      return song;
    } catch {
      return emptySong(fallbackTitle, source, "This track could not be read. Try another track, or paste the tab as text.");
    }
  };
  const song = track === -1 ? emptySong(score.title || fallbackTitle, source, "No 6-string guitar track in this file; pick a track to try anyway.") : songFor(track);
  return { tracks, track, song, songFor };
}

function noteOf(at: AlphaTabModule, note: Note, beat: Beat, string: number): TabNote {
  const techniques = new Set<Technique>();
  const origin = note.hammerPullOrigin;
  if (note.isHammerPullDestination && origin) techniques.add(note.fret >= origin.fret ? "hammer" : "pull");
  const slideFrom = note.slideOrigin;
  if (slideFrom && slideFrom.fret !== note.fret) techniques.add(note.fret > slideFrom.fret ? "slideUp" : "slideDown");
  if (note.slideInType === at.model.SlideInType.IntoFromBelow) techniques.add("slideUp");
  if (note.slideInType === at.model.SlideInType.IntoFromAbove) techniques.add("slideDown");
  let bendSemitones: number | undefined;
  const points = note.hasBend ? (note.bendPoints ?? []).map((point) => point.value) : [];
  const peak = points.length ? Math.max(...points) : 0;
  if (peak > 0) {
    techniques.add("bend");
    bendSemitones = peak / 2; // bend points are in quarter tones
    if (points[points.length - 1] < peak) techniques.add("release");
  }
  if (note.vibrato !== at.model.VibratoType.None || beat.vibrato !== at.model.VibratoType.None) techniques.add("vibrato");
  if (note.harmonicType === at.model.HarmonicType.Natural) techniques.add("harmonic");
  if (note.isPalmMute || beat.isPalmMute) techniques.add("palmMute");
  if (note.isDead) techniques.add("dead");
  if (note.isLeftHandTapped || beat.tap) techniques.add("tap");
  return {
    string,
    fret: note.isDead ? 0 : note.fret,
    midi: 0, // set from the tuning and capo below
    techniques: [...techniques],
    ...(bendSemitones !== undefined ? { bendSemitones } : {}),
  };
}

function songFromTrack(at: AlphaTabModule, score: Score, index: number, source: Song["source"], fallbackTitle: string): Song {
  const title = score.title.trim() || fallbackTitle;
  const track = score.tracks[index];
  if (!track) return emptySong(title, source, "There is no such track in this file.");
  const name = track.name.trim() || `Track ${index + 1}`;
  const staff = frettedStaff(track);
  if (!staff) return emptySong(title, source, `"${name}" is not a fretted instrument; pick a guitar track.`);
  const count = staff.tuning.length;
  if (count < 6) return emptySong(title, source, `"${name}" has ${count} strings (bass?); only 6-string guitar is supported yet.`);

  const warnings: string[] = [];
  if (count > 6) warnings.push(`"${name}" has ${count} strings; reading the top six. Notes on the lower strings are left out.`);
  // stringTuning lists the strings top tab line first (high e), ours is low string first.
  const tuning = staff.tuning.slice(0, 6).reverse().map(nameOfMidi);
  if (staff.transpositionPitch !== 0)
    warnings.push(`The file transposes this track by ${staff.transpositionPitch} semitones for playback; the lessons use the fretted pitch.`);

  const events: TabEvent[] = [];
  const barOf: number[] = [];
  let dropped = 0;
  let otherHarmonics = 0;
  let otherVoices = false;
  for (const bar of staff.bars) {
    bar.voices.forEach((voice, v) => {
      if (v > 0) {
        otherVoices ||= voice.beats.some((beat) => !beat.isRest && beat.notes.length > 0);
        return;
      }
      for (const beat of voice.beats) {
        if (beat.isEmpty || beat.isRest || beat.notes.length === 0) continue;
        const start = beat.absolutePlaybackStart / TICKS_PER_QUARTER;
        const length = beat.playbackDuration / TICKS_PER_QUARTER;
        const notes: TabNote[] = [];
        let tied = false;
        for (const note of beat.notes) {
          if (note.isTieDestination) {
            tied = true; // the note before it keeps sounding
            continue;
          }
          // alphaTab counts strings from the lowest; ours count from the high e.
          const string = count + 1 - note.string;
          if (string < 1 || string > 6 || note.fret > MAX_FRET || notes.some((other) => other.string === string)) {
            dropped++;
            continue;
          }
          if (note.harmonicType !== at.model.HarmonicType.None && note.harmonicType !== at.model.HarmonicType.Natural) otherHarmonics++;
          notes.push(noteOf(at, note, beat, string));
        }
        const previous = events[events.length - 1];
        if (notes.length === 0) {
          if (tied && previous && previous.beat !== null) previous.durationBeats = round(start + length - previous.beat);
          continue;
        }
        notes.sort((a, b) => a.string - b.string);
        events.push({ index: events.length, notes, beat: round(start), durationBeats: round(length), spacing: null, sourceLine: bar.index + 1, sourceColumn: beat.index });
        barOf.push(bar.index);
      }
    });
  }
  if (otherVoices) warnings.push("This track has a second voice; only the first is taught.");
  if (dropped > 0) warnings.push(`${dropped} note${dropped === 1 ? "" : "s"} could not be placed on six strings and frets 0-${MAX_FRET}; left out.`);
  if (otherHarmonics > 0) warnings.push(`${otherHarmonics} artificial or pinch harmonic${otherHarmonics === 1 ? " is" : "s are"} read as the fretted note.`);
  if (events.length === 0) warnings.push(`"${name}" has no notes to play.`);

  // Tempo and time signature come from the first bar; changes are reported, not followed.
  const masterBars = score.masterBars;
  const firstTempo = masterBars[0]?.tempoAutomations[0]?.value ?? score.tempo;
  const tempoChange = masterBars.find((bar) => bar.tempoAutomations.some((a) => a.value !== firstTempo));
  if (tempoChange) {
    const to = tempoChange.tempoAutomations.find((a) => a.value !== firstTempo)!.value;
    warnings.push(`The tempo changes to ${Math.round(to)} BPM in bar ${tempoChange.index + 1}; lessons use the opening ${Math.round(firstTempo)} BPM.`);
  }
  const first = masterBars[0];
  const timeSignature: [number, number] | null = first ? [first.timeSignatureNumerator, first.timeSignatureDenominator] : null;
  const meterChange = masterBars.find((bar) => timeSignature && (bar.timeSignatureNumerator !== timeSignature[0] || bar.timeSignatureDenominator !== timeSignature[1]));
  if (meterChange) warnings.push(`The time signature changes to ${meterChange.timeSignatureNumerator}/${meterChange.timeSignatureDenominator} in bar ${meterChange.index + 1}.`);

  const firstEventIn = (fromBar: number, toBar = Infinity) => barOf.findIndex((bar) => bar >= fromBar && bar <= toBar);
  const labels: SectionLabel[] = [];
  const repeats: RepeatHint[] = [];
  let repeatStart = 0;
  for (const bar of masterBars) {
    if (bar.isRepeatStart) repeatStart = bar.index;
    const text = bar.section ? (bar.section.text || bar.section.marker).trim() : "";
    const firstEvent = firstEventIn(bar.index);
    if (text && firstEvent !== -1) labels.push({ name: text, beforeEvent: firstEvent, sourceLine: bar.index + 1 });
    if (bar.repeatCount > 1) {
      const from = firstEventIn(repeatStart, bar.index);
      let to = -1;
      barOf.forEach((b, i) => {
        if (b >= repeatStart && b <= bar.index) to = i;
      });
      if (from !== -1) repeats.push({ fromEvent: from, toEvent: to, times: bar.repeatCount, sourceLine: bar.index + 1 });
      repeatStart = bar.index + 1;
    }
  }

  const song: Song = {
    title,
    ...(score.artist.trim() ? { artist: score.artist.trim() } : {}),
    tuning,
    capo: staff.capo,
    tempo: Math.round(firstTempo) || null,
    timeSignature,
    events,
    sections: [],
    labels,
    repeats,
    warnings,
    source,
  };
  return retune(song, tuning, song.capo);
}
