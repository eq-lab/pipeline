//! The settlement-address write gate (Issues #1379, #1274; spec §"Settlement
//! Address"): which `kyb_status` values leave a settlement address writable,
//! and the shape of the link SQL. Pure — no DB; the SQL is checked as text and
//! its behaviour is covered by the user-stories checklist.

use chrono::Utc;
use shared::chains::ChainKind;
use shared::lp_repo::{
    KybStatus, LpRow, CONSUME_LINK_CHALLENGE_SQL, FIND_LINK_CHALLENGE_SQL,
    ISSUE_OR_REUSE_LINK_CHALLENGE_SQL, LINK_EVM_ADDRESS_SQL, LINK_STELLAR_ADDRESS_SQL,
    LIST_SETTLEMENT_ADDRESS_HISTORY_SQL,
};
use uuid::Uuid;

#[test]
fn every_status_but_failed_allows_a_link_or_relink() {
    fn expected(status: KybStatus) -> bool {
        match status {
            KybStatus::Failed => false,
            KybStatus::NotStarted
            | KybStatus::InProgress
            | KybStatus::UnderReview
            | KybStatus::ChangesRequested
            | KybStatus::Passed => true,
        }
    }

    for status in KybStatus::ALL {
        assert_eq!(status.allows_address_write(), expected(status), "{status}");
    }
}

#[test]
fn passed_allows_a_relink() {
    assert!(
        KybStatus::Passed.allows_address_write(),
        "user decision 2026-11-02 (#1831): a Passed LP may relink"
    );
    assert!(!KybStatus::Failed.allows_address_write());
}

#[test]
fn the_policy_is_independent_of_the_write_freeze() {
    assert!(
        KybStatus::UnderReview.allows_address_write()
            && !KybStatus::UnderReview.allows_owner_writes()
    );
    assert!(KybStatus::Passed.allows_address_write() && !KybStatus::Passed.allows_owner_writes());
    assert!(!KybStatus::Failed.allows_address_write() && !KybStatus::Failed.allows_owner_writes());
}

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

struct Kind {
    sql: &'static str,
    name: &'static str,
    addr: &'static str,
    signer: &'static str,
    linked_at: &'static str,
    other: &'static str,
}

const KINDS: [Kind; 2] = [
    Kind {
        sql: LINK_STELLAR_ADDRESS_SQL,
        name: "stellar",
        addr: "stellar_address",
        signer: "stellar_signer_address",
        linked_at: "address_linked_at",
        other: "evm_",
    },
    Kind {
        sql: LINK_EVM_ADDRESS_SQL,
        name: "evm",
        addr: "evm_address",
        signer: "evm_signer_address",
        linked_at: "evm_address_linked_at",
        other: "stellar_",
    },
];

#[test]
fn the_link_sql_writes_its_own_columns_guards_only_failed_and_records_history() {
    for k in KINDS {
        let sql = flat(k.sql);
        let set = format!(
            "SET {} = $2, {} = $3, {} = now()",
            k.addr, k.signer, k.linked_at
        );
        assert!(sql.contains(&set), "{}", k.name);
        assert!(sql.contains("lps.kyb_status <> 'Failed'"));
        assert!(!sql.contains("kyb_status <> 'Passed'"));
        assert!(!sql.contains("IS NULL OR"));
        assert!(sql.contains("FOR UPDATE"));
        let insert = sql
            .find("INSERT INTO lp_settlement_address_history")
            .expect("history insert");
        let from = sql.find("FROM linked").expect("reads the update");
        let ret = sql.rfind("RETURNING id").expect("returns the id");
        assert!(insert < from && from < ret);
        assert!(sql.contains(&format!("SELECT id, '{}', $4, $2, $3,", k.name)));
        assert!(sql.contains(&format!("prev.{} AS previous_address", k.addr)));
        assert!(sql.contains(&format!("prev.{} AS previous_signer_address", k.signer)));
        assert!(sql.contains(
            "(lp_id, chain_kind, chain_id, address, signer_address, previous_address, \
previous_signer_address, linked_by_account_id, created_at)"
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .as_str()
        ));
        assert!(sql.contains("previous_signer_address, $5, linked_at"));
        assert!(!sql.contains(k.other), "{}", k.name);
    }
}

#[test]
fn the_link_is_one_statement() {
    for k in KINDS {
        let sql = flat(k.sql);
        assert_eq!(sql.matches("INSERT").count(), 1, "{}", k.name);
        assert_eq!(sql.matches("UPDATE lps").count(), 1, "{}", k.name);
        assert!(!sql.contains(';'), "{}", k.name);
    }
}

#[test]
fn history_is_listed_newest_first_for_one_lp() {
    let sql = flat(LIST_SETTLEMENT_ADDRESS_HISTORY_SQL);
    assert!(sql.contains("FROM lp_settlement_address_history WHERE lp_id = $1"));
    assert!(sql.ends_with("ORDER BY created_at DESC, id DESC"));
}

#[test]
fn history_is_append_only_in_code() {
    let src = include_str!("../src/lp_repo.rs");
    assert!(!src.contains("UPDATE lp_settlement_address_history"));
    assert!(!src.contains("DELETE FROM lp_settlement_address_history"));
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
