# Architecture

Guitar Learning is a static single-page app: no backend, no framework, one runtime
dependency (`@mediapipe/tasks-vision`). This document is the short map; the
reasoning behind each decision is in [BITACORA.md](../BITACORA.md).

## The frame loop

`src/main.ts` constructs `App` (`src/app/App.ts`), and `App.frame()` runs once per
camera frame:

1. `HandTracker.read(time)` returns the hands, in unmirrored camera coordinates.
2. `FretReader.pick()` chooses the fretting hand; `.read()` projects its
   fingertips onto the neck through `Fretboard`.
3. `judge()` compares the fingertips with the chord the lesson asked for, and
   `Session.update()` runs the hold timer and advances the lesson.
4. `chordLayer()` decides what is worth drawing, `Overlay` draws it and `Coach`
   says the one thing worth saying.

## Folders

| Folder | Responsibility |
| --- | --- |
| `src/audio/` | Note detection: microphone, AudioWorklet, SuperFlux onsets, MPM/YIN pitch, spectral octave check, note events, `params.ts` (hand-written defaults + the lab's generated `params.lab.ts`), the exercise-aware prior |
| `src/tuner/` | Microphone, pitch (McLeod Pitch Method), nearest open string |
| `src/vision/` | Camera and MediaPipe hand readings, homography, the classic-CV neck detector |
| `src/guitar/` | The instrument: geometry, tuning, chord library, `Fretboard`, `FretReader`, `judge`, `NeckTracker` |
| `src/lesson/` | Curriculum, `Session` (the hold-to-pass state machine), progress |
| `src/render/` | Canvas overlay, `chordLayer`, the `object-fit: cover` maths in `viewport.ts`, palette |
| `src/ui/` | DOM panels, built without `innerHTML` through `dom.ts` |
| `src/song/` | Pasted chord chart to a list of chords |
| `src/i18n/` | English (source of truth) and Spanish; a missing key is a compile error |
| `scripts/` | Measurement harnesses (`fret-check`, `track-check`, `neck-check`, `scene`, `note-check`, `audio-check`) and `copy-wasm` |

## Ideas that carry the design

- **Two coordinate systems, one class that joins them.** `geometry.ts` works in
  scale lengths on a flat fretboard and knows nothing about cameras;
  `homography.ts` is pure projective maths; `Fretboard` holds a four-point
  homography between them.
- **Frets are computed**: fret n sits at `1 - 2^(-n/12)` of the scale length, so
  the 12th is at 0.5. That is why calibration asks for the 12th fret.
- **The judge answers per finger**, and exactly one problem is shown at a time.
- **A chord must be held** before a lesson advances.
- **The neck tracker matches against the calibration frame**, never the previous
  frame, and finds outliers by consensus before fitting.
- **The camera is never mirrored**, because mirroring reverses string order and
  every fret number.

## Testing

There is no test runner and no linter. `npm run typecheck` (`tsc --noEmit`, strict,
with `noUnusedLocals` and `noUnusedParameters`) is the automated gate. The vision
maths is exercised without a camera by `npm run fret-check`, `npm run track-check`
and `npm run neck-check -- photo.png`; the note detector without a guitar by
`npm run note-check`.

## Privacy constraints

The headers in `vercel.json` (Content-Security-Policy, Permissions-Policy and
others) are what enforce the claims in [SECURITY.md](../SECURITY.md): one outbound
request (the hand model), no analytics, no cookies, no `innerHTML`, and a
microphone that is open only while the tuner or the listen panel is.
