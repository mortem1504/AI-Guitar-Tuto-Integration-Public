/**
 * Listen: how a passage should sound, played by a very plain plucked synth.
 *
 * The one place the app makes music, and only when the player presses
 * Listen. Everything else stays silent: the sound of a lesson is the
 * student's guitar. While it plays, the lesson's ears are shut (`NotesPanel.mute`)
 * so the speakers are never graded as the player.
 *
 * Its own AudioContext, made on the click (browsers allow sound only after a
 * gesture) and closed when the passage ends. Nothing here touches the
 * microphone. A sawtooth through a closing low-pass with a fast decay is
 * enough to recognise a melody and its rhythm; it does not try to sound like
 * a guitar.
 */

import type { ListenMoment } from "../song/lesson";
import type { TabNote } from "../song/model";

/** Notes of a chord are strummed low to high this far apart: a quick downstroke. */
const STRUM_SECONDS = 0.02;
/** Loud enough to hear over a fan, quiet enough that a chord of six does not clip. */
const LEVEL = 0.22;
/** A bend reaches its target in this long (or half the note, if shorter): the speed of a deliberate bend. */
const BEND_SECONDS = 0.15;
/** Silence left after the last note for its ring to finish before the context closes. */
const TAIL_SECONDS = 0.4;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class ListenSynth {
  private context: AudioContext | null = null;
  private timer = 0;

  static supported(): boolean {
    return typeof AudioContext !== "undefined";
  }

  get playing(): boolean {
    return this.context !== null;
  }

  /** Plays the moments; resolves with how long it takes, in ms, once it has started. */
  async play(moments: readonly ListenMoment[], onEnd: () => void): Promise<number> {
    this.stop();
    const context = new AudioContext();
    this.context = context;
    await context.resume();
    const out = context.createGain();
    out.gain.value = LEVEL;
    out.connect(context.destination);
    const start = context.currentTime + 0.1;
    let end = start;
    for (const moment of moments) {
      // Low string first, as a pick falls across a chord.
      const notes = [...moment.notes].sort((a, b) => b.string - a.string);
      notes.forEach((note, k) => {
        const at = start + moment.at + k * STRUM_SECONDS;
        this.voice(context, out, note, at, moment.seconds, 1 / Math.sqrt(notes.length));
        end = Math.max(end, at + moment.seconds);
      });
    }
    const ms = (end - context.currentTime + TAIL_SECONDS) * 1000;
    this.timer = window.setTimeout(() => {
      this.stop();
      onEnd();
    }, ms);
    return ms;
  }

  stop() {
    clearTimeout(this.timer);
    const context = this.context;
    this.context = null;
    if (context) void context.close();
  }

  private voice(context: AudioContext, out: AudioNode, note: TabNote, at: number, seconds: number, level: number) {
    const dead = note.techniques.includes("dead");
    const ring = dead ? 0.05 : seconds;
    const osc = context.createOscillator();
    // A harmonic is nearly a pure tone; everything else is a bright pluck.
    osc.type = note.techniques.includes("harmonic") ? "sine" : dead ? "triangle" : "sawtooth";
    osc.frequency.value = hz(note.midi);
    if (note.techniques.includes("bend") && note.bendSemitones) {
      osc.detune.setValueAtTime(0, at);
      osc.detune.linearRampToValueAtTime(note.bendSemitones * 100, at + Math.min(BEND_SECONDS, ring / 2));
    }
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    // The pluck's brightness fades as it rings, as a string's high partials die first.
    filter.frequency.setValueAtTime(note.techniques.includes("palmMute") ? 900 : 3200, at);
    filter.frequency.exponentialRampToValueAtTime(600, at + ring);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + ring + 0.05);
  }
}
