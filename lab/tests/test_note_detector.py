"""The Python mirror of the browser's NoteDetector, on synthesised plucks."""

import numpy as np
import pytest

from src.audio.dataset import OPEN_STRINGS, expected_midi
from src.audio.note_detector import Note, detect, first_event, hz_of, midi_of
from src.audio.synth import note_clip
from src.audio.web_params import load_params

SR = 48000
PARAMS = load_params()


def test_midi_rounding_matches_javascript():
    assert midi_of(440.0) == 69
    assert midi_of(hz_of(60)) == 60
    # Exactly half a semitone up rounds up, like Math.round.
    assert midi_of(440.0 * 2 ** (0.5 / 12)) == 70


@pytest.mark.parametrize("room", ["clean", "noisy", "laptop"])
@pytest.mark.parametrize("string", range(1, 7))
def test_open_strings_and_fifth_fret(room, string):
    for fret in (0, 5):
        midi = expected_midi(string, fret)
        event = first_event(note_clip(midi, SR, room, seed=string * 10 + fret), SR, PARAMS)
        assert isinstance(event, Note), (string, fret, event)
        assert event.midi == midi, (string, fret, event.midi)


def test_one_event_per_pluck():
    events = detect(note_clip(OPEN_STRINGS[6], SR, "noisy", seed=3), SR, PARAMS)
    assert len(events) == 1


def test_noise_alone_is_silent():
    rng = np.random.default_rng(1)
    assert detect(rng.standard_normal(SR) * 0.003, SR, PARAMS) == []


def test_latency_within_the_brief():
    event = first_event(note_clip(64, SR, "clean", seed=5), SR, PARAMS)
    assert (event.detect_time - event.onset_time) * 1000 < 120


def test_octave_check_fixes_the_trap():
    """Weak odd partials through a laptop microphone: the octave trap."""
    notes = [expected_midi(s, 0) for s in range(1, 7)]
    clips = [note_clip(m, SR, "laptop", seed=40 + m, odd_gain=0.15) for m in notes]
    without = [first_event(c, SR, {**PARAMS, "octaveCheck": False}).midi for c in clips]
    with_check = [first_event(c, SR, {**PARAMS, "octaveCheck": True}) for c in clips]
    assert without != notes, "the trap should fool the detector without the check"
    assert [e.midi for e in with_check] == notes
    assert all(e.raw_hz is not None for e in with_check)


def test_octave_check_leaves_normal_plucks_alone():
    params = {**PARAMS, "octaveCheck": True}
    for string in range(1, 7):
        for fret in (0, 3, 7, 12):
            midi = expected_midi(string, fret)
            event = first_event(note_clip(midi, SR, "clean", seed=midi), SR, params)
            assert event.midi == midi and event.raw_hz is None, (string, fret, event)


def test_other_sample_rates():
    event = first_event(note_clip(45, 44100, "clean", seed=2), 44100, PARAMS)
    assert event.midi == 45
