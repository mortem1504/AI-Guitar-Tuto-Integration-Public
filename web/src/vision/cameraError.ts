/**
 * Why the camera could not start, as one thing the student can do about it.
 *
 * `getUserMedia` fails in a handful of named ways, and "camera access is
 * needed" fits none of them well: a camera blocked by the operating system,
 * one held by a video call, a page opened on an address the browser will not
 * give a camera to, and a browser panel that never allows one all need
 * different fixes. Pure, so it is checked in `home-check`.
 */

export type CameraProblem = "blocked" | "missing" | "busy" | "insecure" | "model" | "other";

/** Thrown by HandTracker when the camera is fine but the hand model would not load. */
export class ModelLoadError extends Error {
  override name = "ModelLoadError";
}

export function cameraProblem(error: unknown, secureContext: boolean, hasMediaDevices: boolean): CameraProblem {
  if (!secureContext || !hasMediaDevices) return "insecure";
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "blocked";
    case "NotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "AbortError":
    case "TrackStartError":
      return "busy";
    case "ModelLoadError":
      return "model";
    default:
      return "other";
  }
}
