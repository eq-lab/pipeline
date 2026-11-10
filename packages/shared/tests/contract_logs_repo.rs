// spec: docs/exec-plans/completed/issue-1433-stellar-loan-parsers-realignment.md#test-strategy
use shared::contract_logs_repo::{
    EARLIEST_ORIGINATION_DATE_FOR_REGISTRY_SQL, LATEST_STATUS_BY_LOANS_SQL,
    LATEST_WATCHLIST_ENTRY_SQL, LEGACY_YIELD_MINTED_SQL, LIST_LATEST_LOAN_SNAPSHOTS_SQL,
    LIST_REPAYMENT_MINTS_SQL, LIST_WITHDRAWAL_QUEUE_ROWS_SQL, LIST_WITHDRAWAL_RATE_SETS_SQL,
    LOAN_ECONOMICS_EVENTS_SQL, LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL, LOAN_LIFECYCLE_EVENT_NAMES,
    LOAN_RATE_EVENTS_FOR_REGISTRY_SQL, LOAN_SNAPSHOT_AS_OF_SQL, LP_WIRE_IN_EVENTS_SQL,
    LP_WIRE_OUT_EVENTS_SQL, MINTER_CASH_BOOK_EVENT_NAMES, MINTER_EVENTS_SQL,
    MINTER_FOLD_EVENTS_SQL, WITHDRAWAL_QUEUE_TOTALS_SQL,
};

fn normalized(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn assert_registry_scoped(sql: &str, placeholder: u8) {
    let sql = normalized(sql);
    assert!(
        sql.contains("chain_id = $1"),
        "missing chain_id predicate: {sql}"
    );
    assert!(
        sql.contains(&format!("AND contract_address = ${placeholder}")),
        "expected contract_address = ${placeholder}: {sql}"
    );
}

#[test]
fn loan_lifecycle_event_names_covers_every_stored_loan_event() {
    let expected = [
        "LoanDrawn",
        "LoanStatusUpdated",
        "LoanCCRUpdated",
        "LoanLocationUpdated",
        "LoanDefaulted",
        "LoanClosed",
        "PaymentRecorded",
        "PaymentUnrecorded",
        "LoanRolledOver",
        "EconomicsAmended",
        "Disbursed",
        "Undisbursed",
        "LoanWrittenDown",
        "InterestAdjusted",
    ];

    for name in expected {
        assert!(
            LOAN_LIFECYCLE_EVENT_NAMES.contains(&name),
            "LOAN_LIFECYCLE_EVENT_NAMES is missing '{name}'"
        );
    }
    assert_eq!(
        LOAN_LIFECYCLE_EVENT_NAMES.len(),
        expected.len(),
        "LOAN_LIFECYCLE_EVENT_NAMES has an unexpected extra entry"
    );
}

#[test]
fn loan_lifecycle_event_names_has_no_duplicates() {
    let mut sorted = LOAN_LIFECYCLE_EVENT_NAMES.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), LOAN_LIFECYCLE_EVENT_NAMES.len());
}

#[test]
fn list_latest_loan_snapshots_sql_is_registry_scoped() {
    assert_registry_scoped(LIST_LATEST_LOAN_SNAPSHOTS_SQL, 2);
}

#[test]
fn loan_lifecycle_events_for_registry_sql_is_registry_scoped() {
    assert_registry_scoped(LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL, 4);
}

#[test]
fn loan_rate_events_sql_is_registry_scoped() {
    assert_registry_scoped(LOAN_RATE_EVENTS_FOR_REGISTRY_SQL, 4);
}

#[test]
fn earliest_origination_date_sql_is_registry_scoped() {
    assert_registry_scoped(EARLIEST_ORIGINATION_DATE_FOR_REGISTRY_SQL, 2);
}

#[test]
fn loan_snapshot_as_of_sql_is_registry_scoped() {
    assert_registry_scoped(LOAN_SNAPSHOT_AS_OF_SQL, 5);
}

#[test]
fn latest_status_by_loans_sql_is_registry_scoped() {
    assert_registry_scoped(LATEST_STATUS_BY_LOANS_SQL, 4);
}

#[test]
fn latest_watchlist_entry_sql_is_registry_scoped() {
    assert_registry_scoped(LATEST_WATCHLIST_ENTRY_SQL, 3);
}

#[test]
fn loan_economics_events_sql_is_registry_scoped() {
    assert_registry_scoped(LOAN_ECONOMICS_EVENTS_SQL, 4);
}

#[test]
fn list_repayment_mints_sql_requires_registry_scoped_payment_recorded() {
    let sql = normalized(LIST_REPAYMENT_MINTS_SQL);
    assert!(
        sql.contains("JOIN LATERAL ( SELECT (p.params->'event'->>'mgmt_fee')"),
        "PaymentRecorded match must be an inner join: {sql}"
    );
    assert!(
        !sql.contains("LEFT JOIN LATERAL ( SELECT (p.params"),
        "PaymentRecorded match must not be optional: {sql}"
    );
    assert!(
        sql.contains("AND p.contract_address = $4 AND p.tx_hash = r.tx_hash AND p.event_name = 'PaymentRecorded'"),
        "expected p.contract_address = $4 on PaymentRecorded: {sql}"
    );
    assert!(sql.contains("WHERE r.chain_id = $1"), "{sql}");
    assert!(
        sql.contains("AND d.contract_address = $4 AND d.event_name = 'LoanDefaulted'"),
        "{sql}"
    );
    assert!(
        sql.contains("(d.block_number, d.log_index) < (r.block_number, r.log_index)"),
        "{sql}"
    );
}

#[test]
fn legacy_yield_minted_sql_requires_registry_scoped_payment_recorded() {
    let sql = normalized(LEGACY_YIELD_MINTED_SQL);
    assert!(
        sql.contains("AND EXISTS ( SELECT 1 FROM contract_logs p"),
        "{sql}"
    );
    assert!(sql.contains("AND p.contract_address = $3"), "{sql}");
    assert!(sql.contains("p.event_name = 'PaymentRecorded'"), "{sql}");
    assert!(
        sql.contains("(p.params->>'loan_id')::numeric = o.loan_id"),
        "{sql}"
    );
    assert!(
        sql.contains("(p.params->'event'->>'repayment_id')::numeric = o.repayment_id"),
        "{sql}"
    );
}

#[test]
fn legacy_yield_minted_sql_reads_confirmed_outbox_rows_for_any_chain_kind() {
    let sql = normalized(LEGACY_YIELD_MINTED_SQL);
    for needle in [
        "FROM yield_mint_outbox o",
        "o.chain_id = $1",
        "o.loan_id = $2",
        "o.status = 'confirmed'",
        "o.tx_hash IS NOT NULL",
        "cl.event_name = 'YieldMinted'",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
    assert!(!sql.contains("yield_minter_address"), "{sql}");
}

#[test]
fn list_withdrawal_queue_rows_sql_matches_claims_on_the_same_chain_and_contract() {
    let sql = normalized(LIST_WITHDRAWAL_QUEUE_ROWS_SQL);
    assert!(sql.starts_with("SELECT r.chain_id,"), "{sql}");
    assert!(
        sql.contains("WHERE c.chain_id = r.chain_id AND c.contract_address = r.contract_address AND c.event_name = 'RequestClaimed'"),
        "{sql}"
    );
    assert!(sql.contains("WHERE r.chain_id = $1"), "{sql}");
}

#[test]
fn withdrawal_rate_sets_sql_is_chain_scoped_valid_and_ordered() {
    let sql = normalized(LIST_WITHDRAWAL_RATE_SETS_SQL);
    assert!(sql.contains("WHERE chain_id = $1"), "{sql}");
    assert!(
        sql.contains("AND event_name = 'WithdrawalRateSet'"),
        "{sql}"
    );
    assert!(sql.contains("AND params ? 'new_rate'"), "{sql}");
    assert!(sql.contains("AND block_timestamp <= $2"), "{sql}");
    assert!(sql.ends_with("ORDER BY block_number, log_index"), "{sql}");
}

#[test]
fn withdrawal_queue_totals_sql_is_scoped_to_one_contract() {
    let sql = normalized(WITHDRAWAL_QUEUE_TOTALS_SQL);
    assert_eq!(
        sql.matches("chain_id = $1 AND contract_address = $3")
            .count(),
        2,
        "{sql}"
    );
    assert_eq!(sql.matches("block_timestamp <= $2").count(), 2, "{sql}");
    assert!(sql.contains("MAX((params->>'queued')::numeric)"), "{sql}");
    assert!(sql.contains("event_name = 'WithdrawalRequested'"), "{sql}");
    assert!(sql.contains("SUM((params->>'amount')::numeric)"), "{sql}");
    assert!(sql.contains("event_name = 'RequestClaimed'"), "{sql}");
}

#[test]
fn withdrawal_queue_rows_sql_has_no_rate_lateral_and_selects_the_contract() {
    let sql = normalized(LIST_WITHDRAWAL_QUEUE_ROWS_SQL);
    assert!(!sql.contains("WithdrawalRateSet"), "{sql}");
    assert!(
        sql.contains("r.contract_address FROM contract_logs r"),
        "{sql}"
    );
    assert!(sql.contains("c.chain_id = r.chain_id AND c.contract_address = r.contract_address AND c.event_name = 'RequestClaimed'"), "{sql}");
}

#[test]
fn minter_event_names_are_exactly_the_fourteen_cash_book_events() {
    assert_eq!(
        MINTER_CASH_BOOK_EVENT_NAMES,
        [
            "WireIn",
            "WireInAssigned",
            "WireInReturned",
            "CashDisbursed",
            "CashDisbursementReversed",
            "CashRepaid",
            "CashRepaymentReversed",
            "WireOutRequested",
            "WireOutSettled",
            "WireOutCancelled",
            "RampOpened",
            "RampClosed",
            "CashRecorded",
            "MinterSnapshot",
        ]
    );
}

#[test]
fn minter_events_sql_scopes_by_chain_and_contract_and_orders_by_position() {
    let sql = normalized(MINTER_EVENTS_SQL);
    for needle in [
        "WHERE chain_id = $1",
        "AND contract_address = $2",
        "AND event_name = ANY($3)",
        "ORDER BY block_number, log_index",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
}

#[test]
fn lp_wire_out_events_sql_scopes_by_chain_contract_and_canonical_lp_with_gin_containment() {
    let sql = normalized(LP_WIRE_OUT_EVENTS_SQL);
    for needle in [
        "WHERE c.chain_id = $1",
        "AND c.contract_address = $2",
        "c.event_name = 'WireOutRequested' AND c.params @> jsonb_build_object('lp', $3::text)",
        "c.event_name IN ('WireOutSettled', 'WireOutCancelled')",
        "r.params @> jsonb_build_object('lp', $3::text)",
        "c.params @> jsonb_build_object('id', r.params->>'id')",
        "ORDER BY c.block_number, c.log_index",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
    assert!(!sql.contains("LOWER("), "{sql}");
    assert_eq!(sql.matches("contract_address = $2").count(), 2, "{sql}");
}

#[test]
fn lp_wire_in_events_sql_matches_receiver_and_parent_ids_with_gin_containment() {
    let sql = normalized(LP_WIRE_IN_EVENTS_SQL);
    for needle in [
        "params @> jsonb_build_object('receiver', $3::text)",
        "event_name = 'WireInAssigned'",
        "event_name IN ('WireIn', 'WireInAssigned')",
        "@> ANY(",
        "(id #>> '{}')::bigint",
        "jsonb_build_object('id', id #>> '{}')",
        "ORDER BY block_number, log_index",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
    for forbidden in ["->>'receiver'", "LOWER(", "WireInReturned"] {
        assert!(!sql.contains(forbidden), "`{forbidden}` in {sql}");
    }
    assert_eq!(sql.matches("contract_address = $2").count(), 2, "{sql}");
    assert_eq!(sql.matches("chain_id = $1").count(), 2, "{sql}");
}

#[test]
fn minter_fold_events_sql_bounds_by_the_latest_snapshot_and_keeps_every_ramp_open() {
    let sql = normalized(MINTER_FOLD_EVENTS_SQL);
    for needle in [
        "event_name = 'MinterSnapshot' ORDER BY block_number DESC, log_index DESC LIMIT 1",
        "c.chain_id = $1",
        "c.contract_address = $2",
        "c.event_name = ANY($3)",
        "c.event_name = 'RampOpened'",
        "s.b IS NULL",
        "c.block_number > s.b",
        "(c.block_number = s.b AND c.log_index >= s.i)",
        "ORDER BY c.block_number, c.log_index",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in {sql}");
    }
    assert_eq!(sql.matches("contract_address = $2").count(), 2, "{sql}");
}
