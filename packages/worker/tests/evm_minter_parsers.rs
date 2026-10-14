// spec: docs/user-stories/epic-1478/1483-evm-minter-cash-events.md
use alloy::{
    primitives::{address, b256, Address, FixedBytes, LogData, I256, U256},
    rpc::types::Log,
    sol,
    sol_types::SolEvent,
};
use serde_json::{json, Value};

use pipeline_worker::indexer::evm_parsers::is_emitted_by;
use pipeline_worker::indexer::parsers::{
    cash_reason_name, parse_cash_corrected, parse_cash_disbursed, parse_cash_disbursement_reversed,
    parse_cash_recorded, parse_cash_repaid, parse_cash_repayment_reversed, parse_loss_absorbed,
    parse_mint_corrected, parse_minter_event, parse_ramp_closed, parse_ramp_opened,
    parse_wire_in_returned, parse_wire_out_cancelled, parse_wire_out_requested,
    parse_wire_out_settled, ramp_direction_name,
};

sol! {
    event WireInRecorded(uint256 indexed id, address indexed receiver, uint256 amount, uint64 valueDate, bytes32 refHash);
    event WireInAssigned(uint256 indexed id, address indexed receiver);
    event WireInReturned(uint256 indexed id, uint256 amount, bytes32 refHash);
    event CashDisbursed(uint256 indexed loanId, uint256 entryId, uint256 amount, uint64 valueDate, bytes32 refHash);
    event CashDisbursementReversed(uint256 indexed loanId, uint256 entryId, uint256 originalId, uint256 amount, bytes32 refHash);
    event CashRepaid(uint256 indexed loanId, uint256 repaymentId, uint256 saleId, uint256 cash, uint256 interestMinted, uint256 feeShares, uint64 valueDate, bytes32 refHash);
    event CashRepaymentReversed(uint256 indexed loanId, uint256 repaymentId, uint256 cash, bytes32 refHash);
    event WireOutRequested(uint256 indexed id, address indexed lp, uint256 amount);
    event WireOutSettled(uint256 indexed id, uint256 amount, uint64 valueDate, bytes32 refHash);
    event WireOutCancelled(uint256 indexed id);
    event RampOpened(uint256 indexed id, uint8 direction, uint256 amount, bytes32 refHash);
    event RampClosed(uint256 indexed id, uint256 received, uint256 loss, bytes32 refHash);
    event CashRecorded(uint8 indexed reason, uint256 entryId, int256 delta, uint64 valueDate, bytes32 refHash);
    event CashCorrected(uint256 indexed originalId, uint256 entryId, int256 delta, bytes32 reasonHash);
    event MintCorrected(uint256 amount, bytes32 refHash);
    event LossAbsorbed(uint256 requested, uint256 pulled);
    event Disbursed(uint256 indexed loanId, uint256 amount, uint256 outstanding);
}

const CONTRACT: Address = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH: FixedBytes<32> =
    b256!("1111111111111111111111111111111111111111111111111111111111111111");
const HASH: FixedBytes<32> =
    b256!("abcd00000000000000000000000000000000000000000000000000000000ef01");
const HASH_HEX: &str = "abcd00000000000000000000000000000000000000000000000000000000ef01";

fn make_log(topics: Vec<FixedBytes<32>>, data: Vec<u8>) -> Log {
    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(topics, data.into()).unwrap(),
    };
    Log {
        inner,
        block_number: Some(42),
        transaction_hash: Some(TX_HASH),
        log_index: Some(7),
        ..Default::default()
    }
}

fn t(v: u64) -> FixedBytes<32> {
    U256::from(v).into()
}

fn u(v: u64) -> U256 {
    U256::from(v)
}

#[allow(clippy::needless_pass_by_value)]
fn check(
    log: &Log,
    parse: fn(&Log) -> Option<shared::events::ContractLog>,
    name: &str,
    expected: Value,
) {
    for ev in [parse(log), parse_minter_event(log)] {
        let ev = ev.unwrap();
        assert_eq!(ev.event_name, name);
        assert_eq!(ev.block_number, 42);
        assert_eq!(ev.log_index, 7);
        assert_eq!(ev.contract_address, CONTRACT);
        assert_eq!(ev.params, expected);
        assert_eq!(
            ev.params.as_object().unwrap().len(),
            expected.as_object().unwrap().len()
        );
    }
}

fn wire_in_returned_log() -> Log {
    let d = WireInReturned {
        id: u(1),
        amount: u(2),
        refHash: HASH,
    }
    .encode_data();
    make_log(vec![WireInReturned::SIGNATURE_HASH, t(1)], d)
}

fn cash_repaid_log(cash: U256) -> Log {
    let d = CashRepaid {
        loanId: u(3),
        repaymentId: u(4),
        saleId: u(5),
        cash,
        interestMinted: u(7),
        feeShares: u(8),
        valueDate: 1_700_000_000,
        refHash: HASH,
    }
    .encode_data();
    make_log(vec![CashRepaid::SIGNATURE_HASH, t(3)], d)
}

fn cash_recorded_log(reason: u64, delta: i64) -> Log {
    let d = CashRecorded {
        reason: reason as u8,
        entryId: u(9),
        delta: I256::try_from(delta).unwrap(),
        valueDate: 1_700_000_001,
        refHash: HASH,
    }
    .encode_data();
    make_log(vec![CashRecorded::SIGNATURE_HASH, t(reason)], d)
}

fn ramp_opened_log(direction: u8) -> Log {
    let d = RampOpened {
        id: u(5),
        direction,
        amount: u(600),
        refHash: HASH,
    }
    .encode_data();
    make_log(vec![RampOpened::SIGNATURE_HASH, t(5)], d)
}

fn cash_corrected_log(delta: i64) -> Log {
    let d = CashCorrected {
        originalId: u(2),
        entryId: u(3),
        delta: I256::try_from(delta).unwrap(),
        reasonHash: HASH,
    }
    .encode_data();
    make_log(vec![CashCorrected::SIGNATURE_HASH, t(2)], d)
}

// ── Per-event decode ──

#[test]
fn wire_in_returned_decodes() {
    check(
        &wire_in_returned_log(),
        parse_wire_in_returned,
        "WireInReturned",
        json!({"id": "1", "amount": "2", "ref_hash": HASH_HEX}),
    );
}

#[test]
fn cash_disbursed_decodes() {
    let d = CashDisbursed {
        loanId: u(3),
        entryId: u(4),
        amount: u(5),
        valueDate: 1_700_000_000,
        refHash: HASH,
    }
    .encode_data();
    let log = make_log(vec![CashDisbursed::SIGNATURE_HASH, t(3)], d);
    check(
        &log,
        parse_cash_disbursed,
        "CashDisbursed",
        json!({"loan_id": "3", "entry_id": "4", "amount": "5", "value_date": "1700000000", "ref_hash": HASH_HEX}),
    );
}

#[test]
fn cash_disbursement_reversed_decodes() {
    let d = CashDisbursementReversed {
        loanId: u(3),
        entryId: u(4),
        originalId: u(2),
        amount: u(5),
        refHash: HASH,
    }
    .encode_data();
    let log = make_log(vec![CashDisbursementReversed::SIGNATURE_HASH, t(3)], d);
    check(
        &log,
        parse_cash_disbursement_reversed,
        "CashDisbursementReversed",
        json!({"loan_id": "3", "entry_id": "4", "original_id": "2", "amount": "5", "ref_hash": HASH_HEX}),
    );
}

#[test]
fn cash_repaid_decodes() {
    check(
        &cash_repaid_log(u(6)),
        parse_cash_repaid,
        "CashRepaid",
        json!({
            "loan_id": "3", "repayment_id": "4", "sale_id": "5", "cash": "6",
            "interest_minted": "7", "fee_shares": "8", "value_date": "1700000000",
            "ref_hash": HASH_HEX
        }),
    );
}

#[test]
fn cash_repayment_reversed_decodes() {
    let d = CashRepaymentReversed {
        loanId: u(3),
        repaymentId: u(4),
        cash: u(6),
        refHash: HASH,
    }
    .encode_data();
    let log = make_log(vec![CashRepaymentReversed::SIGNATURE_HASH, t(3)], d);
    check(
        &log,
        parse_cash_repayment_reversed,
        "CashRepaymentReversed",
        json!({"loan_id": "3", "repayment_id": "4", "cash": "6", "ref_hash": HASH_HEX}),
    );
}

#[test]
fn wire_out_requested_decodes() {
    let lp = address!("1111111111111111111111111111111111111111");
    let d = WireOutRequested {
        id: u(8),
        lp,
        amount: u(900),
    }
    .encode_data();
    let log = make_log(
        vec![WireOutRequested::SIGNATURE_HASH, t(8), lp.into_word()],
        d,
    );
    check(
        &log,
        parse_wire_out_requested,
        "WireOutRequested",
        json!({"id": "8", "lp": lp.to_checksum(None), "amount": "900"}),
    );
}

#[test]
fn wire_out_settled_decodes() {
    let d = WireOutSettled {
        id: u(8),
        amount: u(900),
        valueDate: 1_700_000_002,
        refHash: HASH,
    }
    .encode_data();
    let log = make_log(vec![WireOutSettled::SIGNATURE_HASH, t(8)], d);
    check(
        &log,
        parse_wire_out_settled,
        "WireOutSettled",
        json!({"id": "8", "amount": "900", "value_date": "1700000002", "ref_hash": HASH_HEX}),
    );
}

#[test]
fn wire_out_cancelled_decodes() {
    let log = make_log(vec![WireOutCancelled::SIGNATURE_HASH, t(8)], vec![]);
    check(
        &log,
        parse_wire_out_cancelled,
        "WireOutCancelled",
        json!({"id": "8"}),
    );
}

#[test]
fn ramp_opened_decodes() {
    check(
        &ramp_opened_log(0),
        parse_ramp_opened,
        "RampOpened",
        json!({"id": "5", "direction": "UsdcToBank", "amount": "600", "ref_hash": HASH_HEX}),
    );
}

#[test]
fn ramp_closed_decodes() {
    let d = RampClosed {
        id: u(5),
        received: u(590),
        loss: u(10),
        refHash: HASH,
    }
    .encode_data();
    let log = make_log(vec![RampClosed::SIGNATURE_HASH, t(5)], d);
    check(
        &log,
        parse_ramp_closed,
        "RampClosed",
        json!({"id": "5", "received": "590", "loss": "10", "ref_hash": HASH_HEX}),
    );
}

#[test]
fn cash_recorded_decodes() {
    check(
        &cash_recorded_log(2, 500_000),
        parse_cash_recorded,
        "CashRecorded",
        json!({"reason": "Income", "entry_id": "9", "delta": "500000", "value_date": "1700000001", "ref_hash": HASH_HEX}),
    );
}

#[test]
fn cash_corrected_decodes() {
    check(
        &cash_corrected_log(-40),
        parse_cash_corrected,
        "CashCorrected",
        json!({"original_id": "2", "entry_id": "3", "delta": "-40", "reason_hash": HASH_HEX}),
    );
}

#[test]
fn mint_corrected_decodes() {
    let d = MintCorrected {
        amount: u(77),
        refHash: HASH,
    }
    .encode_data();
    let log = make_log(vec![MintCorrected::SIGNATURE_HASH], d);
    check(
        &log,
        parse_mint_corrected,
        "MintCorrected",
        json!({"amount": "77", "ref_hash": HASH_HEX}),
    );
}

#[test]
fn loss_absorbed_decodes() {
    let d = LossAbsorbed {
        requested: u(10),
        pulled: u(4),
    }
    .encode_data();
    let log = make_log(vec![LossAbsorbed::SIGNATURE_HASH], d);
    check(
        &log,
        parse_loss_absorbed,
        "LossAbsorbed",
        json!({"requested": "10", "pulled": "4"}),
    );
}

// ── Signed deltas ──

#[test]
fn cash_recorded_negative_delta() {
    let ev = parse_cash_recorded(&cash_recorded_log(3, -500_000)).unwrap();
    assert_eq!(ev.params["delta"], "-500000");
    assert_eq!(ev.params["reason"], "Expense");
}

// ── Enums ──

#[test]
fn cash_reason_names() {
    let names = [
        "Disbursed",
        "DisbursementReversed",
        "Income",
        "Expense",
        "Correction",
    ];
    for (i, n) in names.iter().enumerate() {
        assert_eq!(cash_reason_name(i as u8), *n);
    }
    assert_eq!(cash_reason_name(5), "Unknown");
    assert_eq!(cash_reason_name(255), "Unknown");
}

#[test]
fn ramp_direction_names() {
    assert_eq!(ramp_direction_name(0), "UsdcToBank");
    assert_eq!(ramp_direction_name(1), "BankToUsdc");
    assert_eq!(ramp_direction_name(2), "Unknown");
}

#[test]
fn ramp_opened_bank_to_usdc() {
    let ev = parse_ramp_opened(&ramp_opened_log(1)).unwrap();
    assert_eq!(ev.params["direction"], "BankToUsdc");
}

#[test]
fn unknown_enum_ordinal_maps_to_unknown() {
    let ev = parse_cash_recorded(&cash_recorded_log(9, 1)).unwrap();
    assert_eq!(ev.params["reason"], "Unknown");
    let ev = parse_ramp_opened(&ramp_opened_log(7)).unwrap();
    assert_eq!(ev.params["direction"], "Unknown");
}

// ── Hash shape ──

#[test]
fn hashes_are_bare_lowercase_hex() {
    let ev = parse_wire_in_returned(&wire_in_returned_log()).unwrap();
    let h = ev.params["ref_hash"].as_str().unwrap();
    assert_eq!(h.len(), 64);
    assert_eq!(h, h.to_lowercase());
    assert!(!h.starts_with("0x"));
    let ev = parse_cash_corrected(&cash_corrected_log(1)).unwrap();
    assert_eq!(ev.params["reason_hash"], HASH_HEX);
}

// ── Large values ──

#[test]
fn cash_repaid_max_cash_is_not_truncated() {
    let ev = parse_cash_repaid(&cash_repaid_log(U256::MAX)).unwrap();
    assert_eq!(ev.params["cash"], U256::MAX.to_string());
}

// ── Dispatcher ──

#[test]
fn dispatcher_routes_every_minter_event() {
    let recv = address!("2222222222222222222222222222222222222222");
    let wire_in = WireInRecorded {
        id: u(1),
        receiver: recv,
        amount: u(2),
        valueDate: 3,
        refHash: HASH,
    }
    .encode_data();
    let assigned = make_log(
        vec![WireInAssigned::SIGNATURE_HASH, t(1), recv.into_word()],
        vec![],
    );
    let wire_in = make_log(
        vec![WireInRecorded::SIGNATURE_HASH, t(1), recv.into_word()],
        wire_in,
    );
    let cases: Vec<(Log, &str)> = vec![
        (wire_in, "WireIn"),
        (assigned, "WireInAssigned"),
        (wire_in_returned_log(), "WireInReturned"),
        (
            make_log(
                vec![CashDisbursed::SIGNATURE_HASH, t(3)],
                CashDisbursed {
                    loanId: u(3),
                    entryId: u(4),
                    amount: u(5),
                    valueDate: 1,
                    refHash: HASH,
                }
                .encode_data(),
            ),
            "CashDisbursed",
        ),
        (
            make_log(
                vec![CashDisbursementReversed::SIGNATURE_HASH, t(3)],
                CashDisbursementReversed {
                    loanId: u(3),
                    entryId: u(4),
                    originalId: u(2),
                    amount: u(5),
                    refHash: HASH,
                }
                .encode_data(),
            ),
            "CashDisbursementReversed",
        ),
        (cash_repaid_log(u(6)), "CashRepaid"),
        (
            make_log(
                vec![CashRepaymentReversed::SIGNATURE_HASH, t(3)],
                CashRepaymentReversed {
                    loanId: u(3),
                    repaymentId: u(4),
                    cash: u(6),
                    refHash: HASH,
                }
                .encode_data(),
            ),
            "CashRepaymentReversed",
        ),
        (
            make_log(
                vec![WireOutRequested::SIGNATURE_HASH, t(8), recv.into_word()],
                WireOutRequested {
                    id: u(8),
                    lp: recv,
                    amount: u(9),
                }
                .encode_data(),
            ),
            "WireOutRequested",
        ),
        (
            make_log(
                vec![WireOutSettled::SIGNATURE_HASH, t(8)],
                WireOutSettled {
                    id: u(8),
                    amount: u(9),
                    valueDate: 1,
                    refHash: HASH,
                }
                .encode_data(),
            ),
            "WireOutSettled",
        ),
        (
            make_log(vec![WireOutCancelled::SIGNATURE_HASH, t(8)], vec![]),
            "WireOutCancelled",
        ),
        (ramp_opened_log(0), "RampOpened"),
        (
            make_log(
                vec![RampClosed::SIGNATURE_HASH, t(5)],
                RampClosed {
                    id: u(5),
                    received: u(1),
                    loss: u(2),
                    refHash: HASH,
                }
                .encode_data(),
            ),
            "RampClosed",
        ),
        (cash_recorded_log(2, 1), "CashRecorded"),
        (cash_corrected_log(1), "CashCorrected"),
        (
            make_log(
                vec![MintCorrected::SIGNATURE_HASH],
                MintCorrected {
                    amount: u(1),
                    refHash: HASH,
                }
                .encode_data(),
            ),
            "MintCorrected",
        ),
        (
            make_log(
                vec![LossAbsorbed::SIGNATURE_HASH],
                LossAbsorbed {
                    requested: u(1),
                    pulled: u(1),
                }
                .encode_data(),
            ),
            "LossAbsorbed",
        ),
    ];
    assert_eq!(cases.len(), 16);
    for (log, name) in cases {
        assert_eq!(parse_minter_event(&log).unwrap().event_name, name);
    }
}

#[test]
fn dispatcher_rejects_foreign_logs() {
    let d = Disbursed {
        loanId: u(1),
        amount: u(2),
        outstanding: u(3),
    }
    .encode_data();
    let loan_registry = make_log(vec![Disbursed::SIGNATURE_HASH, t(1)], d);
    assert!(parse_minter_event(&loan_registry).is_none());
    let random = make_log(vec![t(0xdead_beef)], vec![]);
    assert!(parse_minter_event(&random).is_none());
}

#[test]
fn missing_indexed_topic_returns_none() {
    let log = make_log(vec![WireOutCancelled::SIGNATURE_HASH], vec![]);
    assert!(parse_wire_out_cancelled(&log).is_none());
    assert!(parse_minter_event(&log).is_none());
}

#[test]
fn minter_topic_from_other_address_is_not_claimed() {
    let log = wire_in_returned_log();
    let other = address!("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert!(is_emitted_by(&log, &[CONTRACT]));
    assert!(!is_emitted_by(&log, &[other]));
    assert!(!is_emitted_by(&log, &[]));
}
