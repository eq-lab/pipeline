// spec: docs/product-specs/deposits.md#wire-matching-by-payment-reference

use shared::lp_bank_deposit_repo::{INSERT_SQL, LIST_FOR_LP_SQL};
use shared::lp_requested_bank_details_repo::FIND_BY_PAYMENT_DETAILS_SQL;

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn list_and_insert_left_join_the_issued_reference() {
    for sql in [LIST_FOR_LP_SQL, INSERT_SQL] {
        let sql = flat(sql);
        assert!(
            sql.contains(
                "LEFT JOIN lp_requested_bank_details r ON r.id = d.requested_bank_details_id"
            ),
            "{sql}"
        );
        assert!(sql.contains("r.payment_details AS matched_payment_details"));
    }
}

#[test]
fn the_list_keeps_its_order() {
    assert!(flat(LIST_FOR_LP_SQL).ends_with("ORDER BY d.occurred_at DESC, d.id DESC"));
}

#[test]
fn the_insert_writes_the_link_and_returns_through_a_cte() {
    let sql = flat(INSERT_SQL);
    assert!(sql.starts_with("WITH d AS ( INSERT INTO lp_bank_deposits"));
    assert!(
        sql.contains("requested_bank_details_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *")
    );
}

#[test]
fn the_lookup_is_an_exact_match_on_the_unique_index() {
    let sql = flat(FIND_BY_PAYMENT_DETAILS_SQL);
    assert!(sql.ends_with("WHERE payment_details = $1"), "{sql}");
    assert!(!sql.contains("replace(") && !sql.contains("upper("));
}
