/**
 * Finding the neck without being told where it is.
 *
 * Still the part of this app that does not work, and the history is kept here
 * because every version failed for a reason worth remembering.
 *
 * The first one took the principal axis of every strong edge in the frame and
 * assumed it would be the neck, "because the strings dominate any picture with
 * a guitar in it". They do not: a bed, a pillow, a shirt with lettering and a
 * doorway all have edges, and together they outvote six thin strings easily.
 *
 * The second looked for the pattern a guitar has and a room does not — six
 * roughly parallel lines at roughly equal spacing — and announced a neck
 * across a bedroom anyway, because *evenly spaced stripes are everywhere*: a
 * blanket, a radiator, the slats of a blind, the ribs of a pillow.
 *
 * This one leans on the thing that is not everywhere. Frets are not evenly
 * spaced: they crowd towards the bridge by exactly `2^(-n/12)`, a ratio fixed
 * by twelve-tone tuning and shared by every guitar ever built, and nothing in
 * an ordinary room does that. So:
 *
 *   1. Shrink, grey, Sobel. Keep the strongest edges by *percentile*, so one
 *      bright object cannot raise the bar until the strings fall under it.
 *   2. Hough, with each edge voting only for its own gradient direction — used
 *      to find *directions*, never positions.
 *   3. Every evenly spaced bundle is a candidate, read once as the strings and
 *      once as the frets, because on a neck with ten frets in view the frets
 *      form the longer even run and win the search outright.
 *   4. Both sets of lines are then *measured* off a one-pixel edge profile,
 *      not read off the Hough bins, and the lines along the neck are fitted
 *      against the fret progression. A blanket cannot fit it; and it has to
 *      fit better than a straight line does, or nothing is claimed.
 *   5. What survives is checked against the instrument's own proportions: a
 *      scale length is more than ten times the width of the neck, and a
 *      fretboard is a trapezoid and never a wedge.
 *
 * Two things it cannot do, on purpose rather than for now. It cannot tell the
 * thick E from the thin E — that is which way round the guitar is, not what
 * shape it is. And it cannot say *which* fret a wire is from the wires alone:
 * fret positions are invariant to a shift of fret number (see
 * `fitFretProgression`), so the numbering only comes out once the nut is
 * anchored to where the strings stop.
 *
 * Measured with two harnesses, both of which run with no camera:
 * `npm run fret-check` for the progression maths, and `npm run neck-check --
 * photo.png` for the whole pipeline over a still — `node scripts/scene.mjs`
 * draws stills to scale, and any photograph works once it is a PNG.
 *
 * Where it stands, as of F14, measured against seven webcam frames of a real
 * guitar in a real room: **seven nulls**. It no longer offers junk, and that
 * is the whole of the improvement. The failure is in step 1 and it is now
 * known rather than suspected — in none of the seven does the bundle search
 * return a bundle that is the guitar's strings or frets. The room's edges (a
 * bed frame, a headboard, a pillow, the folds of a shirt) take all ninety
 * Hough peaks, and the candidate bands came out 400 to 575 working pixels
 * across where the neck is about 32. Everything below step 3 was reading the
 * room.
 *
 * The lead for the next attempt, also from those frames: the *profile* finds
 * real frets even inside a band that is not the neck. So the search should be
 * driven by it — find the fretboard as a region first (dark, smooth,
 * elongated, with a bright regular grid on it), or sweep directions and bands
 * directly — rather than by whichever lines survived Hough.
 *
 * `autoDetect` therefore still ships **off** and manual calibration is still
 * the ground truth. Do not turn it on without evidence from real photographs.
 */

import type { Corners } from "../guitar/Fretboard";
import { looksLikeNeck } from "../guitar/corners";
import type { Point } from "./landmarks";

/**
 * The width the frame is shrunk to before anything is measured.
 *
 * Measured against a real photograph rather than picked: at 320 the six strings
 * land about three pixels apart and the bundle that comes back is tilted some
 * ten degrees off the real neck. At 480 the same photograph gives the neck
 * angle to within a degree. Wider costs more and gains nothing here, because
 * the search runs on demand and never per frame.
 */
export const WORK_WIDTH = 480;

/**
 * The share of pixels kept as edges. A percentile, not a ratio to the single
 * strongest edge: that ratio is what let a white logo on a T-shirt put the bar
 * above every string in the picture.
 */
const EDGE_PERCENTILE = 0.08;

/**
 * How strong a Hough peak has to be, relative to the strongest one, to count.
 *
 * This one constant was the whole failure on the first real photograph. At 0.25
 * that frame produced *three* lines in total: a guitar string is thin and
 * short, and the edge of a bed or a bright doorway outvotes it many times over,
 * so everything that mattered fell under a quarter of the best peak. Dropped to
 * 0.05, the same frame yields sixty-odd lines, six of which are the strings.
 *
 * Letting junk through is safe here in a way it would not be in a classical
 * pipeline, because nothing downstream trusts an individual line: the bundle
 * search only accepts lines that are parallel *and* evenly spaced, and a room
 * does not produce those by accident.
 */
const PEAK_THRESHOLD = 0.05;

/** How far two lines can differ in angle and still belong to one bundle. */
const BUNDLE_SPREAD_DEG = 12;

/** How far a fret can be from square to the strings. */
const CROSS_TOLERANCE_DEG = 30;

/** A string bundle needs at least this many lines. Six exist; some hide. */
const MIN_STRINGS = 4;

/** How much the gaps in a bundle may wander from their average. */
const SPACING_TOLERANCE = 0.3;

/**
 * How many times the width of the neck the scale length has to be.
 *
 * From the instrument, not from a photograph: nuts are 43 to 52 mm across and
 * scale lengths 630 to 650 mm, which is a ratio above twelve, and the neck is
 * only a few millimetres wider at the twelfth fret. Five is far below anything
 * a guitar can be and still rules out the picture read sideways.
 */
const MIN_SCALE_TO_WIDTH = 5;

/** How much wider one end of the neck may look than the other. */
const MAX_TAPER = 2;

/**
 * How many times the width between the outer strings the scale length is.
 *
 * This is the number that breaks the shift ambiguity, and it comes from the
 * instrument. The outer strings are 35 mm apart at the nut on a steel string
 * and 43 mm on a classical, spreading to around 46 and 56 at the twelfth fret,
 * against scale lengths of 630 to 650 mm — so the ratio sits between about
 * fourteen and eighteen whatever guitar it is and wherever along the neck it
 * is measured. Sixteen is the middle of that.
 *
 * Why it matters: a fret progression fits equally well shifted by k frets with
 * the scale multiplied by 2^(k/12) — see `fitFretProgression` — so nothing in
 * the wires themselves says whether the first one is fret 1 or fret 4. On the
 * first real photographs the fit landed three frets out, on the right
 * fretboard, at the right angle, with the right width. The width is what says
 * which shift is the real one.
 */
const SCALE_OVER_WIDTH = 16;

/** How far off that ratio a picture may be and still be a guitar: a neck tilted
 *  away from the camera is foreshortened along its length but not across it. */
const SCALE_SLACK = 1.6;

export interface NeckDetection {
  /** In camera coordinates, going around the quad. */
  corners: Corners;
  /** These corners sit on the outer strings, not on the edge of the wood. */
  cornersAt: "strings";
  /** Which fret the far pair is on: the corners are the nut and this fret. */
  farFret: number;
  /** 0 to 1 — how much of the expected structure was actually found. */
  confidence: number;
}

/** A line in the working image, as normal angle and distance from the origin. */
interface HoughLine {
  theta: number;
  rho: number;
  votes: number;
}

interface Bundle {
  lines: HoughLine[];
  /** The shared normal direction the bundle was measured along. */
  theta: number;
  /** How uneven the spacing is: 0 is perfect. */
  unevenness: number;
  /** The average gap between neighbouring lines, in working pixels. */
  spacing: number;
}

export class NeckDetector {
  private canvas = document.createElement("canvas");

  /**
   * Looks at one frame. Returns null whenever the picture does not clearly
   * contain a neck, which is the common case and must stay cheap and quiet.
   */
  /**
   * Looks at one frame. Returns null whenever the picture does not clearly
   * contain a neck, which is the common case and must stay cheap and quiet.
   */
  detect(video: HTMLVideoElement): NeckDetection | null {
    const frame = this.grab(video);
    if (!frame) return null;
    return detectInGrey(frame.data, frame.width, frame.height);
  }

  /** One frame, shrunk and greyed. Null while the camera has nothing to give. */
  private grab(video: HTMLVideoElement): { data: Float32Array; width: number; height: number } | null {
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    const width = WORK_WIDTH;
    const height = Math.max(2, Math.round((video.videoHeight / video.videoWidth) * width));
    this.canvas.width = width;
    this.canvas.height = height;

    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);

    const pixels = context.getImageData(0, 0, width, height).data;
    const grey = new Float32Array(width * height);
    for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
      // Rec. 601 luma: strings are bright metal on dark wood, and weighting
      // green the way the eye does keeps that contrast.
      grey[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    }
    return { data: grey, width, height };
  }
}

/**
 * The detector proper, over a greyscale frame.
 *
 * Separated from the class so it can be run against a still photograph with no
 * canvas and no camera — which is how the constants above were set, and how the
 * bedroom frame that broke the first version is now a regression check rather
 * than a story.
 */
export function detectInGrey(grey: Float32Array, width: number, height: number): NeckDetection | null {
  const fields = gradients(grey, width, height);
  const edges = edgesFrom(fields, width, height, EDGE_PERCENTILE);
  if (edges.length < 250) return null;

  const lines = hough(edges, width, height);
  if (lines.length < MIN_STRINGS + 2) return null;

  const centre = { x: width / 2, y: height / 2 };

  // Several things in a room are stripes. A bed, a blanket, a radiator, the
  // slats of a blind — and on the photograph that this detector was built
  // against, the winning "string bundle" was a stretch of bedding along the
  // bottom of the frame, at almost exactly the angle of the real neck.
  //
  // What separates a guitar from all of them is that it has stripes in *both*
  // directions: strings, and wires crossing them, and the crossing ones crowd
  // together by 2^(-n/12). So every plausible bundle is tried and the *frets*
  // choose between them — not the one with the most crossing lines, which is a
  // contest a bedspread can win, but the one whose crossing lines actually fit
  // a fretboard. A blanket has no frets.
  const candidates = findEvenBundles(lines, centre);
  if (candidates.length === 0) return null;

  // Each bundle is read twice, because a bundle of evenly spaced lines on a
  // guitar is as likely to be the frets as the strings — measured on a drawn
  // neck, the *frets* win the even-run contest every time (there are ten of
  // them and only six strings), and the string bundle did not even make the
  // shortlist. So both readings are tried and the fret fit picks the winner.
  let chosen: Reading | null = null;
  for (const candidate of candidates) {
    for (const role of ["strings", "frets"] as const) {
      const reading = readBundle(candidate, fields, centre, width, height, role);
      if (reading && (!chosen || better(reading.fit, chosen.fit))) chosen = reading;
    }
  }

  // Nothing in the picture had frets on it, whatever else was striped.
  if (!chosen) return null;

  const { nut, end, fit, farFret } = chosen;
  const toCamera = (point: Point): Point => ({ x: point.x / width, y: point.y / height });
  const corners: Corners = [toCamera(nut[0]), toCamera(nut[1]), toCamera(end[0]), toCamera(end[1])];

  if (!corners.every((point) => point.x > -0.4 && point.x < 1.4 && point.y > -0.4 && point.y < 1.4)) return null;
  // A last check on the shape itself: long, thin, and not folded over.
  if (!looksLikeNeck(corners)) return null;

  // And big. A student points a camera at a guitar; a neck that occupies a
  // twentieth of the frame is something else in the room that happens to be
  // striped, and accepting it wastes the one moment of trust the feature gets.
  const length = (span(nut[0], end[1]) + span(nut[1], end[0])) / 2;
  if (length < Math.max(width, height) * 0.25) return null;

  // A guitar is not merely striped in two directions, it has *proportions*: a
  // nut is around 45 mm across and a scale length is around 640 mm, so the
  // scale is more than ten times the width of the neck at every fret. This is
  // what finally caught the last false positive, which was a real guitar read
  // sideways — its six strings converge with perspective, and a converging
  // bundle crowds exactly the way frets do, so the strings fitted the fret
  // curve and produced a neck as wide as the real one was long.
  const atNut = span(nut[0], nut[1]);
  const atEnd = span(end[0], end[1]);
  if (Math.abs(fit.scale) < ((atNut + atEnd) / 2) * MIN_SCALE_TO_WIDTH) return null;

  // And it is a neck, not a wedge. A fretboard widens by about a third from
  // the nut to the twelfth fret, and perspective can shrink the far end by
  // roughly as much again, but nothing turns it into a triangle. Measured, the
  // detector produced exactly that — 26 pixels across at the nut and 340 at
  // the far end — because the two lines it took for the outer strings were not
  // parallel and met just past the nut.
  if (atNut <= 0 || atEnd <= 0) return null;
  const taper = atEnd / atNut;
  if (taper < 1 / MAX_TAPER || taper > MAX_TAPER) return null;

  // Confidence is now mostly about the frets, and that is the whole change of
  // mind in this file. Six even lines were never the evidence — a bedspread has
  // those — and weighting them heaviest is what let the detector announce a
  // neck across a bedroom with a straight face. Frets that fit one scale are
  // the evidence; the lines along the neck only say which way it runs.
  const fretScore = Math.min(1, fit.frets.length / 6) * fit.score;
  return {
    corners,
    // Both readings put the corners on the outer strings, never on the wood:
    // the strings are what either path actually located.
    cornersAt: "strings",
    farFret,
    confidence: fretScore * 0.7 + Math.min(1, chosen.alongLines / 6) * 0.3,
  };
}

/** One bundle read all the way through, into the quad the app speaks in. */
interface Reading {
  /** The two corners at the nut, in working pixels. */
  nut: [Point, Point];
  /** The two at the far end, going around the quad. */
  end: [Point, Point];
  /** Which fret the far pair sits on, from the fit rather than from a guess. */
  farFret: number;
  fit: FretFit;
  /** How many lines were found running along the neck, for the confidence. */
  alongLines: number;
}

/**
 * Reads one bundle of even lines as a neck, taking the bundle to be either the
 * strings or the frets.
 *
 * Both readings are needed and neither is the primary one. Close up, the
 * strings are the clearest lines in the frame; on a neck with ten frets in
 * view the *frets* form the longer even run and win the bundle search outright,
 * which is what left the string bundle off the shortlist entirely and had the
 * detector reporting quads turned ninety degrees. Whichever the bundle is, the
 * lines crossing it are the other thing, and the same fret fit decides.
 *
 * The nut is never inferred from the wires alone, and that is not a shortcut —
 * it is forced. Fret positions are *invariant to a shift of fret number*:
 * `nut + scale·(1 - 2^(-n/12))` with the frets renumbered n+k is exactly the
 * same set of positions with the scale multiplied by 2^(k/12). Measured, a
 * clean run of frets 1 to 7 fits frets 4 to 10 to one part in a trillion. So
 * the wires can say "these are frets" and never "this is the fifth" — for that
 * the fit needs the end where the lines stop, which is the nut.
 */
function readBundle(
  candidate: Bundle,
  fields: Gradients,
  centre: Point,
  width: number,
  height: number,
  role: "strings" | "frets",
): Reading | null {
  // Both directions are measured off the profile, and neither is taken from
  // the Hough peaks. A peak is a bin: its angle is quantised to a degree and
  // its position to a pixel, which is fine for finding a direction and useless
  // as a measurement. Taking the outer strings straight from the bundle
  // produced a quad 11 pixels across at the nut and 81 at the other end — a
  // wedge, from two "parallel" strings a few degrees apart. See `stripePeaks`.
  const axis = role === "strings" ? candidate.theta + Math.PI / 2 : candidate.theta;
  const across = axis + Math.PI / 2;
  const overFrets = bandFilter(candidate, centre, axis);
  const overStrings = bandFilter(candidate, centre, across);

  // How wide the neck is, provisionally, because the frets are only counted
  // where they cross all of it. When the bundle is the strings the band
  // already says; when it is the frets, the lines running the other way do,
  // and they are measured with no lanes of their own — there is nothing yet to
  // bound them by, which is the price of taking this reading at all.
  const sides =
    role === "strings"
      ? bandRange(candidate, centre)
      : spanOf(stripePeaks(fields, width, height, overStrings, centre, across));
  if (!sides) return null;

  // Along the neck: the frets. This is the set the fret progression is fitted
  // to, and the gaps between them have to be right to a fraction of a pixel.
  const wires = stripePeaks(
    fields,
    width,
    height,
    overFrets,
    centre,
    axis,
    lanesBetween(centre, across, sides.low, sides.high),
  );
  if (wires.length < MIN_FITTED_WIRES) return null;

  // The nut is anchored to a *wire*, and this is the correction the first real
  // photographs forced. The nut used to be taken from where the strings stop,
  // which is true of a drawing and false of a guitar: real strings run from
  // the bridge to the tuning pegs, so both of their ends are somewhere else
  // entirely and the nut is a quarter of the way along. What the nut actually
  // is, in a picture, is the last wire — the frets end there and the headstock
  // has none — and it is a bright line in its own right. So each end of the
  // run of wires is tried as the nut, and being an end is what says there is
  // nothing behind it.
  // What the neck's width says the scale should be. Provisional, like the
  // width it comes from, and used as a preference and a loose bound rather
  // than as a measurement.
  const expected = (sides.high - sides.low) * SCALE_OVER_WIDTH;
  const fromLow = fitFretProgression(wires, wires[0], expected);
  const fromHigh = fitFretProgression(wires, wires[wires.length - 1], expected);
  if (!fromLow && !fromHigh) return null;

  const nutIsLow = !fromHigh || (Boolean(fromLow) && better(fromLow as FretFit, fromHigh));
  const fit = (nutIsLow ? fromLow : fromHigh) as FretFit;

  // And the far end of the quad is the furthest fret that was actually found,
  // rather than however far some edge in the room happened to run. It makes
  // the quad and the fret number it is announced with one measurement instead
  // of two that have to agree.
  const farFret = fit.frets[fit.frets.length - 1];
  const farEnd = fit.nut + fit.scale * fretAt(farFret);

  // Across the neck: the strings, for the edges of the quad, now that there is
  // a stretch of neck to demand they run the length of. Deliberately not
  // clipped to a plausible width first: a clip like that was tried and it made
  // the checks at the end meaningless — it narrowed every quad until anything
  // passed them, and a striped blanket came back as a guitar again.
  const strings = stripePeaks(
    fields,
    width,
    height,
    overStrings,
    centre,
    across,
    lanesBetween(centre, axis, fit.nut, farEnd),
  );
  // Two lines running along something is also what a table edge and a door
  // frame look like. Three is a string bundle.
  if (strings.length < 3) return null;

  // The edges are built parallel, both square to the measuring direction,
  // rather than from two lines found separately. A real neck does widen
  // towards the body and this gives that up — the trapezoid becomes a
  // parallelogram, and the student straightens it by hand if it matters — in
  // exchange for a quad that cannot come out as a triangle.
  const outer: [HoughLine, HoughLine] = [
    lineAcross(centre, across, across, strings[0]),
    lineAcross(centre, across, across, strings[strings.length - 1]),
  ];

  return quadFrom(fit, farEnd, farFret, outer, centre, axis, strings.length);
}

/** The stretch a set of positions covers, or null when there are too few of
 *  them to be the sides of anything. */
function spanOf(positions: number[]): { low: number; high: number } | null {
  if (positions.length < 3) return null;
  return { low: positions[0], high: positions[positions.length - 1] };
}

/** The quad, from a fit that knows where the nut is and a far end in pixels. */
function quadFrom(
  fit: FretFit,
  farEnd: number,
  farFret: number,
  outer: [HoughLine, HoughLine],
  centre: Point,
  axis: number,
  alongLines: number,
): Reading | null {
  if (farFret < 5 || farFret > MAX_FIT_FRET) return null;

  // The nut comes from the fit, not from where the strings were trimmed: the
  // progression extrapolates back to it, which is more precise than an edge
  // histogram and is the whole reason the fit bothers to refine it.
  const nutLine = lineAcross(centre, axis, axis, fit.nut);
  const farLine = lineAcross(centre, axis, axis, farEnd);

  const nutA = intersect(nutLine, outer[0]);
  const nutB = intersect(nutLine, outer[1]);
  const farA = intersect(farLine, outer[0]);
  const farB = intersect(farLine, outer[1]);
  if (!nutA || !nutB || !farA || !farB) return null;

  return { nut: [nutA, nutB], end: [farB, farA], farFret, fit, alongLines };
}

/**
 * Edge magnitude, summed into one-pixel bins along a direction. The one
 * measurement everything else in this file is built out of.
 *
 * With `lanes`, a bin only counts what is present in *every* lane across the
 * band, which is the difference between working on a drawing and working on a
 * photograph of a room. A fret crosses the whole fretboard; a fold in a shirt,
 * the edge of a pillow and the line where a sleeve meets an arm cross part of
 * the band and stop. On the first real photograph the plain profile returned
 * forty wires where the guitar has twelve, and the neck ran the full width of
 * the frame — the shirt was in the band too. Taking the smallest lane instead
 * of the sum asks "does this line go all the way across", and only a fret,
 * the nut, or something else lying on the fretboard can answer yes.
 */
function project(
  fields: Gradients,
  width: number,
  height: number,
  accepts: (x: number, y: number, theta: number) => boolean,
  centre: Point,
  normal: number,
  lanes?: (x: number, y: number) => number,
): { bins: Float32Array; origin: number } {
  const origin = Math.ceil(Math.hypot(width, height));
  const count = lanes ? LANES : 1;
  const rows: Float32Array[] = [];
  for (let lane = 0; lane < count; lane++) rows.push(new Float32Array(origin * 2 + 2));
  const cos = Math.cos(normal);
  const sin = Math.sin(normal);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const magnitude = fields.magnitude[i];
      if (magnitude <= 0) continue;
      if (!accepts(x, y, normalizeAngle(fields.angle[i]))) continue;
      const lane = lanes ? lanes(x, y) : 0;
      if (lane < 0 || lane >= count) continue;
      const bin = Math.round((x - centre.x) * cos + (y - centre.y) * sin) + origin;
      if (bin < 0 || bin >= rows[lane].length) continue;
      rows[lane][bin] += magnitude;
    }
  }

  if (count === 1) return { bins: rows[0], origin };

  // A wire lands a pixel either side of its bin in one lane and not in the
  // next, so each lane is read at its best over a small neighbourhood before
  // the lanes are compared. Without that the minimum is always near zero.
  const bins = new Float32Array(rows[0].length);
  for (let bin = 0; bin < bins.length; bin++) {
    let worst = Infinity;
    for (const row of rows) {
      let best = 0;
      for (let d = -2; d <= 2; d++) {
        const at = bin + d;
        if (at >= 0 && at < row.length && row[at] > best) best = row[at];
      }
      if (best < worst) worst = best;
    }
    bins[bin] = worst * count;
  }
  return { bins, origin };
}

/** How many strips across the band a line has to appear in. */
const LANES = 4;

/**
 * Splits a stretch into lanes, for `project`.
 *
 * The lanes always run *across* the direction being measured, and getting that
 * backwards is a silent way to measure nothing: asked for the frets with the
 * lanes laid out along the neck, the profile demanded that each fret appear
 * over the neck's whole length and returned zero wires on every photograph.
 */
function lanesBetween(centre: Point, across: number, from: number, to: number): (x: number, y: number) => number {
  const low = Math.min(from, to);
  const span = Math.max(1e-6, Math.abs(to - from));
  const cos = Math.cos(across);
  const sin = Math.sin(across);
  return (x, y) => {
    const at = (x - centre.x) * cos + (y - centre.y) * sin;
    return Math.min(LANES - 1, Math.floor(((at - low) / span) * LANES));
  };
}

/**
 * Where a set of parallel lines actually sits, to a fraction of a pixel.
 *
 * The Hough peaks are good enough to find a *direction* and hopeless as a
 * measurement: a peak is a bin, and on a shrunk frame a fret's bin lands a
 * pixel or two off. That is fatal here, because the whole discriminator is the
 * shape of the gaps between the frets — measured on a drawn neck, gaps that
 * should have read 26, 24, 23, 22, 21, 20 came back as 22.6, 21.1, 20.7, 16.5,
 * 20.6, which is not a fret progression and is not even monotonic. The
 * detector then found the neck at one working width and lost it at the next,
 * which is the signature of a noisy estimator rather than of a wrong idea.
 *
 * So the positions are measured instead of voted for: every edge pixel in the
 * band drops its gradient magnitude into a one-pixel bin along the direction
 * being measured, and the peaks of that profile are the lines. Each fret then
 * contributes hundreds of pixels to its own position, and a parabola through
 * the peak and its neighbours puts it between bins.
 */
function stripePeaks(
  fields: Gradients,
  width: number,
  height: number,
  accepts: (x: number, y: number, theta: number) => boolean,
  centre: Point,
  normal: number,
  lanes?: (x: number, y: number) => number,
): number[] {
  const { bins, origin } = project(fields, width, height, accepts, centre, normal, lanes);

  // A wire is two or three pixels wide once the frame has been shrunk, so a
  // little smoothing turns its pair of edges into one peak.
  const smooth = new Float32Array(bins.length);
  for (let i = 1; i < bins.length - 1; i++) smooth[i] = bins[i - 1] + 2 * bins[i] + bins[i + 1];

  let best = 0;
  for (const value of smooth) if (value > best) best = value;
  if (best <= 0) return [];

  const found: { at: number; value: number }[] = [];
  for (let i = 1; i < smooth.length - 1; i++) {
    const value = smooth[i];
    if (value < best * WIRE_THRESHOLD) continue;
    if (value < smooth[i - 1] || value < smooth[i + 1]) continue;
    const curvature = smooth[i - 1] - 2 * value + smooth[i + 1];
    const shift = curvature === 0 ? 0 : (0.5 * (smooth[i - 1] - smooth[i + 1])) / curvature;
    found.push({ at: i - origin + (Math.abs(shift) < 1 ? shift : 0), value });
  }

  // Strongest first, so that where two peaks are too close together to be
  // separate wires, the one more likely to be a wire is the one that survives.
  const kept: { at: number; value: number }[] = [];
  for (const peak of found.sort((a, b) => b.value - a.value)) {
    if (kept.some((entry) => Math.abs(entry.at - peak.at) < WIRE_MERGE)) continue;
    kept.push(peak);
  }
  return kept.map((peak) => peak.at).sort((a, b) => a - b);
}

/**
 * Which of two fits explains more.
 *
 * Frets found first, then how well the scale agrees with the width of the neck,
 * and only then tightness. The middle term is what decides between two fits of
 * the same curve shifted by a fret or two, which the wires alone cannot do; a
 * quarter of an octave of ratio is about three frets of shift, so anything
 * closer than that is a real difference in explanation rather than in shift.
 */
function better(fit: FretFit, than: FretFit): boolean {
  if (fit.frets.length !== than.frets.length) return fit.frets.length > than.frets.length;
  if (Math.abs(fit.offBy - than.offBy) > 0.02) return fit.offBy < than.offBy;
  return fit.residual / Math.abs(fit.scale) < than.residual / Math.abs(than.scale);
}

interface Edge {
  x: number;
  y: number;
  /** Gradient direction, which is the normal of the line the edge lies on. */
  theta: number;
  magnitude: number;
}

interface Gradients {
  magnitude: Float32Array;
  angle: Float32Array;
}

/** Sobel over the whole frame, kept as raw fields so any region can be
 *  thresholded on its own terms afterwards. */
function gradients(grey: Float32Array, width: number, height: number): Gradients {
  const magnitude = new Float32Array(width * height);
  const angle = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = grey[i - width - 1];
      const t = grey[i - width];
      const tr = grey[i - width + 1];
      const l = grey[i - 1];
      const r = grey[i + 1];
      const bl = grey[i + width - 1];
      const b = grey[i + width];
      const br = grey[i + width + 1];

      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);

      magnitude[i] = Math.hypot(gx, gy);
      angle[i] = Math.atan2(gy, gx);
    }
  }

  return { magnitude, angle };
}

/**
 * The strongest edges among the pixels a filter admits, by percentile *of that
 * selection*. Passing no filter gives the frame-wide edges; passing the string
 * band gives the fret wires, which are strong locally and invisible globally.
 */
function edgesFrom(
  fields: Gradients,
  width: number,
  height: number,
  keep: number,
  accepts?: (x: number, y: number, theta: number) => boolean,
): Edge[] {
  const candidates: Edge[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const magnitude = fields.magnitude[i];
      if (magnitude <= 0) continue;
      const theta = normalizeAngle(fields.angle[i]);
      if (accepts && !accepts(x, y, theta)) continue;
      candidates.push({ x, y, theta, magnitude });
    }
  }
  if (candidates.length === 0) return [];

  const wanted = Math.max(1, Math.round(candidates.length * keep));
  candidates.sort((a, b) => b.magnitude - a.magnitude);
  return candidates.slice(0, wanted);
}

/**
 * The Hough transform, with one shortcut that matters: an edge pixel already
 * knows which way its line runs, so it votes for one angle instead of all 180.
 * That turns the transform from the expensive part of this file into the cheap
 * one, and sharpens the peaks as a side effect.
 */
function hough(edges: Edge[], width: number, height: number): HoughLine[] {
  const thetaBins = 180;
  const diagonal = Math.hypot(width, height);
  const rhoBins = Math.ceil(diagonal * 2);
  const accumulator = new Float32Array(thetaBins * rhoBins);
  const thetaStep = Math.PI / thetaBins;

  for (const edge of edges) {
    const centreBin = Math.round(edge.theta / thetaStep);
    // A small spread absorbs the wobble in a single pixel's gradient estimate.
    for (let offset = -2; offset <= 2; offset++) {
      const bin = (((centreBin + offset) % thetaBins) + thetaBins) % thetaBins;
      const theta = bin * thetaStep;
      const rho = edge.x * Math.cos(theta) + edge.y * Math.sin(theta);
      const rhoBin = Math.round(rho + diagonal);
      if (rhoBin < 0 || rhoBin >= rhoBins) continue;
      accumulator[bin * rhoBins + rhoBin] += edge.magnitude * (offset === 0 ? 1 : 0.5);
    }
  }

  let best = 0;
  for (const value of accumulator) if (value > best) best = value;
  if (best <= 0) return [];
  const cutoff = best * PEAK_THRESHOLD;

  // Non-maximum suppression, so one thick line is one peak and not forty.
  const peaks: HoughLine[] = [];
  const window = 4;
  for (let bin = 0; bin < thetaBins; bin++) {
    for (let rhoBin = 0; rhoBin < rhoBins; rhoBin++) {
      const value = accumulator[bin * rhoBins + rhoBin];
      if (value < cutoff) continue;

      let isPeak = true;
      for (let db = -window; db <= window && isPeak; db++) {
        for (let dr = -window; dr <= window; dr++) {
          if (db === 0 && dr === 0) continue;
          const nb = (((bin + db) % thetaBins) + thetaBins) % thetaBins;
          const nr = rhoBin + dr;
          if (nr < 0 || nr >= rhoBins) continue;
          if (accumulator[nb * rhoBins + nr] > value) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) peaks.push({ theta: bin * thetaStep, rho: rhoBin - diagonal, votes: value });
    }
  }

  return peaks.sort((a, b) => b.votes - a.votes).slice(0, 90);
}

/**
 * The strings: the best run of nearly-parallel lines at nearly-equal spacing.
 *
 * This is the idea the whole file rests on. Six evenly spaced parallel lines is
 * a guitar; a bed frame and a doorway are not evenly spaced, and a shirt is not
 * six of anything. Every candidate direction is tried, and within each one the
 * best arithmetic progression of line positions wins.
 */
function findEvenBundles(lines: HoughLine[], centre: Point, limit = 12): Bundle[] {
  const spread = toRadians(BUNDLE_SPREAD_DEG);
  const found: Bundle[] = [];

  for (const anchor of lines) {
    const group = lines.filter((line) => angleGap(line.theta, anchor.theta) <= spread);
    if (group.length < MIN_STRINGS) continue;

    // Positions measured along one shared normal, because near-parallel lines
    // at slightly different angles have rho values that are not comparable.
    const theta = anchor.theta;
    const placed = group
      .map((line) => ({ line, at: offsetFrom(line, centre, theta) }))
      .sort((a, b) => a.at - b.at);

    const run = longestEvenRun(placed.map((entry) => entry.at));
    if (!run || run.indices.length < MIN_STRINGS || run.unevenness > SPACING_TOLERANCE) continue;

    found.push({
      lines: run.indices.map((index) => placed[index].line),
      theta,
      unevenness: run.unevenness,
      spacing: run.spacing,
    });
  }

  // More lines first; among equals, the more evenly spaced. Near-duplicates —
  // the same bundle found from a neighbouring anchor — are dropped.
  found.sort((a, b) => b.lines.length - a.lines.length || a.unevenness - b.unevenness);

  const distinct: Bundle[] = [];
  for (const bundle of found) {
    const seen = distinct.some(
      (kept) =>
        angleGap(kept.theta, bundle.theta) < toRadians(4) &&
        Math.abs(offsetFrom(kept.lines[0], centre, kept.theta) - offsetFrom(bundle.lines[0], centre, bundle.theta)) <
          Math.abs(bundle.spacing),
    );
    if (!seen) distinct.push(bundle);
    if (distinct.length >= limit) break;
  }
  return distinct;
}

/** The longest arithmetic progression hiding in a sorted list of positions. */
function longestEvenRun(positions: number[]): { indices: number[]; unevenness: number; spacing: number } | null {
  let best: { indices: number[]; unevenness: number; spacing: number } | null = null;

  for (let first = 0; first < positions.length - 1; first++) {
    for (let second = first + 1; second < positions.length; second++) {
      const step = positions[second] - positions[first];
      if (step <= 1) continue;

      const indices = [first, second];
      let expected = positions[second] + step;
      for (let next = second + 1; next < positions.length; next++) {
        if (Math.abs(positions[next] - expected) <= step * SPACING_TOLERANCE) {
          indices.push(next);
          expected = positions[next] + step;
        }
      }
      if (indices.length < MIN_STRINGS) continue;
      // Six strings, no more. A longer run is a picket fence, not a guitar.
      if (indices.length > 7) continue;

      const gaps = indices.slice(1).map((index, i) => positions[index] - positions[indices[i]]);
      const mean = gaps.reduce((total, gap) => total + gap, 0) / gaps.length;
      const unevenness =
        mean === 0 ? Infinity : Math.sqrt(gaps.reduce((t, g) => t + (g - mean) ** 2, 0) / gaps.length) / mean;

      if (
        !best ||
        indices.length > best.indices.length ||
        (indices.length === best.indices.length && unevenness < best.unevenness)
      ) {
        best = { indices, unevenness, spacing: mean };
      }
    }
  }

  return best;
}

/** Where fret n sits, as a share of the scale length from the nut. */
function fretAt(n: number): number {
  return 1 - Math.pow(2, -n / 12);
}

/** The furthest fret this fit will claim. Past that a neck is unplayable. */
const MAX_FIT_FRET = 19;

/**
 * How far a wire may sit from its fret, as a share of that fret's own width.
 *
 * Measured down from 0.3, which was too loose to mean anything: frets tile the
 * whole neck, so a tolerance of 0.3 either side accepts a line falling at
 * random three times in five, and a bundle of junk duly "fitted" nineteen
 * frets. At 0.15 a random line lands on a fret one time in three, which the
 * gates below can outvote.
 */
const FRET_TOLERANCE = 0.15;

/**
 * Wires needed on frets of one scale before the picture is called a guitar.
 *
 * Four, not three: three points sit on *both* an even progression and a fret
 * progression exactly, so with three the comparison below has nothing to say.
 */
const MIN_FITTED_WIRES = 4;

/**
 * How much better the fret progression has to explain the wires than plain
 * even spacing does.
 *
 * This number is the whole discriminator, and it exists because *tolerating*
 * the fret model was measured and is not enough: over the first five frets the
 * gaps shrink only about six per cent each, so a blanket's stripes land inside
 * any tolerance loose enough to survive a pixel of noise — with tolerance
 * alone, `fret-check` had every striped case passing. What a blanket cannot do
 * is fit the fret curve *better than* it fits a straight line. So both models
 * are fitted, over the same wires, and the guitar has to win by half.
 */
const EVEN_MARGIN = 0.5;

/** How far the fit may move the nut from where the strings said it was, as a
 *  share of the scale length. The string end is evidence, not a free parameter. */
const NUT_SLACK = 0.05;

/** How strong a crossing line must be, against the strongest one, to be a fret. */
const WIRE_THRESHOLD = 0.25;

/** Crossing lines closer than this, in working pixels, are one wire. */
const WIRE_MERGE = 3;

/**
 * The share of the wires the fit has to explain.
 *
 * Without this the fit could pick four frets out of fifty lines and call the
 * picture a guitar. A real fretboard's band is mostly frets, so most of what
 * crosses it should land on the progression.
 */
const MIN_FIT_SCORE = 0.55;

/**
 * How many frets in a row the fit has to find.
 *
 * The strongest thing a fretboard has that noise does not: its frets are all
 * there, in order, with nothing missing between them. Scattered matches — fret
 * 3, then 7, then 11 — are what a random set of lines produces, and they were
 * passing every other test in this file.
 */
const MIN_FRET_RUN = 4;

export interface FretFit {
  /** Which fret each accepted wire was read as, low to high. */
  frets: number[];
  /** Share of the wires that landed on a fret of one consistent scale. */
  score: number;
  /** Typical distance from a wire to its fret, in the units of the positions. */
  residual: number;
  /** Where the nut ended up, after the fit was allowed to refine it. */
  nut: number;
  /** How far the scale is from what the neck's width predicts, in octaves of
   *  the ratio — 0 is exactly right. Zero also when nothing was expected. */
  offBy: number;
  /** Scale length along the neck, in the units of the positions. Signed:
   *  negative when the neck runs the other way along the measuring axis. */
  scale: number;
}

/**
 * Does this run of crossing wires look like frets?
 *
 * This is the thing that tells a fretboard from a bedspread, and it is the lead
 * the roadmap had written down and never used. Every other stripe in a room is
 * *evenly* spaced: a blanket, a radiator, the slats of a blind, the ribs of a
 * pillow. Frets are not. They crowd towards the bridge by exactly `2^(-n/12)`,
 * a ratio fixed by twelve-tone tuning and shared by every guitar ever built.
 *
 * So the wires are fitted against that progression from a known nut end — one
 * wire is assumed to be one fret, which fixes the scale, and then every other
 * wire either lands on a fret of that same scale or does not — and the answer
 * is only believed if it beats the straight line through the same wires.
 *
 * Pure, over positions measured along the neck, so it runs with no picture:
 * `npm run fret-check` is what set the constants above.
 */
export function fitFretProgression(positions: number[], nutAt: number, expected = 0): FretFit | null {
  if (positions.length < MIN_FITTED_WIRES) return null;

  const sorted = [...positions].sort((a, b) => a - b);
  let best: FretFit | null = null;

  for (const seed of sorted) {
    for (let fret = 1; fret <= MAX_FIT_FRET; fret++) {
      const guess = matchFrets(sorted, nutAt, (seed - nutAt) / fretAt(fret), expected);
      // One wire and one fret fix a scale, but the nut came from where the
      // strings stopped, which is a few pixels out at best. So the fit is
      // refitted over whatever it matched — two parameters, least squares —
      // and the wires matched again against the better line.
      const candidate = guess ? refine(sorted, guess, nutAt, expected) : null;
      if (!candidate) continue;
      // Most frets explained wins; ties go to the tighter fit, measured
      // against its own scale so a stretched neck cannot win by having bigger
      // pixels — see `better`. Getting that comparison wrong the loose way
      // let three stray lines buy a scale that read eight frets as nineteen.
      if (!best || better(candidate, best)) best = candidate;
    }
  }

  return best && believable(best, sorted) ? best : null;
}

/**
 * The gates a fit has to pass before the picture is called a guitar.
 *
 * Every one of these was added because something that was not a guitar got
 * through without it, and they are kept together so the list can be read as
 * what the detector actually believes.
 */
function believable(fit: FretFit, sorted: number[]): boolean {
  // The nut is a wire now, so the wire after it is fret one, or fret two if
  // one was lost to the light. Anything further up means the fit walked off
  // and found a self-consistent set of high frets, where the progression is
  // nearly even and proves nothing — frets 15 to 19 are within a few per cent
  // of a blanket's stripes.
  if (fit.frets[0] > 3) return false;
  if (fit.score < MIN_FIT_SCORE) return false;
  // A scale the neck's width does not support is the wrong shift of the right
  // curve, or not a neck at all.
  if (fit.offBy > Math.log2(SCALE_SLACK)) return false;
  if (longestRun(fit.frets) < MIN_FRET_RUN) return false;
  // And the test that separates a fretboard from a bedspread: could these same
  // wires just as well be evenly spaced? A blanket fits a straight line
  // perfectly and the fret curve only approximately; a neck is the other way
  // round, and by a wide margin.
  return fit.residual <= evenResidual(sorted) * EVEN_MARGIN;
}

/** The longest stretch of consecutive frets in a sorted list of fret numbers. */
function longestRun(frets: number[]): number {
  let best = 1;
  let run = 1;
  for (let i = 1; i < frets.length; i++) {
    run = frets[i] === frets[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/*
 * There is deliberately no fit here with the nut left free.
 *
 * It was written, and it cannot work: fret positions are invariant to a shift
 * of fret number — renumbering the frets n+k and multiplying the scale by
 * 2^(k/12) gives back exactly the same positions — so a run of wires alone
 * fixes the scale and the numbering only up to that shift. Measured, frets 1
 * to 7 fitted frets 4 to 10 with a residual of 1e-13. Only an anchor breaks
 * the tie, and the anchor is the nut: where the strings stop.
 */

/** Which wires land on frets of one nut-and-scale, and how far off they are. */
function matchFrets(sorted: number[], nut: number, scale: number, expected = 0): FretFit | null {
  if (!Number.isFinite(scale) || scale === 0) return null;

  const onFrets = new Map<number, { at: number; off: number }>();
  for (const position of sorted) {
    // 0 at the nut, 1 at the bridge. Anything behind the nut is not a fret.
    const along = (position - nut) / scale;
    if (along <= 0 || along >= fretAt(MAX_FIT_FRET + 1)) continue;

    const fret = Math.round(-12 * Math.log2(1 - along));
    if (fret < 1 || fret > MAX_FIT_FRET) continue;

    // The tolerance has to be a share of the local gap, not a fixed distance:
    // the first fret is wide and the twelfth is half of it, so one number in
    // pixels would be strict at the nut and meaningless up the neck.
    const width = Math.abs(scale) * (fretAt(fret + 1) - fretAt(fret));
    const off = Math.abs(position - (nut + scale * fretAt(fret)));
    if (off > width * FRET_TOLERANCE) continue;

    // One wire per fret: a thick fret sometimes yields two lines, and counting
    // both would inflate the score and skew the comparison.
    const kept = onFrets.get(fret);
    if (!kept || off < kept.off) onFrets.set(fret, { at: position, off });
  }

  const frets = [...onFrets.keys()].sort((a, b) => a - b);
  if (frets.length < MIN_FITTED_WIRES) return null;

  const matched = frets.map((fret) => onFrets.get(fret) as { at: number; off: number });
  return {
    frets,
    score: frets.length / sorted.length,
    residual: rms(matched.map((entry) => entry.off)),
    nut,
    offBy: expected > 0 ? Math.abs(Math.log2(Math.abs(scale) / expected)) : 0,
    scale,
  };
}

/**
 * Refits nut and scale over the frets that matched, then matches again.
 *
 * `position = nut + scale * fretAt(fret)` is linear in both unknowns, so this
 * is ordinary least squares over two parameters and not a search. The nut is
 * kept near where the strings ended, because that is a measurement, and
 * letting it float freely turns a wrong scale into a plausible-looking fit.
 */
function refine(sorted: number[], fit: FretFit, nutAt: number, expected = 0): FretFit {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const fret of fit.frets) {
    const predicted = fit.nut + fit.scale * fretAt(fret);
    let closest = predicted;
    let best = Infinity;
    for (const position of sorted) {
      const off = Math.abs(position - predicted);
      if (off < best) {
        best = off;
        closest = position;
      }
    }
    xs.push(fretAt(fret));
    ys.push(closest);
  }

  const line = leastSquares(xs, ys);
  if (!line) return fit;
  if (Math.abs(line.intercept - nutAt) > Math.abs(line.slope) * NUT_SLACK) return fit;

  const refitted = matchFrets(sorted, line.intercept, line.slope, expected);
  if (!refitted) return fit;
  return refitted.frets.length > fit.frets.length || refitted.residual < fit.residual ? refitted : fit;
}

/** How well the same wires fit plain even spacing: a straight line through
 *  position against rank, which is what every other stripe in a room is. */
function evenResidual(sorted: number[]): number {
  const line = leastSquares(
    sorted.map((_, i) => i),
    sorted,
  );
  if (!line) return 0;
  return rms(sorted.map((position, i) => position - (line.intercept + line.slope * i)));
}

function leastSquares(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

function rms(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((total, value) => total + value * value, 0) / values.length);
}

/**
 * A test for "this pixel could belong to a fret wire": it lies between the
 * outer strings, and its gradient runs along them rather than across.
 *
 * Everything else in the picture is simply never shown to the second transform,
 * which is cheaper than out-voting it and far more reliable.
 */
/** How far the band reaches either side of the bundle, with a fret's worth of
 *  margin so the outer string is not sitting on the boundary. */
function bandRange(strings: Bundle, centre: Point): { low: number; high: number } {
  const offsets = strings.lines.map((line) => offsetFrom(line, centre, strings.theta));
  const margin = Math.abs(strings.spacing);
  return { low: Math.min(...offsets) - margin, high: Math.max(...offsets) + margin };
}

function bandFilter(
  strings: Bundle,
  centre: Point,
  gradientNear = strings.theta + Math.PI / 2,
): (x: number, y: number, theta: number) => boolean {
  const { low, high } = bandRange(strings, centre);

  const cos = Math.cos(strings.theta);
  const sin = Math.sin(strings.theta);
  const tolerance = toRadians(CROSS_TOLERANCE_DEG);

  return (x, y, theta) => {
    const across = (x - centre.x) * cos + (y - centre.y) * sin;
    if (across < low || across > high) return false;
    // By default the lines wanted are the ones crossing the bundle: a fret runs
    // across the strings, so its gradient points along them. Passing the
    // bundle's own direction asks for the bundle's own lines instead, which is
    // how the frets get measured when the bundle turns out to be the frets.
    return angleGap(theta, gradientNear) <= tolerance;
  };
}

/**
 * A line square to the strings, sitting a given distance along the neck from
 * the centre of the frame. Used to close the ends of the quadrilateral.
 */
function lineAcross(centre: Point, axis: number, theta: number, at: number): HoughLine {
  const point = { x: centre.x + Math.cos(axis) * at, y: centre.y + Math.sin(axis) * at };
  return { theta, rho: point.x * Math.cos(theta) + point.y * Math.sin(theta), votes: 0 };
}

/** Where two lines cross, or null when they are parallel. */
function intersect(a: HoughLine, b: HoughLine): Point | null {
  const ca = Math.cos(a.theta);
  const sa = Math.sin(a.theta);
  const cb = Math.cos(b.theta);
  const sb = Math.sin(b.theta);
  const determinant = ca * sb - sa * cb;
  if (Math.abs(determinant) < 1e-9) return null;
  return {
    x: (a.rho * sb - b.rho * sa) / determinant,
    y: (b.rho * ca - a.rho * cb) / determinant,
  };
}

/** How far a line sits from a point, measured along a chosen direction. */
function offsetFrom(line: HoughLine, from: Point, direction: number): number {
  const onLine = { x: line.rho * Math.cos(line.theta), y: line.rho * Math.sin(line.theta) };
  return (onLine.x - from.x) * Math.cos(direction) + (onLine.y - from.y) * Math.sin(direction);
}

function span(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Angles here are directions of lines, so they live modulo π, not 2π. */
function normalizeAngle(angle: number): number {
  const wrapped = angle % Math.PI;
  return wrapped < 0 ? wrapped + Math.PI : wrapped;
}

function angleGap(a: number, b: number): number {
  const gap = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(gap, Math.PI - gap);
}
