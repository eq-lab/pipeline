// spec: docs/product-specs/collateral-valuation.md#per-loan-valuation-record

const SQL: &str =
    include_str!("../migrations/20261119000001_normalize_collateral_valuation_asset.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn the_asset_update_is_guarded_and_idempotent() {
    assert!(flat().contains(
        "UPDATE loan_collateral_valuations SET asset = upper(btrim(asset, E' \\t\\n\\r\\f\\v')), updated_at = now() WHERE asset <> upper(btrim(asset, E' \\t\\n\\r\\f\\v'));"
    ));
}

#[test]
fn the_provider_update_is_guarded_and_idempotent() {
    assert!(flat().contains(
        "UPDATE loan_collateral_valuations SET price_provider = lower(btrim(price_provider, E' \\t\\n\\r\\f\\v')), updated_at = now() WHERE price_provider <> lower(btrim(price_provider, E' \\t\\n\\r\\f\\v'));"
    ));
}

#[test]
fn trimming_covers_the_same_whitespace_as_rust_trim() {
    let set = r"E' \t\n\r\f\v'";
    assert_eq!(SQL.matches(set).count(), 4);
    assert!(!SQL.contains("btrim(asset)") && !SQL.contains("btrim(price_provider)"));
}

#[test]
fn no_constraint_is_added_and_a_rollback_note_exists() {
    assert!(!SQL.contains("ADD CONSTRAINT"));
    assert!(SQL.contains("Rollback"));
}
