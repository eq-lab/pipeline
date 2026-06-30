//! Configuration for the asset_price_collector job, read from the environment.
//!
//! Mirrors the env-parsing style of the other worker jobs (e.g. `kyc/config.rs`):
//! a plain settings struct with a `from_env` constructor and sane defaults.

use anyhow::{bail, Result};

/// The UTC grid the collector samples on.
///
/// - `Hourly` → one point at every `*:00`.
/// - `Daily`  → one point per day at `12:00 UTC`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PriceInterval {
    Hourly,
    Daily,
}

impl PriceInterval {
    /// Parse the `JOB_ASSET_PRICE_COLLECTOR_INTERVAL` env value. Accepts
    /// `HOURS`/`DAYS` (case-insensitive).
    pub fn parse(s: &str) -> Result<Self> {
        match s.trim().to_ascii_uppercase().as_str() {
            "HOURS" | "HOUR" | "HOURLY" => Ok(PriceInterval::Hourly),
            "DAYS" | "DAY" | "DAILY" => Ok(PriceInterval::Daily),
            other => {
                bail!("JOB_ASSET_PRICE_COLLECTOR_INTERVAL must be HOURS or DAYS, got `{other}`")
            }
        }
    }

    /// Spacing between adjacent grid points, in seconds.
    pub fn step_secs(self) -> i64 {
        match self {
            PriceInterval::Hourly => 3600,
            PriceInterval::Daily => 86_400,
        }
    }
}

/// Settings for [`crate::asset_price_collector::run_asset_price_collector_job`].
#[derive(Debug, Clone, Copy)]
pub struct AssetPriceCollectorSettings {
    /// Grid resolution (hourly vs daily).
    pub interval: PriceInterval,
    /// Number of grid points to retain per asset (the window size). Older points
    /// are pruned each cycle.
    pub retention: usize,
}

impl AssetPriceCollectorSettings {
    /// Read settings from `JOB_ASSET_PRICE_COLLECTOR_INTERVAL` and
    /// `JOB_ASSET_PRICE_COLLECTOR_RETENTION`.
    pub fn from_env() -> Result<Self> {
        let interval_raw = std::env::var("JOB_ASSET_PRICE_COLLECTOR_INTERVAL")
            .map_err(|_| anyhow::anyhow!("JOB_ASSET_PRICE_COLLECTOR_INTERVAL is not set"))?;
        let interval = PriceInterval::parse(&interval_raw)?;

        let retention_raw = std::env::var("JOB_ASSET_PRICE_COLLECTOR_RETENTION")
            .map_err(|_| anyhow::anyhow!("JOB_ASSET_PRICE_COLLECTOR_RETENTION is not set"))?;
        let retention: usize = retention_raw.trim().parse().map_err(|_| {
            anyhow::anyhow!("JOB_ASSET_PRICE_COLLECTOR_RETENTION must be a positive integer")
        })?;
        if retention == 0 {
            bail!("JOB_ASSET_PRICE_COLLECTOR_RETENTION must be at least 1");
        }

        Ok(Self {
            interval,
            retention,
        })
    }
}
