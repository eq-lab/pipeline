// spec: docs/exec-plans/active/issue-1433-stellar-loan-parsers-realignment.md#test-strategy
use shared::contract_logs_repo::LOAN_LIFECYCLE_EVENT_NAMES;

#[test]
fn loan_lifecycle_event_names_covers_every_stored_loan_event() {
    let expected = [
        "LoanDrawn",
        "LoanStatusUpdated",
        "LoanCCRUpdated",
        "LoanLocationUpdated",
        "LoanDefaulted",
        "LoanClosed",
        "PaymentRecorded",
        "PaymentUnrecorded",
        "LoanRolledOver",
        "EconomicsAmended",
        "Disbursed",
        "Undisbursed",
        "LoanWrittenDown",
        "InterestAdjusted",
    ];

    for name in expected {
        assert!(
            LOAN_LIFECYCLE_EVENT_NAMES.contains(&name),
            "LOAN_LIFECYCLE_EVENT_NAMES is missing '{name}'"
        );
    }
    assert_eq!(
        LOAN_LIFECYCLE_EVENT_NAMES.len(),
        expected.len(),
        "LOAN_LIFECYCLE_EVENT_NAMES has an unexpected extra entry"
    );
}

#[test]
fn loan_lifecycle_event_names_has_no_duplicates() {
    let mut sorted = LOAN_LIFECYCLE_EVENT_NAMES.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), LOAN_LIFECYCLE_EVENT_NAMES.len());
}
