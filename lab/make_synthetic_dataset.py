"""
A synthetic stand-in for the recorded dataset, for testing the tools.

    python make_synthetic_dataset.py

Writes data/synthetic/ in exactly the layout `record_dataset.py` produces
(labels.csv plus one WAV per take), so `evaluate.py --data data/synthetic` and
the web app's `npm run audio-check -- --data ../lab/data/synthetic` can be run
end to end before anyone has recorded a guitar.

Three "microphones": synthetic-clean, synthetic-noisy, and synthetic-trap
(laptop-like high-pass plus weak odd partials, which reliably produces octave
errors). Its numbers show that the tools work. They are not a measurement of
the detector on a guitar, and `export_params.py` refuses to export from them.
"""

import argparse
import datetime

from src.audio.dataset import SYNTHETIC_DIR, Label, clip_path, expected_midi, save_clip, write_labels
from src.audio.synth import note_clip

VARIANTS = {
    "synthetic-clean": {"room": "clean", "odd_gain": 1.0},
    "synthetic-noisy": {"room": "noisy", "odd_gain": 1.0},
    "synthetic-trap": {"room": "laptop", "odd_gain": 0.15},
}


def build(folder=SYNTHETIC_DIR, frets=range(0, 13), takes=2, sample_rate=48000):
    labels = []
    stamp = datetime.datetime.now().isoformat(timespec="seconds")
    for index, (mic_type, variant) in enumerate(VARIANTS.items()):
        for string in range(1, 7):
            for fret in frets:
                for take in range(1, takes + 1):
                    midi = expected_midi(string, fret)
                    seed = index * 100000 + string * 1000 + fret * 10 + take
                    audio = note_clip(midi, sample_rate, variant["room"], seed, odd_gain=variant["odd_gain"])
                    relative = clip_path(mic_type, string, fret, take)
                    save_clip(audio, sample_rate, relative, folder)
                    labels.append(Label(relative, string, fret, midi, take, mic_type, "synthesised", sample_rate, stamp))
    write_labels(labels, folder)
    return labels


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--takes", type=int, default=2)
    args = parser.parse_args()
    labels = build(takes=args.takes)
    print(f"Wrote {len(labels)} clips to {SYNTHETIC_DIR}")


if __name__ == "__main__":
    main()
