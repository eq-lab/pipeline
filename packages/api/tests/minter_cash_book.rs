// spec: docs/product-specs/minter-cash-book.md#behavior
use pipeline_api::minter_cash_book::{
    build_ramps, build_wire_ins, build_wire_outs, fold_cash, to_base6_string, RampStatus,
    WireInStatus, WireOutStatus,
};
use serde_json::{json, Value};
use shared::contract_logs_repo::MinterEventRow;

const MINTER: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";
const LP: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const REF: &str = "72c162575adea091c5fc1bed0ec9321fda14c9706338e043ff9d01aeb652a6ce";

fn ev(name: &str, block: i64, idx: i32, params: Value) -> MinterEventRow {
    MinterEventRow {
        event_name: name.to_owned(),
        block_number: block,
        log_index: idx,
        block_timestamp: 1_790_000_000 + block,
        params,
    }
}

fn wire_in(id: i64, receiver: &str, amount: i128, block: i64) -> MinterEventRow {
    ev(
        "WireIn",
        block,
        0,
        json!({"id": id, "receiver": receiver, "amount": amount.to_string(), "value_date": "1789000000", "ref_hash": REF}),
    )
}

fn snapshot(block: i64, idx: i32, bank: i128, flight: i128) -> MinterEventRow {
    ev(
        "MinterSnapshot",
        block,
        idx,
        json!({
            "ledger": block.to_string(),
            "bank_cash": bank.to_string(),
            "in_flight": flight.to_string(),
            "outstanding_total": "0",
            "unabsorbed_total": "0",
            "total_assets": "0",
            "read_failed": false,
        }),
    )
}

fn base(rows: Vec<MinterEventRow>) -> Vec<MinterEventRow> {
    let mut all = vec![snapshot(1, 0, 0, 0)];
    all.extend(rows);
    all
}

fn bank_of(rows: Vec<MinterEventRow>) -> i128 {
    let fold = fold_cash(&base(rows));
    assert!(fold.complete);
    fold.bank_cash
}

fn ramp_open(id: i64, direction: &str, amount: i128, block: i64) -> MinterEventRow {
    ev(
        "RampOpened",
        block,
        0,
        json!({"id": id.to_string(), "direction": direction, "amount": amount.to_string(), "ref_hash": REF}),
    )
}

fn ramp_close(id: i64, received: i128, loss: i128, block: i64) -> MinterEventRow {
    ev(
        "RampClosed",
        block,
        0,
        json!({"id": id.to_string(), "received": received.to_string(), "loss": loss.to_string(), "ref_hash": REF}),
    )
}

fn cash_recorded(reason: &str, delta: i128, block: i64) -> MinterEventRow {
    ev(
        "CashRecorded",
        block,
        0,
        json!({"reason": reason, "entry_id": "1", "delta": delta.to_string(), "value_date": "1", "ref_hash": REF}),
    )
}

// ── Wire-ins ──────────────────────────────────────────────────────────────────

#[test]
fn wire_in_to_the_minter_is_escrowed_and_to_anyone_else_is_direct() {
    let rows = vec![wire_in(1, LP, 10, 2), wire_in(2, MINTER, 20, 3)];
    let list = build_wire_ins(&rows, MINTER);
    assert_eq!(list[0].id, 2);
    assert_eq!(list[0].status, WireInStatus::Escrowed);
    assert_eq!(list[1].id, 1);
    assert_eq!(list[1].status, WireInStatus::Direct);
}

#[test]
fn an_escrowed_wire_in_can_be_assigned_with_a_new_receiver() {
    let rows = vec![
        wire_in(1, MINTER, 10, 2),
        ev("WireInAssigned", 3, 0, json!({"id": 1, "receiver": LP})),
    ];
    let w = &build_wire_ins(&rows, MINTER)[0];
    assert_eq!(w.status, WireInStatus::Assigned);
    assert_eq!(w.receiver, LP);
    assert_eq!(w.assigned_at, Some(1_790_000_003));
}

#[test]
fn a_wire_in_can_be_returned_with_its_return_ref() {
    let rows = vec![
        wire_in(1, MINTER, 10, 2),
        ev(
            "WireInReturned",
            3,
            0,
            json!({"id": "1", "amount": "10", "ref_hash": "aa"}),
        ),
    ];
    let w = &build_wire_ins(&rows, MINTER)[0];
    assert_eq!(w.status, WireInStatus::Returned);
    assert_eq!(w.return_ref_hash.as_deref(), Some("aa"));
    assert_eq!(w.returned_at, Some(1_790_000_003));
}

#[test]
fn wire_in_ids_join_across_a_json_number_and_a_string() {
    let rows = vec![
        wire_in(3, MINTER, 10, 2),
        ev("WireInAssigned", 3, 0, json!({"id": "3", "receiver": LP})),
    ];
    assert_eq!(
        build_wire_ins(&rows, MINTER)[0].status,
        WireInStatus::Assigned
    );
}

#[test]
fn a_wire_in_follow_up_without_its_origin_is_not_listed() {
    let rows = vec![ev("WireInAssigned", 3, 0, json!({"id": 9, "receiver": LP}))];
    assert!(build_wire_ins(&rows, MINTER).is_empty());
}

// ── Wire-outs ─────────────────────────────────────────────────────────────────

fn wire_out_requested(id: i64, amount: i128, block: i64) -> MinterEventRow {
    ev(
        "WireOutRequested",
        block,
        0,
        json!({"id": id.to_string(), "lp": LP, "amount": amount.to_string()}),
    )
}

#[test]
fn wire_out_goes_pending_then_settled_or_cancelled() {
    let rows = vec![
        wire_out_requested(1, 100, 2),
        wire_out_requested(2, 200, 2),
        wire_out_requested(3, 300, 2),
        ev(
            "WireOutSettled",
            4,
            0,
            json!({"id": "1", "amount": "100", "value_date": "1789000001", "ref_hash": REF}),
        ),
        ev("WireOutCancelled", 5, 0, json!({"id": "2"})),
    ];
    let list = build_wire_outs(&rows);
    assert_eq!(list.iter().map(|w| w.id).collect::<Vec<_>>(), [3, 2, 1]);
    assert_eq!(list[0].status, WireOutStatus::Pending);
    assert_eq!(list[1].status, WireOutStatus::Cancelled);
    assert_eq!(list[1].cancelled_at, Some(1_790_000_005));
    assert_eq!(list[2].status, WireOutStatus::Settled);
    assert_eq!(list[2].value_date, Some(1_789_000_001));
    assert_eq!(list[2].ref_hash.as_deref(), Some(REF));
    assert_eq!(list[2].lp, LP);
}

#[test]
fn a_wire_out_follow_up_whose_request_is_missing_is_not_listed() {
    let rows = vec![ev("WireOutCancelled", 5, 0, json!({"id": "9"}))];
    assert!(build_wire_outs(&rows).is_empty());
}

// ── Ramps ─────────────────────────────────────────────────────────────────────

#[test]
fn ramps_open_and_close_in_both_directions() {
    let rows = vec![
        ramp_open(1, "UsdcToBank", 100, 2),
        ramp_open(2, "BankToUsdc", 200, 2),
        ramp_close(1, 90, 10, 3),
    ];
    let list = build_ramps(&rows);
    assert_eq!(list[0].id, 2);
    assert_eq!(list[0].status, RampStatus::Open);
    assert_eq!(list[0].direction, "BankToUsdc");
    assert_eq!(list[1].status, RampStatus::Closed);
    assert_eq!(list[1].received, Some(90));
    assert_eq!(list[1].loss, Some(10));
}

// ── bank_cash writers ─────────────────────────────────────────────────────────

#[test]
fn a_direct_and_an_escrowed_wire_in_both_add_to_bank_cash() {
    assert_eq!(
        bank_of(vec![wire_in(1, LP, 10, 2), wire_in(2, MINTER, 20, 3)]),
        30
    );
}

#[test]
fn cash_disbursement_reversed_cash_repaid_and_usdc_to_bank_close_add() {
    let rows = vec![
        ev(
            "CashDisbursementReversed",
            2,
            0,
            json!({"amount": "5", "loan_id": "1", "entry_id": "1", "original_id": "1", "ref_hash": REF}),
        ),
        ev(
            "CashRepaid",
            3,
            0,
            json!({"cash": "7", "interest_minted": "100", "fee_shares": "100", "loan_id": "1"}),
        ),
        ramp_open(1, "UsdcToBank", 50, 4),
        ramp_close(1, 40, 10, 5),
    ];
    assert_eq!(bank_of(rows), 5 + 7 + 40);
}

#[test]
fn wire_in_returned_disbursed_repayment_reversed_wire_out_settled_and_bank_to_usdc_open_subtract() {
    let rows = vec![
        ev("WireInReturned", 2, 0, json!({"id": "1", "amount": "1"})),
        ev(
            "CashDisbursed",
            3,
            0,
            json!({"amount": "2", "loan_id": "1"}),
        ),
        ev(
            "CashRepaymentReversed",
            4,
            0,
            json!({"cash": "3", "loan_id": "1", "interest_minted": "100"}),
        ),
        ev("WireOutSettled", 5, 0, json!({"id": "1", "amount": "4"})),
        ramp_open(1, "BankToUsdc", 5, 6),
    ];
    assert_eq!(bank_of(rows), -(1 + 2 + 3 + 4 + 5));
}

#[test]
fn cash_recorded_income_expense_and_correction_apply_the_emitted_sign() {
    assert_eq!(bank_of(vec![cash_recorded("Income", 100, 2)]), 100);
    assert_eq!(bank_of(vec![cash_recorded("Expense", -40, 2)]), -40);
    assert_eq!(bank_of(vec![cash_recorded("Correction", 9, 2)]), 9);
    assert_eq!(bank_of(vec![cash_recorded("Correction", -9, 2)]), -9);
}

#[test]
fn events_without_a_cash_effect_leave_the_totals_alone() {
    let rows = vec![
        ev("MintCorrected", 2, 0, json!({"amount": "5"})),
        ev(
            "LossAbsorbed",
            2,
            1,
            json!({"requested": "5", "pulled": "5"}),
        ),
        ev("WireInAssigned", 3, 0, json!({"id": 1, "receiver": LP})),
        wire_out_requested(1, 99, 3),
        ev("WireOutCancelled", 4, 0, json!({"id": "1"})),
    ];
    let fold = fold_cash(&base(rows));
    assert!(fold.complete);
    assert_eq!((fold.bank_cash, fold.in_flight), (0, 0));
}

// ── in_flight ─────────────────────────────────────────────────────────────────

#[test]
fn in_flight_rises_on_open_and_falls_by_received_plus_loss_on_close() {
    let opened = fold_cash(&base(vec![
        ramp_open(1, "UsdcToBank", 100, 2),
        ramp_open(2, "BankToUsdc", 50, 2),
    ]));
    assert_eq!(opened.in_flight, 150);

    let closed = fold_cash(&base(vec![
        ramp_open(1, "UsdcToBank", 100, 2),
        ramp_close(1, 90, 10, 3),
    ]));
    assert!(closed.complete);
    assert_eq!(closed.in_flight, 0);

    let lossless = fold_cash(&base(vec![
        ramp_open(1, "UsdcToBank", 100, 2),
        ramp_close(1, 100, 0, 3),
    ]));
    assert_eq!(lossless.in_flight, 0);
}

#[test]
fn a_bank_to_usdc_close_leaves_bank_cash_alone_and_a_usdc_to_bank_close_adds_only_received() {
    let b2u = fold_cash(&base(vec![
        ramp_open(1, "BankToUsdc", 100, 2),
        ramp_close(1, 95, 5, 3),
    ]));
    assert_eq!(b2u.bank_cash, -100);
    let u2b = fold_cash(&base(vec![
        ramp_open(1, "UsdcToBank", 100, 2),
        ramp_close(1, 95, 5, 3),
    ]));
    assert_eq!(u2b.bank_cash, 95);
}

// ── Checkpoints ───────────────────────────────────────────────────────────────

#[test]
fn without_a_snapshot_the_fold_is_incomplete_and_sums_from_genesis() {
    let fold = fold_cash(&[wire_in(1, LP, 10, 2), wire_in(2, LP, 5, 3)]);
    assert!(!fold.complete);
    assert_eq!(fold.bank_cash, 15);
    assert_eq!(fold.checkpoint_ledger, None);
}

#[test]
fn only_events_strictly_after_the_snapshot_apply() {
    let mut early = ev(
        "WireIn",
        10,
        1,
        json!({"id": 1, "receiver": LP, "amount": "7", "value_date": "1", "ref_hash": REF}),
    );
    let mut late = early.clone();
    early.log_index = 1;
    late.log_index = 3;
    late.params["id"] = json!(2);
    let rows = vec![early, snapshot(10, 2, 1_000, 0), late];
    let fold = fold_cash(&rows);
    assert!(fold.complete);
    assert_eq!(fold.bank_cash, 1_007);
    assert_eq!(fold.checkpoint_ledger, Some(10));
}

#[test]
fn the_latest_snapshot_wins() {
    let rows = vec![snapshot(5, 0, 100, 1), snapshot(9, 0, 200, 2)];
    let fold = fold_cash(&rows);
    assert_eq!((fold.bank_cash, fold.in_flight), (200, 2));
    assert_eq!(fold.checkpoint_ledger, Some(9));
}

#[test]
fn a_malformed_snapshot_is_skipped_for_an_earlier_valid_one() {
    let mut broken = snapshot(9, 0, 200, 2);
    broken.params["read_failed"] = json!("nope");
    let fold = fold_cash(&[snapshot(5, 0, 100, 1), broken]);
    assert!(fold.complete);
    assert_eq!(fold.bank_cash, 100);
    assert_eq!(fold.checkpoint_ledger, Some(5));
}

#[test]
fn a_ramp_opened_before_the_snapshot_and_closed_after_uses_its_original_direction() {
    let rows = vec![
        ramp_open(1, "UsdcToBank", 100, 2),
        snapshot(5, 0, 1_000, 100),
        ramp_close(1, 90, 10, 6),
    ];
    let fold = fold_cash(&rows);
    assert!(fold.complete);
    assert_eq!(fold.in_flight, 0);
    assert_eq!(fold.bank_cash, 1_090);
}

#[test]
fn a_close_whose_open_is_not_indexed_is_incomplete() {
    let fold = fold_cash(&[snapshot(5, 0, 1_000, 100), ramp_close(1, 90, 10, 6)]);
    assert!(!fold.complete);
    assert_eq!(fold.in_flight, 0);
}

#[test]
fn an_open_close_amount_mismatch_is_incomplete() {
    let fold = fold_cash(&base(vec![
        ramp_open(1, "UsdcToBank", 100, 2),
        ramp_close(1, 50, 10, 3),
    ]));
    assert!(!fold.complete);
}

#[test]
fn a_malformed_post_checkpoint_amount_is_incomplete() {
    let mut bad = wire_in(1, LP, 10, 2);
    bad.params["amount"] = json!("ten");
    let fold = fold_cash(&base(vec![bad]));
    assert!(!fold.complete);
    assert_eq!(fold.bank_cash, 0);
}

// ── Units ─────────────────────────────────────────────────────────────────────

#[test]
fn raw_seven_dp_amounts_render_as_floored_six_dp_dollars() {
    assert_eq!(to_base6_string(12_345_678), "1.234567");
    assert_eq!(to_base6_string(0), "0.000000");
}
