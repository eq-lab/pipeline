// spec: docs/references/access-manager-events.md#evm-encoding
mod evm_access_manager_support;

use alloy::primitives::{address, keccak256, Address, B256};
use evm_access_manager_support::*;
use pipeline_worker::indexer::access_manager_evm_parsers::{
    classify_access_manager_topic, decode_call, loan_ref, parse_access_manager_log, EvmExecutedRow,
    EvmScheduledRow, EvmTargets, ACCESS_MANAGER_EVM_ALLOW_LISTED_TOPICS,
};
use pipeline_worker::indexer::access_manager_sync::{AmTopic, CanceledRow, LoanRef};
use serde_json::json;

fn sig(s: &str) -> B256 {
    keccak256(s)
}

fn selector(s: &str) -> String {
    hex_data(&keccak256(s)[..4])
}

fn targets() -> EvmTargets {
    config().targets
}

#[test]
fn topic_hashes_equal_the_contract_signatures() {
    let cases = [
        (
            "OperationScheduled(bytes32,uint32,uint48,address,address,bytes)",
            "0x82a2da5dee54ea8021c6545b4444620291e07ee83be6dd57edb175062715f3b4",
        ),
        (
            "OperationExecuted(bytes32,uint32)",
            "0x76a2a46953689d4861a5d3f6ed883ad7e6af674a21f8e162707159fc9dde614d",
        ),
        (
            "OperationCanceled(bytes32,uint32)",
            "0xbd9ac67a6e2f6463b80927326310338bcbb4bdb7936ce1365ea3e01067e7b9f7",
        ),
        (
            "RoleLabel(uint64,string)",
            "0x1256f5b5ecb89caec12db449738f2fbcd1ba5806cf38f35413f4e5c15bf6a450",
        ),
        (
            "RoleGranted(uint64,address,uint32,uint48,bool)",
            "0xf98448b987f1428e0e230e1f3c6e2ce15b5693eaf31827fbd0b1ec4b424ae7cf",
        ),
        (
            "RoleRevoked(uint64,address)",
            "0xf229baa593af28c41b1d16b748cd7688f0c83aaf92d4be41c44005defe84c166",
        ),
        (
            "RoleAdminChanged(uint64,uint64)",
            "0x1fd6dd7631312dfac2205b52913f99de03b4d7e381d5d27d3dbfe0713e6e6340",
        ),
        (
            "RoleGuardianChanged(uint64,uint64)",
            "0x7a8059630b897b5de4c08ade69f8b90c3ead1f8596d62d10b6c4d14a0afb4ae2",
        ),
        (
            "RoleGrantDelayChanged(uint64,uint32,uint48)",
            "0xfeb69018ee8b8fd50ea86348f1267d07673379f72cffdeccec63853ee8ce8b48",
        ),
        (
            "TargetClosed(address,bool)",
            "0x90d4e7bb7e5d933792b3562e1741306f8be94837e1348dacef9b6f1df56eb138",
        ),
        (
            "TargetFunctionRoleUpdated(address,bytes4,uint64)",
            "0x9ea6790c7dadfd01c9f8b9762b3682607af2c7e79e05a9f9fdf5580dde949151",
        ),
        (
            "TargetAdminDelayUpdated(address,uint32,uint48)",
            "0xa56b76017453f399ec2327ba00375dbfb1fd070ff854341ad6191e6a2e2de19c",
        ),
    ];
    for (signature, topic) in cases {
        assert_eq!(sig(signature), b256(topic), "{signature}");
    }
}

#[test]
fn emitted_topics_match_the_decoder_constants() {
    assert_eq!(
        classify_access_manager_topic(b256(SCHEDULE_TOPIC)),
        AmTopic::Scheduled
    );
    assert_eq!(
        classify_access_manager_topic(b256(CANCEL_TOPIC)),
        AmTopic::Canceled
    );
    assert_eq!(
        classify_access_manager_topic(b256(EXECUTE_TOPIC)),
        AmTopic::Executed
    );
    assert_eq!(ACCESS_MANAGER_EVM_ALLOW_LISTED_TOPICS.len(), 9);
    for topic in ACCESS_MANAGER_EVM_ALLOW_LISTED_TOPICS {
        assert_eq!(classify_access_manager_topic(topic), AmTopic::AllowListed);
    }
    assert_eq!(
        classify_access_manager_topic(B256::repeat_byte(1)),
        AmTopic::Unknown
    );
}

#[test]
fn function_selectors_equal_the_contract_signatures() {
    let cases = [
        ("setDefault(uint256)", "0xe0da6b66"),
        ("cure(uint256)", "0xb7e5262a"),
        ("amendEconomics(uint256,uint32,uint64)", "0x00b14774"),
        ("adjustInterest(uint256,int256,bytes32)", "0x6d10dec4"),
        ("writeDown(uint256,uint256)", "0x5bd45aa1"),
        ("closeDefaulted(uint256,uint8)", "0x7892936e"),
        ("reverseRepay(uint256,uint256,bytes32)", "0x0cff7536"),
        ("reverseDisburse(uint256,uint256,bytes32,uint256)", "0x68b77843"),
        ("releaseWithConsent(uint256,bytes32)", "0x115f901f"),
        ("resolveFlag(uint256,uint8,bytes32)", "0xdf84b5b3"),
        ("setInspectors(address[])", "0xa84489a4"),
        ("upgradeToAndCall(address,bytes)", "0x4f1ef286"),
        ("setTerms(uint256,(uint32,uint32,uint32,uint64,uint64,uint8,uint64,uint32,uint32,uint64,uint64,uint32,uint32,uint64,uint64))", "0x45f225f5"),
    ];
    for (signature, expected) in cases {
        assert_eq!(selector(signature), expected, "{signature}");
    }
}

#[test]
fn golden_schedule_decodes() {
    let log =
        parse_access_manager_log(&golden_log(&GOLDEN_SCHEDULE_SET_DEFAULT), AM).expect("decodes");
    assert_eq!(log.event_name, "AccessManagerOperationScheduled");
    assert_eq!(log.contract_address, AM);
    assert_eq!(log.block_number, 8);
    assert_eq!(log.log_index, 0);
    assert_eq!(
        log.tx_hash,
        b256("0x513ac41afcc1adbac874c64c43aac1b1476fad96301b8c9983996066dd66417a")
    );
    assert_eq!(log.block_timestamp, 0);
    assert_eq!(
        log.params,
        json!({
            "operation_id": SET_DEFAULT_ID,
            "caller": CALLER.to_checksum(None),
            "nonce": "1",
            "when": SET_DEFAULT_WHEN.to_string(),
            "target": LOAN_REGISTRY.to_checksum(None),
            "data": SET_DEFAULT_DATA,
        })
    );
}

#[test]
fn golden_reschedule_carries_the_next_nonce() {
    let log = parse_access_manager_log(&golden_log(&GOLDEN_RESCHEDULE_RESOLVE_FLAG), AM).unwrap();
    assert_eq!(log.params["nonce"], "2");
    assert_eq!(log.params["operation_id"], RESOLVE_FLAG_ID);
}

#[test]
fn golden_cancel_and_execute_decode() {
    let canceled = parse_access_manager_log(&golden_log(&GOLDEN_CANCEL_RESOLVE_FLAG), AM).unwrap();
    assert_eq!(canceled.event_name, "AccessManagerOperationCanceled");
    assert_eq!(
        canceled.params,
        json!({ "operation_id": RESOLVE_FLAG_ID, "nonce": "1" })
    );
    let executed = parse_access_manager_log(&golden_log(&GOLDEN_EXECUTE_SET_DEFAULT), AM).unwrap();
    assert_eq!(executed.event_name, "AccessManagerOperationExecuted");
    assert_eq!(
        executed.params,
        json!({ "operation_id": SET_DEFAULT_ID, "nonce": "1" })
    );
}

#[test]
fn wrong_topic_count_or_truncated_data_is_dropped() {
    let mut topics: Vec<B256> = GOLDEN_SCHEDULE_SET_DEFAULT
        .0
        .iter()
        .map(|t| b256(t))
        .collect();
    let data = data_bytes(GOLDEN_SCHEDULE_SET_DEFAULT.1);
    topics.pop();
    assert!(parse_access_manager_log(&log_at(AM, topics, data.clone(), 8), AM).is_none());
    let topics: Vec<B256> = GOLDEN_SCHEDULE_SET_DEFAULT
        .0
        .iter()
        .map(|t| b256(t))
        .collect();
    let truncated = data[..data.len() - 40].to_vec();
    assert!(parse_access_manager_log(&log_at(AM, topics, truncated, 8), AM).is_none());
}

#[test]
fn a_log_from_another_address_is_dropped() {
    let mut log = golden_log(&GOLDEN_SCHEDULE_SET_DEFAULT);
    log.inner.address = OTHER;
    assert!(parse_access_manager_log(&log, AM).is_none());
}

#[test]
fn a_log_without_block_metadata_is_dropped() {
    let mut log = golden_log(&GOLDEN_SCHEDULE_SET_DEFAULT);
    log.block_number = None;
    assert!(parse_access_manager_log(&log, AM).is_none());
}

#[test]
fn allow_listed_topics_are_dropped_silently() {
    assert!(parse_access_manager_log(&golden_log(&GOLDEN_ROLE_GRANTED), AM).is_none());
    for topic in ACCESS_MANAGER_EVM_ALLOW_LISTED_TOPICS {
        assert!(parse_access_manager_log(&log_at(AM, vec![topic], vec![], 1), AM).is_none());
    }
}

#[test]
fn an_unknown_topic_is_dropped() {
    let log = log_at(AM, vec![B256::repeat_byte(7)], vec![], 1);
    assert!(parse_access_manager_log(&log, AM).is_none());
    assert!(parse_access_manager_log(&log_at(AM, vec![], vec![], 1), AM).is_none());
}

#[test]
fn scheduled_row_round_trips_and_rejects_bad_params() {
    let params = json!({
        "operation_id": SET_DEFAULT_ID,
        "caller": CALLER.to_checksum(None),
        "nonce": "3",
        "when": "99",
        "target": LOAN_REGISTRY.to_checksum(None),
        "data": SET_DEFAULT_DATA,
    });
    let row = EvmScheduledRow::from_params(&params).expect("parses");
    assert_eq!(row.nonce, 3);
    assert_eq!(row.when, 99);
    assert_eq!(row.data, SET_DEFAULT_DATA);
    for key in ["operation_id", "caller", "nonce", "when", "target", "data"] {
        let mut broken = params.clone();
        broken.as_object_mut().unwrap().remove(key);
        assert!(EvmScheduledRow::from_params(&broken).is_none(), "{key}");
    }
    let mut bad = params.clone();
    bad["nonce"] = json!("x");
    assert!(EvmScheduledRow::from_params(&bad).is_none());
    bad = params.clone();
    bad["when"] = json!(99);
    assert!(EvmScheduledRow::from_params(&bad).is_none());
}

#[test]
fn executed_and_canceled_rows_round_trip() {
    let params = json!({ "operation_id": SET_DEFAULT_ID, "nonce": "2" });
    let executed = EvmExecutedRow::from_params(&params).unwrap();
    assert_eq!(executed.operation_id, SET_DEFAULT_ID);
    assert_eq!(executed.nonce, 2);
    let canceled = CanceledRow::from_params(&params).unwrap();
    assert_eq!(canceled.nonce, 2);
    assert!(EvmExecutedRow::from_params(&json!({ "nonce": "2" })).is_none());
    assert!(CanceledRow::from_params(&json!({ "operation_id": "a", "nonce": "x" })).is_none());
}

#[test]
fn risk_council_functions_decode_to_name_and_args() {
    let t = targets();
    let d = decode_call(LOAN_REGISTRY, &set_default_data(7), &t);
    assert_eq!(d.function, "setDefault");
    assert_eq!(d.args_json, Some(json!(["7"])));

    let d = decode_call(LOAN_REGISTRY, &amend_data(3, 145_000, 1_816_128_000), &t);
    assert_eq!(d.function, "amendEconomics");
    assert_eq!(
        d.args_json,
        Some(json!(["3", 145_000, 1_816_128_000_u64.to_string()]))
    );

    let d = decode_call(LOAN_REGISTRY, &adjust_interest_data(3, -250), &t);
    assert_eq!(d.function, "adjustInterest");
    assert_eq!(d.args_json, Some(json!(["3", "-250", "cd".repeat(32)])));

    let d = decode_call(MINTER, &reverse_repay_data(4), &t);
    assert_eq!(d.function, "reverseRepay");
    assert_eq!(d.args_json, Some(json!(["4", "2", "02".repeat(32)])));

    let d = decode_call(MINTER, &reverse_disburse_data(4), &t);
    assert_eq!(d.function, "reverseDisburse");
    assert_eq!(d.args_json, Some(json!(["4", "5", "03".repeat(32), "9"])));

    let d = decode_call(SECURITY, &resolve_flag_data(3, 1), &t);
    assert_eq!(d.function, "resolveFlag");
    assert_eq!(d.args_json, Some(json!(["3", 1, "ab".repeat(32)])));

    let d = decode_call(SECURITY, &release_with_consent_data(3), &t);
    assert_eq!(d.function, "releaseWithConsent");
    assert_eq!(d.args_json, Some(json!(["3", "01".repeat(32)])));
}

#[test]
fn upgrade_to_and_call_decodes_on_every_target_without_a_loan() {
    let t = targets();
    let implementation = address!("0x00000000000000000000000000000000000000aa");
    let data = upgrade_to_and_call_data(implementation, &[0xde, 0xad]);
    for target in [LOAN_REGISTRY, MINTER, SECURITY, RECORD_NFT] {
        let d = decode_call(target, &data, &t);
        assert_eq!(d.function, "upgradeToAndCall");
        assert_eq!(
            d.args_json,
            Some(json!([implementation.to_checksum(None), "dead"]))
        );
    }
}

#[test]
fn set_terms_decodes_to_an_object_of_all_fifteen_fields() {
    let d = decode_call(SECURITY, &set_terms_data(7), &targets());
    assert_eq!(d.function, "setTerms");
    let json = d.args_json.expect("args");
    assert_eq!(json[0], "7");
    let terms = json[1].as_object().expect("tuple is an object");
    assert_eq!(terms.len(), 15);
    assert_eq!(terms["advanceRatioBps"], 7000);
    assert_eq!(terms["curePeriod"], "604800");
    assert_eq!(terms["paymentTerm"], 1);
    assert_eq!(terms["defaultBreachAt"], "0");
}

#[test]
fn set_terms_selectors_are_pinned() {
    let old = "setTerms(uint256,(uint32,uint32,uint64,uint64,uint8,uint64,uint32,uint64,uint64,uint32,uint32,uint64))";
    assert_eq!(selector(old), "0x36b14cd2");
    let data = set_terms_f92d719_data(7);
    assert_eq!(hex_data(&data[..4]), "0x36b14cd2");
    assert_eq!(hex_data(&set_terms_data(7)[..4]), "0x45f225f5");
}

#[test]
fn f92d719_set_terms_calldata_decodes() {
    let t = targets();
    let d = decode_call(SECURITY, &set_terms_f92d719_data(7), &t);
    assert_eq!(d.function, "setTerms");
    let json = d.args_json.expect("args");
    assert_eq!(json[0], "7");
    let terms = json[1].as_object().expect("tuple is an object");
    assert_eq!(terms.len(), 12);
    assert_eq!(terms["advanceRatioBps"], 6000);
    assert_eq!(terms["paymentTerm"], 1);
    assert!(!terms.contains_key("defaultRatioBps"));
    let args = d.args.expect("dyn args");
    assert_eq!(loan_ref(SECURITY, "setTerms", &args, &t), LoanRef::Loan(7));
}

#[test]
fn set_inspectors_decodes_addresses_as_eip55() {
    let inspectors: Vec<Address> = vec![
        address!("70997970C51812dc3A010C7d01b50e0d17dc79C8"),
        address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
    ];
    let d = decode_call(RECORD_NFT, &set_inspectors_data(inspectors), &targets());
    assert_eq!(d.function, "setInspectors");
    assert_eq!(
        d.args_json,
        Some(json!([[
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
        ]]))
    );
}

#[test]
fn unknown_selectors_and_targets_give_the_raw_selector() {
    let t = targets();
    let unknown = decode_call(LOAN_REGISTRY, &[0xde, 0xad, 0xbe, 0xef, 1, 2], &t);
    assert_eq!(unknown.function, "0xdeadbeef");
    assert_eq!(unknown.args_json, None);
    assert_eq!(unknown.args, None);

    let unconfigured = decode_call(OTHER, &set_default_data(7), &t);
    assert_eq!(unconfigured.function, "0xe0da6b66");
    assert_eq!(unconfigured.args_json, None);

    let manager_self = decode_call(AM, &data_bytes("0xd1f856ee"), &t);
    assert_eq!(manager_self.function, "0xd1f856ee");
    assert_eq!(manager_self.args_json, None);

    let no_security = EvmTargets {
        security_registry: None,
        record_nft: None,
        ..t
    };
    let unset = decode_call(SECURITY, &resolve_flag_data(3, 1), &no_security);
    assert_eq!(unset.function, "0xdf84b5b3");
    assert_eq!(unset.args_json, None);
}

#[test]
fn a_selector_of_another_target_is_not_decoded() {
    let d = decode_call(MINTER, &set_default_data(7), &targets());
    assert_eq!(d.function, "0xe0da6b66");
}

#[test]
fn a_known_selector_with_garbage_arguments_keeps_the_name() {
    let mut data = data_bytes("0xe0da6b66");
    data.extend_from_slice(&[1, 2, 3]);
    let d = decode_call(LOAN_REGISTRY, &data, &targets());
    assert_eq!(d.function, "setDefault");
    assert_eq!(d.args, None);
    assert_eq!(d.args_json, None);
}
