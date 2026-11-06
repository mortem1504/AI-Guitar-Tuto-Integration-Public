import numpy as np
import librosa


def detect_pitch(audio, sample_rate, fmax=1400):
    """
    Detect the fundamental frequency of an audio signal.

    fmax defaults to 1400 Hz: a 24-fret guitar reaches E6, about 1319 Hz.
    evaluate.py also runs it with the old 1000 Hz to measure the difference.
    """

    # Detect pitch using pYIN
    pitches, voiced_flag, voiced_prob = librosa.pyin(
        audio,
        fmin=75,
        fmax=fmax,
        sr=sample_rate
    )

    # Keep only confidently voiced frames
    valid_pitches = pitches[
        (~np.isnan(pitches)) &
        (voiced_prob > 0.7)
    ]

    # No valid pitch detected
    if len(valid_pitches) == 0:
        return None

    # Use the median to reduce occasional wrong detections
    frequency = np.median(valid_pitches)

    return frequency



def frequency_to_note(frequency):
    """
    Convert a frequency in Hz to the nearest musical note.

    Parameters:
        frequency: Frequency in Hz

    Returns:
        str: Musical note name
    """

    if frequency is None or frequency <= 0:
        return None

    # Standard guitar note reference
    A4 = 440.0

    # Calculate how many semitones away from A4
    semitones = round(12 * np.log2(frequency / A4))

    # Note names
    note_names = [
        "C", "C#", "D", "D#", "E", "F",
        "F#", "G", "G#", "A", "A#", "B"
    ]

    # Calculate note and octave
    note_index = (semitones + 9) % 12
    octave = 4 + (semitones + 9) // 12

    return f"{note_names[note_index]}{octave}"