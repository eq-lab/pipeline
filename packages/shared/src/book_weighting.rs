// spec: docs/product-specs/book-rate-weighting.md
use bigdecimal::{BigDecimal, RoundingMode, Zero};

use crate::contract_logs_repo::LoanRateEventRow;
use crate::loan_economics::{economics_rate_to_bps, BPS_DENOM};
use crate::loan_snapshot::LoanSnapshot;

pub const OUTSTANDING_EVENT_NAMES: [&str; 6] = [
    "Disbursed",
    "Undisbursed",
    "PaymentRecorded",
    "PaymentUnrecorded",
    "LoanDefaulted",
    "LoanWrittenDown",
];

pub const RATE_EVENT_NAMES: [&str; 2] = ["EconomicsAmended", "LoanRolledOver"];

pub const RATE_WEIGHT_EVENT_NAMES: [&str; 8] = [
    "Disbursed",
    "Undisbursed",
    "PaymentRecorded",
    "PaymentUnrecorded",
    "LoanDefaulted",
    "LoanWrittenDown",
    "EconomicsAmended",
    "LoanRolledOver",
];

const SECS_PER_DAY: i64 = 86_400;

/// Current epoch rate in bps; pre-rework rows (`current_rate == 0`) fall back to the genesis rate.
pub fn current_rate_bps(snapshot: &LoanSnapshot) -> u32 {
    if snapshot.current_rate > 0 {
        snapshot.current_rate
    } else {
        snapshot.senior_interest_rate_bps
    }
}

/// Current full term in whole days (`current_maturity - origination`), falling back to the original maturity.
pub fn current_tenor_days(snapshot: &LoanSnapshot) -> i64 {
    let maturity = if snapshot.current_maturity_timestamp > 0 {
        snapshot.current_maturity_timestamp
    } else {
        snapshot.original_maturity_date
    };
    ((maturity - snapshot.origination_date) / SECS_PER_DAY).max(0)
}

/// `Σ wᵢ·vᵢ / Σ wᵢ`; `None` when `Σ wᵢ == 0`.
pub fn weighted_mean<I>(pairs: I) -> Option<BigDecimal>
where
    I: IntoIterator<Item = (BigDecimal, BigDecimal)>,
{
    let mut num = BigDecimal::zero();
    let mut den = BigDecimal::zero();
    for (w, v) in pairs {
        num += &w * v;
        den += w;
    }
    (den > BigDecimal::zero()).then(|| num / den)
}

/// Weighted mean rate in bps as a 6-decimal fraction string (`"0.190909"`).
pub fn bps_to_fraction_string(bps: &BigDecimal) -> String {
    (bps / BigDecimal::from(BPS_DENOM))
        .with_scale_round(6, RoundingMode::HalfUp)
        .to_plain_string()
}

/// Outstanding senior of one loan at `t`: the `outstanding` of its latest outstanding event at or before `t`, else 0.
pub fn outstanding_at(events: &[&LoanRateEventRow], t: i64) -> BigDecimal {
    events
        .iter()
        .filter(|e| {
            e.block_timestamp <= t
                && OUTSTANDING_EVENT_NAMES.contains(&e.event_name.as_str())
                && e.outstanding.is_some()
        })
        .max_by_key(|e| e.block_timestamp)
        .and_then(|e| e.outstanding.clone())
        .unwrap_or_else(BigDecimal::zero)
}

/// Rate in force at `t` (bps): the genesis rate updated by `EconomicsAmended` / `LoanRolledOver` `new_rate` (ppm) at or before `t`.
pub fn rate_bps_at(initial_bps: u32, events: &[&LoanRateEventRow], t: i64) -> u32 {
    events
        .iter()
        .filter(|e| {
            e.block_timestamp <= t
                && RATE_EVENT_NAMES.contains(&e.event_name.as_str())
                && e.new_rate.is_some()
        })
        .max_by_key(|e| e.block_timestamp)
        .and_then(|e| e.new_rate)
        .map_or(initial_bps, economics_rate_to_bps)
}
