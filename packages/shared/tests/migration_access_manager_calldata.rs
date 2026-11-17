// spec: docs/references/access-manager-events.md#table

const SQL: &str =
    include_str!("../migrations/20261118000002_access_manager_operations_calldata.sql");

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
fn the_calldata_column_is_nullable_and_added_once() {
    has("ALTER TABLE access_manager_operations ADD COLUMN IF NOT EXISTS calldata TEXT NULL;");
    assert!(!statements().contains("calldata TEXT NOT NULL"));
}

#[test]
fn the_check_keeps_the_two_encodings_exclusive() {
    has("ADD CONSTRAINT access_manager_operations_one_args_encoding CHECK (args_xdr IS NULL OR calldata IS NULL)");
}

#[test]
fn the_check_is_guarded_by_a_constraint_lookup() {
    has("IF NOT EXISTS ( SELECT 1 FROM pg_constraint con");
    has("con.conname = 'access_manager_operations_one_args_encoding'");
    has("rel.relname = 'access_manager_operations'");
}

#[test]
fn there_is_no_data_change() {
    let body = statements();
    assert!(!body.contains("UPDATE") && !body.contains("INSERT") && !body.contains("DELETE"));
    assert!(!body.contains("CREATE INDEX"));
}

#[test]
fn a_rollback_block_is_present() {
    assert!(SQL.contains("-- Rollback:"));
    assert!(SQL.contains(
        "--   ALTER TABLE access_manager_operations DROP CONSTRAINT access_manager_operations_one_args_encoding;"
    ));
    assert!(SQL.contains("--   ALTER TABLE access_manager_operations DROP COLUMN calldata;"));
    assert!(SQL.contains("--   DELETE FROM _sqlx_migrations WHERE version = 20261118000002;"));
}
