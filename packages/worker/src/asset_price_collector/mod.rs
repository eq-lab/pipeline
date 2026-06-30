//! Asset price collector job.
//!
//! Maintains a rolling, retained window of USD prices for each distinct collateral
//! asset named in `loan_parameters`. Separate from the on-chain vault `price_poller`
//! — this deals with external USD asset prices sourced through the pluggable
//! [`PriceProvider`](shared::price_provider::PriceProvider) abstraction.
//!
//! Each cycle, per distinct asset:
//!   1. retention delete first (prune points older than the window),
//!   2. compute the UTC-aligned grid of `retention` points ending at "now",
//!   3. for every missing grid point, fetch via the asset's provider
//!      (`historical_price` for past points, `current_price` for the latest point)
//!      and idempotently insert.
//!
//! An asset configured with more than one provider is logged and skipped. Per-asset
//! errors are logged and never abort the cycle. The loop sleeps 5 minutes between
//! cycles.
//!
//! The pure grid/retention/missing-point logic is factored into standalone functions
//! ([`align_down_to_grid`], [`expected_grid`], [`missing_points`]) so it is unit
//! testable without a database (mirrors `align_to_grid` in the vault price_poller).

pub mod config;

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Datelike, TimeZone, Timelike, Utc};

use shared::loan_asset_price_repo::LoanAssetPriceRepo;
use shared::loan_parameters_repo::{AssetProvider, LoanParametersRepo};
use shared::price_provider::price_provider_for;

pub use config::{AssetPriceCollectorSettings, PriceInterval};

/// Delay between collection cycles (5 minutes).
// `Duration::from_mins` is nightly-only (feature `duration_constructors`), so we
// build the value from seconds and silence clippy's suggestion to use it.
#[allow(clippy::duration_suboptimal_units)]
const CYCLE_DELAY: Duration = Duration::from_secs(5 * 60);

/// How recent the latest grid point must be (relative to `now`) for it to be
/// sourced from the live `current_price` rather than `historical_price`.
///
/// A normally-running job sees a new grid point within one cycle (~5 min); a point
/// older than this window was missed (restart/downtime) and must be backfilled with
/// the historical price *for that instant* rather than the later current price —
/// otherwise e.g. a daily noon close could be filled with the next afternoon's
/// price. Two cycles of slack tolerate a delayed cycle.
const FRESHNESS_SECS: i64 = 2 * 5 * 60;

/// Snap `now` back to the most recent grid point at or before it.
///
/// - `Hourly` → the start of the current hour (`HH:00:00`).
/// - `Daily`  → today's `12:00:00 UTC` if `now >= 12:00`, otherwise yesterday's
///   `12:00:00 UTC` (the latest daily point that has actually arrived).
pub fn align_down_to_grid(now: DateTime<Utc>, interval: PriceInterval) -> DateTime<Utc> {
    match interval {
        PriceInterval::Hourly => Utc
            .with_ymd_and_hms(now.year(), now.month(), now.day(), now.hour(), 0, 0)
            .single()
            .unwrap_or(now),
        PriceInterval::Daily => {
            let noon_today = Utc
                .with_ymd_and_hms(now.year(), now.month(), now.day(), 12, 0, 0)
                .single()
                .unwrap_or(now);
            if now >= noon_today {
                noon_today
            } else {
                noon_today - chrono::Duration::days(1)
            }
        }
    }
}

/// The expected window grid: `retention` points spaced by the interval, ending at the
/// latest grid point at or before `now`, in ascending order.
///
/// The last element is the "current/latest" point (collected via `current_price`);
/// all earlier elements are historical (collected via `historical_price`).
pub fn expected_grid(
    now: DateTime<Utc>,
    interval: PriceInterval,
    retention: usize,
) -> Vec<DateTime<Utc>> {
    if retention == 0 {
        return Vec::new();
    }
    let latest = align_down_to_grid(now, interval);
    let step = chrono::Duration::seconds(interval.step_secs());
    let mut grid: Vec<DateTime<Utc>> = (0..retention).map(|i| latest - step * (i as i32)).collect();
    grid.reverse(); // ascending: oldest .. latest
    grid
}

/// The oldest grid point in the retention window — i.e. the retention cutoff.
/// Rows strictly older than this are deleted. Returns `None` for an empty grid.
pub fn retention_cutoff(
    now: DateTime<Utc>,
    interval: PriceInterval,
    retention: usize,
) -> Option<DateTime<Utc>> {
    expected_grid(now, interval, retention).into_iter().next()
}

/// Grid points (ascending) for which no row exists yet.
///
/// `existing` is the set of timestamps already stored; order is irrelevant.
pub fn missing_points(grid: &[DateTime<Utc>], existing: &[DateTime<Utc>]) -> Vec<DateTime<Utc>> {
    let present: HashSet<DateTime<Utc>> = existing.iter().copied().collect();
    grid.iter()
        .copied()
        .filter(|ts| !present.contains(ts))
        .collect()
}

/// Whether the latest grid point should be sourced from the live `current_price`.
///
/// True only when `latest` is recent enough (within [`FRESHNESS_SECS`] of `now`)
/// that the job is collecting it as it occurs. `now >= latest` always holds by
/// construction of [`align_down_to_grid`]; a larger gap means the point was missed
/// and must be backfilled historically.
pub fn latest_is_live(now: DateTime<Utc>, latest: DateTime<Utc>) -> bool {
    now - latest <= chrono::Duration::seconds(FRESHNESS_SECS)
}

/// Split the distinct `(asset, price_provider)` pairs into the assets that can be
/// collected (exactly one provider) and the assets skipped for having conflicting
/// providers (more than one). Pure so the conflict rule is unit-testable without a
/// database; output is sorted by asset for determinism.
#[allow(clippy::type_complexity)]
pub fn partition_assets(
    pairs: Vec<AssetProvider>,
) -> (Vec<(String, String)>, Vec<(String, Vec<String>)>) {
    let mut by_asset: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for p in pairs {
        by_asset.entry(p.asset).or_default().push(p.price_provider);
    }
    let mut collectable = Vec::new();
    let mut conflicts = Vec::new();
    for (asset, mut providers) in by_asset {
        // Collapse identical providers so only genuinely distinct ones count as a
        // conflict (the SQL already de-dupes, but stay robust if that changes).
        providers.sort();
        providers.dedup();
        if providers.len() == 1 {
            collectable.push((asset, providers.pop().expect("len == 1")));
        } else {
            conflicts.push((asset, providers));
        }
    }
    (collectable, conflicts)
}

/// Entry point: loop forever, running one [`cycle`] every [`CYCLE_DELAY`]. Errors
/// inside a cycle are logged and the loop continues.
pub async fn run_asset_price_collector_job(
    settings: AssetPriceCollectorSettings,
    params_repo: Arc<LoanParametersRepo>,
    price_repo: Arc<LoanAssetPriceRepo>,
) -> anyhow::Result<()> {
    tracing::info!(
        interval = ?settings.interval,
        retention = settings.retention,
        "asset price collector job started"
    );

    loop {
        if let Err(e) = cycle(&settings, &params_repo, &price_repo, Utc::now()).await {
            tracing::error!(error = ?e, "asset price collector cycle error");
        }
        tokio::time::sleep(CYCLE_DELAY).await;
    }
    #[allow(unreachable_code)]
    Ok(())
}

/// One collection pass over all distinct assets. `now` is injected so the timing is
/// deterministic in tests and consistent across all assets in a single pass.
async fn cycle(
    settings: &AssetPriceCollectorSettings,
    params_repo: &LoanParametersRepo,
    price_repo: &LoanAssetPriceRepo,
    now: DateTime<Utc>,
) -> anyhow::Result<()> {
    let pairs = params_repo.distinct_asset_providers().await?;
    let (collectable, conflicts) = partition_assets(pairs);

    for (asset, providers) in &conflicts {
        tracing::warn!(
            asset = %asset,
            providers = ?providers,
            "asset mapped to conflicting price providers, skipping"
        );
    }

    for (asset, provider_key) in &collectable {
        if let Err(e) = collect_asset(settings, price_repo, asset, provider_key, now).await {
            tracing::error!(asset = %asset, provider = %provider_key, error = ?e, "asset price collection failed");
        }
    }

    Ok(())
}

/// Retention + backfill for a single asset.
async fn collect_asset(
    settings: &AssetPriceCollectorSettings,
    price_repo: &LoanAssetPriceRepo,
    asset: &str,
    provider_key: &str,
    now: DateTime<Utc>,
) -> anyhow::Result<()> {
    let provider = price_provider_for(provider_key)?;

    let grid = expected_grid(now, settings.interval, settings.retention);
    let Some(cutoff) = grid.first().copied() else {
        return Ok(());
    };
    let latest = *grid.last().expect("non-empty grid has a last element");

    // 1. Retention first — prune anything older than the window's oldest point.
    let deleted = price_repo.delete_older_than(asset, cutoff).await?;
    if deleted > 0 {
        tracing::debug!(asset = %asset, deleted, "pruned stale asset prices");
    }

    // 2. Find gaps in the window.
    let existing = price_repo.existing_timestamps_since(asset, cutoff).await?;
    let missing = missing_points(&grid, &existing);

    // 3. Backfill each missing point. The latest grid point uses the live
    //    current_price only when it is fresh (collected as it occurs); a missed
    //    latest point (restart/downtime) and all earlier points use historical_price
    //    for their own instant.
    let mut inserted = 0u64;
    for ts in &missing {
        let price = if *ts == latest && latest_is_live(now, latest) {
            provider.current_price(asset).await?
        } else {
            provider.historical_price(asset, *ts).await?
        };
        inserted += price_repo.insert_price(asset, &price, *ts).await?;
    }

    if inserted > 0 {
        tracing::info!(asset = %asset, inserted, "collected asset prices");
    }

    Ok(())
}
