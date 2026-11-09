// spec: docs/product-specs/loan-security-state.md#mark-suggestions
use shared::loan_asset_price_repo::LATEST_PRICES_FOR_PAIRS_SQL;

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn latest_prices_for_pairs_picks_the_newest_row_per_pair() {
    let sql = flat(LATEST_PRICES_FOR_PAIRS_SQL);
    for needle in [
        "SELECT DISTINCT ON (p.asset, p.price_provider) p.asset, p.price_provider, p.price_usd, p.timestamp",
        "FROM loan_asset_prices p",
        "JOIN UNNEST($1::text[], $2::text[]) AS w(asset, price_provider)",
        "ON w.asset = p.asset AND w.price_provider = p.price_provider",
        "ORDER BY p.asset, p.price_provider, p.timestamp DESC",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in: {sql}");
    }
}
