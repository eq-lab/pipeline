// spec: docs/exec-plans/active/issue-1523-loanbook-readers-params-event.md#test-strategy
use serde_json::json;
use shared::contract_logs_repo::EconomicsEventRow;
use shared::loan_event_params::json_i64;

#[test]
fn json_i64_accepts_number_string_and_u64_that_fits() {
    assert_eq!(json_i64(&json!(50_000)), Some(50_000));
    assert_eq!(json_i64(&json!("1900000000")), Some(1_900_000_000));
    assert_eq!(json_i64(&json!(i64::MAX as u64)), Some(i64::MAX));
}

#[test]
fn json_i64_rejects_non_numeric_out_of_range_and_null() {
    assert_eq!(json_i64(&json!("abc")), None);
    assert_eq!(json_i64(&json!(i64::MAX as u64 + 1)), None);
    assert_eq!(json_i64(&json!(null)), None);
}

#[test]
fn from_event_json_defaults_missing_fields_to_zero() {
    let none = EconomicsEventRow::from_event_json("LoanRolledOver".to_owned(), None, 7);
    assert_eq!((none.new_rate, none.new_maturity_timestamp), (0, 0));
    assert_eq!(none.block_timestamp, 7);

    let empty = json!({});
    let row = EconomicsEventRow::from_event_json("EconomicsAmended".to_owned(), Some(&empty), 7);
    assert_eq!((row.new_rate, row.new_maturity_timestamp), (0, 0));
}

#[test]
fn from_event_json_decodes_number_and_string_encodings() {
    let evm = json!({"new_rate": 50_000, "new_maturity_timestamp": 1_900_000_000_u64});
    let stellar = json!({"new_rate": 50_000, "new_maturity_timestamp": "1900000000"});
    for ev in [&evm, &stellar] {
        let row = EconomicsEventRow::from_event_json("LoanRolledOver".to_owned(), Some(ev), 1);
        assert_eq!(row.new_rate, 50_000);
        assert_eq!(row.new_maturity_timestamp, 1_900_000_000);
    }
}
