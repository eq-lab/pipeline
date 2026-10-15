// spec: docs/exec-plans/completed/issue-1433-stellar-loan-parsers-realignment.md#test-strategy
use shared::contract_logs_repo::{
    LATEST_STATUS_BY_LOANS_SQL, LATEST_WATCHLIST_ENTRY_SQL, LIST_LATEST_LOAN_SNAPSHOTS_SQL,
    LOAN_ECONOMICS_EVENTS_SQL, LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL, LOAN_LIFECYCLE_EVENT_NAMES,
    LOAN_SNAPSHOT_AS_OF_SQL,
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
