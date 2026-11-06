<div align="center">

# AI Guitar Coach

**A guitar coach in the browser. Point a camera at your guitar, and it finds the
neck, follows your fretting hand, and tells you which finger goes where — while
you play, on your own instrument, with nothing leaving your machine.**

You need a guitar, a webcam, and four clicks on the corners of your fretboard.

[![License: MIT](https://img.shields.io/badge/license-MIT-d9b45f)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-any%20modern%20browser-1f2430)](#local-setup)
[![Dependencies](https://img.shields.io/badge/runtime%20dependencies-2-4a6fa5)](package.json)
[![Network](https://img.shields.io/badge/network-one%20model%20download-2b6e4f)](SECURITY.md)

</div>

> **Based on [Guitar-Learning](https://github.com/DecoudJuan/Guitar-Learning) by
> DecoudJuan, MIT.** The original licence is kept in [LICENSE](LICENSE). Its
> history is kept in this repository's git log.

## About this fork

AI Guitar Coach is a university capstone (Software Capstone Design 1). It
extends Guitar-Learning so that the app also *listens* while you play single
notes. It tells you within 200 ms whether you played the right note and, with
the camera, whether you played it on the right string and fret.

- **Audio is the source of truth for *what* note.** The camera only settles
  *where* (string and fret) when one pitch can be played in several places.
- **Everything stays in the browser.** Audio and video are processed locally and
  never uploaded, and the Content-Security-Policy in `vercel.json` still
  enforces that.
- **The team's earlier Python prototype is now the offline audio lab** in
  [`../lab`](../lab). It
  records a labelled test set, measures detector accuracy, and tunes the
  parameters the browser code copies. The live product is this TypeScript app.

### Why there is no YOLO model

The original plan trained a YOLO detector to find the fretboard. This fork
drops it. Guitar-Learning's four-click calibration gives an exact homography
from the camera to the fretboard, and its `NeckTracker` keeps that homography
on the guitar as it moves. That replaces the detector entirely, and with it the
riskiest part of the plan: collecting and labelling a dataset, training a model,
and shipping megabytes of weights that would compete with the hand tracker for
the GPU. The cost is four clicks per session, which are remembered between
visits.

The rest of this README describes the base app as it stands.

## What it does

It makes no sound of its own (bar a count-in click, when your guitar is
plugged in, and **Listen** in a song lesson, which plays a passage once when
you ask, with the microphone ignored while it does). That is the point: the
sound is your guitar, and a synthesiser running under it would only compete
with it. Everything the class knows about your hands, it
knows by looking; which note you played, it knows by listening.

1. **You mark the neck, once.** Four clicks — the two ends of the nut and the
   two ends of the 12th fret — and a four-point homography turns any pixel into
   a (string, fret) position and back. It is remembered for next time.
2. **It keeps the grid on the guitar as it moves.** A guitar on a lap does not
   stay still, so the marked neck is *tracked*: a grid of anchors over the
   fretboard, matched by normalised cross-correlation against the frame you
   calibrated in, and the homography re-fitted by consensus.
3. **It follows your hand.** MediaPipe's hand model runs on the GPU in your
   browser, and every fingertip is projected onto the fretboard, so the class
   knows which string and which fret each finger is on.
4. **It corrects you, finger by finger.** Not "wrong" — *"your ring finger is
   one string too low"*, with an arrow drawn from where it is to where it goes.
   "Wrong" teaches nobody anything.
5. **It makes you hold it.** A chord counts when you keep it right for a
   moment. Sweeping past the right shape on the way somewhere else is exactly
   what should not be rewarded.

## What is in it

- **A tuner**, because a class that starts on an out-of-tune guitar teaches the
  wrong thing. Six rows, one per string, each ticking off when it holds in tune.
  It listens only while it is open.
- **Six single-note exercises, judged by ear, no camera needed**: open strings,
  the first five frets, the chromatic spider walk, the A minor pentatonic, a
  two-string melody and the G major scale. *Loop on mistake* waits on each note;
  *play through* keeps the tempo and reviews afterwards. Every note gets one of
  six answers, each an icon, a word and a line that says what to do: clean,
  wrong note ("You played F4. Target is E4. Slide back one fret."), right note
  in the wrong spot (with the camera), early or late (in ms), didn't catch
  that, and signal's weak. The last two never count against you. The review
  shows accuracy, a mistake timeline, the most-missed note and a button to
  practise just the mistakes; sessions are kept in the browser (IndexedDB).
- **Bring your own tab.** Paste a text tab or open a file (`.txt`, Guitar Pro
  `.gp`/`.gp3-5`/`.gpx`, MusicXML), check what was read (tuning, capo, tempo,
  track, section names, every warning in plain words), and it is taught a few
  notes at a time: sections, chunks of 4-12 notes, the hard moves drilled on
  their own, a suggested finger for every note, a tempo that starts at 60% and
  goes up 10% after two clean runs. *Wait for me* waits on each note; *play
  along* keeps time. **Listen** plays the passage first. Single notes are
  graded; chords and muted notes are shown and heard but not graded (the
  detector hears one note at a time). Songs and progress stay in the browser
  and export to a file. Limits: a bend is graded on the picked note (pitch is
  read at the pluck, so how far it was bent cannot be judged yet), and a
  hammer-on too quiet to make an onset is let off rather than marked wrong.
- **Eight lessons, in the order a teacher gives them.** Em first, because it is
  two fingers on adjacent strings; C later, because your hand has to open; the
  barre last, because it is the wall, and arriving at it with four working
  chords is the difference between a hard week and quitting.
- **Two kinds of lesson.** *Shapes* — one chord at a time, held until it is
  right. *Changes* — the same few chords in a cycle, which is the part that
  actually takes months.
- **39 chord shapes**, free to practise from the first minute.
- **Your own songs.** Paste a chord chart — chords alone or over lyrics — and
  the class turns it into a sequence of shapes to learn, saying plainly which
  chords it does not know yet.
- **Acoustic or electric.** Not a sound: the shape of the instrument. Scale
  length, how wide the neck is, and how far up the fretboard a lesson may
  reasonably send you.
- **English and Spanish**, with the notes named the way each language names
  them.

## How it works

Zero backend, two runtime dependencies (`@mediapipe/tasks-vision`, and `@coderline/alphatab` loaded only when a score file is opened), no framework.
`App.frame()` is the spine: read the hands, pick the fretting one, project its
fingertips onto the neck, judge them against the chord the lesson asked for,
draw the one correction worth drawing.

```
audio/     note detection: microphone -> AudioWorklet -> onset + pitch -> note events
tuner/     microphone -> pitch (MPM) -> nearest open string
vision/    camera + MediaPipe -> hand readings; homography; the neck detector
guitar/    geometry, tuning, chord library, Fretboard, FretReader, judge, NeckTracker
lesson/    curriculum, the hold-to-pass state machine, progress
render/    canvas overlay, what is worth drawing, the object-fit: cover maths
ui/        DOM panels, built without innerHTML, anywhere
song/      pasted chord chart -> chords
```

Three ideas carry most of it:

- **Frets are computed, not tabulated.** Fret *n* sits at `1 - 2^(-n/12)` of the
  scale length, so the 12th is at exactly 0.5 — which is why the calibration
  asks for the 12th fret, and why the neck is modelled as the trapezoid it
  physically is.
- **The homography does double duty.** As a *mapping*, it is what makes a
  fingertip into a (string, fret). As a *registration* — the panorama-stitching
  problem, pointed at one object — it is what keeps the grid on the guitar when
  the guitar moves.
- **The judge answers per finger, never per chord**, and then exactly one
  problem is shown. The camera knows more than a student can act on.

## Measured without a camera

Most of the hard logic is deliberately pure, so it can be exercised on a laptop
with the lid pointed at a wall:

```bash
npm run fret-check    # the fret-progression maths that tells a fretboard from a bedspread
npm run track-check   # the neck tracker's robust fit, against a known homography
npm run note-check    # the live note detector, over synthesised plucks in three rooms
npm run lesson-check  # single-note lessons: both modes, the six feedback states, the review
npm run fusion-check  # audio + vision: where a heard note was played, the fallback to audio-only
npm run home-check    # dashboard rules, survey answers, setup verdicts, the signal line
npm run tab-check     # the tab readers over test/tabs/: text tabs, Guitar Pro and MusicXML
npm run breakdown-check  # songs into sections, chunks, difficulty, hot spots, fingering, a plan
npm run song-check    # the song library (stored songs as hostile input, export), song lessons and progress
npm run audio-check   # the same detector over the lab's recordings, next to the lab's own numbers
npm run neck-check -- photo.png   # the whole detector pipeline over a still
node scripts/scene.mjs out/       # draws test scenes: a neck, a blanket, both, a hand in the way
```

Every constant with a number in its comment came from one of those, and
[BITACORA.md](BITACORA.md) records what each measurement changed — including the
ideas that were measured and thrown away.

## Things that look like bugs and are not

- **The automatic neck detector is off, on purpose.** *Find it for me* exists,
  and as of now it prefers answering nothing to answering wrong: measured
  against seven webcam frames of a real guitar in a real room, it returns
  nothing on all seven. Classic CV finds a bedspread, a headboard and the folds
  of a shirt before it finds six thin strings, and the honest state of that
  work — including what the fret progression `2^(-n/12)` does and does not
  settle — is written down in [BITACORA.md](BITACORA.md). Four clicks are the
  ground truth.
- **The first visit hangs for a few seconds.** It is downloading the
  hand-tracking model (~8 MB) once; your browser caches it after that.
- **The camera is not mirrored.** It cannot be: a mirrored neck reverses the
  string order and turns every fret number into its opposite.
- **A barre is judged as one finger, not six.** It is one finger doing one
  thing, and asking the camera to confirm six contact points under it would fail
  chords that are, in fact, correct.
- **The class is stricter or looser than you expect.** That is the Tolerance
  slider. A fingertip is wider than a string and the projection has error, so
  the strict end is still not merciless.

## Stack

- TypeScript 5.9 (strict) and Vite 7, no UI framework.
- `@mediapipe/tasks-vision` ^0.10.22 for hand tracking, run on the GPU in the browser; its WASM runtime is copied into `public/mediapipe/` by `npm run copy-wasm`.
- `@coderline/alphatab` 1.8.4 ([MPL-2.0](https://github.com/CoderLine/alphaTab/blob/main/LICENSE)) only to read Guitar Pro and MusicXML files, in `src/song/importers/score.ts`. It is about 1 MB, so it is fetched the first time someone opens such a file. It is used unmodified from npm; MPL-2.0 covers its own files, and this project's code stays MIT.
- Browser APIs: `getUserMedia` (camera, and the microphone for the tuner), canvas, Web Audio, `localStorage`.
- Hosting: Vercel, as a static site.

## Local setup

```bash
npm install
npm run dev      # http://localhost:3004
```

The camera needs HTTPS or localhost. `npm run build` produces a static `dist/`
that deploys to any static host — with the caveat that `vercel.json` carries the
security headers the privacy claims below rest on, and a host that cannot send
headers cannot make those claims.

`tsc` in strict mode, with `noUnusedLocals` and `noUnusedParameters`, is the
only automated gate: `npm run typecheck`.

### With Docker

From `web/`:

```bash
docker compose up --build web            # production build, http://localhost:8088
docker compose --profile dev up dev      # Vite with hot reload, http://localhost:3004
```

The `web` service is the [`Dockerfile`](Dockerfile): Node type-checks and builds
`dist/`, then nginx serves it with the same headers as `vercel.json`
([`docker/security-headers.conf`](docker/security-headers.conf); change both
together). The `dev` service mounts the source and keeps its own
`node_modules` in the container. `WEB_PORT=9000 docker compose up web` picks
another port. Without Compose:

```bash
docker build -t ai-guitar-coach . && docker run --rm -p 8088:80 ai-guitar-coach
```

Use the app at `localhost`: the camera and microphone need localhost or HTTPS,
so anywhere else the container needs a TLS proxy in front of it.

## Privacy

- Everything runs inside your browser. The camera image is never uploaded —
  there is no server to upload it to. The microphone is opened only while the
  tuner or the listen panel is on screen, is never recorded, and never reaches
  the speakers.
- No accounts, no analytics, no cookies, no web fonts, no third-party scripts.
  Your settings, your marked neck, your progress and your pasted chart live in
  your browser's local storage.
- The only network request is the one-time download of the hand-tracking model.
  That claim is enforced by a Content-Security-Policy, not merely promised —
  details in [SECURITY.md](SECURITY.md).

## Deploy

Not deployed yet. The upstream app is live at
<https://guitar-learning-ten.vercel.app>. This fork deploys the same way: on
Vercel, served from the domain root (`base: "/"`). `npm run build` type-checks and produces a static
`dist/`; Vercel builds it and serves it with the headers in
[`vercel.json`](vercel.json) (Content-Security-Policy, Permissions-Policy, HSTS
and others), which are what the privacy claims above rest on. There are no
environment variables or secrets.

## Docs

- [docs/architecture.md](docs/architecture.md): how the code is laid out and why.
- [BITACORA.md](BITACORA.md): why each decision was made, including the measurements that killed ideas that looked good on paper.
- [ROADMAP.md](ROADMAP.md): where it is going.
- [SECURITY.md](SECURITY.md): exactly what the code touches in your browser.
- [CLAUDE.md](CLAUDE.md): guidance for working on the code with Claude Code.

## License

[MIT](LICENSE). Based on Guitar-Learning by DecoudJuan, MIT.
