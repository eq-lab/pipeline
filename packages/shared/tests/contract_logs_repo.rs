// spec: docs/exec-plans/completed/issue-1433-stellar-loan-parsers-realignment.md#test-strategy
use shared::contract_logs_repo::{
    EARLIEST_ORIGINATION_DATE_FOR_REGISTRY_SQL, LATEST_STATUS_BY_LOANS_SQL,
    LATEST_WATCHLIST_ENTRY_SQL, LEGACY_YIELD_MINTED_SQL, LIST_LATEST_LOAN_SNAPSHOTS_SQL,
    LIST_REPAYMENT_MINTS_SQL, LIST_WITHDRAWAL_QUEUE_ROWS_SQL, LOAN_ECONOMICS_EVENTS_SQL,
    LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL, LOAN_LIFECYCLE_EVENT_NAMES,
    LOAN_RATE_EVENTS_FOR_REGISTRY_SQL, LOAN_SNAPSHOT_AS_OF_SQL,
};

fn normalized(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn assert_registry_scoped(sql: &str, placeholder: u8) {
    let sql = normalized(sql);
    assert!(
        sql.contains("chain_id = $1"),
        "missing chain_id predicate: {sql}"
    );
    assert!(
        sql.contains(&format!("AND contract_address = ${placeholder}")),
        "expected contract_address = ${placeholder}: {sql}"
    );
}

#[test]
fn loan_lifecycle_event_names_covers_every_stored_loan_event() {
    let expected = [
        "LoanDrawn",
        "LoanStatusUpdated",
        "LoanCCRUpdated",
        "LoanLocationUpdated",
        "LoanDefaulted",
        "LoanClosed",
        "PaymentRecorded",
        "PaymentUnrecorded",
        "LoanRolledOver",
        "EconomicsAmended",
        "Disbursed",
        "Undisbursed",
        "LoanWrittenDown",
        "InterestAdjusted",
    ];

    for name in expected {
        assert!(
            LOAN_LIFECYCLE_EVENT_NAMES.contains(&name),
            "LOAN_LIFECYCLE_EVENT_NAMES is missing '{name}'"
        );
    }
    assert_eq!(
        LOAN_LIFECYCLE_EVENT_NAMES.len(),
        expected.len(),
        "LOAN_LIFECYCLE_EVENT_NAMES has an unexpected extra entry"
    );
}

#[test]
fn loan_lifecycle_event_names_has_no_duplicates() {
    let mut sorted = LOAN_LIFECYCLE_EVENT_NAMES.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), LOAN_LIFECYCLE_EVENT_NAMES.len());
}

#[test]
fn list_latest_loan_snapshots_sql_is_registry_scoped() {
    assert_registry_scoped(LIST_LATEST_LOAN_SNAPSHOTS_SQL, 2);
}

#[test]
fn loan_lifecycle_events_for_registry_sql_is_registry_scoped() {
    assert_registry_scoped(LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL, 4);
}

#[test]
fn loan_rate_events_sql_is_registry_scoped() {
    assert_registry_scoped(LOAN_RATE_EVENTS_FOR_REGISTRY_SQL, 4);
}

#[test]
fn earliest_origination_date_sql_is_registry_scoped() {
    assert_registry_scoped(EARLIEST_ORIGINATION_DATE_FOR_REGISTRY_SQL, 2);
}

#[test]
fn loan_snapshot_as_of_sql_is_registry_scoped() {
    assert_registry_scoped(LOAN_SNAPSHOT_AS_OF_SQL, 5);
}

#[test]
fn latest_status_by_loans_sql_is_registry_scoped() {
    assert_registry_scoped(LATEST_STATUS_BY_LOANS_SQL, 4);
}

#[test]
fn latest_watchlist_entry_sql_is_registry_scoped() {
    assert_registry_scoped(LATEST_WATCHLIST_ENTRY_SQL, 3);
}

#[test]
fn loan_economics_events_sql_is_registry_scoped() {
    assert_registry_scoped(LOAN_ECONOMICS_EVENTS_SQL, 4);
}

#[test]
fn list_repayment_mints_sql_requires_registry_scoped_payment_recorded() {
    let sql = normalized(LIST_REPAYMENT_MINTS_SQL);
    assert!(
        sql.contains("JOIN LATERAL ( SELECT (p.params->'event'->>'mgmt_fee')"),
        "PaymentRecorded match must be an inner join: {sql}"
    );
    assert!(
        !sql.contains("LEFT JOIN LATERAL ( SELECT (p.params"),
        "PaymentRecorded match must not be optional: {sql}"
    );
    assert!(
        sql.contains("AND p.contract_address = $4 AND p.tx_hash = r.tx_hash AND p.event_name = 'PaymentRecorded'"),
        "expected p.contract_address = $4 on PaymentRecorded: {sql}"
    );
    assert!(sql.contains("WHERE r.chain_id = $1"), "{sql}");
    assert!(
        sql.contains("AND d.contract_address = $4 AND d.event_name = 'LoanDefaulted'"),
        "{sql}"
    );
    assert!(
        sql.contains("(d.block_number, d.log_index) < (r.block_number, r.log_index)"),
        "{sql}"
    );
}

#[test]
fn legacy_yield_minted_sql_requires_registry_scoped_payment_recorded() {
    let sql = normalized(LEGACY_YIELD_MINTED_SQL);
    assert!(
        sql.contains("AND EXISTS ( SELECT 1 FROM contract_logs p"),
        "{sql}"
    );
    assert!(sql.contains("AND p.contract_address = $3"), "{sql}");
    assert!(sql.contains("p.event_name = 'PaymentRecorded'"), "{sql}");
    assert!(
        sql.contains("(p.params->>'loan_id')::numeric = o.loan_id"),
        "{sql}"
    );
    assert!(
        sql.contains("(p.params->'event'->>'repayment_id')::numeric = o.repayment_id"),
        "{sql}"
    );
}

#[test]
fn list_withdrawal_queue_rows_sql_matches_claims_on_the_same_chain_and_contract() {
    let sql = normalized(LIST_WITHDRAWAL_QUEUE_ROWS_SQL);
    assert!(sql.starts_with("SELECT r.chain_id,"), "{sql}");
    assert!(
        sql.contains("WHERE c.chain_id = r.chain_id AND c.contract_address = r.contract_address AND c.event_name = 'RequestClaimed'"),
        "{sql}"
    );
    assert!(sql.contains("WHERE r.chain_id = $1"), "{sql}");
}
