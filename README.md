# stint-engineer

Bun + Hono service that loads a stint telemetry JSON export, filters corrupt frames, splits and validates laps, and returns lap metrics, sector times, comparisons, and tyre temperature trends.

## Run

```bash
bun install
bun run src/index.ts
```

Open [http://localhost:3000/analyze](http://localhost:3000/analyze) for JSON.

Set `PORT` to listen on another port.

## Glossary

| Field | Meaning |
| --- | --- |
| `thr` | Throttle input, 0–1 |
| `brk` | Brake input, 0–1 |
| `str` | Steering angle in degrees (negative = left) |
| `pos` | Normalized lap position, 0–1 around the circuit |
| `spd` | Speed in km/h |
| `tyres.fl` | Front-left tyre: wire value is fixed-point tenths of °C; divide by 10 for °C (see below) |
| `tyres.fr` | Front-right tyre: same encoding as `tyres.fl` |
| `tyres.rl` | Rear-left tyre: same encoding as `tyres.fl` |
| `tyres.rr` | Rear-right tyre: same encoding as `tyres.fl` |
| `rpm` | Engine RPM |
| `gear` | `-1` reverse, `0` neutral, `1`–`8` forward gears |

### Read the recorder — tyre temperature on the wire

`data/recorder.rs` defines the export scale: `scales::TEMPERATURE = 10.0`, meaning each corner is stored as **tenths of a degree Celsius** (`i16` on the wire). The encoder multiplies live °C by 10 before write (`encode_frame`, lines 76–80).

Decoding in this service is `correctTyreTemps` in `src/telemetry.ts` (lines 20–27), using `TYRE_TEMP_SCALE = 10` (line 13): each of `tyres.fl`, `tyres.fr`, `tyres.rl`, `tyres.rr` is divided by 10.

Example from the first frame in `data/stint.telemetry.json` (`lap` 0, `ts` 87):

| Corner | Raw wire value | Corrected °C |
| --- | ---: | ---: |
| `tyres.fl` | 573 | 57.3 |
| `tyres.fr` | 539 | 53.9 |
| `tyres.rl` | 563 | 56.3 |
| `tyres.rr` | 527 | 52.7 |

Per-lap average tyre columns in the tables below use `averageTyreTemps` in `src/analysis.ts` (lines 141–159): arithmetic mean of `correctTyreTemps` over frames in that lap (not time-weighted).

## Clean the stream — what was found and removed

Source stint: `data/stint.telemetry.json` — **2372** frames, **4** distinct `lap` values (0–3). Pipeline: `loadTelemetry` → `filterValidFrames` (`src/telemetry.ts`) → `splitLaps` / `isCompleteLap` (`src/laps.ts`) → `analyzeLap` (`src/analysis.ts`), wired in `buildAnalysisResponse` (`src/index.ts`, lines 21–39).

### Corrupted frame (removed)

One frame fails validation in `invalidReasons` / `filterValidFrames` (`src/telemetry.ts`, lines 29–65):

| Field | Value |
| --- | --- |
| Lap | 2 |
| `ts` | 136186 |
| `spd` | 3987.6 km/h |
| `rpm` | 63120 |

Thresholds (`src/telemetry.ts`, lines 8–11, applied in lines 31–36):

| Check | Bound | Rationale |
| --- | --- | --- |
| Speed | 0–360 km/h | Plausible ceiling for GT/prototype-class cars on track (well above any realistic lap here; ~248 km/h peak in this stint) |
| RPM | 0–16 000 | Plausible ceiling for race engines in this class; rejects obvious garbage without clipping valid high-RPM samples |

Rejection strings in JSON: `"speed 3987.6 km/h outside 0–360"`, `"rpm 63120 outside 0–16000"`.

### Timestamp gap (not removed)

Detected by `detectGaps` in `src/laps.ts` (lines 81–101) when any consecutive delta exceeds **500 ms** (`GAP_THRESHOLD_MS`, line 12):

| Lap | Start `ts` | End `ts` | Delta |
| --- | ---: | ---: | ---: |
| 1 | 72950 | 75575 | 2625 ms |

Typical spacing in this file is ~70–100 ms. This interval is **missing/dropped frames**, not a bad speed/RPM sample — the frame pair is kept.

For **lap time**, the full 2625 ms still counts toward elapsed time (`lapTimeMs`, `src/analysis.ts` lines 25–37): wall-clock time advanced even without samples.

For **average speed / throttle / brake**, `timeWeightedMean` (`src/analysis.ts`, lines 39–60) weights each interval by `min(Δts, 200 ms)` (`MAX_INTERVAL_WEIGHT_MS`, line 18). Without the cap, lap 1 average speed would be **209.46 km/h** (full delta weighting); with the cap it is **208.22 km/h** — see lap 1 table below.

### Lap exclusions (not analyzed)

After filtering, laps are split by `splitLaps` (`src/laps.ts`, lines 14–27). Completeness uses `isCompleteLap` / `exclusionReason` (lines 42–78):

| Lap | Outcome | Mechanism | Reason in output |
| --- | --- | --- | --- |
| 0 | Excluded | `min(pos) > 0.05` (`POS_START_TOLERANCE`, line 4) | Recording began mid-lap at `pos` 0.4000 — not a full lap from the line |
| 3 | Excluded | `endsStoppedBeforeFinish` (lines 30–39): `max(pos) < 0.95` and last 5 frames all `< 5 km/h` | Car stops (speed → 0) around `pos` 0.4 before finishing — session ended on track, not a complete lap |

**Defensible racing laps:** **2** complete laps analyzed (**lap 1** and **lap 2**) out of **4** lap indices in the raw stream.

## Read each lap — per-lap summary

Values from `GET /analyze` on the bundled stint (same as `analyzeLap`, `src/analysis.ts` lines 236–254).

### Lap 1

| Metric | Value |
| --- | ---: |
| Lap time (ms) | 58 312 |
| Top speed (km/h) | 247.9 |
| Average speed (km/h) | 208.22 |
| Average throttle (%) | 63.91 |
| Average brake (%) | 13.90 |
| Avg tyre FL / FR / RL / RR (°C) | 86.04 / 82.97 / 83.36 / 80.31 |

Frame timestamps for this lap: first `ts` **42304**, last `ts` **100616** → `lapTimeMs` = 100616 − 42304 = **58 312** (`lapTimeMs` in `src/analysis.ts`). Frames are grouped by `lap` before analysis, so lap 2’s first frame is not included. The 2625 ms gap **does not shorten** lap time; it reflects real elapsed time without samples.

Speed, throttle, and brake averages use `timeWeightedMean` (capped 200 ms), not a simple mean over frame count. Lap 1 average speed: **208.22 km/h** (capped time-weighted) vs **208.43 km/h** (arithmetic over 659 frames) vs **209.46 km/h** (time-weighted **without** cap — shows what the gap would inflate toward).

### Lap 2

| Metric | Value |
| --- | ---: |
| Lap time (ms) | 58 092 |
| Top speed (km/h) | 248.3 |
| Average speed (km/h) | 210.61 |
| Average throttle (%) | 64.04 |
| Average brake (%) | 13.26 |
| Avg tyre FL / FR / RL / RR (°C) | 93.53 / 90.50 / 90.87 / 87.86 |

Same lap-time rule: last − first within lap 2’s frame group only. One corrupt frame at `ts` 136186 was removed before analysis; remaining lap 2 frames still span a full lap.

Lap 2 is **220 ms** quicker overall than lap 1 (58 092 vs 58 312 ms).

## Beyond the brief — additional findings

### Sector breakdown (`computeSectors`, `src/analysis.ts` lines 87–114)

Three sectors by `pos`: [0, ⅓), [⅓, ⅔), [⅔, 1]. Sector times sum inter-frame deltas within each sector (full gaps included in sector wall time where they fall).

**Lap 1 sector times (ms):** S1 21 580 · S2 18 361 · S3 18 209  

**Lap 2 sector times (ms):** S1 21 503 · S2 18 467 · S3 17 976  

**Lap 1 vs lap 2** (`compareLapSectors`, lines 116–138; JSON `lapComparison.sectors`):

| Sector | Δ time (ms) (lap 2 − lap 1) | Faster |
| ---: | ---: | --- |
| 1 | −77 | lap 2 |
| 2 | +106 | lap 1 |
| 3 | −233 | lap 2 |

Lap 2 gained time in sectors 1 and 3 (−77 ms and −233 ms vs lap 1) but was slower in sector 2 (+106 ms); sector deltas sum to **−204 ms**, while full `lapTimeMs` differs by **−220 ms** (58 092 vs 58 312) because sector `pos` bands do not partition lap time exactly.

### Tyre temperature trend (`tyreTempTrend`, `src/analysis.ts` lines 191–234)

Linear trend °C per lap index (slope from all valid frames grouped by `lap`, including partial laps 0 and 3 in the regression input):

| Corner | °C / lap (slope) |
| --- | ---: |
| FL | 7.01 |
| FR | 7.13 |
| RL | 7.13 |
| RR | 7.26 |

`hottest` over stint mean averages: **fl** (`tyreTrend.hottest` in `/analyze` output). On the two complete laps, FL rises from **86.0 °C** (lap 1) to **93.5 °C** (lap 2) — the data suggests front-left is the thermal limit corner and all tyres are climbing roughly **7 °C per lap** through this short stint, which matters for stint length and balance even though the brief only required lap-time metrics.

## Layout

```
src/
  index.ts       Hono app (/analyze)
  telemetry.ts   Load JSON, validate frames, decode tyre temps
  laps.ts        Lap split, completeness, gap detection
  analysis.ts    Sectors, lap summary, tyre trend
  types.ts       Shared interfaces
data/
  stint.telemetry.json
  recorder.rs    Reference encoder (not built here)
```
