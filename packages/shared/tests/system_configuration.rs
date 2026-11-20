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

fn configured() -> SystemBankDetails {
    SystemBankDetails {
        company_name: "Co".to_owned(),
        bank_name: "Bank".to_owned(),
        bank_address: "Addr".to_owned(),
        account_number: "1".to_owned(),
        iban: "2".to_owned(),
        swift_bic_code: "BIC".to_owned(),
    }
}

#[test]
fn the_seeded_all_empty_record_is_unconfigured() {
    let d: SystemBankDetails = serde_json::from_value(all_empty()).unwrap();
    assert_eq!(
        d.missing_required_fields(),
        [
            "company_name",
            "bank_name",
            "swift_bic_code",
            "account_number or iban"
        ]
    );
    assert!(!d.is_configured());
}

#[test]
fn whitespace_only_counts_as_blank() {
    let mut d = configured();
    d.company_name = "  \t".to_owned();
    assert_eq!(d.missing_required_fields(), ["company_name"]);
}

#[test]
fn a_record_without_bank_address_is_configured() {
    let mut d = configured();
    d.bank_address = String::new();
    assert!(d.is_configured());
}

#[test]
fn iban_alone_or_account_number_alone_is_enough() {
    let mut no_iban = configured();
    no_iban.iban = String::new();
    assert!(no_iban.is_configured());
    let mut no_account = configured();
    no_account.account_number = String::new();
    assert!(no_account.is_configured());
}

#[test]
fn both_account_number_and_iban_blank_is_reported_once() {
    let mut d = configured();
    d.account_number = String::new();
    d.iban = " ".to_owned();
    assert_eq!(d.missing_required_fields(), ["account_number or iban"]);
}

#[test]
fn each_required_field_blank_is_named() {
    for name in ["company_name", "bank_name", "swift_bic_code"] {
        let mut d = configured();
        match name {
            "company_name" => d.company_name.clear(),
            "bank_name" => d.bank_name.clear(),
            _ => d.swift_bic_code.clear(),
        }
        assert_eq!(d.missing_required_fields(), [name]);
    }
}
