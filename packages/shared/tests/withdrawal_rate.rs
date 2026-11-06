use std::str::FromStr;

use bigdecimal::BigDecimal;
use shared::withdrawal_rate::{
    convert_to_assets, current_rate, rate_at_claim, rate_one, LogPosition, RateSetPoint, RATE_ONE,
};

fn d(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

fn pos(block_number: i64, log_index: i64) -> LogPosition {
    LogPosition {
        block_number,
        log_index,
    }
}

fn point(addr: &str, block: i64, idx: i64, rate: i64) -> RateSetPoint {
    RateSetPoint {
        contract_address: addr.to_owned(),
        position: pos(block, idx),
        new_rate: BigDecimal::from(rate),
    }
}

#[test]
fn rate_one_constant_matches_contract() {
    assert_eq!(RATE_ONE, 1_000_000);
    assert_eq!(rate_one(), BigDecimal::from(1_000_000));
}

#[test]
fn convert_at_rate_one_is_identity() {
    for v in [
        "0",
        "1",
        "31875000000",
        "170141183460469231731687303715884105727",
    ] {
        assert_eq!(convert_to_assets(&d(v), &rate_one()), d(v));
    }
}

#[test]
fn convert_floors_like_the_contract() {
    assert_eq!(
        convert_to_assets(&d("7"), &BigDecimal::from(850_000)),
        d("5")
    );
    assert_eq!(convert_to_assets(&d("10"), &BigDecimal::from(1)), d("0"));
    assert_eq!(
        convert_to_assets(&d("100"), &BigDecimal::from(850_000)),
        d("85")
    );
}

#[test]
fn claim_without_rate_set_pays_at_rate_one() {
    assert_eq!(rate_at_claim(pos(10, 0), None), rate_one());
}

#[test]
fn rate_set_before_claim_applies() {
    let r = BigDecimal::from(850_000);
    assert_eq!(rate_at_claim(pos(10, 0), Some((pos(9, 999), &r))), r);
    assert_eq!(rate_at_claim(pos(10, 5), Some((pos(10, 4), &r))), r);
}

#[test]
fn rate_set_at_or_after_claim_does_not_apply() {
    let r = BigDecimal::from(850_000);
    assert_eq!(
        rate_at_claim(pos(10, 0), Some((pos(11, 0), &r))),
        rate_one()
    );
    assert_eq!(
        rate_at_claim(pos(10, 4), Some((pos(10, 5), &r))),
        rate_one()
    );
    assert_eq!(
        rate_at_claim(pos(10, 4), Some((pos(10, 4), &r))),
        rate_one()
    );
}

#[test]
fn current_rate_empty_is_rate_one() {
    assert_eq!(current_rate(&[], None), rate_one());
    assert_eq!(current_rate(&[], Some("CA")), rate_one());
}

#[test]
fn current_rate_scoped_ignores_other_contract() {
    let pts = vec![point("CA", 5, 0, 900_000), point("CB", 9, 0, 500_000)];
    assert_eq!(current_rate(&pts, Some("CA")), BigDecimal::from(900_000));
}

#[test]
fn current_rate_unscoped_takes_latest_on_chain() {
    let pts = vec![
        point("CA", 5, 0, 900_000),
        point("CB", 9, 0, 500_000),
        point("CA", 9, 3, 400_000),
    ];
    assert_eq!(current_rate(&pts, None), BigDecimal::from(400_000));
}

#[test]
fn current_rate_scoped_without_rate_set_is_rate_one() {
    let pts = vec![point("CB", 9, 0, 500_000)];
    assert_eq!(current_rate(&pts, Some("CA")), rate_one());
}
