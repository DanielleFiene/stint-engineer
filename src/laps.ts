/**
 * Group frames by lap, decide completeness, detect timestamp gaps.
 */

import type { FrameGap, TelemetryFrame } from "./types.ts";

const POS_START_TOLERANCE = 0.05; // lap must begin near pos 0
const POS_END_MIN = 0.95; // lap must reach the timing loop end
const STOP_SPEED_KMH = 5; // below this counts as stopped
const STOP_SUSTAINED_FRAMES = 5; // consecutive tail frames for stop detection
const GAP_THRESHOLD_MS = 500; // normal spacing ~70–100 ms

/** Partition frames by `lap`, each group sorted by `ts`. */
export function splitLaps(frames: TelemetryFrame[]): Map<number, TelemetryFrame[]> {
  const byLap = new Map<number, TelemetryFrame[]>();
  for (const frame of frames) {
    const list = byLap.get(frame.lap);
    if (list) {
      list.push(frame);
    } else {
      byLap.set(frame.lap, [frame]);
    }
  }
  for (const list of byLap.values()) {
    list.sort((a, b) => a.ts - b.ts);
  }
  return byLap;
}

/** True when the car stops on track before `pos` reaches the finish straight. */
function endsStoppedBeforeFinish(frames: TelemetryFrame[]): boolean {
  if (frames.length < STOP_SUSTAINED_FRAMES) {
    return false;
  }
  const maxPos = Math.max(...frames.map((f) => f.pos));
  if (maxPos >= POS_END_MIN) {
    return false;
  }
  const tail = frames.slice(-STOP_SUSTAINED_FRAMES);
  return tail.every((f) => f.spd < STOP_SPEED_KMH);
}

/** Full lap from ~pos 0 to ~1 without a sustained stop before the line. */
export function isCompleteLap(lapFrames: TelemetryFrame[]): boolean {
  if (lapFrames.length === 0) {
    return false;
  }
  const minPos = Math.min(...lapFrames.map((f) => f.pos));
  const maxPos = Math.max(...lapFrames.map((f) => f.pos));

  if (minPos > POS_START_TOLERANCE) {
    return false;
  }
  if (endsStoppedBeforeFinish(lapFrames)) {
    return false;
  }
  if (maxPos < POS_END_MIN) {
    return false;
  }
  return true;
}

/** Human-readable reason when `isCompleteLap` is false. */
export function exclusionReason(lapFrames: TelemetryFrame[]): string | null {
  if (lapFrames.length === 0) {
    return "no frames recorded for this lap";
  }
  const minPos = Math.min(...lapFrames.map((f) => f.pos));
  const maxPos = Math.max(...lapFrames.map((f) => f.pos));
  const lap = lapFrames[0]!.lap;

  if (minPos > POS_START_TOLERANCE) {
    return `lap ${lap} excluded: starts at pos ${minPos.toFixed(4)}, not a full lap`;
  }
  if (endsStoppedBeforeFinish(lapFrames)) {
    return `lap ${lap} excluded: car comes to a stop before completing the lap`;
  }
  if (maxPos < POS_END_MIN) {
    return `lap ${lap} excluded: only reaches pos ${maxPos.toFixed(4)}, not a full lap`;
  }
  return null;
}

/** Inter-frame deltas above threshold — missing samples, not bad sensor values. */
export function detectGaps(lapFrames: TelemetryFrame[]): FrameGap[] {
  if (lapFrames.length < 2) {
    return [];
  }
  const lap = lapFrames[0]!.lap;
  const gaps: FrameGap[] = [];
  for (let i = 1; i < lapFrames.length; i++) {
    const prev = lapFrames[i - 1]!;
    const curr = lapFrames[i]!;
    const delta = curr.ts - prev.ts;
    if (delta > GAP_THRESHOLD_MS) {
      gaps.push({
        lap,
        startTs: prev.ts,
        endTs: curr.ts,
        durationMs: delta,
      });
    }
  }
  return gaps;
}
