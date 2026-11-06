"""
The labelled note dataset: where clips live, how they are named, and the CSV
that says what each one is.

Layout (the same for real recordings and for synthetic test sets):

    data/notes/labels.csv
    data/notes/<mic_type>/s2_f05_take1.wav

One folder per microphone type, so a laptop's built-in microphone and an
audio interface can both have "string 2, fret 5, take 1". The CSV is the only
index: a WAV with no row is ignored, and `evaluate.py` and the web app's
`npm run audio-check` both read it.
"""

import csv
from dataclasses import asdict, dataclass, fields
from pathlib import Path

import numpy as np
import soundfile as sf

LAB_ROOT = Path(__file__).resolve().parents[2]
NOTES_DIR = LAB_ROOT / "data" / "notes"
SYNTHETIC_DIR = LAB_ROOT / "data" / "synthetic"
LABELS = "labels.csv"

# Standard tuning as MIDI, indexed by string number (1 = thin E), as in the web app.
OPEN_STRINGS = (None, 64, 59, 55, 50, 45, 40)
STRING_NAMES = (None, "thin E", "B", "G", "D", "A", "thick E")
NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

MIC_TYPES = ("builtin", "interface", "external")


@dataclass
class Label:
    file: str  # relative to the dataset folder, with forward slashes
    string: int
    fret: int
    midi: int
    take: int
    mic_type: str
    device: str
    sample_rate: int
    recorded_at: str


def note_name(midi):
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


def expected_midi(string, fret):
    if string not in range(1, 7):
        raise ValueError(f"string must be 1-6, got {string}")
    if fret < 0 or fret > 24:
        raise ValueError(f"fret must be 0-24, got {fret}")
    return OPEN_STRINGS[string] + fret


def clip_name(string, fret, take):
    """s2_f05_take1.wav: sorts by string, then fret, then take."""
    return f"s{string}_f{fret:02d}_take{take}.wav"


def clip_path(mic_type, string, fret, take):
    return f"{mic_type}/{clip_name(string, fret, take)}"


def read_labels(folder=NOTES_DIR):
    path = Path(folder) / LABELS
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    labels = []
    for row in rows:
        labels.append(
            Label(
                file=row["file"],
                string=int(row["string"]),
                fret=int(row["fret"]),
                midi=int(row["midi"]),
                take=int(row["take"]),
                mic_type=row["mic_type"],
                device=row.get("device", ""),
                sample_rate=int(row.get("sample_rate") or 0),
                recorded_at=row.get("recorded_at", ""),
            )
        )
    return labels


def write_labels(labels, folder=NOTES_DIR):
    """Rewrites the CSV, one row per file, sorted. A re-recorded take replaces its old row."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    unique = {label.file: label for label in labels}
    ordered = sorted(unique.values(), key=lambda l: (l.mic_type, l.string, l.fret, l.take))
    with (folder / LABELS).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=[f.name for f in fields(Label)])
        writer.writeheader()
        for label in ordered:
            writer.writerow(asdict(label))


def add_label(label, folder=NOTES_DIR):
    write_labels(read_labels(folder) + [label], folder)


def save_clip(audio, sample_rate, relative, folder=NOTES_DIR):
    """16-bit PCM: what every tool reads, including the web app's Node harness."""
    path = Path(folder) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.clip(audio, -1, 1), sample_rate, subtype="PCM_16")
    return path


def load_clip(relative, folder=NOTES_DIR):
    """Mono float64 samples and the sample rate. Stereo files keep their first channel."""
    audio, sample_rate = sf.read(str(Path(folder) / relative), dtype="float64", always_2d=True)
    return audio[:, 0], sample_rate
