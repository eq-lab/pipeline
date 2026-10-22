//! Compute-layer tests for the loan-book API: exercise `compute_loan_book`
//! directly against fixture loans + lifecycle events, no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`).

use std::collections::HashMap;

use bigdecimal::BigDecimal;

use pipeline_api::routes::loan_book::{
    compute_loan_book, display_status, loan_ref, LoanBookResponse, LoanRef, LoanSpot,
};
use shared::contract_logs_repo::{LifecycleRow, LoanSnapshotRow};
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

/// Build a `loan_id → collateral (micro-USDC)` map keyed the same way the handler
/// does, so compute-layer tests can supply collateral without the DB.
fn collateral_map(entries: &[(i64, BigDecimal)]) -> HashMap<LoanRef, BigDecimal> {
    entries
        .iter()
        .cloned()
        .map(|(id, micro)| (loan_ref(1, &BigDecimal::from(id)), micro))
        .collect()
}

fn zero_repayment() -> RepaymentSnapshot {
    RepaymentSnapshot {
        offtaker_received: BigDecimal::from(0_i64),
        senior_principal_repaid: BigDecimal::from(0_i64),
        senior_interest: BigDecimal::from(0_i64),
        equity_distributed: BigDecimal::from(0_i64),
        mgmt_fee: BigDecimal::from(0_i64),
        perf_fee: BigDecimal::from(0_i64),
        oet_alloc: BigDecimal::from(0_i64),
    }
}

#[allow(clippy::too_many_arguments)]
fn make_loan(
    loan_id: i64,
    senior_k: i64,
    equity_k: i64,
    rate_bps: u32,
    start_day: i64,
    end_day: i64,
    originator: &str,
    commodity: &str,
    protection: &str,
) -> LoanSnapshotRow {
    LoanSnapshotRow {
        chain_id: 1,
        loan_id: BigDecimal::from(loan_id),
        block_number: 0,
        log_index: 0,
        event_name: "LoanDrawn".to_owned(),
        block_timestamp: 0,
        snapshot: LoanSnapshot {
            originator: originator.to_owned(),
            borrower_id: format!("borrower-{loan_id}"),
            commodity: commodity.to_owned(),
            corridor: "cr".to_owned(),
            governing_law: "EN".to_owned(),
            protection: protection.to_owned(),
            metadata_uri: None,
            documents: Vec::new(),
            // `*_k` args are in thousands of USDC.
            original_facility_size: usdc((senior_k + equity_k) * 1_000),
            original_senior_tranche: usdc(senior_k * 1_000),
            original_equity_tranche: usdc(equity_k * 1_000),
            original_offtaker_price: BigDecimal::from(0_i64),
            senior_interest_rate_bps: rate_bps,
            origination_date: start_day * DAY,
            original_maturity_date: end_day * DAY,
            next_economics_epochs_id: BigDecimal::from(1_i64),
            next_repayment_id: BigDecimal::from(0_i64),
            status: "Performing".to_owned(),
            // Rollover-aware maturity defaults to the original maturity (no rollover).
            current_maturity_timestamp: end_day * DAY,
            current_rate: rate_bps,
            closure_reason: "None".to_owned(),
            carved_out: false,
            disbursed: usdc(senior_k * 1_000),
            repaid: BigDecimal::from(0_i64),
            written_down: BigDecimal::from(0_i64),
            interest_adjustment: BigDecimal::from(0_i64),
            metadata_uri_onchain: String::new(),
            repayment: zero_repayment(),
        },
    }
}

/// Loan A: senior 80k + equity 20k = 100k @ 12% (1200 bps), day 0–180.
/// Loan B: senior 40k + equity 10k =  50k @ 15% (1500 bps), day 30–120.
fn fixture_loans() -> Vec<LoanSnapshotRow> {
    vec![
        make_loan(
            1,
            80,
            20,
            1200,
            0,
            180,
            "Open Mineral",
            "Copper Concentrate",
            "LC at sight",
        ),
        make_loan(2, 40, 10, 1500, 30, 120, "Trafalgar", "Alumina", ""),
    ]
}

/// Disbursement map marking every loan's off-ramp complete, so the displayed status
/// reflects the raw on-chain status (Performing / WatchList) plus the Past Due
/// override — not Disbursing. Tests exercising the Disbursing override pass their own
/// map instead.
fn all_complete(loans: &[LoanSnapshotRow]) -> HashMap<LoanRef, bool> {
    loans
        .iter()
        .map(|l| (loan_ref(l.chain_id, &l.loan_id), true))
        .collect()
}

fn at(t_day: i64, loans: &[LoanSnapshotRow], events: &[LifecycleRow]) -> LoanBookResponse {
    compute_loan_book(
        loans,
        events,
        t_day * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &all_complete(loans),
        &HashMap::new(),
    )
}

/// Like `at`, but with a per-loan collateral map.
fn at_with(
    t_day: i64,
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    collateral: &HashMap<LoanRef, BigDecimal>,
) -> LoanBookResponse {
    compute_loan_book(
        loans,
        events,
        t_day * DAY,
        collateral,
        &HashMap::new(),
        &all_complete(loans),
        &HashMap::new(),
    )
}

/// Like `at`, but with a per-loan spot-price map.
fn at_with_spot(
    t_day: i64,
    loans: &[LoanSnapshotRow],
    spot: &HashMap<LoanRef, LoanSpot>,
) -> LoanBookResponse {
    compute_loan_book(
        loans,
        &[],
        t_day * DAY,
        &HashMap::new(),
        spot,
        &all_complete(loans),
        &HashMap::new(),
    )
}

/// Build a `loan_id → LoanSpot` map keyed like the handler.
fn spot_map(entries: &[(i64, Option<&str>, Option<&str>)]) -> HashMap<LoanRef, LoanSpot> {
    entries
        .iter()
        .map(|(id, price, change)| {
            (
                loan_ref(1, &BigDecimal::from(*id)),
                LoanSpot {
                    price: price.map(str::to_owned),
                    change_7d: change.map(str::to_owned),
                },
            )
        })
        .collect()
}

#[test]
fn principal_is_senior_plus_equity() {
    // At day 0 only loan A is active. principal = senior 80k + equity 20k = 100k.
    let r = at(0, &fixture_loans(), &[]);
    assert_eq!(r.loans.len(), 1);
    assert_eq!(r.loans[0].principal, "100000.000000");
    assert_eq!(r.summary.total_deployed, "100000.000000");
}

#[test]
fn total_deployed_sums_both_tranches_over_active_loans() {
    // Day 60: both active. 100k + 50k = 150k.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.loans.len(), 2);
    assert_eq!(r.summary.total_deployed, "150000.000000");
}

#[test]
fn avg_yield_is_outstanding_weighted() {
    // Day 60: (100k·1200 + 50k·1500) / 150k = 1300 bps → 0.13.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.summary.avg_yield.as_deref(), Some("0.130000"));
}

#[test]
fn avg_duration_is_outstanding_weighted() {
    // Day 60: terms A=180d, B=90d. (100k·180 + 50k·90) / 150k = 150.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.summary.avg_duration_days, Some(150));
}

#[test]
fn weighted_rate_and_tenor_mirror_avg_fields() {
    // The Trustee-facing weighted_rate / weighted_tenor_days carry the same
    // outstanding-weighted values as avg_yield / avg_duration_days.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.summary.weighted_rate, r.summary.avg_yield);
    assert_eq!(r.summary.weighted_rate.as_deref(), Some("0.130000"));
    assert_eq!(r.summary.weighted_tenor_days, r.summary.avg_duration_days);
    assert_eq!(r.summary.weighted_tenor_days, Some(150));
}

#[test]
fn weighted_rate_and_tenor_null_when_no_active_loans() {
    // Both loans closed (past maturity alone no longer removes a loan — it becomes
    // Past Due and stays active; only close/default empties the active set). Both
    // still show up as terminal rows, just with no active loans to weight over.
    let loans: Vec<LoanSnapshotRow> = fixture_loans()
        .into_iter()
        .map(|l| with_status(l, "Closed"))
        .collect();
    let events = vec![event("LoanClosed", 1, 181), event("LoanClosed", 2, 121)];
    let r = at(500, &loans, &events);
    assert_eq!(r.loans.len(), 2);
    assert!(r.loans.iter().all(|e| e.status == "Closed"));
    assert_eq!(r.summary.weighted_rate, None);
    assert_eq!(r.summary.weighted_tenor_days, None);
}

#[test]
fn loans_sorted_by_principal_descending() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.loans[0].originator, "Open Mineral"); // 100k
    assert_eq!(r.loans[1].originator, "Trafalgar"); // 50k
}

#[test]
fn terminal_loans_sort_after_active_even_with_larger_principal() {
    // Loan 3 (Closed, 500k senior) dwarfs both active loans, but terminal rows always
    // sort after active rows — the two groups aren't merged into one principal sort.
    let mut loans = fixture_loans();
    loans.push(with_status(
        make_loan(3, 500, 0, 1000, 0, 200, "HugeCo", "Cocoa", ""),
        "Closed",
    ));
    let events = vec![event("LoanClosed", 3, 10)];

    let r = at(60, &loans, &events);
    assert_eq!(r.loans.len(), 3);
    assert_eq!(r.loans[0].originator, "Open Mineral"); // active, 100k
    assert_eq!(r.loans[1].originator, "Trafalgar"); // active, 50k
    assert_eq!(r.loans[2].originator, "HugeCo"); // terminal, 500k — still last
    assert_eq!(r.loans[2].status, "Closed");
}

#[test]
fn entry_carries_expected_fields() {
    let r = at(0, &fixture_loans(), &[]);
    let e = &r.loans[0];
    assert_eq!(e.chain_id, 1);
    assert_eq!(e.loan_id, "1");
    assert_eq!(e.originator, "Open Mineral");
    assert_eq!(e.borrower, "borrower-1");
    assert_eq!(e.commodity, "Copper Concentrate");
    assert_eq!(e.duration_days, 180);
    assert_eq!(e.rate, "0.120000");
    assert_eq!(e.status, "Performing");
}

#[test]
fn protection_maps_nonempty_to_some_and_empty_to_none() {
    // Loan A (Open Mineral) has protection "LC at sight"; loan B (Trafalgar) has "".
    let r = at(60, &fixture_loans(), &[]);
    let a = r
        .loans
        .iter()
        .find(|e| e.originator == "Open Mineral")
        .unwrap();
    let b = r
        .loans
        .iter()
        .find(|e| e.originator == "Trafalgar")
        .unwrap();
    assert_eq!(a.protection.as_deref(), Some("LC at sight"));
    assert_eq!(b.protection, None);
}

#[test]
fn matured_loan_stays_active_as_past_due() {
    // Day 150: A active (0–180) → Performing; B past maturity (ends day 120) but not
    // closed → stays in the book as `Past Due` (no longer excluded). Both count toward
    // the summary.
    let r = at(150, &fixture_loans(), &[]);
    assert_eq!(r.loans.len(), 2);
    let a = r.loans.iter().find(|e| e.loan_id == "1").unwrap();
    let b = r.loans.iter().find(|e| e.loan_id == "2").unwrap();
    assert_eq!(a.status, "Performing");
    assert_eq!(b.status, "Past Due");
    assert_eq!(r.summary.total_deployed, "150000.000000");
}

#[test]
fn closed_loan_visible_but_excluded_from_active_aggregates() {
    // LoanClosed for A at day 100 → effective_end = 100 (the close event).
    // At day 110: A closed (terminal, still visible), B still active (30–120).
    let mut loans = fixture_loans();
    loans[0] = with_status(loans[0].clone(), "Closed"); // A: Open Mineral
    let events = vec![LifecycleRow {
        chain_id: 1,
        event_name: "LoanClosed".to_owned(),
        block_timestamp: 100 * DAY,
        loan_id: BigDecimal::from(1_i64),
    }];
    let r = at(110, &loans, &events);
    assert_eq!(r.loans.len(), 2);
    let a = r
        .loans
        .iter()
        .find(|e| e.originator == "Open Mineral")
        .unwrap();
    let b = r
        .loans
        .iter()
        .find(|e| e.originator == "Trafalgar")
        .unwrap();
    assert_eq!(a.status, "Closed");
    assert_eq!(b.status, "Performing");
    // Only the still-active loan (B, 50k) counts toward the aggregate.
    assert_eq!(r.summary.total_deployed, "50000.000000");
}

#[test]
fn no_active_loans_still_shows_terminal_loans() {
    // Day 500: both loans closed (past maturity alone keeps them as Past Due) —
    // no active loans, but both still show up as terminal rows.
    let loans: Vec<LoanSnapshotRow> = fixture_loans()
        .into_iter()
        .map(|l| with_status(l, "Closed"))
        .collect();
    let events = vec![event("LoanClosed", 1, 181), event("LoanClosed", 2, 121)];
    let r = at(500, &loans, &events);
    assert_eq!(r.loans.len(), 2);
    assert!(r.loans.iter().all(|e| e.status == "Closed"));
    assert_eq!(r.summary.total_deployed, "0.000000");
    assert_eq!(r.summary.avg_yield, None);
    assert_eq!(r.summary.avg_duration_days, None);
}

#[test]
fn empty_registry_returns_empty_book() {
    let r = compute_loan_book(
        &[],
        &[],
        0,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
    );
    assert!(r.loans.is_empty());
    assert_eq!(r.summary.total_deployed, "0.000000");
    assert_eq!(r.summary.avg_yield, None);
}

#[test]
fn collateral_coverage_null_without_prices() {
    // No collateral map → every loan's collateral/ltv and the summary aggregates
    // serialize as null (no valuation anchor / price rows configured).
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.summary.total_collateral, None);
    assert_eq!(r.summary.senior_debt_coverage, None);
    for e in &r.loans {
        assert_eq!(e.collateral, None);
        assert_eq!(e.ltv, None);
    }
}

#[test]
fn collateral_and_ltv_computed_from_map() {
    // Day 0: only loan A active (principal 100k, senior 80k). Collateral 125k.
    let collateral = collateral_map(&[(1, usdc(125_000))]);
    let r = at_with(0, &fixture_loans(), &[], &collateral);

    assert_eq!(r.loans.len(), 1);
    assert_eq!(r.loans[0].collateral.as_deref(), Some("125000.000000"));
    // ltv = principal / collateral = 100k / 125k = 0.8000.
    assert_eq!(r.loans[0].ltv.as_deref(), Some("0.8000"));
    assert_eq!(r.summary.total_collateral.as_deref(), Some("125000.000000"));
    // coverage = total_collateral / Σ senior = 125k / 80k = 1.5625 → "1.56".
    assert_eq!(r.summary.senior_debt_coverage.as_deref(), Some("1.56"));
}

#[test]
fn ccr_bps_is_collateral_over_outstanding_senior() {
    // Day 0: loan A active, senior 80k, collateral 125k → CCR = 125k/80k = 15625 bps.
    let collateral = collateral_map(&[(1, usdc(125_000))]);
    let r = at_with(0, &fixture_loans(), &[], &collateral);
    assert_eq!(r.loans[0].ccr_bps, Some(15_625));

    // Loan without collateral → computed CCR null.
    let r2 = at(0, &fixture_loans(), &[]);
    assert_eq!(r2.loans[0].ccr_bps, None);
}

#[test]
fn missing_price_is_null_and_summary_sums_only_priced() {
    // Day 60: both active. Only loan A (id 1) has a price; loan B (id 2) does not.
    let collateral = collateral_map(&[(1, usdc(125_000))]);
    let r = at_with(60, &fixture_loans(), &[], &collateral);

    let a = r
        .loans
        .iter()
        .find(|e| e.originator == "Open Mineral")
        .unwrap();
    let b = r
        .loans
        .iter()
        .find(|e| e.originator == "Trafalgar")
        .unwrap();
    assert_eq!(a.collateral.as_deref(), Some("125000.000000"));
    assert_eq!(a.ltv.as_deref(), Some("0.8000"));
    assert_eq!(b.collateral, None);
    assert_eq!(b.ltv, None);

    // total_collateral counts only the priced loan (A); coverage denominator is
    // Σ senior over ALL active loans (A 80k + B 40k = 120k): 125k / 120k → "1.04".
    assert_eq!(r.summary.total_collateral.as_deref(), Some("125000.000000"));
    assert_eq!(r.summary.senior_debt_coverage.as_deref(), Some("1.04"));
}

#[test]
fn zero_collateral_yields_value_zero_and_null_ltv() {
    // A priced-but-zero collateral (discount 0 or price 0): value is 0, but LTV is
    // undefined (no division by zero).
    let collateral = collateral_map(&[(1, BigDecimal::from(0))]);
    let r = at_with(0, &fixture_loans(), &[], &collateral);

    assert_eq!(r.loans[0].collateral.as_deref(), Some("0.000000"));
    assert_eq!(r.loans[0].ltv, None);
    assert_eq!(r.summary.total_collateral.as_deref(), Some("0.000000"));
    // coverage = 0 / 80k = "0.00".
    assert_eq!(r.summary.senior_debt_coverage.as_deref(), Some("0.00"));
}

// ── Trustee "Loans" page metrics (deployed senior, at-risk, top concentration) ──

/// Override a loan's snapshot status (`Performing` | `WatchList` | `Default` | `Closed`).
fn with_status(mut row: LoanSnapshotRow, status: &str) -> LoanSnapshotRow {
    status.clone_into(&mut row.snapshot.status);
    row
}

fn event(name: &str, loan_id: i64, day: i64) -> LifecycleRow {
    LifecycleRow {
        chain_id: 1,
        event_name: name.to_owned(),
        block_timestamp: day * DAY,
        loan_id: BigDecimal::from(loan_id),
    }
}

#[test]
fn deployed_senior_sums_senior_tranche_only() {
    // Day 60: both active. Σ senior = A 80k + B 40k = 120k (excludes equity).
    // total_deployed (senior + equity) is 150k, so the two must differ.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.summary.deployed_senior, "120000.000000");
    assert_eq!(r.summary.total_deployed, "150000.000000");
}

#[test]
fn at_risk_includes_defaulted_loan_excluded_from_active_set() {
    // Loan 3: Default, originated day 0, maturity day 200, LoanDefaulted at day 50.
    // At day 60 its effective_end = 50 (the default event) → excluded from `active`,
    // but it is still an open, at-risk position (no LoanClosed).
    let mut loans = fixture_loans();
    loans.push(with_status(
        make_loan(3, 30, 0, 1000, 0, 200, "DefaultCo", "Coffee", ""),
        "Default",
    ));
    let events = vec![event("LoanDefaulted", 3, 50)];

    let r = at(60, &loans, &events);
    // Visible as a terminal row with its raw status…
    let defaulted = r
        .loans
        .iter()
        .find(|e| e.originator == "DefaultCo")
        .unwrap();
    assert_eq!(defaulted.status, "Default");
    // …but excluded from the active-set aggregate (100k A + 50k B, not +30k).
    assert_eq!(r.summary.total_deployed, "150000.000000");
    // …and its outstanding senior (30k) still counts as at-risk.
    assert_eq!(r.summary.at_risk_wl_and_default_senior, "30000.000000");
}

#[test]
fn at_risk_counts_watchlist_excludes_performing_and_closed() {
    // Loan 3 WatchList (active), loan 4 Closed-with-stale-WatchList-status.
    let mut loans = fixture_loans(); // A + B are Performing
    loans.push(with_status(
        make_loan(3, 25, 0, 1000, 0, 200, "WatchCo", "Cocoa", ""),
        "WatchList",
    ));
    loans.push(with_status(
        make_loan(4, 15, 0, 1000, 0, 200, "ClosedCo", "Cocoa", ""),
        "WatchList",
    ));
    let events = vec![event("LoanClosed", 4, 40)];

    let r = at(60, &loans, &events);
    // Only the WatchList loan 3 (25k) counts; Performing A/B and the Closed loan 4 do not.
    assert_eq!(r.summary.at_risk_wl_and_default_senior, "25000.000000");
}

#[test]
fn at_risk_wl_and_default_pct_is_over_total_collateral_nav() {
    // Active loan A priced at 125k collateral; a separate Default loan (30k senior).
    let mut loans = fixture_loans();
    loans.push(with_status(
        make_loan(3, 30, 0, 1000, 0, 200, "DefaultCo", "Coffee", ""),
        "Default",
    ));
    let events = vec![event("LoanDefaulted", 3, 50)];
    let collateral = collateral_map(&[(1, usdc(125_000))]);

    let r = at_with(60, &loans, &events, &collateral);
    assert_eq!(r.summary.at_risk_wl_and_default_senior, "30000.000000");
    // pct = at_risk_wl_and_default_senior / total_collateral = 30k / 125k = 0.2400.
    assert_eq!(
        r.summary.at_risk_wl_and_default_pct.as_deref(),
        Some("0.2400")
    );
}

#[test]
fn at_risk_zero_when_all_performing_and_pct_null_without_nav() {
    // fixture_loans are all Performing; no collateral map → NAV unavailable.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.summary.at_risk_wl_and_default_senior, "0.000000");
    assert_eq!(r.summary.at_risk_wl_and_default_pct, None);
}

#[test]
fn top_concentration_aggregates_loans_of_the_same_commodity() {
    // Three active loans: Cocoa 30k + Cocoa 40k = 70k, Copper 50k. Σ senior = 120k.
    // Top = Cocoa, share = 70k / 120k = 0.5833.
    let loans = vec![
        make_loan(1, 30, 0, 1000, 0, 200, "A", "Cocoa", ""),
        make_loan(2, 40, 0, 1000, 0, 200, "B", "Cocoa", ""),
        make_loan(3, 50, 0, 1000, 0, 200, "C", "Copper", ""),
    ];
    let r = at(60, &loans, &[]);
    let top = r.summary.top_concentration.expect("concentration present");
    assert_eq!(top.commodity, "Cocoa");
    assert_eq!(top.share, "0.5833");
}

#[test]
fn empty_book_defaults_the_trustee_metric_fields() {
    let r = compute_loan_book(
        &[],
        &[],
        0,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
    );
    assert_eq!(r.summary.deployed_senior, "0.000000");
    assert_eq!(r.summary.at_risk_wl_and_default_senior, "0.000000");
    assert_eq!(r.summary.at_risk_wl_and_default_pct, None);
    assert!(r.summary.top_concentration.is_none());
}

// ── Loans table per-loan columns (senior outstanding, maturity, spot) ──

#[test]
fn entry_senior_outstanding_nets_repaid_from_disbursed() {
    // Loan A senior 80k fully disbursed, with 30k senior principal repaid → outstanding 50k.
    let mut loans = fixture_loans();
    loans[0].snapshot.repaid = usdc(30_000);
    loans[0].snapshot.repayment.senior_principal_repaid = usdc(30_000);
    let r = at(0, &loans, &[]); // day 0: only loan A active
    assert_eq!(r.loans[0].principal, "100000.000000"); // original senior + equity
    assert_eq!(r.loans[0].senior_outstanding, "50000.000000"); // 80k − 30k
}

#[test]
fn entry_exposes_rollover_maturity() {
    let mut loans = fixture_loans();
    loans[0].snapshot.current_maturity_timestamp = 1_900_000_000;
    let r = at(0, &loans, &[]);
    assert_eq!(r.loans[0].maturity, 1_900_000_000);
}

#[test]
fn entry_carries_spot_price_and_change_from_map() {
    // Day 0: only loan 1 active. Supply its spot price + 7d change.
    let spot = spot_map(&[(1, Some("9120.00"), Some("0.0080"))]);
    let r = at_with_spot(0, &fixture_loans(), &spot);
    assert_eq!(r.loans[0].spot_price.as_deref(), Some("9120.00"));
    assert_eq!(r.loans[0].spot_change_7d.as_deref(), Some("0.0080"));
}

#[test]
fn entry_spot_fields_null_when_absent_from_map() {
    let r = at(0, &fixture_loans(), &[]);
    assert_eq!(r.loans[0].spot_price, None);
    assert_eq!(r.loans[0].spot_change_7d, None);
}

// ── review fixes: at-risk maturity bound, NAV denominator, outstanding basis ──

#[test]
fn at_risk_includes_watchlist_loan_past_maturity() {
    // WatchList loan matured at day 100 with no LoanClosed event; at day 150 it is now
    // `Past Due` — still an open, at-risk position — so its senior (25k) counts. (Only
    // an explicit close/default removes a loan; maturity alone no longer does.)
    let mut loans = fixture_loans();
    loans.push(with_status(
        make_loan(3, 25, 0, 1000, 0, 100, "MaturedWatch", "Coffee", ""),
        "WatchList",
    ));
    let r = at(150, &loans, &[]);
    assert_eq!(r.summary.at_risk_wl_and_default_senior, "25000.000000");
}

#[test]
fn at_risk_pct_includes_default_collateral_in_denominator() {
    // Active loan 1 collateral 100k; defaulted loan 3 (senior 30k) collateral 60k.
    // nav_denom = 100k (active) + 60k (default) = 160k → 30k / 160k = 0.1875.
    let mut loans = fixture_loans();
    loans.push(with_status(
        make_loan(3, 30, 0, 1000, 0, 200, "DefaultCo", "Coffee", ""),
        "Default",
    ));
    let events = vec![event("LoanDefaulted", 3, 50)];
    let collateral = collateral_map(&[(1, usdc(100_000)), (3, usdc(60_000))]);
    let r = at_with(60, &loans, &events, &collateral);
    assert_eq!(r.summary.at_risk_wl_and_default_senior, "30000.000000");
    assert_eq!(
        r.summary.at_risk_wl_and_default_pct.as_deref(),
        Some("0.1875")
    );
}

#[test]
fn at_risk_pct_clamps_at_100_percent() {
    // Large default (200k senior) against tiny NAV (50k) → raw ratio 4.0, clamped.
    let mut loans = fixture_loans();
    loans.push(with_status(
        make_loan(3, 200, 0, 1000, 0, 200, "BigDefault", "Coffee", ""),
        "Default",
    ));
    let events = vec![event("LoanDefaulted", 3, 50)];
    let collateral = collateral_map(&[(3, usdc(50_000))]);
    let r = at_with(60, &loans, &events, &collateral);
    assert_eq!(
        r.summary.at_risk_wl_and_default_pct.as_deref(),
        Some("1.0000")
    );
}

#[test]
fn deployed_senior_and_concentration_use_outstanding_senior() {
    // Loan A senior 80k with 30k repaid → outstanding 50k; only A active at day 0.
    let mut loans = fixture_loans();
    loans[0].snapshot.repaid = usdc(30_000);
    loans[0].snapshot.repayment.senior_principal_repaid = usdc(30_000);
    let r = at(0, &loans, &[]);
    // deployed_senior nets the repaid principal (50k), not the original 80k.
    assert_eq!(r.summary.deployed_senior, "50000.000000");
    // single active loan → its commodity is 100% of outstanding senior.
    let top = r.summary.top_concentration.expect("present");
    assert_eq!(top.commodity, "Copper Concentrate");
    assert_eq!(top.share, "1.0000");
}

// ── Derived status overrides: Disbursing + Past Due ────────────────────────────

/// Disbursement map marking the given loan ids complete; ids absent from the map
/// default to incomplete (Disbursing).
fn disbursement(complete_ids: &[i64]) -> HashMap<LoanRef, bool> {
    complete_ids
        .iter()
        .map(|id| (loan_ref(1, &BigDecimal::from(*id)), true))
        .collect()
}

#[test]
fn status_disbursing_when_off_ramp_incomplete() {
    // Loan A active at day 0 with no completion recorded → Disbursing.
    let loans = fixture_loans();
    let r = compute_loan_book(
        &loans,
        &[],
        0,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
    );
    assert_eq!(r.loans[0].status, "Disbursing");
}

#[test]
fn status_reverts_to_onchain_when_off_ramp_complete() {
    // Same loan, off-ramp complete → the live Performing status shows through.
    let loans = fixture_loans();
    let r = compute_loan_book(
        &loans,
        &[],
        0,
        &HashMap::new(),
        &HashMap::new(),
        &disbursement(&[1]),
        &HashMap::new(),
    );
    assert_eq!(r.loans[0].status, "Performing");
}

#[test]
fn status_past_due_when_complete_and_past_current_maturity() {
    // Loan B (ends day 120) at day 150 with off-ramp complete → Past Due.
    let loans = fixture_loans();
    let r = compute_loan_book(
        &loans,
        &[],
        150 * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &disbursement(&[1, 2]),
        &HashMap::new(),
    );
    let b = r.loans.iter().find(|e| e.loan_id == "2").unwrap();
    assert_eq!(b.status, "Past Due");
}

#[test]
fn status_disbursing_outranks_past_due() {
    // Loan B past maturity AND off-ramp incomplete → Disbursing wins over Past Due.
    let loans = fixture_loans();
    let r = compute_loan_book(
        &loans,
        &[],
        150 * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &disbursement(&[1]), // loan 2 left incomplete
        &HashMap::new(),
    );
    let b = r.loans.iter().find(|e| e.loan_id == "2").unwrap();
    assert_eq!(b.status, "Disbursing");
}

#[test]
fn display_status_never_overrides_terminal_states() {
    // Default / Closed pass through regardless of off-ramp or maturity.
    assert_eq!(display_status("Default", false, 100, 0), "Default");
    assert_eq!(display_status("Closed", false, 100, 0), "Closed");
    assert_eq!(display_status("Default", true, 100, 200), "Default");
}

#[test]
fn display_status_precedence_matrix() {
    // Performing, complete, not matured → Performing.
    assert_eq!(display_status("Performing", true, 50, 100), "Performing");
    // Performing, complete, matured → Past Due.
    assert_eq!(display_status("Performing", true, 150, 100), "Past Due");
    // Performing, incomplete → Disbursing (even before maturity).
    assert_eq!(display_status("Performing", false, 50, 100), "Disbursing");
    // WatchList behaves like Performing for the overrides.
    assert_eq!(display_status("WatchList", true, 150, 100), "Past Due");
    assert_eq!(display_status("WatchList", false, 50, 100), "Disbursing");
    // now == maturity is NOT past due (strictly greater).
    assert_eq!(display_status("Performing", true, 100, 100), "Performing");
}

// ── Summary-tile fields: original_senior_tranche, repaid_to_date, disbursed,
//    days_on_watchlist ─────────────────────────────────────────────────────────

/// Build a `loan_id → WatchList-entry timestamp` map, keyed like the handler.
fn watchlist_entry(entries: &[(i64, i64)]) -> HashMap<LoanRef, i64> {
    entries
        .iter()
        .map(|(id, ts)| (loan_ref(1, &BigDecimal::from(*id)), *ts))
        .collect()
}

#[test]
fn original_senior_tranche_is_distinct_from_outstanding() {
    // Loan A senior 80k with 30k repaid → outstanding 50k, original stays 80k.
    let mut loans = fixture_loans();
    loans[0].snapshot.repaid = usdc(30_000);
    loans[0].snapshot.repayment.senior_principal_repaid = usdc(30_000);
    let r = at(0, &loans, &[]);
    assert_eq!(r.loans[0].original_senior_tranche, "80000.000000");
    assert_eq!(r.loans[0].senior_outstanding, "50000.000000");
}

#[test]
fn repaid_to_date_reflects_offtaker_received() {
    let mut loans = fixture_loans();
    loans[0].snapshot.repayment.offtaker_received = usdc(15_000);
    let r = at(0, &loans, &[]);
    assert_eq!(r.loans[0].repaid_to_date, "15000.000000");
}

#[test]
fn repaid_to_date_zero_by_default() {
    let r = at(0, &fixture_loans(), &[]);
    assert_eq!(r.loans[0].repaid_to_date, "0.000000");
}

#[test]
fn disbursed_false_when_off_ramp_incomplete() {
    let loans = fixture_loans();
    let r = compute_loan_book(
        &loans,
        &[],
        0,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
    );
    assert!(!r.loans[0].disbursed);
}

#[test]
fn disbursed_true_when_off_ramp_complete() {
    let loans = fixture_loans();
    let r = compute_loan_book(
        &loans,
        &[],
        0,
        &HashMap::new(),
        &HashMap::new(),
        &disbursement(&[1]),
        &HashMap::new(),
    );
    assert!(r.loans[0].disbursed);
}

#[test]
fn days_on_watchlist_computed_when_currently_watchlisted() {
    // Loan A entered WatchList on day 10; "now" is day 28 → 18 days.
    let mut loans = fixture_loans();
    loans[0].snapshot.status = "WatchList".to_owned();
    let r = compute_loan_book(
        &loans,
        &[],
        28 * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &all_complete(&loans),
        &watchlist_entry(&[(1, 10 * DAY)]),
    );
    assert_eq!(r.loans[0].days_on_watchlist, Some(18));
    assert_eq!(r.loans[0].watchlist_entered_at, Some(10 * DAY));
}

#[test]
fn days_on_watchlist_none_without_a_known_entry_event() {
    // Currently WatchList, but no matching transition event indexed (data gap).
    let mut loans = fixture_loans();
    loans[0].snapshot.status = "WatchList".to_owned();
    let r = compute_loan_book(
        &loans,
        &[],
        28 * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &all_complete(&loans),
        &HashMap::new(),
    );
    assert_eq!(r.loans[0].days_on_watchlist, None);
    assert_eq!(r.loans[0].watchlist_entered_at, None);
}

#[test]
fn days_on_watchlist_none_when_not_currently_watchlisted() {
    // A stale WatchList-entry timestamp must not leak through once the loan is
    // back to Performing (or any other non-WatchList status).
    let loans = fixture_loans();
    let r = compute_loan_book(
        &loans,
        &[],
        28 * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &all_complete(&loans),
        &watchlist_entry(&[(1, 10 * DAY)]),
    );
    assert_eq!(r.loans[0].days_on_watchlist, None);
    assert_eq!(r.loans[0].watchlist_entered_at, None);
}

// ── Nearest payment (next_payment_timestamp + days_overdue) ─────────────────────

/// Override a loan's rollover-aware `current_maturity_timestamp` (in days), leaving the
/// immutable `original_maturity_date` untouched — models a rolled-over loan.
fn with_current_maturity(mut row: LoanSnapshotRow, maturity_day: i64) -> LoanSnapshotRow {
    row.snapshot.current_maturity_timestamp = maturity_day * DAY;
    row
}

#[test]
fn next_payment_equals_current_maturity_and_not_overdue_before_it() {
    // Day 60: loan A active (0–180). Next payment = current maturity = the `maturity`
    // field; not yet reached → days_overdue is null.
    let r = at(60, &fixture_loans(), &[]);
    let a = r.loans.iter().find(|e| e.loan_id == "1").unwrap();
    assert_eq!(a.next_payment_timestamp, 180 * DAY);
    assert_eq!(a.next_payment_timestamp, a.maturity);
    assert_eq!(a.days_overdue, None);
}

#[test]
fn days_overdue_null_at_the_payment_boundary() {
    // Exactly at loan B's maturity (day 120): `now == next_payment` is not past it.
    let r = at(120, &fixture_loans(), &[]);
    let b = r.loans.iter().find(|e| e.loan_id == "2").unwrap();
    assert_eq!(b.next_payment_timestamp, 120 * DAY);
    assert_eq!(b.days_overdue, None);
}

#[test]
fn days_overdue_counts_whole_days_past_the_payment() {
    // Day 150: loan B (maturity day 120) is 30 whole days past its next payment.
    let r = at(150, &fixture_loans(), &[]);
    let b = r.loans.iter().find(|e| e.loan_id == "2").unwrap();
    assert_eq!(b.days_overdue, Some(30));
}

#[test]
fn days_overdue_is_status_independent_for_terminal_loans() {
    // Pure date math: a Closed loan past its maturity still reports a count (day 500,
    // loan A maturity day 180 → 320 days). Documents the accepted consequence of the
    // status-independent rule.
    let loans: Vec<LoanSnapshotRow> = fixture_loans()
        .into_iter()
        .map(|l| with_status(l, "Closed"))
        .collect();
    let events = vec![event("LoanClosed", 1, 181), event("LoanClosed", 2, 121)];
    let r = at(500, &loans, &events);
    let a = r.loans.iter().find(|e| e.loan_id == "1").unwrap();
    assert_eq!(a.status, "Closed");
    assert_eq!(a.days_overdue, Some(320));
}

#[test]
fn next_payment_tracks_rollover_adjusted_maturity() {
    // Loan A rolled over: original maturity day 180, current maturity day 250. At day
    // 200 the next payment is the *current* maturity (250), still in the future — so the
    // base feed does not flag it overdue (the missed-prior-epoch case is #961, deferred).
    let mut loans = fixture_loans();
    loans[0] = with_current_maturity(loans[0].clone(), 250);
    let r = at(200, &loans, &[]);
    let a = r.loans.iter().find(|e| e.loan_id == "1").unwrap();
    assert_eq!(a.next_payment_timestamp, 250 * DAY);
    assert_eq!(a.next_payment_timestamp, a.maturity);
    assert_eq!(a.days_overdue, None);
}

// ── Outstanding = disbursed − repaid − written_down ────────────────────────────

#[test]
fn approved_loan_has_zero_outstanding_and_null_ccr() {
    let mut loans = fixture_loans();
    loans[0] = with_status(loans[0].clone(), "Approved");
    loans[0].snapshot.disbursed = BigDecimal::from(0_i64);
    let collateral = collateral_map(&[(1, usdc(125_000))]);
    let r = at_with(0, &loans, &[], &collateral);
    assert_eq!(r.loans[0].senior_outstanding, "0.000000");
    assert_eq!(r.loans[0].ccr_bps, None);
    assert_eq!(r.summary.deployed_senior, "0.000000");
    assert_eq!(r.loans[0].original_senior_tranche, "80000.000000");
}

#[test]
fn partly_disbursed_loan_outstanding_is_disbursed_part() {
    let mut loans = fixture_loans();
    loans[0].snapshot.disbursed = usdc(30_000);
    let collateral = collateral_map(&[(1, usdc(60_000))]);
    let r = at_with(0, &loans, &[], &collateral);
    assert_eq!(r.loans[0].senior_outstanding, "30000.000000");
    assert_eq!(r.loans[0].ccr_bps, Some(20_000));
}

#[test]
fn undisbursed_lowers_deployed_senior() {
    let mut loans = fixture_loans();
    loans[0].snapshot.disbursed = usdc(60_000);
    let r = at(60, &loans, &[]);
    assert_eq!(r.summary.deployed_senior, "100000.000000");
    let top = r.summary.top_concentration.expect("present");
    assert_eq!(top.commodity, "Copper Concentrate");
    assert_eq!(top.share, "0.6000");
}

#[test]
fn written_down_default_loan_reduces_at_risk_senior() {
    let mut loans = fixture_loans();
    let mut defaulted = with_status(
        make_loan(3, 30, 0, 1000, 0, 200, "DefaultCo", "Coffee", ""),
        "Default",
    );
    defaulted.snapshot.written_down = usdc(10_000);
    loans.push(defaulted);
    let events = vec![event("LoanDefaulted", 3, 50)];
    let r = at(60, &loans, &events);
    assert_eq!(r.summary.at_risk_wl_and_default_senior, "20000.000000");
}

#[test]
fn outstanding_ignores_stale_cumulative_senior_principal_repaid() {
    let mut loans = fixture_loans();
    loans[0].snapshot.repayment.senior_principal_repaid = usdc(30_000);
    let r = at(0, &loans, &[]);
    assert_eq!(r.loans[0].senior_outstanding, "80000.000000");
}

#[test]
fn single_chain_output_is_byte_identical() {
    let mut loans = fixture_loans();
    loans.push(make_loan(
        3,
        40,
        10,
        1500,
        30,
        120,
        "Trafalgar",
        "Alumina",
        "",
    ));
    loans.push(with_status(
        make_loan(4, 25, 5, 1100, 0, 300, "WatchCo", "Cocoa", "LC at sight"),
        "WatchList",
    ));
    loans.push(with_status(
        make_loan(10, 30, 0, 1000, 0, 200, "DefaultCo", "Coffee", ""),
        "Default",
    ));
    loans.push(with_status(
        make_loan(9, 60, 0, 900, 0, 100, "ClosedCo", "Zinc", ""),
        "Closed",
    ));
    let events = vec![event("LoanDefaulted", 10, 50), event("LoanClosed", 9, 40)];
    let collateral = collateral_map(&[(1, usdc(125_000)), (4, usdc(40_000)), (10, usdc(20_000))]);
    let spot = spot_map(&[(1, Some("8500.50"), Some("0.0123")), (4, None, None)]);
    let mut disbursement = all_complete(&loans);
    disbursement.insert(loan_ref(1, &BigDecimal::from(3_i64)), false);
    let watchlist = watchlist_entry(&[(4, 10 * DAY)]);

    let r = compute_loan_book(
        &loans,
        &events,
        60 * DAY,
        &collateral,
        &spot,
        &disbursement,
        &watchlist,
    );
    let actual = serde_json::to_string(&r).unwrap();
    let expected = "{\"summary\":{\"total_deployed\":\"230000.000000\",\"total_collateral\":\"165000.000000\",\"senior_debt_coverage\":\"0.89\",\"avg_yield\":\"0.131622\",\"avg_duration_days\":157,\"deployed_senior\":\"185000.000000\",\"weighted_rate\":\"0.131622\",\"weighted_tenor_days\":157,\"at_risk_wl_and_default_senior\":\"55000.000000\",\"at_risk_wl_and_default_pct\":\"0.2973\",\"top_concentration\":{\"commodity\":\"Alumina\",\"share\":\"0.4324\"}},\"loans\":[{\"chain_id\":1,\"loan_id\":\"1\",\"originator\":\"Open Mineral\",\"borrower\":\"borrower-1\",\"commodity\":\"Copper Concentrate\",\"principal\":\"100000.000000\",\"senior_outstanding\":\"80000.000000\",\"original_senior_tranche\":\"80000.000000\",\"maturity\":15552000,\"next_payment_timestamp\":15552000,\"days_overdue\":null,\"spot_price\":\"8500.50\",\"spot_change_7d\":\"0.0123\",\"collateral\":\"125000.000000\",\"ltv\":\"0.8000\",\"ccr_bps\":15625,\"duration_days\":180,\"rate\":\"0.120000\",\"protection\":\"LC at sight\",\"status\":\"Performing\",\"documents\":[],\"repaid_to_date\":\"0.000000\",\"disbursed\":true,\"days_on_watchlist\":null,\"watchlist_entered_at\":null},{\"chain_id\":1,\"loan_id\":\"2\",\"originator\":\"Trafalgar\",\"borrower\":\"borrower-2\",\"commodity\":\"Alumina\",\"principal\":\"50000.000000\",\"senior_outstanding\":\"40000.000000\",\"original_senior_tranche\":\"40000.000000\",\"maturity\":10368000,\"next_payment_timestamp\":10368000,\"days_overdue\":null,\"spot_price\":null,\"spot_change_7d\":null,\"collateral\":null,\"ltv\":null,\"ccr_bps\":null,\"duration_days\":90,\"rate\":\"0.150000\",\"protection\":null,\"status\":\"Performing\",\"documents\":[],\"repaid_to_date\":\"0.000000\",\"disbursed\":true,\"days_on_watchlist\":null,\"watchlist_entered_at\":null},{\"chain_id\":1,\"loan_id\":\"3\",\"originator\":\"Trafalgar\",\"borrower\":\"borrower-3\",\"commodity\":\"Alumina\",\"principal\":\"50000.000000\",\"senior_outstanding\":\"40000.000000\",\"original_senior_tranche\":\"40000.000000\",\"maturity\":10368000,\"next_payment_timestamp\":10368000,\"days_overdue\":null,\"spot_price\":null,\"spot_change_7d\":null,\"collateral\":null,\"ltv\":null,\"ccr_bps\":null,\"duration_days\":90,\"rate\":\"0.150000\",\"protection\":null,\"status\":\"Disbursing\",\"documents\":[],\"repaid_to_date\":\"0.000000\",\"disbursed\":false,\"days_on_watchlist\":null,\"watchlist_entered_at\":null},{\"chain_id\":1,\"loan_id\":\"4\",\"originator\":\"WatchCo\",\"borrower\":\"borrower-4\",\"commodity\":\"Cocoa\",\"principal\":\"30000.000000\",\"senior_outstanding\":\"25000.000000\",\"original_senior_tranche\":\"25000.000000\",\"maturity\":25920000,\"next_payment_timestamp\":25920000,\"days_overdue\":null,\"spot_price\":null,\"spot_change_7d\":null,\"collateral\":\"40000.000000\",\"ltv\":\"0.7500\",\"ccr_bps\":16000,\"duration_days\":300,\"rate\":\"0.110000\",\"protection\":\"LC at sight\",\"status\":\"WatchList\",\"documents\":[],\"repaid_to_date\":\"0.000000\",\"disbursed\":true,\"days_on_watchlist\":50,\"watchlist_entered_at\":864000},{\"chain_id\":1,\"loan_id\":\"9\",\"originator\":\"ClosedCo\",\"borrower\":\"borrower-9\",\"commodity\":\"Zinc\",\"principal\":\"60000.000000\",\"senior_outstanding\":\"60000.000000\",\"original_senior_tranche\":\"60000.000000\",\"maturity\":8640000,\"next_payment_timestamp\":8640000,\"days_overdue\":null,\"spot_price\":null,\"spot_change_7d\":null,\"collateral\":null,\"ltv\":null,\"ccr_bps\":null,\"duration_days\":100,\"rate\":\"0.090000\",\"protection\":null,\"status\":\"Closed\",\"documents\":[],\"repaid_to_date\":\"0.000000\",\"disbursed\":true,\"days_on_watchlist\":null,\"watchlist_entered_at\":null},{\"chain_id\":1,\"loan_id\":\"10\",\"originator\":\"DefaultCo\",\"borrower\":\"borrower-10\",\"commodity\":\"Coffee\",\"principal\":\"30000.000000\",\"senior_outstanding\":\"30000.000000\",\"original_senior_tranche\":\"30000.000000\",\"maturity\":17280000,\"next_payment_timestamp\":17280000,\"days_overdue\":null,\"spot_price\":null,\"spot_change_7d\":null,\"collateral\":\"20000.000000\",\"ltv\":\"1.5000\",\"ccr_bps\":6667,\"duration_days\":200,\"rate\":\"0.100000\",\"protection\":null,\"status\":\"Default\",\"documents\":[],\"repaid_to_date\":\"0.000000\",\"disbursed\":true,\"days_on_watchlist\":null,\"watchlist_entered_at\":null}]}";
    assert_eq!(actual, expected);
}

// ── Multi-chain union ────────────────────────────────────────────────────────

const CHAIN_B: i64 = 99_000_001;

fn on_chain(mut row: LoanSnapshotRow, chain_id: i64) -> LoanSnapshotRow {
    row.chain_id = chain_id;
    row
}

fn chain_event(chain_id: i64, name: &str, loan_id: i64, day: i64) -> LifecycleRow {
    LifecycleRow {
        chain_id,
        ..event(name, loan_id, day)
    }
}

struct Inputs {
    loans: Vec<LoanSnapshotRow>,
    collateral: HashMap<LoanRef, BigDecimal>,
    spot: HashMap<LoanRef, LoanSpot>,
    disbursement: HashMap<LoanRef, bool>,
    watchlist: HashMap<LoanRef, i64>,
}

fn two_chain_inputs() -> Inputs {
    let loans = vec![
        make_loan(
            1,
            80,
            20,
            1200,
            0,
            180,
            "Open Mineral",
            "Copper Concentrate",
            "LC at sight",
        ),
        make_loan(2, 40, 10, 1500, 30, 120, "Trafalgar", "Alumina", ""),
        with_status(
            on_chain(
                make_loan(
                    1,
                    30,
                    10,
                    900,
                    0,
                    90,
                    "Stellar Co",
                    "Copper Concentrate",
                    "",
                ),
                CHAIN_B,
            ),
            "WatchList",
        ),
    ];
    let mut disbursement = all_complete(&loans);
    disbursement.insert(loan_ref(CHAIN_B, &BigDecimal::from(1_i64)), false);
    Inputs {
        collateral: HashMap::from([
            (loan_ref(1, &BigDecimal::from(1_i64)), usdc(125_000)),
            (loan_ref(CHAIN_B, &BigDecimal::from(1_i64)), usdc(60_000)),
        ]),
        spot: HashMap::from([
            (
                loan_ref(1, &BigDecimal::from(1_i64)),
                LoanSpot {
                    price: Some("100".to_owned()),
                    change_7d: Some("0.0100".to_owned()),
                },
            ),
            (
                loan_ref(CHAIN_B, &BigDecimal::from(1_i64)),
                LoanSpot {
                    price: Some("200".to_owned()),
                    change_7d: None,
                },
            ),
        ]),
        watchlist: HashMap::from([(loan_ref(CHAIN_B, &BigDecimal::from(1_i64)), 10 * DAY)]),
        disbursement,
        loans,
    }
}

fn run(inputs: &Inputs, events: &[LifecycleRow], day: i64) -> LoanBookResponse {
    compute_loan_book(
        &inputs.loans,
        events,
        day * DAY,
        &inputs.collateral,
        &inputs.spot,
        &inputs.disbursement,
        &inputs.watchlist,
    )
}

fn find(r: &LoanBookResponse, chain_id: i64, loan_id: &str) -> usize {
    r.loans
        .iter()
        .position(|e| e.chain_id == chain_id && e.loan_id == loan_id)
        .unwrap()
}

#[test]
fn overlapping_ids_keep_per_chain_inputs() {
    let r = run(&two_chain_inputs(), &[], 60);
    assert_eq!(r.loans.len(), 3);

    let a = &r.loans[find(&r, 1, "1")];
    assert_eq!(a.commodity, "Copper Concentrate");
    assert_eq!(a.collateral.as_deref(), Some("125000.000000"));
    assert_eq!(a.ltv.as_deref(), Some("0.8000"));
    assert_eq!(a.ccr_bps, Some(15_625));
    assert_eq!(a.spot_price.as_deref(), Some("100"));
    assert_eq!(a.status, "Performing");
    assert!(a.disbursed);
    assert_eq!(a.days_on_watchlist, None);

    let b = &r.loans[find(&r, CHAIN_B, "1")];
    assert_eq!(b.principal, "40000.000000");
    assert_eq!(b.collateral.as_deref(), Some("60000.000000"));
    assert_eq!(b.ltv.as_deref(), Some("0.6667"));
    assert_eq!(b.ccr_bps, Some(20_000));
    assert_eq!(b.spot_price.as_deref(), Some("200"));
    assert_eq!(b.spot_change_7d, None);
    assert_eq!(b.status, "Disbursing");
    assert!(!b.disbursed);
    assert_eq!(b.days_on_watchlist, Some(50));
}

#[test]
fn lifecycle_event_is_chain_scoped() {
    let mut inputs = two_chain_inputs();
    inputs.loans[0] = with_status(inputs.loans[0].clone(), "Closed");
    let r = run(&inputs, &[chain_event(1, "LoanClosed", 1, 50)], 60);

    assert_eq!(r.loans.len(), 3);
    assert_eq!(r.loans[2].chain_id, 1);
    assert_eq!(r.loans[2].loan_id, "1");
    assert_eq!(r.loans[2].status, "Closed");
    assert_ne!(r.loans[find(&r, CHAIN_B, "1")].status, "Closed");
    assert_eq!(r.summary.total_deployed, "90000.000000");
}

#[test]
fn at_risk_extra_collateral_is_chain_scoped() {
    let mut inputs = two_chain_inputs();
    inputs.loans[0] = with_status(inputs.loans[0].clone(), "WatchList");
    inputs.loans[2] = with_status(inputs.loans[2].clone(), "Default");
    inputs.collateral = HashMap::from([
        (loan_ref(1, &BigDecimal::from(1_i64)), usdc(100_000)),
        (loan_ref(CHAIN_B, &BigDecimal::from(1_i64)), usdc(20_000)),
    ]);
    let r = run(&inputs, &[chain_event(CHAIN_B, "LoanDefaulted", 1, 50)], 60);

    assert_eq!(r.summary.total_collateral.as_deref(), Some("100000.000000"));
    assert_eq!(r.summary.at_risk_wl_and_default_senior, "110000.000000");
    assert_eq!(
        r.summary.at_risk_wl_and_default_pct.as_deref(),
        Some("0.9167")
    );
}

#[test]
fn union_summary_recomputed() {
    let r = run(&two_chain_inputs(), &[], 60);
    let s = &r.summary;
    assert_eq!(s.total_deployed, "190000.000000");
    assert_eq!(s.deployed_senior, "150000.000000");
    assert_eq!(s.total_collateral.as_deref(), Some("185000.000000"));
    assert_eq!(s.senior_debt_coverage.as_deref(), Some("1.23"));
    assert_eq!(s.avg_yield.as_deref(), Some("0.122000"));
    assert_eq!(s.weighted_rate, s.avg_yield);
    assert_eq!(s.avg_duration_days, Some(138));
    assert_eq!(s.at_risk_wl_and_default_senior, "30000.000000");
    assert_eq!(s.at_risk_wl_and_default_pct.as_deref(), Some("0.1622"));
    let top = s.top_concentration.as_ref().unwrap();
    assert_eq!(top.commodity, "Copper Concentrate");
    assert_eq!(top.share, "0.7333");
}

#[test]
fn ordering_tie_break_chain_then_loan() {
    let equal = |id: i64, chain: i64, status: &str| {
        with_status(
            on_chain(make_loan(id, 40, 10, 1000, 0, 100, "Co", "Zinc", ""), chain),
            status,
        )
    };
    let order = |r: &LoanBookResponse| -> Vec<(i64, String)> {
        r.loans
            .iter()
            .map(|e| (e.chain_id, e.loan_id.clone()))
            .collect()
    };
    let expected = vec![
        (1, "9".to_owned()),
        (1, "10".to_owned()),
        (CHAIN_B, "1".to_owned()),
    ];

    let active = vec![
        equal(1, CHAIN_B, "Performing"),
        equal(10, 1, "Performing"),
        equal(9, 1, "Performing"),
    ];
    let r = at(10, &active, &[]);
    assert_eq!(order(&r), expected);

    let terminal = vec![
        equal(1, CHAIN_B, "Closed"),
        equal(10, 1, "Closed"),
        equal(9, 1, "Closed"),
    ];
    let events = vec![
        chain_event(CHAIN_B, "LoanClosed", 1, 5),
        chain_event(1, "LoanClosed", 10, 5),
        chain_event(1, "LoanClosed", 9, 5),
    ];
    let r = at(10, &terminal, &events);
    assert_eq!(order(&r), expected);
}

#[test]
fn union_entries_match_single_chain_entries() {
    let inputs = two_chain_inputs();
    let union = run(&inputs, &[], 60);

    for chain in [1, CHAIN_B] {
        let only = Inputs {
            loans: inputs
                .loans
                .iter()
                .filter(|l| l.chain_id == chain)
                .cloned()
                .collect(),
            collateral: inputs
                .collateral
                .iter()
                .filter(|(k, _)| k.0 == chain)
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            spot: inputs
                .spot
                .iter()
                .filter(|(k, _)| k.0 == chain)
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            disbursement: inputs
                .disbursement
                .iter()
                .filter(|(k, _)| k.0 == chain)
                .map(|(k, v)| (k.clone(), *v))
                .collect(),
            watchlist: inputs
                .watchlist
                .iter()
                .filter(|(k, _)| k.0 == chain)
                .map(|(k, v)| (k.clone(), *v))
                .collect(),
        };
        let single = run(&only, &[], 60);
        let from_union: Vec<String> = union
            .loans
            .iter()
            .filter(|e| e.chain_id == chain)
            .map(|e| serde_json::to_string(e).unwrap())
            .collect();
        let alone: Vec<String> = single
            .loans
            .iter()
            .map(|e| serde_json::to_string(e).unwrap())
            .collect();
        assert_eq!(from_union, alone);
    }
}
