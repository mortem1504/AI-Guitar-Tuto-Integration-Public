"""
The browser's note detector, re-implemented in numpy.

A mirror of `web/src/audio/dsp/` (detector.ts, onset.ts, pitch.ts,
octave.ts), written independently from the same description and run with the
same parameters (read from params.ts by `web_params.py`). Two implementations
that agree on the same recordings are evidence that both do what they say:
`npm run audio-check` compares them clip by clip, and they must stay within 2%.

It also carries the variants the lab measures that the browser does not (yet)
run. Each is a parameter whose name starts with `lab_`, so it can never be
exported to the browser by accident:

    lab_median_from_ms / lab_median_to_ms
        read pitch from several windows between these times after the onset
        and take the median note, instead of one window at pitchDelayMs.

Everything here is offline: whole clips in, events out.
"""

import math
from dataclasses import dataclass

import numpy as np


@dataclass
class Note:
    onset_time: float
    detect_time: float
    hz: float
    midi: int
    cents: float
    confidence: float
    rms: float
    window: int
    raw_hz: float = None


@dataclass
class Unpitched:
    onset_time: float
    detect_time: float
    rms: float


def midi_of(hz):
    # floor(x + 0.5), as JavaScript's Math.round: Python's round() goes to even.
    return int(math.floor(69 + 12 * math.log2(hz / 440.0) + 0.5))


def hz_of(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def scaled_samples(samples_at_48k, sample_rate):
    """Window sizes are written for 48 kHz and kept to powers of two."""
    return int(2 ** round(math.log2(samples_at_48k * sample_rate / 48000)))


def _next_pow2(n):
    return 1 << max(1, math.ceil(math.log2(max(2, n))))


def _parabolic(curve, tau):
    before, here, after = curve[tau - 1], curve[tau], curve[tau + 1]
    curvature = before - 2 * here + after
    if curvature == 0:
        return float(tau)
    shift = 0.5 * (before - after) / curvature
    return tau + shift if abs(shift) < 1 else float(tau)


def _correlate(a, b, max_lag):
    """sum_i a[i] * b[i + tau] for tau in 0..max_lag, through the FFT."""
    size = _next_pow2(len(a) + len(b))
    spectrum = np.conj(np.fft.rfft(a, size)) * np.fft.rfft(b, size)
    return np.fft.irfft(spectrum, size)[: max_lag + 1]


def _lag_range(params, sample_rate, length, max_fraction):
    min_tau = max(2, math.floor(sample_rate / params["maxHz"]))
    max_tau = min(math.floor(length * max_fraction), math.ceil(sample_rate / params["minHz"]))
    return min_tau, max_tau


def _in_range(params, sample_rate, tau):
    if not tau > 0:
        return None
    hz = sample_rate / tau
    return hz if params["minHz"] <= hz <= params["maxHz"] else None


def mpm(window, sample_rate, params):
    """McLeod: first NSDF peak within mpmPeakRatio of the best. Returns (hz, clarity) or None."""
    length = len(window)
    if length < 256:
        return None
    x = window.astype(np.float64) - window.mean()
    prefix = np.concatenate(([0.0], np.cumsum(x * x)))
    if prefix[-1] <= 0:
        return None
    min_tau, max_tau = _lag_range(params, sample_rate, length, 0.5)
    if max_tau <= min_tau + 2:
        return None

    corr = _correlate(x, x, max_tau + 1)
    taus = np.arange(min_tau - 1, max_tau + 2)
    norm = prefix[length - taus] + prefix[length] - prefix[taus]
    curve = np.zeros(max_tau + 2 + 1)
    curve[taus] = np.where(norm > 0, 2 * corr[taus] / np.where(norm > 0, norm, 1), 0)

    start = min_tau
    while start < max_tau and curve[start] > curve[start + 1]:
        start += 1
    peaks = [t for t in range(start, max_tau) if curve[t] > 0 and curve[t] >= curve[t - 1] and curve[t] > curve[t + 1]]
    if not peaks:
        return None
    best = max(curve[t] for t in peaks)
    if best < params["mpmMinClarity"]:
        return None
    for t in peaks:
        if curve[t] >= best * params["mpmPeakRatio"]:
            hz = _in_range(params, sample_rate, _parabolic(curve, t))
            return (hz, float(curve[t])) if hz else None
    return None


def yin(window, sample_rate, params):
    """YIN: first CMNDF dip below yinThreshold. Returns (hz, 1 - dip) or None."""
    length = len(window)
    if length < 256:
        return None
    x = window.astype(np.float64) - window.mean()
    prefix = np.concatenate(([0.0], np.cumsum(x * x)))
    if prefix[-1] <= 0:
        return None
    min_tau, max_tau = _lag_range(params, sample_rate, length, 1 / 3)
    if max_tau <= min_tau + 2:
        return None
    span = length - max_tau - 1

    corr = _correlate(x[:span], x, max_tau + 1)
    taus = np.arange(1, max_tau + 2)
    diff = np.maximum(0, prefix[span] + prefix[taus + span] - prefix[taus] - 2 * corr[taus])
    running = np.cumsum(diff)
    curve = np.ones(max_tau + 2)
    curve[taus] = np.where(running > 0, diff * taus / np.where(running > 0, running, 1), 1)

    for tau in range(min_tau, max_tau + 1):
        if curve[tau] < params["yinThreshold"]:
            while tau + 1 <= max_tau and curve[tau + 1] < curve[tau]:
                tau += 1
            hz = _in_range(params, sample_rate, _parabolic(curve, tau))
            return (hz, float(1 - curve[tau])) if hz else None
    return None


# --- The octave check (octave.ts) -------------------------------------------

PARTIAL_TOLERANCE = 0.03
MAX_PARTIAL_HZ = 5000
PARTIALS = 6
TIE = 0.9
CANDIDATES = (1 / 2, 1 / 3, 2 / 3)


def octave_check(window, sample_rate, hz, params):
    """The lower fundamental the spectrum supports instead of `hz`, or `hz`."""
    length = len(window)
    size = _next_pow2(scaled_samples(params["longWindow"], sample_rate) * 4)
    hann = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(length) / length)
    magnitude = np.abs(np.fft.fft((window - window.mean()) * hann, size))[: size // 2]
    bin_hz = sample_rate / size
    lobe_hz = 2 * sample_rate / length  # a Hann window's main lobe: two unpadded bins either side

    def search_hz(frequency):
        return max(2 * bin_hz, frequency * PARTIAL_TOLERANCE)

    def peak_near(frequency):
        width = search_hz(frequency) / bin_hz
        centre = frequency / bin_hz
        lo = max(1, math.floor(centre - width))
        hi = min(len(magnitude) - 1, math.ceil(centre + width))
        return float(magnitude[lo : hi + 1].max()) if hi >= lo else 0.0

    def support(base, exclude=None):
        total, used, k = 0.0, 0, 1
        while used < PARTIALS:
            frequency = k * base
            k += 1
            if frequency > min(MAX_PARTIAL_HZ, sample_rate / 2 - base):
                break
            if exclude is not None:
                nearest = max(1, math.floor(frequency / exclude + 0.5))  # JavaScript's Math.round
                if abs(frequency - nearest * exclude) < lobe_hz + search_hz(frequency):
                    continue  # inside a partial of `exclude`, or its leakage
            total += peak_near(frequency)
            used += 1
        return total / used if used else 0.0

    own = support(hz)
    if own <= 0:
        return hz
    scores = []
    for fraction in CANDIDATES:
        candidate = hz * fraction
        scores.append((candidate, 0.0 if candidate < params["minHz"] else support(candidate, hz) / own))
    top = max(score for _, score in scores)
    if top < params["octaveCheckRatio"]:
        return hz
    best = hz
    for candidate, score in scores:
        if score >= top * TIE and candidate < best:
            best = candidate
    return best


# --- Onsets (onset.ts) -------------------------------------------------------


class _Onsets:
    def __init__(self, params, sample_rate):
        self.p = params
        size = params["frameSize"]
        self.hann = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(size) / size)
        self.flux_bins = min(size // 2, math.ceil(params["fluxMaxHz"] / (sample_rate / size)))
        self.past = [np.zeros(size // 2) for _ in range(params["fluxLag"] + 1)]
        self.newest = 0
        self.frames_seen = 0
        self.history = []
        self.refractory = round(params["refractoryMs"] / 1000 * sample_rate)
        self.since_onset = math.inf
        self.armed = True
        self.last_flux = 0.0

    def step(self, frame, loud_enough):
        magnitude = np.abs(np.fft.fft(frame * self.hann))[: len(frame) // 2]
        slots = len(self.past)
        self.newest = (self.newest + 1) % slots
        now = np.log1p(100 * magnitude)
        self.past[self.newest] = now
        before = self.past[(self.newest + 1) % slots]

        reach = self.p["fluxMaxFilter"]
        padded = np.pad(before, reach, mode="edge")
        reference = np.max([padded[i : i + len(before)] for i in range(2 * reach + 1)], axis=0)
        flux = float(np.maximum(0, now[1 : self.flux_bins] - reference[1 : self.flux_bins]).sum())
        self.frames_seen += 1

        mean = sum(self.history) / len(self.history) if self.history else 0.0
        self.history.append(flux)
        if len(self.history) > self.p["fluxHistory"]:
            self.history.pop(0)
        self.since_onset += self.p["hopSize"]

        if self.frames_seen <= self.p["fluxLag"]:
            self.last_flux = 0.0
            return False
        self.last_flux = flux

        above = flux > self.p["fluxMin"] and flux > mean * self.p["fluxRatio"]
        if not above:
            self.armed = True
            return False
        if not self.armed or not loud_enough or self.since_onset < self.refractory:
            return False
        self.armed = False
        self.since_onset = 0
        return True


# --- The detector (detector.ts) ---------------------------------------------

ONSET_KEYS = (
    "frameSize", "hopSize", "fluxMaxHz", "fluxLag", "fluxMaxFilter", "fluxHistory", "fluxRatio",
    "fluxMin", "refractoryMs", "minRms", "gateAboveFloor", "floorRiseDbPerSecond",
)


def onset_key(params):
    """Onsets depend on these parameters only, so they can be cached across pitch variants."""
    return tuple(params[k] for k in ONSET_KEYS)


def find_onsets(samples, sample_rate, params):
    """Stage 1: every onset, as (sample index, hop end at which it was detected)."""
    p = params
    x = np.asarray(samples, dtype=np.float64)
    hop = p["hopSize"]
    rise = 10 ** (p["floorRiseDbPerSecond"] / 20 / (sample_rate / hop))
    onsets = _Onsets(p, sample_rate)
    found = []
    floor = 0.0
    for end in range(hop, len(x) + 1, hop):
        hop_samples = x[end - hop : end]
        rms = float(np.sqrt(np.mean(hop_samples * hop_samples)))
        loud = rms > max(p["minRms"], floor * p["gateAboveFloor"])
        floor = max(rms, 1e-6) if floor == 0 or rms < floor else floor * rise
        if end >= p["frameSize"] and onsets.step(x[end - p["frameSize"] : end], loud):
            found.append((end - hop, end))
    return found


def _hop_end_at_or_after(sample, hop):
    return -(-sample // hop) * hop


def resolve(samples, sample_rate, params, onsets):
    """
    Stage 2: pitch for each onset, with the browser's timing rules.

    The browser checks a waiting onset once per hop, after looking for a new
    onset in that hop; a new onset replaces the waiting one. So an onset is
    dropped when the next one is detected at or before the hop in which its
    window would have been complete.
    """
    p = params
    x = np.asarray(samples, dtype=np.float64)
    hop = p["hopSize"]
    total_end = (len(x) // hop) * hop
    delay = round(p["pitchDelayMs"] / 1000 * sample_rate)
    short_window = scaled_samples(p["window"], sample_rate)
    long_window = scaled_samples(p["longWindow"], sample_rate)
    pitch = yin if p["method"] == "yin" else mpm
    median_from = p.get("lab_median_from_ms")
    median_to = p.get("lab_median_to_ms")

    def read(start, length):
        window = x[start : start + length]
        estimate = pitch(window, sample_rate, p)
        hz = estimate[0] if estimate else None
        if hz is not None and p["octaveCheck"]:
            hz = octave_check(window, sample_rate, hz, p)
        return window, estimate, hz

    events = []
    for index, (onset, _) in enumerate(onsets):
        next_detected = onsets[index + 1][1] if index + 1 < len(onsets) else None
        onset_time = onset / sample_rate

        def replaced(ready_at):
            due = _hop_end_at_or_after(ready_at, hop)
            return due > total_end or (next_detected is not None and next_detected <= due)

        if median_from is not None:
            end = onset + round(median_to / 1000 * sample_rate)
            if replaced(end):
                continue
            events.append(_median_event(x, sample_rate, p, onset, end, median_from, short_window, read))
            continue

        start = onset + delay
        length = short_window
        if replaced(start + length):
            continue
        window, estimate, hz = read(start, length)
        if hz is not None and hz < p["extendBelowHz"] and long_window > length:
            length = long_window
            if replaced(start + length):
                continue
            window, estimate, hz = read(start, length)

        rms = float(np.sqrt(np.mean(window * window)))
        detect_time = (start + length) / sample_rate
        if hz is None:
            events.append(Unpitched(onset_time, detect_time, rms))
        else:
            midi = midi_of(hz)
            events.append(Note(onset_time, detect_time, hz, midi, 1200 * math.log2(hz / hz_of(midi)),
                               estimate[1], rms, length, estimate[0] if hz != estimate[0] else None))
    return events


def _median_event(x, sample_rate, p, onset, end, median_from, window_length, read):
    """Lab variant: the median note over windows every 10 ms from median_from to end."""
    first = onset + round(median_from / 1000 * sample_rate)
    readings = []
    for start in range(first, end - window_length + 1, round(0.010 * sample_rate)):
        _, estimate, hz = read(start, window_length)
        if hz is not None:
            readings.append((midi_of(hz), hz, estimate[1]))
    onset_time = onset / sample_rate
    rms = float(np.sqrt(np.mean(x[first:end] ** 2))) if end > first else 0.0
    if not readings:
        return Unpitched(onset_time, end / sample_rate, rms)
    midis = sorted(r[0] for r in readings)
    midi = midis[len(midis) // 2]
    hz = float(np.median([r[1] for r in readings if r[0] == midi]))
    confidence = float(np.median([r[2] for r in readings if r[0] == midi]))
    return Note(onset_time, end / sample_rate, hz, midi, 1200 * math.log2(hz / hz_of(midi)),
                confidence, rms, window_length)


def detect(samples, sample_rate, params):
    """Every event the browser's detector would report for this clip, in order."""
    return resolve(samples, sample_rate, params, find_onsets(samples, sample_rate, params))


def first_event(samples, sample_rate, params):
    events = detect(samples, sample_rate, params)
    return events[0] if events else None
