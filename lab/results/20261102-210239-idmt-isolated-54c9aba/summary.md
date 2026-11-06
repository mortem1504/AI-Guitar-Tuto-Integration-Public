# Evaluation run 20261102-210239-idmt-isolated-54c9aba

- Dataset: `data/external/idmt-isolated` — 312 clips, microphones: idmt-dataset1-fender-strat-clean-neck-sc, idmt-dataset1-ibanez-power-strat-clean-bridge-hu, idmt-dataset1-ibanez-power-strat-clean-bridge-neck-sc, idmt-dataset1-ibanez-power-strat-clean-neck-hu
- Browser parameters: params.ts (no lab export yet)
- Synthetic: no

## Variants

| variant | accuracy | octave | +19 | fifth | ±1 | other | unpitched | missed | extra events | latency p50 / p95 ms | octave fixes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| web | 97.1% | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 11 | 66 / 113 | 0 |
| yin | 88.1% | 0 | 0 | 0 | 0 | 0 | 37 | 0 | 11 | 66 / 113 | 0 |
| octave | 92.0% | 0 | 5 | 11 | 0 | 0 | 9 | 0 | 11 | 66 / 113 | 16 |
| yin+octave | 84.6% | 0 | 2 | 9 | 0 | 0 | 37 | 0 | 11 | 66 / 113 | 11 |
| delay30 | 99.7% | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 11 | 76 / 123 | 0 |
| delay30+octave | 98.7% | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 11 | 76 / 123 | 3 |
| median30-150 † | 100.0% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 150 / 150 | 0 |
| median30-150+octave † | 99.7% | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 10 | 150 / 150 | 0 |
| range75-1000 | 97.1% | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 11 | 66 / 113 | 0 |
| flux18 | 96.2% | 0 | 0 | 0 | 0 | 0 | 12 | 0 | 17 | 66 / 113 | 0 |
| flux26 | 98.1% | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 7 | 66 / 113 | 0 |
| pyin-whole † | 95.2% | 2 | 0 | 0 | 0 | 0 | 13 | 0 | 0 | — / — | 0 |
| pyin-whole-fmax1000 † | 95.2% | 2 | 0 | 0 | 0 | 0 | 13 | 0 | 0 | — / — | 0 |

† not exportable to the browser as it is (lab-only parameters, or the pYIN baseline).
Extra events: notes reported after the first in a one-pluck clip (a re-trigger inside the ringing note).

## By microphone

| variant | idmt-dataset1-fender-strat-clean-neck-sc | idmt-dataset1-ibanez-power-strat-clean-bridge-hu | idmt-dataset1-ibanez-power-strat-clean-bridge-neck-sc | idmt-dataset1-ibanez-power-strat-clean-neck-hu |
| --- | --- | --- | --- | --- |
| web | 96.2% | 97.4% | 98.7% | 96.2% |
| yin | 87.2% | 94.9% | 97.4% | 73.1% |
| octave | 92.3% | 96.2% | 98.7% | 80.8% |
| yin+octave | 85.9% | 94.9% | 97.4% | 60.3% |
| delay30 | 98.7% | 100.0% | 100.0% | 100.0% |
| delay30+octave | 97.4% | 100.0% | 100.0% | 97.4% |
| median30-150 | 100.0% | 100.0% | 100.0% | 100.0% |
| median30-150+octave | 98.7% | 100.0% | 100.0% | 100.0% |
| range75-1000 | 96.2% | 97.4% | 98.7% | 96.2% |
| flux18 | 93.6% | 97.4% | 97.4% | 96.2% |
| flux26 | 98.7% | 97.4% | 98.7% | 97.4% |
| pyin-whole | 96.2% | 94.9% | 94.9% | 94.9% |
| pyin-whole-fmax1000 | 96.2% | 94.9% | 94.9% | 94.9% |

## The browser as it runs: `web`

Accuracy by string:

- string 1 (thin E): 100.0%
- string 2 (B): 98.1%
- string 3 (G): 100.0%
- string 4 (D): 100.0%
- string 5 (A): 94.2%
- string 6 (thick E): 90.4%

Most common confusions (expected -> detected: clips):

- A#2 -> nothing: 2
- E2 -> nothing: 2
- C3 -> nothing: 1
- G2 -> nothing: 1
- G#2 -> nothing: 1
- G#4 -> nothing: 1
- F2 -> nothing: 1

Exercise-aware prior (confidence < 0.97): accuracy 97.1%, fired 0 times; would wrongly accept 32.7% of real octave/12th mistakes.

## Best exportable variant: `delay30`

Accuracy by string:

- string 1 (thin E): 100.0%
- string 2 (B): 100.0%
- string 3 (G): 100.0%
- string 4 (D): 100.0%
- string 5 (A): 100.0%
- string 6 (thick E): 98.1%

Most common confusions (expected -> detected: clips):

- G2 -> nothing: 1

Exercise-aware prior (confidence < 0.97): accuracy 99.7%, fired 0 times; would wrongly accept 15.8% of real octave/12th mistakes.
