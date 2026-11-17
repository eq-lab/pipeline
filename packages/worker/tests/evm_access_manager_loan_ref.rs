// spec: docs/references/access-manager-events.md#evm-loan-id
mod evm_access_manager_support;

use std::time::Instant;

use alloy::{
    dyn_abi::DynSolValue,
    json_abi::Param,
    primitives::{Address, FixedBytes, I256, U256},
};
use evm_access_manager_support::*;
use pipeline_worker::indexer::access_manager_evm_parsers::{
    args_display_json, decode_call, loan_ref, EvmTargets,
};
use pipeline_worker::indexer::access_manager_evm_sync::sync_once;
use pipeline_worker::indexer::access_manager_sync::LoanRef;
use pipeline_worker::indexer::supervise::KeyedBackoff;
use serde_json::json;

fn targets() -> EvmTargets {
    config().targets
}

fn uint(n: u64) -> DynSolValue {
    DynSolValue::Uint(U256::from(n), 256)
}

fn args1(n: u64) -> Vec<DynSolValue> {
    vec![uint(n), uint(1)]
}

fn param(ty: &str, name: &str, components: Vec<Param>) -> Param {
    Param {
        ty: ty.to_owned(),
        name: name.to_owned(),
        components,
        internal_type: None,
    }
}

#[test]
fn loan_registry_functions_resolve_the_first_arg() {
    for f in [
        "setDefault",
        "cure",
        "amendEconomics",
        "adjustInterest",
        "writeDown",
        "closeDefaulted",
    ] {
        assert_eq!(
            loan_ref(LOAN_REGISTRY, f, &args1(12), &targets()),
            LoanRef::Loan(12),
            "{f}"
        );
    }
}

#[test]
fn loan_zero_is_a_valid_loan() {
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "amendEconomics", &args1(0), &targets()),
        LoanRef::Loan(0)
    );
}

#[test]
fn minter_reverse_repay_and_security_set_terms_resolve_loans() {
    assert_eq!(
        loan_ref(MINTER, "reverseRepay", &args1(4), &targets()),
        LoanRef::Loan(4)
    );
    assert_eq!(
        loan_ref(SECURITY, "setTerms", &args1(0), &targets()),
        LoanRef::Loan(0)
    );
}

#[test]
fn reverse_disburse_is_not_loan_scoped() {
    assert_eq!(
        loan_ref(MINTER, "reverseDisburse", &args1(4), &targets()),
        LoanRef::None
    );
}

#[test]
fn record_functions_resolve_records() {
    for f in ["resolveFlag", "releaseWithConsent"] {
        assert_eq!(
            loan_ref(SECURITY, f, &args1(7), &targets()),
            LoanRef::Record(7),
            "{f}"
        );
    }
}

#[test]
fn unrelated_calls_have_no_reference() {
    let t = targets();
    assert_eq!(
        loan_ref(RECORD_NFT, "setInspectors", &args1(1), &t),
        LoanRef::None
    );
    assert_eq!(
        loan_ref(SECURITY, "setInspectors", &args1(1), &t),
        LoanRef::None
    );
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "unknownFn", &args1(1), &t),
        LoanRef::None
    );
    assert_eq!(loan_ref(MINTER, "cure", &args1(1), &t), LoanRef::None);
    assert_eq!(loan_ref(AM, "cure", &args1(1), &t), LoanRef::None);
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "cure", &[DynSolValue::Bool(true)], &t),
        LoanRef::None
    );
    assert_eq!(loan_ref(LOAN_REGISTRY, "cure", &[], &t), LoanRef::None);
}

#[test]
fn an_id_above_u32_max_has_no_reference() {
    let t = targets();
    let max = u64::from(u32::MAX);
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "cure", &args1(max), &t),
        LoanRef::Loan(u32::MAX)
    );
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "cure", &args1(max + 1), &t),
        LoanRef::None
    );
    assert_eq!(
        loan_ref(SECURITY, "resolveFlag", &args1(max + 1), &t),
        LoanRef::None
    );
    let narrow = [DynSolValue::Uint(U256::from(1), 64)];
    assert_eq!(loan_ref(LOAN_REGISTRY, "cure", &narrow, &t), LoanRef::None);
}

#[test]
fn unconfigured_targets_have_no_reference() {
    let none = EvmTargets {
        security_registry: None,
        record_nft: None,
        ..targets()
    };
    assert_eq!(
        loan_ref(SECURITY, "setTerms", &args1(1), &none),
        LoanRef::None
    );
    assert_eq!(
        loan_ref(OTHER, "cure", &args1(1), &targets()),
        LoanRef::None
    );
}

async fn project_flag(records: &[(i64, i64)]) -> shared::access_manager_repo::NewScheduledOp {
    let data = resolve_flag_data(7, 1);
    let id = op_id(CALLER, SECURITY, &data);
    let store = MemStore::with_rows(vec![scheduled_row(
        1,
        "txA",
        &id,
        SECURITY,
        &hex_data(&data),
        1,
        1_800_000_000,
    )]);
    for (r, l) in records {
        store.state.lock().unwrap().records.insert(*r, *l);
    }
    sync_once(
        &store,
        &config(),
        &mut KeyedBackoff::default(),
        Instant::now(),
    )
    .await
    .unwrap();
    store.ops().remove(0).new
}

#[tokio::test]
async fn record_is_resolved_through_the_store() {
    let op = project_flag(&[(7, 3)]).await;
    assert_eq!(op.record_id, Some(7));
    assert_eq!(op.loan_id, Some(3));
}

#[tokio::test]
async fn unresolved_record_keeps_the_record_id() {
    let op = project_flag(&[]).await;
    assert_eq!(op.record_id, Some(7));
    assert_eq!(op.loan_id, None);
    assert!(op.calldata.is_some());
}

#[tokio::test]
async fn an_unset_security_registry_leaves_the_loan_unresolved() {
    let data = resolve_flag_data(7, 1);
    let id = op_id(CALLER, SECURITY, &data);
    let store = MemStore::with_rows(vec![scheduled_row(
        1,
        "txA",
        &id,
        SECURITY,
        &hex_data(&data),
        1,
        1_800_000_000,
    )]);
    store.state.lock().unwrap().records.insert(7, 3);
    let mut cfg = config();
    cfg.targets.security_registry = None;
    sync_once(&store, &cfg, &mut KeyedBackoff::default(), Instant::now())
        .await
        .unwrap();
    let op = store.ops().remove(0).new;
    assert_eq!(op.function, "0xdf84b5b3");
    assert_eq!(op.record_id, None);
    assert_eq!(op.loan_id, None);
}

#[tokio::test]
async fn reverse_disburse_is_stored_without_a_loan() {
    let data = reverse_disburse_data(4);
    let id = op_id(CALLER, MINTER, &data);
    let store = MemStore::with_rows(vec![scheduled_row(
        1,
        "txA",
        &id,
        MINTER,
        &hex_data(&data),
        1,
        1_800_000_000,
    )]);
    sync_once(
        &store,
        &config(),
        &mut KeyedBackoff::default(),
        Instant::now(),
    )
    .await
    .unwrap();
    let op = store.ops().remove(0).new;
    assert_eq!(op.function, "reverseDisburse");
    assert_eq!(op.args_json, Some(json!(["4", "5", "03".repeat(32), "9"])));
    assert_eq!(op.loan_id, None);
    assert_eq!(op.record_id, None);
}

#[test]
fn display_json_scalars_follow_the_stellar_rules() {
    let params = [
        param("uint8", "a", vec![]),
        param("uint32", "b", vec![]),
        param("uint64", "c", vec![]),
        param("int32", "d", vec![]),
        param("int256", "e", vec![]),
        param("bool", "f", vec![]),
        param("address", "g", vec![]),
        param("bytes32", "h", vec![]),
        param("bytes", "i", vec![]),
        param("bytes4", "j", vec![]),
    ];
    let values = [
        DynSolValue::Uint(U256::from(2), 8),
        DynSolValue::Uint(U256::from(4_000_000_000u64), 32),
        DynSolValue::Uint(U256::from(5), 64),
        DynSolValue::Int(I256::try_from(-5).unwrap(), 32),
        DynSolValue::Int(I256::try_from(-250).unwrap(), 256),
        DynSolValue::Bool(true),
        DynSolValue::Address(CALLER),
        DynSolValue::FixedBytes(FixedBytes::repeat_byte(0xab), 32),
        DynSolValue::Bytes(vec![0xab, 0x01]),
        DynSolValue::FixedBytes(
            FixedBytes::from_slice(&[0xde, 0xad, 0xbe, 0xef].repeat(8)),
            4,
        ),
    ];
    assert_eq!(
        args_display_json(&values, &params),
        json!([
            2,
            4_000_000_000u64,
            "5",
            -5,
            "-250",
            true,
            CALLER.to_checksum(None),
            "ab".repeat(32),
            "ab01",
            "deadbeef"
        ])
    );
}

#[test]
fn display_json_of_wide_integers_is_decimal() {
    let params = [param("uint256", "a", vec![])];
    let big = U256::MAX;
    assert_eq!(
        args_display_json(&[DynSolValue::Uint(big, 256)], &params),
        json!([big.to_string()])
    );
    assert_eq!(
        args_display_json(&[DynSolValue::Uint(U256::ZERO, 256)], &params),
        json!(["0"])
    );
}

#[test]
fn display_json_of_address_arrays_is_eip55() {
    let inspectors: Vec<Address> = vec![CALLER, OTHER];
    let d = decode_call(RECORD_NFT, &set_inspectors_data(inspectors), &targets());
    assert_eq!(
        d.args_json,
        Some(json!([[CALLER.to_checksum(None), OTHER.to_checksum(None)]]))
    );
}

#[test]
fn display_json_of_a_negative_int256_argument() {
    let d = decode_call(LOAN_REGISTRY, &adjust_interest_data(1, -1), &targets());
    assert_eq!(d.args_json.unwrap()[1], json!("-1"));
}

#[test]
fn display_json_of_set_terms_has_all_fifteen_field_names() {
    let d = decode_call(SECURITY, &set_terms_data(7), &targets());
    let json = d.args_json.unwrap();
    let object = json[1].as_object().unwrap();
    let mut names: Vec<&str> = object.keys().map(String::as_str).collect();
    names.sort_unstable();
    let mut expected = [
        "advanceRatioBps",
        "marginCallRatioBps",
        "defaultRatioBps",
        "curePeriod",
        "priceStaleAfter",
        "paymentTerm",
        "gracePeriod",
        "defaultRate",
        "originatorFeeRate",
        "attestationInterval",
        "inspectionInterval",
        "toleranceBps",
        "gradeToleranceBps",
        "marginCallAt",
        "defaultBreachAt",
    ];
    expected.sort_unstable();
    assert_eq!(names, expected);
    assert!(!json.to_string().contains("\\u0000"));
}

#[test]
fn display_json_never_contains_nul() {
    let params = [
        param("string", "a", vec![]),
        param("tuple", "b", vec![param("uint8", "e\0f", vec![])]),
    ];
    let values = [
        DynSolValue::String("a\0b".to_owned()),
        DynSolValue::Tuple(vec![DynSolValue::Uint(U256::from(1), 8)]),
    ];
    let rendered = args_display_json(&values, &params);
    assert_eq!(rendered, json!(["a\u{FFFD}b", { "e\u{FFFD}f": 1 }]));
    assert!(!rendered.to_string().contains("\\u0000"));
}
