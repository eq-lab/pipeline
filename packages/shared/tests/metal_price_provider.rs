//! Unit tests for the `metal_price` provider — pure, no DB, no network, no env.
//!
//! Exercises the extracted URL builders and response parser. The network-bound trait
//! methods (`current_price`/`historical_price`) and the env-reading registry arm are not
//! unit-tested (they would require live HTTP + `METALPRICE_API_KEY`); their logic is fully
//! delegated to the pure helpers covered here.

use std::str::FromStr;

use bigdecimal::BigDecimal;
use chrono::NaiveDate;
use shared::metal_price::{historical_url, latest_url, parse_usd_price};

#[test]
fn latest_url_has_key_base_and_currency() {
    let url = latest_url("https://api.metalpriceapi.com/v1", "KEY123", "XAU");
    assert_eq!(
        url,
        "https://api.metalpriceapi.com/v1/latest?api_key=KEY123&base=USD&currencies=XAU"
    );
}

#[test]
fn historical_url_has_iso_date_path_segment() {
    let date = NaiveDate::from_ymd_opt(2021, 7, 6).unwrap();
    let url = historical_url("https://api.metalpriceapi.com/v1", "KEY123", "XAU", date);
    assert_eq!(
        url,
        "https://api.metalpriceapi.com/v1/2021-07-06?api_key=KEY123&base=USD&currencies=XAU"
    );
}

#[test]
fn parse_prefers_reciprocal_usd_field_without_precision_loss() {
    let body = r#"{
        "success": true,
        "base": "USD",
        "timestamp": 1625609377,
        "rates": { "XAU": 0.00053853, "USDXAU": 1856.906765 }
    }"#;
    let price = parse_usd_price(body, "XAU").unwrap();
    // Exact decimal digits are preserved (not routed through f64).
    assert_eq!(price, BigDecimal::from_str("1856.906765").unwrap());
}

#[test]
fn parse_falls_back_to_inverting_metal_per_usd() {
    let body = r#"{ "success": true, "base": "USD", "rates": { "XAU": 0.0005 } }"#;
    let price = parse_usd_price(body, "XAU").unwrap();
    // 1 / 0.0005 == 2000.
    assert_eq!(price, BigDecimal::from(2000));
}

#[test]
fn parse_rejects_unsuccessful_response() {
    let body = r#"{ "success": false, "error": { "code": 403, "info": "Access Restricted" } }"#;
    let err = parse_usd_price(body, "XAU").unwrap_err();
    assert!(
        err.to_string().contains("unsuccessful"),
        "unexpected error: {err}"
    );
}

#[test]
fn parse_rejects_missing_symbol() {
    let body = r#"{ "success": true, "base": "USD", "rates": { "XAG": 25.0, "USDXAG": 25.0 } }"#;
    let err = parse_usd_price(body, "XAU").unwrap_err();
    assert!(
        err.to_string().contains("no rate for"),
        "unexpected error: {err}"
    );
}

#[test]
fn parse_rejects_zero_metal_rate() {
    let body = r#"{ "success": true, "base": "USD", "rates": { "XAU": 0 } }"#;
    let err = parse_usd_price(body, "XAU").unwrap_err();
    assert!(err.to_string().contains("zero"), "unexpected error: {err}");
}
