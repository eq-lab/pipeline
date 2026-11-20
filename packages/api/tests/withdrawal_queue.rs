//! Compute-layer tests for the withdrawal-queue API: exercise
//! `compute_withdrawal_queue` directly against fixture rows, no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`). Pure unit tests
//! — no `DATABASE_URL` / `POSTGRES_URL`, no Postgres connection.

use bigdecimal::BigDecimal;

use pipeline_api::config::ConfiguredChain;
use pipeline_api::routes::common::ChainScope;
use pipeline_api::routes::withdrawal_queue::{
    compute_withdrawal_queue, queue_state_chain, QueueState,
};
use shared::chains::ChainKind;
use shared::contract_logs_repo::WithdrawalQueueRow;

/// Base-6 amount helper: whole USDC → micro-USDC BigDecimal.
fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

/// A queued (unclaimed) request.
fn queued(request_id: &str, account: &str, amount: i64, requested_at: i64) -> WithdrawalQueueRow {
    WithdrawalQueueRow {
        chain_id: 1,
        request_id: request_id.to_owned(),
        withdrawer: account.to_owned(),
        amount: usdc(amount),
        requested_at,
        claimed_at: None,
        contract_address: "C".to_owned(),
        value: usdc(amount),
    }
}

/// A completed (claimed) request.
fn completed(
    request_id: &str,
    account: &str,
    amount: i64,
    requested_at: i64,
    claimed_at: i64,
) -> WithdrawalQueueRow {
    WithdrawalQueueRow {
        chain_id: 1,
        request_id: request_id.to_owned(),
        withdrawer: account.to_owned(),
        amount: usdc(amount),
        requested_at,
        claimed_at: Some(claimed_at),
        contract_address: "C".to_owned(),
        value: usdc(amount),
    }
}

#[test]
fn empty_input_is_all_zero() {
    let resp = compute_withdrawal_queue(&[], None);
    assert_eq!(resp.summary.in_queue_usd, "0.000000");
    assert_eq!(resp.summary.requests_count, 0);
    assert_eq!(resp.summary.estimated_wait_days, None);
    assert_eq!(resp.summary.liquid_cover, None);
    assert!(resp.items.is_empty());
}

#[test]
fn all_completed_reports_zero_in_queue() {
    // Mirrors the real Stellar data: every request already claimed → nothing queued,
    // but a non-null (near-zero) estimated wait because completions exist.
    let rows = vec![
        completed("0", "0xaaa", 100, 0, 100),
        completed("1", "0xbbb", 200, 50, 155),
    ];
    let resp = compute_withdrawal_queue(&rows, None);
    assert_eq!(resp.summary.in_queue_usd, "0.000000");
    assert_eq!(resp.summary.requests_count, 0);
    assert!(resp.summary.estimated_wait_days.is_some());
    assert!(resp.items.iter().all(|i| i.status == "Completed"));
}

#[test]
fn in_queue_sums_amount_of_unclaimed_only() {
    let rows = vec![
        queued("1", "0xaaa", 100, 1_000),
        queued("2", "0xbbb", 40, 1_500),
        // completed: excluded from in-queue depth and count
        completed("3", "0xccc", 100, 500, 2_000),
    ];
    let resp = compute_withdrawal_queue(&rows, None);

    // in_queue = amount(100) + amount(40) = 140 (completed row excluded)
    assert_eq!(resp.summary.in_queue_usd, "140.000000");
    assert_eq!(resp.summary.requests_count, 2);
}

#[test]
fn requests_count_matches_queued_items() {
    let rows = vec![
        queued("1", "0xaaa", 100, 1_000),
        completed("2", "0xbbb", 100, 500, 2_000),
        queued("3", "0xccc", 50, 1_200),
    ];
    let resp = compute_withdrawal_queue(&rows, None);
    let queued_items = resp.items.iter().filter(|i| i.status == "Queued").count();
    assert_eq!(resp.summary.requests_count as usize, queued_items);
    assert_eq!(resp.summary.requests_count, 2);
}

#[test]
fn items_ordered_by_requested_at_desc_with_capitalized_status() {
    let rows = vec![
        queued("10", "0xaaa", 100, 1_000),
        completed("11", "0xbbb", 60, 2_000, 2_500),
        queued("12", "0xccc", 50, 3_000),
    ];
    let resp = compute_withdrawal_queue(&rows, None);

    // newest requested_at first: 3_000, 2_000, 1_000
    assert_eq!(resp.items.len(), 3);
    assert_eq!(resp.items[0].account, "0xccc");
    assert_eq!(resp.items[0].status, "Queued");
    assert_eq!(resp.items[1].account, "0xbbb");
    assert_eq!(resp.items[1].status, "Completed");
    assert_eq!(resp.items[2].account, "0xaaa");
    assert_eq!(resp.items[2].status, "Queued");
    // amount is the request amount, base-6 formatted
    assert_eq!(resp.items[0].amount, "50.000000");
}

#[test]
fn estimated_wait_days_is_mean_over_completed() {
    let rows = vec![
        // waits: 2 days and 4 days → mean 3.0
        completed("1", "0xaaa", 100, 0, 2 * 86_400),
        completed("2", "0xbbb", 100, 0, 4 * 86_400),
        // queued rows do not contribute to the wait estimate
        queued("3", "0xccc", 50, 1_000),
    ];
    let resp = compute_withdrawal_queue(&rows, None);
    assert_eq!(resp.summary.estimated_wait_days, Some("3.0".to_owned()));
}

#[test]
fn estimated_wait_days_none_without_completed() {
    let rows = vec![queued("1", "0xaaa", 100, 1_000)];
    let resp = compute_withdrawal_queue(&rows, None);
    assert_eq!(resp.summary.estimated_wait_days, None);
}

// ── Multi-chain union ────────────────────────────────────────────────────────────

fn on_chain(chain_id: i64, row: WithdrawalQueueRow) -> WithdrawalQueueRow {
    WithdrawalQueueRow { chain_id, ..row }
}

#[test]
fn union_aggregates_both_chains_and_items_carry_chain_id() {
    let rows = vec![
        on_chain(1, queued("1", "GAAA", 100, 1_000)),
        on_chain(2, queued("1", "0xaaa", 40, 2_000)),
        on_chain(2, completed("2", "0xbbb", 10, 0, 2 * 86_400)),
    ];
    let resp = compute_withdrawal_queue(&rows, None);
    assert_eq!(resp.summary.in_queue_usd, "140.000000");
    assert_eq!(resp.summary.requests_count, 2);
    assert_eq!(resp.summary.estimated_wait_days, Some("2.0".to_owned()));
    let ids: Vec<(i64, &str)> = resp
        .items
        .iter()
        .map(|i| (i.chain_id, i.account.as_str()))
        .collect();
    assert_eq!(ids, vec![(2, "0xaaa"), (1, "GAAA"), (2, "0xbbb")]);
}

#[test]
fn equal_timestamps_break_ties_by_chain_then_numeric_request_id() {
    let rows = vec![
        on_chain(2, queued("1", "c2-r1", 10, 5_000)),
        on_chain(1, queued("10", "c1-r10", 10, 5_000)),
        on_chain(1, queued("9", "c1-r9", 10, 5_000)),
    ];
    let resp = compute_withdrawal_queue(&rows, None);
    let accounts: Vec<&str> = resp.items.iter().map(|i| i.account.as_str()).collect();
    assert_eq!(accounts, vec!["c1-r9", "c1-r10", "c2-r1"]);
}

fn golden_rows() -> Vec<WithdrawalQueueRow> {
    vec![
        on_chain(560_048, queued("4", "0xaaa", 100, 4_000)),
        on_chain(560_048, completed("3", "0xbbb", 50, 1_000, 1_000 + 86_400)),
        on_chain(99_000_001, queued("12", "GAAA", 7, 3_000)),
        on_chain(
            99_000_001,
            completed("11", "GBBB", 25, 2_000, 2_000 + 2 * 86_400),
        ),
    ]
}

#[test]
fn golden_mixed_chain_response_is_byte_identical() {
    let resp = compute_withdrawal_queue(&golden_rows(), None);
    let new_keys = r#","total_queued":null,"total_claimed":null,"rate":null"#;
    let json = serde_json::to_string(&resp).unwrap();
    assert_eq!(json.matches(new_keys).count(), 1);
    assert_eq!(
        json.replacen(new_keys, "", 1),
        r#"{"summary":{"in_queue_usd":"107.000000","requests_count":2,"estimated_wait_days":"1.5","liquid_cover":null},"items":[{"chain_id":560048,"account":"0xaaa","amount":"100.000000","status":"Queued"},{"chain_id":99000001,"account":"GAAA","amount":"7.000000","status":"Queued"},{"chain_id":99000001,"account":"GBBB","amount":"25.000000","status":"Completed"},{"chain_id":560048,"account":"0xbbb","amount":"50.000000","status":"Completed"}]}"#
    );
}

fn scaled(mut row: WithdrawalQueueRow, value: i64) -> WithdrawalQueueRow {
    row.value = usdc(value);
    row
}

#[test]
fn in_queue_sums_rate_scaled_values_and_items_stay_raw() {
    let rows = vec![
        scaled(queued("1", "GAAA", 100, 1_000), 85),
        scaled(queued("2", "GBBB", 40, 2_000), 34),
        completed("3", "GCCC", 100, 500, 2_000),
    ];
    let resp = compute_withdrawal_queue(&rows, None);
    assert_eq!(resp.summary.in_queue_usd, "119.000000");
    assert_eq!(resp.summary.requests_count, 2);
    let amounts: Vec<&str> = resp.items.iter().map(|i| i.amount.as_str()).collect();
    assert!(amounts.contains(&"100.000000") && amounts.contains(&"40.000000"));
}

#[test]
fn evm_rows_contribute_one_to_one_next_to_scaled_stellar_rows() {
    let rows = vec![
        on_chain(560_048, queued("1", "0xaaa", 100, 1_000)),
        on_chain(99_000_001, scaled(queued("1", "GAAA", 100, 2_000), 50)),
    ];
    let resp = compute_withdrawal_queue(&rows, None);
    assert_eq!(resp.summary.in_queue_usd, "150.000000");
}

#[test]
fn queue_state_serializes_totals_and_raw_rate() {
    let state = QueueState {
        total_queued: Some(usdc(3187)),
        total_claimed: Some(usdc(2250)),
        rate: BigDecimal::from(850_000),
    };
    let resp = compute_withdrawal_queue(&[], Some(&state));
    assert_eq!(resp.summary.total_queued.as_deref(), Some("3187.000000"));
    assert_eq!(resp.summary.total_claimed.as_deref(), Some("2250.000000"));
    assert_eq!(resp.summary.rate.as_deref(), Some("850000"));
}

#[test]
fn queue_state_without_totals_keeps_rate_and_nulls_totals() {
    let state = QueueState {
        total_queued: None,
        total_claimed: None,
        rate: BigDecimal::from(1_000_000),
    };
    let resp = compute_withdrawal_queue(&[], Some(&state));
    assert_eq!(resp.summary.total_queued, None);
    assert_eq!(resp.summary.total_claimed, None);
    assert_eq!(resp.summary.rate.as_deref(), Some("1000000"));
}

#[test]
fn no_queue_state_serializes_three_nulls() {
    let json = serde_json::to_value(compute_withdrawal_queue(&[], None)).unwrap();
    for key in ["total_queued", "total_claimed", "rate"] {
        assert_eq!(json["summary"][key], serde_json::Value::Null);
    }
}

fn chain(chain_id: i64, kind: ChainKind) -> ConfiguredChain {
    ConfiguredChain { chain_id, kind }
}

#[test]
fn queue_state_chain_only_for_an_explicit_stellar_chain() {
    let stellar = chain(99_000_001, ChainKind::Stellar);
    let evm = chain(560_048, ChainKind::Evm);
    assert_eq!(queue_state_chain(&ChainScope::One(stellar)), Some(stellar));
    assert_eq!(queue_state_chain(&ChainScope::One(evm)), None);
    assert_eq!(queue_state_chain(&ChainScope::All), None);
    assert_eq!(queue_state_chain(&ChainScope::Unconfigured(7)), None);
}
