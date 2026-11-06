"""Naming, labels and the recording helpers (no audio hardware needed)."""

import argparse

import numpy as np
import pytest

from record_dataset import check_take, parse_range, plan_takes
from src.audio.dataset import Label, clip_path, expected_midi, load_clip, note_name, read_labels, save_clip, write_labels


def test_names_and_notes():
    assert clip_path("builtin", 2, 5, 1) == "builtin/s2_f05_take1.wav"
    assert expected_midi(6, 0) == 40 and expected_midi(1, 12) == 76
    assert note_name(61) == "C#4"


def test_parse_range():
    assert parse_range("0-3,7", 0, 12) == [0, 1, 2, 3, 7]
    assert parse_range("6", 1, 6) == [6]
    with pytest.raises(argparse.ArgumentTypeError):
        parse_range("0-7", 1, 6)


def test_plan_resumes_and_starts_on_the_thick_string():
    existing = {clip_path("builtin", 6, 0, 1)}
    plan = plan_takes([1, 6], [0, 1], 2, "builtin", existing)
    assert plan[0] == (6, 0, 2)
    assert (6, 0, 1) not in plan
    assert len(plan) == 7


def test_check_take():
    sr = 48000
    t = np.arange(int(1.5 * sr)) / sr
    good = np.where(t > 0.3, 0.3 * np.sin(2 * np.pi * 110 * t) * np.exp(-(t - 0.3)), 0.0)
    assert check_take(good, sr) == []
    assert any("clipped" in p for p in check_take(np.clip(good * 5, -1, 1), sr))
    assert any("quiet" in p for p in check_take(good * 0.01, sr))
    early = 0.3 * np.sin(2 * np.pi * 110 * t) * np.exp(-t)
    assert any("already ringing" in p for p in check_take(early, sr))


def test_labels_and_clips_round_trip(tmp_path):
    label = Label("builtin/s5_f00_take1.wav", 5, 0, 45, 1, "builtin", "Mic, built-in", 48000, "2026-11-02T10:00:00")
    write_labels([label, label], tmp_path)
    assert read_labels(tmp_path) == [label]
    audio = np.sin(np.linspace(0, 100, 4800)) * 0.5
    save_clip(audio, 48000, label.file, tmp_path)
    loaded, sr = load_clip(label.file, tmp_path)
    assert sr == 48000 and np.max(np.abs(loaded - audio)) < 1e-4
