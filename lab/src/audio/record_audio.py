import argparse

import sounddevice as sd
import soundfile as sf


# Recording settings
sample_rate = 44100
duration = 5
output_file = "data/audio_test.wav"


def parse_args():
    parser = argparse.ArgumentParser(description="Record a guitar note to a WAV file.")
    parser.add_argument(
        "--device",
        default=None,
        help="Input device index or name. Defaults to the system's default input.",
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List the available audio devices and exit.",
    )
    parser.add_argument("--duration", type=float, default=duration, help="Seconds to record.")
    parser.add_argument("--samplerate", type=int, default=sample_rate, help="Sample rate in Hz.")
    parser.add_argument("--output", default=output_file, help="Where to save the WAV file.")
    return parser.parse_args()


def resolve_device(device):
    """sounddevice takes an int index or a name substring; the CLI gives a string."""
    if device is None:
        return None
    try:
        return int(device)
    except ValueError:
        return device


def main():
    args = parse_args()

    if args.list_devices:
        print(sd.query_devices())
        return

    device = resolve_device(args.device)
    device_info = sd.query_devices(device, kind="input")

    print("Recording from:", device_info["name"])
    print("Play a guitar note while recording.")

    audio = sd.rec(
        int(args.duration * args.samplerate),
        samplerate=args.samplerate,
        channels=1,
        dtype="float32",
        device=device,
    )

    sd.wait()

    # Save the recording
    sf.write(args.output, audio, args.samplerate)

    print("Recording finished.")
    print("Saved to:", args.output)


if __name__ == "__main__":
    main()
