// spec: docs/references/security-registry-events.md#projection-tables
const SQL: &str = include_str!("../migrations/20261106000001_security_registry.sql");

fn flat() -> String {
    SQL.split_whitespace().collect::<Vec<_>>().join(" ")
}

const TABLES: [(&str, &str); 10] = [
    (
        "security_view_snapshots",
        "PRIMARY KEY (chain_id, contract_address, kind, entity_id)",
    ),
    (
        "security_registry_state",
        "PRIMARY KEY (chain_id, contract_address)",
    ),
    (
        "security_terms",
        "PRIMARY KEY (chain_id, contract_address, loan_id)",
    ),
    (
        "security_records",
        "PRIMARY KEY (chain_id, contract_address, record_id)",
    ),
    (
        "security_record_docs",
        "PRIMARY KEY (chain_id, contract_address, record_id, position)",
    ),
    (
        "security_margin_call_events",
        "PRIMARY KEY (chain_id, contract_address, block_number, log_index)",
    ),
    (
        "security_inspections",
        "PRIMARY KEY (chain_id, contract_address, inspection_id)",
    ),
    (
        "security_lots",
        "PRIMARY KEY (chain_id, contract_address, lot_id)",
    ),
    (
        "security_extension_consents",
        "PRIMARY KEY (chain_id, contract_address, loan_id, position)",
    ),
    (
        "security_loan_valuations",
        "PRIMARY KEY (chain_id, contract_address, loan_id)",
    ),
];

fn table_body(name: &str) -> String {
    let f = flat();
    let start = f
        .find(&format!("CREATE TABLE IF NOT EXISTS {name} ("))
        .unwrap_or_else(|| panic!("missing table {name}"));
    let rest = &f[start..];
    let end = rest.find(");").unwrap();
    rest[..end].to_owned()
}

#[test]
fn creates_every_table_idempotently_with_its_primary_key() {
    for (table, pk) in TABLES {
        let body = table_body(table);
        assert!(body.contains(pk), "{table}: {pk}");
        assert!(body.contains("chain_id BIGINT NOT NULL"), "{table}");
        assert!(body.contains("contract_address TEXT NOT NULL"), "{table}");
    }
}

#[test]
fn every_column_is_present() {
    let cols: [(&str, &[&str]); 10] = [
        (
            "security_view_snapshots",
            &[
                "kind TEXT NOT NULL CHECK (kind IN ('record','inspection','loan','contract'))",
                "entity_id BIGINT NOT NULL",
                "loan_id BIGINT NULL",
                "as_of_ledger BIGINT NOT NULL",
                "payload JSONB NOT NULL",
                "fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()",
            ],
        ),
        (
            "security_registry_state",
            &[
                "paused BOOLEAN NULL",
                "inspectors JSONB NULL",
                "loan_registry TEXT NULL",
                "projection_version INT NOT NULL DEFAULT 0",
                "projected_log_id BIGINT NOT NULL DEFAULT 0",
                "projected_snapshot_at TIMESTAMPTZ NULL",
                "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
            ],
        ),
        (
            "security_terms",
            &[
                "advance_ratio_bps BIGINT NOT NULL",
                "margin_call_ratio_bps BIGINT NOT NULL",
                "cure_period NUMERIC NOT NULL",
                "price_stale_after NUMERIC NOT NULL",
                "payment_term TEXT NOT NULL",
                "grace_period NUMERIC NOT NULL",
                "default_rate BIGINT NOT NULL",
                "attestation_interval NUMERIC NOT NULL",
                "inspection_interval NUMERIC NOT NULL",
                "tolerance_bps BIGINT NOT NULL",
                "grade_tolerance_bps BIGINT NOT NULL",
                "margin_call_at NUMERIC NOT NULL",
                "set_ledger BIGINT NULL",
                "complete BOOLEAN NOT NULL",
            ],
        ),
        (
            "security_records",
            &[
                "loan_id BIGINT NOT NULL",
                "lot_id BIGINT NOT NULL",
                "protection TEXT NOT NULL",
                "commodity TEXT NULL",
                "unit TEXT NULL",
                "reference_quantity NUMERIC NULL",
                "reference_grade NUMERIC NULL",
                "region TEXT NULL",
                "site_hash TEXT NULL",
                "control_kind TEXT NULL",
                "control_reference TEXT NULL",
                "perfection TEXT NULL",
                "release_condition TEXT NULL",
                "status TEXT NOT NULL",
                "perfected_at NUMERIC NULL",
                "attested_by TEXT NULL",
                "attested_at NUMERIC NULL",
                "flagged_by BIGINT NULL",
                "mark_value_per_unit NUMERIC NULL",
                "mark_at NUMERIC NULL",
                "mark_benchmark TEXT NULL",
                "mark_report_hash TEXT NULL",
                "registered_ledger BIGINT NULL",
                "closed_ledger BIGINT NULL",
                "release_reason_hash TEXT NULL",
                "released_by_consent BOOLEAN NULL",
                "complete BOOLEAN NOT NULL",
                "needs_view BOOLEAN NOT NULL",
                "view_ledger BIGINT NULL",
            ],
        ),
        (
            "security_record_docs",
            &[
                "position INT NOT NULL",
                "loan_id BIGINT NOT NULL",
                "kind TEXT NOT NULL",
                "sha256 TEXT NOT NULL",
                "source TEXT NOT NULL",
                "ledger BIGINT NULL",
            ],
        ),
        (
            "security_margin_call_events",
            &[
                "log_index INT NOT NULL",
                "loan_id BIGINT NOT NULL",
                "kind TEXT NOT NULL",
                "ltv_bps BIGINT NOT NULL",
                "margin_call_ratio_bps BIGINT NULL",
                "cure_by NUMERIC NULL",
                "block_timestamp BIGINT NOT NULL",
                "tx_hash TEXT NOT NULL",
            ],
        ),
        (
            "security_inspections",
            &[
                "loan_id BIGINT NOT NULL",
                "record_id BIGINT NOT NULL",
                "lot_id BIGINT NOT NULL",
                "inspector TEXT NOT NULL",
                "kind TEXT NOT NULL",
                "inspected_at NUMERIC NULL",
                "quantity NUMERIC NULL",
                "grade NUMERIC NULL",
                "certificate_hash TEXT NULL",
                "certificate_no TEXT NULL",
                "entered_by TEXT NULL",
                "entered_at NUMERIC NULL",
                "approved_by TEXT NULL",
                "approved_at NUMERIC NULL",
                "variance_reference_bps INT NULL",
                "variance_previous_bps INT NULL",
                "variance_grade_bps INT NULL",
                "flagged BOOLEAN NULL",
                "resolution TEXT NULL",
                "resolution_reason_hash TEXT NULL",
                "resolved_at NUMERIC NULL",
                "recorded_ledger BIGINT NULL",
                "approved_ledger BIGINT NULL",
                "complete BOOLEAN NOT NULL",
                "needs_view BOOLEAN NOT NULL",
            ],
        ),
        (
            "security_lots",
            &[
                "loan_id BIGINT NOT NULL",
                "latest_inspection_id BIGINT NULL",
                "latest_inspected_at NUMERIC NULL",
                "latest_quantity NUMERIC NULL",
                "complete BOOLEAN NOT NULL",
            ],
        ),
        (
            "security_extension_consents",
            &[
                "position INT NOT NULL",
                "consent_hash TEXT NOT NULL",
                "new_maturity NUMERIC NULL",
                "ledger BIGINT NULL",
                "block_timestamp BIGINT NULL",
            ],
        ),
        (
            "security_loan_valuations",
            &[
                "value NUMERIC NOT NULL",
                "stale_value NUMERIC NOT NULL",
                "flagged_value NUMERIC NOT NULL",
                "debt NUMERIC NOT NULL",
                "coverage_bps BIGINT NOT NULL",
                "ltv_bps BIGINT NOT NULL",
                "margin_call_at NUMERIC NOT NULL",
                "cure_by NUMERIC NOT NULL",
                "price_stale BOOLEAN NOT NULL",
                "counted_records JSONB NOT NULL",
                "detail_ledger BIGINT NOT NULL",
                "loan_registry TEXT NOT NULL",
                "outstanding NUMERIC NOT NULL",
                "accrued_interest NUMERIC NOT NULL",
                "money_ledger BIGINT NOT NULL",
                "source_log_id BIGINT NOT NULL",
                "fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()",
            ],
        ),
    ];
    for (table, columns) in cols {
        let body = table_body(table);
        for col in columns {
            assert!(body.contains(col), "{table}: missing `{col}`");
        }
    }
}

#[test]
fn loan_indexes_exist() {
    let f = flat();
    for index in [
        "idx_security_records_loan ON security_records (chain_id, contract_address, loan_id)",
        "idx_security_record_docs_loan ON security_record_docs (chain_id, contract_address, loan_id)",
        "idx_security_margin_call_events_loan ON security_margin_call_events (chain_id, contract_address, loan_id)",
        "idx_security_inspections_loan ON security_inspections (chain_id, contract_address, loan_id)",
        "idx_security_lots_loan ON security_lots (chain_id, contract_address, loan_id)",
    ] {
        assert!(f.contains(&format!("CREATE INDEX IF NOT EXISTS {index}")), "{index}");
    }
}

#[test]
fn is_additive_only() {
    let live: String = SQL
        .lines()
        .filter(|l| !l.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n")
        .to_uppercase();
    for forbidden in [
        "ALTER ", "DROP ", "DELETE ", "UPDATE ", "TRUNCATE", "INSERT ",
    ] {
        assert!(!live.contains(forbidden), "{forbidden}");
    }
}
