# Evaluation run 20261102-232009-idmt-isolated-54c9aba

- Dataset: `data/external/idmt-isolated` — 312 clips, microphones: idmt-dataset1-fender-strat-clean-neck-sc, idmt-dataset1-ibanez-power-strat-clean-bridge-hu, idmt-dataset1-ibanez-power-strat-clean-bridge-neck-sc, idmt-dataset1-ibanez-power-strat-clean-neck-hu
- Browser parameters: params.ts + lab export `20261102-210239-idmt-isolated-54c9aba`
- Synthetic: no

## Variants

| variant | accuracy | octave | +19 | fifth | ±1 | other | unpitched | missed | extra events | latency p50 / p95 ms | octave fixes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| web | 99.7% | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 11 | 76 / 123 | 0 |
| yin | 96.8% | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 11 | 76 / 123 | 0 |
| octave | 98.7% | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 11 | 76 / 123 | 3 |
| yin+octave | 96.2% | 0 | 2 | 0 | 0 | 0 | 10 | 0 | 11 | 76 / 123 | 2 |
| delay30 | 99.7% | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 11 | 76 / 123 | 0 |
| delay30+octave | 98.7% | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 11 | 76 / 123 | 3 |
| median30-150 † | 100.0% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 150 / 150 | 0 |
| median30-150+octave † | 99.7% | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 10 | 150 / 150 | 0 |
| range75-1000 | 99.7% | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 11 | 76 / 123 | 0 |
| flux18 | 99.4% | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 17 | 76 / 123 | 0 |
| flux26 | 100.0% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 76 / 123 | 0 |
| pyin-whole † | 95.2% | 2 | 0 | 0 | 0 | 0 | 13 | 0 | 0 | — / — | 0 |
| pyin-whole-fmax1000 † | 95.2% | 2 | 0 | 0 | 0 | 0 | 13 | 0 | 0 | — / — | 0 |

† not exportable to the browser as it is (lab-only parameters, or the pYIN baseline).
Extra events: notes reported after the first in a one-pluck clip (a re-trigger inside the ringing note).

## By microphone

| variant | idmt-dataset1-fender-strat-clean-neck-sc | idmt-dataset1-ibanez-power-strat-clean-bridge-hu | idmt-dataset1-ibanez-power-strat-clean-bridge-neck-sc | idmt-dataset1-ibanez-power-strat-clean-neck-hu |
| --- | --- | --- | --- | --- |
| web | 98.7% | 100.0% | 100.0% | 100.0% |
| yin | 93.6% | 98.7% | 100.0% | 94.9% |
| octave | 97.4% | 100.0% | 100.0% | 97.4% |
| yin+octave | 92.3% | 98.7% | 100.0% | 93.6% |
| delay30 | 98.7% | 100.0% | 100.0% | 100.0% |
| delay30+octave | 97.4% | 100.0% | 100.0% | 97.4% |
| median30-150 | 100.0% | 100.0% | 100.0% | 100.0% |
| median30-150+octave | 98.7% | 100.0% | 100.0% | 100.0% |
| range75-1000 | 98.7% | 100.0% | 100.0% | 100.0% |
| flux18 | 98.7% | 100.0% | 98.7% | 100.0% |
| flux26 | 100.0% | 100.0% | 100.0% | 100.0% |
| pyin-whole | 96.2% | 94.9% | 94.9% | 94.9% |
| pyin-whole-fmax1000 | 96.2% | 94.9% | 94.9% | 94.9% |

## The browser as it runs: `web`

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

## Best exportable variant: `flux26`

Accuracy by string:

- string 1 (thin E): 100.0%
- string 2 (B): 100.0%
- string 3 (G): 100.0%
- string 4 (D): 100.0%
- string 5 (A): 100.0%
- string 6 (thick E): 100.0%

Most common confusions (expected -> detected: clips):

- none

Exercise-aware prior (confidence < 0.97): accuracy 100.0%, fired 0 times; would wrongly accept 13.5% of real octave/12th mistakes.
