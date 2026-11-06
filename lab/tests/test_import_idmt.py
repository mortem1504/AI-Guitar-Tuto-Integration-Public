"""import_idmt.py on a tiny made-up tree in the dataset's layout: which notes it keeps, and how."""

import numpy as np
import soundfile as sf

from import_idmt import convert, our_string
from src.audio.dataset import read_labels


def annotation(pitch, fret, string, expression="NO", excitation="PK", events=1):
    event = (
        f"<event><pitch>{pitch}</pitch><onsetSec>0.1</onsetSec><offsetSec>1.0</offsetSec>"
        f"<fretNumber>{fret}</fretNumber><stringNumber>{string}</stringNumber>"
        f"<excitationStyle>{excitation}</excitationStyle><expressionStyle>{expression}</expressionStyle></event>"
    )
    return f"<instrumentRecording><transcription>{event * events}</transcription></instrumentRecording>"


def write(root, guitar, name, xml):
    (root / guitar / "annotation").mkdir(parents=True, exist_ok=True)
    (root / guitar / "audio").mkdir(parents=True, exist_ok=True)
    (root / guitar / "annotation" / f"{name}.xml").write_text(xml)
    sf.write(str(root / guitar / "audio" / f"{name}.wav"), np.zeros(4410), 44100, subtype="PCM_16")


def test_string_numbering_is_found_either_way():
    assert our_string(45, 0, 5) == 5  # our numbering: string 5 is A
    assert our_string(45, 0, 2) == 5  # numbered from the thick E: 2 is A too
    assert our_string(46, 0, 5) is None  # pitch and position disagree


def test_keeps_clean_isolated_notes_and_points_at_the_originals(tmp_path):
    source = tmp_path / "IDMT-SMT-GUITAR_V2" / "dataset1"
    write(source, "Strat Clean", "a2", annotation(45, 0, 5))
    write(source, "Strat Clean", "c4", annotation(60, 1, 2))
    write(source, "Strat Clean", "bend", annotation(57, 2, 3, expression="BE"))
    write(source, "Strat Clean", "muted", annotation(50, 0, 4, excitation="MU"))
    write(source, "Strat Clean", "two", annotation(45, 0, 5, events=2))
    write(source, "Strat Clean", "wrong", annotation(47, 0, 5))
    out = tmp_path / "out"
    labels, skipped = convert(tmp_path / "IDMT-SMT-GUITAR_V2", out)
    assert sorted((l.string, l.fret, l.midi) for l in labels) == [(2, 1, 60), (5, 0, 45)]
    assert skipped["expression BE"] == 1 and skipped["excitation MU"] == 1
    assert skipped["not an isolated note"] == 1 and skipped["string/fret do not give the pitch"] == 1
    stored = read_labels(out)
    assert {l.mic_type for l in stored} == {"idmt-dataset1-strat-clean"}
    for label in stored:
        assert label.file.startswith("../IDMT-SMT-GUITAR_V2/")
        assert (out / label.file).exists()
