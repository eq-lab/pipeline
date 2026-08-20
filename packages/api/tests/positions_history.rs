//! Compute-layer tests for `GET /v1/positions/history`: exercise
//! `build_history_series` directly against repo-shaped rows, no HTTP layer and no
//! database involved.
//!
//! The endpoint returns a **dense** series — one bucket per interval step across
//! the requested window — because a balance is a step function: between events it
//! is genuinely constant, so carrying the previous closing value forward states
//! what the ledger already entails. Sparse output would distort equidistant
//! charts and label the axis with the wallet's first activity instead of the
//! window start.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named).

use bigdecimal::BigDecimal;
use chrono::{DateTime, TimeZone, Utc};

use pipeline_api::intervals::Interval;
use pipeline_api::routes::pnl::build_history_series;
use shared::position_repo::PositionHistoryBucket;

const DAY: i64 = 86_400;
const HOUR: i64 = 3_600;

fn ts(unix: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(unix, 0)
        .single()
        .expect("valid timestamp")
}

fn bucket(unix: i64, shares: i64, price: &str, pnl: i64) -> PositionHistoryBucket {
    PositionHistoryBucket {
        vault_address: "CVAULT".to_owned(),
        bucket: ts(unix),
        shares_balance: BigDecimal::from(shares),
        avg_buy_share_price: price.parse().expect("valid decimal"),
        cumulative_realized_pnl: BigDecimal::from(pnl),
    }
}

/// `(timestamp, shares_balance)` pairs, the shape most assertions care about.
fn shares_at(items: &[pipeline_api::routes::pnl::PositionHistoryItem]) -> Vec<(&str, &str)> {
    items
        .iter()
        .map(|i| (i.timestamp.as_str(), i.shares_balance.as_str()))
        .collect()
}

// ── Empty ────────────────────────────────────────────────────────────────────

#[test]
fn empty_history_stays_empty_and_names_no_vault() {
    // No indexed position → `history: []` so the frontend can render its
    // not-tracked-yet state. Densifying zeros here would claim a position of
    // zero shares, which is a different statement from "no history".
    let (vault, history) = build_history_series(&[], Interval::Daily, Some(ts(0)), ts(10 * DAY));
    assert_eq!(vault, None);
    assert!(history.is_empty());
}

// ── Gap fill ─────────────────────────────────────────────────────────────────

#[test]
fn quiet_buckets_carry_the_previous_closing_balance() {
    // Events on day 1 and day 5 only. Days 2–4 held the day-1 balance.
    let rows = vec![bucket(DAY, 100, "1.0", 0), bucket(5 * DAY, 60, "1.0", 8)];

    let (_, history) = build_history_series(&rows, Interval::Daily, Some(ts(DAY)), ts(6 * DAY));

    assert_eq!(
        shares_at(&history),
        vec![
            ("1970-01-02T00:00:00Z", "100"),
            ("1970-01-03T00:00:00Z", "100"),
            ("1970-01-04T00:00:00Z", "100"),
            ("1970-01-05T00:00:00Z", "100"),
            ("1970-01-06T00:00:00Z", "60"),
            ("1970-01-07T00:00:00Z", "60"),
        ]
    );
}

#[test]
fn carried_buckets_also_carry_basis_and_cumulative_pnl() {
    // All three value fields carry forward together — a bucket must describe one
    // coherent position, not a mix of current balance and stale basis.
    let rows = vec![bucket(DAY, 60, "1.25", 8)];

    let (_, history) = build_history_series(&rows, Interval::Daily, Some(ts(DAY)), ts(3 * DAY));

    assert_eq!(history.len(), 3);
    for item in &history {
        assert_eq!(item.shares_balance, "60");
        assert_eq!(item.avg_cost_basis, "1.25");
        assert_eq!(item.cumulative_realized_pnl, "8");
    }
}

// ── Leading window ───────────────────────────────────────────────────────────

#[test]
fn buckets_before_the_first_position_are_zero_filled() {
    // The window-start bug from the issue: a wallet whose only activity is
    // recent must still produce a series starting at the window start, or a 1Y
    // axis would be labelled with a date days ago.
    let rows = vec![bucket(8 * DAY, 100, "1.0", 0)];

    let (_, history) = build_history_series(&rows, Interval::Daily, Some(ts(5 * DAY)), ts(9 * DAY));

    assert_eq!(
        shares_at(&history),
        vec![
            ("1970-01-06T00:00:00Z", "0"),
            ("1970-01-07T00:00:00Z", "0"),
            ("1970-01-08T00:00:00Z", "0"),
            ("1970-01-09T00:00:00Z", "100"),
            ("1970-01-10T00:00:00Z", "100"),
        ]
    );
    assert_eq!(history[0].avg_cost_basis, "0");
    assert_eq!(history[0].cumulative_realized_pnl, "0");
}

#[test]
fn series_starts_at_the_window_start_not_the_first_event() {
    // The acceptance criterion, in miniature: a long window over a wallet with
    // one recent stake yields a bucket per step, first at the window start.
    let rows = vec![bucket(97 * DAY, 5, "1.0", 0)];

    let (_, history) = build_history_series(&rows, Interval::Daily, Some(ts(0)), ts(99 * DAY));

    assert_eq!(history.len(), 100, "one bucket per day across the window");
    assert_eq!(history[0].timestamp, "1970-01-01T00:00:00Z");
    assert_eq!(history[0].shares_balance, "0");
    assert_eq!(history[99].shares_balance, "5");
}

// ── Seed bucket (activity entirely before the window) ────────────────────────

#[test]
fn position_predating_the_window_is_carried_not_zeroed() {
    // The repo returns a seed bucket from before `since` precisely for this
    // case. A wallet that staked long ago and did nothing since holds that
    // balance throughout the window — zero-filling it would report an exited
    // position that never exited.
    let rows = vec![bucket(2 * DAY, 250, "1.4", 3)];

    let (_, history) =
        build_history_series(&rows, Interval::Daily, Some(ts(10 * DAY)), ts(12 * DAY));

    assert_eq!(
        shares_at(&history),
        vec![
            ("1970-01-11T00:00:00Z", "250"),
            ("1970-01-12T00:00:00Z", "250"),
            ("1970-01-13T00:00:00Z", "250"),
        ]
    );
    assert_eq!(history[0].avg_cost_basis, "1.4");
    assert_eq!(history[0].cumulative_realized_pnl, "3");
}

// ── Grid alignment ───────────────────────────────────────────────────────────

#[test]
fn grid_is_aligned_to_bucket_boundaries() {
    // A window start mid-day must snap to the day boundary so grid instants
    // coincide with the query's DATE_TRUNCed event buckets.
    let rows = vec![bucket(DAY, 7, "1.0", 0)];
    let mid_day = ts(DAY + 14 * HOUR + 32 * 60);

    let (_, history) = build_history_series(&rows, Interval::Daily, Some(mid_day), ts(2 * DAY));

    assert_eq!(history[0].timestamp, "1970-01-02T00:00:00Z");
    assert_eq!(history.len(), 2);
}

#[test]
fn hourly_buckets_step_by_the_hour() {
    let rows = vec![bucket(HOUR, 3, "1.0", 0)];

    let (_, history) = build_history_series(&rows, Interval::Hourly, Some(ts(0)), ts(3 * HOUR));

    assert_eq!(
        shares_at(&history),
        vec![
            ("1970-01-01T00:00:00Z", "0"),
            ("1970-01-01T01:00:00Z", "3"),
            ("1970-01-01T02:00:00Z", "3"),
            ("1970-01-01T03:00:00Z", "3"),
        ]
    );
}

#[test]
fn weekly_buckets_start_monday_like_postgres() {
    // 1970-01-01 was a Thursday, so its Postgres DATE_TRUNC('week') is Monday
    // 1969-12-29 — three days before the epoch. The Rust grid must agree, or it
    // would not line up with the event buckets the query returns.
    //
    // Note the row's own bucket is the Monday too: repo rows are already
    // DATE_TRUNCed by the query, never raw event timestamps.
    let rows = vec![bucket(-3 * DAY, 9, "1.0", 0)];

    let (_, history) = build_history_series(&rows, Interval::Weekly, Some(ts(0)), ts(9 * DAY));

    assert_eq!(
        shares_at(&history),
        vec![("1969-12-29T00:00:00Z", "9"), ("1970-01-05T00:00:00Z", "9"),],
        "window start snaps back to Monday, and the balance carries into week two"
    );
}

// ── Interval::truncate vs Postgres DATE_TRUNC ────────────────────────────────

#[test]
fn truncate_matches_postgres_date_trunc() {
    // The Rust grid and the query's event buckets must land on identical
    // instants, so `Interval::truncate` has to reproduce Postgres
    // `DATE_TRUNC(…)` evaluated in UTC. Each expectation below was read off a
    // real Postgres 17 session:
    //
    //   DATE_TRUNC('week', TO_TIMESTAMP(0))                    → 1969-12-29
    //   DATE_TRUNC('week', TO_TIMESTAMP(9*86400))              → 1970-01-05
    //   DATE_TRUNC('day',  TO_TIMESTAMP(86400+14*3600+32*60))  → 1970-01-02
    //   DATE_TRUNC('hour', TO_TIMESTAMP(3600+59*60))           → 1970-01-01 01:00
    assert_eq!(Interval::Weekly.truncate(ts(0)), ts(-3 * DAY));
    assert_eq!(Interval::Weekly.truncate(ts(9 * DAY)), ts(4 * DAY));
    assert_eq!(
        Interval::Daily.truncate(ts(DAY + 14 * HOUR + 32 * 60)),
        ts(DAY)
    );
    assert_eq!(Interval::Hourly.truncate(ts(HOUR + 59 * 60)), ts(HOUR));

    // Already-aligned instants are fixed points, so re-truncating a bucket the
    // query already truncated cannot shift it.
    for i in [Interval::Hourly, Interval::Daily, Interval::Weekly] {
        let once = i.truncate(ts(9 * DAY));
        assert_eq!(i.truncate(once), once);
    }
}

// ── Value fidelity ───────────────────────────────────────────────────────────

#[test]
fn vault_address_is_reported_once_for_the_series() {
    let rows = vec![bucket(DAY, 10, "1.0", 0)];
    let (vault, _) = build_history_series(&rows, Interval::Daily, Some(ts(DAY)), ts(DAY));
    assert_eq!(vault, Some("CVAULT".to_owned()));
}

#[test]
fn zero_balance_after_a_full_exit_is_carried_not_treated_as_missing() {
    // A wallet that exited holds zero afterwards, and its realized PnL stands.
    // Carrying the exit forward must not be confused with the leading-zero case.
    let rows = vec![bucket(DAY, 100, "1.0", 0), bucket(2 * DAY, 0, "0", 25)];

    let (_, history) = build_history_series(&rows, Interval::Daily, Some(ts(DAY)), ts(4 * DAY));

    assert_eq!(history.len(), 4);
    assert_eq!(history[0].shares_balance, "100");
    for item in &history[1..] {
        assert_eq!(item.shares_balance, "0");
        assert_eq!(
            item.cumulative_realized_pnl, "25",
            "realized PnL persists after exit"
        );
    }
}

#[test]
fn fractional_values_are_not_rounded() {
    // 7-decimal SAC scale must survive BigDecimal → String; the API contract is
    // decimal strings, never floats.
    let rows = vec![bucket(DAY, 12_500_000, "1.0833333", 0)];

    let (_, history) = build_history_series(&rows, Interval::Daily, Some(ts(DAY)), ts(DAY));

    assert_eq!(history[0].shares_balance, "12500000");
    assert_eq!(history[0].avg_cost_basis, "1.0833333");
}

#[test]
fn multiple_events_in_one_bucket_keep_the_last_and_still_advance() {
    // The query collapses a bucket to its closing value, but a defensive check
    // that the walk consumes every row it passes — otherwise a stale event could
    // leak into a later bucket.
    let rows = vec![
        bucket(DAY, 100, "1.0", 0),
        bucket(DAY, 80, "1.0", 4),
        bucket(3 * DAY, 200, "1.0", 4),
    ];

    let (_, history) = build_history_series(&rows, Interval::Daily, Some(ts(DAY)), ts(3 * DAY));

    assert_eq!(
        shares_at(&history),
        vec![
            ("1970-01-02T00:00:00Z", "80"),
            ("1970-01-03T00:00:00Z", "80"),
            ("1970-01-04T00:00:00Z", "200"),
        ]
    );
}
