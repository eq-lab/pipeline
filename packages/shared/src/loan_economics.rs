//! Reconstructs a loan's `EconomicsEpoch[]` timeline from its genesis origination data
//! and its ordered `LoanRolledOver` / `EconomicsAmended` events, and derives the
//! maturity-capped, piecewise-sum accrual figures used by both the per-loan financials
//! endpoint (current epoch only) and the repayment waterfall endpoint (full timeline).
//!
//! Mirrors the on-chain `LoanRegistry` epoch model and YieldMinter's per-loan interest
//! `ceiling(loanId)` (`docs/product-specs/loans.md` §"Economics epochs" and
//! `docs/product-specs/yield.md` §"Per-loan mint cap").

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
/// and at `as_of`, expressed in years (`tenor / 365 days`). An epoch that hasn't
/// started yet as of `as_of` (possible when `as_of` predates a later rollover)
/// contributes zero; a loan past its latest epoch's maturity without a rollover stops
/// accruing there regardless of how much later `as_of` is.
pub fn piecewise_tenor_years(epochs: &[Epoch], as_of: i64) -> BigDecimal {
    let seconds: i64 = epochs
        .iter()
        .map(|e| (as_of.min(e.maturity) - e.start).max(0))
        .sum();
    BigDecimal::from(seconds) / BigDecimal::from(YEAR_SECONDS)
}

/// The maturity-capped, piecewise-sum gross interest across the epoch schedule —
/// mirrors YieldMinter's on-chain `ceiling(loanId)`:
///
/// `Σ over epochs e of senior_deployed × e.rate_bps × (min(as_of, e.maturity) − e.start) / (365 days × 10_000)`
///
/// Not truncated — callers apply their own rounding/truncation policy to the sum.
pub fn piecewise_interest(epochs: &[Epoch], senior_deployed: &BigDecimal, as_of: i64) -> BigDecimal {
    let mut total = BigDecimal::from(0);
    for e in epochs {
        let seconds = (as_of.min(e.maturity) - e.start).max(0);
        if seconds == 0 {
            continue;
        }
        total += senior_deployed * BigDecimal::from(e.rate_bps as i64) * BigDecimal::from(seconds)
            / (BigDecimal::from(YEAR_SECONDS) * BigDecimal::from(BPS_DENOM));
    }
    total
}
