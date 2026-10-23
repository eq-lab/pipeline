// spec: docs/product-specs/yield-apy-semantics.md#v1pnl-avg_apy
use bigdecimal::BigDecimal;

use crate::position_repo::{BalanceEventRow, SharePriceSnapshot};

pub const MIN_HELD_SECS: i64 = 86_400;
pub const SECS_PER_YEAR: f64 = 365.0 * 86_400.0;

pub struct VaultHolding {
    pub events: Vec<BalanceEventRow>,
    pub prices: Vec<SharePriceSnapshot>,
}

fn price_at(prices: &[SharePriceSnapshot], ts: i64) -> Option<f64> {
    let idx = prices.partition_point(|p| p.block_timestamp.timestamp() <= ts);
    let p = prices.get(idx.checked_sub(1)?)?;
    positive_f64(&p.price)
}

fn positive_f64(v: &BigDecimal) -> Option<f64> {
    let f: f64 = v.to_string().parse().ok()?;
    (f.is_finite() && f > 0.0).then_some(f)
}

fn holding_intervals(events: &[BalanceEventRow], now: i64) -> Vec<(i64, i64)> {
    let zero = BigDecimal::from(0);
    let mut out = Vec::new();
    let mut open: Option<i64> = None;
    for e in events {
        let held = e.shares_balance > zero;
        match (open, held) {
            (None, true) => open = Some(e.block_timestamp),
            (Some(start), false) => {
                out.push((start, e.block_timestamp));
                open = None;
            }
            _ => {}
        }
    }
    if let Some(start) = open {
        out.push((start, now));
    }
    out
}

pub fn time_weighted_apy(vaults: &[VaultHolding], now: i64) -> Option<f64> {
    let mut log_return = 0.0_f64;
    let mut held_secs = 0_i64;
    for v in vaults {
        for (start, end) in holding_intervals(&v.events, now) {
            if end <= start {
                continue;
            }
            let (Some(p0), Some(p1)) = (price_at(&v.prices, start), price_at(&v.prices, end))
            else {
                continue;
            };
            log_return += (p1 / p0).ln();
            held_secs += end - start;
        }
    }
    if held_secs < MIN_HELD_SECS {
        return None;
    }
    #[allow(clippy::cast_precision_loss)]
    let apy = (log_return * SECS_PER_YEAR / held_secs as f64).exp() - 1.0;
    apy.is_finite().then_some(apy)
}

pub fn linear_apy(
    latest: &BigDecimal,
    oldest: &BigDecimal,
    span_secs: i64,
    min_span_secs: i64,
) -> Option<f64> {
    if span_secs < min_span_secs || span_secs <= 0 {
        return None;
    }
    let (latest, oldest) = (positive_f64(latest)?, positive_f64(oldest)?);
    #[allow(clippy::cast_precision_loss)]
    let apy = (latest / oldest - 1.0) * SECS_PER_YEAR / span_secs as f64;
    apy.is_finite().then_some(apy)
}
