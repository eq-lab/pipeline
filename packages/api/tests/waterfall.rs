//! Compute-layer tests for the per-loan repayment waterfall API: exercise the pure
//! `compute_waterfall` / `build_response` directly against fixture snapshots — no
//! HTTP/DB layer.
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests — no
//! `DATABASE_URL` / Postgres connection.

use bigdecimal::BigDecimal;

use pipeline_api::error::ApiError;

use pipeline_api::routes::waterfall::{
    build_response, compute_waterfall, fit_interest_to_fee_cap, WaterfallDoc, ASSUMED_MAX_FEE_BPS,
};
use shared::contract_logs_repo::LoanRateEventRow;
use shared::loan_fee_schedule_repo::FeeScheduleRow;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};
use utoipa::OpenApi;

// ── Fixtures ───────────────────────────────────────────────────────────────────

fn dec(s: &str) -> BigDecimal {
    s.parse().unwrap()
}

const ORIGINATION: i64 = 1_700_000_000;
const CONTRACT_YEAR: i64 = 31_557_600;
const ONE_YEAR_LATER: i64 = ORIGINATION + CONTRACT_YEAR;

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
        // Comfortably above every `amount` used in this file's existing fixtures (which
        // cover principal + interest + fees, so a realistic offtaker price must exceed the
        // tranche alone) — dedicated tests below override this to exercise the offtaker
        // ceiling itself.
        original_offtaker_price: dec("100000000"),
        senior_interest_rate_bps: rate_bps,
        origination_date: ORIGINATION,
        original_maturity_date: ONE_YEAR_LATER,
        next_economics_epochs_id: dec("1"),
        next_repayment_id: dec("1"),
        status: "Performing".to_owned(),
        current_maturity_timestamp: ONE_YEAR_LATER,
        current_rate: rate_bps,
        closure_reason: String::new(),
        carved_out: false,
        disbursed: dec(senior_tranche),
        repaid: repayment.senior_principal_repaid.clone(),
        written_down: dec("0"),
        interest_adjustment: dec("0"),
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

fn rate_event(
    name: &str,
    ts: i64,
    outstanding: Option<&str>,
    new_rate: Option<i64>,
) -> LoanRateEventRow {
    LoanRateEventRow {
        loan_id: dec("1"),
        event_name: name.to_owned(),
        block_timestamp: ts,
        outstanding: outstanding.map(dec),
        new_rate,
    }
}

fn genesis(s: &LoanSnapshot) -> Vec<LoanRateEventRow> {
    vec![rate_event(
        "Disbursed",
        ORIGINATION,
        Some(&s.outstanding_senior_principal().to_plain_string()),
        None,
    )]
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
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
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
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
    .unwrap();

    assert_eq!(b.senior_principal_returned, dec("600000"));
}

#[test]
fn coupon_and_fees_paid_in_full_before_principal_on_shortfall() {
    // Full waterfall targets (senior 1,000,000 @ 12% for 1 year, fees 100/2000/50 bps):
    // coupon 88,000, mgmt fee 10,000, perf fee 22,000, oet 5,000, principal 1,000,000.
    // Priority order is the interest tier (coupon+mgmt+perf) → oet → principal, so a
    // 500,000 payment — enough to cover the interest tier + oet (125,000) but not full
    // principal — fully satisfies the interest tier (no proportional shortfall here, it's
    // not short against *that* tier) and every fee bucket, leaving principal to absorb the
    // shortfall: 500,000 − 125,000 = 375,000.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("500000");
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
    .unwrap();

    assert_eq!(b.senior_coupon_net, dec("88000"));
    assert_eq!(b.management_fee, dec("10000"));
    assert_eq!(b.performance_fee, dec("22000"));
    assert_eq!(b.oet_allocation, dec("5000"));
    assert_eq!(b.senior_principal_returned, dec("375000"));
}

// ── Interest tier: proportional split on a genuine shortfall ───────────────────

#[test]
fn interest_tier_shortfall_splits_coupon_and_fees_proportionally() {
    // Full-year targets: coupon 88,000, mgmt 10,000, perf 22,000 (interest tier total
    // 120,000). A 60,000 payment — exactly half the tier — must give every component
    // its own 50% share, not pay coupon in full and leave the fees at 0: coupon 44,000,
    // mgmt 5,000, perf 11,000 (each exactly half its full target). Nothing is left for
    // OET/principal/equity.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("60000");
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
    .unwrap();

    assert_eq!(b.senior_coupon_net, dec("44000"));
    assert_eq!(b.management_fee, dec("5000"));
    assert_eq!(b.performance_fee, dec("11000"));
    assert_eq!(b.oet_allocation, dec("0"));
    assert_eq!(b.senior_principal_returned, dec("0"));
    assert_eq!(b.equity_distributed, dec("0"));

    let total = &b.senior_coupon_net + &b.management_fee + &b.performance_fee;
    assert_eq!(total, amount);
}

#[test]
fn interest_tier_shortfall_dust_goes_to_the_coupon_not_lost() {
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("61");
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
    .unwrap();

    assert_eq!(b.senior_coupon_net, dec("45"));
    assert_eq!(b.management_fee, dec("5"));
    assert_eq!(b.performance_fee, dec("11"));
    assert_eq!(b.oet_allocation, dec("0"));

    let total = &b.senior_coupon_net + &b.management_fee + &b.performance_fee + &b.oet_allocation;
    assert_eq!(total, amount);
}

#[test]
fn principal_shrinks_last_when_amount_falls_short() {
    // Same full-year targets as above. A 1,050,000 payment covers coupon + all fees in
    // full (125,000) and leaves 925,000 for principal — short of the full 1,000,000
    // outstanding by 75,000. Principal is dead-last in the cascade, so it's the one that
    // shrinks, not any of the higher-priority buckets.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1050000");
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
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
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
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
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
    .unwrap();

    assert_eq!(b.senior_principal_returned, dec("375000"));
}

#[test]
fn zero_fee_schedule_routes_all_interest_to_coupon() {
    // With a zero fee schedule every fee carve-out is zero and the full gross interest
    // (120,000) flows to the net senior coupon.
    let s = snapshot("1000000", "0", 1200);
    let amount = dec("1120000");
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &fees(0, 0, 0), &genesis(&s)).unwrap();

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
    let b =
        compute_waterfall(&s, &amount, ORIGINATION, &fees(100, 2000, 50), &genesis(&s)).unwrap();

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
        &genesis(&s),
    );
    assert!(err.is_err(), "as_of before origination must be a 400");
}

// ── Second+ repayment: netting out amounts already recorded ────────────────────

#[test]
fn second_repayment_nets_out_amounts_already_recorded() {
    // `senior_deployed` is the *outstanding* balance (1,000,000 − 300,000 already repaid
    // = 700,000 — see the `senior_deployed` binding in `compute_waterfall`), not the full
    // original tranche, so this second repayment's full-year targets are recomputed off
    // 700,000: gross interest 700,000×12% = 84,000; mgmt 700,000×1% = 7,000; perf
    // 20%×(84,000−7,000) = 15,400; coupon 84,000−7,000−15,400 = 61,600; oet
    // 700,000×0.5% = 3,500. Netting out what a first repayment already recorded
    // (4,000 mgmt, 8,000 perf, 30,000 coupon, 2,000 oet) leaves: mgmt 3,000, perf 7,400,
    // coupon 31,600, oet 1,500 still due — plus the 700,000 outstanding principal itself
    // (unaffected by the `senior_deployed` change: it's always
    // `original_senior_tranche − senior_principal_repaid` directly).
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
    // 700,000 outstanding principal + 3,000 + 31,600 + 7,400 + 1,500 = 743,500: a full
    // payment of everything still owed, so no cascade shortfall shrinks any bucket.
    let amount = dec("743500");
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
    .unwrap();

    assert_eq!(b.senior_principal_returned, dec("700000"));
    assert_eq!(b.management_fee, dec("3000"));
    assert_eq!(b.senior_coupon_net, dec("31600"));
    assert_eq!(b.performance_fee, dec("7400"));
    assert_eq!(b.oet_allocation, dec("1500"));
    assert_eq!(b.equity_distributed, dec("0"));
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
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
    .unwrap();

    assert_eq!(b.management_fee, dec("0"));
}

// ── Equity residual (stage 4) ───────────────────────────────────────────────────

#[test]
fn equity_absorbs_the_remainder_after_principal() {
    // Same full-year targets as `full_repayment_one_year_with_fees` (coupon 88,000, fees
    // 37,000, principal 1,000,000 — 1,125,000 total). A 1,200,000 payment covers all of
    // that with 75,000 left over, which lands entirely in `equity_distributed`, last and
    // uncapped in the cascade.
    let s = LoanSnapshot {
        original_offtaker_price: dec("1300000"),
        ..snapshot("1000000", "0", 1200)
    };
    let amount = dec("1200000");
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
    .unwrap();

    assert_eq!(b.senior_principal_returned, dec("1000000"));
    assert_eq!(b.equity_distributed, dec("75000"));
    assert!(b.senior_principal_fully_repaid);
    // Offtaker price is 1,300,000; only 1,200,000 has been received so far.
    assert!(!b.offtaker_fully_received);

    // Full accounting: every base unit of `amount` is attributed to exactly one bucket.
    let total = &b.senior_principal_returned
        + &b.senior_coupon_net
        + &b.management_fee
        + &b.performance_fee
        + &b.oet_allocation
        + &b.equity_distributed;
    assert_eq!(total, amount);
}

#[test]
fn equity_is_zero_when_amount_exactly_covers_every_other_bucket() {
    let s = LoanSnapshot {
        original_offtaker_price: dec("1125000"),
        ..snapshot("1000000", "0", 1200)
    };
    let amount = dec("1125000");
    let b = compute_waterfall(
        &s,
        &amount,
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    )
    .unwrap();

    assert_eq!(b.equity_distributed, dec("0"));
    assert!(b.senior_principal_fully_repaid);
    assert!(b.offtaker_fully_received);
}

// ── Offtaker ceiling (stage 3) ───────────────────────────────────────────────────

#[test]
fn amount_exceeding_outstanding_offtaker_is_rejected() {
    // `original_offtaker_price` (1,000,000) is fixed and never rewritten — an `amount`
    // that would push cumulative `offtaker_received` past it (here, the same 1,125,000
    // that a *higher*-priced loan happily absorbs in the test above) must be rejected,
    // not silently cascaded into an inflated `equity_distributed`.
    let s = LoanSnapshot {
        original_offtaker_price: dec("1000000"),
        ..snapshot("1000000", "0", 1200)
    };
    let err = compute_waterfall(
        &s,
        &dec("1125000"),
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(&s),
    );
    assert!(
        err.is_err(),
        "amount beyond the offtaker ceiling must be a 400"
    );
}

#[test]
fn offtaker_ceiling_accounts_for_amounts_already_received() {
    // A prior repayment already recorded 900,000 of the 1,000,000 offtaker price — only
    // 100,000 of headroom remains. A 100,001 request must be rejected even though it's
    // far below the genesis price itself.
    let s = LoanSnapshot {
        original_offtaker_price: dec("1000000"),
        ..snapshot_with_repayment(
            "1000000",
            RepaymentSnapshot {
                offtaker_received: dec("900000"),
                senior_principal_repaid: dec("900000"),
                senior_interest: dec("0"),
                equity_distributed: dec("0"),
                mgmt_fee: dec("0"),
                perf_fee: dec("0"),
                oet_alloc: dec("0"),
            },
            1200,
        )
    };
    let over = compute_waterfall(
        &s,
        &dec("100001"),
        ONE_YEAR_LATER,
        &fees(0, 0, 0),
        &genesis(&s),
    );
    assert!(
        matches!(&over, Err(ApiError::BadRequest(m)) if m.contains("exceeds the loan's outstanding offtaker balance"))
    );
    // Exactly the remaining headroom is fine.
    assert!(compute_waterfall(
        &s,
        &dec("100000"),
        ONE_YEAR_LATER,
        &fees(0, 0, 0),
        &genesis(&s)
    )
    .is_ok());
}

#[test]
fn already_over_received_loan_rejects_every_further_amount_including_zero() {
    // A loan whose `offtaker_received` (5,081) already exceeds `original_offtaker_price`
    // (105) — the exact shape of loan 9's bogus test repayment. `outstanding_offtaker` is
    // deliberately not clamped at 0 here: it goes negative, so the loan stays visibly
    // broken (every waterfall call for it fails loudly) instead of quietly reporting
    // "nothing outstanding," which would look identical to a healthy, fully-repaid loan.
    let s = LoanSnapshot {
        original_offtaker_price: dec("105"),
        ..snapshot_with_repayment(
            "80",
            RepaymentSnapshot {
                offtaker_received: dec("5081"),
                senior_principal_repaid: dec("79.982247"),
                senior_interest: dec("0"),
                equity_distributed: dec("5000.98"),
                mgmt_fee: dec("0"),
                perf_fee: dec("0"),
                oet_alloc: dec("0"),
            },
            1200,
        )
    };
    assert!(
        compute_waterfall(&s, &dec("0"), ONE_YEAR_LATER, &fees(0, 0, 0), &[]).is_err(),
        "even a zero-amount request against an already over-received loan must be rejected"
    );
    assert!(
        compute_waterfall(&s, &dec("1"), ONE_YEAR_LATER, &fees(0, 0, 0), &genesis(&s)).is_err()
    );
}

// ── Quotational settlements (issue #2123) ────────────────────────────────────────

fn qp_snapshot() -> LoanSnapshot {
    LoanSnapshot {
        original_offtaker_price: dec("13372557"),
        ..snapshot_with_repayment(
            "1000000",
            RepaymentSnapshot {
                offtaker_received: dec("12275866"),
                senior_principal_repaid: dec("1000000"),
                senior_interest: dec("0"),
                equity_distributed: dec("0"),
                mgmt_fee: dec("0"),
                perf_fee: dec("0"),
                oet_alloc: dec("0"),
            },
            1200,
        )
    }
}

#[test]
fn qp_repriced_settlement_above_offtaker_price_is_rejected() {
    let s = qp_snapshot();
    let over = compute_waterfall(
        &s,
        &dec("1764807"),
        ORIGINATION,
        &fees(0, 0, 0),
        &genesis(&s),
    );
    assert!(
        matches!(&over, Err(ApiError::BadRequest(m)) if m.contains("exceeds the loan's outstanding offtaker balance"))
    );

    let b = compute_waterfall(
        &s,
        &dec("1096691"),
        ORIGINATION,
        &fees(0, 0, 0),
        &genesis(&s),
    )
    .unwrap();
    assert!(b.offtaker_fully_received);
    assert_eq!(b.senior_principal_returned, dec("0"));
    assert_eq!(b.equity_distributed, dec("1096691"));
}

#[test]
fn fractional_amount_is_rounded_down_before_the_offtaker_ceiling() {
    let s = LoanSnapshot {
        original_offtaker_price: dec("1000000"),
        ..snapshot("1000000", "0", 1200)
    };
    let b = compute_waterfall(
        &s,
        &dec("1000000.9"),
        ORIGINATION,
        &fees(0, 0, 0),
        &genesis(&s),
    )
    .unwrap();
    assert_eq!(b.senior_principal_returned, dec("1000000"));
    assert_eq!(b.equity_distributed, dec("0"));
    assert!(b.offtaker_fully_received);

    let short = compute_waterfall(
        &s,
        &dec("999999.9"),
        ORIGINATION,
        &fees(0, 0, 0),
        &genesis(&s),
    )
    .unwrap();
    assert!(!short.offtaker_fully_received);

    assert!(compute_waterfall(
        &s,
        &dec("1000001"),
        ORIGINATION,
        &fees(0, 0, 0),
        &genesis(&s)
    )
    .is_err());
}

fn default_snapshot(offtaker_price: &str) -> LoanSnapshot {
    LoanSnapshot {
        original_offtaker_price: dec(offtaker_price),
        status: "Default".to_owned(),
        ..snapshot("1000000", "0", 1200)
    }
}

#[test]
fn default_loan_rejects_amount_above_offtaker_price() {
    let s = default_snapshot("500000");
    let over = compute_waterfall(
        &s,
        &dec("600000"),
        ONE_YEAR_LATER,
        &fees(0, 0, 0),
        &genesis(&s),
    );
    assert!(
        matches!(&over, Err(ApiError::BadRequest(m)) if m.contains("outstanding offtaker balance"))
    );
}

#[test]
fn default_loan_accepts_amount_equal_to_outstanding_offtaker() {
    let s = default_snapshot("500000");
    let b = compute_waterfall(
        &s,
        &dec("500000"),
        ONE_YEAR_LATER,
        &fees(0, 0, 0),
        &genesis(&s),
    )
    .unwrap();
    assert_eq!(b.senior_principal_returned, dec("500000"));
    assert!(b.offtaker_fully_received);
}

#[test]
fn default_loan_offtaker_ceiling_wins_over_headroom_rejection() {
    let s = default_snapshot("500000");
    let over = compute_waterfall(
        &s,
        &dec("5000000"),
        ONE_YEAR_LATER,
        &fees(0, 0, 0),
        &genesis(&s),
    );
    assert!(
        matches!(&over, Err(ApiError::BadRequest(m)) if m.contains("outstanding offtaker balance"))
    );
}

// ── Senior principal ceiling ─────────────────────────────────────────────────────

#[test]
fn principal_ceiling_holds_even_against_a_wildly_oversized_amount() {
    // 900,000 of the 1,000,000 tranche already repaid → 100,000 outstanding. A payment of
    // 5,000,000 (comparable in spirit to loan 9's mismatched real-world figures) must
    // still cap principal at exactly the 100,000 remaining — never a cent more — with the
    // entire 4,900,000 overage flowing to equity, not to over-repaying the tranche.
    let s = LoanSnapshot {
        original_offtaker_price: dec("10000000"),
        ..snapshot("1000000", "900000", 1200)
    };
    let amount = dec("5000000");
    // At origination: zero interest/fees, isolating principal-only behavior.
    let b = compute_waterfall(&s, &amount, ORIGINATION, &fees(0, 0, 0), &genesis(&s)).unwrap();

    assert_eq!(b.senior_principal_returned, dec("100000"));
    assert_eq!(b.equity_distributed, dec("4900000"));
    assert!(b.senior_principal_fully_repaid);
}

// ── build_response ───────────────────────────────────────────────────────────

#[test]
fn response_maps_the_components() {
    let s = LoanSnapshot {
        original_offtaker_price: dec("1125000"),
        ..snapshot("1000000", "0", 1200)
    };
    let amount = dec("1125000");
    let f = fees(100, 2000, 50);
    let b = compute_waterfall(&s, &amount, ONE_YEAR_LATER, &f, &genesis(&s)).unwrap();
    let resp = build_response(99_000_001, &b);

    assert_eq!(resp.chain_id, 99_000_001);
    assert_eq!(resp.senior_principal_returned, "1000000");
    assert_eq!(resp.senior_coupon_net, "88000");
    assert_eq!(resp.management_fee, "10000");
    assert_eq!(resp.performance_fee, "22000");
    assert_eq!(resp.oet_allocation, "5000");
    assert_eq!(resp.equity_distributed, "0");
    assert!(resp.senior_principal_fully_repaid);
    assert!(resp.offtaker_fully_received);
    let json = serde_json::to_value(&resp).unwrap();
    assert!(json.get("offtaker_overpaid").is_none());
    assert!(json.get("offtaker_fully_received").is_some());
}

// ── OpenAPI ────────────────────────────────────────────────────────────────────

#[test]
fn openapi_doc_registers_path() {
    let doc = WaterfallDoc::openapi();
    let json = serde_json::to_string(&doc).unwrap();
    assert!(json.contains("/v1/loan-book/{loan_id}/waterfall"));
}

// ── Outstanding = disbursed − repaid − written_down; interest_adjustment ───────

fn run(s: &LoanSnapshot, amount: &str) -> pipeline_api::routes::waterfall::WaterfallBreakdown {
    compute_waterfall(
        s,
        &dec(amount),
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &genesis(s),
    )
    .unwrap()
}

#[test]
fn partly_disbursed_loan_accrues_and_caps_principal_on_disbursed() {
    let mut s = snapshot("1000000", "0", 1200);
    s.disbursed = dec("500000");
    let b = run(&s, "5000000");
    assert_eq!(b.management_fee, dec("5000"));
    assert_eq!(b.performance_fee, dec("11000"));
    assert_eq!(b.senior_coupon_net, dec("44000"));
    assert_eq!(b.oet_allocation, dec("2500"));
    assert_eq!(b.senior_principal_returned, dec("500000"));
    assert!(!b.senior_principal_fully_repaid);
}

#[test]
fn approved_loan_accrues_nothing_and_returns_no_principal() {
    let mut s = snapshot("1000000", "0", 1200);
    s.disbursed = dec("0");
    let b = run(&s, "1000000");
    assert_eq!(b.senior_coupon_net, dec("0"));
    assert_eq!(b.management_fee, dec("0"));
    assert_eq!(b.performance_fee, dec("0"));
    assert_eq!(b.oet_allocation, dec("0"));
    assert_eq!(b.senior_principal_returned, dec("0"));
    assert_eq!(b.equity_distributed, dec("1000000"));
}

#[test]
fn written_down_amount_is_excluded_from_principal_cap_and_accrual_base() {
    let mut s = snapshot("1000000", "0", 1200);
    s.written_down = dec("400000");
    let b = run(&s, "5000000");
    assert_eq!(
        b.senior_coupon_net + &b.management_fee + &b.performance_fee,
        dec("72000")
    );
    assert_eq!(b.senior_principal_returned, dec("600000"));
}

#[test]
fn undisbursed_amount_is_excluded() {
    let mut s = snapshot("1000000", "0", 1200);
    s.disbursed = dec("700000");
    let b = run(&s, "5000000");
    assert_eq!(b.senior_principal_returned, dec("700000"));
    assert_eq!(b.management_fee, dec("7000"));
}

#[test]
fn interest_waiver_reduces_coupon_and_performance_fee_not_management_fee() {
    let mut s = snapshot("1000000", "0", 1200);
    s.interest_adjustment = dec("-20000");
    let b = run(&s, "5000000");
    assert_eq!(b.management_fee, dec("10000"));
    assert_eq!(b.performance_fee, dec("18000"));
    assert_eq!(b.senior_coupon_net, dec("72000"));
    assert_eq!(b.oet_allocation, dec("5000"));
}

#[test]
fn positive_interest_adjustment_increases_gross() {
    let mut s = snapshot("1000000", "0", 1200);
    s.interest_adjustment = dec("10000");
    let b = run(&s, "5000000");
    assert_eq!(b.management_fee, dec("10000"));
    assert_eq!(b.performance_fee, dec("24000"));
    assert_eq!(b.senior_coupon_net, dec("96000"));
}

#[test]
fn waiver_exceeding_gross_clamps_gross_at_zero() {
    let mut s = snapshot("1000000", "0", 1200);
    s.interest_adjustment = dec("-150000");
    let b = run(&s, "5000000");
    assert_eq!(b.senior_coupon_net, dec("0"));
    assert_eq!(b.performance_fee, dec("0"));
    assert_eq!(b.management_fee, dec("0"));
    assert_eq!(b.oet_allocation, dec("0"));
    assert_eq!(b.equity_distributed, dec("4000000"));
}

#[test]
fn undrawn_approved_loan_is_not_fully_repaid() {
    let mut s = snapshot("1000000", "0", 1200);
    s.disbursed = dec("0");
    assert!(!run(&s, "1000000").senior_principal_fully_repaid);
}

#[test]
fn fully_drawn_and_repaid_loan_is_fully_repaid() {
    let s = snapshot("1000000", "0", 1200);
    assert!(run(&s, "5000000").senior_principal_fully_repaid);
}

#[test]
fn fully_drawn_loan_with_principal_left_is_not_fully_repaid() {
    let s = snapshot("1000000", "0", 1200);
    assert!(!run(&s, "100000").senior_principal_fully_repaid);
}

fn assert_within_fee_cap(b: &pipeline_api::routes::waterfall::WaterfallBreakdown) {
    let cap = (&b.senior_coupon_net + &b.management_fee + &b.performance_fee)
        * BigDecimal::from(ASSUMED_MAX_FEE_BPS)
        / BigDecimal::from(10_000);
    let fees = &b.management_fee + &b.performance_fee + &b.oet_allocation;
    assert!(fees <= cap.with_scale_round(0, bigdecimal::RoundingMode::Down));
}

#[test]
fn standard_schedule_is_untouched_by_the_fee_cap() {
    let s = snapshot("1000000", "0", 1200);
    let b = run(&s, "5000000");
    assert_eq!(b.management_fee, dec("10000"));
    assert_eq!(b.performance_fee, dec("22000"));
    assert_eq!(b.oet_allocation, dec("5000"));
    assert_within_fee_cap(&b);
}

#[test]
fn heavy_waiver_shifts_capped_fees_to_the_coupon() {
    let mut s = snapshot("1000000", "0", 1200);
    s.interest_adjustment = dec("-100000");
    let b = run(&s, "5000000");
    assert_eq!(b.senior_coupon_net, dec("10000"));
    assert_eq!(b.management_fee, dec("8334"));
    assert_eq!(b.performance_fee, dec("1666"));
    assert_eq!(b.oet_allocation, dec("0"));
    assert_eq!(b.senior_principal_returned, dec("1000000"));
    assert_eq!(b.equity_distributed, dec("3980000"));
    assert_within_fee_cap(&b);
    let total = &b.senior_principal_returned
        + &b.senior_coupon_net
        + &b.management_fee
        + &b.performance_fee
        + &b.oet_allocation
        + &b.equity_distributed;
    assert_eq!(total, dec("5000000"));
}

#[test]
fn oet_is_trimmed_to_the_room_left_under_the_cap() {
    let mut s = snapshot("1000000", "0", 1200);
    s.interest_adjustment = dec("-60000");
    let b = run(&s, "5000000");
    assert_eq!(b.management_fee, dec("10000"));
    assert_eq!(b.performance_fee, dec("10000"));
    assert_eq!(b.senior_coupon_net, dec("40000"));
    assert_eq!(b.oet_allocation, dec("5000"));
    assert_within_fee_cap(&b);
}

#[test]
fn interest_adjustment_is_cumulative_against_recorded_interest() {
    let mut s = snapshot_with_repayment(
        "1000000",
        RepaymentSnapshot {
            offtaker_received: dec("0"),
            senior_principal_repaid: dec("0"),
            senior_interest: dec("50000"),
            equity_distributed: dec("0"),
            mgmt_fee: dec("0"),
            perf_fee: dec("0"),
            oet_alloc: dec("0"),
        },
        1200,
    );
    s.interest_adjustment = dec("-20000");
    let b = run(&s, "5000000");
    assert_eq!(b.senior_coupon_net, dec("25000"));
    assert_eq!(b.management_fee, dec("8929"));
    assert_eq!(b.performance_fee, dec("16071"));
}

#[test]
fn stellar_raw_scale_interest_adjustment_is_not_normalised() {
    let mut s = snapshot("10000000", "0", 1200);
    s.interest_adjustment = dec("-200000");
    let b = run(&s, "50000000");
    assert_eq!(b.management_fee, dec("100000"));
    assert_eq!(b.performance_fee, dec("180000"));
    assert_eq!(b.senior_coupon_net, dec("720000"));
    assert_eq!(b.oet_allocation, dec("50000"));
}

fn run_with(
    s: &LoanSnapshot,
    amount: &str,
    as_of: i64,
) -> pipeline_api::routes::waterfall::WaterfallBreakdown {
    compute_waterfall(
        s,
        &dec(amount),
        as_of,
        &fees(300, 2000, 0),
        &genesis(s),
    )
    .unwrap()
}

fn recorded(senior_interest: &str, mgmt: &str, perf: &str) -> RepaymentSnapshot {
    RepaymentSnapshot {
        offtaker_received: dec("0"),
        senior_principal_repaid: dec("0"),
        senior_interest: dec(senior_interest),
        equity_distributed: dec("0"),
        mgmt_fee: dec(mgmt),
        perf_fee: dec(perf),
        oet_alloc: dec("0"),
    }
}

#[test]
fn fee_cap_issue_2124_example_pays_all_headroom_as_interest() {
    let s = snapshot("1000000", "0", 500);
    let b = run_with(&s, "50000", ONE_YEAR_LATER);
    assert_eq!(b.senior_coupon_net, dec("25000"));
    assert_eq!(b.management_fee, dec("22059"));
    assert_eq!(b.performance_fee, dec("2941"));
    assert_eq!(&b.management_fee + &b.performance_fee, dec("25000"));
    assert_eq!(b.oet_allocation, dec("0"));
    assert_eq!(b.senior_principal_returned, dec("0"));
    assert_eq!(b.equity_distributed, dec("0"));
    assert_within_fee_cap(&b);
}

#[test]
fn fee_cap_issue_2124_full_repayment_leaks_nothing_to_principal_or_equity() {
    let s = snapshot("1000000", "0", 500);
    let b = run_with(&s, "1050000", ONE_YEAR_LATER);
    assert_eq!(b.senior_coupon_net, dec("25000"));
    assert_eq!(b.management_fee, dec("22059"));
    assert_eq!(b.performance_fee, dec("2941"));
    assert_eq!(b.senior_principal_returned, dec("1000000"));
    assert_eq!(b.equity_distributed, dec("0"));
    assert!(b.senior_principal_fully_repaid);
    assert_within_fee_cap(&b);
}

#[test]
fn fee_cap_shortfall_pays_the_whole_amount_as_interest() {
    let s = snapshot("1000000", "0", 500);
    let b = run_with(&s, "30000", ONE_YEAR_LATER);
    assert_eq!(b.senior_coupon_net, dec("15000"));
    assert_eq!(b.management_fee, dec("13236"));
    assert_eq!(b.performance_fee, dec("1764"));
    assert_eq!(b.senior_principal_returned, dec("0"));
    assert_within_fee_cap(&b);
}

#[test]
fn fee_cap_next_call_after_a_leaked_payment_still_proposes_interest() {
    let s = snapshot_with_repayment("1000000", recorded("16000", "14117", "1882"), 500);
    let b = run_with(&s, "100000", ONE_YEAR_LATER);
    assert_eq!(b.senior_coupon_net, dec("9001"));
    assert_eq!(b.management_fee, dec("7942"));
    assert_eq!(b.performance_fee, dec("1058"));
    assert_eq!(b.oet_allocation, dec("0"));
    assert_eq!(b.senior_principal_returned, dec("81999"));
    assert_within_fee_cap(&b);
}

#[test]
fn fee_cap_second_year_pays_the_new_headroom_as_interest() {
    let s = snapshot_with_repayment("1000000", recorded("25000", "22059", "2941"), 500);
    let b = run_with(&s, "50000", ORIGINATION + 2 * CONTRACT_YEAR);
    assert_eq!(b.senior_coupon_net, dec("25000"));
    assert_eq!(b.management_fee, dec("22059"));
    assert_eq!(b.performance_fee, dec("2941"));
    assert_within_fee_cap(&b);
}

#[test]
fn fee_cap_rounding_leftover_goes_to_the_coupon_not_principal() {
    let s = snapshot("1000000", "0", 500);
    let b = run_with(&s, "30001", ONE_YEAR_LATER);
    assert_eq!(b.senior_principal_returned, dec("0"));
    assert_eq!(
        &b.senior_coupon_net + &b.management_fee + &b.performance_fee,
        dec("30001")
    );
    assert_within_fee_cap(&b);
}

#[test]
fn fee_cap_third_year_headroom_scaling_leaves_no_dust_for_principal() {
    let s = snapshot_with_repayment("1000000", recorded("50000", "44118", "5882"), 500);
    let b = run_with(&s, "50000", ORIGINATION + 3 * CONTRACT_YEAR);
    assert_eq!(b.senior_principal_returned, dec("0"));
    assert_eq!(
        &b.senior_coupon_net + &b.management_fee + &b.performance_fee,
        dec("50000")
    );
    assert_within_fee_cap(&b);
}

#[test]
fn fee_cap_binds_at_stellar_raw_scale() {
    let mut s = snapshot("10000000000000", "0", 500);
    s.original_offtaker_price = dec("100000000000000");
    let b = run_with(&s, "500000000000", ONE_YEAR_LATER);
    assert_eq!(b.senior_coupon_net, dec("250000000000"));
    assert_eq!(b.management_fee, dec("220588235295"));
    assert_eq!(b.performance_fee, dec("29411764705"));
    assert_eq!(b.senior_principal_returned, dec("0"));
    assert_within_fee_cap(&b);
}

fn fit(c: &str, m: &str, p: &str, bps: u32) -> (BigDecimal, BigDecimal, BigDecimal) {
    let out = fit_interest_to_fee_cap(dec(c), dec(m), dec(p), bps);
    let total = dec(c) + dec(m) + dec(p);
    assert_eq!(&out.0 + &out.1 + &out.2, total);
    assert!(out.1 <= dec(m));
    assert!(out.2 <= dec(p));
    let cap = (&total * BigDecimal::from(bps) / BigDecimal::from(10_000))
        .with_scale_round(0, bigdecimal::RoundingMode::Down);
    assert!(&out.1 + &out.2 <= cap || bps >= 10_000);
    out
}

fn triple(c: &str, m: &str, p: &str) -> (BigDecimal, BigDecimal, BigDecimal) {
    (dec(c), dec(m), dec(p))
}

#[test]
fn fit_to_fee_cap_at_5000_bps() {
    assert_eq!(
        fit("16000", "30000", "4000", 5000),
        triple("25000", "22059", "2941")
    );
}

#[test]
fn fit_to_fee_cap_at_2000_bps() {
    assert_eq!(
        fit("16000", "30000", "4000", 2000),
        triple("40000", "8824", "1176")
    );
}

#[test]
fn fit_to_fee_cap_at_0_bps_moves_all_fees_to_the_coupon() {
    assert_eq!(fit("16000", "30000", "4000", 0), triple("50000", "0", "0"));
}

#[test]
fn fit_to_fee_cap_at_10000_bps_is_unchanged() {
    assert_eq!(
        fit("16000", "30000", "4000", 10000),
        triple("16000", "30000", "4000")
    );
}

#[test]
fn fit_to_fee_cap_not_binding_is_unchanged() {
    assert_eq!(
        fit("88000", "10000", "22000", 5000),
        triple("88000", "10000", "22000")
    );
}

#[test]
fn fit_to_fee_cap_odd_total_floors_the_cap() {
    assert_eq!(
        fit("16001", "30000", "4000", 5000),
        triple("25001", "22059", "2941")
    );
}

#[test]
fn fit_to_fee_cap_zero_fees_is_unchanged() {
    assert_eq!(fit("500", "0", "0", 5000), triple("500", "0", "0"));
}
