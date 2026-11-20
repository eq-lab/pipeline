// spec: docs/product-specs/kyb-lp-verification.md#settlement-address

const SQL: &str = include_str!("../migrations/20261102000002_lps_signed_settlement_addresses.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn has(needle: &str) {
    assert!(flat().contains(needle), "migration is missing `{needle}`");
}

#[test]
fn every_new_lps_column_is_added() {
    for column in [
        "ADD COLUMN stellar_signer_address TEXT",
        "ADD COLUMN evm_address TEXT",
        "ADD COLUMN evm_signer_address TEXT",
        "ADD COLUMN evm_address_linked_at TIMESTAMPTZ",
    ] {
        has(column);
    }
}

#[test]
fn every_named_constraint_is_present() {
    for name in [
        "lps_stellar_signer_address_ck",
        "lps_evm_address_key",
        "lps_evm_address_ck",
        "lps_evm_signer_address_ck",
        "lps_stellar_signer_needs_address_ck",
        "lps_evm_link_complete_ck",
    ] {
        has(&format!("CONSTRAINT {name}"));
    }
}

#[test]
fn the_evm_address_is_unique_and_lowercase_checked() {
    has("CONSTRAINT lps_evm_address_key UNIQUE");
    has("evm_address ~ '^0x[0-9a-f]{40}$'");
    has("evm_signer_address ~ '^0x[0-9a-f]{40}$'");
}

#[test]
fn an_existing_unsigned_stellar_address_stays_valid() {
    has("CHECK (stellar_signer_address IS NULL OR stellar_address IS NOT NULL)");
    let flat = flat();
    assert!(!flat.contains("(stellar_address IS NULL) = (stellar_signer_address IS NULL)"));
    assert!(!flat.contains("stellar_address IS NULL OR stellar_signer_address IS NOT NULL"));
    assert!(!flat.contains("UPDATE lps"));
    assert!(!flat.contains("SET stellar_address"));
}

#[test]
fn the_evm_trio_is_all_or_nothing() {
    has("(evm_address IS NULL) = (evm_signer_address IS NULL)");
    has("(evm_address IS NULL) = (evm_address_linked_at IS NULL)");
}

#[test]
fn the_challenge_table_is_keyed_per_lp_and_chain_with_an_lp_fk() {
    has("CREATE TABLE lp_address_challenges (");
    has("lp_id BIGINT NOT NULL REFERENCES lps(id)");
    has("PRIMARY KEY (lp_id, chain_id)");
    for column in [
        "address TEXT NOT NULL",
        "signer_address TEXT NOT NULL",
        "nonce TEXT NOT NULL",
        "expires_at TIMESTAMPTZ NOT NULL",
    ] {
        has(column);
    }
}

#[test]
fn the_header_documents_the_rollback() {
    assert!(SQL.contains("-- Rollback:"));
    assert!(SQL.contains("-- DROP TABLE lp_address_challenges;"));
    assert!(SQL.contains("DROP COLUMN evm_address,"));
}
