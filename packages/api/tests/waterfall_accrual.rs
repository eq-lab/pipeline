// spec: docs/product-specs/yield.md#waterfall-components
use bigdecimal::BigDecimal;

use pipeline_api::error::ApiError;
use pipeline_api::routes::waterfall::{
    compute_waterfall, ensure_event_history_complete, validate_as_of_not_future, PricingBasis,
    WaterfallBreakdown,
};
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

const T: &str = "1000000000000";

fn repayment(senior: &str, mgmt: &str, perf: &str) -> RepaymentSnapshot {
    RepaymentSnapshot {
        offtaker_received: dec("0"),
        senior_principal_repaid: dec("0"),
        senior_interest: dec(senior),
        equity_distributed: dec("0"),
        mgmt_fee: dec(mgmt),
        perf_fee: dec(perf),
        oet_alloc: dec("0"),
    }
}

fn headroom(gross_cap: &BigDecimal, adj: &str, recorded: (&str, &str, &str)) -> BigDecimal {
    (gross_cap + dec(adj) - dec(recorded.0) - dec(recorded.1) - dec(recorded.2)).max(dec("0"))
}

#[test]
fn prior_recorded_amounts_and_adjustment_clamp_the_coupon_to_the_headroom() {
    let mut s = snapshot_with_repayment(
        T,
        repayment("50000000000", "30000000000", "20000000000"),
        1200,
    );
    s.interest_adjustment = dec("5000000000");
    let events = [disbursed(ORIGINATION, T)];
    let b = run(&s, ONE_YEAR_LATER, &fees(100, 2000, 0), &events);
    let room = headroom(
        &contract_cap(120_000, &events, ONE_YEAR_LATER),
        "5000000000",
        ("50000000000", "30000000000", "20000000000"),
    );
    assert_eq!(room, dec("25000000000"));
    assert_eq!(suggested_interest(&b), room);
    assert_eq!(b.performance_fee, dec("3000000000"));
    assert_eq!(b.management_fee, dec("0"));
    assert_eq!(b.senior_coupon_net, dec("22000000000"));
}

#[test]
fn over_recorded_fee_legs_drop_the_coupon_and_scale_the_fees() {
    let s = snapshot_with_repayment(T, repayment("10000000000", "100000000000", "0"), 1200);
    let events = [disbursed(ORIGINATION, T)];
    let b = run(&s, ONE_YEAR_LATER, &fees(100, 2000, 0), &events);
    let room = headroom(
        &contract_cap(120_000, &events, ONE_YEAR_LATER),
        "0",
        ("10000000000", "100000000000", "0"),
    );
    assert_eq!(room, dec("10000000000"));
    assert_eq!(b.senior_coupon_net, dec("0"));
    assert!(suggested_interest(&b) <= room);
    assert_eq!(b.management_fee, dec("0"));
    assert_eq!(b.performance_fee, dec("0"));
}

#[test]
fn fully_recorded_interest_leaves_no_headroom() {
    let s = snapshot_with_repayment(T, repayment("0", "0", "120000000000"), 1200);
    let events = [disbursed(ORIGINATION, T)];
    let b = run(&s, ONE_YEAR_LATER, &fees(0, 0, 0), &events);
    assert_eq!(suggested_interest(&b), dec("0"));
}

#[test]
fn closed_loan_has_no_headroom() {
    let mut s = snapshot(T, "0", 1200);
    "Closed".clone_into(&mut s.status);
    let events = [disbursed(ORIGINATION, T)];
    let b = run(&s, ONE_YEAR_LATER, &fees(0, 0, 0), &events);
    assert_eq!(suggested_interest(&b), dec("0"));
}

#[test]
fn non_whole_bps_genesis_rate_floors_below_the_ppm_cap() {
    let s = snapshot(T, "0", 1125);
    let events = [disbursed(ORIGINATION, T)];
    let as_of = ORIGINATION + 200 * DAY + 17;
    let b = run(&s, as_of, &fees(0, 0, 0), &events);
    let cap = contract_cap(112_550, &events, as_of);
    assert!(
        b.senior_coupon_net < cap,
        "{} !< {cap}",
        b.senior_coupon_net
    );
    assert!(b.senior_coupon_net > dec("0"));
}

fn default_snapshot(repaid: &str) -> LoanSnapshot {
    let mut s = snapshot(T, repaid, 1200);
    "Default".clone_into(&mut s.status);
    s
}

fn run_amount(s: &LoanSnapshot, amount: &str) -> Result<WaterfallBreakdown, ApiError> {
    let events = [disbursed(ORIGINATION, T)];
    compute_waterfall(
        s,
        &dec(amount),
        ONE_YEAR_LATER,
        &fees(100, 2000, 50),
        &events,
        PricingBasis::Quotational,
    )
}

#[test]
fn default_pays_principal_then_interest_with_zero_fees_oet_and_equity() {
    let b = run_amount(&default_snapshot("0"), "1050000000000").unwrap();
    assert_eq!(b.senior_principal_returned, dec(T));
    assert_eq!(b.senior_coupon_net, dec("50000000000"));
    assert_eq!(b.management_fee, dec("0"));
    assert_eq!(b.performance_fee, dec("0"));
    assert_eq!(b.oet_allocation, dec("0"));
    assert_eq!(b.equity_distributed, dec("0"));
}

#[test]
fn default_payment_below_principal_is_all_principal() {
    let b = run_amount(&default_snapshot("0"), "400000000000").unwrap();
    assert_eq!(b.senior_principal_returned, dec("400000000000"));
    assert_eq!(b.senior_coupon_net, dec("0"));
}

#[test]
fn default_amount_beyond_principal_plus_headroom_is_a_400() {
    let err = run_amount(&default_snapshot("0"), "1120000000001").unwrap_err();
    assert!(matches!(err, ApiError::BadRequest(m) if m.contains("Default")));
    let ok = run_amount(&default_snapshot("0"), "1120000000000").unwrap();
    assert_eq!(ok.senior_coupon_net, dec("120000000000"));
}

#[test]
fn history_check_rejects_a_snapshot_without_events() {
    let s = snapshot(T, "0", 1200);
    let err = ensure_event_history_complete(&s, &[], ONE_YEAR_LATER, ORIGINATION).unwrap_err();
    assert!(matches!(err, ApiError::UnprocessableEntity(m) if m.contains("re-index required")));
}

#[test]
fn history_check_rejects_a_latest_event_that_disagrees_with_the_snapshot() {
    let s = snapshot(T, "0", 1200);
    let events = [disbursed(ORIGINATION, "500000000000")];
    assert!(ensure_event_history_complete(&s, &events, ONE_YEAR_LATER, ORIGINATION).is_err());
}

#[test]
fn history_check_accepts_matching_events_and_the_pre_snapshot_genesis_fallback() {
    let s = snapshot(T, "0", 1200);
    let events = [disbursed(ORIGINATION, T)];
    assert!(ensure_event_history_complete(&s, &events, ONE_YEAR_LATER, ORIGINATION).is_ok());
    assert!(ensure_event_history_complete(&s, &[], ORIGINATION, ORIGINATION + 60).is_ok());
    let repaid = snapshot(T, T, 1200);
    assert!(ensure_event_history_complete(&repaid, &[], ONE_YEAR_LATER, ORIGINATION).is_ok());
}

#[test]
fn future_as_of_beyond_the_skew_is_a_400() {
    let now = 1_800_000_000;
    assert!(validate_as_of_not_future(now + 300, now).is_ok());
    assert!(matches!(
        validate_as_of_not_future(now + 301, now),
        Err(ApiError::BadRequest(_))
    ));
}
