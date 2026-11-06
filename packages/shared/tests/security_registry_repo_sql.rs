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

const LOAN_READS: [(&str, &str); 7] = [
    ("GET_TERMS_SQL", GET_TERMS_SQL),
    ("LIST_RECORDS_FOR_LOAN_SQL", LIST_RECORDS_FOR_LOAN_SQL),
    ("LIST_DOCS_FOR_LOAN_SQL", LIST_DOCS_FOR_LOAN_SQL),
    (
        "LIST_INSPECTIONS_FOR_LOAN_SQL",
        LIST_INSPECTIONS_FOR_LOAN_SQL,
    ),
    ("LIST_LOTS_FOR_LOAN_SQL", LIST_LOTS_FOR_LOAN_SQL),
    (
        "LIST_MARGIN_EVENTS_FOR_LOAN_SQL",
        LIST_MARGIN_EVENTS_FOR_LOAN_SQL,
    ),
    ("LIST_CONSENTS_FOR_LOAN_SQL", LIST_CONSENTS_FOR_LOAN_SQL),
];

#[test]
fn every_per_loan_read_binds_chain_contract_and_loan() {
    for (name, sql) in LOAN_READS {
        assert_has(
            sql,
            &[
                "chain_id = $1",
                "AND contract_address = $2",
                "AND loan_id = $3",
            ],
        );
        assert!(!flat(sql).contains("$4"), "{name} binds more than three");
    }
    assert_has(
        GET_VALUATION_SQL,
        &[
            "chain_id = $1",
            "AND contract_address = $2",
            "AND loan_id = $3",
        ],
    );
    assert_has(
        GET_REGISTRY_STATE_SQL,
        &["chain_id = $1 AND contract_address = $2"],
    );
}

#[test]
fn per_loan_reads_read_the_projection_tables() {
    for (sql, table) in [
        (GET_TERMS_SQL, "FROM security_terms"),
        (LIST_RECORDS_FOR_LOAN_SQL, "FROM security_records"),
        (LIST_DOCS_FOR_LOAN_SQL, "FROM security_record_docs"),
        (LIST_INSPECTIONS_FOR_LOAN_SQL, "FROM security_inspections"),
        (LIST_LOTS_FOR_LOAN_SQL, "FROM security_lots"),
        (
            LIST_MARGIN_EVENTS_FOR_LOAN_SQL,
            "FROM security_margin_call_events",
        ),
        (
            LIST_CONSENTS_FOR_LOAN_SQL,
            "FROM security_extension_consents",
        ),
        (GET_VALUATION_SQL, "FROM security_loan_valuations"),
        (GET_REGISTRY_STATE_SQL, "FROM security_registry_state"),
    ] {
        assert_has(sql, &[table]);
    }
}

#[test]
fn per_loan_reads_are_ordered() {
    assert_has(LIST_RECORDS_FOR_LOAN_SQL, &["ORDER BY record_id"]);
    assert_has(LIST_DOCS_FOR_LOAN_SQL, &["ORDER BY record_id, position"]);
    assert_has(
        LIST_INSPECTIONS_FOR_LOAN_SQL,
        &["ORDER BY record_id, inspection_id"],
    );
    assert_has(LIST_LOTS_FOR_LOAN_SQL, &["ORDER BY lot_id"]);
    assert_has(
        LIST_MARGIN_EVENTS_FOR_LOAN_SQL,
        &["ORDER BY block_number, log_index"],
    );
    assert_has(LIST_CONSENTS_FOR_LOAN_SQL, &["ORDER BY position"]);
}

#[test]
fn margin_event_log_index_is_widened_to_the_row_type() {
    assert_has(
        LIST_MARGIN_EVENTS_FOR_LOAN_SQL,
        &["log_index::bigint AS log_index"],
    );
}

#[test]
fn the_valuation_read_selects_the_snapshot_columns_and_fetched_at() {
    assert_has(
        GET_VALUATION_SQL,
        &[
            "counted_records",
            "fetched_at",
            "detail_ledger",
            "money_ledger",
            "outstanding",
            "accrued_interest",
            "source_log_id",
            "loan_registry",
        ],
    );
}

#[test]
fn the_registry_read_selects_the_watermark() {
    assert_has(
        GET_REGISTRY_STATE_SQL,
        &["paused", "inspectors", "projected_log_id"],
    );
}

#[test]
fn the_log_watermarks_are_scoped_to_the_chain_loan_and_contract_list() {
    assert_has(
        LOAN_LOG_WATERMARKS_SQL,
        &[
            "FROM contract_logs",
            "chain_id = $1",
            "MAX(id) FILTER (WHERE contract_address = $2)",
            "contract_address = ANY($4)",
            "params @> jsonb_build_object('loan_id', $3::text)",
        ],
    );
}

#[test]
fn the_sale_repayment_read_links_by_sale_and_pairs_the_earliest_reversal() {
    assert_has(
        LIST_SALE_REPAYMENTS_SQL,
        &[
            "r.chain_id = $1",
            "r.event_name = 'CashRepaid'",
            "r.params @> jsonb_build_object('loan_id', $2::text)",
            "r.params @> jsonb_build_object('loan_id', $2::bigint)",
            "r.params->>'sale_id' = ANY($3)",
            "LEFT JOIN LATERAL",
            "v.event_name = 'CashRepaymentReversed'",
            "v.params->>'repayment_id' = r.params->>'repayment_id'",
            "v.params->>'loan_id' = r.params->>'loan_id'",
            "v.contract_address = r.contract_address",
            "v.chain_id = r.chain_id",
            "ORDER BY v.block_number, v.log_index",
            "LIMIT 1",
            "ORDER BY r.block_number, r.log_index",
        ],
    );
}

#[test]
fn the_sale_repayment_read_is_not_pinned_to_one_minter() {
    let f = flat(LIST_SALE_REPAYMENTS_SQL);
    assert!(!f.contains("r.contract_address ="), "{f}");
    assert!(!f.contains("WHERE contract_address"), "{f}");
}

#[test]
fn the_read_transaction_is_repeatable_read_and_read_only() {
    assert_has(
        SECURITY_READ_TX_SQL,
        &["SET TRANSACTION", "REPEATABLE READ", "READ ONLY"],
    );
}

#[test]
fn a_sale_repayment_links_only_from_the_records_enforcement_onward() {
    assert_has(
        LIST_SALE_REPAYMENTS_SQL,
        &[
            "AND EXISTS",
            "e.contract_address = $4",
            "e.event_name IN ('SecurityEnforcementStarted', 'SecurityRecordEnforced')",
            "e.params @> jsonb_build_object('loan_id', $2::text, 'record_id', r.params->>'sale_id')",
            "(e.block_number, e.log_index) <= (r.block_number, r.log_index)",
        ],
    );
}
