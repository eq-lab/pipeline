// spec: docs/exec-plans/active/issue-1433-stellar-loan-parsers-realignment.md#test-strategy
use pipeline_worker::indexer::stellar::poller::is_loan_registry_event;

const STORED_LOAN_REGISTRY_EVENT_NAMES: &[&str] = &[
    "LoanDrawn",
    "LoanStatusUpdated",
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

#[test]
fn is_loan_registry_event_recognises_every_stored_name() {
    for name in STORED_LOAN_REGISTRY_EVENT_NAMES {
        assert!(
            is_loan_registry_event(name),
            "is_loan_registry_event is missing '{name}' — it would be stored with no snapshot"
        );
    }
}

#[test]
fn is_loan_registry_event_rejects_unrelated_names() {
    for name in [
        "AssetTransfer",
        "StakingDeposit",
        "WireIn",
        "WireInAssigned",
    ] {
        assert!(!is_loan_registry_event(name));
    }
}
