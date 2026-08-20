//! Compute-layer tests for `GET /v1/positions/history`: exercise `group_history_by_vault`
//! directly against repo-shaped rows, no HTTP layer and no database involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named).

use bigdecimal::BigDecimal;
use chrono::{DateTime, TimeZone, Utc};

use pipeline_api::routes::pnl::group_history_by_vault;
use shared::position_repo::PositionHistoryBucket;

fn ts(unix: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(unix, 0)
        .single()
        .expect("valid timestamp")
}

fn bucket(vault: &str, unix: i64, shares: i64, price: &str, pnl: i64) -> PositionHistoryBucket {
    PositionHistoryBucket {
        vault_address: vault.to_owned(),
        bucket: ts(unix),
        shares_balance: BigDecimal::from(shares),
        avg_buy_share_price: price.parse().expect("valid decimal"),
        cumulative_realized_pnl: BigDecimal::from(pnl),
    }
}

const DAY: i64 = 86_400;

#[test]
fn empty_history_yields_no_vaults() {
    // A wallet with no indexed position returns an empty series rather than an
    // error — the handler falls through when `since` resolves to None.
    assert!(group_history_by_vault(vec![]).is_empty());
}

#[test]
fn single_vault_keeps_bucket_order() {
    let rows = vec![
        bucket("CVAULT", DAY, 100, "1.0", 0),
        bucket("CVAULT", 2 * DAY, 60, "1.0", 0),
        bucket("CVAULT", 3 * DAY, 160, "1.2", 5),
    ];

    let out = group_history_by_vault(rows);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].vault_address, "CVAULT");
    assert_eq!(out[0].history.len(), 3);
    assert_eq!(out[0].history[0].shares_balance, "100");
    assert_eq!(out[0].history[1].shares_balance, "60");
    assert_eq!(out[0].history[2].shares_balance, "160");
    assert_eq!(out[0].history[2].avg_cost_basis, "1.2");
    assert_eq!(out[0].history[2].cumulative_realized_pnl, "5");
}

#[test]
fn multiple_vaults_split_into_separate_series() {
    // The repo orders by (vault_address, bucket), so a vault change starts a new
    // group. This is the ordering contract `group_history_by_vault` relies on.
    let rows = vec![
        bucket("CVAULT_A", DAY, 100, "1.0", 0),
        bucket("CVAULT_A", 2 * DAY, 50, "1.0", 3),
        bucket("CVAULT_B", DAY, 700, "2.0", 0),
    ];

    let out = group_history_by_vault(rows);
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].vault_address, "CVAULT_A");
    assert_eq!(out[0].history.len(), 2);
    assert_eq!(out[1].vault_address, "CVAULT_B");
    assert_eq!(out[1].history.len(), 1);
    assert_eq!(out[1].history[0].shares_balance, "700");
}

#[test]
fn repeated_vault_after_a_gap_starts_a_new_group() {
    // Defensive: grouping is a single pass over sorted input, so unsorted input
    // produces separate groups rather than silently merging. Documents the
    // dependency on the repo's ORDER BY instead of hiding it.
    let rows = vec![
        bucket("CVAULT_A", DAY, 10, "1.0", 0),
        bucket("CVAULT_B", DAY, 20, "1.0", 0),
        bucket("CVAULT_A", 2 * DAY, 30, "1.0", 0),
    ];

    let out = group_history_by_vault(rows);
    assert_eq!(out.len(), 3, "unsorted input is not merged");
}

#[test]
fn timestamps_are_iso_utc() {
    // 1970-01-02T00:00:00Z — the shared `iso_utc` formatting used by
    // /stats/prices, so both time-series endpoints agree.
    let out = group_history_by_vault(vec![bucket("CVAULT", DAY, 1, "1.0", 0)]);
    assert_eq!(out[0].history[0].timestamp, "1970-01-02T00:00:00Z");
}

#[test]
fn zero_balance_bucket_is_preserved() {
    // A full exit is a real data point — the closing balance for that bucket is
    // zero and must not be dropped, or a chart would show the position as still
    // open.
    let rows = vec![
        bucket("CVAULT", DAY, 100, "1.0", 0),
        bucket("CVAULT", 2 * DAY, 0, "1.0", 25),
    ];

    let out = group_history_by_vault(rows);
    assert_eq!(out[0].history.len(), 2);
    assert_eq!(out[0].history[1].shares_balance, "0");
    assert_eq!(
        out[0].history[1].cumulative_realized_pnl, "25",
        "realized PnL survives a full exit"
    );
}
