//! Unit tests for the epoch-timeline accrual guard (`validate_epochs_for_accrual`).
//! Pure — no DB, no clock. Guards the waterfall's accrual math against a corrupt
//! (`0`/malformed) epoch maturity that would otherwise silently zero out that epoch's
//! interest/fees (issue #930).

use bigdecimal::BigDecimal;
use shared::loan_economics::{
    piecewise_capped_seconds, piecewise_interest, validate_epochs_for_accrual, Epoch, InvalidEpoch,
};

fn epoch(start: i64, maturity: i64) -> Epoch {
    Epoch {
        start,
        maturity,
        rate_bps: 1_500,
    }
}

#[test]
fn accepts_a_valid_single_epoch_timeline() {
    let epochs = [epoch(1_700_000_000, 1_715_552_000)];
    assert_eq!(validate_epochs_for_accrual(&epochs), Ok(()));
}

#[test]
fn accepts_a_valid_multi_epoch_timeline() {
    let epochs = [
        epoch(1_700_000_000, 1_715_552_000),
        epoch(1_715_552_000, 1_731_104_000),
    ];
    assert_eq!(validate_epochs_for_accrual(&epochs), Ok(()));
}

#[test]
fn rejects_a_zero_maturity_the_coalesce_corruption() {
    // The exact shape of the loan-14 corruption: a real start, a `0` maturity from a
    // `LoanRolledOver`/`EconomicsAmended` event whose param defaulted to 0.
    let epochs = [epoch(1_700_000_000, 0)];
    assert_eq!(
        validate_epochs_for_accrual(&epochs),
        Err(InvalidEpoch {
            ordinal: 1,
            start: 1_700_000_000,
            maturity: 0,
        })
    );
}

#[test]
fn rejects_a_maturity_before_its_start() {
    let epochs = [epoch(1_715_552_000, 1_700_000_000)];
    let err = validate_epochs_for_accrual(&epochs).unwrap_err();
    assert_eq!(err.ordinal, 1);
}

#[test]
fn rejects_a_zero_duration_epoch_maturity_equals_start() {
    // Strict: a legitimate epoch always has positive duration.
    let epochs = [epoch(1_700_000_000, 1_700_000_000)];
    let err = validate_epochs_for_accrual(&epochs).unwrap_err();
    assert_eq!(err.ordinal, 1);
}

#[test]
fn reports_the_first_corrupt_epoch_ordinal_in_a_multi_epoch_timeline() {
    // Epoch 1 is fine; epoch 2 (the rolled-over, currently-open epoch) is corrupt.
    let epochs = [epoch(1_700_000_000, 1_715_552_000), epoch(1_715_552_000, 0)];
    let err = validate_epochs_for_accrual(&epochs).unwrap_err();
    assert_eq!(err.ordinal, 2);
    assert_eq!(err.maturity, 0);
}

// A caller that reaches the accrual functions without validating first is a bug — the
// `debug_assert` in each makes it trip in test/debug builds instead of silently zeroing
// the epoch (issue #930). These lock that guard-at-source behavior in.

#[test]
#[should_panic(expected = "validate_epochs_for_accrual")]
fn piecewise_capped_seconds_panics_in_debug_on_an_unvalidated_corrupt_epoch() {
    let epochs = [epoch(1_700_000_000, 0)];
    let _ = piecewise_capped_seconds(&epochs, 1_715_552_000);
}

#[test]
#[should_panic(expected = "validate_epochs_for_accrual")]
fn piecewise_interest_panics_in_debug_on_an_unvalidated_corrupt_epoch() {
    let epochs = [epoch(1_700_000_000, 0)];
    let _ = piecewise_interest(&epochs, &BigDecimal::from(1_000_000), 1_715_552_000);
}
