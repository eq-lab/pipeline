// spec: docs/product-specs/yield-apy-semantics.md
use bigdecimal::BigDecimal;
use chrono::{TimeZone, Utc};
use shared::position_repo::{BalanceEventRow, SharePriceSnapshot};
use shared::time_weighted_return::{linear_apy, time_weighted_apy, VaultHolding};

const DAY: i64 = 86_400;
const WEEK_SECS: i64 = 7 * DAY;

fn bd(s: &str) -> BigDecimal {
    s.parse().unwrap()
}

fn price(day: i64, p: &str) -> SharePriceSnapshot {
    price_at_secs(day * DAY, p)
}

fn price_at_secs(secs: i64, p: &str) -> SharePriceSnapshot {
    SharePriceSnapshot {
        price: bd(p),
        block_timestamp: Utc.timestamp_opt(secs, 0).unwrap(),
    }
}

fn bal(day: i64, shares: &str) -> BalanceEventRow {
    BalanceEventRow {
        vault_address: "0xv".to_owned(),
        block_timestamp: day * DAY,
        shares_balance: bd(shares),
    }
}

fn holding(events: Vec<BalanceEventRow>, prices: Vec<SharePriceSnapshot>) -> Vec<VaultHolding> {
    vec![VaultHolding { events, prices }]
}

fn approx(got: Option<f64>, want: f64) {
    let g = got.expect("apy present");
    assert!((g - want).abs() < 1e-9, "got {g}, want {want}");
}

// ── /v1/pnl avg_apy ──────────────────────────────────────────────────────────

#[test]
fn full_year_holder_gets_the_price_return_8_percent_and_0_08_percent() {
    let up8 = holding(
        vec![bal(0, "100")],
        vec![price(0, "1.0"), price(365, "1.08")],
    );
    approx(time_weighted_apy(&up8, 365 * DAY), 0.08);
    let up008 = holding(
        vec![bal(0, "100")],
        vec![price(0, "1.0"), price(365, "1.0008")],
    );
    approx(time_weighted_apy(&up008, 365 * DAY), 0.0008);
}

#[test]
fn buy_timing_does_not_change_the_return_over_the_held_interval() {
    let prices = vec![price(0, "1.00"), price(100, "1.02"), price(365, "1.08")];
    let h = holding(vec![bal(100, "5")], prices);
    let apy = time_weighted_apy(&h, 365 * DAY);
    approx(apy, (1.08_f64 / 1.02).powf(365.0 / 265.0) - 1.0);
}

#[test]
fn time_out_of_the_vault_is_excluded() {
    let prices = vec![
        price(0, "1.00"),
        price(100, "1.04"),
        price(200, "1.04"),
        price(300, "1.04"),
    ];
    let events = vec![bal(0, "10"), bal(100, "0"), bal(200, "10"), bal(300, "0")];
    let apy = time_weighted_apy(&holding(events, prices), 365 * DAY);
    let expected = 1.04_f64.powf(365.0 / 200.0) - 1.0;
    approx(apy, expected);
}

#[test]
fn partial_changes_while_held_do_not_split_the_return() {
    let prices = vec![price(0, "1.0"), price(30, "1.1")];
    let events = vec![bal(0, "10"), bal(15, "25")];
    let apy = time_weighted_apy(&holding(events, prices), 30 * DAY);
    approx(apy, 1.1_f64.powf(365.0 / 30.0) - 1.0);
}

#[test]
fn under_seven_days_held_is_null() {
    let prices = vec![price(0, "1.0"), price(10, "1.5")];
    let h = holding(vec![bal(1, "10")], prices);
    assert_eq!(time_weighted_apy(&h, DAY + WEEK_SECS - 1), None);
    assert!(time_weighted_apy(&h, DAY + WEEK_SECS).is_some());
}

#[test]
fn holding_that_starts_before_the_first_sample_is_clipped_to_it() {
    let prices = vec![price(10, "1.0"), price(40, "1.1")];
    let h = holding(vec![bal(0, "10")], prices);
    approx(
        time_weighted_apy(&h, 40 * DAY),
        1.1_f64.powf(365.0 / 30.0) - 1.0,
    );
}

#[test]
fn interval_wholly_before_the_first_sample_is_ignored() {
    let prices = vec![price(20, "1.0"), price(50, "1.1")];
    let events = vec![bal(0, "10"), bal(10, "0"), bal(20, "10")];
    let h = holding(events, prices);
    approx(
        time_weighted_apy(&h, 50 * DAY),
        1.1_f64.powf(365.0 / 30.0) - 1.0,
    );
}

#[test]
fn only_clipped_time_below_the_minimum_is_null() {
    let prices = vec![price(10, "1.0"), price(40, "1.1")];
    let h = holding(vec![bal(0, "10")], prices);
    assert_eq!(time_weighted_apy(&h, 10 * DAY + WEEK_SECS - 1), None);
    let before_all = holding(vec![bal(0, "10"), bal(5, "0")], vec![price(10, "1.0")]);
    assert_eq!(time_weighted_apy(&before_all, 50 * DAY), None);
}

#[test]
fn no_history_is_null() {
    assert_eq!(time_weighted_apy(&[], 100 * DAY), None);
    assert_eq!(time_weighted_apy(&holding(vec![], vec![]), 100 * DAY), None);
}

// ── /v1/stats apy ────────────────────────────────────────────────────────────

#[test]
fn short_span_bump_is_null_not_a_huge_annualised_figure() {
    let span = DAY + DAY / 2;
    assert_eq!(linear_apy(&bd("1.003"), &bd("1.0"), span, WEEK_SECS), None);
}

#[test]
fn seven_day_span_is_linear_not_compounded() {
    let apy = linear_apy(&bd("1.001"), &bd("1.0"), WEEK_SECS, WEEK_SECS);
    approx(apy, 0.001 * 365.0 / 7.0);
}

#[test]
fn thirty_day_span_uses_simple_interest() {
    let apy = linear_apy(&bd("1.01"), &bd("1.0"), 30 * DAY, WEEK_SECS);
    approx(apy, 0.01 * 365.0 / 30.0);
}

#[test]
fn non_positive_prices_are_null() {
    assert_eq!(linear_apy(&bd("1.0"), &bd("0"), 30 * DAY, WEEK_SECS), None);
    assert_eq!(linear_apy(&bd("0"), &bd("1.0"), 30 * DAY, WEEK_SECS), None);
}
