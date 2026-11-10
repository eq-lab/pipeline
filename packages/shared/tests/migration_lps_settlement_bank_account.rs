// spec: docs/product-specs/kyb-lp-verification.md#settlement-bank-account

const SQL: &str = include_str!("../migrations/20261110000002_lps_settlement_bank_account.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn the_column_is_added_nullable_without_a_default() {
    assert!(flat().contains("ALTER TABLE lps ADD COLUMN settlement_bank_account JSONB;"));
}

#[test]
fn the_check_names_every_key() {
    let f = flat();
    assert!(f.contains("CONSTRAINT lps_settlement_bank_account_shape_ck CHECK"));
    for required in ["account_holder_name", "bank_name"] {
        assert!(f.contains(&format!(
            "jsonb_typeof(settlement_bank_account->'{required}') IS NOT DISTINCT FROM 'string'"
        )));
    }
    for optional in [
        "bank_address",
        "account_number",
        "iban",
        "swift_bic_code",
        "routing_number",
    ] {
        assert!(
            f.contains(&format!(
                "COALESCE(jsonb_typeof(settlement_bank_account->'{optional}'), 'missing') IN ('string', 'null')"
            )),
            "{optional}"
        );
    }
}

#[test]
fn the_check_rejects_extra_keys() {
    assert!(flat().contains("AND settlement_bank_account - ARRAY['account_holder_name','bank_name','bank_address','account_number','iban','swift_bic_code','routing_number'] = '{}'::jsonb"));
}

#[test]
fn the_migration_documents_its_rollback() {
    assert!(SQL.contains("-- Rollback:"));
    assert!(SQL.contains("DROP CONSTRAINT lps_settlement_bank_account_shape_ck"));
    assert!(SQL.contains("DROP COLUMN settlement_bank_account"));
    assert!(SQL.contains("-- DELETE FROM _sqlx_migrations WHERE version = 20261110000002;"));
}
