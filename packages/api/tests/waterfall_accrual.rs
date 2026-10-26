// spec: docs/product-specs/yield.md#waterfall-components
use bigdecimal::BigDecimal;

use pipeline_api::routes::waterfall::{compute_waterfall, PricingBasis, WaterfallBreakdown};
use shared::contract_logs_repo::LoanRateEventRow;
use shared::loan_fee_schedule_repo::FeeScheduleRow;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};

fn dec(s: &str) -> BigDecimal {
    s.parse().unwrap()
}

const ORIGINATION: i64 = 1_700_000_000;
const DAY: i64 = 86_400;
const CONTRACT_YEAR: i64 = 31_557_600;
const ONE_YEAR_LATER: i64 = ORIGINATION + CONTRACT_YEAR;
const HUGE_AMOUNT: &str = "100000000000000000";

fn snapshot(senior_tranche: &str, senior_repaid: &str, rate_bps: u32) -> LoanSnapshot {
    snapshot_with_repayment(
        senior_tranche,
        RepaymentSnapshot {
            offtaker_received: dec("0"),
            senior_principal_repaid: dec(senior_repaid),
            senior_interest: dec("0"),
            equity_distributed: dec("0"),
            mgmt_fee: dec("0"),
            perf_fee: dec("0"),
            oet_alloc: dec("0"),
        },
        rate_bps,
    )
}
fn snapshot_with_repayment(
    senior_tranche: &str,
    repayment: RepaymentSnapshot,
    rate_bps: u32,
) -> LoanSnapshot {
    LoanSnapshot {
        originator: "0xorig".to_owned(),
        borrower_id: "borrower".to_owned(),
        commodity: "Coffee".to_owned(),
        corridor: "BR-EU".to_owned(),
        governing_law: "English".to_owned(),
        protection: String::new(),
        metadata_uri: None,
        documents: vec![],
        original_facility_size: dec(senior_tranche),
        original_senior_tranche: dec(senior_tranche),
        original_equity_tranche: dec("0"),
        original_offtaker_price: dec("100000000000000000"),
        senior_interest_rate_bps: rate_bps,
        origination_date: ORIGINATION,
        original_maturity_date: ONE_YEAR_LATER,
        next_economics_epochs_id: dec("1"),
        next_repayment_id: dec("1"),
        status: "Performing".to_owned(),
        current_maturity_timestamp: ONE_YEAR_LATER,
        current_rate: rate_bps,
        closure_reason: String::new(),
        carved_out: false,
        disbursed: dec(senior_tranche),
        repaid: repayment.senior_principal_repaid.clone(),
        written_down: dec("0"),
        interest_adjustment: dec("0"),
        metadata_uri_onchain: String::new(),
        repayment,
    }
}

fn fees(mgmt: i32, perf: i32, oet: i32) -> FeeScheduleRow {
    FeeScheduleRow {
        mgmt_fee_rate_bps: mgmt,
        perf_fee_rate_bps: perf,
        oet_alloc_rate_bps: oet,
    }
}

fn ev(name: &str, ts: i64, outstanding: Option<&str>, new_rate: Option<i64>) -> LoanRateEventRow {
    LoanRateEventRow {
        loan_id: dec("1"),
        event_name: name.to_owned(),
        block_timestamp: ts,
        outstanding: outstanding.map(dec),
        new_rate,
    }
}

fn disbursed(ts: i64, outstanding: &str) -> LoanRateEventRow {
    ev("Disbursed", ts, Some(outstanding), None)
}

fn run(
    s: &LoanSnapshot,
    as_of: i64,
    f: &FeeScheduleRow,
    events: &[LoanRateEventRow],
) -> WaterfallBreakdown {
    compute_waterfall(
        s,
        &dec(HUGE_AMOUNT),
        as_of,
        f,
        events,
        PricingBasis::Quotational,
    )
    .unwrap()
}

fn suggested_interest(b: &WaterfallBreakdown) -> BigDecimal {
    &b.senior_coupon_net + &b.management_fee + &b.performance_fee
}

fn contract_cap(genesis_ppm: i128, events: &[LoanRateEventRow], until: i64) -> BigDecimal {
    let (mut out, mut ppm, mut prev, mut total) = (0_i128, genesis_ppm, None::<i64>, 0_i128);
    let mut sorted: Vec<&LoanRateEventRow> = events
        .iter()
        .filter(|e| e.event_name != "LoanDefaulted")
        .collect();
    sorted.sort_by_key(|e| e.block_timestamp);
    let close = |out: i128, ppm: i128, from: i64, to: i64, total: &mut i128| {
        *total += i128::from(to - from) * ppm * out / (i128::from(CONTRACT_YEAR) * 1_000_000);
    };
    for e in sorted {
        if e.block_timestamp >= until {
            break;
        }
        if let Some(p) = prev {
            close(out, ppm, p, e.block_timestamp, &mut total);
        }
        prev = Some(e.block_timestamp);
        if let Some(o) = &e.outstanding {
            out = o.to_string().parse().unwrap();
        }
        if let Some(r) = e.new_rate {
            ppm = i128::from(r);
        }
    }
    if let Some(p) = prev {
        close(out, ppm, p, until, &mut total);
    }
    BigDecimal::from(total)
}

#[test]
fn issue_1630_example_stays_under_the_contract_cap() {
    let s = snapshot("5200000000000", "0", 1750);
    let events = [disbursed(ORIGINATION, "5200000000000")];
    let as_of = ORIGINATION + 180 * DAY;
    let b = run(&s, as_of, &fees(0, 0, 0), &events);
    assert_eq!(b.senior_coupon_net, dec("448459958932"));
    assert!(b.senior_coupon_net <= contract_cap(175_000, &events, as_of));
    assert!(b.senior_coupon_net < dec("448460000000"));
}

#[test]
fn multi_draw_accrues_each_draw_from_its_own_timestamp() {
    let s = snapshot("3000000000000", "0", 1200);
    let events = [
        disbursed(ORIGINATION, "1000000000000"),
        disbursed(ORIGINATION + 30 * DAY, "3000000000000"),
    ];
    let as_of = ORIGINATION + 90 * DAY;
    let b = run(&s, as_of, &fees(0, 0, 0), &events);
    assert_eq!(b.senior_coupon_net, dec("68993839835"));
    assert!(b.senior_coupon_net <= contract_cap(120_000, &events, as_of));
}

#[test]
fn partial_repayment_then_repayment_declines_the_accrual_base() {
    let s = snapshot("2000000000000", "0", 1200);
    let events = [
        disbursed(ORIGINATION, "2000000000000"),
        ev(
            "PaymentRecorded",
            ORIGINATION + 60 * DAY,
            Some("1000000000000"),
            None,
        ),
    ];
    let as_of = ORIGINATION + 120 * DAY;
    let b = run(&s, as_of, &fees(0, 0, 0), &events);
    assert_eq!(b.senior_coupon_net, dec("59137577001"));
    assert!(b.senior_coupon_net <= contract_cap(120_000, &events, as_of));
}

#[test]
fn rate_amendment_switches_the_rate_at_the_event() {
    let s = snapshot("1000000000000", "0", 1200);
    let events = [
        disbursed(ORIGINATION, "1000000000000"),
        ev(
            "EconomicsAmended",
            ORIGINATION + 45 * DAY,
            None,
            Some(112_550),
        ),
    ];
    let as_of = ORIGINATION + 90 * DAY;
    let b = run(&s, as_of, &fees(0, 0, 0), &events);
    assert_eq!(b.senior_coupon_net, dec("28644763859"));
    assert!(b.senior_coupon_net <= contract_cap(120_000, &events, as_of));
}

#[test]
fn accrual_continues_past_maturity_without_a_rollover() {
    let s = snapshot("1000000000000", "0", 1200);
    let events = [disbursed(ORIGINATION, "1000000000000")];
    let as_of = ORIGINATION + 2 * CONTRACT_YEAR;
    let b = run(&s, as_of, &fees(0, 0, 0), &events);
    assert_eq!(b.senior_coupon_net, dec("240000000000"));
}

#[test]
fn rollover_past_maturity_keeps_accruing_at_the_new_rate() {
    let s = snapshot("1000000000000", "0", 1200);
    let events = [
        disbursed(ORIGINATION, "1000000000000"),
        ev("LoanRolledOver", ONE_YEAR_LATER, None, Some(180_000)),
    ];
    let as_of = ONE_YEAR_LATER + CONTRACT_YEAR / 2;
    let b = run(&s, as_of, &fees(0, 0, 0), &events);
    assert_eq!(b.senior_coupon_net, dec("210000000000"));
    assert!(b.senior_coupon_net <= contract_cap(120_000, &events, as_of));
}

#[test]
fn default_period_keeps_accruing() {
    let s = snapshot("1000000000000", "0", 1200);
    let events = [
        disbursed(ORIGINATION, "1000000000000"),
        ev(
            "LoanDefaulted",
            ORIGINATION + 60 * DAY,
            Some("1000000000000"),
            None,
        ),
    ];
    let as_of = ORIGINATION + 120 * DAY;
    let b = run(&s, as_of, &fees(0, 0, 0), &events);
    assert_eq!(b.senior_coupon_net, dec("39425051334"));
    assert!(b.senior_coupon_net <= contract_cap(120_000, &events, as_of));
}

#[test]
fn fees_are_simple_interest_on_the_same_outstanding_integral() {
    let s = snapshot("1000000000000", "0", 1200);
    let events = [disbursed(ORIGINATION, "1000000000000")];
    let b = run(&s, ONE_YEAR_LATER, &fees(100, 0, 50), &events);
    assert_eq!(b.management_fee, dec("10000000000"));
    assert_eq!(b.oet_allocation, dec("5000000000"));
}

#[test]
fn suggested_interest_never_exceeds_the_contract_cap_across_scenarios() {
    struct Scenario {
        genesis_bps: u32,
        events: Vec<LoanRateEventRow>,
        as_of: i64,
    }
    let scenarios = [
        Scenario {
            genesis_bps: 1750,
            events: vec![disbursed(ORIGINATION, "5200000000000")],
            as_of: ORIGINATION + 180 * DAY,
        },
        Scenario {
            genesis_bps: 1333,
            events: vec![
                disbursed(ORIGINATION + 7, "1234567890123"),
                disbursed(ORIGINATION + 11 * DAY + 13, "2345678901234"),
                ev(
                    "PaymentRecorded",
                    ORIGINATION + 40 * DAY + 5,
                    Some("987654321098"),
                    None,
                ),
                ev(
                    "EconomicsAmended",
                    ORIGINATION + 70 * DAY + 3,
                    None,
                    Some(137_777),
                ),
                ev(
                    "LoanDefaulted",
                    ORIGINATION + 90 * DAY + 1,
                    Some("987654321098"),
                    None,
                ),
                ev(
                    "LoanRolledOver",
                    ORIGINATION + 200 * DAY + 9,
                    None,
                    Some(99_999),
                ),
            ],
            as_of: ORIGINATION + 365 * DAY + 77,
        },
        Scenario {
            genesis_bps: 999,
            events: vec![
                disbursed(ORIGINATION, "777777777777"),
                ev(
                    "Undisbursed",
                    ORIGINATION + 3 * DAY + 1,
                    Some("333333333333"),
                    None,
                ),
                ev(
                    "LoanWrittenDown",
                    ORIGINATION + 50 * DAY + 2,
                    Some("111111111111"),
                    None,
                ),
            ],
            as_of: ORIGINATION + 3 * CONTRACT_YEAR + 19,
        },
    ];
    for sc in scenarios {
        let s = snapshot("5200000000000", "0", sc.genesis_bps);
        let cap = contract_cap(i128::from(sc.genesis_bps) * 100, &sc.events, sc.as_of);
        for f in [fees(0, 0, 0), fees(100, 2000, 50)] {
            let b = run(&s, sc.as_of, &f, &sc.events);
            assert!(
                suggested_interest(&b) <= cap,
                "{} > {cap}",
                suggested_interest(&b)
            );
        }
    }
}
