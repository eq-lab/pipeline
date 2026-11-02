// spec: docs/product-specs/kyb-lp-verification.md#link-history

const SQL: &str = include_str!("../migrations/20261102000004_lp_settlement_address_history.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn pos(needle: &str) -> usize {
    SQL.find(needle)
        .unwrap_or_else(|| panic!("migration is missing `{needle}`"))
}

#[test]
fn the_table_has_every_column_with_its_type() {
    let f = flat();
    assert!(f.contains("CREATE TABLE lp_settlement_address_history ("));
    for col in [
        "id BIGSERIAL PRIMARY KEY",
        "lp_id BIGINT NOT NULL REFERENCES lps(id)",
        "chain_kind TEXT NOT NULL CONSTRAINT lp_settlement_address_history_kind_ck CHECK (chain_kind IN ('stellar', 'evm'))",
        "chain_id BIGINT,",
        "address TEXT NOT NULL,",
        "signer_address TEXT,",
        "previous_address TEXT,",
        "previous_signer_address TEXT,",
        "linked_by_account_id UUID REFERENCES accounts(id),",
        "created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    ] {
        assert!(f.contains(col), "missing column `{col}`");
    }
}

#[test]
fn the_lookup_index_is_lp_then_time() {
    assert!(flat().contains(
        "CREATE INDEX lp_settlement_address_history_lp_created_idx ON lp_settlement_address_history (lp_id, created_at)"
    ));
}

#[test]
fn both_backfills_copy_the_signer_and_leave_unknowns_null() {
    let f = flat();
    let stellar = "INSERT INTO lp_settlement_address_history (lp_id, chain_kind, address, signer_address, created_at) SELECT id, 'stellar', stellar_address, stellar_signer_address, COALESCE(address_linked_at, updated_at) FROM lps WHERE stellar_address IS NOT NULL;";
    let evm = "INSERT INTO lp_settlement_address_history (lp_id, chain_kind, address, signer_address, created_at) SELECT id, 'evm', evm_address, evm_signer_address, evm_address_linked_at FROM lps WHERE evm_address IS NOT NULL;";
    assert!(f.contains(stellar));
    assert!(f.contains(evm));
    for insert in [stellar, evm] {
        for unset in ["chain_id", "previous_", "linked_by_account_id"] {
            assert!(!insert.contains(unset));
        }
    }
}

#[test]
fn the_not_valid_checks_come_after_both_backfills() {
    let evm = pos("'evm', evm_address");
    for name in [
        "lp_settlement_address_history_chain_id_nn CHECK (chain_id IS NOT NULL) NOT VALID",
        "lp_settlement_address_history_signer_nn CHECK (signer_address IS NOT NULL) NOT VALID",
        "lp_settlement_address_history_linked_by_nn CHECK (linked_by_account_id IS NOT NULL) NOT VALID",
    ] {
        assert!(pos(name) > evm, "{name} must follow the backfills");
    }
    assert!(pos("'stellar', stellar_address") < evm);
}

#[test]
fn the_migration_never_validates_and_never_touches_lps() {
    assert!(!SQL.contains("VALIDATE CONSTRAINT\n") && !flat().contains("VALIDATE CONSTRAINT lp_"));
    assert!(!SQL.contains("UPDATE lps"));
}

#[test]
fn the_header_carries_the_rollback() {
    let header = &SQL[..pos("CREATE TABLE")];
    assert!(header.contains("-- Rollback:"));
    assert!(header.contains("DROP TABLE lp_settlement_address_history"));
}
