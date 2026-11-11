// spec: docs/product-specs/deposits.md#wire-matching-by-payment-reference

const SQL: &str =
    include_str!("../migrations/20261111000001_lp_bank_deposits_matched_reference.sql");

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
fn the_column_is_nullable() {
    has("ADD COLUMN requested_bank_details_id BIGINT,");
    assert!(!statements().contains("BIGINT NOT NULL"));
}

#[test]
fn the_composite_fk_references_the_unique_pair() {
    has("FOREIGN KEY (requested_bank_details_id, lp_id) REFERENCES lp_requested_bank_details (id, lp_id)");
    has("ADD CONSTRAINT lp_requested_bank_details_id_lp_id_key UNIQUE (id, lp_id)");
}

#[test]
fn the_index_is_partial() {
    has("CREATE INDEX idx_lp_bank_deposits_requested_bank_details_id ON lp_bank_deposits (requested_bank_details_id) WHERE requested_bank_details_id IS NOT NULL;");
}

#[test]
fn there_is_no_backfill() {
    let body = statements();
    assert!(!body.contains("UPDATE") && !body.contains("INSERT"));
}

#[test]
fn a_rollback_block_is_present() {
    assert!(SQL.contains("-- Rollback:"));
}

#[test]
fn the_rollback_clears_the_migration_record() {
    assert!(SQL.contains("--   DELETE FROM _sqlx_migrations WHERE version = 20261111000001;"));
}
