// spec: docs/references/access-manager-events.md#args-recovery
mod stellar_access_manager_support;

use pipeline_worker::indexer::stellar::access_manager_parsers::{
    contract_invocations, execute_candidate_ids, hash_operation, recover_schedule_args,
    ExecutedRow, ScheduledRow,
};
use stellar_access_manager_support::*;
use stellar_xdr::curr::{ScVal, WriteXdr};

fn amend_row() -> ScheduledRow {
    ScheduledRow {
        operation_id: AMEND_OPERATION_ID.to_owned(),
        caller: CALLER.to_owned(),
        nonce: 1,
        when: 1_794_664_989,
        target: LOAN_REGISTRY.to_owned(),
        function: "amend_economics".to_owned(),
    }
}

#[test]
fn golden_vector_envelope_yields_two_candidates_and_the_event_id() {
    let candidates = contract_invocations(AMEND_ENVELOPE, AM, "schedule");
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0], candidates[1]);
    let c = &candidates[0];
    assert_eq!(c.len(), 5);
    assert_eq!(c[2], amend_args());
    let id = hash_operation(&c[4], &c[0], &c[1], &c[2]);
    assert_eq!(hex_id(&id), AMEND_OPERATION_ID);
}

#[test]
fn recover_returns_the_verified_args_and_they_reencode_identically() {
    let candidates = contract_invocations(AMEND_ENVELOPE, AM, "schedule");
    let args = recover_schedule_args(&amend_row(), &candidates).expect("verified");
    assert_eq!(args, amend_args());
    let reencoded = args
        .to_xdr_base64(stellar_xdr::curr::Limits::none())
        .unwrap();
    assert_eq!(reencoded, b64(&amend_args()));
}

#[test]
fn recover_rejects_a_tampered_candidate() {
    let mut candidates = contract_invocations(AMEND_ENVELOPE, AM, "schedule");
    for c in &mut candidates {
        c[2] = vec_val(vec![
            ScVal::U32(0),
            ScVal::U32(145_001),
            ScVal::U64(1_816_128_000),
        ]);
    }
    assert_eq!(recover_schedule_args(&amend_row(), &candidates), None);
}

#[test]
fn recover_without_candidates_is_none() {
    assert_eq!(recover_schedule_args(&amend_row(), &[]), None);
}

#[test]
fn other_contract_or_function_is_ignored() {
    assert!(contract_invocations(AMEND_ENVELOPE, SECURITY, "schedule").is_empty());
    assert!(contract_invocations(AMEND_ENVELOPE, AM, "execute").is_empty());
    assert!(contract_invocations("not-base64-xdr", AM, "schedule").is_empty());
}

#[test]
fn fee_bump_wrapping_still_yields_the_candidate() {
    let op = invoke_op(
        AM,
        "schedule",
        schedule_call(
            LOAN_REGISTRY,
            "amend_economics",
            amend_args(),
            1_794_664_989,
            CALLER,
        ),
        vec![],
    );
    let candidates = contract_invocations(&fee_bump_b64(vec![op]), AM, "schedule");
    assert_eq!(candidates.len(), 1);
    assert_eq!(
        recover_schedule_args(&amend_row(), &candidates),
        Some(amend_args())
    );
}

#[test]
fn auth_tree_sub_invocation_is_found() {
    let nested = invocation(
        AM,
        "schedule",
        schedule_call(
            LOAN_REGISTRY,
            "amend_economics",
            amend_args(),
            1_794_664_989,
            CALLER,
        ),
        vec![],
    );
    let wrapper = invocation(MINTER, "wrapper", vec![], vec![nested]);
    let op = invoke_op(MINTER, "wrapper", vec![], vec![auth_entry(wrapper)]);
    let candidates = contract_invocations(&envelope_b64(vec![op]), AM, "schedule");
    assert_eq!(candidates.len(), 1);
    assert_eq!(
        recover_schedule_args(&amend_row(), &candidates),
        Some(amend_args())
    );
}

#[test]
fn execute_candidates_filter_on_the_triple_and_deduplicate() {
    let args = amend_args();
    let ok = execute_call(LOAN_REGISTRY, "amend_economics", args.clone(), CALLER);
    let other_fn = execute_call(LOAN_REGISTRY, "cure", args.clone(), CALLER);
    let other_target = execute_call(SECURITY, "amend_economics", args.clone(), CALLER);
    let other_caller = execute_call(LOAN_REGISTRY, "amend_economics", args.clone(), OTHER);
    let other_args = execute_call(
        LOAN_REGISTRY,
        "amend_economics",
        vec_val(vec![ScVal::U32(1)]),
        CALLER,
    );
    let row = ExecutedRow {
        target: LOAN_REGISTRY.to_owned(),
        function: "amend_economics".to_owned(),
        caller: CALLER.to_owned(),
    };
    let candidates = vec![
        ok.clone(),
        ok,
        other_fn,
        other_target,
        other_caller,
        other_args,
    ];
    let ids = execute_candidate_ids(&row, &candidates);
    assert_eq!(ids.len(), 2);
    assert_eq!(
        hex_id(&ids[0]),
        hex_id(&op_id(LOAN_REGISTRY, "amend_economics", &args, CALLER))
    );
    assert_ne!(ids[0], ids[1]);
}

#[test]
fn schedule_and_execute_share_the_same_operation_id() {
    let args = amend_args();
    let sched = schedule_call(LOAN_REGISTRY, "amend_economics", args.clone(), 1, CALLER);
    let exec = execute_call(LOAN_REGISTRY, "amend_economics", args.clone(), CALLER);
    let row = ExecutedRow {
        target: LOAN_REGISTRY.to_owned(),
        function: "amend_economics".to_owned(),
        caller: CALLER.to_owned(),
    };
    let from_exec = execute_candidate_ids(&row, &[exec]);
    let from_sched = hash_operation(&sched[4], &sched[0], &sched[1], &sched[2]);
    assert_eq!(from_exec, vec![from_sched]);
}
