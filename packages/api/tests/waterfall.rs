//! Compute-layer tests for the per-loan repayment waterfall API: exercise the pure
//! `compute_waterfall` / `build_response` directly against fixture snapshots — no
//! HTTP/DB layer.
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests — no
//! `DATABASE_URL` / Postgres connection.

use bigdecimal::BigDecimal;

use pipeline_api::routes::waterfall::{build_response, compute_waterfall, WaterfallDoc};
use shared::loan_parameters_repo::FeeScheduleRow;
use shared::loan_snapshot::{LoanSnapshot, LocationUpdateSnapshot, RepaymentSnapshot};
use utoipa::OpenApi;

// ── Fixtures ───────────────────────────────────────────────────────────────────

fn dec(s: &str) -> BigDecimal {
    s.parse().unwrap()
}

const ORIGINATION: i64 = 1_700_000_000;
/// Exactly one 365-day year after origination — makes annualised carve-outs land on
/// round figures (`tenor_years == 1`).
const ONE_YEAR_LATER: i64 = ORIGINATION + 365 * 86_400;

/// A loan snapshot with a 1,000,000-base-unit senior tranche at a 12% (1200 bps)
/// genesis coupon, `senior_principal_repaid` configurable.
fn snapshot(senior_tranche: &str, senior_repaid: &str, rate_bps: u32) -> LoanSnapshot {
    LoanSnapshot {
        originator: "0xorig".to_owned(),
        borrower_id: "borrower".to_owned(),
        commodity: "Coffee".to_owned(),
        corridor: "BR-EU".to_owned(),
        governing_law: "English".to_owned(),
        protection: String::new(),
        metadata_uri: None,
        documents: vec![],
        original_facility_size: dec(senior_tranche),
        original_senior_tranche: dec(senior_tranche),
        original_equity_tranche: dec("0"),
        original_offtaker_price: dec(senior_tranche),
        senior_interest_rate_bps: rate_bps,
        origination_date: ORIGINATION,
        original_maturity_date: ONE_YEAR_LATER,
        next_economics_epochs_id: dec("1"),
        next_repayment_id: dec("1"),
        status: "Performing".to_owned(),
        ccr_bps: 14_000,
        last_reported_ccr_timestamp: ORIGINATION,
        current_maturity_timestamp: ONE_YEAR_LATER,
        closure_reason: String::new(),
        current_location: LocationUpdateSnapshot {
            location_type: String::new(),
            location_identifier: String::new(),
            tracking_url: String::new(),
            updated_at: 0,
        },
        metadata_uri_onchain: String::new(),
        repayment: RepaymentSnapshot {
            offtaker_received: dec("0"),
            senior_principal_repaid: dec(senior_repaid),
            senior_interest: dec("0"),
            equity_distributed: dec("0"),
            mgmt_fee: dec("0"),
            perf_fee: dec("0"),
            oet_alloc: dec("0"),
        },
    }
}

fn fees(mgmt: i32, perf: i32, oet: i32) -> FeeScheduleRow {
    FeeScheduleRow {
        mgmt_fee_rate_bps: mgmt,
        perf_fee_rate_bps: perf,
        oet_alloc_rate_bps: oet,
    }
}

// ── compute_waterfall ────────────────────────────────────────────────────────

#[test]
fn full_repayment_one_year_with_fees() {
    // Senior 1,000,000 @ 12% for 1 year → gross interest 120,000.
    // mgmt 1% (100 bps) → 10,000. perf 20% (2000 bps) of (120,000 - 10,000) = 22,000.
    // net coupon = 120,000 - 10,000 - 22,000 = 88,000. oet 0.5% (50 bps) → 5,000.
    // Full payment amortises the whole 1,000,000 principal.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1125000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50)).ok().unwrap();

    assert_eq!(b.senior_principal_returned, dec("1000000"));
    assert_eq!(b.senior_coupon_net, dec("88000"));
    assert_eq!(b.management_fee, dec("10000"));
    assert_eq!(b.performance_fee, dec("22000"));
    assert_eq!(b.oet_allocation, dec("5000"));

    // Identity: gross interest == net coupon + mgmt + perf.
    assert_eq!(
        &b.senior_coupon_net + &b.management_fee + &b.performance_fee,
        dec("120000")
    );
}

#[test]
fn principal_capped_at_outstanding() {
    // 400,000 already repaid → outstanding 600,000. A 1,000,000 payment amortises at
    // most the 600,000 outstanding as principal.
    let s = snapshot("1000000", "400000", 1200);
    let amount = dec("1000000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50)).ok().unwrap();

    assert_eq!(b.senior_principal_returned, dec("600000"));
}

#[test]
fn principal_capped_at_amount_on_partial() {
    // Only 500,000 arrives — less than outstanding principal alone. Principal returned is
    // capped at min(amount, outstanding) = 500,000; fees still accrue on the full tranche.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("500000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50)).ok().unwrap();

    assert_eq!(b.senior_principal_returned, dec("500000"));
    assert_eq!(b.management_fee, dec("10000"));
}

#[test]
fn fractional_amount_principal_truncated_to_whole_base_unit() {
    // A sub-base-unit `amount` must not leak fractional precision into the principal:
    // min(amount, outstanding) is truncated toward zero like every other component.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("500000.9");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50)).ok().unwrap();

    assert_eq!(b.senior_principal_returned, dec("500000"));
}

#[test]
fn zero_fee_schedule_routes_all_interest_to_coupon() {
    // With a zero fee schedule every fee carve-out is zero and the full gross interest
    // (120,000) flows to the net senior coupon.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1120000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(0, 0, 0)).ok().unwrap();

    assert_eq!(b.senior_coupon_net, dec("120000"));
    assert_eq!(b.management_fee, dec("0"));
    assert_eq!(b.performance_fee, dec("0"));
    assert_eq!(b.oet_allocation, dec("0"));
}

#[test]
fn zero_tenor_accrues_no_interest_or_fees() {
    // Repayment at origination → tenor 0 → no interest or fees; principal only.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1000000");
    let b = compute_waterfall(&s, &amount, ORIGINATION, &fees(100, 2000, 50)).ok().unwrap();

    assert_eq!(b.senior_coupon_net, dec("0"));
    assert_eq!(b.management_fee, dec("0"));
    assert_eq!(b.performance_fee, dec("0"));
    assert_eq!(b.oet_allocation, dec("0"));
}

#[test]
fn as_of_before_origination_is_rejected() {
    let s = snapshot("1000000", "0", 1200);
    let err = compute_waterfall(&s, &dec("1000000"), ORIGINATION - 1, &fees(100, 2000, 50));
    assert!(err.is_err(), "as_of before origination must be a 400");
}

// ── build_response ───────────────────────────────────────────────────────────

#[test]
fn response_maps_the_four_components() {
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1125000");
    let f = fees(100, 2000, 50);
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &f).ok().unwrap();
    let resp = build_response(&b);

    assert_eq!(resp.senior_principal_returned, "1000000");
    assert_eq!(resp.senior_coupon_net, "88000");
    assert_eq!(resp.management_fee, "10000");
    assert_eq!(resp.performance_fee, "22000");
    assert_eq!(resp.oet_allocation, "5000");
}

// ── OpenAPI ────────────────────────────────────────────────────────────────────

#[test]
fn openapi_doc_registers_path() {
    let doc = WaterfallDoc::openapi();
    let json = serde_json::to_string(&doc).unwrap();
    assert!(json.contains("/v1/loan-book/{loan_id}/waterfall"));
}
