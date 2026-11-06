import librosa
import numpy as np

from src.audio.pitch_detector import detect_pitch, frequency_to_note


# Load the recorded audio
audio_file = "data/audio_test.wav"

audio, sample_rate = librosa.load(
    audio_file,
    sr=None,
    mono=True
)

print("Audio loaded successfully.")
print("Sample rate:", sample_rate, "Hz")
print("Audio duration:", len(audio) / sample_rate, "seconds")


# Detect the pitch
print("Maximum audio level:", np.max(np.abs(audio)))
print("Average audio level:", np.mean(np.abs(audio)))
detected_frequency = detect_pitch(audio, sample_rate)

# Convert frequency to musical note
detected_note = frequency_to_note(detected_frequency)


print()
print("Detected frequency:", detected_frequency, "Hz")
print("Detected note:", detected_note)