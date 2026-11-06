/**
 * The microphone, opened for playing rather than for talking.
 *
 * Echo cancellation, noise suppression and automatic gain all exist to make
 * speech intelligible, and all three ruin a guitar: noise suppression hears a
 * sustained note as exactly the steady signal it was built to remove, gain
 * control pumps the level the onset detector relies on, and echo cancellation
 * eats the attack. They are switched off, not left to the browser's defaults,
 * which have them on.
 *
 * The student picks the input: a guitar through an audio interface and the
 * laptop's own microphone are very different signals, and the browser's
 * default is often the wrong one. The choice is remembered, and treated like
 * every other stored value here: as hostile input.
 */

const STORAGE_KEY = "guitar.audioInput.v1";

export interface AudioInput {
  deviceId: string;
  /** Empty until the student has granted the microphone once: browser privacy. */
  label: string;
}

export function audioConstraints(deviceId: string | null): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    // `exact` would fail outright if the remembered device was unplugged;
    // `ideal` falls back to the default input instead.
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
  };
}

export async function openMicrophone(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId), video: false });
}

/** The audio inputs the browser will name. Call after the microphone is open for real labels. */
export async function listInputs(): Promise<AudioInput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput" && device.deviceId !== "")
    .map((device) => ({ deviceId: device.deviceId, label: device.label }));
}

/** Which input a running stream actually got, which may not be the one asked for. */
export function inputOf(stream: MediaStream): string | null {
  const settings = stream.getAudioTracks()[0]?.getSettings();
  return settings?.deviceId ?? null;
}

export function loadInputChoice(): string | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  // Device ids are opaque strings, but always short and printable. Anything
  // else is not one.
  if (!raw || raw.length > 256 || !/^[\x21-\x7e]+$/.test(raw)) return null;
  return raw;
}

export function saveInputChoice(deviceId: string | null) {
  try {
    if (deviceId) localStorage.setItem(STORAGE_KEY, deviceId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing: the choice lasts the session, which is fine.
  }
}
