// spec: docs/product-specs/api-authorization-loan-submission.md

use shared::migrations::{parse_optional_default_chain_id, DEFAULT_CHAIN_GUC, MIGRATOR};

const SQL: &str = include_str!("../migrations/20261015000001_submitted_loans_target_chain.sql");

fn pos(needle: &str) -> usize {
    SQL.find(needle)
        .unwrap_or_else(|| panic!("migration is missing `{needle}`"))
}

#[test]
fn migration_declares_column_constraint_and_indexes() {
    pos("ADD COLUMN target_chain_id BIGINT");
    pos("SET NOT NULL");
    pos("submitted_loans_link_on_target_ck");
    pos("DROP INDEX submitted_loans_loan_lookup_idx");
    let flat = SQL.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(flat.contains("CREATE UNIQUE INDEX submitted_loans_chain_loan_uk ON submitted_loans (chain_id, loan_id) WHERE loan_id IS NOT NULL"));
}

#[test]
fn migration_reads_the_runner_guc() {
    pos(&format!("current_setting('{DEFAULT_CHAIN_GUC}', true)"));
}

#[test]
fn migration_steps_are_ordered() {
    let dup = pos("RAISE EXCEPTION 'submitted_loans has a (chain_id, loan_id)");
    let drawn = pos("SET target_chain_id = chain_id WHERE chain_id IS NOT NULL");
    let guc = pos(&format!("current_setting('{DEFAULT_CHAIN_GUC}', true)"));
    let not_null = pos("SET NOT NULL");
    let unique = pos("CREATE UNIQUE INDEX submitted_loans_chain_loan_uk");
    assert!(dup < drawn && drawn < guc && guc < not_null && not_null < unique);
}

#[test]
fn migration_header_documents_rollback() {
    let line = SQL
        .lines()
        .find(|l| l.contains("DROP COLUMN target_chain_id"))
        .expect("rollback SQL");
    assert!(line.starts_with("--"));
}

#[test]
fn missing_default_error_names_default_chain_id_not_start_order() {
    let msg_start = pos("backfill needs DEFAULT_CHAIN_ID");
    let tail = &SQL[msg_start..];
    let msg = &tail[..tail.find('\'').unwrap()];
    assert!(msg.contains("DEFAULT_CHAIN_ID"));
    assert!(!msg.to_lowercase().contains("start the api"));
}

#[test]
fn migrator_embeds_the_migration() {
    assert!(MIGRATOR.iter().any(|m| m.version == 20_261_015_000_001));
}

#[test]
fn parse_optional_default_chain_id_cases() {
    let chains = [1, 99_000_001];
    assert_eq!(
        parse_optional_default_chain_id(None, &chains).unwrap(),
        None
    );
    assert_eq!(
        parse_optional_default_chain_id(Some(""), &chains).unwrap(),
        None
    );
    assert_eq!(
        parse_optional_default_chain_id(Some("  "), &chains).unwrap(),
        None
    );
    assert_eq!(
        parse_optional_default_chain_id(Some("99000001"), &chains).unwrap(),
        Some(99_000_001)
    );
    assert_eq!(
        parse_optional_default_chain_id(Some(" 1 "), &chains).unwrap(),
        Some(1)
    );
    let err = parse_optional_default_chain_id(Some("abc"), &chains).unwrap_err();
    assert!(err.to_string().contains("DEFAULT_CHAIN_ID"));
}

#[test]
fn parse_optional_default_chain_id_rejects_unconfigured_chain() {
    let err = parse_optional_default_chain_id(Some("5"), &[1, 2]).unwrap_err();
    assert!(err.to_string().contains("not a member of CHAINS"));
}

#[test]
fn rollback_deletes_migration_record_in_one_transaction() {
    assert!(SQL.contains("DELETE FROM _sqlx_migrations WHERE version = 20261015000001;"));
    assert!(SQL.contains("ONE transaction"));
}
