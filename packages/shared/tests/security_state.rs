// spec: docs/product-specs/loan-security-state.md#computed-fields
use std::str::FromStr;

use bigdecimal::num_bigint::BigInt;
use bigdecimal::BigDecimal;
use shared::security_state::*;

const U32_MAX: u128 = u32::MAX as u128;

fn term(record_id: u32, goods: bool, qty: i128, vpu: i128) -> CountedTerm {
    CountedTerm {
        record_id,
        goods,
        counted_quantity: qty,
        value_per_unit: vpu,
    }
}

#[test]
fn ltv_is_zero_without_debt_whatever_the_value() {
    assert_eq!(ltv_bps(0, 0), 0);
    assert_eq!(ltv_bps(0, -5), 0);
    assert_eq!(ltv_bps(0, 1_000), 0);
}

#[test]
fn ltv_is_the_sentinel_with_debt_and_no_value() {
    assert_eq!(ltv_bps(1, 0), u32::MAX);
    assert_eq!(ltv_bps(1, -1), u32::MAX);
    assert_eq!(ltv_bps(1, i128::MIN), u32::MAX);
}

#[test]
fn ltv_rounds_up_and_leaves_exact_divisions_alone() {
    assert_eq!(ltv_bps(1, 3), 3334);
    assert_eq!(ltv_bps(1, 2), 5000);
    assert_eq!(ltv_bps(8, 10), 8000);
    assert_eq!(ltv_bps(80_000_001, 100_000_000), 8001);
}

#[test]
fn ltv_overflow_and_oversized_ratios_are_the_sentinel() {
    assert_eq!(ltv_bps(u128::MAX, 1), u32::MAX);
    assert_eq!(ltv_bps(u128::MAX / BPS_ONE + 1, i128::MAX), u32::MAX);
    assert_eq!(ltv_bps(U32_MAX, 1), u32::MAX);
    assert_eq!(ltv_bps(u128::from(u32::MAX), 10_000), u32::MAX);
    assert_eq!(ltv_bps(429_496, 10_000), 429_496);
}

#[test]
fn coverage_rounds_down() {
    assert_eq!(coverage_bps(3, 1), 3333);
    assert_eq!(coverage_bps(2, 3), 15_000);
    assert_eq!(coverage_bps(10, 8), 8000);
}

#[test]
fn coverage_of_a_negative_value_is_zero() {
    assert_eq!(coverage_bps(5, -100), 0);
    assert_eq!(coverage_bps(5, 0), 0);
}

#[test]
fn coverage_without_debt_is_the_sentinel() {
    assert_eq!(coverage_bps(0, 0), u32::MAX);
    assert_eq!(coverage_bps(0, 1_000_000), u32::MAX);
}

#[test]
fn coverage_overflow_is_the_sentinel() {
    assert_eq!(coverage_bps(1, i128::MAX), u32::MAX);
    assert_eq!(coverage_bps(1, 429_497), u32::MAX);
    assert_eq!(coverage_bps(1, 429_496), 4_294_960_000);
}

#[test]
fn one_division_over_the_sum_differs_from_per_term_flooring() {
    let terms = [term(1, true, 1, 5_000_000), term(2, true, 1, 5_000_000)];
    assert_eq!(counted_value_excluding(&terms, 0), Some(1));
    assert_eq!(record_term_value(&terms[0]), Some(0));
    assert_eq!(record_term_value(&terms[1]), Some(0));
}

#[test]
fn an_unmarked_goods_term_is_worth_nothing() {
    assert_eq!(
        counted_value_excluding(&[term(1, true, 5 * UNIT, 0)], 0),
        Some(0)
    );
}

#[test]
fn a_non_goods_term_is_its_quantity() {
    assert_eq!(
        counted_value_excluding(&[term(1, false, 33 * UNIT, 0)], 0),
        Some(33 * UNIT)
    );
    assert_eq!(
        record_term_value(&term(1, false, 33 * UNIT, 0)),
        Some(33 * UNIT)
    );
}

#[test]
fn a_goods_term_is_quantity_times_price() {
    assert_eq!(
        counted_value_excluding(&[term(1, true, 1_000 * UNIT, 25_000_000)], 0),
        Some(2_500 * UNIT)
    );
}

#[test]
fn exclude_drops_exactly_one_record() {
    let terms = [
        term(1, false, 10 * UNIT, 0),
        term(2, false, 20 * UNIT, 0),
        term(3, false, 30 * UNIT, 0),
    ];
    assert_eq!(counted_value_excluding(&terms, 2), Some(40 * UNIT));
    assert_eq!(counted_value_excluding(&terms, 9), Some(60 * UNIT));
}

#[test]
fn value_overflow_is_none() {
    assert_eq!(
        counted_value_excluding(&[term(1, true, i128::MAX, 2)], 0),
        None
    );
    assert_eq!(
        counted_value_excluding(&[term(1, false, i128::MAX, 0)], 0),
        None
    );
    let terms = [
        term(1, false, i128::MAX / UNIT, 0),
        term(2, false, i128::MAX / UNIT, 0),
    ];
    assert_eq!(counted_value_excluding(&terms, 0), None);
    assert_eq!(counted_value_excluding(&terms, 2), Some(i128::MAX / UNIT));
    assert_eq!(record_term_value(&term(1, true, i128::MAX, 2)), None);
}

const ADVANCE: u32 = 8000;

fn two_records() -> [CountedTerm; 2] {
    [
        term(1, false, 1_000 * UNIT, 0),
        term(2, false, 1_000 * UNIT, 0),
    ]
}

#[test]
fn agent_release_pending_perfection_is_allowed() {
    let r = agent_release(
        "PendingPerfection",
        "WarehousePledge",
        9_999 * UNIT as u128,
        0,
        &two_records(),
        1,
        ADVANCE,
    );
    assert_eq!(r, AgentRelease::Allowed);
}

#[test]
fn agent_release_loss_payee_is_allowed() {
    let r = agent_release(
        "Active",
        "InsuranceLossPayee",
        9_999 * UNIT as u128,
        0,
        &two_records(),
        1,
        ADVANCE,
    );
    assert_eq!(r, AgentRelease::Allowed);
}

#[test]
fn agent_release_with_no_outstanding_principal_is_allowed() {
    let r = agent_release("Active", "CashCover", 0, 5, &two_records(), 1, ADVANCE);
    assert_eq!(r, AgentRelease::Allowed);
}

#[test]
fn agent_release_checks_ltv_without_the_record() {
    let rest = 1_000 * UNIT;
    let debt_at_ratio = (rest * 8 / 10) as u128;
    let at = agent_release(
        "Active",
        "CashCover",
        debt_at_ratio,
        0,
        &two_records(),
        1,
        ADVANCE,
    );
    assert_eq!(at, AgentRelease::Allowed);
    let above = agent_release(
        "Active",
        "CashCover",
        debt_at_ratio + 1,
        0,
        &two_records(),
        1,
        ADVANCE,
    );
    assert_eq!(above, AgentRelease::NeedsConsent);
}

#[test]
fn agent_release_counts_accrued_interest_in_the_debt() {
    let debt = (1_000 * UNIT * 8 / 10) as u128;
    let r = agent_release(
        "Active",
        "CashCover",
        debt - 1,
        2,
        &two_records(),
        1,
        ADVANCE,
    );
    assert_eq!(r, AgentRelease::NeedsConsent);
}

#[test]
fn agent_release_needs_consent_when_nothing_would_be_left() {
    let r = agent_release(
        "Active",
        "CashCover",
        1,
        0,
        &[term(1, false, UNIT, 0)],
        1,
        ADVANCE,
    );
    assert_eq!(r, AgentRelease::NeedsConsent);
}

#[test]
fn agent_release_needs_consent_on_overflow() {
    let r = agent_release(
        "Active",
        "CashCover",
        u128::MAX,
        1,
        &two_records(),
        1,
        ADVANCE,
    );
    assert_eq!(r, AgentRelease::NeedsConsent);
    let big = [term(1, false, i128::MAX, 0)];
    let r = agent_release("Active", "CashCover", 5, 0, &big, 2, ADVANCE);
    assert_eq!(r, AgentRelease::NeedsConsent);
}

#[test]
fn agent_release_renders_as_the_wire_names() {
    assert_eq!(AgentRelease::Allowed.as_str(), "allowed");
    assert_eq!(AgentRelease::NeedsConsent.as_str(), "needs_consent");
}

#[test]
fn counting_follows_status_and_protection() {
    assert!(counts_toward_value("Active", "WarehousePledge"));
    assert!(counts_toward_value("Active", "CashCover"));
    assert!(!counts_toward_value("Active", "InsuranceLossPayee"));
    assert!(!counts_toward_value("PendingPerfection", "WarehousePledge"));
    assert!(!counts_toward_value("Released", "WarehousePledge"));
    assert!(!counts_toward_value("Enforced", "EndorsedBl"));
}

#[test]
fn in_storage_protections() {
    assert!(is_in_storage("WarehousePledge"));
    assert!(is_in_storage("CollateralManagement"));
    assert!(!is_in_storage("EndorsedBl"));
    assert!(!is_in_storage("CashCover"));
}

#[test]
fn open_statuses() {
    assert!(is_open_status("Active"));
    assert!(is_open_status("PendingPerfection"));
    assert!(!is_open_status("Released"));
    assert!(!is_open_status("Enforced"));
}

#[test]
fn attestation_goes_stale_one_second_after_the_interval() {
    assert!(!attestation_stale(1_000, 900, 100));
    assert!(attestation_stale(1_001, 900, 100));
    assert!(!attestation_stale(1_000, 2_000, 100));
}

#[test]
fn an_interval_of_zero_turns_staleness_off() {
    assert!(!attestation_stale(u64::MAX, 0, 0));
    assert!(!inspection_stale(u64::MAX, "WarehousePledge", 0, None, 0));
}

#[test]
fn only_in_storage_goods_go_inspection_stale() {
    assert!(inspection_stale(1_001, "WarehousePledge", 900, None, 100));
    assert!(inspection_stale(
        1_001,
        "CollateralManagement",
        900,
        None,
        100
    ));
    assert!(!inspection_stale(1_001, "EndorsedBl", 900, None, 100));
    assert!(!inspection_stale(1_001, "CashCover", 900, None, 100));
}

#[test]
fn inspection_staleness_edge_is_strict() {
    assert!(!inspection_stale(1_000, "WarehousePledge", 900, None, 100));
    assert!(inspection_stale(1_001, "WarehousePledge", 900, None, 100));
}

#[test]
fn the_lots_latest_inspection_wins_over_perfection() {
    assert!(!inspection_stale(
        1_001,
        "WarehousePledge",
        0,
        Some(950),
        100
    ));
    assert!(inspection_stale(
        1_001,
        "WarehousePledge",
        950,
        Some(0),
        100
    ));
}

#[test]
fn mark_staleness_mirrors_record_term() {
    assert!(mark_stale(1_000, true, None, 0));
    assert!(mark_stale(1_000, true, None, 100));
    assert!(!mark_stale(1_000, true, Some(0), 0));
    assert!(!mark_stale(1_000, true, Some(900), 100));
    assert!(mark_stale(1_001, true, Some(900), 100));
    assert!(!mark_stale(1_000, false, None, 100));
}

#[test]
fn mark_age_cases() {
    assert_eq!(mark_age(1_000, &[]), 0);
    assert_eq!(mark_age(1_000, &[Some(900), None]), u64::MAX);
    assert_eq!(mark_age(1_000, &[None, Some(900)]), u64::MAX);
    assert_eq!(mark_age(1_000, &[Some(900), Some(500), Some(950)]), 500);
    assert_eq!(mark_age(1_000, &[Some(2_000)]), 0);
}

#[test]
fn price_stale_formula() {
    assert!(price_stale(0, 0, true));
    assert!(!price_stale(u64::MAX, 0, false));
    assert!(!price_stale(100, 100, false));
    assert!(price_stale(101, 100, false));
    assert!(price_stale(u64::MAX, 100, true));
}

#[test]
fn cure_by_prefers_the_event_over_a_drifted_snapshot() {
    let events = [(100, 700), (200, 900)];
    assert_eq!(
        cure_by(200, &events, Some((200, 1_234))),
        (Some(900), Some("event"))
    );
    assert_eq!(
        cure_by(100, &events, Some((100, 1_234))),
        (Some(700), Some("event"))
    );
}

#[test]
fn cure_by_falls_back_to_the_snapshot() {
    assert_eq!(
        cure_by(300, &[(100, 700)], Some((300, 950))),
        (Some(950), Some("coverage_detail"))
    );
    assert_eq!(
        cure_by(300, &[], Some((300, 950))),
        (Some(950), Some("coverage_detail"))
    );
}

#[test]
fn cure_by_is_none_when_nothing_matches() {
    assert_eq!(cure_by(300, &[(100, 700)], Some((301, 950))), (None, None));
    assert_eq!(cure_by(300, &[], None), (None, None));
}

#[test]
fn cure_by_is_none_without_a_call() {
    assert_eq!(cure_by(0, &[(0, 5)], Some((0, 6))), (None, None));
}

fn dec(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

fn f7(raw: &str) -> Option<String> {
    format_7dp(&dec(raw))
}

fn sqlx_dec(digits: i64, scale: i64) -> BigDecimal {
    BigDecimal::new(BigInt::from(digits), scale)
}

#[test]
fn format_7dp_of_decimals() {
    assert_eq!(f7("0").unwrap(), "0.0000000");
    assert_eq!(f7("1").unwrap(), "0.0000001");
    assert_eq!(f7("10000000").unwrap(), "1.0000000");
    assert_eq!(f7("12500000000").unwrap(), "1250.0000000");
    assert_eq!(
        f7("12345678901234567890123").unwrap(),
        "1234567890123456.7890123"
    );
    assert_eq!(f7("-5").unwrap(), "-0.0000005");
    assert_eq!(f7("-12500000000").unwrap(), "-1250.0000000");
}

#[test]
fn format_7dp_never_uses_an_exponent_and_keeps_the_value() {
    assert_eq!(
        f7("100000000000000000000000000000000000000").unwrap(),
        "10000000000000000000000000000000.0000000"
    );
    assert_eq!(f7("1E+20").unwrap(), "10000000000000.0000000");
    assert_eq!(f7("123456789E-3").unwrap(), "0.0123456");
}

#[test]
fn format_7dp_truncates_fractional_raw_units() {
    assert_eq!(f7("10000000.9").unwrap(), "1.0000000");
    assert_eq!(f7("10000000.000").unwrap(), "1.0000000");
}

#[test]
fn values_decoded_by_sqlx_with_a_negative_exponent_are_read_correctly() {
    let debt = sqlx_dec(125, -8);
    assert_eq!(format_7dp(&debt).unwrap(), "1250.0000000");
    assert_eq!(dec_to_i128(&debt), Some(12_500_000_000));
    assert_eq!(dec_to_u128(&debt), Some(12_500_000_000));

    let par = sqlx_dec(1, -7);
    assert_eq!(dec_to_i128(&par), Some(10_000_000));
    assert_eq!(format_7dp(&par).unwrap(), "1.0000000");

    let ts = sqlx_dec(17_624, -5);
    assert_eq!(dec_to_u64(&ts), Some(1_762_400_000));
    assert_eq!(integer_string(&ts).unwrap(), "1762400000");

    let interval = sqlx_dec(1, -6);
    assert_eq!(dec_to_u64(&interval), Some(1_000_000));

    let plain = sqlx_dec(604_800, 0);
    assert_eq!(dec_to_u64(&plain), Some(604_800));
    assert_eq!(integer_string(&plain).unwrap(), "604800");

    let negative = sqlx_dec(-5, -4);
    assert_eq!(dec_to_i128(&negative), Some(-50_000));
}

#[test]
fn absurd_exponents_are_rejected_not_expanded() {
    for scale in [-1_000_000, -41, 20_001, 1_000_000] {
        let d = sqlx_dec(1, scale);
        assert_eq!(dec_to_integer(&d), None, "{scale}");
        assert_eq!(format_7dp(&d), None, "{scale}");
        assert_eq!(integer_string(&d), None, "{scale}");
    }
    assert_eq!(f7("1E-999999999"), None);
    assert_eq!(f7("1E+999999999"), None);
    assert!(dec_to_integer(&sqlx_dec(1, -40)).is_some());
}

#[test]
fn format_7dp_i128_cases() {
    assert_eq!(format_7dp_i128(0), "0.0000000");
    assert_eq!(format_7dp_i128(10_000_000), "1.0000000");
    assert_eq!(format_7dp_i128(-1), "-0.0000001");
    assert_eq!(
        format_7dp_i128(i128::MIN),
        "-17014118346046923173168730371588.4105728"
    );
    assert_eq!(
        format_7dp_i128(i128::MAX),
        "17014118346046923173168730371588.4105727"
    );
}

#[test]
fn integer_conversions_are_bounded() {
    assert_eq!(dec_to_u64(&dec("1762400000")), Some(1_762_400_000));
    assert_eq!(dec_to_u64(&dec("1762400000.9")), Some(1_762_400_000));
    assert_eq!(dec_to_u64(&dec("-1")), None);
    assert_eq!(dec_to_u64(&dec("18446744073709551616")), None);
    assert_eq!(
        dec_to_u128(&dec("340282366920938463463374607431768211455")),
        Some(u128::MAX)
    );
    assert_eq!(dec_to_i128(&dec("-5")), Some(-5));
    assert_eq!(dec_to_i128(&dec("1E+999999999")), None);
    assert_eq!(dec_to_u64(&dec("1E-999999999")), None);
    assert_eq!(dec_to_i128(&dec("1E+9")), Some(1_000_000_000));
    assert_eq!(integer_string(&dec("604800")).unwrap(), "604800");
    assert_eq!(integer_string(&dec("12.7")).unwrap(), "12");
}

#[test]
fn release_is_unconditional_for_pending_loss_payee_and_no_outstanding() {
    assert!(release_unconditional(
        "PendingPerfection",
        "CashCover",
        None
    ));
    assert!(release_unconditional("Active", "InsuranceLossPayee", None));
    assert!(release_unconditional("Active", "CashCover", Some(0)));
    assert!(!release_unconditional("Active", "CashCover", Some(1)));
    assert!(!release_unconditional("Active", "CashCover", None));
}
