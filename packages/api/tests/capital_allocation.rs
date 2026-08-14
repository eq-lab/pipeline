//! Compute-layer tests for the capital-allocation API (Trustee Overview money bar).
//! Exercise `compute_capital_allocation` directly against fixture loans, lifecycle
//! events, asset transfers, and Trustee-entered capital-transfers rows (#1027) —
//! no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`).

use std::collections::HashSet;

use bigdecimal::BigDecimal;

use pipeline_api::config::TransferAddressSets;
use pipeline_api::routes::capital_allocation::{
    compute_capital_allocation, CapitalAllocationResponse,
};
use shared::contract_logs_repo::{AssetTransferRow, LifecycleRow, LoanSnapshotRow};
use shared::loan_capital_transfers_repo::LoanCapitalTransfersRow;
use shared::loan_snapshot::{LoanSnapshot, LocationUpdateSnapshot, RepaymentSnapshot};

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
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

fn zero_location() -> LocationUpdateSnapshot {
    LocationUpdateSnapshot {
        location_type: "Vessel".to_owned(),
        location_identifier: String::new(),
        tracking_url: String::new(),
        updated_at: 0,
    }
}

/// A loan with senior/equity tranches (in thousands of USDC) and a maturity window
/// (in days). Only the senior tranche feeds `deployed`.
fn make_loan(
    loan_id: i64,
    senior_k: i64,
    equity_k: i64,
    start_day: i64,
    end_day: i64,
) -> LoanSnapshotRow {
    LoanSnapshotRow {
        chain_id: 1,
        loan_id: BigDecimal::from(loan_id),
        block_number: 0,
        log_index: 0,
        event_name: "LoanDrawn".to_owned(),
        block_timestamp: 0,
        snapshot: LoanSnapshot {
            originator: "Open Mineral".to_owned(),
            borrower_id: format!("borrower-{loan_id}"),
            commodity: "Copper".to_owned(),
            corridor: "cr".to_owned(),
            governing_law: "EN".to_owned(),
            protection: String::new(),
            metadata_uri: None,
            documents: Vec::new(),
            original_facility_size: usdc((senior_k + equity_k) * 1_000),
            original_senior_tranche: usdc(senior_k * 1_000),
            original_equity_tranche: usdc(equity_k * 1_000),
            original_offtaker_price: BigDecimal::from(0_i64),
            senior_interest_rate_bps: 1200,
            origination_date: start_day * DAY,
            original_maturity_date: end_day * DAY,
            next_economics_epochs_id: BigDecimal::from(1_i64),
            next_repayment_id: BigDecimal::from(0_i64),
            status: "Performing".to_owned(),
            ccr_bps: 11_750,
            last_reported_ccr_timestamp: 0,
            current_maturity_timestamp: 0,
            closure_reason: "None".to_owned(),
            current_location: zero_location(),
            metadata_uri_onchain: String::new(),
            repayment: zero_repayment(),
        },
    }
}

/// Loan A: senior 80k + equity 20k, day 0–180.
/// Loan B: senior 40k + equity 10k, day 30–120.
fn fixture_loans() -> Vec<LoanSnapshotRow> {
    vec![make_loan(1, 80, 20, 0, 180), make_loan(2, 40, 10, 30, 120)]
}

/// A Trustee-entered capital-transfers row (#1027). Amounts are *plain dollars*
/// (whole figures) — not base-6 units, unlike `usdc()`.
fn ct_row(
    loan_id: i64,
    is_loan_deployed: bool,
    on_ramp: i64,
    off_ramp: i64,
    ta_deposit: i64,
    ta_withdrawal: i64,
) -> LoanCapitalTransfersRow {
    LoanCapitalTransfersRow {
        chain_id: 1,
        loan_id: BigDecimal::from(loan_id),
        is_loan_deployed,
        on_ramp_transferred: BigDecimal::from(on_ramp),
        off_ramp_transferred: BigDecimal::from(off_ramp),
        trust_account_deposit: BigDecimal::from(ta_deposit),
        trust_account_withdrawal: BigDecimal::from(ta_withdrawal),
        recorded_by: "trustee-test".to_owned(),
        updated_at: chrono::Utc::now(),
    }
}

/// A row that only flags the loan deployed (all amounts zero).
fn deployed_flag(loan_id: i64) -> LoanCapitalTransfersRow {
    ct_row(loan_id, true, 0, 0, 0, 0)
}

fn at(t_day: i64, loans: &[LoanSnapshotRow], events: &[LifecycleRow]) -> CapitalAllocationResponse {
    // Default: both fixture loans flagged deployed (so the windowing tests keep
    // exercising the active-window check), no asset transfers, no custody/ramp
    // config (in_transit null), no withdrawal-queue wallet configured
    // (withdrawal_queue null), canonical 6-decimal asset scale, zero
    // trust-account amounts (trust_account = 0).
    compute_capital_allocation(
        loans,
        events,
        t_day * DAY,
        &[],
        None,
        6,
        None,
        &[deployed_flag(1), deployed_flag(2)],
    )
}

// ── Null / zero buckets ──────────────────────────────────────────────────────────

#[test]
fn unsourced_buckets_are_null_trust_account_is_zero() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.buckets.capital_wallet, None);
    assert_eq!(r.buckets.in_transit, None);
    assert_eq!(r.buckets.withdrawal_queue, None);
    // trust_account is always sourced — no recorded amounts reads 0, not null.
    assert_eq!(r.buckets.trust_account, Some("0.000000".to_owned()));
    assert_eq!(r.buckets.tbills, None);
}

// ── Deployed = Σ senior tranche (senior-only, is_loan_deployed-gated) ───────────

#[test]
fn deployed_sums_senior_tranche_only_over_active_deployed_loans() {
    // At day 60 both loans active and flagged: senior 80k + 40k = 120k (equity excluded).
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.buckets.deployed, Some("120000.000000".to_owned()));
}

#[test]
fn total_equals_deployed_while_other_buckets_are_null() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.total, Some("120000.000000".to_owned()));
}

#[test]
fn deployed_excludes_active_loan_without_deployed_flag() {
    // Only loan A is flagged; loan B is active but not flagged (#1027) → 80k.
    let r = compute_capital_allocation(
        &fixture_loans(),
        &[],
        60 * DAY,
        &[],
        None,
        6,
        None,
        &[deployed_flag(1)],
    );
    assert_eq!(r.buckets.deployed, Some("80000.000000".to_owned()));
}

#[test]
fn deployed_excludes_loan_with_unset_flag_row() {
    // A row exists for loan B but with is_loan_deployed = false → same as no row.
    let r = compute_capital_allocation(
        &fixture_loans(),
        &[],
        60 * DAY,
        &[],
        None,
        6,
        None,
        &[deployed_flag(1), ct_row(2, false, 0, 0, 0, 0)],
    );
    assert_eq!(r.buckets.deployed, Some("80000.000000".to_owned()));
}

#[test]
fn deployed_is_zero_without_capital_transfers_rows() {
    // Active loans but nothing Trustee-recorded → deployed 0 (#1027: the flag
    // gates inclusion; there is no flag-less fallback).
    let r = compute_capital_allocation(&fixture_loans(), &[], 60 * DAY, &[], None, 6, None, &[]);
    assert_eq!(r.buckets.deployed, Some("0.000000".to_owned()));
}

// ── Active-loan windowing (mirrors financial-position / loan-book) ──────────────

#[test]
fn loans_not_yet_originated_are_excluded() {
    // At day 10 only loan A (starts day 0) is active: senior 80k — the flag alone
    // does not admit loan B before its origination date.
    let r = at(10, &fixture_loans(), &[]);
    assert_eq!(r.buckets.deployed, Some("80000.000000".to_owned()));
}

#[test]
fn matured_loans_are_excluded_despite_deployed_flag() {
    // At day 150 loan B has matured (ends day 120); its flag is still set but the
    // window ANDs with it (#1027 decision 2) → only loan A: senior 80k.
    let r = at(150, &fixture_loans(), &[]);
    assert_eq!(r.buckets.deployed, Some("80000.000000".to_owned()));
}

#[test]
fn loan_closed_before_maturity_is_excluded_from_effective_end() {
    // Loan A closed on day 90 → excluded at day 100 even though maturity is day
    // 180 and its deployed flag is still set.
    let events = vec![LifecycleRow {
        event_name: "LoanClosed".to_owned(),
        block_timestamp: 90 * DAY,
        loan_id: BigDecimal::from(1_i64),
    }];
    let r = at(100, &fixture_loans(), &events);
    // Only loan B (day 30–120) active: senior 40k.
    assert_eq!(r.buckets.deployed, Some("40000.000000".to_owned()));
}

// ── Empty book ───────────────────────────────────────────────────────────────

#[test]
fn no_active_loans_yields_zero_deployed_and_null_buckets() {
    let r = at(-10, &fixture_loans(), &[]);
    assert_eq!(r.buckets.deployed, Some("0.000000".to_owned()));
    assert_eq!(r.total, Some("0.000000".to_owned()));
    assert_eq!(r.buckets.capital_wallet, None);
    assert_eq!(r.buckets.tbills, None);
}

// ── trust_account: Σ(deposits) − Σ(withdrawals) over loan_capital_transfers ─────

#[test]
fn trust_account_zero_without_recorded_amounts() {
    let r = compute_capital_allocation(&[], &[], 0, &[], None, 6, None, &[]);
    assert_eq!(r.buckets.trust_account, Some("0.000000".to_owned()));
}

#[test]
fn trust_account_sums_deposits_minus_withdrawals_across_loans() {
    // Loan 1: +500 −120; loan 2: +0 −30 → $350. Plain dollars, not base-6.
    let rows = vec![
        ct_row(1, false, 0, 0, 500, 120),
        ct_row(2, false, 0, 0, 0, 30),
    ];
    let r = compute_capital_allocation(&[], &[], 0, &[], None, 6, None, &rows);
    assert_eq!(r.buckets.trust_account, Some("350.000000".to_owned()));
}

#[test]
fn trust_account_negative_balance_is_not_clamped() {
    // Withdrawals exceed deposits → negative balance surfaces as-is (a real
    // bookkeeping error should be visible).
    let rows = vec![ct_row(1, false, 0, 0, 10, 50)];
    let r = compute_capital_allocation(&[], &[], 0, &[], None, 6, None, &rows);
    assert_eq!(r.buckets.trust_account, Some("-40.000000".to_owned()));
}

#[test]
fn trust_account_folds_into_total_alongside_deployed_and_in_transit() {
    let transfers = vec![approved_transfer(CUSTODY, RAMP, 100)];
    let sets = addr_sets();
    // Both loans flagged deployed; loan 1 also carries +$50 trust deposit.
    // Day 60: deployed 120k, in_transit 100 (gross, nothing confirmed),
    // trust_account 50 → total 120150.
    let rows = vec![ct_row(1, true, 0, 0, 50, 0), deployed_flag(2)];
    let r = compute_capital_allocation(
        &fixture_loans(),
        &[],
        60 * DAY,
        &transfers,
        Some(&sets),
        6,
        None,
        &rows,
    );
    assert_eq!(r.buckets.deployed, Some("120000.000000".to_owned()));
    assert_eq!(r.buckets.in_transit, Some("100.000000".to_owned()));
    assert_eq!(r.buckets.trust_account, Some("50.000000".to_owned()));
    assert_eq!(r.total, Some("120150.000000".to_owned()));
}

// ── in_transit: gross approved ramp flow − confirmed per-loan transfers ─────────

const CUSTODY: &str = "GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD";
const RAMP: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const EXTERNAL: &str = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

fn transfer(from: &str, to: &str, whole: i64) -> AssetTransferRow {
    AssetTransferRow {
        id: 0,
        chain_id: 1,
        from_addr: from.to_owned(),
        to_addr: to.to_owned(),
        amount: usdc(whole),
        block_timestamp: 0,
        review_decision: None,
        review_reason: None,
        reviewed_at: None,
    }
}

/// A transfer that a Trustee has reviewed as Approved (#936) — the only decision
/// that counts toward `in_transit`'s gross flow, on either leg.
fn approved_transfer(from: &str, to: &str, whole: i64) -> AssetTransferRow {
    AssetTransferRow {
        review_decision: Some("Approved".to_owned()),
        reviewed_at: Some(chrono::Utc::now()),
        ..transfer(from, to, whole)
    }
}

/// A transfer that a Trustee has reviewed as Rejected (#936) — must not count
/// toward `in_transit`'s gross flow, same as an unreviewed transfer.
fn rejected_transfer(from: &str, to: &str, whole: i64) -> AssetTransferRow {
    AssetTransferRow {
        review_decision: Some("Rejected".to_owned()),
        review_reason: Some("test rejection".to_owned()),
        reviewed_at: Some(chrono::Utc::now()),
        ..transfer(from, to, whole)
    }
}

/// Custody/ramp address sets. `asset_decimals` is a separate top-level argument
/// to `compute_capital_allocation` (shared with `withdrawal_queue`), not part of
/// `TransferAddressSets` — pass it alongside these sets.
fn addr_sets() -> TransferAddressSets {
    TransferAddressSets {
        custody: [CUSTODY.to_owned()].into_iter().collect::<HashSet<_>>(),
        ramp: [RAMP.to_owned()].into_iter().collect::<HashSet<_>>(),
        // Unused by compute_capital_allocation (asset_decimals is passed as its
        // own argument) — only routes::ramp reads this field.
        asset_decimals: 6,
    }
}

#[test]
fn in_transit_sums_both_approved_legs_gross() {
    // #1027: both legs count as absolute amounts (gross flow), no netting —
    // 100 out + 30 back = 130, not 70.
    let transfers = vec![
        approved_transfer(CUSTODY, RAMP, 100), // off-ramp leg, approved: +100
        approved_transfer(RAMP, CUSTODY, 30),  // on-ramp leg, approved: +30
        transfer(CUSTODY, CUSTODY, 5),         // internal shuffle: ignored
        transfer(CUSTODY, EXTERNAL, 999),      // untracked counterparty: ignored
    ];
    let sets = addr_sets();
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets), 6, None, &[]);
    assert_eq!(r.buckets.in_transit, Some("130.000000".to_owned()));
    // deployed 0 (no loans) + in_transit 130.
    assert_eq!(r.total, Some("130.000000".to_owned()));
}

#[test]
fn in_transit_subtracts_confirmed_per_loan_transfers() {
    // Gross approved flow 150; Trustees confirmed $60 on-ramp + $40 off-ramp
    // across two loans (plain dollars, scaled ×10^6 for the subtraction) → 50.
    let transfers = vec![
        approved_transfer(CUSTODY, RAMP, 100),
        approved_transfer(RAMP, CUSTODY, 50),
    ];
    let sets = addr_sets();
    let rows = vec![ct_row(1, false, 60, 0, 0, 0), ct_row(2, false, 0, 40, 0, 0)];
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets), 6, None, &rows);
    assert_eq!(r.buckets.in_transit, Some("50.000000".to_owned()));
    assert_eq!(r.total, Some("50.000000".to_owned()));
}

#[test]
fn in_transit_goes_negative_when_confirmed_exceeds_gross() {
    // #1027 decision 5: no clamp. Gross 50, confirmed 80 → −30, and total
    // reflects the reduction (deployed 0, trust_account 0).
    let transfers = vec![approved_transfer(CUSTODY, RAMP, 50)];
    let sets = addr_sets();
    let rows = vec![ct_row(1, false, 80, 0, 0, 0)];
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets), 6, None, &rows);
    assert_eq!(r.buckets.in_transit, Some("-30.000000".to_owned()));
    assert_eq!(r.total, Some("-30.000000".to_owned()));
}

#[test]
fn in_transit_ignores_unapproved_on_ramp() {
    // A pending (unreviewed) on-ramp transfer must not enter the gross flow.
    let transfers = vec![
        approved_transfer(CUSTODY, RAMP, 100), // approved: +100
        transfer(RAMP, CUSTODY, 30),           // pending: ignored
    ];
    let sets = addr_sets();
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets), 6, None, &[]);
    assert_eq!(r.buckets.in_transit, Some("100.000000".to_owned()));
}

#[test]
fn in_transit_ignores_rejected_on_ramp() {
    // A Rejected on-ramp event must not enter the gross flow either.
    let transfers = vec![
        approved_transfer(CUSTODY, RAMP, 100), // approved: +100
        rejected_transfer(RAMP, CUSTODY, 30),  // rejected: ignored
    ];
    let sets = addr_sets();
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets), 6, None, &[]);
    assert_eq!(r.buckets.in_transit, Some("100.000000".to_owned()));
}

#[test]
fn in_transit_ignores_unapproved_off_ramp() {
    // Symmetric: a pending off-ramp transfer must not enter the gross flow —
    // only the approved on-ramp leg counts here.
    let transfers = vec![
        transfer(CUSTODY, RAMP, 100),         // pending: ignored
        approved_transfer(RAMP, CUSTODY, 30), // approved: +30
    ];
    let sets = addr_sets();
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets), 6, None, &[]);
    assert_eq!(r.buckets.in_transit, Some("30.000000".to_owned()));
}

#[test]
fn in_transit_ignores_rejected_off_ramp() {
    let transfers = vec![
        rejected_transfer(CUSTODY, RAMP, 100), // rejected: ignored
        approved_transfer(RAMP, CUSTODY, 30),  // approved: +30
    ];
    let sets = addr_sets();
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets), 6, None, &[]);
    assert_eq!(r.buckets.in_transit, Some("30.000000".to_owned()));
}

#[test]
fn in_transit_is_null_when_unconfigured() {
    // Transfers and confirmed per-loan amounts present, but no custody/ramp
    // config → in_transit stays null (the confirmed sums alone don't create it).
    let transfers = vec![transfer(CUSTODY, RAMP, 100)];
    let rows = vec![ct_row(1, false, 60, 40, 0, 0)];
    let r = compute_capital_allocation(&[], &[], 0, &transfers, None, 6, None, &rows);
    assert_eq!(r.buckets.in_transit, None);
    assert_eq!(r.total, Some("0.000000".to_owned()));
}

#[test]
fn in_transit_adds_to_total_alongside_deployed() {
    let transfers = vec![approved_transfer(CUSTODY, RAMP, 100)];
    let sets = addr_sets();
    // Day 60: both fixture loans active + flagged → deployed 120k; in_transit 100.
    let r = compute_capital_allocation(
        &fixture_loans(),
        &[],
        60 * DAY,
        &transfers,
        Some(&sets),
        6,
        None,
        &[deployed_flag(1), deployed_flag(2)],
    );
    assert_eq!(r.buckets.deployed, Some("120000.000000".to_owned()));
    assert_eq!(r.buckets.in_transit, Some("100.000000".to_owned()));
    assert_eq!(r.total, Some("120100.000000".to_owned()));
}

#[test]
fn in_transit_normalizes_7_decimal_usdc_sac_to_6_decimal() {
    // Tracked asset is the 7-decimal USDC SAC. A raw transfer amount of
    // 1_000_000_000 (7-dec) = 100 USDC must normalize to 6-dec base 100_000_000
    // → "100.000000", i.e. divided by 10 relative to the 6-decimal reading.
    let raw_7dec = BigDecimal::from(1_000_000_000_i64); // 100.0000000 at 7 decimals
    let transfers = vec![AssetTransferRow {
        id: 0,
        chain_id: 1,
        from_addr: CUSTODY.to_owned(),
        to_addr: RAMP.to_owned(),
        amount: raw_7dec,
        block_timestamp: 0,
        review_decision: Some("Approved".to_owned()),
        review_reason: None,
        reviewed_at: Some(chrono::Utc::now()),
    }];
    let sets = addr_sets();
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets), 7, None, &[]);
    assert_eq!(r.buckets.in_transit, Some("100.000000".to_owned()));
    assert_eq!(r.total, Some("100.000000".to_owned()));
}

#[test]
fn normalize_floors_sub_base_unit_fractions_not_rounds() {
    // BUG-10 / #1070: normalizing a 7-decimal SAC amount to 6-decimal base units must
    // FLOOR (truncating division) — every raw on-chain amount is a whole integer at its
    // native scale, so the canonical result must be too. A raw amount ending in `…5`
    // leaves a half-base-unit fraction after ÷10; below the 6-dp display it is invisible
    // in any single bucket, but the un-floored `in_transit` and `withdrawal_queue`
    // fractions would each leak 0.5 base units and sum to a phantom whole base unit in
    // `total`. With truncation, both buckets floor cleanly and `total` is exact.
    let raw = BigDecimal::from(1_000_000_005_i64); // 7-dec: 100.0000005
    let transfers = vec![AssetTransferRow {
        id: 0,
        chain_id: 1,
        from_addr: CUSTODY.to_owned(),
        to_addr: RAMP.to_owned(),
        amount: raw.clone(),
        block_timestamp: 0,
        review_decision: Some("Approved".to_owned()),
        review_reason: None,
        reviewed_at: Some(chrono::Utc::now()),
    }];
    let sets = addr_sets();
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets), 7, Some(&raw), &[]);
    assert_eq!(r.buckets.in_transit, Some("100.000000".to_owned()));
    assert_eq!(r.buckets.withdrawal_queue, Some("100.000000".to_owned()));
    // Pre-fix this was 200.000001 — two leaked 0.5 base units summing to a phantom unit.
    assert_eq!(r.total, Some("200.000000".to_owned()));
}

// ── withdrawal_queue: Withdrawal Queue Wallet running balance (Issue #933) ──────

#[test]
fn withdrawal_queue_is_null_when_unconfigured() {
    let r = compute_capital_allocation(&[], &[], 0, &[], None, 6, None, &[]);
    assert_eq!(r.buckets.withdrawal_queue, None);
    assert_eq!(r.total, Some("0.000000".to_owned()));
}

#[test]
fn withdrawal_queue_reads_through_at_canonical_scale() {
    let balance = usdc(250); // already 6-decimal base units
    let r = compute_capital_allocation(&[], &[], 0, &[], None, 6, Some(&balance), &[]);
    assert_eq!(r.buckets.withdrawal_queue, Some("250.000000".to_owned()));
}

#[test]
fn withdrawal_queue_normalizes_7_decimal_usdc_sac_to_6_decimal() {
    // Same 7-decimal SAC normalization as in_transit, applied to the wallet balance.
    let raw_7dec = BigDecimal::from(1_000_000_000_i64); // 100.0000000 at 7 decimals
    let r = compute_capital_allocation(&[], &[], 0, &[], None, 7, Some(&raw_7dec), &[]);
    assert_eq!(r.buckets.withdrawal_queue, Some("100.000000".to_owned()));
}

#[test]
fn withdrawal_queue_negative_balance_is_not_clamped() {
    // A negative wallet balance is a real tracking gap and must surface as-is,
    // not be floored at zero (mirrors trust_account's rationale).
    let balance = usdc(-30);
    let r = compute_capital_allocation(&[], &[], 0, &[], None, 6, Some(&balance), &[]);
    assert_eq!(r.buckets.withdrawal_queue, Some("-30.000000".to_owned()));
    assert_eq!(r.total, Some("-30.000000".to_owned()));
}

#[test]
fn withdrawal_queue_adds_to_total_alongside_deployed_and_in_transit() {
    let transfers = vec![approved_transfer(CUSTODY, RAMP, 100)];
    let sets = addr_sets();
    let wq_balance = usdc(50);
    // Day 60: deployed 120k, in_transit 100, withdrawal_queue 50 → total 120150.
    let r = compute_capital_allocation(
        &fixture_loans(),
        &[],
        60 * DAY,
        &transfers,
        Some(&sets),
        6,
        Some(&wq_balance),
        &[deployed_flag(1), deployed_flag(2)],
    );
    assert_eq!(r.buckets.deployed, Some("120000.000000".to_owned()));
    assert_eq!(r.buckets.in_transit, Some("100.000000".to_owned()));
    assert_eq!(r.buckets.withdrawal_queue, Some("50.000000".to_owned()));
    assert_eq!(r.total, Some("120150.000000".to_owned()));
}
