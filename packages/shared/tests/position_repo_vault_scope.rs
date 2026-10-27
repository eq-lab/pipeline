// spec: docs/references/backend.md#get-v1positionshistory

use shared::position_repo::{
    position_history_sql, BALANCE_EVENTS_SQL, FIRST_POSITION_TIMESTAMP_SQL, GET_VAULTS_SQL,
    POSITION_SUMMARIES_SQL, UPSERT_VAULT_SQL,
};

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

const VAULT_SCOPE: &str =
    "LOWER(contract_address) IN (SELECT LOWER(address) FROM vaults WHERE chain_id = $1)";

#[test]
fn upsert_conflicts_on_chain_id_and_replaces_address() {
    let sql = flat(UPSERT_VAULT_SQL);
    assert!(sql.contains("ON CONFLICT (chain_id) DO UPDATE SET address = EXCLUDED.address"));
    assert!(sql.contains("asset_decimals = EXCLUDED.asset_decimals"));
    assert!(!sql.contains("ON CONFLICT (chain_id, address)"));
}

#[test]
fn get_vaults_reads_the_chain_row() {
    assert!(flat(GET_VAULTS_SQL).contains("FROM vaults WHERE chain_id = $1"));
}

#[test]
fn pnl_readers_filter_by_the_vaults_address() {
    assert!(flat(FIRST_POSITION_TIMESTAMP_SQL).contains(VAULT_SCOPE));
    assert!(flat(BALANCE_EVENTS_SQL).contains(VAULT_SCOPE));
    let summaries = flat(POSITION_SUMMARIES_SQL);
    assert_eq!(summaries.matches(VAULT_SCOPE).count(), 2);
}

#[test]
fn history_scopes_to_vaults_table_not_latest_event() {
    let sql = flat(&position_history_sql("day"));
    assert!(sql.contains(
        "WITH current_vault AS ( SELECT LOWER(address) AS addr FROM vaults WHERE chain_id = $1 )"
    ));
    assert!(sql.contains("LOWER(contract_address) = (SELECT addr FROM current_vault)"));
    assert!(!sql.contains("ORDER BY block_number DESC, log_index DESC LIMIT 1"));
    assert!(sql.contains("DATE_TRUNC('day'"));
}

#[test]
fn stellar_addresses_keep_case_in_output() {
    for sql in [
        flat(POSITION_SUMMARIES_SQL),
        flat(&position_history_sql("hour")),
    ] {
        assert!(sql.contains(
            "CASE WHEN chain_id IN (99000001, 99000002) THEN contract_address ELSE LOWER(contract_address) END"
        ));
    }
}
