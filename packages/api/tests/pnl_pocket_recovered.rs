// spec: docs/references/backend.md#stellar-pocket-indexing
use bigdecimal::BigDecimal;
use pipeline_api::routes::pnl::pnl_totals;

#[test]
fn none_returns_todays_totals() {
    let unrealized = BigDecimal::from(40);
    let realized = BigDecimal::from(100);
    let (total_realized, total, recovered) = pnl_totals(&unrealized, &realized, None);
    assert_eq!(total_realized, realized.to_string());
    assert_eq!(total, (&unrealized + &realized).to_string());
    assert_eq!(recovered, None);
}

#[test]
fn some_adds_recoveries_to_both_totals() {
    let unrealized = BigDecimal::from(40);
    let realized = BigDecimal::from(100);
    let recovered = BigDecimal::from(250);
    let (total_realized, total, pocket_recovered) =
        pnl_totals(&unrealized, &realized, Some(&recovered));
    assert_eq!(total_realized, "350");
    assert_eq!(total, "390");
    assert_eq!(pocket_recovered.as_deref(), Some("250"));
}

#[test]
fn some_zero_reports_zero_not_null() {
    let zero = BigDecimal::from(0);
    let (total_realized, total, pocket_recovered) =
        pnl_totals(&BigDecimal::from(5), &BigDecimal::from(7), Some(&zero));
    assert_eq!(total_realized, "7");
    assert_eq!(total, "12");
    assert_eq!(pocket_recovered.as_deref(), Some("0"));
}

#[test]
fn totals_never_render_exponent_form() {
    use std::str::FromStr;
    let tiny = BigDecimal::from_str("1E-10").unwrap();
    let large = BigDecimal::from_str("1E+30").unwrap();
    let (total_realized, total, recovered) = pnl_totals(&BigDecimal::from(0), &tiny, Some(&large));
    assert_eq!(
        recovered.as_deref(),
        Some("1000000000000000000000000000000")
    );
    assert_eq!(total_realized, "1000000000000000000000000000000.0000000001");
    assert_eq!(total, total_realized);

    let (total_realized, total, recovered) = pnl_totals(&BigDecimal::from(0), &tiny, None);
    assert_eq!(total_realized, "0.0000000001");
    assert_eq!(total, "0.0000000001");
    assert_eq!(recovered, None);
}
