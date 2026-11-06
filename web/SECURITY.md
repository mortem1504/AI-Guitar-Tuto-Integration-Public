# Security notes

AI Guitar Coach (based on Guitar-Learning) is a static site with no server component: the code your browser
downloads is the whole product, and this document describes exactly what that
code touches. Every claim here comes from reading the source, not from
intentions.

## What it touches

| Surface | Access | Written by |
| --- | --- | --- |
| Camera | Read, live, while the class runs (`getUserMedia`, video only) | Nothing — frames are drawn to a local canvas and discarded |
| Microphone | Read, **only** while the tuner, the listen panel, a note exercise or the setup check is running | Nothing — the signal reaches an analyser or the note detector and stops there |
| `localStorage["guitar.settings.v1"]` | Read/write | The app — your control-panel choices |
| `localStorage["guitar.calibration.v1"]` | Read/write | The app — the four corners of your neck |
| `localStorage["guitar.progress.v1"]` | Read/write | The app — which lessons you have finished |
| `localStorage["guitar.song.v1"]` | Read/write | The app — the chord chart you pasted |
| `localStorage["guitar.audioInput.v1"]` | Read/write | The app — which audio input you chose |
| `localStorage["guitar.profile.v1"]` | Read/write | The app — your three survey answers (level, goal, favourite style), used only to order recommendations |
| IndexedDB `guitar-coach` / `sessions` | Read/write | The app — finished note sessions: which note was asked for, which was heard, when. Results only, never audio |
| IndexedDB `guitar-coach-songs` / `songs` | Read/write | The app — tabs you imported (their notes, your corrections and section names) and your progress through each. At most 200 songs; never audio |
| A file you choose or drop on "Import a tab" | Read, once | Nothing — read in the page, never uploaded |
| Speakers, only while **Listen** plays | Write | The app — a passage of the tab you imported, played by a plain oscillator synth |
| Your Downloads, only when you press **Export as file** | Write | The app — one song as `<title>.song.json`: its tab and your progress, never audio |

That is the complete list. There is no recording and no MIDI, and the
permissions policy shipped with the site turns those capabilities off rather
than leaving them merely unused. The class makes two sounds, both oscillators
played to the speakers and never connected to the microphone's path: the
count-in click before a note exercise, only when the guitar is plugged in (a
built-in microphone would hear it, so its count-in is silent), and **Listen**
in a song lesson, which plays the passage once when pressed, from its own audio
context that is closed when it ends. While Listen plays, the lesson pauses and
ignores everything the microphone hears, until 400 ms after the last note, so
the speakers are never graded as the player. The one file the app writes is
an exported song, and only when its button is pressed.

The microphone is the one exception, and it is worth being precise about.
Four things use it, never two at once: the tuner, the listen panel that names
the notes you play, the single-note exercises (only while one is being
played), and the setup check (only while its card is open; it measures level
and room noise as numbers and keeps nothing). Each opens it when it opens and releases it — tracks
stopped, context closed — when it closes or when the tab is hidden, so the
browser's own recording indicator is an accurate account of when the app is
listening. The tuner connects the signal to an `AnalyserNode`; the note
listener connects it to an AudioWorklet that has no outputs at all. Neither
path reaches the speakers (which is also what makes feedback impossible).
The note detector keeps a ring buffer of a few hundred milliseconds of samples
inside the worklet, overwritten as it goes; nothing else is kept, nothing is
written anywhere, and only the *pitch and timing* derived from it leave the
audio thread. Tuning and naming a note are the things a camera cannot do — a
slack string and a tight one are the same picture.

## Network

Exactly one request leaves your machine: the hand-tracking model (~8 MB) is
fetched once from Google's MediaPipe CDN (`storage.googleapis.com`) and cached
by the browser. Everything else — including the MediaPipe WASM runtime, which
is copied out of `node_modules` at build time — is served from the site's own
origin. There are no web fonts and no third-party scripts.

This is enforced rather than promised: the deployed site ships a
Content-Security-Policy whose `connect-src` allows only the site itself and that
single host. A future feature that tried to phone anywhere else would fail
loudly until the policy was consciously widened.

## What it never does

- No analytics, no telemetry, no cookies, no accounts.
- The camera image and the microphone signal are never uploaded, stored, or kept
  after the tab closes.
- Nothing is recorded. The one code path that produces a file is a song's
  **Export**, which writes the tab and its progress, never audio.
- The microphone is never opened outside the tuner, the listen panel, the note
  exercises and the setup check, and its signal is never routed to an output.
- The setup check reads the camera's brightness from a 32×18 thumbnail in
  memory, once a second while its card is open; the thumbnail is overwritten
  each time and never leaves the page.

## Untrusted input

Foreign text enters in three places, and none can inject anything:

- **Pasted chord charts** are parsed with a strict grammar and rendered
  exclusively through `createElement`/`textContent`. The code base contains zero
  `innerHTML` — a chart is data, never markup.
- **Imported tabs** (pasted text, `.txt`, Guitar Pro, MusicXML, exported
  `.song.json`) are read in the page, refused above 5 MB before parsing, and
  parsed by readers that never throw (`npm run tab-check` feeds them thousands
  of random scraps and cut-short files). Guitar Pro and MusicXML go through
  alphaTab, loaded only when such a file is opened; it uses no `eval`, so the
  CSP is unchanged. Titles, section names and warnings are shown as text.
- **Stored songs are hostile too.** `parseSongRecord` rebuilds every song read
  back from IndexedDB or from an imported song file: strings 1-6, frets 0-24,
  known techniques only, a plausible tuning, at most 20 000 events, and every
  pitch recomputed from the tuning rather than trusted.
- **`localStorage` is treated as hostile.** Every stored field is validated
  against whitelists and clamped ranges when loaded; anything malformed falls
  back to defaults. That includes the calibration corners, which are checked for
  finite numbers in a plausible range before they are ever fed to the
  homography.

**A warning for future editors:** keep it that way. All DOM construction goes
through `src/ui/dom.ts`; the first string-built markup added anywhere creates
exactly the injection this design rules out.

## Less proven

- Chrome and Edge are the tested browsers. Safari runs but can stutter under
  camera load — the start screen says so.
- The automatic neck detector is heuristic and fails quietly rather than
  wrongly: below a confidence threshold it reports nothing and the student marks
  the neck by hand. It cannot distinguish the thick E side from the thin E side
  at all, which is why the interface offers a flip rather than guessing twice.
- The projection assumes a fingertip sits on the plane of the fretboard. It sits
  a few millimetres above it, so a camera far off-axis will read fingers
  slightly out of place. The tolerance setting exists to absorb that.
- The pitch detector is checked against synthesised plucks, not against a room.
  It refuses to answer below a measured clarity threshold rather than reporting
  a confident wrong note, so a noisy room reads as silence — the failure it was
  tuned to prefer. It also cannot always tell a fretted note from a badly
  mis-tuned open string; a pitch more than a semitone and a half from any open
  string is reported as nothing at all.
- Phones render the site but frame a whole guitar neck poorly; this is a desktop
  experience and the start screen is honest about it.

## Reporting

Found something in this fork? Tell the AI Guitar Coach team. Issues in the
upstream project go to
[github.com/DecoudJuan/Guitar-Learning/issues](https://github.com/DecoudJuan/Guitar-Learning/issues).
