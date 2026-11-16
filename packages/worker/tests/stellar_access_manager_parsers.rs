// spec: docs/references/access-manager-events.md
mod stellar_access_manager_support;

use pipeline_worker::indexer::stellar::access_manager_parsers::{
    classify_access_manager_topic, dispatch_access_manager, AmTopic, CanceledRow, ExecutedRow,
    ScheduledRow, ACCESS_MANAGER_ALLOW_LISTED_TOPICS,
};
use serde_json::json;
use stellar_access_manager_support::*;
use stellar_xdr::curr::ScVal;

#[test]
fn appendix_schedule_event_decodes() {
    let log = dispatch_access_manager(&amend_event()).expect("decodes");
    assert_eq!(log.event_name, "AccessManagerOperationScheduled");
    assert_eq!(log.contract_address, AM);
    assert_eq!(log.block_number, 5_710_989);
    assert_eq!(log.log_index, 2001);
    assert_eq!(
        log.params,
        json!({
            "operation_id": AMEND_OPERATION_ID,
            "caller": CALLER,
            "nonce": "1",
            "when": "1794664989",
            "target": LOAN_REGISTRY,
            "function": "amend_economics",
        })
    );
}

#[test]
fn schedule_with_wrong_topic_count_is_dropped() {
    let mut raw = amend_event();
    raw.topics_base64.pop();
    assert!(dispatch_access_manager(&raw).is_none());
}

#[test]
fn schedule_with_non_map_value_is_dropped() {
    let mut raw = amend_event();
    raw.value_base64 = b64(&ScVal::U32(1));
    assert!(dispatch_access_manager(&raw).is_none());
}

#[test]
fn schedule_with_vec_value_is_dropped() {
    let mut raw = amend_event();
    raw.value_base64 = b64(&vec_val(vec![ScVal::U32(1), ScVal::U64(2)]));
    assert!(dispatch_access_manager(&raw).is_none());
}

#[test]
fn canceled_event_decodes() {
    let id = [9u8; 32];
    let log = dispatch_access_manager(&canceled_event(&id, 4)).expect("decodes");
    assert_eq!(log.event_name, "AccessManagerOperationCanceled");
    assert_eq!(
        log.params,
        json!({ "operation_id": hex_id(&id), "nonce": "4" })
    );
}

#[test]
fn canceled_with_extra_topic_is_dropped() {
    let mut raw = canceled_event(&[1u8; 32], 0);
    raw.topics_base64.push(b64(&ScVal::U32(1)));
    assert!(dispatch_access_manager(&raw).is_none());
}

#[test]
fn executed_event_decodes() {
    let log =
        dispatch_access_manager(&executed_event(LOAN_REGISTRY, "cure", CALLER)).expect("decodes");
    assert_eq!(log.event_name, "AccessManagerOperationExecuted");
    assert_eq!(
        log.params,
        json!({ "target": LOAN_REGISTRY, "function": "cure", "caller": CALLER })
    );
}

#[test]
fn executed_with_missing_topic_is_dropped() {
    let mut raw = executed_event(LOAN_REGISTRY, "cure", CALLER);
    raw.topics_base64.pop();
    assert!(dispatch_access_manager(&raw).is_none());
}

#[test]
fn allow_listed_topics_are_dropped_silently() {
    for topic in ACCESS_MANAGER_ALLOW_LISTED_TOPICS {
        assert_eq!(classify_access_manager_topic(topic), AmTopic::AllowListed);
        let raw = raw_event(topic, vec![b64(&sym(topic))], b64(&ScVal::Void));
        assert!(dispatch_access_manager(&raw).is_none(), "{topic}");
    }
}

#[test]
fn unknown_topic_is_dropped() {
    assert_eq!(
        classify_access_manager_topic("something_new"),
        AmTopic::Unknown
    );
    let raw = raw_event(
        "something_new",
        vec![b64(&sym("something_new"))],
        b64(&ScVal::Void),
    );
    assert!(dispatch_access_manager(&raw).is_none());
}

#[test]
fn params_round_trip_through_typed_readers() {
    let id = [3u8; 32];
    let sched = dispatch_access_manager(&scheduled_event(&id, CALLER, 2, 1_800_000_000)).unwrap();
    assert_eq!(
        ScheduledRow::from_params(&sched.params),
        Some(ScheduledRow {
            operation_id: hex_id(&id),
            caller: CALLER.to_owned(),
            nonce: 2,
            when: 1_800_000_000,
            target: LOAN_REGISTRY.to_owned(),
            function: "amend_economics".to_owned(),
        })
    );
    let canceled = dispatch_access_manager(&canceled_event(&id, 2)).unwrap();
    assert_eq!(
        CanceledRow::from_params(&canceled.params),
        Some(CanceledRow {
            operation_id: hex_id(&id),
            nonce: 2
        })
    );
    let executed = dispatch_access_manager(&executed_event(SECURITY, "set_terms", OTHER)).unwrap();
    assert_eq!(
        ExecutedRow::from_params(&executed.params),
        Some(ExecutedRow {
            target: SECURITY.to_owned(),
            function: "set_terms".to_owned(),
            caller: OTHER.to_owned(),
        })
    );
}

#[test]
fn typed_readers_reject_missing_or_malformed_fields() {
    assert_eq!(ScheduledRow::from_params(&json!({})), None);
    assert_eq!(
        CanceledRow::from_params(&json!({ "operation_id": "aa", "nonce": "x" })),
        None
    );
    assert_eq!(ExecutedRow::from_params(&json!({ "target": "T" })), None);
}
