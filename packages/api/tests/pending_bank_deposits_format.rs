// spec: docs/product-specs/deposits.md#lp-pending-bank-deposits
use std::str::FromStr;

use bigdecimal::BigDecimal;
use pipeline_api::formatting::{pending_bank_deposits_display, pending_bank_deposits_field};

fn pending(s: &str) -> String {
    pending_bank_deposits_display(&BigDecimal::from_str(s).expect("a decimal")).expect("in range")
}

#[test]
fn pins_two_decimals() {
    assert_eq!(pending("0"), "0.00");
    assert_eq!(pending("0.00"), "0.00");
    assert_eq!(pending("1500"), "1500.00");
    assert_eq!(pending("1500.5"), "1500.50");
}

#[test]
fn keeps_large_values_plain() {
    assert_eq!(pending("999999999999999999.99"), "999999999999999999.99");
    assert_eq!(pending("1e18"), "1000000000000000000.00");
}

#[test]
fn handles_negative_scale_decimals() {
    let total = BigDecimal::new(15.into(), -2);
    assert_eq!(
        pending_bank_deposits_display(&total),
        Ok("1500.00".to_owned())
    );
}

#[test]
fn rejects_extreme_scales_without_overflow() {
    for scale in [i64::MIN, i64::MAX, -1_000_000_000, 1_000_000_000] {
        assert!(pending_bank_deposits_display(&BigDecimal::new(1.into(), scale)).is_err());
    }
}

#[test]
fn field_degrades_to_none_on_read_failure() {
    let failed: Result<BigDecimal, String> = Err("connection reset".to_owned());
    assert_eq!(pending_bank_deposits_field(1, failed), None);
}

#[test]
fn field_degrades_to_none_on_out_of_range_total() {
    let huge: Result<BigDecimal, String> = Ok(BigDecimal::new(1.into(), i64::MIN));
    assert_eq!(pending_bank_deposits_field(1, huge), None);
}

#[test]
fn field_serves_the_formatted_total() {
    let ok: Result<BigDecimal, String> = Ok(BigDecimal::from(1500));
    assert_eq!(
        pending_bank_deposits_field(1, ok),
        Some("1500.00".to_owned())
    );
}
