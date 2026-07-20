import type { FrameGap, TelemetryFrame } from "./types.ts";

/** Normalized lap distance must start near the start/finish line. */
const POS_START_TOLERANCE = 0.05;
/** Lap must reach the end of the timing loop. */
const POS_END_MIN = 0.95;
/** Speed below this (km/h) counts as "stopped" for end-of-lap detection. */
const STOP_SPEED_KMH = 5;
/** Consecutive low-speed frames at the end imply the car stopped on track. */
const STOP_SUSTAINED_FRAMES = 5;

const GAP_THRESHOLD_MS = 500;

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
