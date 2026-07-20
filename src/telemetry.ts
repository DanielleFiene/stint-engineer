/**
 * Load stint JSON, validate frames, decode tyre temps.
 * Wire encoding matches `encode_frame` in `data/recorder.rs`.
 */

import type {
  RemovedFrame,
  StintTelemetryFile,
  TelemetryFrame,
  TyreTempsCelsius,
} from "./types.ts";

/** Plausible on-track speed ceiling (km/h) for GT/prototype-class cars. */
const MAX_SPEED_KMH = 360;
/** Plausible engine RPM ceiling for the same class. */
const MAX_RPM = 16_000;

/** Matches recorder `scales::TEMPERATURE` — divide wire tyres by this for °C. */
export const TYRE_TEMP_SCALE = 10;

/** Read and parse a stint telemetry JSON file. */
export async function loadTelemetry(path: string): Promise<StintTelemetryFile> {
  const raw = await Bun.file(path).text();
  return JSON.parse(raw) as StintTelemetryFile;
}

/** Decode fixed-point wire tyres to °C (recorder stores tenths of a degree). */
export function correctTyreTemps(frame: TelemetryFrame): TyreTempsCelsius {
  return {
    fl: frame.tyres.fl / TYRE_TEMP_SCALE,
    fr: frame.tyres.fr / TYRE_TEMP_SCALE,
    rl: frame.tyres.rl / TYRE_TEMP_SCALE,
    rr: frame.tyres.rr / TYRE_TEMP_SCALE,
  };
}

function invalidReasons(frame: TelemetryFrame): string[] {
  const reasons: string[] = [];
  if (frame.spd < 0 || frame.spd > MAX_SPEED_KMH) {
    reasons.push(`speed ${frame.spd} km/h outside 0–${MAX_SPEED_KMH}`);
  }
  if (frame.rpm < 0 || frame.rpm > MAX_RPM) {
    reasons.push(`rpm ${frame.rpm} outside 0–${MAX_RPM}`);
  }
  if (frame.gear < -1 || frame.gear > 8) {
    reasons.push(`gear ${frame.gear} outside -1..8`);
  }
  return reasons;
}

/** Drop physically impossible frames; return clean stream and removal log. */
export function filterValidFrames(frames: TelemetryFrame[]): {
  valid: TelemetryFrame[];
  removed: RemovedFrame[];
} {
  const valid: TelemetryFrame[] = [];
  const removed: RemovedFrame[] = [];

  for (const frame of frames) {
    const reasons = invalidReasons(frame);
    if (reasons.length === 0) {
      valid.push(frame);
    } else {
      removed.push({
        lap: frame.lap,
        ts: frame.ts,
        reasons,
        frame,
      });
    }
  }

  return { valid, removed };
}
