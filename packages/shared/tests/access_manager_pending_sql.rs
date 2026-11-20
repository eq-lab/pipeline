// spec: docs/references/access-manager-events.md#api-read
use shared::access_manager_repo::LIST_PENDING_LOAN_OPS_SQL;

fn normalized() -> String {
    LIST_PENDING_LOAN_OPS_SQL
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn assert_has(needles: &[&str]) {
    let sql = normalized();
    for needle in needles {
        assert!(sql.contains(needle), "missing `{needle}` in: {sql}");
    }
}

#[test]
fn the_filters_pin_status_chain_targets_and_args() {
    assert_has(&[
        "o.status = 'pending'",
        "o.chain_id = $1",
        "o.target = ANY($2)",
        "(o.args_xdr IS NOT NULL OR o.calldata IS NOT NULL)",
        "o.args_json IS NOT NULL",
        "r.loan_id IS NOT NULL",
        "$4::bigint IS NULL OR r.loan_id = $4",
    ]);
}

#[test]
fn the_select_list_carries_both_encodings_and_no_stellar_only_filter_is_left() {
    assert_has(&["o.args_xdr, o.calldata, o.args_json"]);
    assert!(!normalized().contains("AND o.args_xdr IS NOT NULL AND"));
}

#[test]
fn the_record_fallback_is_scoped_and_only_for_unresolved_rows() {
    assert_has(&[
        "COALESCE(o.loan_id,",
        "FROM security_records",
        "event_name = 'SecurityRecordRegistered'",
        "FROM security_view_snapshots",
        "contract_address = $3",
        "WHERE o.loan_id IS NULL AND o.record_id IS NOT NULL AND o.target = $3",
    ]);
}

#[test]
fn a_later_schedule_of_the_same_id_supersedes_by_ledger_not_nonce() {
    assert_has(&[
        "NOT EXISTS ( SELECT 1 FROM access_manager_operations n",
        "n.operation_id = o.operation_id",
        "n.contract_address = o.contract_address",
        "(n.schedule_ledger, n.source_log_id) > (o.schedule_ledger, o.source_log_id)",
    ]);
    assert!(!normalized().contains("n.nonce >"));
}

#[test]
fn only_the_status_filter_names_a_status_and_the_order_starts_with_loan_and_ready_at() {
    let sql = normalized();
    assert!(!sql.contains("executed"));
    assert!(!sql.contains("canceled"));
    assert!(sql.contains("ORDER BY r.loan_id, o.ready_at, o.operation_id, o.nonce"));
}
