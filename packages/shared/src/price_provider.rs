//! Pluggable USD price providers for loan-collateral assets.
//!
//! Each loan in `loan_parameters` names a `price_provider` key; the
//! `asset_price_collector` worker job resolves that key to an
//! `Arc<dyn PriceProvider>` via [`price_provider_for`] and uses it to fetch both
//! the current price and historical backfill points. Mirrors the existing trait
//! patterns in `shared` (e.g. `MetadataFetcher`) — the trait is the seam, concrete
//! implementations live behind it so more providers (CoinGecko, on-chain oracles,
//! …) can be added without touching the job.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};

/// Source of USD prices for a single asset symbol.
///
/// Implementations must be cheap to clone behind an `Arc` and safe to share across
/// tasks (`Send + Sync`). All fallible I/O surfaces as `anyhow::Result` so the job
/// can log per-asset errors and continue.
#[async_trait]
pub trait PriceProvider: Send + Sync {
    /// Latest USD price for `asset`.
    async fn current_price(&self, asset: &str) -> Result<BigDecimal>;

    /// USD price for `asset` at the historical instant `at`. Must be stable across
    /// runs for the same `(asset, at)` so backfill is idempotent and repeatable.
    async fn historical_price(&self, asset: &str, at: DateTime<Utc>) -> Result<BigDecimal>;
}

/// Registry key for [`StaticPriceProvider`].
pub const STATIC_PROVIDER_KEY: &str = "static";

/// Resolve a `price_provider` string key (as stored in `loan_parameters`) to a
/// concrete provider. Returns an error for unknown keys so the caller can log and
/// skip the affected asset.
pub fn price_provider_for(key: &str) -> Result<Arc<dyn PriceProvider>> {
    match key {
        STATIC_PROVIDER_KEY => Ok(Arc::new(StaticPriceProvider)),
        other => Err(anyhow!("unknown price provider key `{other}`")),
    }
}

/// The current USD price returned by [`StaticPriceProvider::current_price`].
pub const STATIC_CURRENT_PRICE: &str = "1.2345";

/// Deterministic stub provider used for development and tests.
///
/// `current_price` is the fixed constant [`STATIC_CURRENT_PRICE`]. `historical_price`
/// is a pure function of the timestamp, mapped into `[1, 2)`, so repeated backfill of
/// the same grid point always yields the same value (never random).
pub struct StaticPriceProvider;

impl StaticPriceProvider {
    /// Pure, deterministic mapping from an instant to a price in `[1, 2)`.
    ///
    /// Exposed (and exercised directly by tests) so the determinism guarantee can be
    /// asserted without going through the async trait.
    pub fn deterministic_historical_price(at: DateTime<Utc>) -> BigDecimal {
        // Spread the seconds-since-epoch across [0, 1) deterministically, then offset
        // into [1, 2). Using a modulus keeps the value bounded and stable per instant.
        let secs = at.timestamp();
        // `rem_euclid` keeps the result non-negative even for pre-epoch timestamps.
        let bucket = secs.rem_euclid(1000);
        // bucket / 1000 ∈ [0, 1) with three decimals → 1 + that ∈ [1, 2).
        BigDecimal::from(1000 + bucket) / BigDecimal::from(1000)
    }
}

#[async_trait]
impl PriceProvider for StaticPriceProvider {
    async fn current_price(&self, _asset: &str) -> Result<BigDecimal> {
        Ok(STATIC_CURRENT_PRICE.parse().expect("valid decimal literal"))
    }

    async fn historical_price(&self, _asset: &str, at: DateTime<Utc>) -> Result<BigDecimal> {
        Ok(Self::deterministic_historical_price(at))
    }
}
