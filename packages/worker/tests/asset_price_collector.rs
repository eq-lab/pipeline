//! Unit tests for the asset_price_collector pure grid/retention/missing-point
//! logic — no DB.

use chrono::{TimeZone, Utc};
use pipeline_worker::asset_price_collector::{
    align_down_to_grid, expected_grid, latest_is_live, missing_points, non_market_providers_in_use,
    retention_cutoff, PriceInterval,
};

#[test]
fn align_down_hourly_truncates_to_top_of_hour() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 14, 37, 12).unwrap();
    let aligned = align_down_to_grid(now, PriceInterval::Hourly);
    assert_eq!(
        aligned,
        Utc.with_ymd_and_hms(2026, 6, 30, 14, 0, 0).unwrap()
    );
}

#[test]
fn align_down_hourly_exact_hour_is_unchanged() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 14, 0, 0).unwrap();
    let aligned = align_down_to_grid(now, PriceInterval::Hourly);
    assert_eq!(aligned, now);
}

#[test]
fn align_down_daily_after_noon_is_today_noon() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 15, 0, 0).unwrap();
    let aligned = align_down_to_grid(now, PriceInterval::Daily);
    assert_eq!(
        aligned,
        Utc.with_ymd_and_hms(2026, 6, 30, 12, 0, 0).unwrap()
    );
}

#[test]
fn align_down_daily_before_noon_is_yesterday_noon() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 9, 0, 0).unwrap();
    let aligned = align_down_to_grid(now, PriceInterval::Daily);
    assert_eq!(
        aligned,
        Utc.with_ymd_and_hms(2026, 6, 29, 12, 0, 0).unwrap()
    );
}

#[test]
fn align_down_daily_exactly_noon_is_today_noon() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 12, 0, 0).unwrap();
    let aligned = align_down_to_grid(now, PriceInterval::Daily);
    assert_eq!(aligned, now);
}

#[test]
fn expected_grid_hourly_has_retention_points_spaced_by_one_hour() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 14, 30, 0).unwrap();
    let grid = expected_grid(now, PriceInterval::Hourly, 3);
    assert_eq!(
        grid,
        vec![
            Utc.with_ymd_and_hms(2026, 6, 30, 12, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 6, 30, 13, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 6, 30, 14, 0, 0).unwrap(),
        ]
    );
    // Ascending, last is the latest/current point.
    assert_eq!(
        *grid.last().unwrap(),
        Utc.with_ymd_and_hms(2026, 6, 30, 14, 0, 0).unwrap()
    );
}

#[test]
fn expected_grid_daily_has_retention_points_at_noon() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 15, 0, 0).unwrap();
    let grid = expected_grid(now, PriceInterval::Daily, 4);
    assert_eq!(
        grid,
        vec![
            Utc.with_ymd_and_hms(2026, 6, 27, 12, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 6, 28, 12, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 6, 29, 12, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 6, 30, 12, 0, 0).unwrap(),
        ]
    );
}

#[test]
fn expected_grid_zero_retention_is_empty() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 15, 0, 0).unwrap();
    assert!(expected_grid(now, PriceInterval::Hourly, 0).is_empty());
}

#[test]
fn retention_cutoff_is_oldest_grid_point() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 14, 30, 0).unwrap();
    let cutoff = retention_cutoff(now, PriceInterval::Hourly, 3).unwrap();
    assert_eq!(cutoff, Utc.with_ymd_and_hms(2026, 6, 30, 12, 0, 0).unwrap());
}

#[test]
fn retention_cutoff_none_for_zero_retention() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 14, 30, 0).unwrap();
    assert!(retention_cutoff(now, PriceInterval::Hourly, 0).is_none());
}

#[test]
fn missing_points_returns_only_gaps_in_grid_order() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 14, 30, 0).unwrap();
    let grid = expected_grid(now, PriceInterval::Hourly, 3);
    // Have the middle point only.
    let existing = vec![Utc.with_ymd_and_hms(2026, 6, 30, 13, 0, 0).unwrap()];
    let missing = missing_points(&grid, &existing);
    assert_eq!(
        missing,
        vec![
            Utc.with_ymd_and_hms(2026, 6, 30, 12, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 6, 30, 14, 0, 0).unwrap(),
        ]
    );
}

#[test]
fn missing_points_empty_when_window_fully_populated() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 14, 30, 0).unwrap();
    let grid = expected_grid(now, PriceInterval::Hourly, 3);
    let existing = grid.clone();
    assert!(missing_points(&grid, &existing).is_empty());
}

#[test]
fn missing_points_ignores_existing_outside_grid() {
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 14, 30, 0).unwrap();
    let grid = expected_grid(now, PriceInterval::Hourly, 2);
    // An old (already-pruned-conceptually) point not on the current grid.
    let existing = vec![Utc.with_ymd_and_hms(2026, 6, 30, 9, 0, 0).unwrap()];
    let missing = missing_points(&grid, &existing);
    assert_eq!(missing, grid);
}

#[test]
fn price_interval_parse_accepts_hours_and_days() {
    assert_eq!(
        PriceInterval::parse("HOURS").unwrap(),
        PriceInterval::Hourly
    );
    assert_eq!(PriceInterval::parse("days").unwrap(), PriceInterval::Daily);
    assert!(PriceInterval::parse("WEEKS").is_err());
}

#[test]
fn latest_is_live_true_when_collected_within_window() {
    let latest = Utc.with_ymd_and_hms(2026, 6, 30, 14, 0, 0).unwrap();
    // Seen ~3 minutes after the grid instant — normal live collection.
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 14, 3, 0).unwrap();
    assert!(latest_is_live(now, latest));
}

#[test]
fn latest_is_live_false_when_point_was_missed() {
    // Daily noon point first seen 5h later (worker restart) — must be backfilled
    // historically, not with the (later) current price.
    let latest = Utc.with_ymd_and_hms(2026, 6, 30, 12, 0, 0).unwrap();
    let now = Utc.with_ymd_and_hms(2026, 6, 30, 17, 0, 0).unwrap();
    assert!(!latest_is_live(now, latest));
}

#[test]
fn latest_is_live_boundary_is_two_cycles() {
    let latest = Utc.with_ymd_and_hms(2026, 6, 30, 14, 0, 0).unwrap();
    // Exactly the freshness window (2 × 5-min cycles) still counts as live.
    let at_edge = latest + chrono::Duration::seconds(600);
    assert!(latest_is_live(at_edge, latest));
    // One second past the window is treated as a missed point.
    let past_edge = latest + chrono::Duration::seconds(601);
    assert!(!latest_is_live(past_edge, latest));
}

// ── non_market_providers_in_use (#1023 guard) ───────────────────────────────────

#[test]
fn non_market_providers_in_use_empty_when_all_market() {
    let providers = vec!["metal_price".to_owned()];
    assert!(non_market_providers_in_use(&providers, false).is_empty());
}

#[test]
fn non_market_providers_in_use_flags_static_without_escape_hatch() {
    let providers = vec!["static".to_owned()];
    assert_eq!(
        non_market_providers_in_use(&providers, false),
        vec!["static".to_owned()]
    );
}

#[test]
fn non_market_providers_in_use_empty_when_escape_hatch_allows() {
    let providers = vec!["static".to_owned()];
    assert!(non_market_providers_in_use(&providers, true).is_empty());
}

#[test]
fn non_market_providers_in_use_filters_mixed_list() {
    let providers = vec!["metal_price".to_owned(), "static".to_owned()];
    assert_eq!(
        non_market_providers_in_use(&providers, false),
        vec!["static".to_owned()]
    );
}
