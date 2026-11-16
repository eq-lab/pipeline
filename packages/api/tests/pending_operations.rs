// spec: docs/product-specs/loan-security-state.md#pending-operations
use std::collections::HashMap;

use bigdecimal::BigDecimal;
use pipeline_api::pending_operations::{
    group_by_loan, pending_operation, pending_state, PendingOperation, PendingOperationState,
    PendingTargetKind, TargetScope,
};
use pipeline_api::routes::loan_book::{attach_pending_operations, compute_loan_book, LoanBookDoc};
use pipeline_api::routes::loan_security::LoanSecurityDoc;
use pipeline_api::security_state::{build_security_response, MarkInputs};
use serde_json::{json, Value};
use shared::access_manager_repo::PendingOpRow;
use shared::contract_logs_repo::LoanSnapshotRow;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};
use shared::security_registry_repo::LoanSecurityRows;
use utoipa::OpenApi;

const DAY: i64 = 86_400;
const STELLAR: i64 = 99_000_001;
const EVM: i64 = 560_048;
const R: i64 = 1_763_251_200;
const EXPIRATION: i64 = 604_800;
const LOAN_REGISTRY: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";
const MINTER: &str = "CMINTER";
const SECURITY: &str = "CDTUMAT6QBBPUZQFTZWMPHXHVQSLPUWRPDHKVQEMEF2YKCV4QTSCSQVN";

fn dec(n: i64) -> BigDecimal {
    BigDecimal::from(n)
}

fn scope() -> TargetScope<'static> {
    TargetScope {
        loan_registry: Some(LOAN_REGISTRY),
        minter: Some(MINTER),
        security_registry: Some(SECURITY),
    }
}

fn op_row(loan_id: i64, id: &str, nonce: i64, ready_at: i64, target: &str) -> PendingOpRow {
    PendingOpRow {
        loan_id,
        operation_id: id.to_owned(),
        nonce,
        caller: "GCALLER".to_owned(),
        target: target.to_owned(),
        function: "set_default".to_owned(),
        args_xdr: "AAAAAQ==".to_owned(),
        args_json: json!([0, 145_000, "1816128000"]),
        ready_at,
        expires_at: ready_at + EXPIRATION,
    }
}

fn make_loan(chain_id: i64, loan_id: i64) -> LoanSnapshotRow {
    let zero = || dec(0);
    LoanSnapshotRow {
        chain_id,
        loan_id: dec(loan_id),
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
            original_facility_size: dec(100_000_000_000),
            original_senior_tranche: dec(80_000_000_000),
            original_equity_tranche: dec(20_000_000_000),
            original_offtaker_price: zero(),
            senior_interest_rate_bps: 1200,
            origination_date: 0,
            original_maturity_date: 180 * DAY,
            next_economics_epochs_id: dec(1),
            next_repayment_id: zero(),
            status: "Performing".to_owned(),
            current_maturity_timestamp: 180 * DAY,
            current_rate: 1200,
            closure_reason: "None".to_owned(),
            carved_out: false,
            disbursed: dec(80_000_000_000),
            repaid: zero(),
            written_down: zero(),
            interest_adjustment: zero(),
            metadata_uri_onchain: String::new(),
            repayment: RepaymentSnapshot {
                offtaker_received: zero(),
                senior_principal_repaid: zero(),
                senior_interest: zero(),
                equity_distributed: zero(),
                mgmt_fee: zero(),
                perf_fee: zero(),
                oet_alloc: zero(),
            },
        },
    }
}

fn book(loans: &[LoanSnapshotRow]) -> pipeline_api::routes::loan_book::LoanBookResponse {
    compute_loan_book(
        loans,
        &[],
        10 * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
    )
}

fn entry<'a>(json: &'a Value, chain_id: i64, loan_id: &str) -> &'a Value {
    json["loans"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["chain_id"] == chain_id && e["loan_id"] == loan_id)
        .unwrap()
}

#[test]
fn pending_state_boundaries() {
    let e = R + EXPIRATION;
    assert_eq!(pending_state(R - 1, R, e), PendingOperationState::Waiting);
    assert_eq!(pending_state(R, R, e), PendingOperationState::Ready);
    assert_eq!(
        pending_state(R + 604_799, R, e),
        PendingOperationState::Ready
    );
    assert_eq!(
        pending_state(R + 604_800, R, e),
        PendingOperationState::Expired
    );
    assert_eq!(
        pending_state(R + 100 * DAY, R, e),
        PendingOperationState::Expired
    );
}

#[test]
fn target_kind_follows_the_configured_addresses() {
    let s = scope();
    assert_eq!(s.kind(LOAN_REGISTRY), PendingTargetKind::LoanRegistry);
    assert_eq!(s.kind(MINTER), PendingTargetKind::Minter);
    assert_eq!(s.kind(SECURITY), PendingTargetKind::SecurityRegistry);
    assert_eq!(s.kind("CUNKNOWN"), PendingTargetKind::Other);
    let partial = TargetScope {
        loan_registry: Some(LOAN_REGISTRY),
        ..TargetScope::default()
    };
    assert_eq!(partial.kind(MINTER), PendingTargetKind::Other);
    assert_eq!(partial.targets(), vec![LOAN_REGISTRY.to_owned()]);
    assert_eq!(
        s.targets(),
        vec![
            LOAN_REGISTRY.to_owned(),
            MINTER.to_owned(),
            SECURITY.to_owned()
        ]
    );
    assert!(TargetScope::default().targets().is_empty());
}

#[test]
fn the_mapping_keeps_the_stored_values() {
    let row = op_row(3, &"ab".repeat(32), 2, R, SECURITY);
    let op = pending_operation(&row, &scope(), R + 10).unwrap();
    assert_eq!(op.operation_id, row.operation_id);
    assert_eq!(op.nonce, 2);
    assert_eq!(op.args_xdr, "AAAAAQ==");
    assert_eq!(op.args, json!([0, 145_000, "1816128000"]));
    assert_eq!(op.ready_at, "2025-11-16T00:00:00Z");
    assert_eq!(op.expires_at, "2025-11-23T00:00:00Z");
    assert_eq!(op.target_kind, PendingTargetKind::SecurityRegistry);
    assert_eq!(op.state, PendingOperationState::Ready);
}

#[test]
fn a_nonce_above_u32_is_dropped() {
    let row = op_row(3, "aa", i64::from(u32::MAX) + 1, R, SECURITY);
    assert!(pending_operation(&row, &scope(), R).is_none());
    let ok = op_row(3, "aa", i64::from(u32::MAX), R, SECURITY);
    assert_eq!(pending_operation(&ok, &scope(), R).unwrap().nonce, u32::MAX);
}

#[test]
fn grouping_keys_by_chain_and_loan_and_sorts_each_list() {
    let rows = vec![
        op_row(7, "bb", 1, R + 100, SECURITY),
        op_row(0, "zz", 1, R, MINTER),
        op_row(7, "aa", 2, R, SECURITY),
        op_row(7, "aa", 1, R, SECURITY),
        op_row(7, "00", 9, R + 100, SECURITY),
    ];
    let grouped = group_by_loan(STELLAR, &rows, &scope(), R);
    assert_eq!(grouped.len(), 2);
    let zero = &grouped[&(STELLAR, "0".to_owned())];
    assert_eq!(zero.len(), 1);
    let seven: Vec<(&str, u32)> = grouped[&(STELLAR, "7".to_owned())]
        .iter()
        .map(|o| (o.operation_id.as_str(), o.nonce))
        .collect();
    assert_eq!(seven, vec![("aa", 1), ("aa", 2), ("00", 9), ("bb", 1)]);
}

#[test]
fn the_json_has_exactly_the_spec_keys() {
    let row = op_row(3, "aa", 1, R, LOAN_REGISTRY);
    let op = pending_operation(&row, &scope(), R - 1).unwrap();
    let v = serde_json::to_value(&op).unwrap();
    let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut expected = vec![
        "operation_id",
        "nonce",
        "caller",
        "target",
        "target_kind",
        "function",
        "args_xdr",
        "args",
        "ready_at",
        "expires_at",
        "state",
    ];
    expected.sort_unstable();
    assert_eq!(keys, expected);
    assert_eq!(v["state"], "waiting");
    assert_eq!(v["target_kind"], "loan_registry");
    assert_eq!(v["nonce"], 1);
}

#[test]
fn attach_fills_only_the_matching_chain_and_loan() {
    let other = STELLAR + 1;
    let mut resp = book(&[
        make_loan(STELLAR, 1),
        make_loan(STELLAR, 2),
        make_loan(other, 1),
        make_loan(EVM, 1),
    ]);
    let mut by_loan: HashMap<(i64, String), Vec<PendingOperation>> = HashMap::new();
    by_loan.extend(group_by_loan(
        STELLAR,
        &[op_row(1, "aa", 1, R, SECURITY)],
        &scope(),
        R,
    ));
    by_loan.extend(group_by_loan(
        other,
        &[
            op_row(1, "bb", 1, R, SECURITY),
            op_row(1, "cc", 1, R, MINTER),
        ],
        &scope(),
        R,
    ));
    attach_pending_operations(&mut resp, &by_loan);
    let json = serde_json::to_value(&resp).unwrap();

    assert_eq!(
        entry(&json, STELLAR, "1")["pending_operations"][0]["operation_id"],
        "aa"
    );
    assert_eq!(
        entry(&json, other, "1")["pending_operations"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for miss in [entry(&json, STELLAR, "2"), entry(&json, EVM, "1")] {
        assert_eq!(miss["pending_operations"], json!([]));
    }
}

#[test]
fn an_unattached_entry_serializes_an_empty_array() {
    let resp = book(&[make_loan(EVM, 1)]);
    let text = serde_json::to_string(&resp).unwrap();
    assert!(text.contains("\"pending_operations\":[]"));
}

#[test]
fn the_security_response_starts_with_an_empty_array() {
    let response = build_security_response(
        STELLAR,
        SECURITY,
        "7",
        &LoanSecurityRows::default(),
        1_000,
        &MarkInputs::default(),
    );
    let v = serde_json::to_value(response).unwrap();
    assert_eq!(v["pending_operations"], json!([]));
}

fn enum_values(doc: &Value, name: &str) -> Vec<String> {
    let mut values: Vec<String> = doc["components"]["schemas"][name]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();
    values.sort();
    values
}

#[test]
fn the_openapi_lists_a_required_array_and_both_enums() {
    for (doc, schema) in [
        (
            serde_json::to_value(LoanBookDoc::openapi()).unwrap(),
            "LoanBookEntry",
        ),
        (
            serde_json::to_value(LoanSecurityDoc::openapi()).unwrap(),
            "LoanSecurityResponse",
        ),
    ] {
        let s = &doc["components"]["schemas"][schema];
        let prop = &s["properties"]["pending_operations"];
        assert_eq!(prop["type"], "array", "{schema}");
        assert_eq!(
            prop["items"]["$ref"], "#/components/schemas/PendingOperation",
            "{schema}"
        );
        let required = s["required"].as_array().unwrap();
        assert!(
            required.iter().any(|r| r == "pending_operations"),
            "{schema}"
        );
        assert_eq!(
            enum_values(&doc, "PendingOperationState"),
            ["expired", "ready", "waiting"]
        );
        assert_eq!(
            enum_values(&doc, "PendingTargetKind"),
            ["loan_registry", "minter", "other", "security_registry"]
        );
    }
}
