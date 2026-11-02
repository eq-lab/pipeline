// spec: docs/product-specs/deposits.md#lp-funding-details

const SQL: &str =
    include_str!("../migrations/20261102000001_system_configuration_lp_payment_details.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn has(needle: &str) {
    assert!(flat().contains(needle), "migration is missing `{needle}`");
}

#[test]
fn system_configuration_is_keyed_by_a_checked_type() {
    has("CREATE TABLE system_configuration (");
    has("type TEXT PRIMARY KEY");
    has("CHECK (type IN ('system_bank_details'))");
    has("value JSONB NOT NULL");
}

#[test]
fn the_seed_row_carries_every_key_empty() {
    has("INSERT INTO system_configuration (type, value)");
    for key in [
        "company_name",
        "bank_name",
        "bank_address",
        "account_number",
        "iban",
        "swift_bic_code",
    ] {
        has(&format!("\"{key}\": \"\""));
    }
}

#[test]
fn every_shape_check_is_null_safe() {
    let flat = flat();
    assert_eq!(flat.matches("IS NOT DISTINCT FROM 'string'").count(), 6);
    assert!(
        !flat.contains("') = 'string'"),
        "a bare = 'string' on a value-> path"
    );
    for line in SQL.lines().filter(|l| l.contains("value->")) {
        assert!(line.contains("IS NOT DISTINCT FROM 'string'"), "{line}");
    }
}

#[test]
fn the_history_table_is_not_unique_on_lp_id() {
    has("id BIGSERIAL PRIMARY KEY");
    has("lp_id BIGINT NOT NULL REFERENCES lps(id)");
    has("payment_details VARCHAR(140) NOT NULL");
    has("CONSTRAINT lp_requested_bank_details_payment_details_key UNIQUE");
    has("CHECK (payment_details ~ '^[A-Z0-9-]{1,140}$')");
    has("CREATE INDEX idx_lp_requested_bank_details_lp_id_created_at ON lp_requested_bank_details (lp_id, created_at DESC)");
    let lp_line = SQL
        .lines()
        .find(|l| l.contains("lp_id           BIGINT"))
        .unwrap();
    assert!(!lp_line.contains("PRIMARY KEY") && !lp_line.contains("UNIQUE"));
    assert!(!SQL.contains("ON CONFLICT"));
}

#[test]
fn the_rollback_is_documented_as_comment_lines() {
    let drops: Vec<&str> = SQL.lines().filter(|l| l.contains("DROP TABLE")).collect();
    assert_eq!(drops.len(), 2);
    assert!(drops.iter().all(|l| l.starts_with("--")));
}
