"""
The Phase 2 acceptance test, on the recorded guitar dataset.

    pytest tests/test_dataset_accuracy.py

The browser's detector, with today's params.ts and params.lab.ts, must name
at least 95% of data/notes correctly with under 2% octave errors. Skipped
until data/notes/labels.csv exists: record it with record_dataset.py.
"""

import pytest

from src.audio.dataset import NOTES_DIR, load_clip, read_labels
from src.audio.evaluation import evaluate
from src.audio.web_params import load_params

LABELS = read_labels(NOTES_DIR)


@pytest.fixture(scope="module")
def score():
    if not LABELS:
        pytest.skip("no recordings yet: run record_dataset.py to make data/notes/labels.csv")
    scores = evaluate(LABELS, lambda l: load_clip(l.file, NOTES_DIR), load_params(), {"web": {}})
    return scores["web"]


def test_accuracy_at_least_95_percent(score):
    wrong = [f"{r.file}: {r.outcome} {r.detected}" for r in score.results if r.outcome != "correct"]
    assert score.accuracy >= 0.95, f"{score.accuracy:.1%} correct; wrong: {wrong[:20]}"


def test_octave_errors_under_2_percent(score):
    assert score.rate("octave") < 0.02, f"{score.count('octave')} octave errors in {score.total}"
