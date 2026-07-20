/** Wire-encoded tyre block (tenths of °C). */
export interface WireTyres {
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

/** One telemetry frame as stored in the stint JSON. */
export interface TelemetryFrame {
  ts: number;
  lap: number;
  pos: number;
  spd: number;
  thr: number;
  brk: number;
  str: number;
  gear: number;
  rpm: number;
  tyres: WireTyres;
}

/** Tyre temperatures in °C after fixed-point decode. */
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

export interface StintTelemetryFile {
  schema: string;
  recorder: StintRecorderInfo;
  session_id: string;
  note?: string;
  frame_count: number;
  frames: TelemetryFrame[];
}

export interface RemovedFrame {
  lap: number;
  ts: number;
  reasons: string[];
  frame: TelemetryFrame;
}

export interface FrameGap {
  lap: number;
  startTs: number;
  endTs: number;
  durationMs: number;
}

export interface SectorMetrics {
  sector: number;
  posStart: number;
  posEnd: number;
  averageSpeedKmh: number;
  sectorTimeMs: number;
}

export interface SectorComparison {
  sector: number;
  deltaTimeMs: number;
  faster: "lap1" | "lap2" | "tie";
}

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

export interface TyreTrendResult {
  perTyre: Record<
    keyof TyreTempsCelsius,
    { slopeCelsiusPerLap: number; interceptCelsius: number }
  >;
  hottest: keyof TyreTempsCelsius;
  lapAverages: Array<{ lap: number; temps: TyreTempsCelsius }>;
}

export interface ExcludedLap {
  lap: number;
  reason: string;
}
