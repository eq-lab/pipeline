//! The settlement-address write gate (Issue #1379; spec §"Settlement
//! Address"): which `kyb_status` values leave `stellar_address` writable. Pure
//! — no DB, and the SQL predicate in `LpRepo::link_address` is not exercised
//! here; see the exec plan's manual checklist for that.

use shared::lp_repo::KybStatus;

const NON_TERMINAL: [KybStatus; 3] = [
    KybStatus::NotStarted,
    KybStatus::InProgress,
    KybStatus::UnderReview,
];

#[test]
fn an_unlinked_lp_may_set_an_address_at_any_non_terminal_status() {
    for status in NON_TERMINAL {
        assert!(
            status.allows_address_write(false),
            "{status} must allow a first address write; if this fails the gate came back"
        );
    }
}

#[test]
fn a_linked_address_may_be_replaced_until_the_decision_is_final() {
    for status in NON_TERMINAL {
        assert!(
            status.allows_address_write(true),
            "{status} must allow replacing an already-linked address"
        );
    }
}

#[test]
fn the_two_terminal_statuses_close_the_address_differently() {
    assert!(
        !KybStatus::Passed.allows_address_write(true),
        "a Passed LP's address is fixed once it holds one"
    );
    assert!(
        KybStatus::Passed.allows_address_write(false),
        "a Passed LP with no address must not be locked out forever — it has \
         a real, ongoing use for the field"
    );
    assert!(
        !KybStatus::Failed.allows_address_write(true),
        "a Failed LP with an address must stay refused: left writable it \
         could burn a real LP's address through the UNIQUE column"
    );
    assert!(
        !KybStatus::Failed.allows_address_write(false),
        "a Failed LP with no address must still be refused on its first \
         attempt — the Failed exclusion in LpRepo::link_address's WHERE must \
         sit outside the `stellar_address IS NULL` disjunction, not inside it"
    );
}

#[test]
fn the_policy_is_total_and_classifies_every_status_deliberately() {
    fn expected(status: KybStatus, has_address: bool) -> bool {
        match status {
            KybStatus::Failed => false,
            KybStatus::Passed => !has_address,
            KybStatus::NotStarted | KybStatus::InProgress | KybStatus::UnderReview => true,
        }
    }

    for status in [
        KybStatus::NotStarted,
        KybStatus::InProgress,
        KybStatus::UnderReview,
        KybStatus::Passed,
        KybStatus::Failed,
    ] {
        for has_address in [false, true] {
            assert_eq!(
                status.allows_address_write(has_address),
                expected(status, has_address),
                "{status} with has_address={has_address} must match the \
                 deliberate classification in `expected` — when a new status \
                 is added, this match must stop compiling until it is \
                 classified on purpose"
            );
        }
    }
}

#[test]
fn the_policy_is_independent_of_the_write_freeze() {
    assert!(
        KybStatus::UnderReview.allows_address_write(false)
            && !KybStatus::UnderReview.allows_owner_writes(),
        "the settlement address is exempt from the freeze at UnderReview"
    );
    assert!(
        !KybStatus::Failed.allows_address_write(true) && KybStatus::Failed.allows_owner_writes(),
        "Failed is the reverse crossing: the profile reopens while the \
         address stays closed"
    );
}
