// spec: docs/product-specs/book-rate-weighting.md
use bigdecimal::{BigDecimal, RoundingMode, Zero};

use crate::chains::{normalize_usdc_amount, ChainKind};
use crate::contract_logs_repo::LoanRateEventRow;
use crate::loan_economics::{rate_ppm_from_event, BPS_DENOM, RATE_ONE};
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

/// Rate in ppm as a 6-decimal fraction string (`72_550` → `"0.072550"`); 6 dp is exactly 1 ppm.
pub fn ppm_to_fraction_string(ppm: &BigDecimal) -> String {
    (ppm / BigDecimal::from(RATE_ONE))
        .with_scale_round(6, RoundingMode::HalfUp)
        .to_plain_string()
}

/// Outstanding senior of one loan at `t`: the `outstanding` of its latest outstanding event at or before `t`, else 0.
/// Event `outstanding` is raw on-chain units (7 dp on Stellar, 6 on EVM): valid only for within-one-chain ratios, never sum across chains.
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

/// Rate in force at `t` (ppm): the genesis rate updated by `EconomicsAmended` / `LoanRolledOver` `new_rate` at or before `t`.
pub fn rate_ppm_at(initial_ppm: u32, events: &[&LoanRateEventRow], t: i64) -> u32 {
    events
        .iter()
        .filter(|e| {
            e.block_timestamp <= t
                && RATE_EVENT_NAMES.contains(&e.event_name.as_str())
                && e.new_rate.is_some()
        })
        .max_by_key(|e| e.block_timestamp)
        .and_then(|e| e.new_rate)
        .map_or(initial_ppm, rate_ppm_from_event)
}

/// Contract year (365.25 d) used by the `/v1/stats/yield` accrual.
pub const CONTRACT_YEAR_SECS: i64 = 31_557_600;

/// Per-chain-kind normalisation of raw event `outstanding` to base-6 (Stellar 7 dp floors /10, EVM unchanged).
pub fn normalise_rate_events(kind: ChainKind, events: &mut [LoanRateEventRow]) {
    for e in events {
        if let Some(o) = e.outstanding.as_ref() {
            e.outstanding = Some(normalize_usdc_amount(kind, o));
        }
    }
}

/// One loan's piecewise-constant `outstanding × rate_ppm` timeline with a cumulative integral per breakpoint.
pub struct LoanAccrual {
    initial_ppm: u32,
    times: Vec<i64>,
    outstanding: Vec<BigDecimal>,
    rate_ppm: Vec<u32>,
    opens_epoch: Vec<bool>,
    cumulative: Vec<BigDecimal>,
}

impl LoanAccrual {
    /// Events in chain order; for equal timestamps the later event wins, as in `outstanding_at` / `rate_ppm_at`.
    pub fn from_ppm(initial_rate_ppm: u32, events: &[&LoanRateEventRow]) -> Self {
        let mut relevant: Vec<&LoanRateEventRow> = events
            .iter()
            .copied()
            .filter(|e| {
                OUTSTANDING_EVENT_NAMES.contains(&e.event_name.as_str())
                    || RATE_EVENT_NAMES.contains(&e.event_name.as_str())
            })
            .collect();
        relevant.sort_by_key(|e| e.block_timestamp);

        let mut acc = Self {
            initial_ppm: initial_rate_ppm,
            times: Vec::new(),
            outstanding: Vec::new(),
            rate_ppm: Vec::new(),
            opens_epoch: Vec::new(),
            cumulative: Vec::new(),
        };
        let mut cur_out = BigDecimal::zero();
        let mut cur_rate = initial_rate_ppm;
        let mut cum = BigDecimal::zero();
        let mut i = 0;
        while i < relevant.len() {
            let ts = relevant[i].block_timestamp;
            if let Some(&prev) = acc.times.last() {
                cum +=
                    &cur_out * BigDecimal::from(i64::from(cur_rate)) * BigDecimal::from(ts - prev);
            }
            let mut opens = false;
            while i < relevant.len() && relevant[i].block_timestamp == ts {
                let e = relevant[i];
                if OUTSTANDING_EVENT_NAMES.contains(&e.event_name.as_str()) {
                    if let Some(o) = &e.outstanding {
                        cur_out = o.clone();
                    }
                    opens |= e.event_name != "LoanDefaulted";
                }
                if RATE_EVENT_NAMES.contains(&e.event_name.as_str()) {
                    if let Some(r) = e.new_rate {
                        cur_rate = rate_ppm_from_event(r);
                    }
                    opens = true;
                }
                i += 1;
            }
            acc.times.push(ts);
            acc.outstanding.push(cur_out.clone());
            acc.rate_ppm.push(cur_rate);
            acc.opens_epoch.push(opens);
            acc.cumulative.push(cum.clone());
        }
        acc
    }

    fn breakpoint_at(&self, t: i64) -> Option<usize> {
        self.times.partition_point(|&ts| ts <= t).checked_sub(1)
    }

    pub fn outstanding_at(&self, t: i64) -> BigDecimal {
        self.breakpoint_at(t)
            .map_or_else(BigDecimal::zero, |i| self.outstanding[i].clone())
    }

    pub fn rate_ppm_at(&self, t: i64) -> u32 {
        self.breakpoint_at(t)
            .map_or(self.initial_ppm, |i| self.rate_ppm[i])
    }

    fn integral_to(&self, t: i64) -> BigDecimal {
        match self.breakpoint_at(t) {
            None => BigDecimal::zero(),
            Some(i) => {
                &self.cumulative[i]
                    + &self.outstanding[i]
                        * BigDecimal::from(i64::from(self.rate_ppm[i]))
                        * BigDecimal::from(t - self.times[i])
            }
        }
    }

    /// `Σ ∫ outstanding × rate_ppm dt` over `[from, until)` intervals, before the year / `RATE_ONE` division.
    pub fn numerator(&self, intervals: &[(i64, i64)]) -> BigDecimal {
        let mut total = BigDecimal::zero();
        for &(from, until) in intervals {
            total += self.integral_to(until) - self.integral_to(from);
        }
        total
    }

    pub fn accrued(&self, intervals: &[(i64, i64)]) -> BigDecimal {
        self.numerator(intervals) / rate_denominator()
    }

    /// Contract gross accrual over `[0, until)`: floored to a whole unit once per contract epoch.
    /// An epoch opens at every outstanding event except `LoanDefaulted` and at every rate event.
    pub fn accrued_floored_per_epoch(&self, until: i64) -> BigDecimal {
        let floor = |numerator: &BigDecimal| {
            (numerator / rate_denominator()).with_scale_round(0, RoundingMode::Down)
        };
        let mut total = BigDecimal::zero();
        let mut epoch_numerator = BigDecimal::zero();
        for (i, &start) in self.times.iter().enumerate() {
            if start >= until {
                break;
            }
            if self.opens_epoch[i] {
                total += floor(&epoch_numerator);
                epoch_numerator = BigDecimal::zero();
            }
            let end = self.times.get(i + 1).map_or(until, |&next| next.min(until));
            epoch_numerator += &self.outstanding[i]
                * BigDecimal::from(i64::from(self.rate_ppm[i]))
                * BigDecimal::from(end - start);
        }
        total + floor(&epoch_numerator)
    }

    /// `∫ outstanding dt` over `[0, until)` in raw units × seconds.
    pub fn outstanding_seconds(&self, until: i64) -> BigDecimal {
        let mut total = BigDecimal::zero();
        for (i, &start) in self.times.iter().enumerate() {
            if start >= until {
                break;
            }
            let end = self.times.get(i + 1).map_or(until, |&next| next.min(until));
            total += &self.outstanding[i] * BigDecimal::from(end - start);
        }
        total
    }
}

/// Simple interest `outstanding_seconds × rate_bps / (10_000 × CONTRACT_YEAR_SECS)`, not rounded.
pub fn simple_interest(outstanding_seconds: &BigDecimal, rate_bps: i64) -> BigDecimal {
    outstanding_seconds * BigDecimal::from(rate_bps) / accrual_denominator()
}

fn rate_denominator() -> BigDecimal {
    BigDecimal::from(RATE_ONE) * BigDecimal::from(CONTRACT_YEAR_SECS)
}

fn accrual_denominator() -> BigDecimal {
    BigDecimal::from(BPS_DENOM) * BigDecimal::from(CONTRACT_YEAR_SECS)
}

/// Simple-interest accrual `Σ ∫ outstanding(t) × rate(t) dt / CONTRACT_YEAR_SECS` over `intervals` (raw outstanding units).
/// Both factors are piecewise constant between outstanding / rate events (see `LoanAccrual`).
pub fn accrued_over_intervals(
    initial_ppm: u32,
    events: &[&LoanRateEventRow],
    intervals: &[(i64, i64)],
) -> BigDecimal {
    LoanAccrual::from_ppm(initial_ppm, events).accrued(intervals)
}
