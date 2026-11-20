// spec: docs/product-specs/lp-total-balance.md
use shared::contract_logs_repo::{
    LP_WIRE_OUT_EVENTS_INFERRED_MINTER_SQL, PLUSD_COVERAGE_START_SQL, PLUSD_HOLDER_STEPS_SQL,
    PLUSD_WINDOW_SUMS_SQL,
};

fn flat() -> String {
    PLUSD_HOLDER_STEPS_SQL
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn scopes_by_chain_contract_and_event_name() {
    let sql = flat();
    for needle in [
        "WHERE chain_id = $1",
        "AND contract_address = $2",
        "AND event_name = 'PlusdTransfer'",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
}

#[test]
fn looks_the_holder_up_with_gin_containment_on_both_sides() {
    let sql = flat();
    assert_eq!(
        sql.matches("params @> jsonb_build_object('to', $3::text)")
            .count(),
        2,
        "{sql}"
    );
    assert_eq!(
        sql.matches("params @> jsonb_build_object('from', $3::text)")
            .count(),
        2,
        "{sql}"
    );
    assert!(!sql.contains("LOWER("), "{sql}");
    assert!(
        !sql.contains("->>'from'") && !sql.contains("->>'to'"),
        "{sql}"
    );
}

#[test]
fn guards_the_amount_and_returns_the_direction_flags() {
    let sql = flat();
    assert!(
        sql.contains(
            "CASE WHEN params->>'amount' ~ '^[0-9]{1,39}$' THEN params->>'amount' END AS amount"
        ),
        "{sql}"
    );
    assert!(sql.contains("AS incoming"), "{sql}");
    assert!(sql.contains("AS outgoing"), "{sql}");
}

#[test]
fn the_holder_steps_carry_the_ledger() {
    assert!(flat().starts_with("SELECT block_number, block_timestamp,"));
}

#[test]
fn reads_full_history_in_chain_order_without_aggregating() {
    let sql = flat();
    assert!(sql.ends_with("ORDER BY block_number, log_index"), "{sql}");
    assert!(!sql.contains("block_timestamp >="), "{sql}");
    assert!(!sql.contains("SUM("), "{sql}");
}

#[test]
fn the_inferred_minter_wire_out_read_is_chain_scoped_to_the_lps_latest_minter() {
    let sql = LP_WIRE_OUT_EVENTS_INFERRED_MINTER_SQL
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    for needle in [
        "WHERE chain_id = $1 AND event_name = 'WireOutRequested' AND params @> jsonb_build_object('lp', $2::text) ORDER BY block_number DESC, log_index DESC LIMIT 1",
        "JOIN minter m ON m.contract_address = c.contract_address",
        "r.contract_address = c.contract_address",
        "c.event_name IN ('WireOutSettled', 'WireOutCancelled')",
        "c.params @> jsonb_build_object('id', r.params->>'id')",
        "ORDER BY c.block_number, c.log_index",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
    assert!(!sql.contains("LOWER("), "{sql}");
}

#[test]
fn the_coverage_bound_is_the_chains_earliest_plusd_transfer_of_the_contract() {
    let sql = PLUSD_COVERAGE_START_SQL
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    for needle in [
        "SELECT block_number, block_timestamp",
        "WHERE chain_id = $1",
        "AND contract_address = $2",
        "AND event_name = 'PlusdTransfer'",
        "ORDER BY block_number, log_index LIMIT 1",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
    assert!(!sql.contains("$3"), "{sql}");
    assert!(!sql.contains("jsonb_build_object"), "{sql}");
}

#[test]
fn the_window_sums_are_bounded_and_aggregated_in_sql() {
    let sql = PLUSD_WINDOW_SUMS_SQL
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    for needle in [
        "AND event_name = 'PlusdTransfer'",
        "AND contract_address = $2",
        "AND block_number > $4",
        "AND block_number <= $5",
        "params->>'amount' ~ '^[0-9]{1,39}$'",
        "SUM(w.amt) FILTER (WHERE w.incoming)",
        "SUM(w.amt) FILTER (WHERE w.outgoing)",
        "COUNT(*) FILTER (WHERE w.amt IS NULL) AS malformed",
        "params @> jsonb_build_object('to', $3::text)",
        "params @> jsonb_build_object('from', $3::text)",
        ")::text AS credit",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
    assert!(!sql.contains("LOWER("), "{sql}");
}
