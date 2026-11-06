"""
Measures the note detector on the labelled dataset.

    python evaluate.py                         # data/notes, every variant
    python evaluate.py --pyin                  # also the team's original librosa pYIN detector
    python evaluate.py --data data/synthetic   # the synthetic stand-in, to test the tools
    python evaluate.py --variants web,octave --mic-type builtin

For each variant (the browser's detector, and the fixes the build brief asks
to try), it reports accuracy, octave errors (±12), harmonic errors (+19, the
third harmonic), fifths (+7, the "A4 heard as E5" of the old README), latency
from onset to answer, accuracy per microphone and per string, the most common
confusions, and what the exercise-aware prior would do.

Every run is written to results/<run id>/ (summary.md, summary.json,
per_clip.csv) and copied to results/latest.json, which the web app's
`npm run audio-check` reads to compare the browser's numbers with these.
`export_params.py --run <run id>` sends a winning variant to the browser.
"""

import argparse
import csv
import datetime
import json
import shutil
import subprocess
import sys
from pathlib import Path

from src.audio.dataset import LAB_ROOT, NOTES_DIR, load_clip, note_name, read_labels
from src.audio.evaluation import (
    CLASSES,
    PYIN_VARIANTS,
    VARIANTS,
    best_variant,
    describe_pair,
    describe_string,
    evaluate,
    exportable,
)
from src.audio.web_params import load_params, read_overrides

RESULTS = LAB_ROOT / "results"


def git_commit():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=LAB_ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "nogit"


def percent(value):
    return f"{100 * value:.1f}%"


def ms(value):
    return "—" if value is None else f"{value:.0f}"


def summary_of(score, prior_confidence):
    return {
        "overrides": score.overrides,
        "exportable": exportable(score.name, score.overrides),
        "total": score.total,
        "accuracy": score.accuracy,
        "counts": {c: score.count(c) for c in CLASSES},
        "octave_rate": score.rate("octave"),
        "latency_p50_ms": score.latency(50),
        "latency_p95_ms": score.latency(95),
        "octave_fixes": sum(1 for r in score.results if r.octave_fixed),
        "extra_events": sum(r.extra_events for r in score.results),
        "by_mic": score.accuracy_by(lambda r: r.mic_type),
        "by_string": {str(k): v for k, v in score.accuracy_by(lambda r: r.string).items()},
        "prior": score.prior(prior_confidence),
    }


def markdown(run_id, data, labels, scores, summary, lab_run):
    lines = [f"# Evaluation run {run_id}", ""]
    mics = sorted({l.mic_type for l in labels})
    lines += [
        f"- Dataset: `{data}` — {len(labels)} clips, microphones: {', '.join(mics)}",
        f"- Browser parameters: params.ts" + (f" + lab export `{lab_run}`" if lab_run else " (no lab export yet)"),
        f"- Synthetic: {'**yes — these numbers test the tools, not the detector on a guitar**' if summary['synthetic'] else 'no'}",
        "",
        "## Variants",
        "",
        "| variant | accuracy | octave | +19 | fifth | ±1 | other | unpitched | missed | extra events | latency p50 / p95 ms | octave fixes |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for name, s in summary["variants"].items():
        c = s["counts"]
        lines.append(
            f"| {name}{'' if s['exportable'] else ' †'} | {percent(s['accuracy'])} | {c['octave']} | {c['harmonic']} | {c['fifth']} | {c['semitone']} | {c['other']} | {c['unpitched']} | {c['missed']} | {s['extra_events']} | {ms(s['latency_p50_ms'])} / {ms(s['latency_p95_ms'])} | {s['octave_fixes']} |"
        )
    lines += [
        "",
        "† not exportable to the browser as it is (lab-only parameters, or the pYIN baseline).",
        "Extra events: notes reported after the first in a one-pluck clip (a re-trigger inside the ringing note).",
        "",
    ]

    lines += ["## By microphone", "", "| variant | " + " | ".join(mics) + " |", "| --- |" + " --- |" * len(mics)]
    for name, s in summary["variants"].items():
        lines.append(f"| {name} | " + " | ".join(percent(s["by_mic"].get(m, 0)) for m in mics) + " |")

    for title, name in (("The browser as it runs", "web"), ("Best exportable variant", summary["best_exportable"])):
        if name not in scores:
            continue
        score = scores[name]
        lines += ["", f"## {title}: `{name}`", "", "Accuracy by string:", ""]
        for string, value in score.accuracy_by(lambda r: r.string).items():
            lines.append(f"- string {describe_string(string)}: {percent(value)}")
        lines += ["", "Most common confusions (expected -> detected: clips):", ""]
        confusions = score.confusions()[:12]
        lines += [f"- {describe_pair(e, d)}: {n}" for (e, d), n in confusions] or ["- none"]
        prior = summary["variants"][name]["prior"]
        lines += [
            "",
            f"Exercise-aware prior (confidence < {summary['params']['priorMaxConfidence']}): accuracy {percent(prior['accuracy'])}, "
            f"fired {prior['fired']} times; would wrongly accept {percent(prior['false_accept_rate'])} of real octave/12th mistakes.",
        ]
    return "\n".join(lines) + "\n"


def write_per_clip(path, scores):
    names = list(scores)
    first = scores[names[0]].results
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        header = ["file", "mic_type", "string", "fret", "expected", "expected_name"]
        for name in names:
            header += [f"{name}_midi", f"{name}_outcome", f"{name}_confidence", f"{name}_latency_ms"]
        writer.writerow(header)
        for index, base in enumerate(first):
            row = [base.file, base.mic_type, base.string, base.fret, base.expected, note_name(base.expected)]
            for name in names:
                r = scores[name].results[index]
                row += [
                    "" if r.detected is None else r.detected,
                    r.outcome,
                    "" if r.confidence is None else f"{r.confidence:.4f}",
                    "" if r.latency_ms is None else f"{r.latency_ms:.1f}",
                ]
            writer.writerow(row)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Measure the note detector on the labelled dataset.")
    parser.add_argument("--data", default=str(NOTES_DIR), help="Dataset folder with labels.csv (default data/notes).")
    parser.add_argument("--variants", default="all", help=f"Comma-separated, or 'all': {', '.join(VARIANTS)}.")
    parser.add_argument("--pyin", action="store_true", help="Also run the original librosa pYIN detector (slow).")
    parser.add_argument("--mic-type", default=None, help="Only clips from this microphone type.")
    parser.add_argument("--out", default=str(RESULTS), help="Where runs are written (default results/).")
    args = parser.parse_args(argv)

    data = Path(args.data).resolve()
    labels = read_labels(data)
    if args.mic_type:
        labels = [l for l in labels if l.mic_type == args.mic_type]
    if not labels:
        print(f"No labelled clips in {data}. Record some with record_dataset.py, or run make_synthetic_dataset.py.")
        return 1

    variants = VARIANTS if args.variants == "all" else {n: VARIANTS[n] for n in args.variants.split(",")}
    base = load_params()
    _, lab_run = read_overrides()

    def progress(done, total):
        print(f"\r  {done}/{total} clips", end="", file=sys.stderr, flush=True)

    print(f"Evaluating {len(labels)} clips from {data} ...", file=sys.stderr)
    scores = evaluate(labels, lambda l: load_clip(l.file, data), base, variants, pyin=args.pyin, progress=progress)
    print(file=sys.stderr)

    synthetic = all(l.mic_type.startswith("synthetic") for l in labels)
    dataset_name = "synthetic" if synthetic else data.name
    run_id = f"{datetime.datetime.now():%Y%m%d-%H%M%S}-{dataset_name}-{git_commit()}"
    best = best_variant(scores)
    best_export = best_variant(scores, only_exportable=True)
    try:
        dataset_label = str(data.relative_to(LAB_ROOT))
    except ValueError:
        dataset_label = str(data)
    summary = {
        "run_id": run_id,
        "created": datetime.datetime.now().isoformat(timespec="seconds"),
        "dataset": dataset_label,
        "clips": len(labels),
        "mic_types": {m: sum(1 for l in labels if l.mic_type == m) for m in sorted({l.mic_type for l in labels})},
        "synthetic": synthetic,
        "params": base,
        "lab_run": lab_run,
        "variants": {name: summary_of(score, base["priorMaxConfidence"]) for name, score in scores.items()},
        "best": best.name,
        "best_exportable": best_export.name if best_export else None,
    }

    folder = Path(args.out) / run_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (folder / "summary.md").write_text(markdown(run_id, dataset_label, labels, scores, summary, lab_run), encoding="utf-8")
    write_per_clip(folder / "per_clip.csv", scores)
    latest = {**summary, "per_clip": str((folder / "per_clip.csv").resolve())}
    (Path(args.out) / "latest.json").write_text(json.dumps(latest, indent=2), encoding="utf-8")

    print(f"\nRun {run_id}{'  (SYNTHETIC)' if synthetic else ''}\n")
    print(f"{'variant':<22}{'accuracy':>9}{'octave':>8}{'+19':>5}{'fifth':>7}{'other':>7}{'unpitched':>11}{'missed':>8}{'extra':>7}{'p50/p95 ms':>13}")
    for name, s in summary["variants"].items():
        c = s["counts"]
        print(
            f"{name:<22}{percent(s['accuracy']):>9}{c['octave']:>8}{c['harmonic']:>5}{c['fifth']:>7}{c['other'] + c['semitone']:>7}"
            f"{c['unpitched']:>11}{c['missed']:>8}{s['extra_events']:>7}{ms(s['latency_p50_ms']) + '/' + ms(s['latency_p95_ms']):>13}"
        )
    print(f"\nBest: {best.name}.  Best the browser can run: {summary['best_exportable']}.")
    print(f"Report: {folder / 'summary.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
