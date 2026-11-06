# Evaluation run 20261102-192956-synthetic-f589a8d

- Dataset: `data/synthetic` — 468 clips, microphones: synthetic-clean, synthetic-noisy, synthetic-trap
- Browser parameters: params.ts (no lab export yet)
- Synthetic: **yes — these numbers test the tools, not the detector on a guitar**

## Variants

| variant | accuracy | octave | +19 | fifth | ±1 | other | unpitched | missed | extra events | latency p50 / p95 ms | octave fixes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| web | 66.9% | 155 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 63 / 105 | 0 |
| yin | 66.7% | 156 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 63 / 105 | 0 |
| octave | 100.0% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 63 / 105 | 155 |
| yin+octave | 100.0% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 63 / 105 | 156 |
| delay30 | 66.9% | 155 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 73 / 115 | 0 |
| delay30+octave | 100.0% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 73 / 115 | 155 |
| median30-150 † | 66.9% | 155 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 150 / 150 | 0 |
| median30-150+octave † | 99.4% | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 150 / 150 | 0 |
| range75-1000 | 69.7% | 142 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 63 / 105 | 0 |
| flux18 | 66.9% | 155 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 63 / 105 | 0 |
| flux26 | 66.9% | 155 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 63 / 105 | 0 |

† not exportable to the browser as it is (lab-only parameters, or the pYIN baseline).
Extra events: notes reported after the first in a one-pluck clip (a re-trigger inside the ringing note).

## By microphone

| variant | synthetic-clean | synthetic-noisy | synthetic-trap |
| --- | --- | --- | --- |
| web | 100.0% | 100.0% | 0.6% |
| yin | 100.0% | 100.0% | 0.0% |
| octave | 100.0% | 100.0% | 100.0% |
| yin+octave | 100.0% | 100.0% | 100.0% |
| delay30 | 100.0% | 100.0% | 0.6% |
| delay30+octave | 100.0% | 100.0% | 100.0% |
| median30-150 | 100.0% | 100.0% | 0.6% |
| median30-150+octave | 100.0% | 100.0% | 98.1% |
| range75-1000 | 100.0% | 100.0% | 9.0% |
| flux18 | 100.0% | 100.0% | 0.6% |
| flux26 | 100.0% | 100.0% | 0.6% |

## The browser as it runs: `web`

Accuracy by string:

- string 1 (thin E): 67.9%
- string 2 (B): 66.7%
- string 3 (G): 66.7%
- string 4 (D): 66.7%
- string 5 (A): 66.7%
- string 6 (thick E): 66.7%

Most common confusions (expected -> detected: clips):

- E4 -> E5: 6
- F4 -> F5: 6
- F#4 -> F#5: 6
- G4 -> G5: 6
- B3 -> B4: 6
- C4 -> C5: 6
- C#4 -> C#5: 6
- D4 -> D5: 6
- G3 -> G4: 6
- G#3 -> G#4: 6
- A3 -> A4: 6
- D3 -> D4: 6

Exercise-aware prior (confidence < 0.97): accuracy 100.0%, fired 155 times; would wrongly accept 7.0% of real octave/12th mistakes.

## Best exportable variant: `octave`

Accuracy by string:

- string 1 (thin E): 100.0%
- string 2 (B): 100.0%
- string 3 (G): 100.0%
- string 4 (D): 100.0%
- string 5 (A): 100.0%
- string 6 (thick E): 100.0%

Most common confusions (expected -> detected: clips):

- none

Exercise-aware prior (confidence < 0.97): accuracy 100.0%, fired 0 times; would wrongly accept 37.8% of real octave/12th mistakes.
