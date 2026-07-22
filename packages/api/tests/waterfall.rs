//! Compute-layer tests for the per-loan repayment waterfall API: exercise the pure
//! `compute_waterfall` / `build_response` directly against fixture snapshots — no
//! HTTP/DB layer.
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests — no
//! `DATABASE_URL` / Postgres connection.

use bigdecimal::BigDecimal;

use pipeline_api::routes::waterfall::{build_response, compute_waterfall, WaterfallDoc};
use shared::contract_logs_repo::EconomicsEventRow;
use shared::loan_fee_schedule_repo::FeeScheduleRow;
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
/// Exactly half a 365-day year after origination — the midpoint used by the
/// rollover tests to split accrual across two epochs at round fractions.
const HALF_YEAR_LATER: i64 = ORIGINATION + 365 * 86_400 / 2;

/// A loan snapshot with a 1,000,000-base-unit senior tranche at a 12% (1200 bps)
/// genesis coupon, `senior_principal_repaid` configurable and no other cumulative
/// repayment recorded yet (first repayment). See `snapshot_with_repayment` for a
/// second-repayment fixture with non-zero recorded interest/fees.
fn snapshot(senior_tranche: &str, senior_repaid: &str, rate_bps: u32) -> LoanSnapshot {
    snapshot_with_repayment(
        senior_tranche,
        RepaymentSnapshot {
            offtaker_received: dec("0"),
            senior_principal_repaid: dec(senior_repaid),
            senior_interest: dec("0"),
            equity_distributed: dec("0"),
            mgmt_fee: dec("0"),
            perf_fee: dec("0"),
            oet_alloc: dec("0"),
        },
        rate_bps,
    )
}

/// Like `snapshot` but with a fully custom `RepaymentSnapshot`, for tests that model a
/// second (or later) repayment against cumulative counters already partly recorded.
fn snapshot_with_repayment(
    senior_tranche: &str,
    repayment: RepaymentSnapshot,
    rate_bps: u32,
) -> LoanSnapshot {
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
        repayment,
    }
}

fn fees(mgmt: i32, perf: i32, oet: i32) -> FeeScheduleRow {
    FeeScheduleRow {
        mgmt_fee_rate_bps: mgmt,
        perf_fee_rate_bps: perf,
        oet_alloc_rate_bps: oet,
    }
}

/// A `LoanRolledOver`/`EconomicsAmended` event. `new_rate` is the contract's
/// 1e6-scaled fraction (`240_000` → 2400 bps = 24%), matching
/// `ContractLogsRepo::list_loan_economics_events`.
fn econ_event(name: &str, new_rate: i64, new_maturity: i64) -> EconomicsEventRow {
    EconomicsEventRow {
        event_name: name.to_owned(),
        new_rate,
        new_maturity_timestamp: new_maturity,
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
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50), &[])
        .ok()
        .unwrap();

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
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50), &[])
        .ok()
        .unwrap();

    assert_eq!(b.senior_principal_returned, dec("600000"));
}

#[test]
fn coupon_and_fees_paid_in_full_before_principal_on_shortfall() {
    // Full waterfall targets (senior 1,000,000 @ 12% for 1 year, fees 100/2000/50 bps):
    // coupon 88,000, mgmt fee 10,000, perf fee 22,000, oet 5,000, principal 1,000,000.
    // Priority order is now coupon → mgmt → perf → oet → principal, so a 500,000
    // payment — enough to cover coupon + all fees (125,000) but not full principal —
    // pays coupon and every fee bucket in full and leaves principal to absorb the
    // shortfall: 500,000 − 125,000 = 375,000.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("500000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50), &[])
        .ok()
        .unwrap();

    assert_eq!(b.senior_coupon_net, dec("88000"));
    assert_eq!(b.management_fee, dec("10000"));
    assert_eq!(b.performance_fee, dec("22000"));
    assert_eq!(b.oet_allocation, dec("5000"));
    assert_eq!(b.senior_principal_returned, dec("375000"));
}

#[test]
fn principal_shrinks_last_when_amount_falls_short() {
    // Same full-year targets as above. A 1,050,000 payment covers coupon + all fees in
    // full (125,000) and leaves 925,000 for principal — short of the full 1,000,000
    // outstanding by 75,000. Principal is dead-last in the cascade, so it's the one that
    // shrinks, not any of the higher-priority buckets.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1050000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50), &[])
        .ok()
        .unwrap();

    assert_eq!(b.senior_coupon_net, dec("88000"));
    assert_eq!(b.management_fee, dec("10000"));
    assert_eq!(b.performance_fee, dec("22000"));
    assert_eq!(b.oet_allocation, dec("5000"));
    assert_eq!(b.senior_principal_returned, dec("925000"));

    // Cascade invariant: components never sum to more than the incoming amount.
    let total = &b.senior_principal_returned
        + &b.senior_coupon_net
        + &b.management_fee
        + &b.performance_fee
        + &b.oet_allocation;
    assert_eq!(total, amount);
}

#[test]
fn principal_reduced_to_zero_when_amount_exactly_covers_coupon_and_fees() {
    // 125,000 exactly covers coupon + mgmt fee + perf fee + oet (88,000 + 10,000 +
    // 22,000 + 5,000), leaving nothing at all for principal — the lowest-priority
    // bucket, now that it's last in the cascade.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("125000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50), &[])
        .ok()
        .unwrap();

    assert_eq!(b.senior_coupon_net, dec("88000"));
    assert_eq!(b.management_fee, dec("10000"));
    assert_eq!(b.performance_fee, dec("22000"));
    assert_eq!(b.oet_allocation, dec("5000"));
    assert_eq!(b.senior_principal_returned, dec("0"));
}

#[test]
fn fractional_amount_principal_truncated_to_whole_base_unit() {
    // A sub-base-unit `amount` must not leak fractional precision into principal — the
    // last bucket in the cascade, and the one that ends up holding the fractional
    // remainder after coupon + fees (125,000 total) are subtracted from 500,000.9:
    // min(outstanding, remaining) is truncated toward zero like every other component.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("500000.9");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50), &[])
        .ok()
        .unwrap();

    assert_eq!(b.senior_principal_returned, dec("375000"));
}

#[test]
fn zero_fee_schedule_routes_all_interest_to_coupon() {
    // With a zero fee schedule every fee carve-out is zero and the full gross interest
    // (120,000) flows to the net senior coupon.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1120000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(0, 0, 0), &[])
        .ok()
        .unwrap();

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
    let b = compute_waterfall(&s, &amount, ORIGINATION, &fees(100, 2000, 50), &[])
        .ok()
        .unwrap();

    assert_eq!(b.senior_coupon_net, dec("0"));
    assert_eq!(b.management_fee, dec("0"));
    assert_eq!(b.performance_fee, dec("0"));
    assert_eq!(b.oet_allocation, dec("0"));
}

#[test]
fn as_of_before_origination_is_rejected() {
    let s = snapshot("1000000", "0", 1200);
    let err = compute_waterfall(
        &s,
        &dec("1000000"),
        ORIGINATION - 1,
        &fees(100, 2000, 50),
        &[],
    );
    assert!(err.is_err(), "as_of before origination must be a 400");
}

// ── Piecewise epochs (rollovers / rate changes) ─────────────────────────────────

#[test]
fn rollover_mid_tenor_applies_each_epoch_own_rate() {
    // Genesis epoch: 12% (1200 bps), maturing at the half-year point. A LoanRolledOver
    // there opens a new epoch at 24% (2400 bps, contract-scaled `240_000`) for the
    // second half-year. Compound growth per epoch, `(1+rate)^0.5 - 1`:
    // epoch 1: 1,000,000 × ((1.12)^0.5 - 1) ≈ 58,300.524
    // epoch 2: 1,000,000 × ((1.24)^0.5 - 1) ≈ 113,552.873
    // sum ≈ 171,853.397, truncated toward zero → 171,853. (The simple-interest baseline
    // this replaced would have given 60,000 + 120,000 = 180,000 instead.)
    let s = LoanSnapshot {
        original_maturity_date: HALF_YEAR_LATER,
        ..snapshot("1000000", "0", 1200)
    };
    let events = [econ_event("LoanRolledOver", 240_000, ONE_YEAR_LATER)];
    let amount = dec("1180000"); // Comfortably covers principal + compound interest.
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(0, 0, 0), &events)
        .ok()
        .unwrap();

    assert_eq!(b.senior_principal_returned, dec("1000000"));
    assert_eq!(b.senior_coupon_net, dec("171853"));
}

#[test]
fn as_of_within_first_epoch_ignores_a_later_rollover() {
    // The same rollover as above, but `as_of` lands at the midpoint — before the
    // rollover event's own `block_timestamp` cutoff would apply in the handler, and
    // squarely inside epoch 1. Only the genesis rate should accrue:
    // 1,000,000 × ((1.12)^0.5 - 1) ≈ 58,300.524, truncated → 58,300.
    let s = LoanSnapshot {
        original_maturity_date: HALF_YEAR_LATER,
        ..snapshot("1000000", "0", 1200)
    };
    let events = [econ_event("LoanRolledOver", 240_000, ONE_YEAR_LATER)];
    let amount = dec("1060000");
    let b = compute_waterfall(&s, &amount, HALF_YEAR_LATER, &fees(0, 0, 0), &events)
        .ok()
        .unwrap();

    assert_eq!(b.senior_coupon_net, dec("58300"));
}

#[test]
fn fees_compound_too_at_fractional_tenor() {
    // Management fee also compounds via `(1+rate)^tenor - 1`, not just gross interest.
    // At 200 bps for exactly half a year: 1,000,000 × ((1.02)^0.5 - 1) ≈ 9,950.494,
    // truncated → 9,950 — short of the 10,000 a linear `rate × tenor` approximation
    // would give (1,000,000 × 2% × 0.5 = 10,000), because compounding over less than a
    // full period grows slower than the linear approximation.
    let s = LoanSnapshot {
        original_maturity_date: HALF_YEAR_LATER,
        ..snapshot("1000000", "0", 1200)
    };
    let amount = dec("1010000"); // 1,000,000 principal + headroom above the ~9,950 fee.
    let b = compute_waterfall(&s, &amount, HALF_YEAR_LATER, &fees(200, 0, 0), &[])
        .ok()
        .unwrap();

    assert_eq!(b.management_fee, dec("9950"));
}

#[test]
fn exact_result_is_not_lost_to_float_truncation_noise() {
    // Regression for a real float-precision hazard: `f64::powf` doesn't guarantee an
    // exact result even when the true answer is a whole number. At 50 bps for exactly
    // 1 year, `(1.005f64).powf(1.0) - 1.0` evaluates to `0.00499999999999989…`, not
    // `0.005` — negligible on its own, but truncate-toward-zero turns a value sitting a
    // hair below the 5,000-base-unit boundary into 4,999. `compound_growth` rounds the
    // factor to 12 decimal places first specifically to catch this before truncation
    // does; this test locks that fix in on a value that's easy to get subtly wrong.
    // OET is last in the cascade priority order, behind the (zero-fee) senior coupon —
    // so `amount` must cover principal + the full 120,000 gross-interest coupon ahead of
    // it too, or the cascade would zero OET out for an unrelated reason (shortfall, not
    // the float-truncation bug this test is isolating).
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1125000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(0, 0, 50), &[])
        .ok()
        .unwrap();

    assert_eq!(b.oet_allocation, dec("5000"));
}

#[test]
fn past_maturity_without_rollover_stops_accruing() {
    // No rollover recorded. `as_of` is two years past origination — a full year past
    // the genesis epoch's maturity. Interest still caps at the epoch's own maturity
    // (1,000,000 × 12% × 1 year = 120,000), matching the on-chain ceiling rather than
    // continuing to accrue over the full origination→as_of span.
    let s = snapshot("1000000", "0", 1200);
    let two_years_later = ORIGINATION + 2 * 365 * 86_400;
    let amount = dec("1120000");
    let b = compute_waterfall(&s, &amount, two_years_later, &fees(0, 0, 0), &[])
        .ok()
        .unwrap();

    assert_eq!(b.senior_coupon_net, dec("120000"));
}

// ── Second+ repayment: netting out amounts already recorded ────────────────────

#[test]
fn second_repayment_nets_out_amounts_already_recorded() {
    // Same full-year targets as `full_repayment_one_year_with_fees` (gross interest
    // 120,000; mgmt 10,000; perf 22,000; coupon 88,000; oet 5,000), but this snapshot
    // already carries a first repayment's cumulative counters: 300,000 principal,
    // 4,000 mgmt fee, 8,000 perf fee, 30,000 net coupon, 2,000 OET recorded. The
    // waterfall for a *second* repayment must return only what's newly due:
    // outstanding principal 700,000, mgmt 6,000, coupon 58,000, perf 14,000, oet 3,000.
    let s = snapshot_with_repayment(
        "1000000",
        RepaymentSnapshot {
            offtaker_received: dec("0"),
            senior_principal_repaid: dec("300000"),
            senior_interest: dec("30000"),
            equity_distributed: dec("0"),
            mgmt_fee: dec("4000"),
            perf_fee: dec("8000"),
            oet_alloc: dec("2000"),
        },
        1200,
    );
    // 700,000 outstanding principal + 6,000 + 58,000 + 14,000 + 3,000 = 781,000: a full
    // payment of everything still owed, so no cascade shortfall shrinks any bucket.
    let amount = dec("781000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50), &[])
        .ok()
        .unwrap();

    assert_eq!(b.senior_principal_returned, dec("700000"));
    assert_eq!(b.management_fee, dec("6000"));
    assert_eq!(b.senior_coupon_net, dec("58000"));
    assert_eq!(b.performance_fee, dec("14000"));
    assert_eq!(b.oet_allocation, dec("3000"));
}

#[test]
fn already_recorded_amount_exceeding_the_target_clamps_to_zero() {
    // A prior manual Trustee override recorded more management fee (15,000) than the
    // freshly computed cumulative target (10,000) — e.g. a negotiated adjustment. The
    // "still owed" figure must clamp at 0, not go negative.
    let s = snapshot_with_repayment(
        "1000000",
        RepaymentSnapshot {
            offtaker_received: dec("0"),
            senior_principal_repaid: dec("0"),
            senior_interest: dec("0"),
            equity_distributed: dec("0"),
            mgmt_fee: dec("15000"),
            perf_fee: dec("0"),
            oet_alloc: dec("0"),
        },
        1200,
    );
    let amount = dec("1000000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(100, 2000, 50), &[])
        .ok()
        .unwrap();

    assert_eq!(b.management_fee, dec("0"));
}

// ── build_response ───────────────────────────────────────────────────────────

#[test]
fn response_maps_the_four_components() {
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1125000");
    let f = fees(100, 2000, 50);
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &f, &[])
        .ok()
        .unwrap();
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
