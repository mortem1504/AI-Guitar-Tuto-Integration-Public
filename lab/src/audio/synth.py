"""
Synthesised guitar plucks, for testing the lab's own tools.

The same model as the web app's `scripts/lib/synth.mjs`: harmonics in phase
with signed amplitudes sin(k*pi*p) (a string released from a triangle), each
decaying faster the higher it is, slightly sharp (inharmonicity), with a burst
of pick noise. `odd_gain` < 1 weakens the odd partials, which makes the
waveform nearly repeat at half its period: the "octave trap".

This exists so that `evaluate.py`, `audio-check` and the tests can be run end
to end without a guitar. Numbers measured on it say the tools work; they say
nothing about how a real guitar is heard. Never export parameters from it.
"""

import numpy as np

ROOMS = ("clean", "noisy", "laptop")


def pluck(length, hz, sample_rate, rng, level, odd_gain=1.0):
    t = np.arange(length) / sample_rate
    out = np.zeros(length)
    position = 0.1 + rng.random() * 0.2
    inharmonicity = 0.00005 + rng.random() * 0.0001
    attack = np.minimum(1, t / 0.002)
    for k in range(1, 41):
        partial = k * hz * np.sqrt(1 + inharmonicity * k * k)
        if partial > sample_rate * 0.45:
            break
        gain = odd_gain if k % 2 == 1 else 1.0
        amplitude = gain * np.sin(k * np.pi * position) * level / k**1.1
        decay = 1.6 / (1 + 0.35 * k)
        out += amplitude * attack * np.exp(-t / decay) * np.sin(2 * np.pi * partial * t)
    noise_length = int(0.006 * sample_rate)
    out[:noise_length] += rng.standard_normal(noise_length) * level * 0.3 * np.exp(
        -np.arange(noise_length) / (0.0015 * sample_rate)
    )
    return out


def high_pass(samples, cutoff, sample_rate):
    """First-order: a laptop microphone barely hears below ~200 Hz."""
    rc = 1 / (2 * np.pi * cutoff)
    alpha = rc / (rc + 1 / sample_rate)
    out = np.empty_like(samples)
    previous_in = previous_out = 0.0
    for i, value in enumerate(samples):
        previous_out = alpha * (previous_out + value - previous_in)
        previous_in = value
        out[i] = previous_out
    return out


def note_clip(midi, sample_rate=48000, room="clean", seed=0, seconds=1.5, onset=0.3, odd_gain=1.0):
    """One pluck at `onset` seconds in a clip of `seconds`, in one of ROOMS."""
    rng = np.random.default_rng(seed)
    hz = 440.0 * 2 ** ((midi - 69) / 12)
    total = int(seconds * sample_rate)
    start = int(onset * sample_rate)
    samples = np.zeros(total)
    level = 0.15 + rng.random() * 0.15
    samples[start:] = pluck(total - start, hz, sample_rate, rng, level, odd_gain)
    note_rms = np.sqrt(np.mean(samples[start : start + int(0.1 * sample_rate)] ** 2))
    if room == "laptop":
        samples = high_pass(samples, 250, sample_rate)
    snr_db = {"clean": 50, "noisy": 20, "laptop": 25}[room]
    samples += rng.standard_normal(total) * note_rms * 10 ** (-snr_db / 20)
    return samples
