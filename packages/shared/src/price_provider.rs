//! Pluggable USD price providers for loan-collateral assets.
//!
//! Each loan's collateral-valuation anchor names a `price_provider` key; the
//! `asset_price_collector` worker job resolves that key to an
//! `Arc<dyn PriceProvider>` via [`price_provider_for`] and uses it to fetch both
//! the current price and historical backfill points. Mirrors the existing trait
//! patterns in `shared` (e.g. `MetadataFetcher`) — the trait is the seam, concrete
//! implementations live behind it so more providers (CoinGecko, on-chain oracles,
//! …) can be added without touching the job.
//!
//! Two implementations ship today: the deterministic [`StaticPriceProvider`]
//! (`STATIC_PROVIDER_KEY`, for dev/tests) and the live
//! [`MetalPricePriceProvider`](crate::metal_price::MetalPricePriceProvider)
//! (`METALPRICE_PROVIDER_KEY`, precious-metal USD spot/historical rates from
//! [MetalpriceAPI](https://metalpriceapi.com/documentation)).
//!
//! ## Market vs non-market providers
//!
//! Every registered key is classified as **market** (backed by a live external
//! feed, e.g. `metal_price`) or **non-market** (a deterministic stub with no
//! relationship to a real price, e.g. `static`). [`is_market_provider`] and
//! [`is_known_provider`] expose that classification.
//!
//! [`price_provider_for`] refuses to resolve a non-market key unless the caller
//! passes `allow_non_market = true`. This function stays pure — it does not read
//! the environment — so the escape hatch is threaded in explicitly by callers.
//! The one production caller is the `asset_price_collector` worker job, which
//! reads it once at startup from `PRICE_PROVIDER_ALLOW_NON_MARKET`
//! (`AssetPriceCollectorSettings::from_env`) and threads it through; the same flag
//! also gates the worker's boot-time assertion that no drawn loan uses a
//! non-market provider. Leave the variable unset (default refuse) in production;
//! set it to allow `static` in dev/test.

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

/// Registry key for
/// [`MetalPricePriceProvider`](crate::metal_price::MetalPricePriceProvider).
pub const METALPRICE_PROVIDER_KEY: &str = "metal_price";

/// A registered provider key and whether it is backed by a live market feed.
struct ProviderSpec {
    key: &'static str,
    is_market: bool,
}

/// The full set of registered `price_provider` keys, with their market
/// classification. Adding a provider means adding it here *and* to the `CHECK`
/// constraint on `collateral_valuation_config.price_provider`
/// (`packages/shared/migrations/20260811000001_price_provider_market_guard.sql`)
/// — the two must stay in sync, mirroring the existing `valuation_mode`
/// enum/`CHECK` coupling on the same table.
const PROVIDERS: &[ProviderSpec] = &[
    ProviderSpec {
        key: STATIC_PROVIDER_KEY,
        is_market: false,
    },
    ProviderSpec {
        key: METALPRICE_PROVIDER_KEY,
        is_market: true,
    },
];

/// Whether `key` is a registered provider (market or non-market).
pub fn is_known_provider(key: &str) -> bool {
    PROVIDERS.iter().any(|p| p.key == key)
}

/// Whether `key` is a registered **market** provider (a live external feed).
/// An unknown key is never a market provider.
pub fn is_market_provider(key: &str) -> bool {
    PROVIDERS.iter().any(|p| p.key == key && p.is_market)
}

/// The registered provider keys, in registry order — for diagnostics and error
/// messages so they stay in sync with [`PROVIDERS`] rather than duplicating the
/// list as a string literal.
pub fn known_provider_keys() -> Vec<&'static str> {
    PROVIDERS.iter().map(|p| p.key).collect()
}

/// Resolve a `price_provider` string key (as stored on the collateral-valuation anchor) to a
/// concrete provider. Returns an error for unknown keys, for providers whose
/// configuration is missing (e.g. an unset API key), and — unless
/// `allow_non_market` is `true` — for known non-market (stub) providers, so the
/// caller can log and skip the affected asset exactly as it already does for the
/// other error cases.
///
/// `allow_non_market` is an explicit parameter rather than an environment read so
/// this function (and the `shared` crate) stays pure and unit-testable without
/// env-gated tests. See the module docs for how the production caller threads the
/// flag through from `PRICE_PROVIDER_ALLOW_NON_MARKET`.
pub fn price_provider_for(key: &str, allow_non_market: bool) -> Result<Arc<dyn PriceProvider>> {
    // The registry (`PROVIDERS`) is the single source of truth for whether a key is
    // known and whether it is market-backed, so classification never drifts between
    // this resolution path and `is_market_provider` (used by the worker startup
    // assertion). Adding a provider to `PROVIDERS` guards it here automatically.
    if !is_known_provider(key) {
        return Err(anyhow!("unknown price provider key `{key}`"));
    }
    if !is_market_provider(key) && !allow_non_market {
        return Err(anyhow!(
            "non-market price provider `{key}` refused in production; set \
             PRICE_PROVIDER_ALLOW_NON_MARKET to allow in dev/test"
        ));
    }
    match key {
        STATIC_PROVIDER_KEY => Ok(Arc::new(StaticPriceProvider)),
        METALPRICE_PROVIDER_KEY => Ok(Arc::new(
            crate::metal_price::MetalPricePriceProvider::from_env()?,
        )),
        // `is_known_provider` above already rejected anything not in `PROVIDERS`.
        _ => unreachable!("known provider key `{key}` has no constructor arm"),
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
