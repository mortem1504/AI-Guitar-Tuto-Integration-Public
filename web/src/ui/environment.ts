/**
 * A gentle word about where the instrument runs best, shown on the start card.
 *
 * Two facts learned by playing, not by benchmarks: real Safari struggles with
 * the camera-plus-audio load and the sound can crackle, and a phone camera
 * frames two hands too tightly to play. Neither blocks anything — the player
 * is warned kindly and the start button stays right there.
 */

export type EnvironmentHint = "mobile" | "safari" | null;

/** Pure so it can be exercised with any user agent string. */
export function environmentHintFor(userAgent: string, coarsePointer: boolean, shortSide: number): EnvironmentHint {
  // Phones first: an iPhone reports Safari too, and the framing problem is the
  // one that actually decides whether playing is possible. The short side of
  // the screen separates phones (≤ ~450) from tablets (≥ ~744), which frame
  // two hands well enough to be left alone.
  if (coarsePointer && shortSide < 700) return "mobile";

  // Every browser on iOS and several imitators carry the word "Safari";
  // the real one is the only one without a sibling engine token.
  const looksSafari = /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edg|android/i.test(userAgent);
  return looksSafari ? "safari" : null;
}

export function environmentHint(): EnvironmentHint {
  return environmentHintFor(
    navigator.userAgent,
    window.matchMedia("(pointer: coarse)").matches,
    Math.min(window.screen.width, window.screen.height),
  );
}
