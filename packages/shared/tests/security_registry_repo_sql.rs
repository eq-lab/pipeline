// spec: docs/references/security-registry-events.md#projection-tables
use shared::security_registry_repo::*;

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn assert_has(sql: &str, needles: &[&str]) {
    let sql = flat(sql);
    for needle in needles {
        assert!(sql.contains(needle), "missing `{needle}` in: {sql}");
    }
}

#[test]
fn event_reads_are_scoped_to_chain_and_contract_and_ordered() {
    assert_has(
        LIST_LOAN_EVENTS_SQL,
        &[
            "FROM contract_logs",
            "chain_id = $1",
            "AND contract_address = $2",
            "event_name = ANY($3)",
            "params->>'loan_id' = $4",
            "ORDER BY block_number, log_index",
        ],
    );
    assert_has(
        LIST_CONTRACT_EVENTS_SQL,
        &[
            "chain_id = $1",
            "AND contract_address = $2",
            "event_name = ANY($3)",
            "ORDER BY block_number, log_index",
        ],
    );
    assert_has(
        MAX_LOG_ID_SQL,
        &["chain_id = $1 AND contract_address = $2", "MAX(id)"],
    );
}

#[test]
fn every_contract_logs_query_filters_on_contract_address() {
    for sql in [
        LIST_LOAN_EVENTS_SQL,
        LIST_CONTRACT_EVENTS_SQL,
        MAX_LOG_ID_SQL,
        LIST_DIRTY_LOANS_SQL,
        LIST_ALL_LOANS_SQL,
        LIST_RECORD_EVENT_LEDGERS_SQL,
        LIST_INSPECTION_IDS_SQL,
        LIST_KNOWN_LOANS_SQL,
        LIST_LOANS_WITH_TERMS_EVENT_SQL,
        LIST_RECORD_LOANS_SQL,
        LIST_VALUATION_CANDIDATES_SQL,
    ] {
        let f = flat(sql);
        let scans = f.matches("FROM contract_logs").count();
        let scoped = f.matches("contract_address = ").count();
        assert!(scans >= 1);
        assert!(
            scoped >= scans && f.matches("chain_id = $1").count() >= scans,
            "unscoped contract_logs read: {f}"
        );
    }
}

#[test]
fn dirty_loans_union_new_events_and_newer_snapshots() {
    assert_has(
        LIST_DIRTY_LOANS_SQL,
        &[
            "id > $3",
            "event_name = ANY($5)",
            "UNION",
            "FROM security_view_snapshots",
            "fetched_at > $4",
            "$4::timestamptz IS NULL",
        ],
    );
    assert_has(
        LIST_ALL_LOANS_SQL,
        &["UNION", "FROM security_view_snapshots"],
    );
}

#[test]
fn snapshot_upsert_only_moves_forward() {
    assert_has(
        UPSERT_SNAPSHOT_SQL,
        &[
            "ON CONFLICT (chain_id, contract_address, kind, entity_id) DO UPDATE",
            "WHERE EXCLUDED.as_of_ledger > security_view_snapshots.as_of_ledger",
            "fetched_at = now()",
        ],
    );
    assert_has(
        LIST_SNAPSHOTS_FOR_LOAN_SQL,
        &[
            "chain_id = $1",
            "contract_address = $2",
            "loan_id = $3",
            "kind <> 'contract'",
        ],
    );
    assert_has(
        GET_CONTRACT_SNAPSHOT_SQL,
        &["kind = 'contract'", "entity_id = 0"],
    );
    assert_has(
        LIST_SNAPSHOT_LEDGERS_SQL,
        &["chain_id = $1 AND contract_address = $2"],
    );
}

#[test]
fn snapshot_need_inputs() {
    assert_has(
        LIST_RECORD_EVENT_LEDGERS_SQL,
        &[
            "event_name = ANY($3)",
            "FILTER (WHERE event_name = ANY($4))",
            "'SecurityRecordHandedOver'",
            "params->>'to_record_id'",
            "GROUP BY rid",
        ],
    );
    assert_has(LIST_INSPECTION_IDS_SQL, &["'SecurityInspectionRecorded'"]);
    assert_has(
        LIST_KNOWN_LOANS_SQL,
        &[
            "contract_address = $3",
            "event_name = 'LoanDrawn'",
            "event_name = ANY($4)",
        ],
    );
    assert_has(LIST_LOANS_WITH_TERMS_EVENT_SQL, &["'SecurityTermsSet'"]);
    assert_has(
        LIST_RECORD_LOANS_SQL,
        &["'SecurityRecordRegistered'", "kind = 'record'"],
    );
}

#[test]
fn deletes_are_scoped_by_chain_contract_and_loan() {
    for (sql, table) in [
        (DELETE_LOAN_RECORDS_SQL, "security_records"),
        (DELETE_LOAN_DOCS_SQL, "security_record_docs"),
        (DELETE_LOAN_TERMS_SQL, "security_terms"),
        (DELETE_LOAN_MARGIN_EVENTS_SQL, "security_margin_call_events"),
        (DELETE_LOAN_INSPECTIONS_SQL, "security_inspections"),
        (DELETE_LOAN_LOTS_SQL, "security_lots"),
        (DELETE_LOAN_CONSENTS_SQL, "security_extension_consents"),
    ] {
        assert_has(
            sql,
            &[
                &format!("DELETE FROM {table}"),
                "chain_id = $1 AND contract_address = $2 AND loan_id = $3",
            ],
        );
    }
}

#[test]
fn inserts_name_their_table_and_bind_every_column() {
    for (sql, table, binds) in [
        (INSERT_TERMS_SQL, "security_terms", 17),
        (INSERT_RECORD_SQL, "security_records", 32),
        (INSERT_DOC_SQL, "security_record_docs", 9),
        (INSERT_MARGIN_EVENT_SQL, "security_margin_call_events", 11),
        (INSERT_INSPECTION_SQL, "security_inspections", 30),
        (INSERT_LOT_SQL, "security_lots", 8),
        (INSERT_CONSENT_SQL, "security_extension_consents", 8),
    ] {
        let f = flat(sql);
        assert!(f.contains(&format!("INSERT INTO {table}")), "{table}");
        assert!(
            f.contains(&format!("${binds})")),
            "{table} should end at ${binds}"
        );
        assert!(!f.contains(&format!("${})", binds + 1)), "{table}");
    }
}

#[test]
fn state_watermark_and_valuation_queries() {
    assert_has(
        UPSERT_REGISTRY_STATE_SQL,
        &[
            "ON CONFLICT (chain_id, contract_address) DO UPDATE",
            "paused = EXCLUDED.paused",
        ],
    );
    assert_has(
        UPDATE_PROJECTION_WATERMARK_SQL,
        &[
            "projection_version = EXCLUDED.projection_version",
            "projected_log_id = EXCLUDED.projected_log_id",
        ],
    );
    assert_has(
        GET_PROJECTION_STATE_SQL,
        &["projection_version, projected_log_id, projected_snapshot_at"],
    );
    assert_has(MAX_SNAPSHOT_FETCHED_AT_SQL, &["MAX(fetched_at)"]);
    assert_has(
        LIST_VALUATION_CANDIDATES_SQL,
        &[
            "FROM security_terms t",
            "LEFT JOIN security_loan_valuations v",
            "contract_address = ANY($3)",
            "GROUP BY params->>'loan_id'",
            "MAX(id) AS latest_log_id",
            "l.loan_key = t.loan_id::text",
            "t.contract_address = $2",
        ],
    );
    assert_has(
        UPSERT_VALUATION_SQL,
        &[
            "ON CONFLICT (chain_id, contract_address, loan_id) DO UPDATE",
            "source_log_id = EXCLUDED.source_log_id",
        ],
    );
}
