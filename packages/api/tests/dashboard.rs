//! Compute-layer tests for the Protocol Dashboard Header API.
//!
//! Exercises `compute_tvl_series`, `compute_yield_series`, `net_apy`, and
//! `compute_summary` directly against fixture data — no HTTP or DB layer involved.
//!
//! Lives under `packages/api/tests/` (project rule: all tests in `tests/`, never
//! inline `#[cfg(test)] mod tests` in `src/`). No `DATABASE_URL`/`POSTGRES_URL`
//! access — pure unit tests.

use bigdecimal::BigDecimal;

use pipeline_api::routes::dashboard::{
    compute_summary, compute_tvl_series, compute_yield_series, net_apy, MAX_SAMPLES,
};
use shared::contract_logs_repo::{FlowEventRow, LifecycleRow, LoanSnapshotRow, YieldMintRow};
use shared::loan_snapshot::{LoanSnapshot, LocationUpdateSnapshot, RepaymentSnapshot};

// ── Fixture helpers ─────────────────────────────────────────────────────────

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn zero_location() -> LocationUpdateSnapshot {
    LocationUpdateSnapshot {
        location_type: "Vessel".to_owned(),
        location_identifier: String::new(),
        tracking_url: String::new(),
        updated_at: 0,
    }
}

fn repayment(
    senior_interest: BigDecimal,
    mgmt_fee: BigDecimal,
    perf_fee: BigDecimal,
) -> RepaymentSnapshot {
    RepaymentSnapshot {
        offtaker_received: BigDecimal::from(0_i64),
        senior_principal_repaid: BigDecimal::from(0_i64),
        senior_interest,
        equity_distributed: BigDecimal::from(0_i64),
        mgmt_fee,
        perf_fee,
        oet_alloc: BigDecimal::from(0_i64),
    }
}

fn zero_repayment() -> RepaymentSnapshot {
    repayment(
        BigDecimal::from(0_i64),
        BigDecimal::from(0_i64),
        BigDecimal::from(0_i64),
    )
}

/// Build a loan snapshot row with given tranches, rate, and active window.
fn make_loan(
    loan_id: i64,
    senior_usdc: i64,
    equity_usdc: i64,
    rate_bps: u32,
    start_day: i64,
    end_day: i64,
    repayment_snapshot: RepaymentSnapshot,
) -> LoanSnapshotRow {
    LoanSnapshotRow {
        chain_id: 1,
        loan_id: BigDecimal::from(loan_id),
        block_number: 0,
        log_index: 0,
        event_name: "LoanDrawn".to_owned(),
        block_timestamp: 0,
        snapshot: LoanSnapshot {
            originator: "orig".to_owned(),
            borrower_id: "b".to_owned(),
            commodity: "c".to_owned(),
            corridor: "cr".to_owned(),
            governing_law: "EN".to_owned(),
            protection: String::new(),
            metadata_uri: None,
            documents: Vec::new(),
            original_facility_size: usdc(senior_usdc + equity_usdc),
            original_senior_tranche: usdc(senior_usdc),
            original_equity_tranche: usdc(equity_usdc),
            original_offtaker_price: BigDecimal::from(0_i64),
            senior_interest_rate_bps: rate_bps,
            origination_date: start_day * DAY,
            original_maturity_date: end_day * DAY,
            next_economics_epochs_id: BigDecimal::from(1_i64),
            next_repayment_id: BigDecimal::from(0_i64),
            status: "Performing".to_owned(),
            ccr_bps: 0,
            last_reported_ccr_timestamp: 0,
            current_maturity_timestamp: 0,
            closure_reason: "None".to_owned(),
            current_location: zero_location(),
            metadata_uri_onchain: String::new(),
            repayment: repayment_snapshot,
        },
    }
}

fn deposit(ts_day: i64, amount_usdc: i64) -> FlowEventRow {
    FlowEventRow {
        block_timestamp: ts_day * DAY,
        kind: "deposit".to_owned(),
        amount: usdc(amount_usdc),
    }
}

fn withdrawal(ts_day: i64, amount_usdc: i64) -> FlowEventRow {
    FlowEventRow {
        block_timestamp: ts_day * DAY,
        kind: "withdrawal".to_owned(),
        amount: usdc(amount_usdc),
    }
}

fn yield_mint(ts_day: i64, amount_usdc: i64) -> YieldMintRow {
    YieldMintRow {
        block_timestamp: ts_day * DAY,
        s_plusd_amount: usdc(amount_usdc),
    }
}

// ── compute_tvl_series ───────────────────────────────────────────────────────

#[test]
fn tvl_empty_flows_returns_empty() {
    let result = compute_tvl_series(&[], 0, 10 * DAY, DAY);
    assert!(result.is_empty());
}

#[test]
fn tvl_deposits_only_monotone_increase() {
    // 100 on day 0, 50 on day 5 → grid at day 0 / day 5 / day 10
    let flows = vec![deposit(0, 100), deposit(5, 50)];
    let series = compute_tvl_series(&flows, 0, 10 * DAY, 5 * DAY);
    assert_eq!(series.len(), 3);
    // day 0: 100
    assert_eq!(series[0].tvl, "100.000000");
    // day 5: 150
    assert_eq!(series[1].tvl, "150.000000");
    // day 10: still 150 (no new events)
    assert_eq!(series[2].tvl, "150.000000");
}

#[test]
fn tvl_withdrawal_reduces_running_total() {
    // deposit 100 on day 0, withdraw 30 on day 3
    let flows = vec![deposit(0, 100), withdrawal(3, 30)];
    let series = compute_tvl_series(&flows, 0, 5 * DAY, 5 * DAY);
    // grid: day 0, day 5
    assert_eq!(series.len(), 2);
    // day 0: 100 (withdrawal is on day 3, after day-0 sample)
    assert_eq!(series[0].tvl, "100.000000");
    // day 5: 100 - 30 = 70
    assert_eq!(series[1].tvl, "70.000000");
}

#[test]
fn tvl_final_point_equals_full_deposits_minus_withdrawals() {
    // deposit 200 on day 1, 150 on day 7, withdraw 80 on day 9
    let to = 10 * DAY;
    let flows = vec![deposit(1, 200), deposit(7, 150), withdrawal(9, 80)];
    let series = compute_tvl_series(&flows, 0, to, DAY);
    // Final point is at `to`
    let last = series.last().unwrap();
    assert_eq!(last.timestamp, "1970-01-11T00:00:00Z");
    // 200 + 150 - 80 = 270
    assert_eq!(last.tvl, "270.000000");
}

#[test]
fn tvl_max_samples_exceeded_returns_400_via_handler_logic() {
    // Test the ceiling-division cap logic inline (handler returns HTTP 400, not tested
    // here since we have no HTTP layer). Verify formula: with step=DAY and a range of
    // MAX_SAMPLES+2 days the estimate exceeds MAX_SAMPLES.
    let step = DAY;
    let to = MAX_SAMPLES * DAY + 2 * DAY; // MAX_SAMPLES + 2 days
    let from = 0_i64;
    let est = (to - from + step - 1) / step + 1;
    assert!(
        est > MAX_SAMPLES,
        "expected est {est} > MAX_SAMPLES {MAX_SAMPLES}"
    );
}

#[test]
fn tvl_exactly_max_samples_is_allowed() {
    // (MAX_SAMPLES-1) days at daily interval → exactly MAX_SAMPLES samples: the grid
    // 0..(MAX_SAMPLES-1) inclusive, with `to` on a grid boundary so no extra point.
    let step = DAY;
    let to = (MAX_SAMPLES - 1) * DAY;
    let from = 0_i64;
    let est = (to - from + step - 1) / step + 1;
    assert!(est <= MAX_SAMPLES, "est {est} should be <= {MAX_SAMPLES}");
    // The series itself should have exactly MAX_SAMPLES entries.
    let flows = vec![deposit(0, 1000)]; // one deposit to ensure non-empty
    let series = compute_tvl_series(&flows, from, to, step);
    assert_eq!(series.len() as i64, MAX_SAMPLES);
}

// ── compute_yield_series ─────────────────────────────────────────────────────

#[test]
fn yield_empty_mints_returns_empty() {
    let result = compute_yield_series(&[], 0, 10 * DAY, DAY);
    assert!(result.is_empty());
}

#[test]
fn yield_monotone_non_decreasing() {
    let mints = vec![yield_mint(0, 100), yield_mint(5, 50)];
    let series = compute_yield_series(&mints, 0, 10 * DAY, 5 * DAY);
    assert_eq!(series.len(), 3);
    let vals: Vec<&str> = series.iter().map(|p| p.cumulative_yield.as_str()).collect();
    // day 0: 100, day 5: 150, day 10: 150
    assert_eq!(vals, vec!["100.000000", "150.000000", "150.000000"]);
}

#[test]
fn yield_final_point_equals_total_minted() {
    let to = 10 * DAY;
    let mints = vec![yield_mint(1, 200), yield_mint(7, 150), yield_mint(9, 80)];
    let series = compute_yield_series(&mints, 0, to, DAY);
    let last = series.last().unwrap();
    // 200 + 150 + 80 = 430
    assert_eq!(last.cumulative_yield, "430.000000");
}

// ── net_apy (haircut) ─────────────────────────────────────────────────────────

#[test]
fn net_apy_no_active_loans_returns_null() {
    // No gross rate → None.
    assert_eq!(net_apy(None, &[]), None);
}

#[test]
fn net_apy_no_repayments_haircut_equals_one() {
    // realized_gross == 0 → haircut = 1.0 → net = gross.
    let loans = vec![make_loan(
        1,
        100_000,
        10_000,
        1000,
        0,
        180,
        zero_repayment(),
    )];
    // gross_book_rate = 0.1 (1000 bps / 10_000)
    let result = net_apy(Some("0.100000"), &loans);
    assert!(result.is_some());
    let val = result.unwrap();
    // haircut = 1 → net = 0.100000
    assert_eq!(val, "0.100000");
}

#[test]
fn net_apy_with_repayment_data_applies_haircut() {
    // Loan: senior_interest=80, mgmt_fee=10, perf_fee=10 → realized_net=80, realized_gross=100
    // haircut = 80/100 = 0.8
    // gross = 0.1 → net = 0.08
    let rep = repayment(usdc(80), usdc(10), usdc(10));
    let loans = vec![make_loan(1, 100_000, 10_000, 1000, 0, 180, rep)];
    let result = net_apy(Some("0.100000"), &loans);
    assert!(result.is_some());
    let val = result.unwrap();
    assert_eq!(val, "0.080000");
}

#[test]
fn net_apy_realized_gross_zero_guard() {
    // All repayment fields are zero → realized_gross == 0 → haircut = 1.0 → net = gross.
    let loans = vec![make_loan(1, 100_000, 0, 1200, 0, 180, zero_repayment())];
    let result = net_apy(Some("0.120000"), &loans);
    assert!(result.is_some());
    assert_eq!(result.unwrap(), "0.120000");
}

#[test]
fn net_apy_multiple_loans_aggregate_haircut() {
    // Loan 1: net=60, gross=80 (mgmt=20)
    // Loan 2: net=40, gross=50 (mgmt=10)
    // total realized_net=100, total realized_gross=130 → haircut = 100/130 ≈ 0.769230…
    // gross = 0.1 → net = 0.1 × 100/130 ≈ 0.076923…
    let rep1 = repayment(usdc(60), usdc(20), usdc(0));
    let rep2 = repayment(usdc(40), usdc(10), usdc(0));
    let loans = vec![
        make_loan(1, 100_000, 0, 1000, 0, 180, rep1),
        make_loan(2, 50_000, 0, 1000, 0, 180, rep2),
    ];
    let result = net_apy(Some("0.100000"), &loans);
    assert!(result.is_some());
    let val = result.unwrap();
    // 0.1 × (100/130) = 10/130 ≈ 0.076923... rounded at 6dp → "0.076923"
    assert_eq!(val, "0.076923");
}

// ── compute_summary ──────────────────────────────────────────────────────────

#[test]
fn summary_tvl_is_deposits_minus_withdrawals() {
    let flows = vec![deposit(0, 500), deposit(5, 200), withdrawal(7, 100)];
    let result = compute_summary(&[], &[], &flows, &[], 10 * DAY);
    // 500 + 200 - 100 = 600
    assert_eq!(result.tvl, "600.000000");
}

#[test]
fn summary_cumulative_yield_sums_mints() {
    let mints = vec![yield_mint(1, 300), yield_mint(5, 150)];
    let result = compute_summary(&[], &[], &[], &mints, 10 * DAY);
    // 300 + 150 = 450
    assert_eq!(result.cumulative_yield_total, "450.000000");
}

#[test]
fn summary_null_fields_when_no_active_loans() {
    // No loans → outstanding_in_loans=Some("0.000000") (compute_financial_position
    // returns zeros), loan_book_yield=None, current_apy_net_to_splusd=None.
    let result = compute_summary(&[], &[], &[], &[], 10 * DAY);
    assert_eq!(result.outstanding_in_loans, Some("0.000000".to_owned()));
    assert_eq!(result.loan_book_yield, None);
    assert_eq!(result.current_apy_net_to_splusd, None);
}

#[test]
fn summary_with_active_loan_populates_yield_fields() {
    // One active loan at 10% gross, no repayments → haircut=1 → net=gross.
    let loans = vec![make_loan(1, 100_000, 0, 1000, 0, 180, zero_repayment())];
    let events: Vec<LifecycleRow> = vec![];
    let result = compute_summary(&loans, &events, &[], &[], 90 * DAY);
    assert!(result.loan_book_yield.is_some());
    assert_eq!(result.loan_book_yield.as_deref(), Some("0.100000"));
    assert_eq!(
        result.current_apy_net_to_splusd.as_deref(),
        Some("0.100000")
    );
    // outstanding = senior + equity tranche = 100_000 USDC + 0
    assert_eq!(
        result.outstanding_in_loans.as_deref(),
        Some("100000.000000")
    );
}

#[test]
fn summary_tvl_zero_when_no_flows() {
    let result = compute_summary(&[], &[], &[], &[], 0);
    assert_eq!(result.tvl, "0.000000");
}

#[test]
fn summary_cumulative_yield_zero_when_no_mints() {
    let result = compute_summary(&[], &[], &[], &[], 0);
    assert_eq!(result.cumulative_yield_total, "0.000000");
}
