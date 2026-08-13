//! Compute-layer tests for the Trustee Audit Log API (`GET /v1/audit-log`): exercise the
//! pure `format_action` mapper and `build_response` row-to-response mapping directly
//! against fixture rows — no HTTP/DB layer.
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in `tests/`,
//! feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests — no
//! `DATABASE_URL` / Postgres connection.
//!
//! `format_action` reads flat top-level `params` fields, unchanged from before #1094 —
//! the `params->'event'` nesting fix is tracked separately as #1096. The `reference`
//! field (friendly loan name, sourced from `params->'snapshot'`) is exercised in the
//! `build_response` section below.

use serde_json::{json, Value};

use pipeline_api::routes::audit_log::{build_response, format_action, AuditLogDoc};
use shared::contract_logs_repo::AuditLogRow;
use utoipa::OpenApi;

// ── Fixtures ───────────────────────────────────────────────────────────────────

/// Build a fixture row with a given id, event name, optional loan id, and params.
/// `originator`/`commodity` default to `None` (protocol-scoped / no-snapshot rows);
/// use [`row_with_snapshot`] for loan-scoped rows that carry a name.
fn row(id: i64, event_name: &str, loan_id: Option<&str>, params: Value) -> AuditLogRow {
    AuditLogRow {
        id,
        event_name: event_name.to_owned(),
        block_timestamp: 1_700_000_000, // fixed instant; timestamp formatting tested elsewhere
        tx_hash: format!("0xhash{id}"),
        loan_id: loan_id.map(str::to_owned),
        originator: None,
        commodity: None,
        params,
    }
}

/// Like [`row`], but also sets the snapshot-derived `originator`/`commodity` fields
/// (as the repo SELECT would project them from `params->'snapshot'`).
fn row_with_snapshot(
    id: i64,
    event_name: &str,
    loan_id: Option<&str>,
    originator: Option<&str>,
    commodity: Option<&str>,
    params: Value,
) -> AuditLogRow {
    AuditLogRow {
        originator: originator.map(str::to_owned),
        commodity: commodity.map(str::to_owned),
        ..row(id, event_name, loan_id, params)
    }
}

// ── format_action: per-event (flat params shape) ─────────────────────────────

#[test]
fn loan_drawn_is_approved_and_minted() {
    let (action, details) =
        format_action("LoanDrawn", &json!({ "loan_id": "42", "holder": "0x1" }));
    assert_eq!(action, "Loan approved & minted");
    assert_eq!(details, json!({}));
}

#[test]
fn payment_recorded_interest_only_when_principal_zero() {
    let params = json!({
        "loan_id": "42",
        "senior_interest": "100000000",       // 100.000000
        "senior_principal_repaid": "0",        // → 0.000000
    });
    let (action, details) = format_action("PaymentRecorded", &params);
    assert_eq!(
        action,
        "Coupon recorded — interest only, principal unchanged"
    );
    assert_eq!(details["senior_interest"], json!("100.000000"));
    assert_eq!(details["senior_principal_repaid"], json!("0.000000"));
}

#[test]
fn payment_recorded_principal_plus_interest_when_principal_nonzero() {
    let params = json!({
        "loan_id": "42",
        "senior_interest": "50000000",
        "senior_principal_repaid": "2200000000",
    });
    let (action, _) = format_action("PaymentRecorded", &params);
    assert_eq!(action, "Repayment recorded — principal + interest");
}

#[test]
fn yield_minted_formats_both_amounts_as_dollars() {
    let params = json!({ "s_plusd_amount": "115500000", "treasury_amount": "34500000" });
    let (action, details) = format_action("YieldMinted", &params);
    assert_eq!(
        action,
        "Coupon minted — $115.500000 vault + $34.500000 treasury"
    );
    assert_eq!(
        details,
        json!({ "vault": "115.500000", "treasury": "34.500000" })
    );
}

#[test]
fn yield_minted_falls_back_when_amounts_missing() {
    let (action, _) = format_action("YieldMinted", &json!({}));
    assert_eq!(action, "Coupon minted");
}

#[test]
fn ccr_updated_does_not_fabricate_a_percentage() {
    // CCR scale is ambiguous on-chain; the action must stay generic and pass the raw
    // value through in `details` rather than render a possibly-wrong percent.
    let (action, details) = format_action(
        "LoanCCRUpdated",
        &json!({ "loan_id": "42", "new_ccr": 1_420_000 }),
    );
    assert_eq!(action, "CCR written on-chain");
    assert_eq!(details["new_ccr"], json!(1_420_000));
}

#[test]
fn status_updated_includes_status_name() {
    let (action, details) = format_action(
        "LoanStatusUpdated",
        &json!({ "loan_id": "42", "status": "WatchList" }),
    );
    assert_eq!(action, "Status updated → WatchList");
    assert_eq!(details["status"], json!("WatchList"));
}

#[test]
fn loan_closed_includes_reason() {
    let (action, details) = format_action(
        "LoanClosed",
        &json!({ "loan_id": "42", "closure_reason": "Repaid" }),
    );
    assert_eq!(action, "Loan closed — Repaid");
    assert_eq!(details["closure_reason"], json!("Repaid"));
}

#[test]
fn loan_defaulted_action() {
    let (action, _) = format_action(
        "LoanDefaulted",
        &json!({ "loan_id": "42", "ccr_bps": 9000 }),
    );
    assert_eq!(action, "Loan defaulted");
}

#[test]
fn rollover_and_economics_amended_actions() {
    let p =
        json!({ "loan_id": "42", "new_rate": 1200, "new_maturity_timestamp": 1_800_000_000_i64 });
    assert_eq!(format_action("LoanRolledOver", &p).0, "Loan rolled over");
    assert_eq!(format_action("EconomicsAmended", &p).0, "Economics amended");
}

#[test]
fn location_updated_action() {
    let (action, _) = format_action("LoanLocationUpdated", &json!({ "loan_id": "42" }));
    assert_eq!(action, "Collateral location updated");
}

#[test]
fn unknown_event_falls_back_to_raw_name() {
    // Not reachable via the SQL allow-list, but the formatter must stay total.
    let (action, details) = format_action("SomethingElse", &json!({ "x": 1 }));
    assert_eq!(action, "SomethingElse");
    assert_eq!(details, json!({}));
}

#[test]
fn amount_helper_handles_missing_and_malformed_without_panicking() {
    // Missing amounts → null in details; no panic.
    let (_, details) = format_action("YieldMinted", &json!({ "s_plusd_amount": "not-a-number" }));
    assert_eq!(details["vault"], Value::Null);
    assert_eq!(details["treasury"], Value::Null);
}

// ── build_response: mapping + ordering + scope + reference (friendly name) ──────

#[test]
fn empty_feed_maps_to_no_items() {
    let resp = build_response(vec![]);
    assert!(resp.items.is_empty());
}

#[test]
fn every_row_is_returned_in_input_order() {
    // No pagination: the whole feed comes back, newest-first order preserved from input.
    // Distinguish rows by event_name (not tx_hash, which is no longer on the DTO).
    let rows = vec![
        row(9, "LoanDrawn", Some("9"), json!({})),
        row(8, "LoanClosed", Some("8"), json!({})),
        row(7, "LoanDefaulted", Some("7"), json!({})),
    ];
    let resp = build_response(rows);
    assert_eq!(resp.items.len(), 3);
    assert_eq!(resp.items[0].event_name, "LoanDrawn");
    assert_eq!(resp.items[1].event_name, "LoanClosed");
    assert_eq!(resp.items[2].event_name, "LoanDefaulted");
}

#[test]
fn loan_scoped_row_gets_loan_label_and_id() {
    let resp = build_response(vec![row(1, "PaymentRecorded", Some("4492"), json!({}))]);
    let scope = &resp.items[0].scope;
    assert_eq!(scope.loan_id.as_deref(), Some("4492"));
    assert_eq!(scope.label, "Loan #4492");
}

#[test]
fn protocol_scoped_row_has_no_loan_id() {
    // YieldMinted carries no loan_id → protocol scope.
    let resp = build_response(vec![row(1, "YieldMinted", None, json!({}))]);
    let scope = &resp.items[0].scope;
    assert_eq!(scope.loan_id, None);
    assert_eq!(scope.label, "Protocol");
}

#[test]
fn item_carries_timestamp_and_event_name() {
    let resp = build_response(vec![row(5, "LoanDrawn", Some("1"), json!({}))]);
    let item = &resp.items[0];
    assert_eq!(item.event_name, "LoanDrawn");
    assert_eq!(item.timestamp, "2023-11-14T22:13:20Z"); // 1_700_000_000 unix
}

#[test]
fn loan_scoped_row_with_snapshot_gets_friendly_reference_name() {
    let resp = build_response(vec![row_with_snapshot(
        1,
        "PaymentRecorded",
        Some("4492"),
        Some("Open Mineral"),
        Some("Copper Concentrate"),
        json!({}),
    )]);
    let item = &resp.items[0];
    assert_eq!(item.reference, "Open Mineral — Copper Concentrate");
    assert_eq!(item.scope.label, "Loan #4492");
    assert_eq!(item.scope.loan_id.as_deref(), Some("4492"));
}

#[test]
fn protocol_scoped_row_has_empty_reference() {
    // YieldMinted has no snapshot at all → both fields None → reference "".
    let resp = build_response(vec![row(1, "YieldMinted", None, json!({}))]);
    assert_eq!(resp.items[0].reference, "");
}

#[test]
fn loan_row_missing_commodity_has_empty_reference() {
    // Defensive: a partial snapshot must not render a dangling "<name> — ".
    let resp = build_response(vec![row_with_snapshot(
        1,
        "PaymentRecorded",
        Some("4492"),
        Some("Open Mineral"),
        None,
        json!({}),
    )]);
    assert_eq!(resp.items[0].reference, "");
}

#[test]
fn loan_row_with_empty_originator_has_empty_reference() {
    // Defensive: an empty-string field (not just missing) must also suppress the name.
    let resp = build_response(vec![row_with_snapshot(
        1,
        "PaymentRecorded",
        Some("4492"),
        Some(""),
        Some("Copper Concentrate"),
        json!({}),
    )]);
    assert_eq!(resp.items[0].reference, "");
}

#[test]
fn closed_loan_event_still_gets_a_name_from_its_own_snapshot() {
    // The whole point of sourcing the name server-side: a LoanClosed row (which the
    // frontend loan-book join would miss, since the loan book only has active loans)
    // still renders the name, because it comes from this row's own snapshot.
    let params = json!({ "loan_id": "77", "closure_reason": "Repaid" });
    let resp = build_response(vec![row_with_snapshot(
        1,
        "LoanClosed",
        Some("77"),
        Some("Trafigura"),
        Some("Lithium"),
        params,
    )]);
    let item = &resp.items[0];
    assert_eq!(item.reference, "Trafigura — Lithium");
    assert_eq!(item.action, "Loan closed — Repaid");
}

// ── OpenAPI doc smoke ─────────────────────────────────────────────────────────

#[test]
fn openapi_doc_exposes_the_route() {
    let doc = AuditLogDoc::openapi();
    let json = serde_json::to_value(&doc).unwrap();
    assert!(json["paths"]["/v1/audit-log"]["get"].is_object());
}
