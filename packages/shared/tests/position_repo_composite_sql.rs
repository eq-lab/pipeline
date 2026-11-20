// spec: docs/product-specs/lp-total-balance.md#behavior

use shared::position_repo::share_price_closing_sql;

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn closing_arm_takes_the_last_sample_per_bucket_from_the_window() {
    let sql = flat(&share_price_closing_sql("hour"));
    assert!(sql.contains("DISTINCT ON (DATE_TRUNC('hour', block_timestamp))"));
    assert!(sql.contains("block_timestamp >= $2"));
    assert!(sql.contains(
        "ORDER BY DATE_TRUNC('hour', block_timestamp), block_timestamp DESC, block_number DESC"
    ));
}

#[test]
fn seed_arm_is_the_single_latest_sample_before_the_window() {
    let sql = flat(&share_price_closing_sql("day"));
    assert!(sql
        .contains("block_timestamp < $2 ORDER BY block_timestamp DESC, block_number DESC LIMIT 1"));
    assert!(sql.contains("UNION ALL"));
}

#[test]
fn both_arms_are_scoped_to_the_chain_vault() {
    let sql = flat(&share_price_closing_sql("week"));
    let scope = "LOWER(vault_address) = (SELECT LOWER(address) FROM vaults WHERE chain_id = $1)";
    assert_eq!(sql.matches(scope).count(), 2);
    assert_eq!(sql.matches("chain_id = $1").count(), 4);
}

#[test]
fn price_is_text_ordered_by_bucket_and_never_averaged() {
    let sql = flat(&share_price_closing_sql("day"));
    assert!(sql.contains("price::text AS price"));
    assert!(sql.ends_with("ORDER BY bucket, arm"));
    assert!(!sql.contains("AVG("));
    assert!(sql.contains("DATE_TRUNC('day', block_timestamp)"));
}
