// spec: docs/product-specs/lp-total-balance.md
const SQL: &str = include_str!("../migrations/20261109000001_plusd_transfer_params_index.sql");

fn live() -> String {
    SQL.lines()
        .filter(|l| !l.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn creates_the_partial_gin_index_idempotently() {
    let f = live();
    assert!(f.contains("CREATE INDEX IF NOT EXISTS idx_contract_logs_plusd_transfer_params"));
    assert!(f.contains("ON contract_logs USING GIN (params jsonb_path_ops)"));
    assert!(f.contains("WHERE event_name = 'PlusdTransfer'"));
}

#[test]
fn header_documents_the_rollback() {
    assert!(SQL.contains("-- DROP INDEX IF EXISTS idx_contract_logs_plusd_transfer_params;"));
}

#[test]
fn is_additive_only() {
    let upper = live().to_uppercase();
    for forbidden in ["ALTER TABLE", "DROP ", "DELETE FROM", "UPDATE ", "TRUNCATE"] {
        assert!(!upper.contains(forbidden), "{forbidden}");
    }
}
