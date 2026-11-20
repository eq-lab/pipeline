// spec: docs/references/backend.md#loanregistry-rate-ppm-backfill
use pipeline_worker::indexer::rate_ppm_backfill::plan_rate_ppm_backfill;
use shared::contract_logs_repo::RateBackfillRow;

fn row(id: i64, event: &str, new_rate: Option<i64>, stored_bps: i64) -> RateBackfillRow {
    RateBackfillRow {
        id,
        event_name: event.to_owned(),
        new_rate,
        stored_bps: Some(stored_bps),
        has_ppm: false,
    }
}

#[test]
fn genesis_only_history_gets_the_genesis_rate_on_every_row() {
    let rows = [
        row(1, "LoanDrawn", None, 725),
        row(2, "Disbursed", None, 725),
        row(3, "PaymentRecorded", None, 725),
    ];
    let plan = plan_rate_ppm_backfill(72_550, &rows).unwrap();
    assert_eq!(plan, vec![(1, 72_550), (2, 72_550), (3, 72_550)]);
}

#[test]
fn amendment_applies_from_its_own_row_onward() {
    let rows = [
        row(1, "LoanDrawn", None, 725),
        row(2, "EconomicsAmended", Some(112_550), 725),
        row(3, "Disbursed", None, 725),
    ];
    let plan = plan_rate_ppm_backfill(72_550, &rows).unwrap();
    assert_eq!(plan, vec![(1, 72_550), (2, 112_550), (3, 112_550)]);
}

#[test]
fn rollover_then_amendment_follow_each_other() {
    let rows = [
        row(1, "LoanDrawn", None, 725),
        row(2, "LoanRolledOver", Some(90_001), 725),
        row(3, "PaymentRecorded", None, 725),
        row(4, "EconomicsAmended", Some(95_999), 725),
    ];
    let plan = plan_rate_ppm_backfill(72_550, &rows).unwrap();
    assert_eq!(
        plan,
        vec![(1, 72_550), (2, 90_001), (3, 90_001), (4, 95_999)]
    );
}

#[test]
fn stored_bps_mismatch_aborts_the_loan() {
    let rows = [row(1, "LoanDrawn", None, 700)];
    assert!(plan_rate_ppm_backfill(72_550, &rows).is_err());
}

#[test]
fn missing_new_rate_keeps_the_previous_rate_and_out_of_range_decodes_to_zero() {
    let rows = [
        row(1, "LoanDrawn", None, 725),
        row(2, "EconomicsAmended", None, 725),
        row(3, "LoanRolledOver", Some(-1), 725),
        row(4, "Disbursed", None, 725),
    ];
    let plan = plan_rate_ppm_backfill(72_550, &rows).unwrap();
    assert_eq!(plan, vec![(1, 72_550), (2, 72_550), (3, 0), (4, 0)]);
}

#[test]
fn rows_that_already_carry_ppm_are_not_rewritten_but_still_advance_the_rate() {
    let mut amended = row(2, "EconomicsAmended", Some(112_550), 725);
    amended.has_ppm = true;
    let rows = [
        row(1, "LoanDrawn", None, 725),
        amended,
        row(3, "Disbursed", None, 725),
    ];
    let plan = plan_rate_ppm_backfill(72_550, &rows).unwrap();
    assert_eq!(plan, vec![(1, 72_550), (3, 112_550)]);
}
