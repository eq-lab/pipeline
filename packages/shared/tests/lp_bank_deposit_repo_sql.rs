// spec: docs/product-specs/deposits.md#lp-pending-bank-deposits
use shared::lp_bank_deposit_repo::{
    PENDING_BANK_DEPOSITS_ALL_SQL, PENDING_BANK_DEPOSITS_FOR_LP_SQL,
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

const SHARED_NEEDLES: &[&str] = &[
    "COALESCE(SUM(d.amount), 0)",
    "NOT d.is_minted",
    "w.event_name = 'WireIn'",
    "w.params @> jsonb_build_object('ref_hash', encode(d.ref_hash, 'hex'))",
    "NOT (w.params @> jsonb_build_object('receiver', w.contract_address))",
    "a.event_name = 'WireInAssigned'",
    "a.chain_id = w.chain_id",
    "a.contract_address = w.contract_address",
    "a.params->>'id' = w.params->>'id'",
    "e.event_name IN ('WireIn', 'WireInReturned')",
    "e.params @> jsonb_build_object('ref_hash', encode(d.ref_hash, 'hex'))",
    "ORDER BY e.block_timestamp DESC, e.id DESC LIMIT 1",
    "IS DISTINCT FROM 'WireInReturned'",
];

#[test]
fn for_lp_filters_by_lp_and_applies_the_pending_rule() {
    assert_has(PENDING_BANK_DEPOSITS_FOR_LP_SQL, SHARED_NEEDLES);
    assert_has(PENDING_BANK_DEPOSITS_FOR_LP_SQL, &["d.lp_id = $1"]);
}

#[test]
fn all_counts_and_sums_without_an_lp_filter() {
    assert_has(PENDING_BANK_DEPOSITS_ALL_SQL, SHARED_NEEDLES);
    assert_has(PENDING_BANK_DEPOSITS_ALL_SQL, &["COUNT(*)"]);
    assert!(!PENDING_BANK_DEPOSITS_ALL_SQL.contains("lp_id"));
    assert!(!PENDING_BANK_DEPOSITS_ALL_SQL.contains("$1"));
}

#[test]
fn neither_decodes_indexed_hex_self_joins_or_reads_the_lp_ledger() {
    for sql in [
        PENDING_BANK_DEPOSITS_FOR_LP_SQL,
        PENDING_BANK_DEPOSITS_ALL_SQL,
    ] {
        assert!(!sql.contains("decode("));
        assert!(!sql.contains("lp_ledger"));
        assert!(!sql.contains("params->>'ref_hash'"));
        assert!(!sql.contains("JOIN contract_logs"));
    }
}

#[test]
fn for_lp_has_exactly_one_placeholder() {
    assert_eq!(PENDING_BANK_DEPOSITS_FOR_LP_SQL.matches("$1").count(), 1);
    assert!(!PENDING_BANK_DEPOSITS_FOR_LP_SQL.contains("$2"));
}
