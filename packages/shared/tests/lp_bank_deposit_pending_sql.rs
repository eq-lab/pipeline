// spec: docs/product-specs/trustee-attention-counts.md#data-model
use shared::lp_bank_deposit_repo::COUNT_PENDING_BANK_DEPOSITS_SQL;

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn pending_deposits_are_unminted_and_have_no_on_chain_wire_in() {
    let sql = flat(COUNT_PENDING_BANK_DEPOSITS_SQL);
    for needle in [
        "FROM lp_bank_deposits d",
        "NOT d.is_minted",
        "NOT EXISTS",
        "w.event_name = 'WireIn'",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in: {sql}");
    }
}

#[test]
fn any_wire_in_excludes_a_deposit_whether_escrowed_direct_or_returned() {
    let sql = flat(COUNT_PENDING_BANK_DEPOSITS_SQL);
    assert!(!sql.contains("WireInReturned"));
    assert!(!sql.contains("WireInAssigned"));
    assert!(!sql.contains("receiver"));
}

#[test]
fn the_ref_hash_match_uses_the_gin_containment_operator_without_decoding() {
    let sql = flat(COUNT_PENDING_BANK_DEPOSITS_SQL);
    assert!(sql.contains("w.params @> jsonb_build_object('ref_hash', encode(d.ref_hash, 'hex'))"));
    assert!(!sql.contains("decode("));
    assert!(!sql.contains("->>"));
}
