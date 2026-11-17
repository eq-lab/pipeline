// spec: docs/references/access-manager-events.md#evm-args-and-operation-id
mod evm_access_manager_support;

use alloy::primitives::{address, Address};
use evm_access_manager_support::*;
use pipeline_worker::indexer::access_manager_evm_parsers::{
    hash_operation, parse_access_manager_log,
};

fn golden_params(golden: &(&[&str], &str, u64)) -> serde_json::Value {
    parse_access_manager_log(&golden_log(golden), AM)
        .expect("decodes")
        .params
}

#[test]
fn hash_operation_equals_the_event_id_for_every_golden_schedule() {
    for (golden, target, data) in [
        (
            &GOLDEN_SCHEDULE_SET_DEFAULT,
            LOAN_REGISTRY,
            SET_DEFAULT_DATA,
        ),
        (&GOLDEN_SCHEDULE_RESOLVE_FLAG, SECURITY, RESOLVE_FLAG_DATA),
        (&GOLDEN_RESCHEDULE_RESOLVE_FLAG, SECURITY, RESOLVE_FLAG_DATA),
    ] {
        let params = golden_params(golden);
        let caller: Address = params["caller"].as_str().unwrap().parse().unwrap();
        assert_eq!(caller, CALLER);
        assert_eq!(
            op_id(caller, target, &data_bytes(data)),
            params["operation_id"].as_str().unwrap()
        );
    }
}

#[test]
fn the_golden_schedule_and_execute_share_the_id() {
    let schedule = golden_params(&GOLDEN_SCHEDULE_SET_DEFAULT);
    let execute = golden_params(&GOLDEN_EXECUTE_SET_DEFAULT);
    assert_eq!(schedule["operation_id"], execute["operation_id"]);
    assert_eq!(schedule["operation_id"], SET_DEFAULT_ID);
}

#[test]
fn a_reschedule_after_a_cancel_keeps_the_id_and_bumps_the_nonce() {
    let first = golden_params(&GOLDEN_SCHEDULE_RESOLVE_FLAG);
    let second = golden_params(&GOLDEN_RESCHEDULE_RESOLVE_FLAG);
    let canceled = golden_params(&GOLDEN_CANCEL_RESOLVE_FLAG);
    assert_eq!(first["operation_id"], second["operation_id"]);
    assert_eq!(first["operation_id"], canceled["operation_id"]);
    assert_eq!(first["nonce"], "1");
    assert_eq!(second["nonce"], "2");
}

#[test]
fn matches_the_cast_keccak_of_the_abi_encoding() {
    let id = hash_operation(
        address!("0000000000000000000000000000000000000001"),
        address!("0000000000000000000000000000000000000002"),
        &[0xde, 0xad, 0xbe, 0xef],
    );
    assert_eq!(
        hex_data(&id),
        "0x12ea28ad3a4380903ec162e2cf59f5f673221798b1aadde8a48622f35003db8f"
    );
}

#[test]
fn any_changed_input_changes_the_id() {
    let data = data_bytes(SET_DEFAULT_DATA);
    let base = op_id(CALLER, LOAN_REGISTRY, &data);
    assert_eq!(base, SET_DEFAULT_ID);
    assert_ne!(op_id(OTHER, LOAN_REGISTRY, &data), base);
    assert_ne!(op_id(CALLER, SECURITY, &data), base);
    let mut flipped = data.clone();
    *flipped.last_mut().unwrap() ^= 1;
    assert_ne!(op_id(CALLER, LOAN_REGISTRY, &flipped), base);
    let mut longer = data;
    longer.push(0);
    assert_ne!(op_id(CALLER, LOAN_REGISTRY, &longer), base);
}
