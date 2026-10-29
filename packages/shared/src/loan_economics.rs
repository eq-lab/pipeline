// spec: docs/product-specs/loans.md#economics-epochs-rate-and-maturity-over-the-loans-life
//! Reconstructs a loan's `EconomicsEpoch[]` timeline from its genesis origination data
//! and its ordered `LoanRolledOver` / `EconomicsAmended` events (per-loan financials).

use crate::contract_logs_repo::EconomicsEventRow;
/// Basis points per 100% (`10_000` bps = 100%).
pub const BPS_DENOM: i64 = 10_000;

/// The LoanRegistry contract's fixed-point `ONE` (= 100%). Economics-event rates
/// (`LoanRolledOver` / `EconomicsAmended` `new_rate`) are scaled by 1e6, so
/// `new_rate / 100` is bps (`150_000` → `1_500` bps = 15%) — a *different scale* from
/// the snapshot's genesis `senior_interest_rate_bps`, normalised on fold.
pub const ECONOMICS_RATE_ONE: i64 = 1_000_000;

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
/// truncated (floor), the same rule as the worker's snapshot `raw / 100` (`150_000` → `1_500` bps = 15%; `112_550` → `1_125`).
pub fn economics_rate_to_bps(new_rate: i64) -> u32 {
    let bps = new_rate * BPS_DENOM / ECONOMICS_RATE_ONE;
    bps as u32
}
