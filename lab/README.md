# 🎸 AI Guitar Coach: audio lab

> This folder is `lab/` in the AI Guitar Coach monorepo. The live product is the
> TypeScript web app in [`../web`](../web). This lab is the offline side: it
> records a labelled test set, measures the note detector's accuracy, and tunes
> the parameters the web app copies. Run every command below from inside `lab/`.

AI Guitar Coach is a capstone project that aims to provide real-time feedback to guitar players using audio processing, computer vision, and machine learning.

The system is designed to listen to and eventually observe a guitarist while playing, detect the note being played, and provide feedback on whether the correct note is being played.

## Current Development Status

The project is currently under development.

Current progress:

- [x] Python project environment setup
- [x] Audio recording
- [x] Audio file analysis
- [x] Initial pitch detection using Librosa
- [x] Frequency-to-note conversion
- [ ] Improve pitch detection accuracy
- [ ] Fix harmonic/fundamental frequency detection
- [ ] Real-time pitch detection
- [ ] Computer vision guitar/fret detection
- [ ] Audio + vision integration
- [ ] Real-time coaching feedback
- [ ] User interface

**Current issue:** The pitch detector can sometimes identify a harmonic instead of the fundamental frequency. For example, an A4 note may be detected as E5. Phase 2 (below, section 7) adds the tools that measure this on recordings of our own guitars and choose the fix by its numbers.

The librosa pYIN detector in `src/audio/pitch_detector.py` is kept as the baseline. Known defect, found by the new tests: it never hears the low E (82 Hz), because pYIN's voiced probability there stays under the 0.7 cut (0.69 at 22.05 kHz, 0.24 at 48 kHz).

## Project Structure

```text
AI-Guitar-Coach/
│
├── src/
│   ├── audio/
│   │   ├── __init__.py
│   │   ├── analyze_recording.py
│   │   ├── pitch_detector.py
│   │   └── record_audio.py
│   │
│   ├── coaching/
│   ├── vision/
│   └── __init__.py
│
├── tests/
│   ├── __init__.py
│   └── test_pitch_detector.py
│
├── data/
├── models/
├── .gitignore
├── requirements.txt
└── README.md
```

## Technologies

The project currently uses or plans to use:

- Python
- Librosa
- NumPy
- SoundDevice
- OpenCV
- PyTorch
- Ultralytics YOLO
- Machine Learning
- Computer Vision
- Digital Signal Processing

---

# Setup Instructions

## 1. Install Required Software

Before cloning the project, install:

- Python
- Git
- Visual Studio Code

For VS Code, also install the **Python extension**.

## 2. Clone the Repository

Open a terminal and run:

Clone the AI Guitar Coach monorepo, then enter this folder:

```bash
cd lab
```

Open the folder in VS Code:

```bash
code .
```

## 3. Create a Virtual Environment

Each team member should create their own virtual environment.

```bash
python -m venv .venv
```

### Windows PowerShell

Activate it using:

```powershell
.\.venv\Scripts\Activate.ps1
```

After activation, the terminal should show:

```text
(.venv)
```

Do not upload the `.venv` folder to GitHub.

## 4. Install Dependencies

With the virtual environment activated:

```bash
pip install -r requirements.txt
```

> Note: `requirements.txt` now lists only the audio tools. PyTorch and Ultralytics were removed because the web app's four-click fretboard calibration replaces the planned YOLO detector.

## 5. Select Python Interpreter in VS Code

Press:

```text
Ctrl + Shift + P
```

Search for:

```text
Python: Select Interpreter
```

Select the Python interpreter inside:

```text
.venv
```

## 6. Test the Project

To record audio from the default input device:

```bash
python -m src.audio.record_audio
```

To pick another input (for example a USB audio interface), list the devices and
pass the index or part of the name:

```bash
python -m src.audio.record_audio --list-devices
python -m src.audio.record_audio --device 2
```

To analyze the recorded audio:

```bash
python -m src.audio.analyze_recording
```

## 7. Measure the note detector (Phase 2)

The web app's note detector is mirrored in `src/audio/note_detector.py`, which
reads its parameters straight from `../web/src/audio/params.ts` and
`params.lab.ts`. The web app's `npm run audio-check` runs the real TypeScript
class over the same WAVs and fails if the two disagree by more than 2 points.

**1. Record the dataset** (about 10 minutes per microphone, 156 takes):

```bash
python record_dataset.py --list-devices
python record_dataset.py --mic-type builtin
python record_dataset.py --mic-type interface --device 2
```

Every string, frets 0-12, two takes, into `data/notes/<mic type>/s2_f05_take1.wav`
plus `data/notes/labels.csv`. Press Enter, *then* pluck once and let it ring.
It checks each take for clipping, silence and plucking too early, but never
tells you which note it heard (so takes are not redone until the detector
agrees). It resumes where you stopped.

**Sharing the recordings.** The WAVs live on the team's shared drive, not in
git (about 22 MB per microphone, and they never change once recorded). Git
holds only `data/notes/labels.csv`, which says what every clip is.

- Shared folder: _add the link here_. It mirrors `data/notes/` exactly:
  `builtin/`, `interface/`, `external/`, each with `s2_f05_take1.wav`-style
  files. Do not rename or re-encode them; `labels.csv` finds them by path.
- **After recording:** upload your new WAVs into the matching subfolder, then
  commit and push `data/notes/labels.csv` (`git add data/notes/labels.csv`;
  `.gitignore` keeps the WAVs out).
- **Before evaluating:** `git pull`, then download the shared folder's
  contents into `data/notes/` so every file listed in `labels.csv` is there.
- Two people recording the same microphone type at once will both write takes
  with the same names. Record different microphone types, or take turns and
  pull `labels.csv` before starting: `record_dataset.py` skips takes already
  in it.

**2. Evaluate:**

```bash
python evaluate.py              # add --pyin to include the old librosa detector (slow)
```

It runs every variant the build brief asks to try (the browser as it is, YIN,
the spectral octave check, a later pitch window, the median over 30-150 ms, a
1000 Hz ceiling) and writes `results/<run id>/summary.md`: accuracy, octave,
+19 (third harmonic) and fifth errors, latency, accuracy per microphone and
string, the commonest confusions, and what the exercise-aware prior would do
(how often it fires and how many real octave mistakes it would wrongly accept).

**3. Check the browser agrees,** in `../web`:

```bash
npm run audio-check
```

**4. Export the winner** to the browser, then check again:

```bash
python export_params.py                       # the best variant the browser can run
python export_params.py --variant octave      # or a chosen one
```

It writes `../web/src/audio/params.lab.ts` with the run id and each value's
numbers. It refuses synthetic data, lab-only variants, and runs made against
different parameters than today's.

**Tests:** `python -m pytest`. `tests/test_dataset_accuracy.py` is the
acceptance test (at least 95% correct, under 2% octave errors on
`data/notes`); it is skipped until the dataset exists.

**Without a guitar:** `python make_synthetic_dataset.py` writes 468
synthesised clips to `data/synthetic/` so the whole chain can be run
(`python evaluate.py --data data/synthetic`, then `npm run audio-check`). Those
numbers test the tools, not the detector.

**A public dataset: IDMT-SMT-Guitar V2.** Real guitars, annotated note by
note (Fraunhofer IDMT, [zenodo.org/records/7544110](https://zenodo.org/records/7544110)).
Its licence is **CC BY-NC-ND 4.0**: use it for evaluation only, never commit
or share it, never modify its files. It lives in the gitignored
`data/external/`.

```bash
mkdir -p data/external/idmt && cd data/external/idmt
curl -fL -C - -o IDMT-SMT-GUITAR_V2.zip "https://zenodo.org/records/7544110/files/IDMT-SMT-GUITAR_V2.zip?download=1"
md5 -q IDMT-SMT-GUITAR_V2.zip      # 06796e08731bccffaed6ae59361486e4
unzip -q IDMT-SMT-GUITAR_V2.zip && cd ../../..
python import_idmt.py --source data/external/idmt/IDMT-SMT-GUITAR_V2
python evaluate.py --data data/external/idmt-isolated --pyin
(cd ../web && npm run audio-check -- --data ../lab/data/external/idmt-isolated)
```

`import_idmt.py` keeps the isolated notes played normally (no bends, slides,
vibrato, harmonics, dead or muted notes), checks each annotation's string and
fret against its pitch, and writes only a `labels.csv` pointing at the
original WAVs. Each guitar becomes a `mic_type`. Only dataset1 (two electric
guitars, four pickup settings, 312 notes) is imported: dataset4's acoustic
recordings use CSV/TXT annotations the script does not read yet. These are
direct recordings, not a laptop microphone in a room, so they
measure the detector on clean real notes; the laptop case still needs our own
recordings.

---

# Git Workflow for Team Members

Before starting work, get the latest version:

```bash
git pull
```

After making changes:

```bash
git add .
git commit -m "Describe your changes"
git push
```

Team members should pull the latest changes regularly to reduce merge conflicts.

## Important

Do not upload:

- `.venv`
- `.env`
- `.wav` recordings (the dataset's WAVs go on the shared drive; see section 7)
- Large AI model files
- Passwords, API keys, or other secrets

These files are excluded through `.gitignore`.

---

# Project Goal

The long-term goal is to create an AI-powered guitar coaching system capable of combining:

**Audio Analysis + Computer Vision + Machine Learning**

to provide real-time feedback while a user plays guitar.

The project will first focus on reliable note and pitch detection before expanding to visual string/fret recognition and real-time coaching.