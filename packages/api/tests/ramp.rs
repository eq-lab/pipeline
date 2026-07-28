//! Compute-layer tests for the `/v1/ramp` API group (#936). Exercise
//! `filter_pending_ramp_events` and `resolve_ramp_review` directly against
//! fixtures, no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`).

use std::collections::HashSet;

use bigdecimal::BigDecimal;
use chrono::Utc;

use pipeline_api::config::TransferAddressSets;
use pipeline_api::routes::ramp::{
    filter_pending_ramp_events, resolve_ramp_review, RampEventType, RampReviewDecision,
    RampReviewRequest,
};
use shared::contract_logs_repo::AssetTransferRow;

const CUSTODY: &str = "GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD";
const RAMP: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const EXTERNAL: &str = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn addr_sets() -> TransferAddressSets {
    TransferAddressSets {
        custody: [CUSTODY.to_owned()].into_iter().collect::<HashSet<_>>(),
        ramp: [RAMP.to_owned()].into_iter().collect::<HashSet<_>>(),
        asset_decimals: 6,
    }
}

/// `decision` is `None` (pending), `Some("Approved")`, or `Some("Rejected")`.
fn transfer(id: i64, from: &str, to: &str, whole: i64, decision: Option<&str>) -> AssetTransferRow {
    AssetTransferRow {
        id,
        chain_id: 1,
        from_addr: from.to_owned(),
        to_addr: to.to_owned(),
        amount: usdc(whole),
        block_timestamp: 1_000 + id,
        review_decision: decision.map(str::to_owned),
        review_reason: (decision == Some("Rejected")).then(|| "test rejection".to_owned()),
        reviewed_at: decision.map(|_| Utc::now()),
    }
}

// ── filter_pending_ramp_events ────────────────────────────────────────────────────

#[test]
fn keeps_only_pending_ramp_boundary_transfers() {
    let transfers = vec![
        transfer(1, RAMP, CUSTODY, 10, None), // on-ramp, pending: kept
        transfer(2, CUSTODY, RAMP, 15, None), // off-ramp, pending: kept
        transfer(3, RAMP, CUSTODY, 20, Some("Approved")), // on-ramp, approved: excluded
        transfer(4, CUSTODY, RAMP, 22, Some("Approved")), // off-ramp, approved: excluded
        transfer(5, RAMP, CUSTODY, 25, Some("Rejected")), // on-ramp, rejected: excluded
        transfer(6, CUSTODY, RAMP, 27, Some("Rejected")), // off-ramp, rejected: excluded
        transfer(7, RAMP, RAMP, 40, None),    // ramp↔ramp shuffle: excluded
        transfer(8, CUSTODY, CUSTODY, 50, None), // custody↔custody shuffle: excluded
        transfer(9, RAMP, EXTERNAL, 60, None), // untracked recipient: excluded
        transfer(10, EXTERNAL, CUSTODY, 70, None), // untracked sender: excluded
    ];
    let events = filter_pending_ramp_events(&transfers, &addr_sets());

    assert_eq!(events.len(), 2);
    let on_ramp = events.iter().find(|e| e.id == 1).expect("on-ramp kept");
    assert_eq!(on_ramp.event_type, RampEventType::OnRamp);
    assert_eq!(on_ramp.from, RAMP);
    assert_eq!(on_ramp.to, CUSTODY);
    assert_eq!(on_ramp.amount, "10.000000");
    assert_eq!(on_ramp.created_at, 1_001);

    let off_ramp = events.iter().find(|e| e.id == 2).expect("off-ramp kept");
    assert_eq!(off_ramp.event_type, RampEventType::OffRamp);
    assert_eq!(off_ramp.from, CUSTODY);
    assert_eq!(off_ramp.to, RAMP);
    assert_eq!(off_ramp.amount, "15.000000");
}

#[test]
fn empty_transfers_yield_no_events() {
    let events = filter_pending_ramp_events(&[], &addr_sets());
    assert!(events.is_empty());
}

#[test]
fn normalizes_amount_to_canonical_6_decimals() {
    // usdc(100) = raw base units 100_000_000. Read at a 7-decimal asset scale that's
    // 10.0000000 of the asset, which normalizes to "10.000000" at the canonical
    // 6-decimal scale (divided by 10^(7-6)).
    let sets = TransferAddressSets {
        asset_decimals: 7,
        ..addr_sets()
    };
    let transfers = vec![transfer(1, RAMP, CUSTODY, 100, None)];
    let events = filter_pending_ramp_events(&transfers, &sets);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].amount, "10.000000");
}

// ── resolve_ramp_review ──────────────────────────────────────────────────────────

#[test]
fn reject_requires_a_non_empty_reason() {
    let req = RampReviewRequest {
        decision: RampReviewDecision::Rejected,
        reason: None,
    };
    assert!(resolve_ramp_review(&req).is_err());

    let req = RampReviewRequest {
        decision: RampReviewDecision::Rejected,
        reason: Some("   ".to_owned()),
    };
    assert!(resolve_ramp_review(&req).is_err());
}

#[test]
fn reject_with_a_reason_succeeds() {
    let req = RampReviewRequest {
        decision: RampReviewDecision::Rejected,
        reason: Some("counterparty flagged by compliance".to_owned()),
    };
    let (decision, reason) = resolve_ramp_review(&req).unwrap();
    assert_eq!(decision, "Rejected");
    assert_eq!(reason, Some("counterparty flagged by compliance"));
}

#[test]
fn approve_must_not_carry_a_reason() {
    let req = RampReviewRequest {
        decision: RampReviewDecision::Approved,
        reason: Some("shouldn't be here".to_owned()),
    };
    assert!(resolve_ramp_review(&req).is_err());
}

#[test]
fn approve_without_a_reason_succeeds() {
    let req = RampReviewRequest {
        decision: RampReviewDecision::Approved,
        reason: None,
    };
    let (decision, reason) = resolve_ramp_review(&req).unwrap();
    assert_eq!(decision, "Approved");
    assert_eq!(reason, None);
}
