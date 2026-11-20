// spec: docs/references/access-manager-events.md#table

use shared::access_manager_repo::{INSERT_SCHEDULED_SQL, MARK_CANCELED_SQL, MARK_EXECUTED_SQL};

const MIGRATION: &str =
    include_str!("../migrations/20261117000001_access_manager_operations_schedule_key.sql");

const CALLDATA_MIGRATION: &str =
    include_str!("../migrations/20261118000002_access_manager_operations_calldata.sql");

fn flat(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn list_after(s: &str, marker: &str) -> Vec<String> {
    let rest = &s[s.find(marker).expect("marker") + marker.len()..];
    let mut cols: Vec<String> = rest[..rest.find(')').unwrap()]
        .split(',')
        .map(|c| c.trim().to_owned())
        .collect();
    cols.sort();
    cols
}

#[test]
fn the_insert_conflict_target_is_the_migration_key() {
    let insert = flat(INSERT_SCHEDULED_SQL);
    assert_eq!(
        list_after(&insert, "ON CONFLICT ("),
        list_after(
            &flat(MIGRATION),
            "access_manager_operations_schedule_key UNIQUE ("
        )
    );
    assert!(insert.ends_with("DO NOTHING"));
}

#[test]
fn the_insert_lists_the_calldata_column_and_its_placeholder() {
    let insert = flat(INSERT_SCHEDULED_SQL);
    assert!(insert.contains("args_xdr, calldata, args_json,"));
    assert!(insert.contains("$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13,"));
    assert!(insert.contains("$18)"));
    assert!(flat(CALLDATA_MIGRATION).contains("ADD COLUMN IF NOT EXISTS calldata TEXT NULL"));
}

#[test]
fn cancel_closes_the_newest_schedule_logged_before_it() {
    let sql = flat(MARK_CANCELED_SQL);
    assert!(sql.contains("AND source_log_id < $7"));
    assert!(sql.contains("ORDER BY schedule_ledger DESC, source_log_id DESC LIMIT 1)"));
    assert!(sql.ends_with("LIMIT 1) AND nonce = $4 AND status = 'pending'"));
    assert!(!sql.contains("ORDER BY nonce"));
}

#[test]
fn execute_closes_the_newest_schedule_logged_before_it() {
    let sql = flat(MARK_EXECUTED_SQL);
    assert!(sql.contains("AND source_log_id < $6"));
    assert!(sql.contains("ORDER BY schedule_ledger DESC, source_log_id DESC LIMIT 1)"));
    assert!(sql.ends_with("AND status = 'pending'"));
    assert!(!sql.contains("ORDER BY nonce") && !sql.contains("nonce DESC"));
}

#[test]
fn the_status_guard_is_outside_the_subquery() {
    for sql in [flat(MARK_CANCELED_SQL), flat(MARK_EXECUTED_SQL)] {
        let limit = sql.find("LIMIT 1)").unwrap();
        let guard = sql.find("status = 'pending'").unwrap();
        assert!(guard > limit);
        assert_eq!(sql.matches("status = 'pending'").count(), 1);
    }
}
