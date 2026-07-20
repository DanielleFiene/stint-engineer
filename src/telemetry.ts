import type {
  RemovedFrame,
  StintTelemetryFile,
  TelemetryFrame,
  TyreTempsCelsius,
} from "./types.ts";

/** Upper bound for plausible on-track speed (km/h); above this is treated as corrupt. */
const MAX_SPEED_KMH = 360;
/** Upper bound for plausible engine RPM in this series. */
const MAX_RPM = 16_000;

export const TYRE_TEMP_SCALE = 10;

export async function loadTelemetry(path: string): Promise<StintTelemetryFile> {
  const raw = await Bun.file(path).text();
  return JSON.parse(raw) as StintTelemetryFile;
}

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
