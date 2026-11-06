"""Scoring, choosing a variant, and what export_params.py refuses."""

import pytest

from export_params import ExportError, plan_export, render
from src.audio.evaluation import ClipResult, VariantScore, best_variant, classify, exportable
from src.audio.web_params import load_params, read_defaults


def test_classify():
    assert classify(57, 57) == "correct"
    assert classify(57, 69) == "octave" and classify(57, 45) == "octave"
    assert classify(57, 76) == "harmonic"
    assert classify(69, 76) == "fifth"
    assert classify(57, 58) == "semitone"
    assert classify(57, 62) == "other"
    assert classify(57, None) == "unpitched"


def result(expected, detected, confidence=0.99, kind="note"):
    return ClipResult("f.wav", "builtin", 5, 0, expected, kind, detected, confidence, 60.0)


def test_scores_and_prior():
    score = VariantScore("web", {}, [result(45, 45), result(45, 57, 0.95), result(45, 57, 0.99), result(45, None, kind="missed")])
    assert score.accuracy == 0.25
    assert score.count("octave") == 2 and score.count("missed") == 1
    prior = score.prior(0.97)
    assert prior["fired"] == 1  # only the low-confidence octave
    assert prior["accuracy"] == 0.5
    assert prior["false_accept_rate"] == 0.0


def test_best_variant_prefers_accuracy_then_octaves_then_fewer_changes():
    a = VariantScore("web", {}, [result(45, 45), result(45, 57)])
    b = VariantScore("octave", {"octaveCheck": True}, [result(45, 45), result(45, 52)])
    c = VariantScore("median", {"lab_median_from_ms": 30}, [result(45, 45), result(45, 45)])
    scores = {s.name: s for s in (a, b, c)}
    assert best_variant(scores).name == "median"
    assert best_variant(scores, only_exportable=True).name == "octave"
    assert not exportable("pyin-whole", {}) and not exportable("m", {"lab_x": 1})


def run(synthetic=False, params=None):
    variant = lambda acc, octave, overrides, ok=True: {
        "accuracy": acc, "counts": {"octave": octave}, "overrides": overrides, "exportable": ok,
    }
    return {
        "run_id": "20261102-000000-notes-abc", "dataset": "data/notes", "clips": 312,
        "mic_types": {"builtin": 156, "interface": 156}, "synthetic": synthetic,
        "params": params or load_params(), "lab_run": None,
        "variants": {
            "web": variant(0.93, 12, {}),
            "octave": variant(0.97, 2, {"octaveCheck": True}),
            "median30-150": variant(0.98, 1, {"lab_median_from_ms": 30}, ok=False),
        },
    }


def test_export_writes_only_what_changed_with_its_evidence():
    defaults, current = read_defaults(), load_params()
    entries, _, _ = plan_export(run(), "octave", defaults, current)
    changed = [key for key, _, _ in entries if current.get(key) == defaults.get(key)]
    assert "octaveCheck" in changed
    text = render(run(), "octave", entries)
    assert 'LAB_RUN: string | null = "20261102-000000-notes-abc"' in text
    assert "accuracy 97.0% vs 93.0%, octave errors 2 vs 12" in text
    assert "octaveCheck: true," in text


@pytest.mark.parametrize(
    "case, variant",
    [("synthetic", "octave"), ("lab-only", "median30-150"), ("missing", "nope"), ("stale", "octave")],
)
def test_export_refuses(case, variant):
    defaults, current = read_defaults(), load_params()
    data = run(synthetic=case == "synthetic", params={**current, "maxHz": 999} if case == "stale" else None)
    with pytest.raises(ExportError):
        plan_export(data, variant, defaults, current)
