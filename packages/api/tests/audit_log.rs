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
//!
//! `chain_kind` (#1433) drives `param_amount`'s scale: EVM is 6-decimal already;
//! Stellar's Soroban contracts store monetary fields at 7 decimals (#901), so Stellar
//! rows get normalized before the base-6 formatting EVM gets for free. Most tests below
//! use `ChainKind::Evm` — the pre-#1433 behavior — and a dedicated section covers
//! `ChainKind::Stellar` rendering.

use serde_json::{json, Value};

use pipeline_api::routes::audit_log::{build_response, format_action, AuditLogDoc};
use shared::chains::ChainKind;
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

// ── format_action: per-event (flat params shape, EVM scale) ─────────────────────

#[test]
fn loan_drawn_is_approved_and_minted() {
    let (action, details) = format_action(
        "LoanDrawn",
        &json!({ "loan_id": "42", "holder": "0x1" }),
        ChainKind::Evm,
    );
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
    let (action, details) = format_action("PaymentRecorded", &params, ChainKind::Evm);
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
    let (action, _) = format_action("PaymentRecorded", &params, ChainKind::Evm);
    assert_eq!(action, "Repayment recorded — principal + interest");
}

#[test]
fn yield_minted_formats_both_amounts_as_dollars() {
    let params = json!({ "s_plusd_amount": "115500000", "treasury_amount": "34500000" });
    let (action, details) = format_action("YieldMinted", &params, ChainKind::Evm);
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
    let (action, _) = format_action("YieldMinted", &json!({}), ChainKind::Evm);
    assert_eq!(action, "Coupon minted");
}

#[test]
fn ccr_updated_does_not_fabricate_a_percentage() {
    // CCR scale is ambiguous on-chain; the action must stay generic and pass the raw
    // value through in `details` rather than render a possibly-wrong percent.
    let (action, details) = format_action(
        "LoanCCRUpdated",
        &json!({ "loan_id": "42", "new_ccr": 1_420_000 }),
        ChainKind::Evm,
    );
    assert_eq!(action, "CCR written on-chain");
    assert_eq!(details["new_ccr"], json!(1_420_000));
}

#[test]
fn status_updated_includes_status_name() {
    let (action, details) = format_action(
        "LoanStatusUpdated",
        &json!({ "loan_id": "42", "status": "WatchList" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Status updated → WatchList");
    assert_eq!(details["status"], json!("WatchList"));
}

#[test]
fn loan_closed_includes_reason() {
    let (action, details) = format_action(
        "LoanClosed",
        &json!({ "loan_id": "42", "closure_reason": "Repaid" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Loan closed — Repaid");
    assert_eq!(details["closure_reason"], json!("Repaid"));
}

#[test]
fn loan_defaulted_legacy_ccr_bps_row_still_renders() {
    // D3/D4: a pre-rework row carries `ccr_bps` with no `outstanding`/`moved` — must
    // keep rendering rather than go blank.
    let (action, details) = format_action(
        "LoanDefaulted",
        &json!({ "loan_id": "42", "ccr_bps": 9000 }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Loan defaulted");
    assert_eq!(details["ccr_bps"], json!(9000));
    assert!(details.get("outstanding").is_none());
    assert!(details.get("moved").is_none());
}

#[test]
fn loan_defaulted_post_rework_row_projects_outstanding_and_moved() {
    // D4: the reworked `LoanDefaulted` carries `outstanding`/`moved`, no CCR.
    let (action, details) = format_action(
        "LoanDefaulted",
        &json!({ "loan_id": "42", "outstanding": "5000000000", "moved": "2500000000" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Loan defaulted");
    assert_eq!(details["outstanding"], json!("5000.000000"));
    assert_eq!(details["moved"], json!("2500.000000"));
    assert!(details.get("ccr_bps").is_none());
}

#[test]
fn rollover_and_economics_amended_actions() {
    let p =
        json!({ "loan_id": "42", "new_rate": 1200, "new_maturity_timestamp": 1_800_000_000_i64 });
    assert_eq!(
        format_action("LoanRolledOver", &p, ChainKind::Evm).0,
        "Loan rolled over"
    );
    assert_eq!(
        format_action("EconomicsAmended", &p, ChainKind::Evm).0,
        "Economics amended"
    );
}

#[test]
fn location_updated_action() {
    let (action, _) = format_action(
        "LoanLocationUpdated",
        &json!({ "loan_id": "42" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Collateral location updated");
}

#[test]
fn unknown_event_falls_back_to_raw_name() {
    // Not reachable via the SQL allow-list, but the formatter must stay total.
    let (action, details) = format_action("SomethingElse", &json!({ "x": 1 }), ChainKind::Evm);
    assert_eq!(action, "SomethingElse");
    assert_eq!(details, json!({}));
}

#[test]
fn amount_helper_handles_missing_and_malformed_without_panicking() {
    // Missing amounts → null in details; no panic.
    let (_, details) = format_action(
        "YieldMinted",
        &json!({ "s_plusd_amount": "not-a-number" }),
        ChainKind::Evm,
    );
    assert_eq!(details["vault"], Value::Null);
    assert_eq!(details["treasury"], Value::Null);
}

// ── format_action: the five new loan-lifecycle events (#1433 D5) ───────────────

#[test]
fn disbursed_action_includes_amount() {
    let (action, details) = format_action(
        "Disbursed",
        &json!({ "loan_id": "42", "amount": "3000000000" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Disbursed — $3000.000000");
    assert_eq!(details["amount"], json!("3000.000000"));
}

#[test]
fn undisbursed_action_includes_amount() {
    let (action, _) = format_action(
        "Undisbursed",
        &json!({ "loan_id": "42", "amount": "1000000000" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Disbursement reversed — $1000.000000");
}

#[test]
fn payment_unrecorded_action_is_payment_reversed() {
    let (action, details) = format_action(
        "PaymentUnrecorded",
        &json!({ "loan_id": "42", "senior_interest": "50000000", "senior_principal_repaid": "0" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Payment reversed");
    assert_eq!(details["senior_interest"], json!("50.000000"));
}

// Shape-tolerant (#1434 D6): EVM's `PaymentUnrecorded` carries no amounts, only
// `outstanding` — the projection must not render null-valued amount keys.
#[test]
fn payment_unrecorded_evm_shape_has_outstanding_and_no_amount_keys() {
    let (action, details) = format_action(
        "PaymentUnrecorded",
        &json!({ "loan_id": "42", "repayment_id": "3", "outstanding": "900000000" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Payment reversed");
    assert_eq!(details["outstanding"], json!("900.000000"));
    assert!(details.get("senior_interest").is_none());
    assert!(details.get("senior_principal_repaid").is_none());
}

#[test]
fn loan_written_down_action_includes_amount() {
    let (action, _) = format_action(
        "LoanWrittenDown",
        &json!({ "loan_id": "42", "amount": "400000000" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Loan written down — $400.000000");
}

#[test]
fn interest_adjusted_action_renders_negative_delta() {
    let (action, details) = format_action(
        "InterestAdjusted",
        &json!({ "loan_id": "42", "delta": "-1500000" }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Interest adjusted");
    assert_eq!(details["delta"], json!("-1.500000"));
}

// ── format_action: nested params (#1096) ─────────────────────────────────────────
//
// Production rows are NOT flat. `LoanEventMapper` rewraps parser fields as
// `{loan_id, event: {...}, snapshot: {...}}` — see `worker/src/indexer/loan_mapper.rs`
// and the `params->'event'->>'repayment_id'` reads in `yield_mint_outbox_repo`. Every
// other test in this file passes flat params, which is why #1096 stayed invisible: the
// flat shape only ever occurs for `ContractLogMapper` events such as `YieldMinted`.

#[test]
fn nested_loan_event_params_are_read_from_the_event_object() {
    let (action, details) = format_action(
        "Disbursed",
        &json!({
            "loan_id": "42",
            "event": { "loan_id": "42", "amount": "500000000", "outstanding": "1500000000" },
            "snapshot": { "status": "Performing" },
        }),
        ChainKind::Evm,
    );
    assert_eq!(action, "Disbursed — $500.000000");
    assert_eq!(details["amount"], json!("500.000000"));
}

#[test]
fn nested_params_also_get_the_stellar_scale_treatment() {
    // The #1433 chain-kind normalization has to survive the nesting lookup, otherwise
    // it only ever applies to flat `YieldMinted` rows and never to loan events.
    let (_, details) = format_action(
        "LoanWrittenDown",
        &json!({
            "loan_id": "7",
            "event": { "loan_id": "7", "amount": "10000000000", "outstanding": "0" },
        }),
        ChainKind::Stellar,
    );
    assert_eq!(details["amount"], json!("1000.000000"));
}

#[test]
fn flat_params_still_work_for_contract_log_mapper_events() {
    // `YieldMinted` is written by `ContractLogMapper`, which stores fields flat. The
    // #1096 fallback must not break that path.
    let (_, details) = format_action(
        "YieldMinted",
        &json!({ "s_plusd_amount": "250000000", "treasury_amount": "50000000" }),
        ChainKind::Evm,
    );
    assert_eq!(details["vault"], json!("250.000000"));
    assert_eq!(details["treasury"], json!("50.000000"));
}

// ── format_action: Stellar chain-kind amount scale (#1433 F12) ──────────────────

#[test]
fn stellar_amount_is_normalized_from_7_decimals_not_rendered_10x() {
    // Stellar's Soroban contracts store monetary fields at 7 decimals (#901). A raw
    // value of 10_000_000_0 (1,000.0000000 at 7dp) must render as "1000.000000", not
    // "10000.000000" (the pre-#1433 defect — 10x high).
    let (_, details) = format_action(
        "Disbursed",
        &json!({ "loan_id": "42", "amount": "10000000000" }),
        ChainKind::Stellar,
    );
    assert_eq!(details["amount"], json!("1000.000000"));
}

#[test]
fn stellar_payment_recorded_amounts_are_not_overstated() {
    // This exact defect was live: `PaymentRecorded` already existed pre-#1433 and
    // rendered every Stellar amount 10x high.
    let params = json!({
        "loan_id": "42",
        "senior_interest": "500000000",         // 50.0000000 at 7dp
        "senior_principal_repaid": "2200000000", // 220.0000000 at 7dp
    });
    let (_, details) = format_action("PaymentRecorded", &params, ChainKind::Stellar);
    assert_eq!(details["senior_interest"], json!("50.000000"));
    assert_eq!(details["senior_principal_repaid"], json!("220.000000"));
}

#[test]
fn evm_amount_is_unaffected_by_chain_kind() {
    // EVM's uint256 monetary fields are already 6-decimal — normalize_usdc_amount is a
    // no-op for ChainKind::Evm.
    let (_, details) = format_action(
        "Disbursed",
        &json!({ "loan_id": "42", "amount": "3000000000" }),
        ChainKind::Evm,
    );
    assert_eq!(details["amount"], json!("3000.000000"));
}

// ── build_response: mapping + ordering + scope + reference (friendly name) ──────

#[test]
fn empty_feed_maps_to_no_items() {
    let resp = build_response(vec![], ChainKind::Evm);
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
    let resp = build_response(rows, ChainKind::Evm);
    assert_eq!(resp.items.len(), 3);
    assert_eq!(resp.items[0].event_name, "LoanDrawn");
    assert_eq!(resp.items[1].event_name, "LoanClosed");
    assert_eq!(resp.items[2].event_name, "LoanDefaulted");
}

#[test]
fn loan_scoped_row_gets_loan_label_and_id() {
    let resp = build_response(
        vec![row(1, "PaymentRecorded", Some("4492"), json!({}))],
        ChainKind::Evm,
    );
    let scope = &resp.items[0].scope;
    assert_eq!(scope.loan_id.as_deref(), Some("4492"));
    assert_eq!(scope.label, "Loan #4492");
}

#[test]
fn protocol_scoped_row_has_no_loan_id() {
    // YieldMinted carries no loan_id → protocol scope.
    let resp = build_response(vec![row(1, "YieldMinted", None, json!({}))], ChainKind::Evm);
    let scope = &resp.items[0].scope;
    assert_eq!(scope.loan_id, None);
    assert_eq!(scope.label, "Protocol");
}

#[test]
fn item_carries_timestamp_and_event_name() {
    let resp = build_response(
        vec![row(5, "LoanDrawn", Some("1"), json!({}))],
        ChainKind::Evm,
    );
    let item = &resp.items[0];
    assert_eq!(item.event_name, "LoanDrawn");
    assert_eq!(item.timestamp, "2023-11-14T22:13:20Z"); // 1_700_000_000 unix
}

#[test]
fn loan_scoped_row_with_snapshot_gets_friendly_reference_name() {
    let resp = build_response(
        vec![row_with_snapshot(
            1,
            "PaymentRecorded",
            Some("4492"),
            Some("Open Mineral"),
            Some("Copper Concentrate"),
            json!({}),
        )],
        ChainKind::Evm,
    );
    let item = &resp.items[0];
    assert_eq!(item.reference, "Open Mineral — Copper Concentrate");
    assert_eq!(item.scope.label, "Loan #4492");
    assert_eq!(item.scope.loan_id.as_deref(), Some("4492"));
}

#[test]
fn protocol_scoped_row_has_empty_reference() {
    // YieldMinted has no snapshot at all → both fields None → reference "".
    let resp = build_response(vec![row(1, "YieldMinted", None, json!({}))], ChainKind::Evm);
    assert_eq!(resp.items[0].reference, "");
}

#[test]
fn loan_row_missing_commodity_has_empty_reference() {
    // Defensive: a partial snapshot must not render a dangling "<name> — ".
    let resp = build_response(
        vec![row_with_snapshot(
            1,
            "PaymentRecorded",
            Some("4492"),
            Some("Open Mineral"),
            None,
            json!({}),
        )],
        ChainKind::Evm,
    );
    assert_eq!(resp.items[0].reference, "");
}

#[test]
fn loan_row_with_empty_originator_has_empty_reference() {
    // Defensive: an empty-string field (not just missing) must also suppress the name.
    let resp = build_response(
        vec![row_with_snapshot(
            1,
            "PaymentRecorded",
            Some("4492"),
            Some(""),
            Some("Copper Concentrate"),
            json!({}),
        )],
        ChainKind::Evm,
    );
    assert_eq!(resp.items[0].reference, "");
}

#[test]
fn closed_loan_event_still_gets_a_name_from_its_own_snapshot() {
    // The whole point of sourcing the name server-side: a LoanClosed row (which the
    // frontend loan-book join would miss, since the loan book only has active loans)
    // still renders the name, because it comes from this row's own snapshot.
    let params = json!({ "loan_id": "77", "closure_reason": "Repaid" });
    let resp = build_response(
        vec![row_with_snapshot(
            1,
            "LoanClosed",
            Some("77"),
            Some("Trafigura"),
            Some("Lithium"),
            params,
        )],
        ChainKind::Evm,
    );
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
