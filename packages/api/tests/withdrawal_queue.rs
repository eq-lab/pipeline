//! Compute-layer tests for the withdrawal-queue API: exercise
//! `compute_withdrawal_queue` directly against fixture rows, no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`). Pure unit tests
//! — no `DATABASE_URL` / `POSTGRES_URL`, no Postgres connection.

use bigdecimal::BigDecimal;

use pipeline_api::routes::withdrawal_queue::compute_withdrawal_queue;
use shared::contract_logs_repo::WithdrawalQueueRow;

/// Base-6 amount helper: whole USDC → micro-USDC BigDecimal.
fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

/// A queued (unclaimed) request.
fn queued(request_id: &str, account: &str, amount: i64, requested_at: i64) -> WithdrawalQueueRow {
    WithdrawalQueueRow {
        request_id: request_id.to_owned(),
        withdrawer: account.to_owned(),
        amount: usdc(amount),
        requested_at,
        claimed_at: None,
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
        request_id: request_id.to_owned(),
        withdrawer: account.to_owned(),
        amount: usdc(amount),
        requested_at,
        claimed_at: Some(claimed_at),
    }
}

#[test]
fn empty_input_is_all_zero() {
    let resp = compute_withdrawal_queue(&[]);
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
    let resp = compute_withdrawal_queue(&rows);
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
    let resp = compute_withdrawal_queue(&rows);

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
    let resp = compute_withdrawal_queue(&rows);
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
    let resp = compute_withdrawal_queue(&rows);

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
    let resp = compute_withdrawal_queue(&rows);
    assert_eq!(resp.summary.estimated_wait_days, Some("3.0".to_owned()));
}

#[test]
fn estimated_wait_days_none_without_completed() {
    let rows = vec![queued("1", "0xaaa", 100, 1_000)];
    let resp = compute_withdrawal_queue(&rows);
    assert_eq!(resp.summary.estimated_wait_days, None);
}
