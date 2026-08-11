//! Configuration for the asset_price_collector job, read from the environment.
//!
//! Mirrors the env-parsing style of the other worker jobs (e.g. `kyc/config.rs`):
//! a plain settings struct with a `from_env` constructor and sane defaults.

use anyhow::{bail, Result};

use crate::indexer::config::env_bool;

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
    /// Dev/test escape hatch: when `true`, [`shared::price_provider::price_provider_for`]
    /// (and the worker startup assertion) permit resolving a non-market price
    /// provider (e.g. `static`). Read once here from
    /// `PRICE_PROVIDER_ALLOW_NON_MARKET`, defaulting to `false` (refuse) so a
    /// production deployment cannot resolve a non-market provider for a live loan
    /// unless it opts in explicitly.
    pub allow_non_market: bool,
}

impl AssetPriceCollectorSettings {
    /// Read settings from `JOB_ASSET_PRICE_COLLECTOR_INTERVAL`,
    /// `JOB_ASSET_PRICE_COLLECTOR_RETENTION`, and `PRICE_PROVIDER_ALLOW_NON_MARKET`.
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

        let allow_non_market = env_bool("PRICE_PROVIDER_ALLOW_NON_MARKET");

        Ok(Self {
            interval,
            retention,
            allow_non_market,
        })
    }
}
