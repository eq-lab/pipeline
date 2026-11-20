// spec: docs/product-specs/loans.md#economics-epochs-rate-and-maturity-over-the-loans-life
//! Reconstructs a loan's `EconomicsEpoch[]` timeline from its genesis origination data
//! and its ordered `LoanRolledOver` / `EconomicsAmended` events (per-loan financials).

use crate::contract_logs_repo::EconomicsEventRow;
/// Basis points per 100% (`10_000` bps = 100%).
pub const BPS_DENOM: i64 = 10_000;

/// The LoanRegistry contract's fixed-point `ONE` (= 100%); on-chain rates are u32 ppm of it.
pub const RATE_ONE: i64 = 1_000_000;

/// Whole-bps floor of a ppm rate (`ppm / 100`): the legacy snapshot mirror and the audit-log `new_rate_bps` (`112_550` to `1_125`).
pub fn ppm_to_bps_floor(ppm: u32) -> u32 {
    ppm / 100
}

/// One window in a loan's economics-epoch timeline: the rate that held for
/// `[start, maturity)`.
#[derive(Debug, Clone, PartialEq)]
pub struct Epoch {
    pub start: i64,
    pub maturity: i64,
    pub rate_ppm: u32,
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
    genesis_rate_ppm: u32,
    events: &[EconomicsEventRow],
) -> Vec<Epoch> {
    let mut epochs = vec![Epoch {
        start: origination_date,
        maturity: original_maturity_date,
        rate_ppm: genesis_rate_ppm,
    }];

    for e in events {
        match e.event_name.as_str() {
            "LoanRolledOver" => {
                // Guarded by the `vec![...]` seed above — never empty.
                let prior_maturity = epochs.last().map_or(origination_date, |ep| ep.maturity);
                epochs.push(Epoch {
                    start: prior_maturity,
                    maturity: e.new_maturity_timestamp,
                    rate_ppm: rate_ppm_from_event(e.new_rate),
                });
            }
            "EconomicsAmended" => {
                if let Some(current) = epochs.last_mut() {
                    current.maturity = e.new_maturity_timestamp;
                    current.rate_ppm = rate_ppm_from_event(e.new_rate);
                }
            }
            _ => {}
        }
    }

    epochs
}

/// Raw `new_rate` (ppm) as `u32`; an unparseable rate decodes to 0.
pub fn rate_ppm_from_event(new_rate: i64) -> u32 {
    u32::try_from(new_rate).unwrap_or(0)
}
