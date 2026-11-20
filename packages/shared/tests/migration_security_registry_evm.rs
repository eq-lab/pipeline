// spec: docs/references/security-registry-events.md#projection-tables
const SQL: &str = include_str!("../migrations/20261118000001_security_registry_evm.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn statements() -> Vec<String> {
    SQL.lines()
        .filter(|l| !l.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join(" ")
        .split(';')
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|s| !s.is_empty())
        .collect()
}

#[test]
fn adds_the_five_columns_idempotently_and_nullable() {
    let f = flat();
    for clause in [
        "ADD COLUMN IF NOT EXISTS default_ratio_bps BIGINT NULL",
        "ADD COLUMN IF NOT EXISTS originator_fee_rate BIGINT NULL",
        "ADD COLUMN IF NOT EXISTS default_breach_at NUMERIC NULL",
        "ADD COLUMN IF NOT EXISTS default_ratio_bps BIGINT NULL",
        "ADD COLUMN IF NOT EXISTS default_breach_at NUMERIC NULL",
    ] {
        assert!(f.contains(clause), "{clause}");
    }
    assert_eq!(f.matches("ADD COLUMN IF NOT EXISTS").count(), 5);
}

#[test]
fn each_column_lands_on_its_table() {
    let stmts = statements();
    assert_eq!(stmts.len(), 3);
    assert!(stmts[0].starts_with("ALTER TABLE security_terms "));
    assert!(stmts[0].contains("default_ratio_bps BIGINT NULL"));
    assert!(stmts[0].contains("originator_fee_rate BIGINT NULL"));
    assert!(stmts[0].contains("default_breach_at NUMERIC NULL"));
    assert!(stmts[1].starts_with("ALTER TABLE security_margin_call_events "));
    assert!(stmts[1].contains("default_ratio_bps BIGINT NULL"));
    assert!(stmts[2].starts_with("ALTER TABLE security_loan_valuations "));
    assert!(stmts[2].contains("default_breach_at NUMERIC NULL"));
}

#[test]
fn changes_nothing_else() {
    let body = statements().join(" ; ");
    for forbidden in [
        "DROP",
        "NOT NULL",
        "CHECK",
        "ALTER COLUMN",
        "CREATE",
        "UPDATE",
    ] {
        assert!(!body.contains(forbidden), "{forbidden}");
    }
}
