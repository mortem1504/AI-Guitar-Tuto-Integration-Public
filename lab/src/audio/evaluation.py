"""
Scoring the note detector against the labelled dataset.

Pure: labels and audio in, numbers out. `evaluate.py` is the command line
around it, and the pytest suite drives it directly.

A *variant* is a set of parameter overrides on top of what the browser runs
(params.ts plus the lab's last export). Variants whose names start with
"pyin" are the team's original whole-file librosa detector, kept as the
baseline everything else is compared against.
"""

import math
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .dataset import STRING_NAMES, note_name
from .note_detector import Note, find_onsets, onset_key, resolve

# The fixes the build brief asks to measure, each as overrides on the browser's parameters.
VARIANTS = {
    "web": {},
    "yin": {"method": "yin"},
    "octave": {"octaveCheck": True},
    "yin+octave": {"method": "yin", "octaveCheck": True},
    "delay30": {"pitchDelayMs": 30},
    "delay30+octave": {"pitchDelayMs": 30, "octaveCheck": True},
    "median30-150": {"lab_median_from_ms": 30, "lab_median_to_ms": 150},
    "median30-150+octave": {"lab_median_from_ms": 30, "lab_median_to_ms": 150, "octaveCheck": True},
    "range75-1000": {"maxHz": 1000},
    # fluxMin = 22 sits ~4 from decay spikes and from re-plucks on synthetic notes
    # (params.ts); these show which side real recordings fall on: a re-trigger
    # inside a ringing note counts as an extra event, a missed pluck as missed.
    "flux18": {"fluxMin": 18},
    "flux26": {"fluxMin": 26},
}
PYIN_VARIANTS = {"pyin-whole": 1400, "pyin-whole-fmax1000": 1000}

# The prior forgives these intervals (prior.ts).
HARMONIC_INTERVALS = (12, 19, 24)


def classify(expected, detected):
    """What kind of mistake, if any. None means nothing was detected."""
    if detected is None:
        return "unpitched"
    diff = detected - expected
    if diff == 0:
        return "correct"
    if abs(diff) in (12, 24, 36):
        return "octave"
    if abs(diff) in (19, 28):
        return "harmonic"
    if abs(diff) == 7:
        return "fifth"
    if abs(diff) == 1:
        return "semitone"
    return "other"


CLASSES = ("correct", "octave", "harmonic", "fifth", "semitone", "other", "unpitched", "missed")


@dataclass
class ClipResult:
    file: str
    mic_type: str
    string: int
    fret: int
    expected: int
    kind: str  # "note", "unpitched" or "missed"
    detected: int = None
    confidence: float = None
    latency_ms: float = None
    octave_fixed: bool = False
    extra_events: int = 0

    @property
    def outcome(self):
        return "missed" if self.kind == "missed" else classify(self.expected, self.detected)


@dataclass
class VariantScore:
    name: str
    overrides: dict
    results: list = field(default_factory=list)

    @property
    def total(self):
        return len(self.results)

    def count(self, outcome):
        return sum(1 for r in self.results if r.outcome == outcome)

    def rate(self, outcome):
        return self.count(outcome) / self.total if self.total else 0.0

    @property
    def accuracy(self):
        return self.rate("correct")

    def latency(self, percentile):
        values = [r.latency_ms for r in self.results if r.latency_ms is not None]
        return float(np.percentile(values, percentile)) if values else None

    def accuracy_by(self, key):
        groups = {}
        for r in self.results:
            groups.setdefault(key(r), []).append(r.outcome == "correct")
        return {k: sum(v) / len(v) for k, v in sorted(groups.items())}

    def confusions(self):
        """(expected, detected) pairs that went wrong, most common first."""
        pairs = Counter((r.expected, r.detected) for r in self.results if r.outcome not in ("correct",))
        return pairs.most_common()

    def prior(self, max_confidence):
        """
        The exercise-aware prior, judged against the label as target.

        fired: how often it changed a wrong answer into the target.
        false_accept_rate: if the student really had played a note 12, 19 or
        24 semitones from the target, and the detector heard it correctly, how
        often would the prior have called it right anyway? Measured over every
        correctly detected clip and each of those intervals.
        """
        judged = fired = 0
        for r in self.results:
            if r.kind == "note" and abs(r.detected - r.expected) in HARMONIC_INTERVALS and r.confidence < max_confidence:
                fired += 1
                judged += 1
            elif r.outcome == "correct":
                judged += 1
        correct = [r for r in self.results if r.outcome == "correct"]
        would_accept = sum(1 for r in correct if r.confidence < max_confidence)
        return {
            "accuracy": judged / self.total if self.total else 0.0,
            "fired": fired,
            "false_accept_rate": would_accept / len(correct) if correct else 0.0,
        }


def evaluate_clip(label, audio, sample_rate, params, onsets):
    """One clip under one parameter set, given its onsets (cached by the caller)."""
    events = resolve(audio, sample_rate, params, onsets)
    result = ClipResult(label.file, label.mic_type, label.string, label.fret, label.midi, "missed")
    if not events:
        return result
    first = events[0]
    result.extra_events = len(events) - 1
    result.latency_ms = (first.detect_time - first.onset_time) * 1000
    if isinstance(first, Note):
        result.kind = "note"
        result.detected = first.midi
        result.confidence = first.confidence
        result.octave_fixed = first.raw_hz is not None
    else:
        result.kind = "unpitched"
    return result


def evaluate(labels, load, base_params, variants=VARIANTS, pyin=False, progress=None):
    """
    Scores every variant on every clip. `load(label)` returns (samples, rate).
    Returns {name: VariantScore}.
    """
    scores = {name: VariantScore(name, overrides) for name, overrides in variants.items()}
    if pyin:
        for name, fmax in PYIN_VARIANTS.items():
            scores[name] = VariantScore(name, {"pyin_fmax": fmax})

    for index, label in enumerate(labels):
        audio, sample_rate = load(label)
        onset_cache = {}
        for name, overrides in variants.items():
            params = {**base_params, **overrides}
            key = onset_key(params)
            if key not in onset_cache:
                onset_cache[key] = find_onsets(audio, sample_rate, params)
            scores[name].results.append(evaluate_clip(label, audio, sample_rate, params, onset_cache[key]))
        if pyin:
            from .pitch_detector import detect_pitch  # librosa is slow to import; only when asked

            for name, fmax in PYIN_VARIANTS.items():
                hz = detect_pitch(audio.astype(np.float32), sample_rate, fmax=fmax)
                result = ClipResult(label.file, label.mic_type, label.string, label.fret, label.midi, "unpitched")
                if hz:
                    result.kind = "note"
                    result.detected = int(math.floor(69 + 12 * math.log2(hz / 440) + 0.5))
                    result.confidence = 1.0
                scores[name].results.append(result)
        if progress:
            progress(index + 1, len(labels))
    return scores


def exportable(name, overrides):
    """A variant the browser can run as it is: no lab-only parameters, not pYIN."""
    return not name.startswith("pyin") and not any(key.startswith("lab_") for key in overrides)


def best_variant(scores, only_exportable=False):
    """Highest accuracy; ties go to fewer octave errors, then lower p95 latency, then fewer changes."""
    candidates = [s for s in scores.values() if not only_exportable or exportable(s.name, s.overrides)]

    def rank(score):
        latency = score.latency(95)
        return (-score.accuracy, score.rate("octave"), latency if latency is not None else math.inf, len(score.overrides))

    return min(candidates, key=rank) if candidates else None


def describe_string(number):
    return f"{number} ({STRING_NAMES[number]})"


def describe_pair(expected, detected):
    return f"{note_name(expected)} -> {note_name(detected) if detected is not None else 'nothing'}"
