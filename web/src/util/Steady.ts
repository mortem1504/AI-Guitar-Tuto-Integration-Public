/**
 * Anti-flicker for discrete values.
 *
 * The model occasionally disagrees with itself for a frame about whether a
 * finger is straight. Acting on every frame would make the chord stutter, so a
 * new value has to hold for a few frames before it is accepted. Going back to
 * the value already held is free — that way letting go is instant while
 * changing chords is deliberate.
 */
export class Steady<T> {
  private candidate: T;
  private streak = 0;

  constructor(
    private value: T,
    private framesNeeded = 4,
  ) {
    this.candidate = value;
  }

  push(next: T): T {
    if (next === this.value) {
      this.candidate = next;
      this.streak = 0;
      return this.value;
    }
    if (next === this.candidate) {
      this.streak++;
    } else {
      this.candidate = next;
      this.streak = 1;
    }
    if (this.streak >= this.framesNeeded) {
      this.value = next;
      this.streak = 0;
    }
    return this.value;
  }

  get current(): T {
    return this.value;
  }

  /** How many frames a new value has to hold. Higher is calmer and slower. */
  setFramesNeeded(frames: number) {
    this.framesNeeded = Math.max(1, Math.round(frames));
  }

  reset(value: T) {
    this.value = value;
    this.candidate = value;
    this.streak = 0;
  }
}
