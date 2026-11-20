// spec: docs/references/access-manager-events.md#evm-sync-loop
mod evm_access_manager_support;

use std::time::{Duration, Instant};

use evm_access_manager_support::*;
use pipeline_worker::indexer::access_manager_evm_sync::sync_once;
use pipeline_worker::indexer::access_manager_sync::ROWS_PER_CYCLE;
use pipeline_worker::indexer::supervise::KeyedBackoff;
use serde_json::json;
use shared::access_manager_repo::{AmLogRow, OpStatus};

fn sched_row(id: i64, tx: &str, nonce: u32) -> AmLogRow {
    scheduled_row(
        id,
        tx,
        SET_DEFAULT_ID,
        LOAN_REGISTRY,
        SET_DEFAULT_DATA,
        nonce,
        SET_DEFAULT_WHEN,
    )
}

fn cancel_row(id: i64, tx: &str, nonce: u32) -> AmLogRow {
    canceled_row(id, tx, SET_DEFAULT_ID, nonce)
}

fn exec_row(id: i64, tx: &str, nonce: u32) -> AmLogRow {
    executed_row(id, tx, SET_DEFAULT_ID, nonce)
}

async fn run(store: &MemStore, backoff: &mut KeyedBackoff<i64>, now: Instant) -> usize {
    sync_once(store, &config(), backoff, now).await.unwrap()
}

async fn run_fresh(store: &MemStore) -> usize {
    run(store, &mut KeyedBackoff::default(), Instant::now()).await
}

#[tokio::test]
async fn schedule_becomes_a_pending_row_with_calldata_and_args() {
    let store = MemStore::with_rows(vec![sched_row(5, "txA", 1)]);
    assert_eq!(run_fresh(&store).await, 1);
    let ops = store.ops();
    assert_eq!(ops.len(), 1);
    let op = &ops[0];
    assert_eq!(op.status, OpStatus::Pending);
    assert_eq!(op.new.operation_id, SET_DEFAULT_ID);
    assert_eq!(op.new.function, "setDefault");
    assert_eq!(op.new.calldata.as_deref(), Some(SET_DEFAULT_DATA));
    assert_eq!(op.new.args_xdr, None);
    assert_eq!(op.new.args_json, Some(json!(["7"])));
    assert_eq!(op.new.ready_at, SET_DEFAULT_WHEN);
    assert_eq!(op.expires_at, SET_DEFAULT_WHEN as i64 + 604_800);
    assert_eq!(op.new.loan_id, Some(7));
    assert_eq!(op.new.record_id, None);
    assert_eq!(op.new.nonce, 1);
    assert_eq!(op.new.caller, CALLER.to_checksum(None));
    assert_eq!(op.new.target, LOAN_REGISTRY.to_checksum(None));
    assert_eq!(op.new.source_log_id, 5);
    assert_eq!(op.new.schedule_tx_hash, "txA");
    assert_eq!(store.watermark_now(), 5);
}

#[tokio::test]
async fn id_mismatch_stores_the_row_without_calldata_args_or_loan() {
    let wrong_id = "ff".repeat(32);
    let row = scheduled_row(
        1,
        "txA",
        &wrong_id,
        LOAN_REGISTRY,
        SET_DEFAULT_DATA,
        1,
        SET_DEFAULT_WHEN,
    );
    let store = MemStore::with_rows(vec![row]);
    run_fresh(&store).await;
    let ops = store.ops();
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0].new.operation_id, wrong_id);
    assert_eq!(ops[0].new.calldata, None);
    assert_eq!(ops[0].new.args_xdr, None);
    assert_eq!(ops[0].new.args_json, None);
    assert_eq!(ops[0].new.loan_id, None);
    assert_eq!(ops[0].new.record_id, None);
    assert_eq!(ops[0].status, OpStatus::Pending);
    assert_eq!(store.watermark_now(), 1);
}

#[tokio::test]
async fn schedule_then_execute_in_one_batch_is_executed() {
    let store = MemStore::with_rows(vec![sched_row(1, "txA", 1), exec_row(2, "txB", 1)]);
    assert_eq!(run_fresh(&store).await, 2);
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Executed);
    assert_eq!(ops[0].closed_tx_hash.as_deref(), Some("txB"));
    assert_eq!(store.watermark_now(), 2);
}

#[tokio::test]
async fn schedule_then_cancel_in_one_batch_is_canceled() {
    let store = MemStore::with_rows(vec![sched_row(1, "txA", 1), cancel_row(2, "txC", 1)]);
    run_fresh(&store).await;
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Canceled);
    assert_eq!(ops[0].closed_tx_hash.as_deref(), Some("txC"));
}

#[tokio::test]
async fn cancel_or_execute_of_an_unknown_operation_is_a_noop_that_advances() {
    let store = MemStore::with_rows(vec![cancel_row(3, "txC", 1), exec_row(7, "txE", 1)]);
    assert_eq!(run_fresh(&store).await, 2);
    assert!(store.ops().is_empty());
    assert_eq!(store.watermark_now(), 7);
}

#[tokio::test]
async fn execute_touches_only_the_newest_schedule_of_the_id() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txA", 1),
        sched_row(2, "txA2", 2),
        exec_row(3, "txB", 2),
    ]);
    run_fresh(&store).await;
    let ops = store.ops();
    assert_eq!(ops.len(), 2);
    assert_eq!(ops[0].new.nonce, 1);
    assert_eq!(ops[0].status, OpStatus::Pending);
    assert_eq!(ops[1].new.nonce, 2);
    assert_eq!(ops[1].status, OpStatus::Executed);
}

#[tokio::test]
async fn cancel_naming_another_nonce_than_the_newest_schedule_changes_nothing() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txS1", 1),
        sched_row(2, "txS2", 2),
        cancel_row(3, "txC", 1),
    ]);
    run_fresh(&store).await;
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Pending);
    assert_eq!(ops[1].status, OpStatus::Pending);
    assert_eq!(store.watermark_now(), 3);
}

#[tokio::test]
async fn a_reschedule_after_a_cancel_gets_its_own_row() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txS1", 1),
        cancel_row(2, "txC1", 1),
        sched_row(3, "txS2", 2),
        cancel_row(4, "txC2", 2),
    ]);
    run_fresh(&store).await;
    let ops = store.ops();
    assert_eq!(ops.len(), 2);
    assert_eq!(ops[0].status, OpStatus::Canceled);
    assert_eq!(ops[0].closed_tx_hash.as_deref(), Some("txC1"));
    assert_eq!(ops[1].new.nonce, 2);
    assert_eq!(ops[1].status, OpStatus::Canceled);
    assert_eq!(ops[1].closed_tx_hash.as_deref(), Some("txC2"));
}

#[tokio::test]
async fn a_replay_never_closes_the_later_schedule() {
    let closes = [exec_row(2, "txE1", 1), cancel_row(2, "txE1", 1)];
    for close in closes {
        let store = MemStore::with_rows(vec![
            sched_row(1, "txS1", 1),
            close,
            sched_row(3, "txS2", 2),
        ]);
        run_fresh(&store).await;
        let before = store.ops();
        store.reset_watermark();
        run_fresh(&store).await;
        assert_eq!(store.ops(), before);
        assert_eq!(store.ops().len(), 2);
        assert_eq!(store.ops()[1].status, OpStatus::Pending);
    }
}

#[tokio::test]
async fn replay_of_a_close_never_falls_back_to_an_older_pending_row() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txS1", 1),
        sched_row(2, "txS2", 2),
        cancel_row(3, "txC2", 2),
    ]);
    run_fresh(&store).await;
    store.reset_watermark();
    run_fresh(&store).await;
    let ops = store.ops();
    assert_eq!(ops[0].status, OpStatus::Pending);
    assert_eq!(ops[1].status, OpStatus::Canceled);
}

#[tokio::test]
async fn replaying_from_a_reset_watermark_changes_nothing() {
    let store = MemStore::with_rows(vec![
        sched_row(1, "txA", 1),
        exec_row(2, "txB", 1),
        cancel_row(3, "txC", 5),
    ]);
    run_fresh(&store).await;
    let before = store.ops();
    store.reset_watermark();
    run_fresh(&store).await;
    assert_eq!(store.ops(), before);
    assert_eq!(store.ops()[0].status, OpStatus::Executed);
    assert_eq!(store.watermark_now(), 3);
}

#[tokio::test]
async fn an_unknown_selector_is_stored_as_a_raw_selector_with_calldata() {
    let data = data_bytes("0xdeadbeef0102");
    let id = op_id(CALLER, LOAN_REGISTRY, &data);
    let row = scheduled_row(
        1,
        "txA",
        &id,
        LOAN_REGISTRY,
        &hex_data(&data),
        1,
        SET_DEFAULT_WHEN,
    );
    let store = MemStore::with_rows(vec![row]);
    run_fresh(&store).await;
    let op = &store.ops()[0];
    assert_eq!(op.new.function, "0xdeadbeef");
    assert_eq!(op.new.args_json, None);
    assert_eq!(op.new.calldata.as_deref(), Some("0xdeadbeef0102"));
    assert_eq!(op.new.loan_id, None);
}

#[tokio::test]
async fn an_unconfigured_target_is_stored_as_a_raw_selector() {
    let data = data_bytes(SET_DEFAULT_DATA);
    let id = op_id(CALLER, OTHER, &data);
    let row = scheduled_row(1, "txA", &id, OTHER, SET_DEFAULT_DATA, 1, SET_DEFAULT_WHEN);
    let store = MemStore::with_rows(vec![row]);
    run_fresh(&store).await;
    let op = &store.ops()[0];
    assert_eq!(op.new.function, "0xe0da6b66");
    assert_eq!(op.new.args_json, None);
    assert_eq!(op.new.calldata.as_deref(), Some(SET_DEFAULT_DATA));
    assert_eq!(op.new.loan_id, None);
}

#[tokio::test]
async fn invalid_hex_or_short_data_is_skipped_and_advances() {
    for bad in ["0xzz", "0xe0da6b", "e0da6b66", "0x"] {
        let row = scheduled_row(
            4,
            "txA",
            SET_DEFAULT_ID,
            LOAN_REGISTRY,
            bad,
            1,
            SET_DEFAULT_WHEN,
        );
        let store = MemStore::with_rows(vec![row]);
        assert_eq!(run_fresh(&store).await, 1, "{bad}");
        assert!(store.ops().is_empty(), "{bad}");
        assert_eq!(store.watermark_now(), 4, "{bad}");
    }
}

#[tokio::test]
async fn an_unparsable_address_is_skipped_and_advances() {
    let mut row = sched_row(2, "txA", 1);
    row.params["target"] = json!("not-an-address");
    let store = MemStore::with_rows(vec![row]);
    assert_eq!(run_fresh(&store).await, 1);
    assert!(store.ops().is_empty());
    assert_eq!(store.watermark_now(), 2);
}

#[tokio::test]
async fn one_call_is_capped_at_rows_per_cycle() {
    let total = ROWS_PER_CYCLE + 5;
    let rows = (1..=total).map(|i| cancel_row(i, "txC", 1)).collect();
    let store = MemStore::with_rows(rows);
    let mut backoff = KeyedBackoff::default();
    assert_eq!(
        run(&store, &mut backoff, Instant::now()).await,
        ROWS_PER_CYCLE as usize
    );
    assert_eq!(store.watermark_now(), ROWS_PER_CYCLE);
    assert_eq!(run(&store, &mut backoff, Instant::now()).await, 5);
    assert_eq!(store.watermark_now(), total);
}

#[tokio::test]
async fn failing_apply_backs_off_without_advancing_and_retries_later() {
    let store = MemStore::with_rows(vec![cancel_row(1, "txC", 1), cancel_row(2, "txC2", 1)]);
    store.state.lock().unwrap().fail_apply = true;
    let mut backoff = KeyedBackoff::default();
    let now = Instant::now();

    assert_eq!(run(&store, &mut backoff, now).await, 0);
    assert_eq!(store.watermark_now(), 0);
    assert_eq!(backoff.failures(1), 1);

    store.state.lock().unwrap().fail_apply = false;
    assert_eq!(run(&store, &mut backoff, now).await, 0);
    assert_eq!(store.watermark_now(), 0);

    let later = now + Duration::from_secs(61);
    assert_eq!(run(&store, &mut backoff, later).await, 2);
    assert_eq!(store.watermark_now(), 2);
    assert_eq!(backoff.failures(1), 0);
}

#[tokio::test]
async fn unparsable_params_are_skipped_and_advance() {
    let mut bad_cancel = cancel_row(1, "txC", 1);
    bad_cancel.params = json!({ "nonce": "x" });
    let mut bad_exec = exec_row(2, "txE", 1);
    bad_exec.params = json!({ "operation_id": SET_DEFAULT_ID });
    let mut bad_sched = sched_row(3, "txS", 1);
    bad_sched.params = json!({ "operation_id": SET_DEFAULT_ID });
    let store = MemStore::with_rows(vec![bad_cancel, bad_exec, bad_sched]);
    assert_eq!(run_fresh(&store).await, 3);
    assert!(store.ops().is_empty());
    assert_eq!(store.watermark_now(), 3);
}

#[tokio::test]
async fn golden_logs_project_end_to_end() {
    use pipeline_worker::indexer::access_manager_evm_parsers::parse_access_manager_log;
    let goldens = [
        &GOLDEN_SCHEDULE_SET_DEFAULT,
        &GOLDEN_EXECUTE_SET_DEFAULT,
        &GOLDEN_SCHEDULE_RESOLVE_FLAG,
        &GOLDEN_CANCEL_RESOLVE_FLAG,
        &GOLDEN_RESCHEDULE_RESOLVE_FLAG,
    ];
    let rows: Vec<AmLogRow> = goldens
        .iter()
        .enumerate()
        .map(|(i, g)| {
            let log = parse_access_manager_log(&golden_log(g), AM).unwrap();
            AmLogRow {
                id: i as i64 + 1,
                event_name: log.event_name,
                block_number: log.block_number as i64,
                tx_hash: format!("{}", log.tx_hash),
                log_index: log.log_index as i64,
                block_timestamp: 0,
                params: log.params,
            }
        })
        .collect();
    let store = MemStore::with_rows(rows);
    assert_eq!(run_fresh(&store).await, 5);
    let ops = store.ops();
    assert_eq!(ops.len(), 3);
    assert_eq!(ops[0].status, OpStatus::Executed);
    assert_eq!(ops[0].new.function, "setDefault");
    assert_eq!(ops[1].status, OpStatus::Canceled);
    assert_eq!(ops[1].new.function, "resolveFlag");
    assert_eq!(ops[1].new.record_id, Some(3));
    assert_eq!(ops[2].status, OpStatus::Pending);
    assert_eq!(ops[2].new.nonce, 2);
}
