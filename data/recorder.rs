//! Excerpt from the native recorder's telemetry export path.
//!
//! The agent captures the game's shared memory into a `CoreTelemetry` struct and
//! streams a compact per-frame record over the wire. This is the encoder for that
//! record — the frames in the attached stint come off this export path.
//!
//! You do not need to build or run this. Read it.

use serde::Serialize;

/// Fixed-point scale factors shared across the recorder's encoders.
mod scales {
    /// Temperature in Celsius — precision: 0.1 °C.
    pub const TEMPERATURE: f32 = 10.0;
}

/// Live tyre core temperatures, in degrees Celsius (one probe per corner).
#[derive(Debug, Clone, Copy)]
pub struct TyreTempsC {
    pub fl: f32,
    pub fr: f32,
    pub rl: f32,
    pub rr: f32,
}

/// Minimal per-frame telemetry the capture loop hands to the encoder.
#[derive(Debug, Clone, Copy)]
pub struct CoreTelemetry {
    pub timestamp_ms: u64, // ms since recording started
    pub lap_number: i32,
    pub position: f32,     // normalized lap position, 0.0..1.0
    pub speed_kmh: f32,
    pub throttle: f32,     // 0.0..1.0
    pub brake: f32,        // 0.0..1.0
    pub steering_deg: f32, // steering angle, degrees (negative = left)
    pub gear: i8,          // -1 = reverse, 0 = neutral, 1..=8 forward
    pub rpm: i32,
}

/// A four-wheel block of tyre temperatures as written to the wire.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct WireTyres {
    pub fl: i16,
    pub fr: i16,
    pub rl: i16,
    pub rr: i16,
}

/// One frame as serialized into the stint stream.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct WireFrame {
    pub ts: u64,
    pub lap: i32,
    pub pos: f32,
    pub spd: f32,
    pub thr: f32,
    pub brk: f32,
    pub str: f32,
    pub gear: i8,
    pub rpm: i32,
    pub tyres: WireTyres,
}

/// Encode one captured frame into its wire form.
pub fn encode_frame(core: &CoreTelemetry, tyres: &TyreTempsC) -> WireFrame {
    WireFrame {
        ts: core.timestamp_ms,
        lap: core.lap_number,
        pos: core.position,
        spd: core.speed_kmh,
        thr: core.throttle,
        brk: core.brake,
        str: core.steering_deg,
        gear: core.gear,
        rpm: core.rpm,
        tyres: WireTyres {
            fl: (tyres.fl * scales::TEMPERATURE) as i16,
            fr: (tyres.fr * scales::TEMPERATURE) as i16,
            rl: (tyres.rl * scales::TEMPERATURE) as i16,
            rr: (tyres.rr * scales::TEMPERATURE) as i16,
        },
    }
}