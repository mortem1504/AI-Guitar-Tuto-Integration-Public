/**
 * The MediaPipe runtime is copied out of node_modules into public/ so the app
 * serves it from its own origin. Two reasons, both load-bearing: the CSP only
 * allows scripts from this origin, and a class should not need the network
 * once the model is cached.
 *
 * Written in Node rather than as a shell one-liner because `mkdir -p` and `cp`
 * do not exist on Windows, and this repo is developed there.
 */

import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const to = resolve(root, "public/mediapipe");

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
console.log(`copied mediapipe runtime -> ${to}`);
