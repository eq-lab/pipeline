//! Compute-layer tests for the capital-allocation API (Trustee Overview money bar).
//! Exercise `compute_capital_allocation` directly against fixture loans + lifecycle
//! events, no HTTP/DB layer involved.
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

fn at(t_day: i64, loans: &[LoanSnapshotRow], events: &[LifecycleRow]) -> CapitalAllocationResponse {
    // Default: no asset transfers and no custody/ramp config → in_transit is null.
    compute_capital_allocation(loans, events, t_day * DAY, &[], None)
}

// ── Null buckets ───────────────────────────────────────────────────────────────

#[test]
fn non_deployed_buckets_are_always_null() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.buckets.capital_wallet, None);
    assert_eq!(r.buckets.in_transit, None);
    assert_eq!(r.buckets.trust_account, None);
    assert_eq!(r.buckets.tbills, None);
}

// ── Deployed = Σ senior tranche (senior-only) ──────────────────────────────────

#[test]
fn deployed_sums_senior_tranche_only_over_active_loans() {
    // At day 60 both loans active: senior 80k + 40k = 120k (equity excluded).
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.buckets.deployed, Some("120000.000000".to_owned()));
}

#[test]
fn total_equals_deployed_while_other_buckets_are_null() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.total, Some("120000.000000".to_owned()));
}

// ── Active-loan windowing (mirrors financial-position / loan-book) ──────────────

#[test]
fn loans_not_yet_originated_are_excluded() {
    // At day 10 only loan A (starts day 0) is active: senior 80k.
    let r = at(10, &fixture_loans(), &[]);
    assert_eq!(r.buckets.deployed, Some("80000.000000".to_owned()));
}

#[test]
fn matured_loans_are_excluded() {
    // At day 150 loan B has matured (ends day 120); only loan A: senior 80k.
    let r = at(150, &fixture_loans(), &[]);
    assert_eq!(r.buckets.deployed, Some("80000.000000".to_owned()));
}

#[test]
fn loan_closed_before_maturity_is_excluded_from_effective_end() {
    // Loan A closed on day 90 → excluded at day 100 even though maturity is day 180.
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

// ── in_transit: net custody→ramp flow ──────────────────────────────────────────

const CUSTODY: &str = "GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD";
const RAMP: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const EXTERNAL: &str = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

fn transfer(from: &str, to: &str, whole: i64) -> AssetTransferRow {
    AssetTransferRow {
        from_addr: from.to_owned(),
        to_addr: to.to_owned(),
        amount: usdc(whole),
    }
}

/// Address sets with a given asset decimal scale. The other tests use 6-decimal
/// (canonical, no normalization) so their round `usdc()` fixtures read directly.
fn addr_sets_with_decimals(asset_decimals: u32) -> TransferAddressSets {
    TransferAddressSets {
        custody: [CUSTODY.to_owned()].into_iter().collect::<HashSet<_>>(),
        ramp: [RAMP.to_owned()].into_iter().collect::<HashSet<_>>(),
        asset_decimals,
    }
}

fn addr_sets() -> TransferAddressSets {
    addr_sets_with_decimals(6)
}

#[test]
fn in_transit_nets_custody_to_ramp_flow() {
    let transfers = vec![
        transfer(CUSTODY, RAMP, 100), // out: +100
        transfer(RAMP, CUSTODY, 30),  // back: -30
        transfer(CUSTODY, CUSTODY, 5), // internal shuffle: ignored
        transfer(CUSTODY, EXTERNAL, 999), // untracked counterparty: ignored
    ];
    let sets = addr_sets();
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets));
    assert_eq!(r.buckets.in_transit, Some("70.000000".to_owned()));
    // deployed 0 (no loans) + in_transit 70.
    assert_eq!(r.total, Some("70.000000".to_owned()));
}

#[test]
fn in_transit_clamps_negative_to_zero() {
    // More returned from ramp than sent → raw net negative → clamped to 0.
    let transfers = vec![transfer(RAMP, CUSTODY, 50)];
    let sets = addr_sets();
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets));
    assert_eq!(r.buckets.in_transit, Some("0.000000".to_owned()));
}

#[test]
fn in_transit_is_null_when_unconfigured() {
    // Transfers present but no custody/ramp config → in_transit stays null.
    let transfers = vec![transfer(CUSTODY, RAMP, 100)];
    let r = compute_capital_allocation(&[], &[], 0, &transfers, None);
    assert_eq!(r.buckets.in_transit, None);
    assert_eq!(r.total, Some("0.000000".to_owned()));
}

#[test]
fn in_transit_adds_to_total_alongside_deployed() {
    let transfers = vec![transfer(CUSTODY, RAMP, 100)];
    let sets = addr_sets();
    // Day 60: both fixture loans active → deployed 120k; in_transit 100.
    let r = compute_capital_allocation(&fixture_loans(), &[], 60 * DAY, &transfers, Some(&sets));
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
        from_addr: CUSTODY.to_owned(),
        to_addr: RAMP.to_owned(),
        amount: raw_7dec,
    }];
    let sets = addr_sets_with_decimals(7);
    let r = compute_capital_allocation(&[], &[], 0, &transfers, Some(&sets));
    assert_eq!(r.buckets.in_transit, Some("100.000000".to_owned()));
    assert_eq!(r.total, Some("100.000000".to_owned()));
}
