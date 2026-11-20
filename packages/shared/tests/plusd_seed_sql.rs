// spec: docs/references/backend.md#plusd-balance-seed
use shared::plusd_seed_repo::{
    PLUSD_LATEST_SEED_SQL, PLUSD_SEEDED_HOLDERS_SQL, PLUSD_SEED_CANDIDATES_SQL,
    PLUSD_SEED_INSERT_SQL,
};

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn candidates_union_the_five_sources() {
    let sql = flat(PLUSD_SEED_CANDIDATES_SQL);
    for needle in [
        "event_name = 'PlusdTransfer'",
        "contract_address = $2",
        "FROM lp_profiles",
        "FROM lps",
        "chain_kind = 'stellar'",
        "chain_id = $1 OR chain_id IS NULL",
        "FROM position_events",
        "UPPER(holder)",
        "'^G[A-Z2-7]{55}$'",
        "NOT EXISTS",
        "LIMIT $3",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
    assert!(!sql.contains("UNION ALL"), "{sql}");
    assert_eq!(sql.matches("AND block_number > $4").count(), 3, "{sql}");
    assert!(
        sql.contains("FROM position_events WHERE chain_id = $1 AND block_number > $4"),
        "{sql}"
    );
    assert!(sql.contains("c.holder <> ALL($5::text[])"), "{sql}");
    assert_eq!(sql.matches("UNION").count(), 5, "{sql}");
}

#[test]
fn candidates_skip_holders_that_already_have_a_seed() {
    let sql = flat(PLUSD_SEED_CANDIDATES_SQL);
    assert!(sql.contains("FROM plusd_balance_seeds s"), "{sql}");
    assert!(sql.contains("s.token_address = $2"), "{sql}");
    assert!(sql.contains("s.holder = c.holder"), "{sql}");
}

#[test]
fn insert_casts_the_text_balance_and_ignores_conflicts() {
    let sql = flat(PLUSD_SEED_INSERT_SQL);
    assert!(sql.contains("$6::numeric"), "{sql}");
    assert!(sql.contains("ON CONFLICT DO NOTHING"), "{sql}");
}

#[test]
fn latest_seed_guards_the_balance_text_and_takes_the_newest() {
    let sql = flat(PLUSD_LATEST_SEED_SQL);
    assert!(sql.contains("balance::text ~ '^[0-9]{1,39}$'"), "{sql}");
    assert!(sql.contains("kind"), "{sql}");
    assert!(sql.ends_with("ORDER BY as_of_ledger DESC LIMIT 1"), "{sql}");
    assert!(!sql.contains("SELECT balance,"), "{sql}");
}

#[test]
fn seeded_holders_are_distinct() {
    assert!(flat(PLUSD_SEEDED_HOLDERS_SQL).contains("SELECT DISTINCT holder"));
}
