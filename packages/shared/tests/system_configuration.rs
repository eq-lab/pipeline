// spec: docs/product-specs/deposits.md#lp-funding-details

use serde_json::json;
use shared::system_configuration_repo::{SystemBankDetails, SystemConfigurationType};

fn all_empty() -> serde_json::Value {
    json!({
        "company_name": "",
        "bank_name": "",
        "bank_address": "",
        "account_number": "",
        "iban": "",
        "swift_bic_code": ""
    })
}

#[test]
fn all_six_keys_deserialize() {
    let details: SystemBankDetails = serde_json::from_value(all_empty()).unwrap();
    assert_eq!(details.company_name, "");
    assert_eq!(details.swift_bic_code, "");
}

#[test]
fn an_extra_key_is_ignored() {
    let mut value = all_empty();
    value["extra"] = json!("x");
    assert!(serde_json::from_value::<SystemBankDetails>(value).is_ok());
}

#[test]
fn a_missing_key_is_an_error() {
    let mut value = all_empty();
    value.as_object_mut().unwrap().remove("iban");
    assert!(serde_json::from_value::<SystemBankDetails>(value).is_err());
}

#[test]
fn a_non_string_value_is_an_error() {
    let mut value = all_empty();
    value["iban"] = json!(123);
    assert!(serde_json::from_value::<SystemBankDetails>(value).is_err());
}

#[test]
fn the_type_spelling_matches_the_check_constraint() {
    assert_eq!(
        SystemConfigurationType::SystemBankDetails.as_str(),
        "system_bank_details"
    );
}
