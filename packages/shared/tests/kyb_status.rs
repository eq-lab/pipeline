//! The KYB write gate (Issue #1267): which `kyb_status` values leave an LP's
//! record open to its owner. Pure — no DB.

use std::str::FromStr;

use shared::lp_repo::KybStatus;

#[test]
fn an_unsubmitted_lp_is_writable() {
    assert!(KybStatus::NotStarted.allows_owner_writes());
    assert!(KybStatus::InProgress.allows_owner_writes());
}

#[test]
fn review_and_approval_freeze_the_record() {
    assert!(
        !KybStatus::UnderReview.allows_owner_writes(),
        "an LP must not change its submission while it is being reviewed"
    );
    assert!(
        !KybStatus::Passed.allows_owner_writes(),
        "an approved entity must not be editable after the decision"
    );
}

#[test]
fn a_failed_lp_reopens() {
    assert!(
        KybStatus::Failed.allows_owner_writes(),
        "owner_account_id is UNIQUE, so a frozen Failed LP could never be fixed \
         and the account could never register another"
    );
}

#[test]
fn the_gate_is_total_over_every_stored_status() {
    for stored in [
        "NotStarted",
        "InProgress",
        "UnderReview",
        "Passed",
        "Failed",
    ] {
        let parsed = KybStatus::from_str(stored).expect("a status the DB can hold");
        assert_eq!(parsed.as_str(), stored);
    }
}
