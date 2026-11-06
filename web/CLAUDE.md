# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**AI Guitar Coach**, a capstone fork of Guitar-Learning by DecoudJuan (MIT; keep
the LICENSE and the credit in README). It lives in `web/` of a monorepo whose
`lab/` is the Python audio lab that measures the detector and tunes
`src/audio/params.ts`.

A browser guitar class. The camera finds the fretboard and the fretting hand and
corrects finger placement in real time, and the microphone hears which note is
played. Audio is the source of truth for *which* note; vision only breaks ties
for *where* (string and fret). **The sound is the student's guitar.** There is
no MIDI and no audio recording, and adding either would be a regression, not a
feature. The app makes two sounds: the count-in click before a note exercise,
only with a plugged-in input (`NoteListener.click`), and **Listen** in a song
lesson (`audio/listenSynth.ts`), played only when pressed, from its own
AudioContext, while `NotesPanel.mute` pauses the lesson and ignores the
microphone. Nothing else may make a sound. It *listens* in four
places, one at a time: the tuner (`src/tuner/`), the note listener, the
single-note exercises and the setup check (all on `src/audio/`). "Acoustic"
and "electric" are *guitar shapes* (scale length, neck width, reachable frets),
never timbres.

`BITACORA.md` records why each decision was made and `ROADMAP.md` where it is
going — read them before large changes, and add to `BITACORA.md` when you make
one.

## Commands

```bash
npm install
npm run dev        # Vite on http://localhost:3004 (strictPort). Camera needs localhost or HTTPS.
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + vite build -> dist/
npm run preview
```

`predev`/`prebuild` run `copy-wasm` (`scripts/copy-wasm.mjs`), which copies the
MediaPipe runtime into `public/mediapipe/` (gitignored). A WASM 404 at startup
means that step did not run.

`npm run fret-check`, `npm run track-check` and `npm run neck-check -- photo.png`
are the measurement harnesses for the vision maths; they need no camera.
`fret-check` and `track-check` must say `all good`.
`npm run note-check` is the note detector's: it runs `NoteDetector` over
synthesised plucks (three rooms, both pitch methods) and must say `all good`.
`npm run lesson-check` plays scripted sessions through the single-note lessons
(both modes, all six feedback states, the review, stored sessions) and must say
`all good`. `npm run fusion-check` puts synthetic fingertips (with tracking
jitter and parallax) on a real calibrated `Fretboard` and checks where `fuse()`
places each heard note; it must say `all good`. `npm run home-check` runs the
dashboard's rules (survey answers read back as hostile input, recommendations,
continue, trend) and the setup and signal verdicts; it must say `all good`.
`npm run tab-check` reads every fixture in `test/tabs/` (text tabs with the
text reader, `.gp` and `.musicxml` through alphaTab) and compares it with the
`.expected.json` beside it, then feeds it random scraps and cut-short files
that must never make it throw; it must say `all passed`. Fixtures are original
riffs or public-domain melodies only: never commit a real song's tab. The `.gp`
files are built from alphaTex by `node scripts/make-score-fixtures.mjs`.
alphaTab is pinned (no caret) and loaded with a dynamic `import()` only;
never import it statically, or its 1 MB lands in the start-up bundle.
`npm run breakdown-check` runs `breakDown` (sections, 4-12-note chunks,
difficulty, hot spots), `suggestFingering` and `teachingPlan` over every
fixture: each note in exactly one chunk, the plan covering the whole song,
the same output twice, the tempo rule, and 300 notes in under 100 ms; it must
say `all good`. `-- --show <fixture>` prints one breakdown and its plan.
Fingering is always "suggested", never "correct", in code and in the UI.
`npm run song-check` covers "bring your own tab" past the breakdown: stored
and imported songs read back as hostile input (`parseSongRecord`), the export
file's round trip, plan steps as note exercises (single notes graded, chords
and dead notes listen-only, rhythm kept), whole runs through `NoteSession`,
and what a run does to the tempo and the chunks' mastery; it must say
`all good`.
`npm run audio-check` runs it over the lab's WAVs (`../lab/data/notes`, or the
dataset of `../lab/results/latest.json`) for every variant the lab evaluated,
and fails if the browser and the lab's Python mirror differ by more than 2
points of accuracy. Run it after any change to `src/audio/dsp/`.

`?debug&source=soak` (optionally `&minutes=N`, default 30) is the unattended
soak test: the note exercises play themselves through the scripted source, one
after another in both modes, and every minute a `[soak]` line (and
`window.__soak`) reports sessions, notes, latency p50/p95, frame gaps, long
tasks, heap and how often the tab was hidden. Open the first exercise by
hand; the tab must stay visible (a hidden tab ends the session, and the run
is not valid). With `?debug`, the camera's frame
rate goes to the console every 10 s as `[camera] N fps, note session …`.

`?debug&video=/local-videos/<file>.mp4&at=<s>` plays a recorded video in
place of the camera (muted, from `at` seconds) and records, per video frame,
what the fretting hand's fingertips were read as (`window.__videoRun`,
`app/videoRun.ts`): the real pipeline over a file, so camera results can be
scored against a ground truth. Videos go in `web/local-videos/`, which is
gitignored and outside `public/`, so a build never ships one. Mark the neck
on the frame at `at` (or store the corners), since the tracker anchors on
the first frame it sees.

There is no test runner and no linter; `tsc` in strict mode (with
`noUnusedLocals`/`noUnusedParameters`) is the only automated check. Much of the
hard logic is deliberately pure so it can be exercised without a camera:
`homography.ts`, `geometry.ts`, `judge.ts`, `viewport.ts`, `withHandGrace`,
`environmentHintFor`.

## Deployment

Vercel, from the domain root (`base: "/"`). `vercel.json` carries the CSP that
enforces the privacy claims in `SECURITY.md`. Runtime URLs still go through
`import.meta.env.BASE_URL` (see `WASM_PATH` in `HandTracker`).

## Architecture

Zero backend, two runtime dependencies (`@mediapipe/tasks-vision`, and `@coderline/alphatab` loaded only when a score file is opened), no framework.
`src/main.ts` constructs `App`, and `App.frame()` is the spine:

1. `HandTracker.read(time)` → `HandReading[]` (unmirrored camera coordinates).
2. `FretReader.pick()` chooses the fretting hand, `.read()` projects its
   fingertips onto the neck via `Fretboard`.
3. `judge()` compares that against the `ChordTarget` the lesson asked for;
   `Session.update()` runs the hold timer and advances.
4. `chordLayer()` decides what is worth drawing, `Overlay` draws it, `Coach`
   says the one thing worth saying.

```
audio/     note detection: microphone -> AudioWorklet -> onset + pitch -> note events
tuner/     microphone -> pitch (MPM) -> nearest open string
vision/    camera + MediaPipe -> HandReading; homography; classic-CV neck detector
guitar/    the instrument: geometry, tuning, chord library, Fretboard, FretReader, judge
lesson/    curriculum, Session (the hold-to-pass state machine), progress;
           note exercises, NoteSession, noteJudge, sessionStore (IndexedDB)
fusion/    audio says which note, the fingertips say where: candidates, fuse, VisionHealth
render/    Overlay (canvas), chordLayer, viewport (the object-fit: cover maths), palette
ui/        DOM panels: Panel, Coach, Diagram, Calibrator, LessonList, SongPanel, Help
song/      pasted chord chart -> parsed chords; "bring your own tab": tab readers,
           breakdown, fingering, plan, library (IndexedDB), lesson (plan step -> NoteExercise)
```

### The load-bearing ideas

- **Two coordinate systems, and one class that joins them.** `geometry.ts` works
  in *scale lengths* on a flat fretboard and knows nothing about cameras;
  `homography.ts` is pure projective maths. `Fretboard` holds a four-point
  homography between them and is the only thing that answers "where does this
  finger go" / "what is this fingertip pressing". Keep that split.
- **Frets are computed, not tabulated:** fret n at `1 - 2^(-n/12)`, so the 12th
  is at exactly 0.5 — which is why the calibration asks for the 12th fret. The
  neck is modelled as the trapezoid it physically is.
- **The chord library stores fingerings, not note sets.** Six entries per shape,
  thick E first, the way every tab and songbook writes them. A barre collapses
  into one `Placement` (see `targetOf`), because six contact points under one
  finger fail on chords that are correct.
- **The judge returns a verdict per finger, never per chord.** "Wrong" teaches
  nobody anything. `firstProblem()` picks the single instruction to show.
- **A chord must be *held*** (`Session`). Passing the instant fingers align
  would reward a hand sweeping past the shape.
- **`camera coordinates ≠ canvas pixels`.** The video is `object-fit: cover`;
  every conversion goes through `render/viewport.ts`, in both directions
  (calibration clicks come back the other way).
- **The camera is never mirrored.** A mirrored neck reverses the string order
  and every fret number. `readHand` therefore does *not* flip the model's
  handedness label.

### Stability machinery (do not remove it casually)

Camera input is noisy and every jitter becomes a wrong verdict on screen:

- `vision/smoothing.ts` — One Euro filter per landmark coordinate.
- `util/Steady.ts` — a discrete value must hold N frames before it is accepted;
  returning to the held value is instant. Used per finger in `FretReader`.
- Hysteresis on finger extension (`EXTEND_ABOVE`/`RETRACT_BELOW` in `readHand`).
- `withHandGrace` in `HandTracker` — a briefly-lost hand lingers for `GRACE_MS`.

The Smoothness setting drives three of these at once (`responseFor` in
`app/settings.ts` → `App.applyResponse`).

Related invariant: finger shape is measured on the model's **world**
(real-space) landmarks so it survives a turned hand; position uses the flat
image landmarks.

### The tuner

`tuner/pitch.ts` is the McLeod Pitch Method (normalised square difference), not
plain autocorrelation — whose peaks shrink with lag and therefore read the thick
E as its own octave. It picks the *first* peak within 90% of the best, not the
best, for the same octave reason. It is pure over a sample buffer, so it can be
checked against synthesised plucks with no hardware; `MIN_CLARITY` was set from
those measurements, not guessed, and it prefers answering nothing to answering
wrong. `tuner/strings.ts` maps a pitch to the nearest *open string* in cents —
a beginner needs "that is your D string", not "F#, 40 cents flat".

### Note detection

`src/audio/` hears single notes while the student plays.
`mic.ts` opens the input with echo cancellation, noise suppression and AGC
**off** (each ruins a guitar signal) and remembers the chosen device.
`NoteListener` builds a two-node graph: the source and the
`note-processor` AudioWorklet, which has **no outputs**, so nothing reaches the
speakers. `noteEvents.ts` cleans the worklet's messages (re-triggers, the
"didn't catch that" case). `ui/ListenPanel.ts` shows the note; `?debug` adds Hz,
cents, confidence and pluck-to-screen latency, and `?debug&source=synth`
replaces the microphone with a known looping signal.

Load-bearing, and easy to undo by accident:

- **All the logic is in `dsp/detector.ts`, which is pure.** The worklet is a
  wrapper. `note-check` and `audio-check` run the same class over files, so
  the browser is measured against the same dataset as the lab.
- **The lab mirrors the detector line for line** (`lab/src/audio/note_detector.py`).
  A change to `dsp/` needs the same change there, or `audio-check` fails.
- **`params.ts` has two layers.** `DEFAULTS` is hand-written; `params.lab.ts`
  is generated by `lab/export_params.py` from an evaluation run and wins. Never
  edit `params.lab.ts` by hand: export again.
- **Nothing allocates on the audio thread.** Buffers are created once; the
  onset history rotates in place. Pitch uses FFT correlation because the direct
  loop cost 2.5-2.9 ms for a 4096 window, longer than a 2.67 ms render quantum.
- **Onsets are SuperFlux over 1024-sample frames.** 512-sample frames are
  shorter than the thick E's period, and a plucked string is pulse-like, so the
  flux fired every period. This was found only after the synthesiser's partials
  were made phase-coherent like a real string; random phases hid it.
- **Every number in `params.ts` says where it came from.** Change one only with
  a measurement, and update its comment.
- **Vite builds the worklet with `worker.format: "es"`.** The default iife
  worker build uses `importScripts`, which an AudioWorkletGlobalScope lacks.

### Home, setup, practice selection (Phase 5)

The start card is also the home screen: the first visit asks three survey
questions (`lesson/profile.ts`, skippable), every visit shows the dashboard
(`ui/dashboard.ts`): continue, three recommendations with their reason,
recent sessions, the accuracy trend. With the camera on, the `home` button
brings it back. `lesson/recommend.ts` orders exercises by plain rules (level
order, +3 goal, +2 style, +5.5 a run under 70%, mastered = two runs ≥ 90%
sinks); no model, nothing sent. `ui/SetupPanel.ts` is WF-04 (input, level,
room noise, A-string test, lighting and neck), its verdicts pure in
`audio/setupChecks.ts`. The notes card's chooser (`ui/notesChooser.ts`) adds
coaching: pitch only, string + fret, or freestyle; the live screen
(`ui/notesLive.ts`) has the loop toggle (`NoteSession.setMode`) and the signal
line (`audio/signalQuality.ts`).

### Fusion

`src/fusion/` answers *where* a heard note was played, and only when it can
defend the answer. `App.frame()` pushes every fingertip reading into a
`TipHistory` (~300 ms, page clock) and tells `VisionHealth` whether a hand was
on a calibrated neck. When a note arrives, `NotesPanel` converts its onset to
the page clock and asks `App.visionLink().placeOf`, which runs `fuse()` against
the frame nearest the pluck.

- **Audio is never overruled on *which* note.** Fusion only picks among the
  places that note can be played (`candidatesFor`).
- **"Right note, wrong spot" needs confidence ≥ `WRONG_SPOT_CONFIDENCE`.** A
  disagreeing camera below it is ignored and the note is judged by ear; an
  open string (evidence by absence, `OPEN_CONFIDENCE`) never qualifies.
- **The fallback is automatic both ways**: no hand for `NO_HAND_MS`, or no
  calibration, and the card says it is listening only; it switches back by
  itself.

### Neck tracking

`guitar/NeckTracker.ts` (camera side) and `guitar/NeckFollower.ts` (the
tracking, pure; transform helpers and the `View` type in `guitar/neckPose.ts`)
keep the grid on the guitar as it moves: anchors laid out in *board*
coordinates, a patch of picture kept for each, matched by normalised
cross-correlation against **the calibration frame** or a view of the guitar
learned from it while tracking well (never the previous frame — that drifts),
then the homography re-fitted by consensus.

Two things here were established by measurement (`npm run track-check`) and
must not be undone: templates never come from the previous frame, and outliers
are found by consensus *before* fitting. A plain least-squares fit followed by dropping bad
residuals was tried and fails badly — three bad anchors in eighteen dragged the
fit 45 px off, after which the good anchors looked wrong too.

A third: anchors under a hand (its landmark box, plus half a patch) are
never taken and never matched. Without that, on a real chord video where the
hand covered frets 3-7 when the neck was marked, the grid followed the hand
along the neck and every chord read at the same fret.

`track()` returning null means "keep the current board", not "error" — but
only for two passes: `lost()` turns true after `LOST_MS` (150 ms) with no
trusted fit, and `App` then draws, reads and judges nothing on the neck and
says "Finding the neck…" (after 3 s, "mark the neck again"). **A grid in the
wrong place is worse than no grid**; that rule shaped everything below.

Rebuilt after a student's recording (BITACORA 2026-11-05), where the first
version lost an acoustic within seconds and kept drawing the grid over the
body. `NeckFollower` is the pure core (greyscale frames in, board → pixel
homography out); `track-check` runs it over synthetic video with known motion
and must say `all good`. What it rests on, each found by measurement:

- **Anchors on the body too** (round the soundhole, to the bridge). Frets
  repeat, so fretboard squares alone let a fit slide a fret.
- **Templates warped to the current view** (`warpedPatch`), cut from the
  marked frame or a learned view, so a turned neck matches and nothing drifts.
- **One shared shift first** (`commonShift`, the sum of every anchor's
  correlation map), then each anchor within 3 px of it: a fret alias sits at a
  different offset for every fret and does not add up. Per-anchor best peaks
  were fooled by aliases even with the true pose as the guess.
- **Agreeing anchors must span 0.3 of the scale**: a cluster pivots.
- **Support** (`support`: mean correlation of the visible anchors where a fit
  puts them) against its running level: under 75% is a missed pass, and a
  found-again fit needs 85% and must beat its own 1-4 fret stretches about the
  bridge (`ALIASES`). Frets crowd by 2^(-n/12), so such a stretch, or a tilt
  along the neck with the nut off-picture, lays every wire on another one while
  the body barely moves; both were accepted with nearly every anchor agreeing
  before this check.
- **While lost**, a quarter-size search over half the frame, trying one turn
  and size per pass (`RECOVERY`).
- **Learned views** (`learn`). One marked frame stops looking like the guitar
  as the student leans in, and the support check then turns down right fits.
  So a clearly good pass (support at least 90% of its view's level, 80% of
  points agreeing) at a pose 0.08 away from every view kept (`poseDistance`)
  becomes another view, with only the points that agreed on it (on the
  guitar, not an arm over it); each pass matches the view nearest the pose it
  expects, and each view keeps its own support level. Two rules keep that
  from drifting, both measured on synthetic video: **the marked frame has the
  last word** — a pass matched against a learned view is refined against the
  marked frame whenever it still sees the guitar, because a learned view
  copies its pass's error (without this, 1 run in 3 drew a grid 4 px off) —
  and views learned from views stop at depth 4. Learning at 0.05 instead of
  0.08 made longer chains and was worse on both the synthetic and the real
  video.

**Found again by the wires** (`guitar/neckRefind.ts`, BITACORA 2026-11-06).
When no kept picture knows the guitar (it moved a little and the light on it
changed: views scored 0.10-0.32 at the true pose), the fret wires still do.
`neckWires.lockToWires` fits the pose to the wires across three lanes and the
board's edges, from a start within half a fret (what the pictures nearly
found, the predicted pose, the last one, or, once lost, `startsNear` along the
band the edges show). Wires alone cannot tell one fret from the next, so
`neckInlays` reads the guitar's own pattern along the neck when it is marked
(`barcode`: five lanes, spaces 3-15, each against its nearby spaces) and
`fretShift` says how many frets a lock is out, or nothing. What it rests on:

- **Spaces 1-2 are not read**: the fretting hand's skin and shadow there
  outvoted the 12th fret. No guitar has an inlay before the 3rd.
- **Against nearby spaces, not the whole width or a trend**: the student's
  12th-fret blocks span the width (cancelled), and a shadow's edge read as an
  inlay under a straight-line trend. Three spaces each way, counting the
  space itself: two each way lost the dots at 3/5/7/9 (every other space).
- **Only a contradicting mark counts against a shift** (bright where the
  marked view saw dark): a shadow or glare makes marks where the board was
  plain. Chance claims on random boards: 0-1 in 20000 at moderate noise.
- **Lost, it is shown only when two passes agree** (`CONFIRM_MS`).
- **At marking, the pattern is read through the wires only if they agree
  with the marking**: from a marking 0.4 fret off the lock jumped to the next
  wire a third of the time, and read the pattern a fret out.

Known limits: the pictures' fit can drift *across* the neck (the student's
grid grew 15-20% too wide before it was lost, 51-53.5 s), and the wires do
not correct that: found again, the grid had the frets right along the neck
but its thin-string side up to 10 px low near the nut. And a guitar with
nothing along its neck to tell frets apart (no dots, the body join out of
view) stays lost until marked again.

### The neck detector — known not to work yet

`vision/NeckDetector.ts` is classic CV on purpose (a second neural model would
cost megabytes and GPU time competing with the hand tracker). As of F14 it no
longer offers junk — it rejects anything striped that has no frets on it, and
prefers answering nothing — but measured against seven webcam frames of a real
guitar it returns null on all seven, so `autoDetect` ships **off**. The failure
is in step one: the room's edges take every Hough peak and the guitar's own
lines never enter the candidate set (the bands came out 400-575 working pixels
across, where a neck is about 32). Tuning the fitting cannot fix that; the file
header says what would. Do not turn it back on without evidence from real
photographs.

What it rests on is that frets are *not* evenly spaced: they crowd by
`2^(-n/12)`, which no blanket does, and the fit has to beat a straight line
through the same lines before anything is claimed (`fitFretProgression`). Four
things there are load-bearing and easy to undo by accident. Hough is used for
*directions only* — positions come from a one-pixel edge profile, because a
Hough bin is far too coarse to measure the gaps between frets. That profile is
read in lanes *across* the direction being measured, so that a line only counts
if it crosses the whole neck, which is what keeps a fold in a shirt out of the
fit. Fret positions are invariant to a shift of fret number, so the numbering
exists only because two things anchor it: the nut is the last wire (real strings
run bridge to tuners, so where the strings *stop* is not the nut — that mistake
is in BITACORA), and the scale is about sixteen times the width between the
outer strings, which is what picks the right shift.

Measure before changing anything here, and never against one case: `detectInGrey`
is separate from the canvas so `npm run neck-check -- photo.png` runs the whole
pipeline against a still, `node scripts/scene.mjs <dir>` draws synthetic rooms
(a neck, a striped blanket, both at once, a hand over the frets), and `npm run
fret-check` exercises the progression maths on its own. Every constant with a
number in its comment came from those. The open problem and the one untried
lead — the strings sharing a vanishing point, which would give the real
trapezoid instead of today's parallelogram — are in ROADMAP.

Manual calibration is the ground truth, and `guitar/corners.ts` makes it
independent of click order — a wrong order used to silently transpose the two
axes of the fretboard and spread every chord across the neck.
It also turns down four points too squat to be nut-to-12th
(`markingProblem`, long/short under `MIN_MARKED_RATIO` = 3, in camera pixels),
both when clicked and for a remembered neck when the camera starts: four
clicks around one fret box squeeze the whole grid into that box, which looks
exactly like the tracker drifting. `fret-check` keeps the real case.

**The nut need not be in the picture.** A laptop camera often cuts the
headstock off, and that is how the one-box marking happened: the nut could
not be clicked. So the near pair may go on a fret wire (the card's "near
pair" stepper, nut to 5th, at least 7 frets short of the far pair), set
before clicking so the steps name it, or after, against the live grid like
the far pair. `Fretboard.from(…, nearFret)` builds the board from that and
keeps its `corners` at the nut — off the picture, which is why stored corners
may lie in -4..5 — so the tracker, readings and storage still speak
nut-to-`farFret`. The squeeze check scales its ratio by the span marked; it
only catches the one-box mistake for a nut-to-12th marking, and the live grid
is the check for the rest. Dots for a chord on frets the camera cannot see
(Em with frets 1-2 cut off) are off the picture too. A dot that asks for a
finger carries `along` (a point further up its string, the 12th), and off
the picture it is drawn where its string leaves the picture, with a pointer
on (`render/offPicture.ts`), and the overlay says in words that part is off
the picture. Kept at its own height instead, it sat in the air above a
rising neck. Open and muted strings and "later" targets are just not drawn
off the picture: pinned to the edge they were clutter.

## Constraints inherited from SECURITY.md

- **No `innerHTML`, anywhere.** All DOM goes through `src/ui/dom.ts` plus
  `textContent`. Pasted charts and translations are untrusted data.
- **`localStorage` is hostile input.** Validate and clamp every field on load;
  a corrupt entry falls back to defaults. Keys: `guitar.settings.v1`,
  `guitar.calibration.v1`, `guitar.progress.v1`, `guitar.song.v1`,
  `guitar.audioInput.v1`, `guitar.profile.v1`. IndexedDB (`guitar-coach`/`sessions`, note session
  results) is hostile too: `parseRecord` rebuilds every record on the way out;
  so is `guitar-coach-songs`/`songs` (`parseSongRecord`, which also reads
  imported song files).
- **Exactly one outbound request** — the hand model from
  `storage.googleapis.com`. The CSP's `connect-src` allows nothing else, so a
  new fetch fails in production only.
- No analytics, cookies, accounts, web fonts or third-party scripts. The one
  file download is a song's Export, on its button.
- **The microphone belongs to the tuner, the note listener, the note
  exercises and the setup check, one at a time.** (`App` loops over the four:
  opening one closes the others.) Each opens it when it starts and releases it
  (tracks stopped, context closed) on close and on `visibilitychange`; opening
  one closes the others. A note exercise in progress ends (and is reviewed)
  when the tab is hidden. It is connected to an `AnalyserNode` or to the output-less
  note processor, never to a destination — connecting it downstream would both
  break the privacy claim and create feedback. No samples leave the worklet's
  ring buffer.

## i18n

`src/i18n/en.ts` is the source of truth: its keys define `TranslationKey`, so a
missing Spanish string is a compile error. Add English first. Locales also pick
note notation (`letter` for en, `solfege` for es). Emphasis is written with
`**asterisks**` and rendered via `renderEmphasis` — never as markup.

## Commits and PRs

Commits y PRs sin atribución a Claude: nada de `Co-Authored-By: Claude` ni
"Generated with Claude Code".
