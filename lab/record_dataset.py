"""
Guided recording of the labelled note dataset.

    python record_dataset.py --mic-type builtin
    python record_dataset.py --mic-type interface --device 2
    python record_dataset.py --list-devices

It asks for one note at a time ("string 2 (B), fret 5: C#4"), records 1.5 s
when you press Enter, checks the take, and saves it as
data/notes/<mic_type>/s2_f05_take1.wav with a row in data/notes/labels.csv
(string, fret, expected MIDI, take, mic type, device, sample rate, time).

The target is every string, frets 0-12, two takes: 156 clips per microphone.
It resumes where it stopped: takes already in labels.csv are skipped.

How to record a good take:
  - Press Enter, *then* pluck once, firmly, and let it ring. The clip starts
    on Enter, so a note plucked before it has no beginning to detect.
  - Mute the other strings with your fretting hand.
  - Play the way you would in a lesson. Do not redo a take because it sounded
    a little off: the dataset has to contain ordinary playing.

The check after each take is about the *recording* only: clipping, too quiet,
or plucked too early. It deliberately does not say what note the detector
heard. If it did, takes would get redone until the detector agreed, and the
dataset would measure the detector against itself.
"""

import argparse
import datetime
import sys

import numpy as np

from src.audio.dataset import (
    MIC_TYPES,
    NOTES_DIR,
    STRING_NAMES,
    Label,
    add_label,
    clip_path,
    expected_midi,
    note_name,
    read_labels,
    save_clip,
)

SECONDS = 1.5
SAMPLE_RATE = 48000

# Take checks. Full scale is 1.0.
CLIP_LEVEL = 0.98  # a sample this close to full scale has probably clipped
QUIET_PEAK = 0.01  # -40 dBFS: too quiet to be a plucked note on any input
EARLY_FRACTION = 0.3  # the first 100 ms louder than this share of the loudest 50 ms means it started already ringing


def parse_range(text, low, high):
    """'0-12' or '1,3,5' or '6' -> a sorted list within [low, high]."""
    values = set()
    for part in text.split(","):
        part = part.strip()
        if "-" in part:
            start, end = (int(v) for v in part.split("-", 1))
            values.update(range(start, end + 1))
        elif part:
            values.add(int(part))
    bad = [v for v in values if v < low or v > high]
    if bad:
        raise argparse.ArgumentTypeError(f"out of range {low}-{high}: {sorted(bad)}")
    return sorted(values)


def plan_takes(strings, frets, takes, mic_type, existing_files):
    """Every (string, fret, take) still to record, thick E first, in playing order."""
    plan = []
    for string in sorted(strings, reverse=True):
        for fret in frets:
            for take in range(1, takes + 1):
                if clip_path(mic_type, string, fret, take) not in existing_files:
                    plan.append((string, fret, take))
    return plan


def check_take(audio, sample_rate):
    """Problems with a recording, as short sentences. Empty means it is fine."""
    problems = []
    peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
    if peak >= CLIP_LEVEL:
        problems.append("it clipped: turn the input gain down a little")
    if peak < QUIET_PEAK:
        problems.append("too quiet to be a note: pluck harder, move closer, or raise the gain")
        return problems
    block = int(0.05 * sample_rate)
    blocks = [audio[i : i + block] for i in range(0, len(audio) - block + 1, block)]
    loudest = max(float(np.sqrt(np.mean(b * b))) for b in blocks)
    head = audio[: int(0.1 * sample_rate)]
    if len(head) and float(np.sqrt(np.mean(head * head))) > EARLY_FRACTION * loudest:
        problems.append("the note was already ringing when recording started: press Enter, then pluck")
    return problems


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Record the labelled single-note dataset.")
    parser.add_argument("--mic-type", choices=MIC_TYPES, help="Which kind of input this session uses.")
    parser.add_argument("--device", default=None, help="Input device index or name (see --list-devices).")
    parser.add_argument("--list-devices", action="store_true", help="List audio devices and exit.")
    parser.add_argument("--strings", default="1-6", help="Strings to record, e.g. 1-6 or 6,5 (default 1-6).")
    parser.add_argument("--frets", default="0-12", help="Frets to record, e.g. 0-12 (default 0-12).")
    parser.add_argument("--takes", type=int, default=2, help="Takes per note (default 2).")
    parser.add_argument("--seconds", type=float, default=SECONDS, help="Seconds per take (default 1.5).")
    parser.add_argument("--samplerate", type=int, default=SAMPLE_RATE, help="Sample rate (default 48000).")
    args = parser.parse_args(argv)
    if not args.list_devices and not args.mic_type:
        parser.error("--mic-type is required (builtin, interface or external)")
    args.strings = parse_range(args.strings, 1, 6)
    args.frets = parse_range(args.frets, 0, 24)
    return args


def main(argv=None):
    import sounddevice as sd  # imported here so the pure helpers above can be tested without audio hardware

    args = parse_args(argv)
    if args.list_devices:
        print(sd.query_devices())
        return 0

    device = int(args.device) if args.device is not None and args.device.isdigit() else args.device
    device_name = sd.query_devices(device, kind="input")["name"]

    existing = {label.file for label in read_labels()}
    plan = plan_takes(args.strings, args.frets, args.takes, args.mic_type, existing)
    print(f"Recording from: {device_name}  ({args.mic_type}, {args.samplerate} Hz)")
    print(f"{len(plan)} takes to record into {NOTES_DIR}. Enter = record, s = skip, q = quit.\n")

    done = 0
    for index, (string, fret, take) in enumerate(plan, start=1):
        midi = expected_midi(string, fret)
        prompt = f"[{index}/{len(plan)}] string {string} ({STRING_NAMES[string]}), fret {fret}: {note_name(midi)}  take {take}"
        while True:
            answer = input(f"{prompt}  > ").strip().lower()
            if answer == "q":
                print(f"\nStopped. {done} takes saved this session.")
                return 0
            if answer == "s":
                break
            print("  recording... pluck now")
            audio = sd.rec(int(args.seconds * args.samplerate), samplerate=args.samplerate, channels=1, dtype="float32", device=device)
            sd.wait()
            audio = audio[:, 0].astype(np.float64)

            problems = check_take(audio, args.samplerate)
            if problems:
                for problem in problems:
                    print(f"  ! {problem}")
                if input("  keep it anyway? [y/N] ").strip().lower() != "y":
                    continue

            relative = clip_path(args.mic_type, string, fret, take)
            save_clip(audio, args.samplerate, relative)
            add_label(
                Label(
                    file=relative,
                    string=string,
                    fret=fret,
                    midi=midi,
                    take=take,
                    mic_type=args.mic_type,
                    device=device_name,
                    sample_rate=args.samplerate,
                    recorded_at=datetime.datetime.now().isoformat(timespec="seconds"),
                )
            )
            done += 1
            print(f"  saved {relative}  (peak {20 * np.log10(max(np.max(np.abs(audio)), 1e-9)):.0f} dBFS)")
            break

    print(f"\nAll done. {done} takes saved this session.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
