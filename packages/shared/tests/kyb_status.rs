//! The KYB write gate and transition table (Issues #1267, #1274). Pure — no DB.

use std::str::FromStr;

use shared::lp_repo::KybStatus;

#[test]
fn an_unsubmitted_lp_is_writable() {
    assert!(KybStatus::NotStarted.allows_owner_writes());
    assert!(KybStatus::InProgress.allows_owner_writes());
    assert!(KybStatus::ChangesRequested.allows_owner_writes());
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
fn a_failed_lp_is_terminal_and_frozen() {
    assert!(
        !KybStatus::Failed.allows_owner_writes(),
        "Failed is terminal (Issue #1274): the decision also suspends the \
         owning account, so the UNIQUE-owner_account_id argument for keeping \
         it writable no longer applies"
    );
}

#[test]
fn the_gate_is_total_over_every_stored_status() {
    for status in KybStatus::ALL {
        let parsed = KybStatus::from_str(status.as_str()).expect("a status the DB can hold");
        assert_eq!(parsed.as_str(), status.as_str());
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
            KybStatus::ChangesRequested
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
    assert!(
        !strs.contains(&KybStatus::Failed.as_str()),
        "Failed left OWNER_WRITABLE in Issue #1274 and must not silently return"
    );
}

#[test]
fn submit_is_allowed_only_from_not_started_and_changes_requested() {
    for status in KybStatus::ALL {
        let expected = matches!(status, KybStatus::NotStarted | KybStatus::ChangesRequested);
        assert_eq!(
            status.may_transition_to(KybStatus::UnderReview),
            expected,
            "{status} -> UnderReview must be {expected} — InProgress is writable \
             but not submittable, and that distinction is the whole point of \
             this test"
        );
    }
}

#[test]
fn a_verdict_is_reachable_only_from_under_review() {
    for status in KybStatus::ALL {
        for verdict in [
            KybStatus::Passed,
            KybStatus::ChangesRequested,
            KybStatus::Failed,
        ] {
            assert_eq!(
                status.may_transition_to(verdict),
                status == KybStatus::UnderReview,
                "{status} -> {verdict} must be reachable only from UnderReview"
            );
        }
    }
}

#[test]
fn no_status_transitions_to_itself() {
    for status in KybStatus::ALL {
        assert!(
            !status.may_transition_to(status),
            "{status} must not transition to itself"
        );
    }
}

#[test]
fn the_transition_table_is_total() {
    let legal: Vec<(KybStatus, KybStatus)> = KybStatus::ALL
        .into_iter()
        .flat_map(|from| KybStatus::ALL.into_iter().map(move |to| (from, to)))
        .filter(|(from, to)| from.may_transition_to(*to))
        .collect();
    assert_eq!(
        legal,
        vec![
            (KybStatus::NotStarted, KybStatus::UnderReview),
            (KybStatus::UnderReview, KybStatus::ChangesRequested),
            (KybStatus::UnderReview, KybStatus::Passed),
            (KybStatus::UnderReview, KybStatus::Failed),
            (KybStatus::ChangesRequested, KybStatus::UnderReview),
        ],
        "the transition table must be exactly the spec's six-row list — an \
         edit to it must be deliberate"
    );
}

#[test]
fn in_progress_is_a_legal_value_that_no_transition_produces_or_consumes() {
    for status in KybStatus::ALL {
        assert!(
            !status.may_transition_to(KybStatus::InProgress),
            "nothing transitions into InProgress"
        );
    }
    for to in KybStatus::ALL {
        assert!(
            !KybStatus::InProgress.may_transition_to(to),
            "InProgress transitions to nothing"
        );
    }
    assert!(
        KybStatus::InProgress.allows_owner_writes(),
        "InProgress is writable even though it is unreachable — no row has \
         ever held it, so nothing is stranded, and if one somehow did its \
         owner could still edit the record"
    );
}

#[test]
fn the_submittable_set_agrees_with_the_transition_table() {
    for status in KybStatus::ALL {
        assert_eq!(
            KybStatus::SUBMITTABLE.contains(&status),
            status.may_transition_to(KybStatus::UnderReview),
            "SUBMITTABLE and may_transition_to(UnderReview) are written \
             independently — one is bound into SQL, the other is the policy \
             statement — so nothing but this test keeps them from drifting"
        );
    }
}

#[test]
fn submittable_strs_matches_the_submittable_statuses() {
    let strs = KybStatus::submittable_strs();
    assert_eq!(strs.len(), KybStatus::SUBMITTABLE.len());
    for status in KybStatus::SUBMITTABLE {
        assert!(strs.contains(&status.as_str()));
    }
    assert!(
        !strs.contains(&KybStatus::InProgress.as_str()),
        "InProgress is writable but must not be bound into the submit query"
    );
}

#[test]
fn only_under_review_admits_a_document_review() {
    for status in KybStatus::ALL {
        assert_eq!(
            status.allows_document_review(),
            status == KybStatus::UnderReview,
            "{status}: allows_document_review must be independent of the \
             transition table and must not be derived from it"
        );
    }
}

#[test]
fn the_three_status_policies_are_independent() {
    assert!(
        !KybStatus::UnderReview.allows_owner_writes()
            && KybStatus::UnderReview.allows_document_review()
            && KybStatus::UnderReview.allows_address_write(false),
        "UnderReview freezes owner writes, admits document review, and admits \
         an address write — three different answers from one status"
    );
    assert!(
        KybStatus::ChangesRequested.allows_owner_writes()
            && !KybStatus::ChangesRequested.allows_document_review(),
        "ChangesRequested is the mirror: writes yes, review no"
    );
    assert!(
        !KybStatus::Failed.allows_owner_writes()
            && !KybStatus::Failed.allows_document_review()
            && !KybStatus::Failed.allows_address_write(false)
            && !KybStatus::Failed.allows_address_write(true),
        "Failed refuses all three, for independent reasons"
    );
}

#[test]
fn document_status_round_trips_every_stored_spelling_and_rejects_junk() {
    use shared::kyb_document_repo::DocumentStatus;

    for spelling in ["NotProvided", "Provided", "Verified", "Rejected"] {
        let parsed = DocumentStatus::from_str(spelling).expect("a status the DB can hold");
        assert_eq!(parsed.as_str(), spelling);
    }
    assert!(DocumentStatus::from_str("Bogus").is_err());
    assert!(DocumentStatus::from_str("").is_err());
}
