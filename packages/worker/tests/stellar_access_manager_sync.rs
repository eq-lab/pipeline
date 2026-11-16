// spec: docs/references/access-manager-events.md#sync-loop
mod stellar_access_manager_support;

use std::time::{Duration, Instant};

use pipeline_worker::indexer::stellar::access_manager_sync::{
    classify_transaction, sync_once, TxFetch, ROWS_PER_CYCLE,
};
use pipeline_worker::indexer::stellar::rpc::GetTransactionResponse;
use pipeline_worker::indexer::stellar::supervise::KeyedBackoff;
use serde_json::json;
use shared::access_manager_repo::OpStatus;
use stellar_access_manager_support::*;
use stellar_xdr::curr::ScVal;

const WHEN: u64 = 1_794_664_989;

fn amend_id() -> String {
    hex_id(&op_id(
        LOAN_REGISTRY,
        "amend_economics",
        &amend_args(),
        CALLER,
    ))
}

fn amend_schedule_tx() -> String {
    schedule_envelope(LOAN_REGISTRY, "amend_economics", amend_args(), WHEN, CALLER)
}

fn amend_execute_tx() -> String {
    execute_envelope(LOAN_REGISTRY, "amend_economics", amend_args(), CALLER)
}

fn sched_row(id: i64, tx: &str, nonce: u32) -> shared::access_manager_repo::AmLogRow {
    scheduled_row(
        id,
        tx,
        &amend_id(),
        LOAN_REGISTRY,
        "amend_economics",
        nonce,
        WHEN,
    )
}

async fn run(
    store: &MemStore,
    tx: &FakeTx,
    backoff: &mut KeyedBackoff<i64>,
    now: Instant,
) -> usize {
    sync_once(store, tx, &config(), backoff, now).await.unwrap()
}

#[tokio::test]
async fn schedule_with_recovered_args_becomes_a_pending_row() {
    let store = MemStore::with_rows(vec![sched_row(5, "txA", 0)]);
    let tx = FakeTx::found("txA", amend_schedule_tx());
    let n = run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    assert_eq!(n, 1);
    let ops = store.ops();
    assert_eq!(ops.len(), 1);
    let op = &ops[0];
    assert_eq!(op.status, OpStatus::Pending);
    assert_eq!(op.new.operation_id, amend_id());
    assert_eq!(
        op.new.args_xdr.as_deref(),
        Some(b64(&amend_args()).as_str())
    );
    assert_eq!(op.new.args_json, Some(json!([0, 145_000, "1816128000"])));
    assert_eq!(op.new.ready_at, WHEN);
    assert_eq!(op.expires_at, WHEN as i64 + 604_800);
    assert_eq!(op.new.loan_id, Some(0));
    assert_eq!(op.new.record_id, None);
    assert_eq!(op.new.source_log_id, 5);
    assert_eq!(op.new.schedule_tx_hash, "txA");
    assert_eq!(store.watermark_now(), 5);
}

#[tokio::test]
async fn id_mismatch_stores_the_row_without_args() {
    let other = schedule_envelope(
        LOAN_REGISTRY,
        "amend_economics",
        vec_val(vec![ScVal::U32(0), ScVal::U32(1), ScVal::U64(2)]),
        WHEN,
        CALLER,
    );
    let store = MemStore::with_rows(vec![sched_row(1, "txA", 0)]);
    let tx = FakeTx::found("txA", other);
    run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    let ops = store.ops();
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0].new.args_xdr, None);
    assert_eq!(ops[0].new.args_json, None);
    assert_eq!(ops[0].new.loan_id, None);
    assert_eq!(store.watermark_now(), 1);
}

#[tokio::test]
async fn schedule_then_execute_in_one_batch_is_executed() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txA", 0),
        executed_row(2, "txB", LOAN_REGISTRY, "amend_economics"),
    ]);
    let tx = FakeTx::found("txA", amend_schedule_tx());
    tx.set("txB", Scripted::Found(amend_execute_tx()));
    let n = run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    assert_eq!(n, 2);
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Executed);
    assert_eq!(ops[0].closed_tx_hash.as_deref(), Some("txB"));
    assert_eq!(store.watermark_now(), 2);
}

#[tokio::test]
async fn schedule_then_cancel_in_one_batch_is_canceled() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txA", 0),
        canceled_row(2, "txC", &amend_id(), 0),
    ]);
    let tx = FakeTx::found("txA", amend_schedule_tx());
    run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Canceled);
    assert_eq!(ops[0].closed_tx_hash.as_deref(), Some("txC"));
    assert_eq!(tx.call_count(), 1);
}

#[tokio::test]
async fn cancel_of_an_unknown_operation_is_a_noop_that_advances() {
    let store = MemStore::with_rows(vec![canceled_row(7, "txC", &amend_id(), 0)]);
    let tx = FakeTx::default();
    let n = run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    assert_eq!(n, 1);
    assert!(store.ops().is_empty());
    assert_eq!(store.watermark_now(), 7);
    assert_eq!(tx.call_count(), 0);
}

#[tokio::test]
async fn execute_touches_only_the_newest_schedule_of_the_id() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txA", 0),
        sched_row(2, "txA2", 1),
        executed_row(3, "txB", LOAN_REGISTRY, "amend_economics"),
    ]);
    let tx = FakeTx::found("txA", amend_schedule_tx());
    tx.set("txA2", Scripted::Found(amend_schedule_tx()));
    tx.set("txB", Scripted::Found(amend_execute_tx()));
    run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    let ops = store.ops();
    assert_eq!(ops.len(), 2);
    assert_eq!(ops[0].new.nonce, 0);
    assert_eq!(ops[0].status, OpStatus::Pending);
    assert_eq!(ops[1].new.nonce, 1);
    assert_eq!(ops[1].status, OpStatus::Executed);
}

fn exec_row(id: i64, tx: &str) -> shared::access_manager_repo::AmLogRow {
    executed_row(id, tx, LOAN_REGISTRY, "amend_economics")
}

fn tx_for(hashes: &[&str]) -> FakeTx {
    let tx = FakeTx::default();
    for h in hashes {
        tx.set(h, Scripted::Found(amend_schedule_tx()));
    }
    tx
}

async fn run_fresh(store: &MemStore, tx: &FakeTx) {
    run(store, tx, &mut KeyedBackoff::default(), Instant::now()).await;
}

#[tokio::test]
async fn a_reschedule_after_the_nonce_reset_gets_its_own_row() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txS1", 1),
        exec_row(2, "txE1"),
        sched_row(3, "txS2", 1),
    ]);
    let tx = tx_for(&["txS1", "txS2"]);
    tx.set("txE1", Scripted::Found(amend_execute_tx()));
    run_fresh(&store, &tx).await;
    let ops = store.ops();
    assert_eq!(ops.len(), 2);
    assert_eq!(ops[0].status, OpStatus::Executed);
    assert_eq!(ops[0].closed_tx_hash.as_deref(), Some("txE1"));
    assert_eq!(ops[1].status, OpStatus::Pending);
    assert_eq!(ops[1].new.source_log_id, 3);
}

#[tokio::test]
async fn cancel_after_a_reset_closes_only_the_newest_schedule() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txS1", 1),
        canceled_row(2, "txC1", &amend_id(), 1),
        sched_row(3, "txS2", 1),
        canceled_row(4, "txC2", &amend_id(), 1),
    ]);
    run_fresh(&store, &tx_for(&["txS1", "txS2"])).await;
    let ops = store.ops();
    assert_eq!(ops.len(), 2);
    assert_eq!(ops[0].status, OpStatus::Canceled);
    assert_eq!(ops[0].closed_tx_hash.as_deref(), Some("txC1"));
    assert_eq!(ops[1].status, OpStatus::Canceled);
    assert_eq!(ops[1].closed_tx_hash.as_deref(), Some("txC2"));
}

#[tokio::test]
async fn execute_after_a_reset_skips_a_stale_pending_row() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txS1", 3),
        sched_row(2, "txS2", 1),
        exec_row(3, "txE"),
    ]);
    let tx = tx_for(&["txS1", "txS2"]);
    tx.set("txE", Scripted::Found(amend_execute_tx()));
    run_fresh(&store, &tx).await;
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Pending);
    assert_eq!(ops[1].status, OpStatus::Executed);
}

#[tokio::test]
async fn cancel_naming_another_nonce_than_the_newest_schedule_changes_nothing() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txS1", 2),
        sched_row(2, "txS2", 1),
        canceled_row(3, "txC", &amend_id(), 2),
    ]);
    run_fresh(&store, &tx_for(&["txS1", "txS2"])).await;
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Pending);
    assert_eq!(ops[1].status, OpStatus::Pending);
    assert_eq!(store.watermark_now(), 3);
}

#[tokio::test]
async fn replay_after_a_reset_never_closes_the_later_schedule() {
    let closes = [exec_row(2, "txE1"), canceled_row(2, "txE1", &amend_id(), 1)];
    for close in closes {
        let store = MemStore::with_rows(vec![
            sched_row(1, "txS1", 1),
            close,
            sched_row(3, "txS2", 1),
        ]);
        let tx = tx_for(&["txS1", "txS2"]);
        tx.set("txE1", Scripted::Found(amend_execute_tx()));
        run_fresh(&store, &tx).await;
        let before = store.ops();
        store.reset_watermark();
        run_fresh(&store, &tx).await;
        assert_eq!(store.ops(), before);
        assert_eq!(store.ops().len(), 2);
        assert_eq!(store.ops()[1].status, OpStatus::Pending);
    }
}

#[tokio::test]
async fn replay_of_a_close_never_falls_back_to_an_older_pending_row() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txS1", 1),
        sched_row(2, "txS2", 1),
        canceled_row(3, "txC2", &amend_id(), 1),
    ]);
    let tx = tx_for(&["txS1", "txS2"]);
    run_fresh(&store, &tx).await;
    store.reset_watermark();
    run_fresh(&store, &tx).await;
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Pending);
    assert_eq!(ops[1].status, OpStatus::Canceled);
}

#[tokio::test]
async fn newest_is_by_ledger_then_log_id() {
    let mut low_id_high_ledger = sched_row(1, "txS1", 1);
    low_id_high_ledger.block_number = 6_000_000;
    let mut high_id_low_ledger = sched_row(2, "txS2", 2);
    high_id_low_ledger.block_number = 5_900_000;
    let store = MemStore::with_rows(vec![
        low_id_high_ledger,
        high_id_low_ledger,
        exec_row(3, "txE"),
    ]);
    let tx = tx_for(&["txS1", "txS2"]);
    tx.set("txE", Scripted::Found(amend_execute_tx()));
    run_fresh(&store, &tx).await;
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Executed);
    assert_eq!(ops[1].status, OpStatus::Pending);
}

#[tokio::test]
async fn immediate_execute_never_fetches() {
    let store = MemStore::with_rows(vec![executed_row(4, "txI", MINTER, "mint")]);
    let tx = FakeTx::default();
    let n = run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    assert_eq!(n, 1);
    assert_eq!(tx.call_count(), 0);
    assert!(store.ops().is_empty());
    assert_eq!(store.watermark_now(), 4);
}

#[tokio::test]
async fn execute_without_a_matching_invocation_changes_nothing() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txA", 0),
        executed_row(2, "txB", LOAN_REGISTRY, "amend_economics"),
    ]);
    let tx = FakeTx::found("txA", amend_schedule_tx());
    tx.set(
        "txB",
        Scripted::Found(execute_envelope(
            LOAN_REGISTRY,
            "amend_economics",
            vec_val(vec![ScVal::U32(9)]),
            CALLER,
        )),
    );
    run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    assert_eq!(store.ops()[0].status, OpStatus::Pending);
    assert_eq!(store.watermark_now(), 2);
}

#[tokio::test]
async fn retryable_failures_stop_the_cycle_and_resume_after_the_backoff() {
    for failure in [Scripted::NotYet, Scripted::Fail] {
        let store = MemStore::with_rows(vec![
            canceled_row(1, "txC", &amend_id(), 0),
            sched_row(2, "txA", 0),
            canceled_row(3, "txC3", &amend_id(), 0),
        ]);
        let tx = FakeTx::default();
        tx.set("txA", failure);
        let mut backoff = KeyedBackoff::default();
        let now = Instant::now();

        assert_eq!(run(&store, &tx, &mut backoff, now).await, 1);
        assert_eq!(store.watermark_now(), 1);

        assert_eq!(run(&store, &tx, &mut backoff, now).await, 0);
        assert_eq!(store.watermark_now(), 1);
        assert_eq!(tx.call_count(), 1);

        tx.set("txA", Scripted::Found(amend_schedule_tx()));
        let later = now + Duration::from_secs(61);
        assert_eq!(run(&store, &tx, &mut backoff, later).await, 2);
        assert_eq!(store.watermark_now(), 3);
        assert_eq!(store.ops()[0].status, OpStatus::Canceled);
    }
}

#[tokio::test]
async fn schedule_beyond_retention_is_stored_without_args() {
    let store = MemStore::with_rows(vec![sched_row(1, "txOld", 0)]);
    let tx = FakeTx::default();
    tx.set("txOld", Scripted::BeyondRetention);
    run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    let ops = store.ops();
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0].new.args_xdr, None);
    assert_eq!(ops[0].new.loan_id, None);
    assert_eq!(ops[0].status, OpStatus::Pending);
    assert_eq!(store.watermark_now(), 1);
}

#[tokio::test]
async fn execute_beyond_retention_leaves_the_row_pending() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txA", 0),
        executed_row(2, "txOld", LOAN_REGISTRY, "amend_economics"),
    ]);
    let tx = FakeTx::found("txA", amend_schedule_tx());
    tx.set("txOld", Scripted::BeyondRetention);
    run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    assert_eq!(store.ops()[0].status, OpStatus::Pending);
    assert_eq!(store.watermark_now(), 2);
}

#[tokio::test]
async fn replaying_from_a_reset_watermark_changes_nothing() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txA", 0),
        executed_row(2, "txB", LOAN_REGISTRY, "amend_economics"),
        canceled_row(3, "txC", &amend_id(), 5),
    ]);
    let tx = FakeTx::found("txA", amend_schedule_tx());
    tx.set("txB", Scripted::Found(amend_execute_tx()));
    run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    let before = store.ops();
    store.reset_watermark();
    run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    assert_eq!(store.ops(), before);
    assert_eq!(store.ops()[0].status, OpStatus::Executed);
    assert_eq!(store.watermark_now(), 3);
}

#[tokio::test]
async fn two_rows_from_one_transaction_fetch_once() {
    let a = sched_row(1, "txA", 0);
    let other_args = vec_val(vec![ScVal::U32(3)]);
    let other_id = hex_id(&op_id(LOAN_REGISTRY, "cure", &other_args, CALLER));
    let b = scheduled_row(2, "txA", &other_id, LOAN_REGISTRY, "cure", 0, WHEN);
    let envelope = shared_envelope(&other_args);
    let store = MemStore::with_rows(vec![a, b]);
    let tx = FakeTx::found("txA", envelope);
    run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await;
    assert_eq!(tx.call_count(), 1);
    let ops = store.ops();
    assert_eq!(ops.len(), 2);
    assert!(ops.iter().all(|o| o.new.args_xdr.is_some()));
}

fn shared_envelope(other_args: &ScVal) -> String {
    envelope_b64(vec![
        invoke_op(
            AM,
            "schedule",
            schedule_call(LOAN_REGISTRY, "amend_economics", amend_args(), WHEN, CALLER),
            vec![],
        ),
        invoke_op(
            AM,
            "schedule",
            schedule_call(LOAN_REGISTRY, "cure", other_args.clone(), WHEN, CALLER),
            vec![],
        ),
    ])
}

#[tokio::test]
async fn one_call_is_capped_at_rows_per_cycle() {
    let total = ROWS_PER_CYCLE + 5;
    let rows = (1..=total)
        .map(|i| canceled_row(i, "txC", &amend_id(), 0))
        .collect();
    let store = MemStore::with_rows(rows);
    let tx = FakeTx::default();
    let mut backoff = KeyedBackoff::default();
    assert_eq!(
        run(&store, &tx, &mut backoff, Instant::now()).await,
        ROWS_PER_CYCLE as usize
    );
    assert_eq!(store.watermark_now(), ROWS_PER_CYCLE);
    assert_eq!(run(&store, &tx, &mut backoff, Instant::now()).await, 5);
    assert_eq!(store.watermark_now(), total);
}

#[tokio::test]
async fn failing_apply_backs_off_without_advancing_and_retries_later() {
    let store = MemStore::with_rows(vec![
        canceled_row(1, "txC", &amend_id(), 0),
        canceled_row(2, "txC2", &amend_id(), 0),
    ]);
    store.state.lock().unwrap().fail_apply = true;
    let tx = FakeTx::default();
    let mut backoff = KeyedBackoff::default();
    let now = Instant::now();

    assert_eq!(run(&store, &tx, &mut backoff, now).await, 0);
    assert_eq!(store.watermark_now(), 0);
    assert_eq!(backoff.failures(1), 1);

    store.state.lock().unwrap().fail_apply = false;
    assert_eq!(run(&store, &tx, &mut backoff, now).await, 0);
    assert_eq!(store.watermark_now(), 0);

    let later = now + Duration::from_secs(61);
    assert_eq!(run(&store, &tx, &mut backoff, later).await, 2);
    assert_eq!(store.watermark_now(), 2);
    assert_eq!(backoff.failures(1), 0);
}

#[tokio::test]
async fn unparsable_params_are_skipped_and_advance() {
    let mut bad = canceled_row(1, "txC", &amend_id(), 0);
    bad.params = json!({ "nonce": "x" });
    let store = MemStore::with_rows(vec![bad]);
    let tx = FakeTx::default();
    assert_eq!(
        run(&store, &tx, &mut KeyedBackoff::default(), Instant::now()).await,
        1
    );
    assert_eq!(store.watermark_now(), 1);
}

fn resp(status: &str, oldest: Option<u64>, envelope: Option<&str>) -> GetTransactionResponse {
    GetTransactionResponse {
        status: status.to_owned(),
        return_value_xdr_base64: None,
        result_xdr_base64: None,
        envelope_xdr_base64: envelope.map(str::to_owned),
        ledger: None,
        oldest_ledger: oldest,
    }
}

#[test]
fn transaction_classification() {
    assert_eq!(
        classify_transaction(&resp("SUCCESS", None, Some("env")), 10).unwrap(),
        TxFetch::Found("env".to_owned())
    );
    assert!(classify_transaction(&resp("SUCCESS", None, None), 10).is_err());
    assert_eq!(
        classify_transaction(&resp("NOT_FOUND", Some(100), None), 150).unwrap(),
        TxFetch::NotYet
    );
    assert_eq!(
        classify_transaction(&resp("NOT_FOUND", Some(100), None), 99).unwrap(),
        TxFetch::BeyondRetention
    );
    assert_eq!(
        classify_transaction(&resp("NOT_FOUND", Some(100), None), 100).unwrap(),
        TxFetch::NotYet
    );
    assert_eq!(
        classify_transaction(&resp("NOT_FOUND", None, None), 99).unwrap(),
        TxFetch::NotYet
    );
    assert!(classify_transaction(&resp("FAILED", None, None), 10).is_err());
}
