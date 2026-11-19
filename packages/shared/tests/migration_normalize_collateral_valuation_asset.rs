// spec: docs/product-specs/collateral-valuation.md#per-loan-valuation-record

const SQL: &str =
    include_str!("../migrations/20261119000001_normalize_collateral_valuation_asset.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn the_asset_update_is_guarded_and_idempotent() {
    assert!(flat().contains(
        "UPDATE loan_collateral_valuations SET asset = upper(btrim(asset)), updated_at = now() WHERE asset <> upper(btrim(asset));"
    ));
}

#[test]
fn the_provider_update_is_guarded_and_idempotent() {
    assert!(flat().contains(
        "UPDATE loan_collateral_valuations SET price_provider = lower(btrim(price_provider)), updated_at = now() WHERE price_provider <> lower(btrim(price_provider));"
    ));
}

#[test]
fn no_constraint_is_added_and_a_rollback_note_exists() {
    assert!(!SQL.contains("ADD CONSTRAINT"));
    assert!(SQL.contains("Rollback"));
}
