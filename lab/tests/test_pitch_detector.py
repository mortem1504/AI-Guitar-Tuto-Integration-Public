"""The team's original whole-file pYIN detector, kept as evaluate.py's baseline."""

import numpy as np
import pytest

from src.audio.pitch_detector import detect_pitch, frequency_to_note

# Standard tuning, thick E first.
OPEN_STRINGS = [("E2", 82.41), ("A2", 110.00), ("D3", 146.83), ("G3", 196.00), ("B3", 246.94), ("E4", 329.63)]


LOW_E_MISSED = pytest.mark.xfail(
    strict=True,
    reason="known baseline defect: pYIN's voiced probability for 82 Hz peaks at 0.69 (0.24 at 48 kHz), "
    "under detect_pitch's 0.7 cut, so the thick E is never heard. Kept as found: it is the baseline.",
)


@pytest.mark.parametrize(
    "expected, frequency",
    [pytest.param(*OPEN_STRINGS[0], marks=LOW_E_MISSED)] + OPEN_STRINGS[1:],
)
def test_detects_open_string_sines(expected, frequency):
    sample_rate = 22050
    t = np.arange(int(sample_rate * 1.0)) / sample_rate
    audio = np.sin(2 * np.pi * frequency * t)
    assert frequency_to_note(detect_pitch(audio, sample_rate)) == expected


def test_silence_is_no_pitch():
    assert detect_pitch(np.zeros(22050), 22050) is None
    assert frequency_to_note(None) is None


def test_note_names():
    assert frequency_to_note(440.0) == "A4"
    assert frequency_to_note(1318.5) == "E6"
