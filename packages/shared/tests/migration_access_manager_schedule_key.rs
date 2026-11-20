// spec: docs/references/access-manager-events.md#table

const SQL: &str =
    include_str!("../migrations/20261117000001_access_manager_operations_schedule_key.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn has(needle: &str) {
    assert!(flat().contains(needle), "migration is missing `{needle}`");
}

fn statements() -> String {
    SQL.lines()
        .filter(|l| !l.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn the_old_key_is_dropped_by_lookup() {
    has("FROM pg_constraint");
    has("con.contype = 'u'");
    has("rel.relname = 'access_manager_operations'");
    has("DROP CONSTRAINT %I");
}

#[test]
fn the_new_key_identifies_one_schedule_event() {
    has("ADD CONSTRAINT access_manager_operations_schedule_key UNIQUE (chain_id, contract_address, operation_id, schedule_ledger, nonce)");
}

#[test]
fn there_is_no_data_change() {
    let body = statements();
    assert!(!body.contains("UPDATE") && !body.contains("INSERT") && !body.contains("DELETE"));
}

#[test]
fn a_rollback_block_is_present() {
    assert!(SQL.contains("-- Rollback:"));
    assert!(SQL.contains("--   DELETE FROM _sqlx_migrations WHERE version = 20261117000001;"));
}
