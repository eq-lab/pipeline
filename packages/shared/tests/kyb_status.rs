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

#[test]
fn the_writable_set_is_exactly_the_three_open_statuses() {
    // `OWNER_WRITABLE` is bound into the SQL predicate that actually enforces
    // the freeze, so this pins the policy against the literal expected set
    // rather than against `allows_owner_writes` — which now answers *from*
    // this const, and would agree with any mistake made here.
    assert_eq!(
        KybStatus::OWNER_WRITABLE,
        [
            KybStatus::NotStarted,
            KybStatus::InProgress,
            KybStatus::Failed
        ],
        "changing which statuses accept owner writes changes what a reviewer \
         can rely on mid-review — make that change deliberately"
    );
}

#[test]
fn the_writable_strings_are_exactly_the_writable_statuses() {
    let strs = KybStatus::owner_writable_strs();
    assert_eq!(strs.len(), KybStatus::OWNER_WRITABLE.len());
    for status in KybStatus::OWNER_WRITABLE {
        assert!(
            strs.contains(&status.as_str()),
            "{status} missing from the strings bound into SQL"
        );
    }
    assert!(!strs.contains(&KybStatus::UnderReview.as_str()));
    assert!(!strs.contains(&KybStatus::Passed.as_str()));
}
