//! Compute-layer tests for `GET /v1/positions/history`: exercise
//! `build_history_series` directly against repo-shaped rows, no HTTP layer and no
//! database involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named).

use bigdecimal::BigDecimal;
use chrono::{DateTime, TimeZone, Utc};

use pipeline_api::routes::pnl::build_history_series;
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
fn empty_history_yields_no_vault_and_no_items() {
    // A wallet with no indexed position returns an empty series rather than an
    // error — the handler falls through when `since` resolves to None. There is
    // no vault to name in that case, so the field is omitted from the JSON.
    let (vault, history) = build_history_series(vec![]);
    assert_eq!(vault, None);
    assert!(history.is_empty());
}

#[test]
fn series_preserves_bucket_order_and_fields() {
    let rows = vec![
        bucket("CVAULT", DAY, 100, "1.0", 0),
        bucket("CVAULT", 2 * DAY, 60, "1.0", 8),
        bucket("CVAULT", 3 * DAY, 160, "1.2", 8),
    ];

    let (vault, history) = build_history_series(rows);
    assert_eq!(vault, Some("CVAULT".to_owned()));
    assert_eq!(history.len(), 3);
    assert_eq!(history[0].shares_balance, "100");
    assert_eq!(history[1].shares_balance, "60");
    assert_eq!(history[2].shares_balance, "160");
    assert_eq!(history[2].avg_cost_basis, "1.2");
    assert_eq!(history[2].cumulative_realized_pnl, "8");
}

#[test]
fn vault_address_is_reported_once_not_per_item() {
    // The repo scopes to a single vault, so the address belongs on the response
    // rather than repeated on every bucket. Reading it off the first row is
    // sound precisely because of that scoping.
    let rows = vec![
        bucket("CVAULT", DAY, 10, "1.0", 0),
        bucket("CVAULT", 2 * DAY, 20, "1.0", 0),
    ];

    let (vault, history) = build_history_series(rows);
    assert_eq!(vault, Some("CVAULT".to_owned()));
    assert_eq!(history.len(), 2);
}

#[test]
fn timestamps_are_iso_utc() {
    // 1970-01-02T00:00:00Z — the shared `iso_utc` formatting used by
    // /stats/prices, so both time-series endpoints agree.
    let (_, history) = build_history_series(vec![bucket("CVAULT", DAY, 1, "1.0", 0)]);
    assert_eq!(history[0].timestamp, "1970-01-02T00:00:00Z");
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

    let (_, history) = build_history_series(rows);
    assert_eq!(history.len(), 2);
    assert_eq!(history[1].shares_balance, "0");
    assert_eq!(
        history[1].cumulative_realized_pnl, "25",
        "realized PnL survives a full exit"
    );
}

#[test]
fn fractional_values_are_not_rounded() {
    // 7-decimal SAC scale must survive the BigDecimal → String conversion; the
    // API contract is decimal strings, never floats.
    let rows = vec![bucket("CVAULT", DAY, 12_500_000, "1.0833333", 0)];

    let (_, history) = build_history_series(rows);
    assert_eq!(history[0].shares_balance, "12500000");
    assert_eq!(history[0].avg_cost_basis, "1.0833333");
}
