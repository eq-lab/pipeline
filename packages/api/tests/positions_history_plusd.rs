// spec: docs/product-specs/lp-total-balance.md#behavior
use std::cell::RefCell;
use std::io;
use std::str::FromStr;
use std::sync::Once;

use bigdecimal::BigDecimal;
use chrono::{DateTime, TimeZone, Utc};
use pipeline_api::intervals::Interval;
use pipeline_api::minter_cash_book::{build_wire_outs, wire_out_escrow_steps, wire_out_raw_steps};
use pipeline_api::routes::pnl::PositionHistoryItem;
use pipeline_api::total_balance::{
    build_composite_history, composite_window_start, fold_steps, fold_term, plusd_holder_key,
    plusd_steps, term_outcome, term_outcomes, CompositeInputs, CompositeSeries, PlusdTerm,
    WireTerm,
};
use shared::chains::ChainKind;
use shared::contract_logs_repo::{MinterEventRow, PlusdStepRow};
use shared::position_repo::{PositionHistoryBucket, SharePriceBucket};

const DAY: i64 = 86_400;
const E7: i128 = 10_000_000;

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

fn step_row(at: i64, amount: Option<&str>, incoming: bool, outgoing: bool) -> PlusdStepRow {
    PlusdStepRow {
        block_number: at,
        block_timestamp: at,
        amount: amount.map(str::to_owned),
        incoming,
        outgoing,
    }
}

fn plain_term(folded: Vec<(DateTime<Utc>, i128)>) -> PlusdTerm {
    PlusdTerm {
        folded,
        from: None,
        blank_total_before: false,
    }
}

fn folded(steps: &[(i64, i128)]) -> Vec<(DateTime<Utc>, i128)> {
    fold_steps(steps.to_vec(), Interval::Daily).unwrap()
}

fn build(
    positions: &[PositionHistoryBucket],
    prices: &[SharePriceBucket],
    escrow: Option<&[(DateTime<Utc>, i128)]>,
    plusd: Option<&[(DateTime<Utc>, i128)]>,
    asset_decimals: u32,
    start: i64,
    now: i64,
) -> CompositeSeries {
    build_composite_history(
        &CompositeInputs {
            positions,
            prices,
            escrow,
            escrow_raw: None,
            plusd,
            plusd_from: None,
            blank_total_before: false,
            share_decimals: 6,
            asset_decimals,
        },
        Interval::Daily,
        ts(start),
        ts(now),
    )
}

fn col<'a>(
    items: &'a [PositionHistoryItem],
    f: impl Fn(&'a PositionHistoryItem) -> &'a Option<String>,
) -> Vec<Option<&'a str>> {
    items.iter().map(|i| f(i).as_deref()).collect()
}

#[test]
fn steps_net_incoming_and_outgoing_per_row() {
    let rows = [
        step_row(10, Some("500"), true, false),
        step_row(20, Some("200"), false, true),
        step_row(30, Some("70"), true, true),
        step_row(40, Some("9"), true, false),
    ];
    assert_eq!(
        plusd_steps(&rows),
        Some(vec![(10, 500), (20, -200), (30, 0), (40, 9)])
    );
}

#[test]
fn a_missing_or_oversized_amount_rejects_every_step() {
    let ok = step_row(1, Some("5"), true, false);
    assert!(plusd_steps(&[ok.clone(), step_row(2, None, true, false)]).is_none());
    let huge = "9".repeat(39);
    assert!(plusd_steps(&[ok.clone(), step_row(2, Some(&huge), true, false)]).is_none());
    let max = i128::MAX.to_string();
    assert_eq!(
        plusd_steps(&[step_row(2, Some(&max), true, false)]),
        Some(vec![(2, i128::MAX)])
    );
    assert!(plusd_steps(&[step_row(2, Some("not a number"), true, false)]).is_none());
}

#[test]
fn an_empty_row_set_is_an_empty_step_list() {
    assert_eq!(plusd_steps(&[]), Some(Vec::new()));
}

#[test]
fn fold_rejects_a_negative_running_value_or_an_overflow() {
    assert!(fold_steps(vec![(10, 5), (20, -6)], Interval::Daily).is_none());
    assert!(fold_steps(vec![(10, i128::MAX), (20, 1)], Interval::Daily).is_none());
}

#[test]
fn a_debit_before_the_credit_in_one_bucket_is_rejected() {
    assert!(fold_steps(vec![(10, -5), (20, 5)], Interval::Daily).is_none());
    assert!(fold_steps(vec![(10, 5), (20, -5)], Interval::Daily).is_some());
}

#[test]
fn holder_key_is_eip55_on_evm_and_uppercase_on_stellar() {
    let lower = "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359";
    assert_eq!(
        plusd_holder_key(ChainKind::Evm, lower).as_deref(),
        Some("0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359")
    );
    assert!(plusd_holder_key(ChainKind::Evm, "garbage").is_none());
    assert_eq!(
        plusd_holder_key(ChainKind::Stellar, "ga3d5kry").as_deref(),
        Some("GA3D5KRY")
    );
}

#[test]
fn the_flow_scenario_matches_the_hand_fold_and_the_total_is_continuous() {
    let plusd = folded(&[
        (unix(0), 1000 * E7),
        (unix(DAY), -600 * E7),
        (unix(2 * DAY), -100 * E7),
        (unix(3 * DAY), 100 * E7),
        (unix(4 * DAY), -50 * E7),
        (unix(5 * DAY), 25 * E7),
        (unix(6 * DAY), 200 * E7),
    ]);
    let escrow = folded(&[(unix(2 * DAY), 100_000_000), (unix(3 * DAY), -100_000_000)]);
    let positions = [pos_dec(DAY, dec("600000000"))];
    let s = build(
        &positions,
        &[price(0, "1")],
        Some(&escrow),
        Some(&plusd),
        7,
        0,
        6 * DAY,
    );
    assert_eq!(
        col(&s.items, |i| &i.plusd_balance),
        [
            Some("1000.000000"),
            Some("400.000000"),
            Some("300.000000"),
            Some("400.000000"),
            Some("350.000000"),
            Some("375.000000"),
            Some("575.000000"),
        ]
    );
    assert_eq!(
        col(&s.items, |i| &i.wire_out_escrow),
        [
            Some("0.000000"),
            Some("0.000000"),
            Some("100.000000"),
            Some("0.000000"),
            Some("0.000000"),
            Some("0.000000"),
            Some("0.000000"),
        ]
    );
    for item in &s.items {
        let sum = dec(item.splusd_value.as_deref().unwrap())
            + dec(item.wire_out_escrow.as_deref().unwrap())
            + dec(item.plusd_balance.as_deref().unwrap());
        assert_eq!(
            item.total_balance.as_deref(),
            Some(sum.to_string().as_str())
        );
    }
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        [
            Some("1000.000000"),
            Some("1000.000000"),
            Some("1000.000000"),
            Some("1000.000000"),
            Some("950.000000"),
            Some("975.000000"),
            Some("1175.000000"),
        ]
    );
}

#[test]
fn the_balance_rounds_down_to_six_places_for_six_and_seven_decimals() {
    let six = folded(&[(unix(0), 1_234_567)]);
    let s = build(&[], &[], None, Some(&six), 6, 0, 0);
    assert_eq!(s.items[0].plusd_balance.as_deref(), Some("1.234567"));
    let seven = folded(&[(unix(0), 12_345_678)]);
    let s = build(&[], &[], None, Some(&seven), 7, 0, 0);
    assert_eq!(s.items[0].plusd_balance.as_deref(), Some("1.234567"));
    let below = folded(&[(unix(0), 9)]);
    let s = build(&[], &[], None, Some(&below), 7, 0, 0);
    assert_eq!(s.items[0].plusd_balance.as_deref(), Some("0.000000"));
}

#[test]
fn nineteen_decimals_omit_the_field_but_keep_the_rest() {
    let plusd = folded(&[(unix(0), 5)]);
    let positions = [pos_dec(0, dec("1000000"))];
    let s = build(&positions, &[price(0, "2")], None, Some(&plusd), 19, 0, 0);
    assert!(s.items.iter().all(|i| i.plusd_balance.is_none()));
    assert_eq!(s.items[0].total_balance, s.items[0].splusd_value);
}

#[test]
fn the_window_starts_at_the_earliest_of_position_escrow_and_plusd() {
    assert_eq!(
        composite_window_start(&[Some(300), Some(200), Some(100)]),
        DateTime::from_timestamp(100, 0)
    );
    assert_eq!(
        composite_window_start(&[None, None, Some(7)]),
        DateTime::from_timestamp(7, 0)
    );
    assert_eq!(composite_window_start(&[None, None, None]), None);
}

#[test]
fn a_plusd_only_wallet_gets_a_dense_series_from_its_first_movement() {
    let plusd = folded(&[(unix(DAY), 3 * E7)]);
    let start = composite_window_start(&[None, None, Some(unix(DAY))]).unwrap();
    let s = build_composite_history(
        &CompositeInputs {
            positions: &[],
            prices: &[],
            escrow: None,
            escrow_raw: None,
            plusd: Some(&plusd),
            plusd_from: None,
            blank_total_before: false,
            share_decimals: 6,
            asset_decimals: 7,
        },
        Interval::Daily,
        start,
        ts(3 * DAY),
    );
    assert_eq!(s.items.len(), 3);
    assert_eq!(
        col(&s.items, |i| &i.splusd_value),
        [Some("0.000000"), Some("0.000000"), Some("0.000000")]
    );
    assert_eq!(
        col(&s.items, |i| &i.plusd_balance),
        [Some("3.000000"), Some("3.000000"), Some("3.000000")]
    );
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        [Some("3.000000"), Some("3.000000"), Some("3.000000")]
    );
}

#[test]
fn an_empty_plusd_term_with_nothing_else_gives_an_empty_series() {
    let s = build(&[], &[], None, Some(&[]), 7, 0, DAY);
    assert!(s.items.is_empty());
    assert!(s.total_balance.is_none());
}

#[test]
fn without_plusd_the_field_is_absent_and_the_total_is_the_1313_value() {
    let escrow = folded(&[(unix(0), 1_234_567)]);
    let positions = [pos_dec(0, dec("1500000"))];
    let s = build(
        &positions,
        &[price(0, "1.234567")],
        Some(&escrow),
        None,
        7,
        0,
        0,
    );
    let item = &s.items[0];
    assert!(item.plusd_balance.is_none());
    assert_eq!(item.total_balance.as_deref(), Some("3.086417"));
    let json = serde_json::to_string(item).unwrap();
    assert!(!json.contains("plusd_balance"), "{json}");
    assert_eq!(
        json,
        format!(
            "{{\"timestamp\":\"{}\",\"shares_balance\":\"1500000\",\"avg_cost_basis\":\"1\",\"cumulative_realized_pnl\":\"0\",\"splusd_value\":\"1.851850\",\"wire_out_escrow\":\"1.234567\",\"total_balance\":\"3.086417\"}}",
            item.timestamp
        )
    );
}

#[test]
fn the_total_balance_stat_includes_plusd() {
    let plusd = folded(&[(unix(0), 10 * E7), (unix(DAY), -4 * E7)]);
    let positions = [pos_dec(0, dec("2000000"))];
    let s = build(&positions, &[price(0, "1")], None, Some(&plusd), 7, 0, DAY);
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        [Some("12.000000"), Some("8.000000")]
    );
    let stat = s.total_balance.unwrap();
    assert_eq!(stat.max, "12.000000");
    assert_eq!(stat.min, "8.000000");
}

#[test]
fn negative_scale_positions_sum_with_plusd() {
    let positions = [pos_dec(0, BigDecimal::new(3.into(), -6))];
    let plusd = folded(&[(unix(0), 2 * E7)]);
    let s = build(&positions, &[price(0, "1")], None, Some(&plusd), 7, 0, 0);
    assert_eq!(s.items[0].splusd_value.as_deref(), Some("3.000000"));
    assert_eq!(s.items[0].plusd_balance.as_deref(), Some("2.000000"));
    assert_eq!(s.items[0].total_balance.as_deref(), Some("5.000000"));
}

#[test]
fn no_served_number_uses_an_exponent() {
    let plusd = folded(&[(unix(0), i128::MAX / 4)]);
    let s = build(&[], &[], None, Some(&plusd), 18, 0, DAY);
    let mut seen = Vec::new();
    for item in &s.items {
        seen.extend([
            item.plusd_balance.clone().unwrap(),
            item.total_balance.clone().unwrap(),
        ]);
    }
    let stat = s.total_balance.unwrap();
    seen.extend([stat.max, stat.min, stat.average]);
    for n in seen {
        assert!(!n.contains(['e', 'E']), "{n}");
    }
}

#[test]
fn a_failed_plusd_read_degrades_only_when_the_wallet_has_other_data() {
    let failed = || -> anyhow::Result<Option<Vec<(i64, i128)>>> { Err(anyhow::anyhow!("db down")) };
    assert!(term_outcome(true, failed(), "plusd_balance")
        .unwrap()
        .is_none());
    assert!(term_outcome(false, failed(), "plusd_balance").is_err());
    assert_eq!(
        term_outcome(false, Ok(Some(vec![(1, 2)])), "plusd_balance").unwrap(),
        Some(vec![(1, 2)])
    );
}

fn evm_row(name: &str, block: i64, params: serde_json::Value) -> MinterEventRow {
    MinterEventRow {
        event_name: name.to_owned(),
        block_number: block,
        log_index: 0,
        block_timestamp: unix(block * DAY),
        params,
    }
}

fn evm_wire_out_rows(close: Option<&str>) -> Vec<MinterEventRow> {
    let mut rows = vec![evm_row(
        "WireOutRequested",
        1,
        serde_json::json!({"id": "9", "lp": "0xLP", "amount": "100000000"}),
    )];
    if let Some(name) = close {
        rows.push(evm_row(name, 2, serde_json::json!({"id": "9"})));
    }
    rows
}

#[test]
fn evm_wire_outs_are_escrowed_in_raw_six_decimal_units() {
    let pending = build_wire_outs(&evm_wire_out_rows(None));
    assert_eq!(
        wire_out_escrow_steps(&pending, ChainKind::Evm),
        vec![(unix(DAY), 100_000_000)]
    );
    for close in ["WireOutSettled", "WireOutCancelled"] {
        let w = build_wire_outs(&evm_wire_out_rows(Some(close)));
        assert_eq!(
            wire_out_escrow_steps(&w, ChainKind::Evm),
            vec![(unix(DAY), 100_000_000), (unix(2 * DAY), -100_000_000)]
        );
        assert_eq!(
            wire_out_raw_steps(&w),
            vec![(unix(DAY), 100_000_000), (unix(2 * DAY), -100_000_000)]
        );
    }
    let stellar = wire_out_escrow_steps(&pending, ChainKind::Stellar);
    assert_eq!(stellar, vec![(unix(DAY), 10_000_000)]);
}

#[test]
fn the_evm_total_stays_continuous_through_request_settle_and_cancel() {
    let m = 1_000_000;
    for (cancelled, final_total) in [(false, "400.000000"), (true, "500.000000")] {
        let wire_outs = build_wire_outs(&evm_wire_out_rows(Some(if cancelled {
            "WireOutCancelled"
        } else {
            "WireOutSettled"
        })));
        let escrow = folded(&wire_out_escrow_steps(&wire_outs, ChainKind::Evm));
        let raw = folded(&wire_out_raw_steps(&wire_outs));
        let mut steps = vec![(unix(0), 500 * m), (unix(DAY), -100 * m)];
        if cancelled {
            steps.push((unix(2 * DAY), 100 * m));
        }
        let plusd = folded(&steps);
        let s = build_composite_history(
            &CompositeInputs {
                positions: &[],
                prices: &[],
                escrow: Some(&escrow),
                escrow_raw: Some(&raw),
                plusd: Some(&plusd),
                plusd_from: None,
                blank_total_before: false,
                share_decimals: 6,
                asset_decimals: 6,
            },
            Interval::Daily,
            ts(0),
            ts(2 * DAY),
        );
        assert_eq!(
            col(&s.items, |i| &i.total_balance),
            [Some("500.000000"), Some("500.000000"), Some(final_total)]
        );
        assert_eq!(s.items[1].wire_out_escrow.as_deref(), Some("100.000000"));
    }
}

#[test]
fn a_wire_out_request_never_moves_the_total_by_a_rounding_step() {
    let plusd_before = folded(&[(unix(0), 20)]);
    let before = build(&[], &[], None, Some(&plusd_before), 7, 0, 0);
    assert_eq!(before.items[0].total_balance.as_deref(), Some("0.000002"));

    let plusd_after = folded(&[(unix(0), 20), (unix(1), -9)]);
    let escrow = folded(&[(unix(1), 0)]);
    let escrow_raw = folded(&[(unix(1), 9)]);
    let after = build_composite_history(
        &CompositeInputs {
            positions: &[],
            prices: &[],
            escrow: Some(&escrow),
            escrow_raw: Some(&escrow_raw),
            plusd: Some(&plusd_after),
            plusd_from: None,
            blank_total_before: false,
            share_decimals: 6,
            asset_decimals: 7,
        },
        Interval::Daily,
        ts(0),
        ts(0),
    );
    assert_eq!(after.items[0].plusd_balance.as_deref(), Some("0.000001"));
    assert_eq!(after.items[0].wire_out_escrow.as_deref(), Some("0.000000"));
    assert_eq!(after.items[0].total_balance.as_deref(), Some("0.000002"));
}

#[test]
fn a_failed_plusd_fold_does_not_stretch_the_window() {
    let failed = fold_term(vec![(unix(0), -5)], Interval::Daily, 1, "plusd_balance");
    assert!(failed.is_none());
    let first_position = Some(unix(10 * DAY));
    let with_key = composite_window_start(&[
        first_position,
        None,
        failed
            .as_ref()
            .and_then(|f: &Vec<(DateTime<Utc>, i128)>| f.first().map(|s| s.0.timestamp())),
    ]);
    let without_key = composite_window_start(&[first_position, None, None]);
    assert_eq!(with_key, without_key);
}

#[test]
fn a_failing_plusd_fold_is_not_other_data_for_a_failed_wire_out_read() {
    let wire: anyhow::Result<Option<WireTerm>> = Err(anyhow::anyhow!("db down"));
    let plusd =
        Ok(fold_term(vec![(unix(0), -5)], Interval::Daily, 1, "plusd_balance").map(plain_term));
    assert!(term_outcomes(false, wire, plusd).is_err());

    let wire: anyhow::Result<Option<WireTerm>> = Err(anyhow::anyhow!("db down"));
    let sound = Ok(Some(plain_term(folded(&[(unix(0), 5)]))));
    let (wire, plusd) = term_outcomes(false, wire, sound).unwrap();
    assert!(wire.is_none() && plusd.is_some());

    let wire: anyhow::Result<Option<WireTerm>> = Err(anyhow::anyhow!("db down"));
    let (wire, _) = term_outcomes(true, wire, Ok(None)).unwrap();
    assert!(wire.is_none());
}

thread_local! {
    static CAPTURED: RefCell<Option<Vec<u8>>> = const { RefCell::new(None) };
}

struct ThreadCapture;

impl io::Write for ThreadCapture {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        CAPTURED.with(|c| {
            if let Some(out) = c.borrow_mut().as_mut() {
                out.extend_from_slice(buf);
            }
        });
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn dropping_the_plusd_term_for_out_of_range_decimals_logs_a_warning() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let sub = tracing_subscriber::fmt()
            .with_writer(|| ThreadCapture)
            .with_ansi(false)
            .finish();
        tracing::subscriber::set_global_default(sub).unwrap();
        tracing::callsite::rebuild_interest_cache();
    });
    CAPTURED.with(|c| *c.borrow_mut() = Some(Vec::new()));
    let plusd = folded(&[(unix(0), 5)]);
    for decimals in [19, u32::MAX] {
        let s = build(&[], &[], None, Some(&plusd), decimals, 0, 0);
        assert!(s.items.iter().all(|i| i.plusd_balance.is_none()));
    }
    let out = CAPTURED.with(|c| String::from_utf8(c.borrow().clone().unwrap_or_default()).unwrap());
    CAPTURED.with(|c| *c.borrow_mut() = None);
    assert!(out.contains("WARN"), "{out}");
    assert!(out.contains("omitting plusd_balance"), "{out}");
}
