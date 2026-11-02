// spec: docs/product-specs/deposits.md#lp-funding-details

const SQL: &str = include_str!("../migrations/20261102000003_lp_requested_bank_details_chain.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn has(needle: &str) {
    assert!(flat().contains(needle), "migration is missing `{needle}`");
}

#[test]
fn both_columns_are_added_nullable() {
    has("ALTER TABLE lp_requested_bank_details ADD COLUMN chain_id BIGINT, ADD COLUMN receiver_address TEXT;");
    let flat = flat();
    assert!(!flat.contains("BIGINT NOT NULL"));
    assert!(!flat.contains("TEXT NOT NULL"));
}

#[test]
fn legacy_receivers_are_backfilled_from_the_stellar_address() {
    has("UPDATE lp_requested_bank_details r SET receiver_address = l.stellar_address");
    has("FROM lps l WHERE l.id = r.lp_id AND r.receiver_address IS NULL");
}

#[test]
fn legacy_chain_ids_are_left_null() {
    assert!(!flat().contains("SET chain_id"));
}

#[test]
fn both_checks_are_not_valid_and_never_validated() {
    has("CONSTRAINT lp_requested_bank_details_chain_id_nn CHECK (chain_id IS NOT NULL) NOT VALID");
    has("CONSTRAINT lp_requested_bank_details_receiver_nn CHECK (receiver_address IS NOT NULL) NOT VALID");
    assert!(!SQL.contains("VALIDATE CONSTRAINT"));
}

#[test]
fn the_header_documents_the_rollback_and_the_no_validate_rule() {
    assert!(SQL.contains("-- Rollback:"));
    assert!(SQL.contains("Never VALIDATE these constraints."));
}

#[test]
fn the_previous_migration_is_untouched() {
    let previous =
        include_str!("../migrations/20261102000001_system_configuration_lp_payment_details.sql");
    assert!(!previous.contains("receiver_address"));
    assert!(!previous.contains("chain_id"));
}
