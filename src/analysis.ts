import { correctTyreTemps } from "./telemetry.ts";
import type {
  LapAnalysis,
  SectorComparison,
  SectorMetrics,
  TelemetryFrame,
  TyreTempsCelsius,
  TyreTrendResult,
} from "./types.ts";

/**
 * Typical inter-frame spacing in this stint is ~70–100ms. When frames are
 * dropped, the raw timestamp delta can be seconds long; using it as-is in a
 * time-weighted average would treat the car as holding the pre-gap sample for
 * the entire missing interval. We cap each interval's weight so unknown time
 * is not attributed to throttle/brake/speed readings on either side of a gap.
 */
const MAX_INTERVAL_WEIGHT_MS = 200;

function intervalWeightMs(prev: TelemetryFrame, curr: TelemetryFrame): number {
  const delta = curr.ts - prev.ts;
  return Math.min(delta, MAX_INTERVAL_WEIGHT_MS);
}

/**
 * Lap duration for frames already scoped to one `lap` value (see splitLaps).
 * Elapsed time is last.ts − first.ts among those frames only; the first frame
 * of the following lap belongs to another group and is never included. Each
 * inter-frame delta inside the lap—including a large gap where samples were
 * lost—is counted in full, because wall-clock lap time still advanced.
 */
function lapTimeMs(sorted: TelemetryFrame[]): number {
  if (sorted.length < 2) {
    return 0;
  }
  return sorted[sorted.length - 1]!.ts - sorted[0]!.ts;
}

/** Time-weighted mean using the sample at the start of each capped interval. */
function timeWeightedMean(
  sorted: TelemetryFrame[],
  read: (frame: TelemetryFrame) => number,
): number {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return read(sorted[0]!);
  }

  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 1; i < sorted.length; i++) {
    const weight = intervalWeightMs(sorted[i - 1]!, sorted[i]!);
    weightedSum += read(sorted[i - 1]!) * weight;
    totalWeight += weight;
  }

  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

function framesInPosRange(
  frames: TelemetryFrame[],
  posStart: number,
  posEnd: number,
): TelemetryFrame[] {
  return frames.filter((f) => {
    if (posEnd >= 1) {
      return f.pos >= posStart && f.pos <= posEnd;
    }
    return f.pos >= posStart && f.pos < posEnd;
  });
}

function sectorTimeMs(sectorFrames: TelemetryFrame[]): number {
  if (sectorFrames.length < 2) {
    return 0;
  }
  const sorted = [...sectorFrames].sort((a, b) => a.ts - b.ts);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    total += sorted[i]!.ts - sorted[i - 1]!.ts;
  }
  return total;
}

export function computeSectors(
  lapFrames: TelemetryFrame[],
  sectorCount = 3,
): SectorMetrics[] {
  const sorted = [...lapFrames].sort((a, b) => a.ts - b.ts);
  const sectorWidth = 1 / sectorCount;
  const sectors: SectorMetrics[] = [];

  for (let i = 0; i < sectorCount; i++) {
    const posStart = i * sectorWidth;
    const posEnd = i === sectorCount - 1 ? 1 : (i + 1) * sectorWidth;
    const sectorFrames = framesInPosRange(sorted, posStart, posEnd);
    const averageSpeedKmh =
      sectorFrames.length === 0
        ? 0
        : sectorFrames.reduce((sum, f) => sum + f.spd, 0) / sectorFrames.length;

    sectors.push({
      sector: i + 1,
      posStart,
      posEnd,
      averageSpeedKmh,
      sectorTimeMs: sectorTimeMs(sectorFrames),
    });
  }

  return sectors;
}

export function compareLapSectors(
  lap1Sectors: SectorMetrics[],
  lap2Sectors: SectorMetrics[],
): SectorComparison[] {
  const count = Math.min(lap1Sectors.length, lap2Sectors.length);
  const comparisons: SectorComparison[] = [];

  for (let i = 0; i < count; i++) {
    const s1 = lap1Sectors[i]!;
    const s2 = lap2Sectors[i]!;
    const deltaTimeMs = s2.sectorTimeMs - s1.sectorTimeMs;
    let faster: SectorComparison["faster"] = "tie";
    if (Math.abs(deltaTimeMs) > 0.5) {
      faster = deltaTimeMs < 0 ? "lap2" : "lap1";
    }
    comparisons.push({
      sector: s1.sector,
      deltaTimeMs,
      faster,
    });
  }

  return comparisons;
}

function averageTyreTemps(frames: TelemetryFrame[]): TyreTempsCelsius {
  if (frames.length === 0) {
    return { fl: 0, fr: 0, rl: 0, rr: 0 };
  }
  const sum = { fl: 0, fr: 0, rl: 0, rr: 0 };
  for (const frame of frames) {
    const t = correctTyreTemps(frame);
    sum.fl += t.fl;
    sum.fr += t.fr;
    sum.rl += t.rl;
    sum.rr += t.rr;
  }
  const n = frames.length;
  return {
    fl: sum.fl / n,
    fr: sum.fr / n,
    rl: sum.rl / n,
    rr: sum.rr / n,
  };
}

function linearRegression(
  points: Array<{ x: number; y: number }>,
): { slope: number; intercept: number } {
  if (points.length === 0) {
    return { slope: 0, intercept: 0 };
  }
  if (points.length === 1) {
    return { slope: 0, intercept: points[0]!.y };
  }
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) {
    return { slope: 0, intercept: sumY / n };
  }
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function tyreTempTrend(allValidFrames: TelemetryFrame[]): TyreTrendResult {
  const byLap = new Map<number, TelemetryFrame[]>();
  for (const frame of allValidFrames) {
    const list = byLap.get(frame.lap) ?? [];
    list.push(frame);
    byLap.set(frame.lap, list);
  }

  const lapAverages: TyreTrendResult["lapAverages"] = [];
  for (const [lap, frames] of [...byLap.entries()].sort((a, b) => a[0] - b[0])) {
    lapAverages.push({ lap, temps: averageTyreTemps(frames) });
  }

  const corners: (keyof TyreTempsCelsius)[] = ["fl", "fr", "rl", "rr"];
  const perTyre = {} as TyreTrendResult["perTyre"];
  const stintMeans: Record<keyof TyreTempsCelsius, number> = {
    fl: 0,
    fr: 0,
    rl: 0,
    rr: 0,
  };

  for (const corner of corners) {
    const points = lapAverages.map(({ lap, temps }) => ({
      x: lap,
      y: temps[corner],
    }));
    const { slope, intercept } = linearRegression(points);
    perTyre[corner] = { slopeCelsiusPerLap: slope, interceptCelsius: intercept };
    stintMeans[corner] =
      points.reduce((s, p) => s + p.y, 0) / Math.max(points.length, 1);
  }

  let hottest: keyof TyreTempsCelsius = "fl";
  let maxMean = stintMeans.fl;
  for (const corner of corners) {
    if (stintMeans[corner] > maxMean) {
      maxMean = stintMeans[corner];
      hottest = corner;
    }
  }

  return { perTyre, hottest, lapAverages };
}

export function analyzeLap(lapFrames: TelemetryFrame[]): LapAnalysis {
  const sorted = [...lapFrames].sort((a, b) => a.ts - b.ts);
  const lap = sorted[0]!.lap;
  const topSpeedKmh = Math.max(...sorted.map((f) => f.spd));
  const averageSpeedKmh = timeWeightedMean(sorted, (f) => f.spd);
  const averageThrottlePct = timeWeightedMean(sorted, (f) => f.thr) * 100;
  const averageBrakePct = timeWeightedMean(sorted, (f) => f.brk) * 100;

  return {
    lap,
    lapTimeMs: lapTimeMs(sorted),
    topSpeedKmh,
    averageSpeedKmh,
    averageThrottlePct,
    averageBrakePct,
    averageTyreTempsC: averageTyreTemps(sorted),
    sectors: computeSectors(sorted),
  };
}
