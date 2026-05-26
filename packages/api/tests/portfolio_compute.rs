//! Compute-layer tests for the portfolio yield API: exercise `compute_series`
//! directly against fixture loans + lifecycle events, no HTTP layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named, no inline-but-separate `_tests.rs` files in
//! `src/`).

use bigdecimal::BigDecimal;

use pipeline_api::routes::portfolio::{compute_series, SamplePoint};
use shared::contract_logs_repo::LifecycleRow;
use shared::loan_details_repo::LoanDetailsRow;

// Loan A: 100k USDC @ 12% (1200 bps), day 0 – 180
// Loan B:  50k USDC @ 15% (1500 bps), day 30 – 120
// Loan C:  75k USDC @ 10% (1000 bps), day 60 – 180

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn fixture_loans() -> Vec<LoanDetailsRow> {
    fn make(
        loan_id: i64,
        tranche: i64,
        rate_bps: i32,
        start_day: i64,
        end_day: i64,
    ) -> LoanDetailsRow {
        LoanDetailsRow {
            chain_id: 1,
            loan_id: BigDecimal::from(loan_id),
            originator: "orig".to_owned(),
            borrower_id: "b".to_owned(),
            commodity: "c".to_owned(),
            corridor: "cr".to_owned(),
            original_facility_size: usdc(tranche),
            original_senior_tranche: usdc(tranche),
            original_equity_tranche: BigDecimal::from(0_i64),
            original_offtaker_price: BigDecimal::from(0_i64),
            senior_interest_rate_bps: rate_bps,
            origination_date: start_day * DAY,
            original_maturity_date: end_day * DAY,
            governing_law: "EN".to_owned(),
            metadata_uri: None,
        }
    }

    vec![
        make(1, 100_000, 1200, 0, 180), // Loan A
        make(2, 50_000, 1500, 30, 120), // Loan B
        make(3, 75_000, 1000, 60, 180), // Loan C
    ]
}

fn fixture_events() -> Vec<LifecycleRow> {
    vec![]
}

fn sample_at(t_day: i64, loans: &[LoanDetailsRow], events: &[LifecycleRow]) -> SamplePoint {
    let t = t_day * DAY;
    let series = compute_series(loans, events, t, t, DAY);
    assert_eq!(series.len(), 1);
    series.into_iter().next().unwrap()
}

/// Compare `Option<f64>` with a small tolerance — Rust's float literal and our
/// BigDecimal-derived value can differ by sub-ULP rounding.
fn assert_apy_approx(got: Option<f64>, expected: Option<f64>) {
    match (got, expected) {
        (None, None) => {}
        (Some(g), Some(e)) => {
            assert!(
                (g - e).abs() < 1e-9,
                "apy mismatch: got {g}, expected {e} (diff {})",
                (g - e).abs()
            );
        }
        _ => panic!("apy variant mismatch: got {got:?}, expected {expected:?}"),
    }
}

#[test]
fn apy_at_day_0_is_loan_a_only() {
    let s = sample_at(0, &fixture_loans(), &fixture_events());
    assert_apy_approx(s.apy, Some(0.12));
    assert_eq!(s.principal_outstanding, "100000.000000");
}

#[test]
fn apy_at_day_30_weighted_average_a_and_b() {
    // (100k·0.12 + 50k·0.15) / 150k = 0.13
    let s = sample_at(30, &fixture_loans(), &fixture_events());
    assert_apy_approx(s.apy, Some(0.13));
    assert_eq!(s.principal_outstanding, "150000.000000");
}

#[test]
fn apy_at_day_60_weighted_average_three_loans() {
    // (100k·0.12 + 50k·0.15 + 75k·0.10) / 225k = 0.12
    let s = sample_at(60, &fixture_loans(), &fixture_events());
    assert_apy_approx(s.apy, Some(0.12));
    assert_eq!(s.principal_outstanding, "225000.000000");
}

#[test]
fn accrued_at_day_30_matches_closed_form() {
    // Loan A only: 100_000 · 0.12 · 30/365 = 986.301369… USDC → "986.301369"
    let s = sample_at(30, &fixture_loans(), &fixture_events());
    assert_eq!(s.accrued, "986.301369");
}

#[test]
fn accrued_at_day_60_three_loans() {
    // A (60d): 100k · 0.12 · 60/365 ≈ 1972.602739
    // B (30d): 50k  · 0.15 · 30/365 ≈ 616.438356
    // C (0d):  0
    // Total: 2589.041095 USDC → "2589.041095"
    let s = sample_at(60, &fixture_loans(), &fixture_events());
    assert_eq!(s.accrued, "2589.041095");
}

#[test]
fn apy_null_when_no_active_loans() {
    let s = sample_at(181, &fixture_loans(), &fixture_events());
    assert_eq!(s.apy, None);
    assert_eq!(s.principal_outstanding, "0.000000");
    // accrued is still the cumulative frozen total.
    assert_ne!(s.accrued, "0.000000");
}

#[test]
fn apy_at_day_180_no_active_loans() {
    // At t=180: end_at for A and C is 180·DAY; `t < end_at` excludes them. Loan B
    // matured at 120. So no loans are active → apy = null, outstanding = 0.
    let s = sample_at(180, &fixture_loans(), &fixture_events());
    assert_eq!(s.apy, None);
    assert_eq!(s.principal_outstanding, "0.000000");
}

#[test]
fn early_close_stops_accrual() {
    // Loan B closes at day 90 (before its scheduled day-120 end).
    let events = vec![LifecycleRow {
        event_name: "LoanClosed".to_owned(),
        block_timestamp: 90 * DAY,
        loan_id: BigDecimal::from(2_i64),
    }];

    // At day 120:
    //   A (120d): 100k · 0.12 · 120/365 ≈ 3945.205479
    //   B  (60d): 50k  · 0.15 · 60/365  ≈ 1232.876712  ← capped at close, not 90d
    //   C  (60d): 75k  · 0.10 · 60/365  ≈ 1232.876712
    //   Total ≈ 6410.958904 USDC
    let s = sample_at(120, &fixture_loans(), &events);
    // Sum-before-truncate: 3945.205479452… + 1232.876712328… + 1232.876712328… =
    // 6410.958904109… → truncate at 6dp → "6410.958904".
    assert_eq!(s.accrued, "6410.958904");
}

#[test]
fn default_stops_accrual_like_close() {
    let events = vec![LifecycleRow {
        event_name: "LoanDefaulted".to_owned(),
        block_timestamp: 90 * DAY,
        loan_id: BigDecimal::from(2_i64),
    }];

    let s = sample_at(120, &fixture_loans(), &events);
    assert_eq!(s.accrued, "6410.958904");
}

#[test]
fn lifecycle_event_after_scheduled_maturity_does_not_extend_loan() {
    // LoanClosed at day 130 (AFTER Loan B's scheduled day-120 end). `min(scheduled,
    // lifecycle)` picks the scheduled end — accrual doesn't extend.
    let events = vec![LifecycleRow {
        event_name: "LoanClosed".to_owned(),
        block_timestamp: 130 * DAY,
        loan_id: BigDecimal::from(2_i64),
    }];

    // At day 120 (with no early close):
    //   A 120d: ≈ 3945.205479
    //   B  90d: ≈ 1849.315068
    //   C  60d: ≈ 1232.876712
    //   Total ≈ 7027.397260
    let s = sample_at(120, &fixture_loans(), &events);
    assert_eq!(s.accrued, "7027.397260");
}

#[test]
fn timestamp_is_iso_utc_string() {
    let s = sample_at(0, &fixture_loans(), &fixture_events());
    assert_eq!(s.timestamp, "1970-01-01T00:00:00Z");

    let s = sample_at(30, &fixture_loans(), &fixture_events());
    assert_eq!(s.timestamp, "1970-01-31T00:00:00Z");
}
