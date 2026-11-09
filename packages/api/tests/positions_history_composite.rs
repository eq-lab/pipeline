// spec: docs/product-specs/lp-total-balance.md#behavior
use std::str::FromStr;

use bigdecimal::BigDecimal;
use chrono::{DateTime, TimeZone, Utc};
use pipeline_api::intervals::Interval;
use pipeline_api::routes::common::SeriesStat;
use pipeline_api::routes::pnl::PositionHistoryItem;
use pipeline_api::total_balance::{
    build_composite_history, composite_window_start, fold_steps, parse_bounded_decimal,
    plain_bounded, term_outcome, CompositeInputs, CompositeSeries,
};
use shared::position_repo::{PositionHistoryBucket, SharePriceBucket};

const DAY: i64 = 86_400;

fn ts(secs: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(1_790_000_000 - 1_790_000_000 % DAY + secs, 0)
        .unwrap()
}

fn unix(secs: i64) -> i64 {
    ts(secs).timestamp()
}

fn dec(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

fn pos(secs: i64, shares: &str) -> PositionHistoryBucket {
    pos_dec(secs, dec(shares))
}

fn pos_dec(secs: i64, shares: BigDecimal) -> PositionHistoryBucket {
    PositionHistoryBucket {
        vault_address: "vault".to_owned(),
        bucket: ts(secs),
        shares_balance: shares,
        avg_buy_share_price: dec("1"),
        cumulative_realized_pnl: dec("0"),
    }
}

fn price(secs: i64, p: &str) -> SharePriceBucket {
    SharePriceBucket {
        bucket: ts(secs),
        price: p.to_owned(),
    }
}

fn build(
    positions: &[PositionHistoryBucket],
    prices: &[SharePriceBucket],
    escrow: Option<&[(DateTime<Utc>, i128)]>,
    start: i64,
    now: i64,
) -> CompositeSeries {
    build_composite_history(
        &CompositeInputs {
            positions,
            prices,
            escrow,
            escrow_raw: None,
            plusd: None,
            share_decimals: 6,
            asset_decimals: 6,
        },
        Interval::Daily,
        ts(start),
        ts(now),
    )
}

fn history_of(
    rows: &[PositionHistoryBucket],
    interval: Interval,
    start: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Vec<PositionHistoryItem> {
    build_composite_history(
        &CompositeInputs {
            positions: rows,
            prices: &[],
            escrow: None,
            escrow_raw: None,
            plusd: None,
            share_decimals: 0,
            asset_decimals: 6,
        },
        interval,
        start,
        now,
    )
    .items
}

fn stats_of(
    rows: &[PositionHistoryBucket],
    interval: Interval,
    start: DateTime<Utc>,
    now: DateTime<Utc>,
) -> (SeriesStat, SeriesStat) {
    let c = build_composite_history(
        &CompositeInputs {
            positions: rows,
            prices: &[],
            escrow: None,
            escrow_raw: None,
            plusd: None,
            share_decimals: 0,
            asset_decimals: 6,
        },
        interval,
        start,
        now,
    );
    (c.shares_balance, c.cumulative_realized_pnl)
}

fn col<'a>(
    items: &'a [PositionHistoryItem],
    f: impl Fn(&'a PositionHistoryItem) -> &'a Option<String>,
) -> Vec<Option<&'a str>> {
    items.iter().map(|i| f(i).as_deref()).collect()
}

#[test]
fn splusd_value_is_shares_times_price_rounded_down() {
    let s = build(
        &[pos(0, "1500000")],
        &[price(0, "1.234567")],
        None,
        0,
        2 * DAY,
    );
    assert_eq!(
        col(&s.items, |i| &i.splusd_value),
        [Some("1.851850"), Some("1.851850"), Some("1.851850")]
    );
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        col(&s.items, |i| &i.splusd_value)
    );
}

#[test]
fn a_bucket_without_a_sample_carries_the_previous_price() {
    let s = build(
        &[pos(0, "1000000")],
        &[price(0, "1"), price(2 * DAY, "3")],
        None,
        0,
        3 * DAY,
    );
    assert_eq!(
        col(&s.items, |i| &i.splusd_value),
        [
            Some("1.000000"),
            Some("1.000000"),
            Some("3.000000"),
            Some("3.000000")
        ]
    );
}

#[test]
fn a_seed_price_from_before_the_window_prices_the_first_bucket() {
    let s = build(
        &[pos(0, "2000000")],
        &[price(-5 * DAY, "1.5")],
        None,
        0,
        DAY,
    );
    assert_eq!(
        col(&s.items, |i| &i.splusd_value),
        [Some("3.000000"), Some("3.000000")]
    );
}

#[test]
fn shares_without_any_price_omit_the_value_the_total_and_both_stats() {
    let s = build(&[pos(0, "1000000")], &[], None, 0, DAY);
    assert!(s
        .items
        .iter()
        .all(|i| i.splusd_value.is_none() && i.total_balance.is_none()));
    assert!(s.splusd_value.is_none() && s.total_balance.is_none());
}

#[test]
fn a_price_that_arrives_late_omits_the_stats_but_not_later_values() {
    let s = build(&[pos(0, "1000000")], &[price(DAY, "2")], None, 0, DAY);
    assert_eq!(col(&s.items, |i| &i.splusd_value), [None, Some("2.000000")]);
    assert!(s.splusd_value.is_none() && s.total_balance.is_none());
}

#[test]
fn zero_shares_without_a_price_are_zero() {
    let s = build(&[pos(0, "0")], &[], None, 0, DAY);
    assert_eq!(
        col(&s.items, |i| &i.splusd_value),
        [Some("0.000000"), Some("0.000000")]
    );
    assert!(s.splusd_value.is_some());
}

#[test]
fn an_unparsable_price_counts_as_missing_and_the_previous_one_carries() {
    let s = build(
        &[pos(0, "1000000")],
        &[price(0, "2"), price(DAY, "1e400"), price(2 * DAY, "-1")],
        None,
        0,
        2 * DAY,
    );
    assert_eq!(
        col(&s.items, |i| &i.splusd_value),
        [Some("2.000000"), Some("2.000000"), Some("2.000000")]
    );
}

#[test]
fn negative_scale_share_balances_decode_to_the_right_value() {
    let shares = BigDecimal::new(5.into(), -6);
    let s = build(&[pos_dec(0, shares)], &[price(0, "2")], None, 0, 0);
    assert_eq!(s.items[0].shares_balance, "5000000");
    assert_eq!(s.items[0].splusd_value.as_deref(), Some("10.000000"));
}

#[test]
fn an_absurd_share_scale_is_not_served() {
    let shares = BigDecimal::new(5.into(), -100_000);
    let s = build(&[pos_dec(0, shares)], &[price(0, "2")], None, 0, 0);
    assert_eq!(s.items[0].splusd_value, None);
    assert_eq!(s.items[0].total_balance, None);
}

fn folded(steps: &[(i64, i128)]) -> Vec<(DateTime<Utc>, i128)> {
    fold_steps(steps.to_vec(), Interval::Daily).unwrap()
}

#[test]
fn escrow_is_held_from_request_until_settlement() {
    let escrow = folded(&[(unix(DAY), 1_234_567), (unix(3 * DAY), -1_234_567)]);
    let s = build(&[], &[], Some(&escrow), 0, 4 * DAY);
    assert_eq!(
        col(&s.items, |i| &i.wire_out_escrow),
        [
            Some("0.000000"),
            Some("1.234567"),
            Some("1.234567"),
            Some("0.000000"),
            Some("0.000000")
        ]
    );
}

#[test]
fn a_cancelled_wire_out_releases_the_escrow_like_a_settled_one() {
    let escrow = folded(&[(unix(0), 1_000_000), (unix(DAY), -1_000_000)]);
    let s = build(&[], &[], Some(&escrow), 0, DAY);
    assert_eq!(
        col(&s.items, |i| &i.wire_out_escrow),
        [Some("1.000000"), Some("0.000000")]
    );
}

#[test]
fn overlapping_wire_outs_add_up() {
    let escrow = folded(&[
        (unix(0), 1_000_000),
        (unix(DAY), 500_000),
        (unix(2 * DAY), -1_000_000),
    ]);
    let s = build(&[], &[], Some(&escrow), 0, 2 * DAY);
    assert_eq!(
        col(&s.items, |i| &i.wire_out_escrow),
        [Some("1.000000"), Some("1.500000"), Some("0.500000")]
    );
}

#[test]
fn several_steps_in_one_bucket_close_at_the_last_running_value() {
    let escrow = folded(&[(unix(10), 100), (unix(20), -100), (unix(30), 7)]);
    assert_eq!(escrow, [(ts(0), 7)]);
}

#[test]
fn no_escrow_input_omits_the_field_and_the_total_equals_splusd() {
    let s = build(&[pos(0, "1000000")], &[price(0, "2")], None, 0, DAY);
    assert!(s.items.iter().all(|i| i.wire_out_escrow.is_none()));
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        col(&s.items, |i| &i.splusd_value)
    );
}

#[test]
fn a_negative_fold_or_an_overflow_is_rejected() {
    assert!(fold_steps(vec![(10, 5), (20, -6)], Interval::Daily).is_none());
    assert!(fold_steps(vec![(10, -1)], Interval::Daily).is_none());
    assert!(fold_steps(vec![(10, i128::MAX), (20, 1)], Interval::Daily).is_none());
}

#[test]
fn a_same_second_request_and_settle_do_not_trip_the_negative_guard() {
    assert!(fold_steps(vec![(10, 5), (10, -5)], Interval::Daily).is_some());
}

#[test]
fn the_total_is_the_sum_of_the_rounded_terms() {
    let escrow = folded(&[(unix(0), 1_234_567)]);
    let s = build(
        &[pos(0, "1500000")],
        &[price(0, "1.234567")],
        Some(&escrow),
        0,
        0,
    );
    let item = &s.items[0];
    assert_eq!(item.splusd_value.as_deref(), Some("1.851850"));
    assert_eq!(item.wire_out_escrow.as_deref(), Some("1.234567"));
    assert_eq!(item.total_balance.as_deref(), Some("3.086417"));
}

#[test]
fn a_wire_out_only_wallet_gets_a_dense_series_from_its_first_request() {
    let escrow = folded(&[(unix(DAY), 1_000_000)]);
    let start = composite_window_start(&[None, Some(unix(DAY))]).unwrap();
    let s = build_composite_history(
        &CompositeInputs {
            positions: &[],
            prices: &[],
            escrow: Some(&escrow),
            escrow_raw: None,
            plusd: None,
            share_decimals: 6,
            asset_decimals: 6,
        },
        Interval::Daily,
        start,
        ts(3 * DAY),
    );
    assert_eq!(s.items.len(), 3);
    assert_eq!(
        s.items[0].timestamp,
        pipeline_api::formatting::iso_utc(&ts(DAY))
    );
    assert!(s.items.iter().all(|i| i.shares_balance == "0"));
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        [Some("1.000000"), Some("1.000000"), Some("1.000000")]
    );
}

#[test]
fn the_window_starts_at_the_earliest_of_position_and_escrow() {
    assert_eq!(
        composite_window_start(&[Some(100), Some(50)]),
        DateTime::from_timestamp(50, 0)
    );
    assert_eq!(
        composite_window_start(&[Some(100), Some(500)]),
        DateTime::from_timestamp(100, 0)
    );
    assert_eq!(
        composite_window_start(&[None, Some(7)]),
        DateTime::from_timestamp(7, 0)
    );
    assert_eq!(
        composite_window_start(&[Some(7), None]),
        DateTime::from_timestamp(7, 0)
    );
    assert_eq!(composite_window_start(&[None, None]), None);
}

#[test]
fn empty_inputs_over_an_empty_grid_give_an_empty_history() {
    let s = build(&[], &[], None, 2 * DAY, 0);
    assert!(s.items.is_empty());
    assert!(s.splusd_value.is_none() && s.total_balance.is_none());
}

#[test]
fn stats_match_a_hand_computed_series() {
    let escrow = folded(&[]);
    let now = 2 * DAY + DAY / 2;
    let s = build(
        &[pos(0, "1000000")],
        &[price(0, "1"), price(DAY, "3")],
        Some(&escrow),
        0,
        now,
    );
    for stat in [s.splusd_value.unwrap(), s.total_balance.unwrap()] {
        assert_eq!(stat.max, "3.000000");
        assert_eq!(stat.min, "1.000000");
        assert_eq!(stat.average, "2.200000");
    }
}

#[test]
fn stats_include_escrow_in_the_total_only() {
    let escrow = folded(&[(unix(DAY), 1_000_000)]);
    let s = build(
        &[pos(0, "1000000")],
        &[price(0, "1")],
        Some(&escrow),
        0,
        DAY + DAY / 2,
    );
    let splusd = s.splusd_value.unwrap();
    let total = s.total_balance.unwrap();
    assert_eq!(
        (splusd.max.as_str(), splusd.min.as_str()),
        ("1.000000", "1.000000")
    );
    assert_eq!(
        (total.max.as_str(), total.min.as_str()),
        ("2.000000", "1.000000")
    );
    assert_eq!(total.average, "1.333333");
}

#[test]
fn bounded_decimal_rejects_exponents_long_and_malformed_strings() {
    for bad in ["", "1e400", "1E+6", "1.2.3", &"1".repeat(65)] {
        assert!(parse_bounded_decimal(bad).is_none(), "{bad}");
    }
    assert_eq!(parse_bounded_decimal("1.5"), Some(dec("1.5")));
    assert!(parse_bounded_decimal(&"1".repeat(64)).is_some());
}

#[test]
fn no_served_number_uses_exponent_form() {
    let escrow = folded(&[(unix(0), i128::MAX / 4)]);
    let shares = BigDecimal::new(7.into(), -9);
    let s = build(
        &[pos_dec(0, shares)],
        &[price(0, "0.000001")],
        Some(&escrow),
        0,
        DAY,
    );
    let mut values: Vec<&str> = Vec::new();
    for i in &s.items {
        values.extend([i.shares_balance.as_str(), i.avg_cost_basis.as_str()]);
        values.extend(
            [
                i.splusd_value.as_deref(),
                i.wire_out_escrow.as_deref(),
                i.total_balance.as_deref(),
            ]
            .into_iter()
            .flatten(),
        );
    }
    for stat in [s.splusd_value.as_ref(), s.total_balance.as_ref()]
        .into_iter()
        .flatten()
    {
        values.extend([stat.max.as_str(), stat.min.as_str(), stat.average.as_str()]);
    }
    assert!(!values.is_empty());
    assert!(values.iter().all(|v| !v.contains(['e', 'E'])), "{values:?}");
}

#[test]
fn valid_values_serialise_with_the_same_digits_as_before() {
    let samples = [
        "0",
        "1",
        "123.456",
        "-12.5",
        "1000000000000000000",
        "0.5",
        "42.000",
    ];
    for sample in samples {
        let value = dec(sample);
        assert_eq!(value.to_plain_string(), value.to_string(), "{sample}");
        let rows = [PositionHistoryBucket {
            vault_address: "v".to_owned(),
            bucket: ts(0),
            shares_balance: value.clone(),
            avg_buy_share_price: value.clone(),
            cumulative_realized_pnl: value.clone(),
        }];
        let history = history_of(&rows, Interval::Daily, ts(0), ts(0));
        assert_eq!(history[0].shares_balance, value.to_string(), "{sample}");
        assert_eq!(history[0].avg_cost_basis, value.to_string(), "{sample}");
        assert_eq!(
            history[0].cumulative_realized_pnl,
            value.to_string(),
            "{sample}"
        );
        let (shares, pnl) = stats_of(&rows, Interval::Daily, ts(0), ts(0));
        for stat in [shares, pnl] {
            assert_eq!(stat.max, value.to_string(), "{sample}");
            assert_eq!(stat.min, value.to_string(), "{sample}");
            assert_eq!(stat.average, value.to_string(), "{sample}");
        }
    }
}

#[test]
fn negative_scale_values_lose_the_exponent_form() {
    let value = BigDecimal::new(25.into(), -30);
    let rows = [PositionHistoryBucket {
        vault_address: "v".to_owned(),
        bucket: ts(0),
        shares_balance: value.clone(),
        avg_buy_share_price: value.clone(),
        cumulative_realized_pnl: value,
    }];
    let history = history_of(&rows, Interval::Daily, ts(0), ts(0));
    assert_eq!(history[0].shares_balance, format!("25{}", "0".repeat(30)));
    let (shares, _) = stats_of(&rows, Interval::Daily, ts(0), ts(0));
    assert_eq!(shares.max, format!("25{}", "0".repeat(30)));
}

#[test]
fn history_series_leaves_the_composite_fields_unset() {
    let history = history_of(&[pos(0, "1")], Interval::Daily, ts(0), ts(0));
    assert!(history[0].splusd_value.is_none());
    assert!(history[0].wire_out_escrow.is_none());
    assert!(history[0].total_balance.is_none());
}

#[test]
fn absurd_scale_values_keep_the_previous_output_instead_of_expanding() {
    let huge = BigDecimal::new(1.into(), -100_000);
    assert!(plain_bounded(&huge).len() < 32);
    assert_eq!(plain_bounded(&huge), huge.to_string());
    assert_eq!(plain_bounded(&BigDecimal::new(25.into(), -3)), "25000");
    let rows = [PositionHistoryBucket {
        vault_address: "v".to_owned(),
        bucket: ts(0),
        shares_balance: huge.clone(),
        avg_buy_share_price: huge.clone(),
        cumulative_realized_pnl: huge.clone(),
    }];
    let history = history_of(&rows, Interval::Daily, ts(0), ts(0));
    assert_eq!(history[0].shares_balance, huge.to_string());
    assert_eq!(history[0].avg_cost_basis, huge.to_string());
    assert_eq!(history[0].cumulative_realized_pnl, huge.to_string());
    let (shares, pnl) = stats_of(&rows, Interval::Daily, ts(0), ts(0));
    for stat in [shares, pnl] {
        assert_eq!(stat.max, huge.to_string());
        assert_eq!(stat.min, huge.to_string());
        assert_eq!(stat.average, huge.to_string());
    }
}

#[test]
fn a_failed_wire_out_read_degrades_only_when_the_wallet_has_positions() {
    let failed = || -> anyhow::Result<Option<Vec<(i64, i128)>>> { Err(anyhow::anyhow!("db down")) };
    assert!(term_outcome(true, failed(), "wire_out_escrow")
        .unwrap()
        .is_none());
    assert!(term_outcome(false, failed(), "wire_out_escrow").is_err());
    assert_eq!(
        term_outcome(false, Ok(Some(vec![(1, 2)])), "wire_out_escrow").unwrap(),
        Some(vec![(1, 2)])
    );
    assert!(
        term_outcome::<Vec<(i64, i128)>>(false, Ok(None), "wire_out_escrow")
            .unwrap()
            .is_none()
    );
}

#[test]
fn stats_cover_shares_and_pnl_in_the_same_pass_as_the_items() {
    let s = build(&[pos(0, "1000000")], &[price(0, "1")], None, 0, 2 * DAY);
    assert_eq!(s.shares_balance.max, "1000000");
    assert_eq!(s.cumulative_realized_pnl.max, "0");
    assert_eq!(s.items.len(), 3);
}
