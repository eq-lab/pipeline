// spec: docs/references/backend.md#plusd-balance-seed
const SQL: &str = include_str!("../migrations/20261110000001_plusd_balance_seeds.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn creates_the_table_idempotently_with_every_column() {
    let f = flat();
    assert!(f.contains("CREATE TABLE IF NOT EXISTS plusd_balance_seeds ("));
    for col in [
        "chain_id BIGINT NOT NULL,",
        "token_address TEXT NOT NULL,",
        "holder TEXT NOT NULL,",
        "as_of_ledger BIGINT NOT NULL,",
        "as_of_timestamp BIGINT NOT NULL,",
        "balance NUMERIC NOT NULL CHECK (balance >= 0),",
        "kind TEXT NOT NULL CHECK (kind IN ('initial', 'reanchor')),",
        "created_at TIMESTAMPTZ NOT NULL DEFAULT now(),",
    ] {
        assert!(f.contains(col), "missing `{col}`");
    }
}

#[test]
fn primary_key_is_chain_token_holder_ledger() {
    assert!(flat().contains("PRIMARY KEY (chain_id, token_address, holder, as_of_ledger)"));
}

#[test]
fn is_additive_only() {
    let upper = SQL.to_uppercase();
    let live: String = upper
        .lines()
        .filter(|l| !l.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");
    for forbidden in ["ALTER TABLE", "DROP TABLE", "DELETE FROM", "UPDATE "] {
        assert!(!live.contains(forbidden), "{forbidden}");
    }
}
