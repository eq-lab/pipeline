//! Compute-layer tests for the per-loan financials API: exercise `build_response`
//! directly against fixture rows, no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all tests
//! in `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`). Pure unit
//! tests — no `DATABASE_URL` / `POSTGRES_URL`, no Postgres connection.

use bigdecimal::BigDecimal;

use pipeline_api::routes::loan_financials::build_response;
use shared::contract_logs_repo::{EconomicsEventRow, LoanSnapshotRow};
use shared::loan_snapshot::{LoanSnapshot, LocationUpdateSnapshot, RepaymentSnapshot};

// ── Fixture helpers ─────────────────────────────────────────────────────────

fn repayment(senior_interest: i64, mgmt: i64, perf: i64, offtaker_recv: i64) -> RepaymentSnapshot {
    RepaymentSnapshot {
        offtaker_received: BigDecimal::from(offtaker_recv),
        senior_principal_repaid: BigDecimal::from(0),
        senior_interest: BigDecimal::from(senior_interest),
        equity_distributed: BigDecimal::from(0),
        mgmt_fee: BigDecimal::from(mgmt),
        perf_fee: BigDecimal::from(perf),
        oet_alloc: BigDecimal::from(0),
    }
}

fn snapshot(
    status: &str,
    senior_tranche: i64,
    equity_tranche: i64,
    offtaker_price: i64,
    repayment: RepaymentSnapshot,
    location: LocationUpdateSnapshot,
) -> LoanSnapshot {
    LoanSnapshot {
        originator: String::new(),
        borrower_id: String::new(),
        commodity: String::new(),
        corridor: String::new(),
        governing_law: String::new(),
        protection: String::new(),
        metadata_uri: None,
        documents: vec![],
        original_facility_size: BigDecimal::from(senior_tranche + equity_tranche),
        original_senior_tranche: BigDecimal::from(senior_tranche),
        original_equity_tranche: BigDecimal::from(equity_tranche),
        original_offtaker_price: BigDecimal::from(offtaker_price),
        senior_interest_rate_bps: 1_200,
        origination_date: 0,
        original_maturity_date: 0,
        next_economics_epochs_id: BigDecimal::from(0),
        next_repayment_id: BigDecimal::from(0),
        status: status.to_owned(),
        ccr_bps: 12_000,
        last_reported_ccr_timestamp: 0,
        current_maturity_timestamp: 0,
        closure_reason: String::new(),
        current_location: location,
        metadata_uri_onchain: String::new(),
        repayment,
    }
}

fn empty_location() -> LocationUpdateSnapshot {
    LocationUpdateSnapshot {
        location_type: String::new(),
        location_identifier: String::new(),
        tracking_url: String::new(),
        updated_at: 0,
    }
}

fn row(snapshot: LoanSnapshot) -> LoanSnapshotRow {
    LoanSnapshotRow {
        chain_id: 1,
        loan_id: BigDecimal::from(42),
        block_number: 0,
        log_index: 0,
        event_name: "PaymentRecorded".to_owned(),
        block_timestamp: 0,
        snapshot,
    }
}

fn econ_event(name: &str, new_rate: i64, new_maturity: i64) -> EconomicsEventRow {
    EconomicsEventRow {
        event_name: name.to_owned(),
        new_rate,
        new_maturity_timestamp: new_maturity,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn derives_realized_figures_and_outstanding() {
    // 1000 USDC offtaker, 900 principal (800 senior + 100 equity),
    // 50 interest + (30 mgmt + 20 perf) fees realized, 40 minted,
    // 600 offtaker received.
    let snap = snapshot(
        "Performing",
        800_000_000,
        100_000_000,
        1_000_000_000,
        repayment(50_000_000, 30_000_000, 20_000_000, 600_000_000),
        empty_location(),
    );
    let resp = build_response(&row(snap), &BigDecimal::from(40_000_000), &[]);

    assert_eq!(resp.loan_id, "42");
    assert_eq!(resp.status, "Performing");
    assert!(resp.location.is_none());
    assert_eq!(resp.offtaker, "1000.000000");
    assert_eq!(resp.principal, "900.000000");
    assert_eq!(resp.interest, "50.000000");
    assert_eq!(resp.fees, "50.000000");
    assert_eq!(resp.minted_yield, "40.000000");
    // (50 + 50) − 40 = 60
    assert_eq!(resp.not_minted_yield, "60.000000");
    // 1000 − 600 = 400
    assert_eq!(resp.offtaker_outstanding, "400.000000");
    // No events → epoch 1 at the origination rate (1_200 bps).
    assert_eq!(resp.epoch.number, 1);
    assert_eq!(resp.epoch.current_apy_bps, 1_200);
}

#[test]
fn not_minted_yield_clamps_at_zero() {
    let snap = snapshot(
        "Performing",
        100_000_000,
        0,
        100_000_000,
        repayment(10_000_000, 0, 0, 0),
        empty_location(),
    );
    // minted (25) exceeds realized interest+fees (10) → clamp to 0.
    let resp = build_response(&row(snap), &BigDecimal::from(25_000_000), &[]);
    assert_eq!(resp.not_minted_yield, "0.000000");
}

#[test]
fn location_projected_when_reported() {
    let snap = snapshot(
        "WatchList",
        100_000_000,
        0,
        100_000_000,
        repayment(0, 0, 0, 0),
        LocationUpdateSnapshot {
            location_type: "Vessel".to_owned(),
            location_identifier: "MV Example".to_owned(),
            tracking_url: "https://track.example/1".to_owned(),
            updated_at: 0,
        },
    );
    let resp = build_response(&row(snap), &BigDecimal::from(0), &[]);
    let loc = resp.location.expect("location present");
    assert_eq!(loc.location_type, "Vessel");
    assert_eq!(loc.location_identifier, "MV Example");
    assert_eq!(loc.updated_at, "1970-01-01T00:00:00Z");
}

#[test]
fn epoch_folds_rollover_then_amendment() {
    // Epoch 1: draw at 2026-01-01, matures 2026-04-01, 1_000 bps.
    let mut snap = snapshot(
        "Performing",
        100_000_000,
        0,
        100_000_000,
        repayment(0, 0, 0, 0),
        empty_location(),
    );
    let jan1 = 1_767_225_600; // 2026-01-01T00:00:00Z
    let apr1 = 1_775_001_600; // 2026-04-01T00:00:00Z
    let jul1 = 1_782_864_000; // 2026-07-01T00:00:00Z
    snap.origination_date = jan1;
    snap.original_maturity_date = apr1;
    snap.senior_interest_rate_bps = 1_000;

    // Rollover: opens epoch 2 (start = apr1), new maturity jul1, rate 15%
    // (150_000 in the contract's 1e6 scale). Then an amendment on epoch 2:
    // rate 16% (160_000), maturity nudged +1 day.
    let jul2 = jul1 + 86_400;
    let events = [
        econ_event("LoanRolledOver", 150_000, jul1),
        econ_event("EconomicsAmended", 160_000, jul2),
    ];

    let resp = build_response(&row(snap), &BigDecimal::from(0), &events);
    // Rollover advanced the ordinal; the amendment did not.
    assert_eq!(resp.epoch.number, 2);
    // Amendment overwrote the rate in place → 160_000 / 100 = 1_600 bps (16%).
    assert_eq!(resp.epoch.current_apy_bps, 1_600);
    // Epoch 2 starts at epoch 1's maturity (apr1).
    assert_eq!(resp.epoch.start_date, "2026-04-01T00:00:00Z");
    // Amendment overwrote the maturity → jul1 + 1 day.
    assert_eq!(resp.epoch.maturity_date, "2026-07-02T00:00:00Z");
}

#[test]
fn epoch_amendment_without_rollover_keeps_ordinal() {
    // Epoch 1 draws at 8% bps; an amendment (no rollover) changes only the
    // rate/maturity in place, so the ordinal stays 1 and the start stays at
    // origination. Guards that the two rate scales are not conflated: the
    // seed is bps (800 → 8%) and the amendment is 1e6-scaled (95_000 → 950 bps).
    let mut snap = snapshot(
        "Performing",
        100_000_000,
        0,
        100_000_000,
        repayment(0, 0, 0, 0),
        empty_location(),
    );
    let jan1 = 1_767_225_600; // 2026-01-01T00:00:00Z
    let apr1 = 1_775_001_600; // 2026-04-01T00:00:00Z
    let may1 = 1_777_593_600; // 2026-05-01T00:00:00Z
    snap.origination_date = jan1;
    snap.original_maturity_date = apr1;
    snap.senior_interest_rate_bps = 800;

    let events = [econ_event("EconomicsAmended", 95_000, may1)];

    let resp = build_response(&row(snap), &BigDecimal::from(0), &events);
    // No rollover → still epoch 1, still starting at origination.
    assert_eq!(resp.epoch.number, 1);
    assert_eq!(resp.epoch.start_date, "2026-01-01T00:00:00Z");
    // Amendment overwrote the rate (95_000 / 100 = 950 bps = 9.5%) and maturity.
    assert_eq!(resp.epoch.current_apy_bps, 950);
    assert_eq!(resp.epoch.maturity_date, "2026-05-01T00:00:00Z");
}
