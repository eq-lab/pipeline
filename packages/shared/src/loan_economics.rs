//! Reconstructs a loan's `EconomicsEpoch[]` timeline from its genesis origination data
//! and its ordered `LoanRolledOver` / `EconomicsAmended` events, and derives the
//! maturity-capped, piecewise-sum accrual figures used by both the per-loan financials
//! endpoint (current epoch only) and the repayment waterfall endpoint (full timeline).
//!
//! Mirrors the on-chain `LoanRegistry` epoch model (`docs/product-specs/loans.md`
//! §"Economics epochs"). Accrual within each epoch is **true compound interest**
//! (`(1 + rate) ^ tenor − 1`, real exponentiation) rather than the linear/simple-interest
//! approximation (`rate × tenor`) that both the waterfall spec
//! (`docs/product-specs/yield.md` §"Waterfall components") and YieldMinter's on-chain
//! `ceiling(loanId)` (§"Per-loan mint cap") document — a deliberate choice made when this
//! was last revisited, so this module's output no longer matches either of those by
//! construction. See `compound_growth` for the precision tradeoff that choice implies.

use std::str::FromStr;

use bigdecimal::BigDecimal;

use crate::contract_logs_repo::EconomicsEventRow;

/// Basis points per 100% (`10_000` bps = 100%).
pub const BPS_DENOM: i64 = 10_000;

/// The LoanRegistry contract's fixed-point `ONE` (= 100%). Economics-event rates
/// (`LoanRolledOver` / `EconomicsAmended` `new_rate`) are scaled by 1e6, so
/// `new_rate / 100` is bps (`150_000` → `1_500` bps = 15%) — a *different scale* from
/// the snapshot's genesis `senior_interest_rate_bps`, normalised on fold.
pub const ECONOMICS_RATE_ONE: i64 = 1_000_000;

/// Seconds in the 365-day interest year used by every `tenor / 365` accrual factor.
pub const YEAR_SECONDS: i64 = 365 * 86_400;

/// One window in a loan's economics-epoch timeline: the rate that held for
/// `[start, maturity)`.
#[derive(Debug, Clone, PartialEq)]
pub struct Epoch {
    pub start: i64,
    pub maturity: i64,
    pub rate_bps: u32,
}

/// Fold the ordered economics events onto epoch 1 (seeded from genesis origination
/// data), returning the *full* epoch timeline.
///
/// `LoanRolledOver` closes the current epoch and opens a new one starting at its
/// (possibly amended) maturity; `EconomicsAmended` overwrites the current epoch's
/// rate/maturity in place without opening a new one. `events` must be ordered by
/// `(block_number, log_index)` (as `ContractLogsRepo::list_loan_economics_events`
/// returns them) and pre-filtered to `block_timestamp <= as_of` by the caller so a
/// backdated `as_of` doesn't see epochs opened after it.
pub fn build_epochs(
    origination_date: i64,
    original_maturity_date: i64,
    genesis_rate_bps: u32,
    events: &[EconomicsEventRow],
) -> Vec<Epoch> {
    let mut epochs = vec![Epoch {
        start: origination_date,
        maturity: original_maturity_date,
        rate_bps: genesis_rate_bps,
    }];

    for e in events {
        match e.event_name.as_str() {
            "LoanRolledOver" => {
                // Guarded by the `vec![...]` seed above — never empty.
                let prior_maturity = epochs.last().map_or(origination_date, |ep| ep.maturity);
                epochs.push(Epoch {
                    start: prior_maturity,
                    maturity: e.new_maturity_timestamp,
                    rate_bps: economics_rate_to_bps(e.new_rate),
                });
            }
            "EconomicsAmended" => {
                if let Some(current) = epochs.last_mut() {
                    current.maturity = e.new_maturity_timestamp;
                    current.rate_bps = economics_rate_to_bps(e.new_rate);
                }
            }
            _ => {}
        }
    }

    epochs
}

/// Contract-1e6-scaled event rate → bps: `new_rate × 10_000 / 1_000_000 = new_rate / 100`,
/// rounded half-up (`150_000` → `1_500` bps = 15%).
pub fn economics_rate_to_bps(new_rate: i64) -> u32 {
    let bps = (new_rate * BPS_DENOM + ECONOMICS_RATE_ONE / 2) / ECONOMICS_RATE_ONE;
    bps as u32
}

/// Total accrual time across the epoch schedule, capped at each epoch's own maturity
/// and at `as_of`, in whole seconds. An epoch that hasn't started yet as of `as_of`
/// (possible when `as_of` predates a later rollover) contributes zero; a loan past its
/// latest epoch's maturity without a rollover stops accruing there regardless of how
/// much later `as_of` is.
pub fn piecewise_capped_seconds(epochs: &[Epoch], as_of: i64) -> i64 {
    epochs
        .iter()
        .map(|e| (as_of.min(e.maturity) - e.start).max(0))
        .sum()
}

/// Compound growth of `base` at `rate_bps` (annualised, contract bps scale) over
/// `seconds`, via real exponentiation: `base × ((1 + rate) ^ (seconds / 365 days) − 1)`.
/// Not truncated — callers apply their own rounding/truncation policy.
///
/// The exponent `seconds / YEAR_SECONDS` is a real number, generally irrational once
/// raised as a power of `(1 + rate)` — no decimal (or rational) type can hold that
/// exactly, the same way no decimal type can hold `1/3` exactly. Unlike a hand-rolled
/// truncated series (a linear/simple-interest formula *is* the first-order Taylor term
/// of continuous compounding, `e^x ≈ 1 + x`), this computes the growth *factor* via a
/// single call to the standard IEEE-754 `f64::powf` — a correctly-rounded, full
/// double-precision (~15–17 significant digits) power function, not an approximation we
/// wrote ourselves. Only that dimensionless factor crosses the float boundary; `base`
/// (the money amount, potentially large) is multiplied against it in `BigDecimal`, so
/// principal precision is never lost to float rounding — only the rate factor is.
///
/// The factor is rounded to 12 decimal places before crossing into `BigDecimal`,
/// discarding float noise below f64's reliable ~15–17 significant digits. This matters
/// even for a case with an exact answer: at 50 bps for exactly 1 year,
/// `(1.005f64).powf(1.0) − 1.0` evaluates to `0.00499999999999989…`, not `0.005`, off by
/// ~1e-16 — negligible on its own, but truncate-toward-zero (the caller's policy) turns a
/// value sitting a hair below a whole-base-unit boundary into a full unit short (`4999`
/// instead of `5000` on a 1,000,000 base). Rounding first restores the boundary before
/// truncation sees it.
#[allow(clippy::cast_precision_loss)] // rate_bps/seconds are well within f64's exact-integer range for realistic loan terms
pub fn compound_growth(base: &BigDecimal, rate_bps: i64, seconds: i64) -> BigDecimal {
    if seconds <= 0 || rate_bps == 0 {
        return BigDecimal::from(0);
    }
    let rate = rate_bps as f64 / BPS_DENOM as f64;
    let tenor_years = seconds as f64 / YEAR_SECONDS as f64;
    let factor = (1.0_f64 + rate).powf(tenor_years) - 1.0;
    let factor = (factor * 1e12).round() / 1e12;
    let factor =
        BigDecimal::from_str(&format!("{factor:.12}")).unwrap_or_else(|_| BigDecimal::from(0));
    base * factor
}

/// The maturity-capped, piecewise-sum gross interest across the epoch schedule: each
/// epoch's own rate compounds independently over its own capped duration against the
/// flat `senior_deployed` base (the accrual base never itself compounds across epochs —
/// per spec it's always `originalSeniorTranche`), and the epochs' growth amounts sum.
/// See `compound_growth` for the per-epoch formula and its precision tradeoff.
///
/// Not truncated — callers apply their own rounding/truncation policy to the sum.
pub fn piecewise_interest(
    epochs: &[Epoch],
    senior_deployed: &BigDecimal,
    as_of: i64,
) -> BigDecimal {
    let mut total = BigDecimal::from(0);
    for e in epochs {
        let seconds = (as_of.min(e.maturity) - e.start).max(0);
        if seconds == 0 {
            continue;
        }
        total += compound_growth(senior_deployed, e.rate_bps as i64, seconds);
    }
    total
}
