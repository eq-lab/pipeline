// spec: docs/references/backend.md#stellar-pocket-indexing
const SQL: &str = include_str!("../migrations/20261103000001_pocket_seeds.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn creates_the_table_idempotently_with_every_column() {
    let f = flat();
    assert!(f.contains("CREATE TABLE IF NOT EXISTS pocket_seeds ("));
    for col in [
        "chain_id BIGINT NOT NULL,",
        "pocket_address TEXT NOT NULL,",
        "loan_id NUMERIC NOT NULL,",
        "as_of_ledger BIGINT NOT NULL,",
        "snapshot_ledger BIGINT NOT NULL,",
        "supply_at_snapshot NUMERIC NOT NULL,",
        "held NUMERIC NOT NULL,",
        "released_total NUMERIC NOT NULL,",
        "burned_total NUMERIC NOT NULL,",
        "claimed_total NUMERIC NOT NULL,",
        "created_at TIMESTAMPTZ NOT NULL DEFAULT now(),",
    ] {
        assert!(f.contains(col), "missing `{col}`");
    }
}

#[test]
fn primary_key_is_chain_pocket_loan() {
    assert!(flat().contains("PRIMARY KEY (chain_id, pocket_address, loan_id)"));
}

#[test]
fn is_additive_only() {
    let upper = SQL.to_uppercase();
    for forbidden in ["ALTER TABLE", "DROP TABLE IF", "DELETE FROM", "UPDATE "] {
        let live: String = upper
            .lines()
            .filter(|l| !l.trim_start().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!live.contains(forbidden), "{forbidden}");
    }
}
