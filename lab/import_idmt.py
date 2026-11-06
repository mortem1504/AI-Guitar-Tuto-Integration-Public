"""
Turns the isolated notes of IDMT-SMT-Guitar V2 into our labels.csv.

    python import_idmt.py --source data/external/idmt/IDMT-SMT-GUITAR_V2
    python evaluate.py --data data/external/idmt-isolated --pyin
    (cd ../web && npm run audio-check -- --data ../lab/data/external/idmt-isolated)

The dataset (Kehling et al., Fraunhofer IDMT, zenodo.org/records/7544110) is
CC BY-NC-ND 4.0: it is used here for evaluation only, never committed, never
redistributed, and its files are never modified. This script writes one file,
`labels.csv`, in a folder of its own under the gitignored `data/external/`,
whose rows point at the original WAVs where they are. Run it from `lab/`:
the extracted archive is data, never on Python's import path.

Which notes count as "clean": one annotated event in the recording (an
isolated note), played normally (expression style NO: no bend, slide,
vibrato, harmonic or dead note) and not muted (excitation MU). The string and
fret come from the annotation, cross-checked against the pitch in standard
tuning; a note whose annotation does not add up is skipped and counted.

Each guitar/pickup becomes a `mic_type`, so evaluate.py reports accuracy per
instrument the way it reports per microphone for our own recordings.
"""

import argparse
import collections
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import soundfile as sf

from src.audio.dataset import LAB_ROOT, OPEN_STRINGS, Label, write_labels

DEFAULT_OUT = LAB_ROOT / "data" / "external" / "idmt-isolated"
DEVICE = "IDMT-SMT-Guitar V2 (CC BY-NC-ND 4.0, evaluation only)"
CLEAN_EXPRESSION = {"NO"}
SKIP_EXCITATION = {"MU"}


def text_of(element, *names):
    """The text of the first child with one of these tag names, searched at any depth."""
    for name in names:
        found = element.find(f".//{name}")
        if found is not None and found.text is not None:
            return found.text.strip()
    return None


def our_string(pitch, fret, annotated):
    """
    Our numbering is 1 = thin E. The annotation's may run either way; take the
    one under which the annotated string and fret give the annotated pitch.
    """
    for string in (annotated, 7 - annotated):
        if string in range(1, 7) and OPEN_STRINGS[string] + fret == pitch:
            return string
    return None


def events_of(xml_path):
    root = ET.parse(xml_path).getroot()
    events = root.findall(".//event")
    out = []
    for event in events:
        out.append(
            {
                "pitch": text_of(event, "pitch"),
                "fret": text_of(event, "fretNumber", "fret"),
                "string": text_of(event, "stringNumber", "string"),
                "excitation": text_of(event, "excitationStyle"),
                "expression": text_of(event, "expressionStyle"),
            }
        )
    audio_name = text_of(root, "audioFileName")
    return out, audio_name


def find_wav(xml_path, audio_name):
    """The WAV an annotation describes: named in it, or the same stem, beside it or in a sibling audio folder."""
    stems = [Path(audio_name).stem] if audio_name else []
    stems.append(xml_path.stem)
    folders = [xml_path.parent, xml_path.parent.parent / "audio", xml_path.parent.parent]
    for folder in folders:
        for stem in stems:
            candidate = folder / f"{stem}.wav"
            if candidate.exists():
                return candidate
    return None


def instrument_of(xml_path, source):
    """The path below the source down to the guitar's folder, as a mic_type: 'dataset1-ibanez-power-strat-clean'."""
    parts = [p for p in xml_path.relative_to(source).parts[:-1] if p.lower() not in ("annotation", "annotations", "audio", "xml")]
    slug = "-".join(parts) or "idmt"
    return "idmt-" + re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")


def convert(source, out):
    source, out = Path(source).resolve(), Path(out).resolve()
    labels, skipped = [], collections.Counter()
    takes = collections.Counter()
    for xml_path in sorted(source.rglob("*.xml")):
        try:
            events, audio_name = events_of(xml_path)
        except ET.ParseError:
            skipped["unreadable xml"] += 1
            continue
        if len(events) != 1:
            skipped["not an isolated note"] += 1
            continue
        event = events[0]
        if event["expression"] not in CLEAN_EXPRESSION:
            skipped[f"expression {event['expression']}"] += 1
            continue
        if event["excitation"] in SKIP_EXCITATION:
            skipped[f"excitation {event['excitation']}"] += 1
            continue
        try:
            pitch, fret, annotated = int(event["pitch"]), int(event["fret"]), int(event["string"])
        except (TypeError, ValueError):
            skipped["missing pitch/string/fret"] += 1
            continue
        string = our_string(pitch, fret, annotated) if 0 <= fret <= 24 else None
        if string is None:
            skipped["string/fret do not give the pitch"] += 1
            continue
        wav = find_wav(xml_path, audio_name)
        if wav is None:
            skipped["no wav"] += 1
            continue
        mic_type = instrument_of(xml_path, source)
        takes[(mic_type, string, fret)] += 1
        info = sf.info(str(wav))
        labels.append(
            Label(
                # Relative to labels.csv, pointing at the WAV where it is: nothing copied.
                file=Path(os.path.relpath(wav.resolve(), out)).as_posix(),
                string=string,
                fret=fret,
                midi=pitch,
                take=takes[(mic_type, string, fret)],
                mic_type=mic_type,
                device=DEVICE,
                sample_rate=info.samplerate,
                recorded_at="",
            )
        )
    write_labels(labels, out)
    return labels, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", required=True, help="the extracted IDMT-SMT-GUITAR_V2 folder")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help=f"where labels.csv goes (default {DEFAULT_OUT})")
    args = parser.parse_args()
    labels, skipped = convert(args.source, args.out)
    by_mic = collections.Counter(l.mic_type for l in labels)
    print(f"{len(labels)} clean isolated notes -> {Path(args.out) / 'labels.csv'}")
    for mic, count in sorted(by_mic.items()):
        print(f"  {mic}: {count}")
    if skipped:
        print("skipped: " + ", ".join(f"{reason} {count}" for reason, count in skipped.most_common()))
    if not labels:
        sys.exit("no notes found: is --source the extracted dataset?")


if __name__ == "__main__":
    main()
