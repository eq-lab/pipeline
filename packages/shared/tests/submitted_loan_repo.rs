// spec: docs/product-specs/api-authorization-loan-submission.md

use bigdecimal::BigDecimal;
use shared::submitted_loan_repo::{
    classify_unlinked_draw, LinkCandidate, LinkOutcome, FIND_SUBMISSION_SQL, INSERT_SUBMISSION_SQL,
    LINK_DRAWN_SQL, LIST_SUBMISSIONS_SQL, RESUBMIT_SQL, UNLINKED_DRAW_CANDIDATES_SQL,
};
use std::str::FromStr;

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn cand(id: i64, target: i64, chain: Option<i64>, loan: Option<&str>) -> LinkCandidate {
    LinkCandidate {
        id,
        target_chain_id: target,
        chain_id: chain,
        loan_id: loan.map(|l| BigDecimal::from_str(l).unwrap()),
    }
}

fn loan(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

// ── SQL text ──

#[test]
fn link_drawn_sql_routes_by_target_chain_and_guards_duplicates() {
    let sql = flat(LINK_DRAWN_SQL);
    assert!(sql.contains("target_chain_id = $2"));
    assert!(sql.contains("loan_id IS NULL"));
    assert!(sql.contains(
        "NOT EXISTS (SELECT 1 FROM submitted_loans o WHERE o.chain_id = $2 AND o.loan_id = $3)"
    ));
    assert!(sql.contains("RETURNING id"));
}

#[test]
fn list_sql_filters_optionally_and_never_restricts_to_configured_chains() {
    let sql = flat(LIST_SUBMISSIONS_SQL);
    assert!(sql.contains("($1::text IS NULL OR status = $1)"));
    assert!(sql.contains("($2::bigint IS NULL OR target_chain_id = $2)"));
    assert!(sql.contains("ORDER BY created_at DESC, id DESC"));
    assert!(!sql.contains("ANY("));
}

#[test]
fn insert_sql_writes_target_chain() {
    let sql = flat(INSERT_SUBMISSION_SQL);
    assert!(sql.contains("(loan_data, originator, target_chain_id) VALUES ($1, $2, $3)"));
}

#[test]
fn select_sqls_project_target_chain() {
    assert!(LIST_SUBMISSIONS_SQL.contains("target_chain_id"));
    assert!(FIND_SUBMISSION_SQL.contains("target_chain_id"));
}

#[test]
fn resubmit_sql_keeps_target_chain() {
    assert!(!RESUBMIT_SQL.contains("target_chain_id"));
    assert!(flat(RESUBMIT_SQL).contains("status = 'ChangesRequested'"));
}

#[test]
fn candidates_sql_has_both_disjuncts() {
    let sql = flat(UNLINKED_DRAW_CANDIDATES_SQL);
    assert!(sql.contains("(chain_id = $2 AND loan_id = $3)"));
    assert!(sql.contains("(loan_data->>'metadata_uri' = $1 AND loan_id IS NULL)"));
}

// ── classify_unlinked_draw ──

#[test]
fn no_candidates_is_no_submission() {
    assert_eq!(
        classify_unlinked_draw(&[], 1, &loan("7")),
        LinkOutcome::NoSubmission
    );
}

#[test]
fn row_linked_to_same_loan_is_already_linked() {
    let c = [cand(5, 1, Some(1), Some("7"))];
    assert_eq!(
        classify_unlinked_draw(&c, 1, &loan("7")),
        LinkOutcome::AlreadyLinked { submission_id: 5 }
    );
}

#[test]
fn open_row_on_other_chain_is_target_mismatch() {
    let c = [cand(9, 2, None, None)];
    assert_eq!(
        classify_unlinked_draw(&c, 1, &loan("7")),
        LinkOutcome::TargetMismatch {
            submission_id: 9,
            target_chain_id: 2
        }
    );
}

#[test]
fn linked_plus_open_on_draw_chain_is_conflict() {
    let c = [cand(5, 1, Some(1), Some("7")), cand(9, 1, None, None)];
    assert_eq!(
        classify_unlinked_draw(&c, 1, &loan("7")),
        LinkOutcome::Conflict {
            linked_submission_id: 5,
            candidate_submission_id: 9
        }
    );
}

#[test]
fn linked_plus_open_on_other_chain_is_already_linked() {
    let c = [cand(5, 1, Some(1), Some("7")), cand(9, 2, None, None)];
    assert_eq!(
        classify_unlinked_draw(&c, 1, &loan("7")),
        LinkOutcome::AlreadyLinked { submission_id: 5 }
    );
}

#[test]
fn open_row_on_draw_chain_without_link_is_conflict() {
    let c = [cand(9, 1, None, None)];
    assert_eq!(
        classify_unlinked_draw(&c, 1, &loan("7")),
        LinkOutcome::Conflict {
            linked_submission_id: 9,
            candidate_submission_id: 9
        }
    );
}

#[test]
fn linked_row_with_different_loan_is_ignored() {
    let huge = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    let c = [cand(5, 1, Some(1), Some(huge))];
    assert_eq!(
        classify_unlinked_draw(&c, 1, &loan("7")),
        LinkOutcome::NoSubmission
    );
    assert_eq!(
        classify_unlinked_draw(&c, 1, &loan(huge)),
        LinkOutcome::AlreadyLinked { submission_id: 5 }
    );
}

#[test]
fn linked_row_on_other_chain_is_ignored() {
    let c = [cand(5, 2, Some(2), Some("7"))];
    assert_eq!(
        classify_unlinked_draw(&c, 1, &loan("7")),
        LinkOutcome::NoSubmission
    );
}

#[test]
fn is_unexpected_truth_table() {
    assert!(!LinkOutcome::Linked { submission_id: 1 }.is_unexpected());
    assert!(!LinkOutcome::NoSubmission.is_unexpected());
    assert!(!LinkOutcome::AlreadyLinked { submission_id: 1 }.is_unexpected());
    assert!(LinkOutcome::TargetMismatch {
        submission_id: 1,
        target_chain_id: 2
    }
    .is_unexpected());
    assert!(LinkOutcome::Conflict {
        linked_submission_id: 1,
        candidate_submission_id: 2
    }
    .is_unexpected());
}
