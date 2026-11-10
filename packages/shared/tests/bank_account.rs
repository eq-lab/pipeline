// spec: docs/product-specs/kyb-lp-verification.md#settlement-bank-account

use shared::bank_account::{
    account_last4, normalize, SettlementBankAccount, SettlementBankAccountInput,
};

fn input() -> SettlementBankAccountInput {
    SettlementBankAccountInput {
        account_holder_name: Some("Acme Trading Ltd".to_owned()),
        bank_name: Some("Example Bank".to_owned()),
        bank_address: None,
        account_number: Some("12345678".to_owned()),
        iban: None,
        swift_bic_code: Some("WESTGB2L".to_owned()),
        routing_number: None,
    }
}

fn field_of(
    r: Result<SettlementBankAccount, shared::bank_account::BankAccountError>,
) -> &'static str {
    r.expect_err("a rejection").field
}

#[test]
fn fields_are_trimmed_and_blank_optionals_become_none() {
    let mut i = input();
    i.account_holder_name = Some("  Acme Trading Ltd  ".to_owned());
    i.bank_address = Some("   ".to_owned());
    i.iban = Some(String::new());
    let a = normalize(&i).unwrap();
    assert_eq!(a.account_holder_name, "Acme Trading Ltd");
    assert_eq!(a.bank_address, None);
    assert_eq!(a.iban, None);
}

#[test]
fn iban_spaces_are_stripped_and_letters_uppercased() {
    let mut i = input();
    i.account_number = None;
    i.iban = Some("gb82 west 1234 5698 7654 32".to_owned());
    assert_eq!(
        normalize(&i).unwrap().iban.as_deref(),
        Some("GB82WEST12345698765432")
    );
}

#[test]
fn valid_ibans_pass_and_a_changed_digit_fails_mod97() {
    for good in ["GB82 WEST 1234 5698 7654 32", "DE89370400440532013000"] {
        let mut i = input();
        i.iban = Some(good.to_owned());
        assert!(normalize(&i).is_ok(), "{good}");
    }
    let mut i = input();
    i.iban = Some("GB82WEST12345698765433".to_owned());
    assert_eq!(field_of(normalize(&i)), "iban");
}

#[test]
fn an_iban_of_the_wrong_shape_fails() {
    for bad in ["GB82", "1282WEST12345698765432", "GB82WEST1234569876543!"] {
        let mut i = input();
        i.iban = Some(bad.to_owned());
        assert_eq!(field_of(normalize(&i)), "iban", "{bad}");
    }
}

#[test]
fn the_bic_accepts_8_and_11_characters_only() {
    for (bic, ok) in [
        ("WESTGB2L", true),
        ("westgb2l", true),
        ("WESTGB2LXXX", true),
        ("WESTGB2LX", false),
        ("WESTGB2LXX", false),
        ("WEST1B2L", false),
        ("WESTGB2", false),
    ] {
        let mut i = input();
        i.swift_bic_code = Some(bic.to_owned());
        assert_eq!(normalize(&i).is_ok(), ok, "{bic}");
    }
}

#[test]
fn the_aba_routing_number_is_checksummed() {
    let mut i = input();
    i.swift_bic_code = None;
    i.routing_number = Some("021000021".to_owned());
    assert!(normalize(&i).is_ok());
    i.routing_number = Some("021000022".to_owned());
    assert_eq!(field_of(normalize(&i)), "routing_number");
    i.routing_number = Some("02100002".to_owned());
    assert_eq!(field_of(normalize(&i)), "routing_number");
}

#[test]
fn an_identifier_and_a_routing_route_are_each_required() {
    let mut i = input();
    i.account_number = None;
    assert_eq!(field_of(normalize(&i)), "account_number");
    let mut i = input();
    i.swift_bic_code = None;
    assert_eq!(field_of(normalize(&i)), "swift_bic_code");
}

#[test]
fn the_name_and_bank_are_required() {
    let mut i = input();
    i.account_holder_name = Some("  ".to_owned());
    assert_eq!(field_of(normalize(&i)), "account_holder_name");
    let mut i = input();
    i.bank_name = None;
    assert_eq!(field_of(normalize(&i)), "bank_name");
}

#[test]
fn length_limits_count_characters_not_bytes() {
    let mut i = input();
    i.account_holder_name = Some("Ж".repeat(140));
    assert!(normalize(&i).is_ok());
    i.account_holder_name = Some("Ж".repeat(141));
    assert_eq!(field_of(normalize(&i)), "account_holder_name");
    let mut i = input();
    i.bank_address = Some("é".repeat(280));
    assert!(normalize(&i).is_ok());
    i.bank_address = Some("é".repeat(281));
    assert_eq!(field_of(normalize(&i)), "bank_address");
}

#[test]
fn an_error_never_contains_the_submitted_value() {
    let mut i = input();
    i.iban = Some("GB82WEST12345698765433".to_owned());
    let msg = normalize(&i).unwrap_err().to_string();
    assert!(msg.contains("iban"));
    assert!(!msg.contains("98765433"));
    assert!(!msg.contains("WEST1234"));
}

#[test]
fn debug_redacts_every_account_identifier() {
    let mut i = input();
    i.iban = Some("GB82WEST12345698765432".to_owned());
    i.swift_bic_code = None;
    i.routing_number = Some("021000021".to_owned());
    let a = normalize(&i).unwrap();
    let dbg = format!("{a:?}");
    for secret in ["12345678", "GB82WEST", "98765432", "021000021"] {
        assert!(!dbg.contains(secret), "{secret} leaked in {dbg}");
    }
    assert!(dbg.contains("Example Bank"));
}

#[test]
fn input_debug_never_prints_values() {
    let dbg = format!("{:?}", input());
    assert!(!dbg.contains("12345678"));
}

fn account(iban: Option<&str>, number: Option<&str>) -> SettlementBankAccount {
    SettlementBankAccount {
        account_holder_name: "A".to_owned(),
        bank_name: "B".to_owned(),
        bank_address: None,
        account_number: number.map(str::to_owned),
        iban: iban.map(str::to_owned),
        swift_bic_code: None,
        routing_number: None,
    }
}

#[test]
fn last4_prefers_the_iban_over_the_account_number() {
    let a = account(Some("GB82WEST12345698765432"), Some("12345678"));
    assert_eq!(account_last4(&a).as_deref(), Some("5432"));
    assert_eq!(
        account_last4(&account(None, Some("12345678"))).as_deref(),
        Some("5678")
    );
}

#[test]
fn last4_is_none_when_the_identifier_has_four_or_fewer_characters() {
    assert_eq!(account_last4(&account(None, Some("1234"))), None);
    assert_eq!(account_last4(&account(None, Some("12"))), None);
    assert_eq!(
        account_last4(&account(None, Some("12345"))).as_deref(),
        Some("2345")
    );
    assert_eq!(account_last4(&account(None, None)), None);
}

#[test]
fn last4_ignores_spaces_and_case() {
    assert_eq!(
        account_last4(&account(None, Some("ab 12 cd 34"))).as_deref(),
        Some("CD34")
    );
}

#[test]
fn none_serializes_as_null_and_round_trips() {
    let a = normalize(&input()).unwrap();
    let v = serde_json::to_value(&a).unwrap();
    for key in ["bank_address", "iban", "routing_number"] {
        assert_eq!(v.get(key), Some(&serde_json::Value::Null), "{key}");
    }
    let back: SettlementBankAccount = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(back, a);
    assert_eq!(serde_json::to_value(&back).unwrap(), v);
}

#[test]
fn unknown_input_fields_are_rejected() {
    let r: Result<SettlementBankAccountInput, _> =
        serde_json::from_value(serde_json::json!({"bank_name": "B", "swift": "x"}));
    assert!(r.is_err());
}
