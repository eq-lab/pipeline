//! Unit tests for `BankTransactionType`'s string round-trip. Pure — no DB.

use shared::bank_transaction_repo::BankTransactionType;

#[test]
fn as_str_matches_the_db_check_constraint_values() {
    assert_eq!(BankTransactionType::Deposit.as_str(), "Deposit");
    assert_eq!(BankTransactionType::Withdrawal.as_str(), "Withdrawal");
    assert_eq!(BankTransactionType::Fee.as_str(), "Fee");
}

#[test]
fn try_from_round_trips_every_variant() {
    for variant in [
        BankTransactionType::Deposit,
        BankTransactionType::Withdrawal,
        BankTransactionType::Fee,
    ] {
        let s = variant.as_str().to_owned();
        let parsed = BankTransactionType::try_from(s).expect("valid variant string parses");
        assert_eq!(parsed.as_str(), variant.as_str());
    }
}

#[test]
fn try_from_rejects_unknown_string() {
    let err = BankTransactionType::try_from("Transfer".to_owned()).unwrap_err();
    assert!(format!("{err}").contains("Transfer"));
}
