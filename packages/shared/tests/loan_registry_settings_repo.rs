// spec: docs/references/backend.md#loanregistry-settings-sync
use shared::loan_registry_settings_repo::{SELECT_MAX_FEE_BPS_SQL, UPSERT_MAX_FEE_BPS_SQL};

fn flat(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn upsert_conflicts_on_chain_and_address() {
    let f = flat(UPSERT_MAX_FEE_BPS_SQL);
    assert!(f.contains(
        "ON CONFLICT (chain_id, contract_address) DO UPDATE SET max_fee_bps = EXCLUDED.max_fee_bps"
    ));
    assert!(f.contains("updated_at = now()"));
}

#[test]
fn select_is_scoped_by_chain_and_address() {
    let f = flat(SELECT_MAX_FEE_BPS_SQL);
    assert!(f.contains("WHERE chain_id = $1 AND contract_address = $2"));
}
