//! The settlement-address write gate (Issues #1379, #1274; spec §"Settlement
//! Address"): which `kyb_status` values leave a settlement address writable,
//! and the shape of the link SQL. Pure — no DB; the SQL is checked as text and
//! its behaviour is covered by the user-stories checklist.

use chrono::Utc;
use shared::chains::ChainKind;
use shared::lp_repo::{
    KybStatus, LpRow, CONSUME_LINK_CHALLENGE_SQL, FIND_LINK_CHALLENGE_SQL,
    ISSUE_OR_REUSE_LINK_CHALLENGE_SQL, LINK_EVM_ADDRESS_SQL, LINK_STELLAR_ADDRESS_SQL,
};
use uuid::Uuid;

const NON_TERMINAL: [KybStatus; 4] = [
    KybStatus::NotStarted,
    KybStatus::InProgress,
    KybStatus::UnderReview,
    KybStatus::ChangesRequested,
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
            KybStatus::NotStarted
            | KybStatus::InProgress
            | KybStatus::UnderReview
            | KybStatus::ChangesRequested => true,
        }
    }

    for status in KybStatus::ALL {
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
        KybStatus::Passed.allows_address_write(false) && !KybStatus::Passed.allows_owner_writes(),
        "the crossing that survives Issue #1274: Passed with no address yet \
         still allows one address write while the profile stays frozen"
    );
    assert!(
        !KybStatus::Failed.allows_address_write(true) && !KybStatus::Failed.allows_owner_writes(),
        "Failed now closes both policies, for independent reasons — after \
         Issue #1274 owner-writable implies address-writable, so the \
         containment between the two policies is one-directional rather than \
         a two-way crossing"
    );
}

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

const GUARD_TAIL: &str = "kyb_status <> 'Failed' AND (";

#[test]
fn the_stellar_link_sql_writes_its_own_columns_and_keeps_the_status_guard() {
    let sql = flat(LINK_STELLAR_ADDRESS_SQL);
    assert!(sql.contains(
        "SET stellar_address = $2, stellar_signer_address = $3, address_linked_at = now()"
    ));
    assert!(sql.contains(&format!(
        "{GUARD_TAIL}stellar_address IS NULL OR kyb_status <> 'Passed')"
    )));
    assert!(!sql.contains("evm_"));
}

#[test]
fn the_evm_link_sql_writes_its_own_columns_and_keeps_the_status_guard() {
    let sql = flat(LINK_EVM_ADDRESS_SQL);
    assert!(sql
        .contains("SET evm_address = $2, evm_signer_address = $3, evm_address_linked_at = now()"));
    assert!(sql.contains(&format!(
        "{GUARD_TAIL}evm_address IS NULL OR kyb_status <> 'Passed')"
    )));
    assert!(!sql.contains("stellar_"));
}

#[test]
fn consume_is_one_guarded_delete_returning_the_binding() {
    let sql = flat(CONSUME_LINK_CHALLENGE_SQL);
    assert!(sql.starts_with("DELETE FROM lp_address_challenges WHERE"));
    for guard in [
        "lp_id = $1",
        "chain_id = $2",
        "nonce = $3",
        "expires_at > now()",
    ] {
        assert!(sql.contains(guard), "missing {guard}");
    }
    assert!(sql.contains("RETURNING address, signer_address"));
}

#[test]
fn find_only_reads_a_live_challenge() {
    let sql = flat(FIND_LINK_CHALLENGE_SQL);
    assert!(sql.starts_with(
        "SELECT address, signer_address, nonce, expires_at FROM lp_address_challenges"
    ));
    assert!(sql.contains("expires_at > now()"));
}

#[test]
fn issue_or_reuse_is_one_upsert_on_the_database_clock() {
    let sql = flat(ISSUE_OR_REUSE_LINK_CHALLENGE_SQL);
    assert!(sql.starts_with("INSERT INTO lp_address_challenges"));
    assert!(sql.contains("ON CONFLICT (lp_id, chain_id) DO UPDATE"));
    let reuse = "lp_address_challenges.address = EXCLUDED.address \
        AND lp_address_challenges.signer_address = EXCLUDED.signer_address \
        AND lp_address_challenges.expires_at > now() + make_interval(secs => $7::double precision)";
    let reuse = flat(reuse);
    assert_eq!(sql.matches(&reuse).count(), 2);
    assert!(sql.contains("RETURNING nonce, expires_at"));
    assert!(!sql.contains("$8"));
    assert!(sql.contains("now() + make_interval(secs => $6::double precision)"));
}

fn lp(stellar: Option<&str>, evm: Option<&str>) -> LpRow {
    LpRow {
        id: 1,
        legal_name: "Acme".to_owned(),
        country: None,
        contact_email: "a@b.c".to_owned(),
        stellar_address: stellar.map(str::to_owned),
        address_linked_at: None,
        stellar_signer_address: None,
        evm_address: evm.map(str::to_owned),
        evm_signer_address: None,
        evm_address_linked_at: None,
        kyb_status: "NotStarted".to_owned(),
        kyb_submitted_at: None,
        kyb_decided_by: None,
        kyb_decided_at: None,
        kyb_decision_reason: None,
        notify_on_review: false,
        owner_account_id: Uuid::nil(),
        owner_chain_id: None,
        owner_address: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

#[test]
fn settlement_address_returns_the_slot_of_the_kind() {
    let row = lp(Some("GSTELLAR"), Some("0xevm"));
    assert_eq!(row.settlement_address(ChainKind::Stellar), Some("GSTELLAR"));
    assert_eq!(row.settlement_address(ChainKind::Evm), Some("0xevm"));
    let only_stellar = lp(Some("GSTELLAR"), None);
    assert_eq!(only_stellar.settlement_address(ChainKind::Evm), None);
}
