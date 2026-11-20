// spec: docs/references/access-manager-events.md#loan-id
mod stellar_access_manager_support;

use std::time::Instant;

use pipeline_worker::indexer::stellar::access_manager_parsers::{
    args_display_json, loan_ref, LoanRef, TargetIds,
};
use pipeline_worker::indexer::stellar::access_manager_sync::sync_once;
use pipeline_worker::indexer::stellar::supervise::KeyedBackoff;
use serde_json::json;
use stellar_access_manager_support::*;
use stellar_xdr::curr::{Int256Parts, ScVal, UInt256Parts};

fn ids() -> TargetIds {
    config().ids
}

fn args1(n: u32) -> ScVal {
    vec_val(vec![ScVal::U32(n), ScVal::U32(1)])
}

#[test]
fn loan_registry_functions_resolve_the_first_arg() {
    for f in [
        "set_default",
        "cure",
        "amend_economics",
        "adjust_interest",
        "write_down",
        "close_defaulted",
    ] {
        assert_eq!(
            loan_ref(LOAN_REGISTRY, f, &args1(12), &ids()),
            LoanRef::Loan(12),
            "{f}"
        );
    }
}

#[test]
fn loan_zero_is_a_valid_loan() {
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "amend_economics", &args1(0), &ids()),
        LoanRef::Loan(0)
    );
}

#[test]
fn minter_reverse_repay_and_security_set_terms_resolve_loans() {
    assert_eq!(
        loan_ref(MINTER, "reverse_repay", &args1(4), &ids()),
        LoanRef::Loan(4)
    );
    assert_eq!(
        loan_ref(SECURITY, "set_terms", &args1(0), &ids()),
        LoanRef::Loan(0)
    );
}

#[test]
fn record_functions_resolve_records() {
    for f in ["resolve_flag", "release_with_consent"] {
        assert_eq!(
            loan_ref(SECURITY, f, &args1(7), &ids()),
            LoanRef::Record(7),
            "{f}"
        );
    }
}

#[test]
fn unrelated_calls_have_no_reference() {
    assert_eq!(
        loan_ref(SECURITY, "set_inspectors", &args1(1), &ids()),
        LoanRef::None
    );
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "unknown_fn", &args1(1), &ids()),
        LoanRef::None
    );
    assert_eq!(loan_ref(MINTER, "cure", &args1(1), &ids()), LoanRef::None);
    assert_eq!(loan_ref(AM, "cure", &args1(1), &ids()), LoanRef::None);
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "cure", &vec_val(vec![ScVal::U64(1)]), &ids()),
        LoanRef::None
    );
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "cure", &vec_val(vec![]), &ids()),
        LoanRef::None
    );
}

#[test]
fn unconfigured_target_has_no_reference() {
    let none = TargetIds::default();
    assert_eq!(
        loan_ref(LOAN_REGISTRY, "cure", &args1(1), &none),
        LoanRef::None
    );
}

async fn project_flag(records: &[(i64, i64)]) -> shared::access_manager_repo::NewScheduledOp {
    let args = vec_val(vec![
        ScVal::U32(7),
        vec_val(vec![sym("Cleared")]),
        bytes_val(&[1; 32]),
    ]);
    let id = hex_id(&op_id(SECURITY, "resolve_flag", &args, CALLER));
    let store = MemStore::with_rows(vec![scheduled_row(
        1,
        "txA",
        &id,
        SECURITY,
        "resolve_flag",
        0,
        1_800_000_000,
    )]);
    for (r, l) in records {
        store.state.lock().unwrap().records.insert(*r, *l);
    }
    let tx = FakeTx::found(
        "txA",
        schedule_envelope(SECURITY, "resolve_flag", args, 1_800_000_000, CALLER),
    );
    sync_once(
        &store,
        &tx,
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
    assert!(op.args_xdr.is_some());
}

#[test]
fn display_json_of_the_appendix_args() {
    assert_eq!(
        args_display_json(&amend_args()),
        json!([0, 145_000, "1816128000"])
    );
}

#[test]
fn display_json_of_a_terms_map_uses_objects_and_enum_arrays() {
    let terms = map_val(vec![
        ("advance_ratio_bps", ScVal::U32(8000)),
        ("cure_period", ScVal::U64(604_800)),
        ("payment_term", vec_val(vec![sym("Lc")])),
    ]);
    let args = vec_val(vec![ScVal::U32(0), terms]);
    assert_eq!(
        args_display_json(&args),
        json!([0, { "advance_ratio_bps": 8000, "cure_period": "604800", "payment_term": ["Lc"] }])
    );
}

#[test]
fn display_json_covers_scalar_kinds() {
    assert_eq!(args_display_json(&ScVal::Bool(true)), json!(true));
    assert_eq!(args_display_json(&ScVal::Void), json!(null));
    assert_eq!(args_display_json(&ScVal::I32(-5)), json!(-5));
    assert_eq!(args_display_json(&ScVal::I64(-5)), json!("-5"));
    assert_eq!(args_display_json(&bytes_val(&[0xab, 0x01])), json!("ab01"));
    assert_eq!(args_display_json(&address_val(CALLER)), json!(CALLER));
    assert_eq!(args_display_json(&address_val(AM)), json!(AM));
    assert_eq!(args_display_json(&sym("Lc")), json!("Lc"));
}

#[test]
fn display_json_of_wide_integers_is_decimal() {
    let u = ScVal::U256(UInt256Parts {
        hi_hi: 0,
        hi_lo: 1,
        lo_hi: 0,
        lo_lo: 5,
    });
    assert_eq!(
        args_display_json(&u),
        json!("340282366920938463463374607431768211461")
    );
    let neg_one = ScVal::I256(Int256Parts {
        hi_hi: -1,
        hi_lo: u64::MAX,
        lo_hi: u64::MAX,
        lo_lo: u64::MAX,
    });
    assert_eq!(args_display_json(&neg_one), json!("-1"));
    assert_eq!(
        args_display_json(&ScVal::U256(UInt256Parts {
            hi_hi: 0,
            hi_lo: 0,
            lo_hi: 0,
            lo_lo: 0,
        })),
        json!("0")
    );
}

#[test]
fn display_json_of_non_symbol_keyed_maps_is_an_entry_array() {
    use stellar_xdr::curr::{ScMap, ScMapEntry, VecM};
    let entries: VecM<ScMapEntry> = vec![ScMapEntry {
        key: ScVal::U32(1),
        val: ScVal::Bool(false),
    }]
    .try_into()
    .unwrap();
    assert_eq!(
        args_display_json(&ScVal::Map(Some(ScMap(entries)))),
        json!([{ "key": 1, "value": false }])
    );
}

#[test]
fn display_json_never_contains_nul() {
    let string = ScVal::String(stellar_xdr::curr::ScString("a\0b".try_into().unwrap()));
    let args = vec_val(vec![
        string,
        sym("c\0d"),
        map_val(vec![("e\0f", ScVal::U32(1))]),
    ]);
    let rendered = args_display_json(&args);
    assert_eq!(
        rendered,
        json!(["a\u{FFFD}b", "c\u{FFFD}d", { "e\u{FFFD}f": 1 }])
    );
    assert!(!rendered.to_string().contains("\\u0000"));
}
