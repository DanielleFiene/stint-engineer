/**
 * Shared TypeScript shapes for stint JSON and analysis output.
 * Field names match the wire frame in `data/recorder.rs`.
 */

/** Four tyre corners on the wire — fixed-point tenths of °C (see recorder `TEMPERATURE` scale). */
export interface WireTyres {
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

/** One frame as stored in the stint stream. */
export interface TelemetryFrame {
  ts: number; // ms since recording started
  lap: number;
  pos: number; // normalized lap position, 0.0..1.0
  spd: number; // km/h
  thr: number; // 0.0..1.0
  brk: number; // 0.0..1.0
  str: number; // steering angle, degrees (negative = left)
  gear: number; // -1 reverse, 0 neutral, 1..8 forward
  rpm: number;
  tyres: WireTyres;
}

/** Tyre core temperatures in °C after `/10` decode. */
export interface TyreTempsCelsius {
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

export interface StintRecorderInfo {
  name: string;
  version: string;
}

/** Top-level stint file written by the capture agent. */
export interface StintTelemetryFile {
  schema: string;
  recorder: StintRecorderInfo;
  session_id: string;
  note?: string;
  frame_count: number;
  frames: TelemetryFrame[];
}

/** Frame dropped by `filterValidFrames` with human-readable reasons. */
export interface RemovedFrame {
  lap: number;
  ts: number;
  reasons: string[];
  frame: TelemetryFrame;
}

/** Consecutive-frame timestamp hole (dropped samples, not corrupt values). */
export interface FrameGap {
  lap: number;
  startTs: number;
  endTs: number;
  durationMs: number;
}

/** One sector slice of a lap by normalized `pos`. */
export interface SectorMetrics {
  sector: number;
  posStart: number;
  posEnd: number;
  averageSpeedKmh: number;
  sectorTimeMs: number;
}

/** Sector time delta between two laps (positive = second lap slower). */
export interface SectorComparison {
  sector: number;
  deltaTimeMs: number;
  faster: "lap1" | "lap2" | "tie";
}

/** Per-lap summary returned from `analyzeLap`. */
export interface LapAnalysis {
  lap: number;
  lapTimeMs: number;
  topSpeedKmh: number;
  averageSpeedKmh: number;
  averageThrottlePct: number;
  averageBrakePct: number;
  averageTyreTempsC: TyreTempsCelsius;
  sectors: SectorMetrics[];
}

/** Linear tyre warming trend across lap indices in the stint. */
export interface TyreTrendResult {
  perTyre: Record<
    keyof TyreTempsCelsius,
    { slopeCelsiusPerLap: number; interceptCelsius: number }
  >;
  hottest: keyof TyreTempsCelsius;
  lapAverages: Array<{ lap: number; temps: TyreTempsCelsius }>;
}

/** Lap rejected before analysis (partial stint or stop on track). */
export interface ExcludedLap {
  lap: number;
  reason: string;
}
