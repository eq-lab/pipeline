// spec: docs/product-specs/loan-security-state.md#pending-operations
use std::collections::HashMap;

use bigdecimal::BigDecimal;
use pipeline_api::pending_operations::{
    chain_scope, group_by_loan, pending_operation, pending_state, PendingOperation,
    PendingOperationState, PendingTargetKind, TargetScope,
};
use pipeline_api::routes::loan_book::{attach_pending_operations, compute_loan_book, LoanBookDoc};
use pipeline_api::routes::loan_security::LoanSecurityDoc;
use pipeline_api::security_state::{build_security_response, MarkInputs};
use serde_json::{json, Value};
use shared::access_manager_repo::PendingOpRow;
use shared::contract_logs_repo::LoanSnapshotRow;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};
use shared::security_registry::STELLAR_SECURITY_PARAMS;
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
        args_xdr: Some("AAAAAQ==".to_owned()),
        calldata: None,
        args_json: json!([0, 145_000, "1816128000"]),
        ready_at,
        expires_at: ready_at + EXPIRATION,
    }
}

const EVM_LOAN_REGISTRY: &str = "0xdF08fdf0f47272a8Ced33A5f913f6C9D179B0231";
const EVM_MINTER: &str = "0x621BaAb0ced6b11f88019582183b081A118755f4";
const EVM_SECURITY: &str = "0xB51E7f13420D106946376A67Fe5921C63B09BE15";
const EVM_RECORD_NFT: &str = "0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09";
const EVM_CALLER: &str = "0x1234567890AbcdEF1234567890aBcdef12345678";

fn evm_calldata() -> String {
    format!("0xe0da6b66{:0>64}", "7")
}

fn evm_row(loan_id: i64, id: &str, nonce: i64, ready_at: i64, target: &str) -> PendingOpRow {
    PendingOpRow {
        loan_id,
        operation_id: id.to_owned(),
        nonce,
        caller: EVM_CALLER.to_owned(),
        target: target.to_owned(),
        function: "setDefault".to_owned(),
        args_xdr: None,
        calldata: Some(evm_calldata()),
        args_json: json!(["7"]),
        ready_at,
        expires_at: ready_at + EXPIRATION,
    }
}

fn evm_scope() -> TargetScope<'static> {
    TargetScope {
        loan_registry: Some(EVM_LOAN_REGISTRY),
        minter: Some(EVM_MINTER),
        security_registry: Some(EVM_SECURITY),
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
    assert_eq!(op.args_xdr.as_deref(), Some("AAAAAQ=="));
    assert_eq!(op.calldata, None);
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
fn grouping_keys_by_chain_and_loan_and_keeps_row_order() {
    let rows = vec![
        op_row(0, "zz", 1, R, MINTER),
        op_row(7, "aa", 1, R, SECURITY),
        op_row(7, "aa", 2, R, SECURITY),
        op_row(7, "00", 9, R + 100, SECURITY),
        op_row(7, "bb", 1, R + 100, SECURITY),
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
        "calldata",
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
    assert_eq!(v["args_xdr"], "AAAAAQ==");
    assert_eq!(v["calldata"], Value::Null);
}

#[test]
fn an_evm_row_serves_calldata_verbatim_and_a_null_args_xdr() {
    let row = evm_row(7, &"ab".repeat(32), 4, R, EVM_SECURITY);
    let op = pending_operation(&row, &evm_scope(), R + 10).unwrap();
    assert_eq!(op.calldata.as_deref(), Some(evm_calldata().as_str()));
    assert_eq!(op.args_xdr, None);
    assert_eq!(op.function, "setDefault");
    assert_eq!(op.args, json!(["7"]));
    assert_eq!(op.caller, EVM_CALLER);
    assert_eq!(op.target, EVM_SECURITY);
    assert_eq!(op.target_kind, PendingTargetKind::SecurityRegistry);
    assert_eq!(op.ready_at, "2025-11-16T00:00:00Z");
    assert_eq!(op.expires_at, "2025-11-23T00:00:00Z");
    assert_eq!(op.state, PendingOperationState::Ready);
    let v = serde_json::to_value(&op).unwrap();
    assert_eq!(v["args_xdr"], Value::Null);
    assert_eq!(v["calldata"], evm_calldata());
    assert_eq!(v.as_object().unwrap().len(), 12);
    for (now, state) in [
        (R - 1, PendingOperationState::Waiting),
        (R + EXPIRATION, PendingOperationState::Expired),
    ] {
        assert_eq!(
            pending_operation(&row, &evm_scope(), now).unwrap().state,
            state
        );
    }
}

#[test]
fn a_row_with_neither_or_both_encodings_is_dropped() {
    let mut neither = evm_row(7, "aa", 1, R, EVM_SECURITY);
    neither.calldata = None;
    assert!(pending_operation(&neither, &evm_scope(), R).is_none());
    let mut both = evm_row(7, "aa", 1, R, EVM_SECURITY);
    both.args_xdr = Some("AAAAAQ==".to_owned());
    assert!(pending_operation(&both, &evm_scope(), R).is_none());
}

#[test]
fn evm_target_kinds_compare_canonical_eip55_strings_exactly() {
    let s = evm_scope();
    assert_eq!(s.kind(EVM_LOAN_REGISTRY), PendingTargetKind::LoanRegistry);
    assert_eq!(s.kind(EVM_MINTER), PendingTargetKind::Minter);
    assert_eq!(s.kind(EVM_SECURITY), PendingTargetKind::SecurityRegistry);
    assert_eq!(s.kind(EVM_RECORD_NFT), PendingTargetKind::Other);
    assert_eq!(
        s.kind(&EVM_MINTER.to_ascii_lowercase()),
        PendingTargetKind::Other
    );
    assert_eq!(
        s.targets(),
        vec![
            EVM_LOAN_REGISTRY.to_owned(),
            EVM_MINTER.to_owned(),
            EVM_SECURITY.to_owned()
        ]
    );
}

fn addr_map(entries: &[(i64, &str)]) -> HashMap<i64, String> {
    entries.iter().map(|(c, a)| (*c, (*a).to_owned())).collect()
}

#[test]
fn chain_scope_reads_each_target_by_chain_id() {
    let registry = addr_map(&[(EVM, EVM_LOAN_REGISTRY), (STELLAR, LOAN_REGISTRY)]);
    let minter = addr_map(&[(EVM, EVM_MINTER), (STELLAR, MINTER)]);
    let security = addr_map(&[(EVM, EVM_SECURITY), (STELLAR, SECURITY)]);
    let evm = chain_scope(EVM, &registry, &minter, &security);
    assert_eq!(
        evm.targets(),
        vec![
            EVM_LOAN_REGISTRY.to_owned(),
            EVM_MINTER.to_owned(),
            EVM_SECURITY.to_owned()
        ]
    );
    let stellar = chain_scope(STELLAR, &registry, &minter, &security);
    assert_eq!(
        stellar.targets(),
        vec![
            LOAN_REGISTRY.to_owned(),
            MINTER.to_owned(),
            SECURITY.to_owned()
        ]
    );
}

#[test]
fn chain_scope_with_unset_targets_or_an_unknown_chain() {
    let registry = addr_map(&[(EVM, EVM_LOAN_REGISTRY)]);
    let none = HashMap::new();
    let evm = chain_scope(EVM, &registry, &none, &none);
    assert_eq!(evm.minter, None);
    assert_eq!(evm.security_registry, None);
    assert_eq!(evm.targets(), vec![EVM_LOAN_REGISTRY.to_owned()]);
    assert!(chain_scope(5, &registry, &none, &none).targets().is_empty());
}

#[test]
fn evm_rows_group_under_their_chain_and_loan() {
    let rows = vec![
        evm_row(7, "aa", 1, R, EVM_SECURITY),
        evm_row(7, "bb", 2, R + 1, EVM_MINTER),
    ];
    let grouped = group_by_loan(EVM, &rows, &evm_scope(), R);
    assert_eq!(grouped.len(), 1);
    assert_eq!(grouped[&(EVM, "7".to_owned())].len(), 2);
    assert!(!grouped.contains_key(&(STELLAR, "7".to_owned())));
}

#[test]
fn attach_gives_the_same_loan_id_on_each_chain_its_own_list() {
    let mut resp = book(&[make_loan(STELLAR, 7), make_loan(EVM, 7), make_loan(EVM, 8)]);
    let mut by_loan: HashMap<(i64, String), Vec<PendingOperation>> = HashMap::new();
    by_loan.extend(group_by_loan(
        EVM,
        &[evm_row(7, "aa", 1, R, EVM_SECURITY)],
        &evm_scope(),
        R,
    ));
    by_loan.extend(group_by_loan(
        STELLAR,
        &[op_row(7, "bb", 1, R, SECURITY)],
        &scope(),
        R,
    ));
    attach_pending_operations(&mut resp, by_loan);
    let json = serde_json::to_value(&resp).unwrap();
    let evm_op = &entry(&json, EVM, "7")["pending_operations"][0];
    assert_eq!(evm_op["operation_id"], "aa");
    assert_eq!(evm_op["calldata"], evm_calldata());
    assert_eq!(evm_op["args_xdr"], Value::Null);
    let stellar_op = &entry(&json, STELLAR, "7")["pending_operations"][0];
    assert_eq!(stellar_op["operation_id"], "bb");
    assert_eq!(stellar_op["calldata"], Value::Null);
    assert_eq!(stellar_op["args_xdr"], "AAAAAQ==");
    assert_eq!(entry(&json, EVM, "8")["pending_operations"], json!([]));
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
    attach_pending_operations(&mut resp, by_loan);
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
        &STELLAR_SECURITY_PARAMS,
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
        let args = &doc["components"]["schemas"]["PendingOperation"]["properties"]["args"];
        assert_eq!(args["type"], "array", "{schema}");
        assert!(
            args["items"].get("type").is_none() && args["items"].get("$ref").is_none(),
            "{args}"
        );
        assert_eq!(
            prop["items"]["$ref"], "#/components/schemas/PendingOperation",
            "{schema}"
        );
        let required = s["required"].as_array().unwrap();
        assert!(
            required.iter().any(|r| r == "pending_operations"),
            "{schema}"
        );
        let props = &doc["components"]["schemas"]["PendingOperation"];
        let required = props["required"].as_array().unwrap();
        for key in ["args_xdr", "calldata"] {
            assert!(required.iter().any(|r| r == key), "{schema} {key}");
            let ty = &props["properties"][key];
            let nullable = ty["nullable"] == true
                || ty["type"]
                    .as_array()
                    .is_some_and(|t| t.iter().any(|v| v == "null"));
            assert!(nullable, "{schema} {key}: {ty}");
        }
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
