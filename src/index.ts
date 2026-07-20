/**
 * Hono HTTP entry — loads bundled stint JSON and returns analysis as JSON.
 */

import { Hono } from "hono";
import {
  analyzeLap,
  compareLapSectors,
  tyreTempTrend,
} from "./analysis.ts";
import {
  detectGaps,
  exclusionReason,
  isCompleteLap,
  splitLaps,
} from "./laps.ts";
import { filterValidFrames, loadTelemetry } from "./telemetry.ts";
import type { ExcludedLap, FrameGap, RemovedFrame } from "./types.ts";

const TELEMETRY_PATH = `${import.meta.dir}/../data/stint.telemetry.json`;
const PORT = Number(process.env.PORT) || 3000;

const app = new Hono();

/** Full `/analyze` payload: filter → lap split → metrics on complete laps only. */
async function buildAnalysisResponse() {
  const stint = await loadTelemetry(TELEMETRY_PATH);
  const { valid, removed } = filterValidFrames(stint.frames);
  const lapMap = splitLaps(valid);

  const excludedLaps: ExcludedLap[] = [];
  const completeLapFrames: typeof valid[] = [];

  for (const [lap, frames] of [...lapMap.entries()].sort((a, b) => a[0] - b[0])) {
    if (!isCompleteLap(frames)) {
      const reason = exclusionReason(frames) ?? `lap ${lap} excluded: incomplete lap data`;
      console.log(reason);
      excludedLaps.push({ lap, reason });
    } else {
      completeLapFrames.push(frames);
    }
  }

  const laps = completeLapFrames.map((frames) => analyzeLap(frames));

  const gaps: FrameGap[] = [];
  for (const frames of lapMap.values()) {
    gaps.push(...detectGaps(frames));
  }

  const lapComparison =
    laps.length >= 2
      ? {
          baselineLap: laps[0]!.lap,
          compareLap: laps[1]!.lap,
          sectors: compareLapSectors(laps[0]!.sectors, laps[1]!.sectors),
        }
      : null;

  const tyreTrend = tyreTempTrend(valid);

  return {
    meta: {
      sessionId: stint.session_id,
      recorderVersion: stint.recorder.version,
      schema: stint.schema,
      framesTotal: stint.frames.length,
      framesRemoved: removed.map(summarizeRemoved),
    },
    dataQuality: {
      corruptedFrames: removed.map(summarizeRemoved),
      gaps,
    },
    excludedLaps,
    laps,
    lapComparison,
    tyreTrend,
  };
}

function summarizeRemoved(entry: RemovedFrame) {
  return {
    lap: entry.lap,
    ts: entry.ts,
    reasons: entry.reasons,
  };
}

app.get("/analyze", async (c) => {
  const data = await buildAnalysisResponse();
  return c.json(data);
});

app.get("/", (c) => c.redirect("/analyze"));

console.log(`Stint engineer listening on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
