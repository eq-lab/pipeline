// spec: docs/references/backend.md#stellar-pocket-indexing
use bigdecimal::BigDecimal;
use serde_json::{json, Value};
use shared::pocket::{fold_pocket, fold_pockets, PocketEventRow, PocketSeedRow};

fn dec(v: i64) -> BigDecimal {
    BigDecimal::from(v)
}

fn ev(loan: i64, name: &str, block: i64, idx: i64, params: Value) -> PocketEventRow {
    PocketEventRow {
        loan_id: dec(loan),
        event_name: name.to_owned(),
        block_number: block,
        log_index: idx,
        block_timestamp: 1_790_000_000 + block,
        params,
    }
}

fn opened(loan: i64, block: i64, amount: i64, supply: i64) -> PocketEventRow {
    ev(
        loan,
        "PocketOpened",
        block,
        0,
        json!({
            "loan_id": loan.to_string(),
            "amount": amount.to_string(),
            "snapshot_ledger": block.to_string(),
            "supply_at_snapshot": supply.to_string(),
        }),
    )
}

fn released(loan: i64, block: i64, principal: i64, released: i64, interest: i64) -> PocketEventRow {
    ev(
        loan,
        "PocketReleased",
        block,
        0,
        json!({
            "loan_id": loan.to_string(),
            "principal": principal.to_string(),
            "released": released.to_string(),
            "interest": interest.to_string(),
        }),
    )
}

fn unreleased(loan: i64, block: i64, principal: i64, interest: i64) -> PocketEventRow {
    ev(
        loan,
        "PocketUnreleased",
        block,
        0,
        json!({
            "loan_id": loan.to_string(),
            "principal": principal.to_string(),
            "interest": interest.to_string(),
        }),
    )
}

fn burned(loan: i64, block: i64, amount: i64, burned: i64) -> PocketEventRow {
    ev(
        loan,
        "PocketBurned",
        block,
        0,
        json!({
            "loan_id": loan.to_string(),
            "amount": amount.to_string(),
            "burned": burned.to_string(),
        }),
    )
}

fn claimed(loan: i64, block: i64, idx: i64, paid: i64) -> PocketEventRow {
    ev(
        loan,
        "PocketClaimed",
        block,
        idx,
        json!({
            "loan_id": loan.to_string(),
            "holder": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
            "paid": paid.to_string(),
            "paid_zero": paid == 0,
        }),
    )
}

fn seed(loan: i64, as_of: i64) -> PocketSeedRow {
    PocketSeedRow {
        loan_id: dec(loan),
        as_of_ledger: as_of,
        snapshot_ledger: 150,
        supply_at_snapshot: dec(1_000),
        held: dec(300),
        released_total: dec(100),
        burned_total: dec(20),
        claimed_total: dec(40),
    }
}

#[test]
fn default_opens_the_pocket() {
    let fold = fold_pocket(&[opened(1, 200, 500, 1_000)], None).unwrap();
    assert_eq!(fold.held, dec(500));
    assert_eq!(fold.opened, Some(dec(500)));
    assert_eq!(fold.snapshot_ledger, 200);
    assert_eq!(fold.supply_at_snapshot, dec(1_000));
    assert_eq!(fold.released_total, dec(0));
    assert_eq!(fold.burned_total, dec(0));
    assert_eq!(fold.claimed_total, dec(0));
    assert!(fold.complete);
}

#[test]
fn recoveries_are_claimed() {
    let events = vec![
        opened(1, 200, 500, 1_000),
        released(1, 210, 200, 200, 50),
        claimed(1, 211, 0, 150),
        claimed(1, 211, 1, 100),
        claimed(1, 211, 2, 0),
        claimed(1, 211, 3, 0),
        released(1, 220, 100, 100, 0),
        claimed(1, 221, 0, 60),
    ];
    let fold = fold_pocket(&events, None).unwrap();
    assert_eq!(fold.held, dec(200));
    assert_eq!(fold.released_total, dec(350));
    assert_eq!(fold.claimed_total, dec(310));
}

#[test]
fn release_caps_principal_at_held() {
    let events = vec![opened(1, 200, 300, 300), released(1, 210, 450, 300, 10)];
    let fold = fold_pocket(&events, None).unwrap();
    assert_eq!(fold.held, dec(0));
    assert_eq!(fold.released_total, dec(310));
}

#[test]
fn write_downs_use_burned_not_amount() {
    let events = vec![
        opened(1, 200, 500, 1_000),
        released(1, 210, 200, 200, 0),
        burned(1, 220, 400, 300),
    ];
    let fold = fold_pocket(&events, None).unwrap();
    assert_eq!(fold.held, dec(0));
    assert_eq!(fold.burned_total, dec(300));
    assert_eq!(fold.released_total, dec(200));
}

#[test]
fn unrelease_reverses_a_release() {
    let events = vec![
        opened(1, 200, 500, 1_000),
        released(1, 210, 200, 200, 50),
        unreleased(1, 220, 200, 50),
    ];
    let fold = fold_pocket(&events, None).unwrap();
    assert_eq!(fold.held, dec(500));
    assert_eq!(fold.released_total, dec(0));
}

#[test]
fn events_fold_in_chain_order_regardless_of_input_order() {
    let events = vec![
        released(1, 210, 200, 200, 50),
        opened(1, 200, 500, 1_000),
        unreleased(1, 220, 200, 50),
    ];
    let fold = fold_pocket(&events, None).unwrap();
    assert_eq!(fold.held, dec(500));
    assert_eq!(fold.released_total, dec(0));
}

#[test]
fn seed_plus_later_events_is_incomplete() {
    let events = vec![released(1, 301, 50, 50, 10), claimed(1, 302, 0, 25)];
    let fold = fold_pocket(&events, Some(&seed(1, 300))).unwrap();
    assert_eq!(fold.held, dec(250));
    assert_eq!(fold.released_total, dec(160));
    assert_eq!(fold.burned_total, dec(20));
    assert_eq!(fold.claimed_total, dec(65));
    assert_eq!(fold.snapshot_ledger, 150);
    assert_eq!(fold.supply_at_snapshot, dec(1_000));
    assert_eq!(fold.opened, None);
    assert!(!fold.complete);
}

#[test]
fn events_at_or_below_as_of_ledger_are_ignored() {
    let events = vec![
        released(1, 299, 50, 50, 10),
        released(1, 300, 50, 50, 10),
        burned(1, 300, 30, 30),
    ];
    let fold = fold_pocket(&events, Some(&seed(1, 300))).unwrap();
    assert_eq!(fold.held, dec(300));
    assert_eq!(fold.released_total, dec(100));
    assert_eq!(fold.burned_total, dec(20));
}

#[test]
fn indexed_opened_wins_over_the_seed() {
    let events = vec![opened(1, 200, 500, 1_000), released(1, 310, 100, 100, 0)];
    let fold = fold_pocket(&events, Some(&seed(1, 300))).unwrap();
    assert!(fold.complete);
    assert_eq!(fold.opened, Some(dec(500)));
    assert_eq!(fold.held, dec(400));
    assert_eq!(fold.snapshot_ledger, 200);
}

#[test]
fn no_events_and_no_seed_is_none() {
    assert!(fold_pocket(&[], None).is_none());
    assert!(fold_pocket(&[claimed(1, 5, 0, 10)], None).is_none());
}

#[test]
fn seed_alone_is_served() {
    let fold = fold_pocket(&[], Some(&seed(1, 300))).unwrap();
    assert_eq!(fold.held, dec(300));
    assert!(!fold.complete);
}

#[test]
fn unparsable_amount_is_skipped() {
    let bad = ev(
        1,
        "PocketReleased",
        210,
        0,
        json!({"loan_id": "1", "principal": "1", "released": "x", "interest": "0"}),
    );
    let fold = fold_pocket(&[opened(1, 200, 500, 1_000), bad], None).unwrap();
    assert_eq!(fold.held, dec(500));
    assert_eq!(fold.released_total, dec(0));
}

#[test]
fn fold_pockets_groups_by_loan() {
    let events = vec![
        opened(1, 200, 500, 1_000),
        opened(2, 201, 100, 1_000),
        released(2, 210, 40, 40, 0),
    ];
    let seeds = vec![seed(3, 300)];
    let folds = fold_pockets(&events, &[], &seeds);
    assert_eq!(folds.len(), 3);
    assert_eq!(folds[&dec(1)].held, dec(500));
    assert_eq!(folds[&dec(2)].held, dec(60));
    assert!(!folds[&dec(3)].complete);
}

#[test]
fn presummed_claims_add_to_an_opened_fold() {
    use shared::pocket::PocketClaimTotals;
    let claims = vec![PocketClaimTotals {
        loan_id: dec(1),
        total: dec(310),
        after_seed: dec(0),
    }];
    let events = vec![opened(1, 200, 500, 1_000), released(1, 210, 200, 200, 50)];
    let folds = fold_pockets(&events, &claims, &[]);
    assert_eq!(folds[&dec(1)].claimed_total, dec(310));
    assert_eq!(folds[&dec(1)].held, dec(300));
}

#[test]
fn presummed_claims_after_seed_add_to_a_seeded_fold() {
    use shared::pocket::PocketClaimTotals;
    let claims = vec![PocketClaimTotals {
        loan_id: dec(1),
        total: dec(90),
        after_seed: dec(25),
    }];
    let folds = fold_pockets(&[], &claims, &[seed(1, 300)]);
    assert_eq!(folds[&dec(1)].claimed_total, dec(65));
}
