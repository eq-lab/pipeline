// spec: docs/references/backend.md#stellar-pocket-indexing
use shared::pocket_repo::{
    INSERT_SEED_SQL, LIST_CLAIM_TOTALS_SQL, LIST_EVENTS_SQL, LIST_HOLDER_CLAIMS_SQL,
    LIST_SEEDS_SQL, LIST_SEED_CANDIDATES_SQL,
};

fn normalized(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn assert_has(sql: &str, needles: &[&str]) {
    let sql = normalized(sql);
    for needle in needles {
        assert!(sql.contains(needle), "missing `{needle}` in: {sql}");
    }
}

#[test]
fn list_events_is_scoped_ordered_and_excludes_claims() {
    assert_has(
        LIST_EVENTS_SQL,
        &[
            "chain_id = $1",
            "AND contract_address = $2",
            "'PocketOpened','PocketReleased','PocketUnreleased','PocketBurned'",
            "ORDER BY block_number, log_index",
        ],
    );
    assert!(!LIST_EVENTS_SQL.contains("PocketClaimed"));
}

#[test]
fn claim_totals_aggregate_in_sql_scoped_to_the_pocket() {
    assert_has(
        LIST_CLAIM_TOTALS_SQL,
        &[
            "c.chain_id = $1",
            "AND c.contract_address = $2",
            "c.event_name = 'PocketClaimed'",
            "SUM((c.params->>'paid')::numeric)",
            "FILTER (WHERE c.block_number > s.as_of_ledger)",
            "LEFT JOIN pocket_seeds s",
            "GROUP BY",
        ],
    );
}

#[test]
fn seeds_are_scoped_by_chain_and_pocket() {
    assert_has(
        LIST_SEEDS_SQL,
        &["FROM pocket_seeds", "chain_id = $1 AND pocket_address = $2"],
    );
}

#[test]
fn holder_claims_match_the_holder_exactly_and_skip_zero_claims() {
    assert_has(
        LIST_HOLDER_CLAIMS_SQL,
        &[
            "chain_id = $1",
            "AND contract_address = $2",
            "event_name = 'PocketClaimed'",
            "params->>'holder' = $3",
            "COALESCE((params->>'paid_zero')::boolean, false) = false",
            "ORDER BY block_number DESC, log_index DESC",
        ],
    );
    assert!(!LIST_HOLDER_CLAIMS_SQL.to_uppercase().contains("LOWER"));
}

#[test]
fn seed_candidates_exclude_opened_and_seeded_loans() {
    assert_has(
        LIST_SEED_CANDIDATES_SQL,
        &[
            "d.chain_id = $1",
            "d.contract_address = $2",
            "d.event_name = 'LoanDefaulted'",
            "NOT EXISTS ( SELECT 1 FROM contract_logs o",
            "o.contract_address = $3",
            "o.event_name = 'PocketOpened'",
            "NOT EXISTS ( SELECT 1 FROM pocket_seeds s",
            "s.pocket_address = $3",
        ],
    );
}

#[test]
fn insert_seed_never_overwrites() {
    assert_has(
        INSERT_SEED_SQL,
        &["INSERT INTO pocket_seeds", "ON CONFLICT DO NOTHING"],
    );
}
