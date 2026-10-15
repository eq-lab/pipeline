// spec: docs/exec-plans/active/issue-1523-loanbook-readers-params-event.md#test-strategy
use std::str::FromStr;

use alloy::{
    primitives::{address, b256, Address, FixedBytes, LogData, U256},
    rpc::types::Log,
    sol_types::SolEvent,
};
use bigdecimal::BigDecimal;
use serde_json::json;

use pipeline_worker::indexer::parsers::{
    parse_economics_amended, parse_loan_rolled_over, parse_loan_status_updated,
};
use shared::{
    contract_logs_repo::{
        EconomicsEventRow, LATEST_WATCHLIST_ENTRY_SQL, LOAN_ECONOMICS_EVENTS_SQL,
    },
    loan_economics::build_epochs,
    loan_event_params::{build_loan_event_params, event_field},
    loan_snapshot::{LoanDocument, LoanSnapshot, RepaymentSnapshot},
};

alloy::sol! {
    event StatusUpdated(uint256 indexed loanId, uint8 indexed newStatus);
    event LoanRolledOver(uint256 indexed loanId, uint32 newRate, uint64 newMaturityTimestamp);
    event EconomicsAmended(uint256 indexed loanId, uint32 newRate, uint64 newMaturityTimestamp);
}

const CONTRACT: Address = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH: FixedBytes<32> =
    b256!("1111111111111111111111111111111111111111111111111111111111111111");

fn make_log(topics: Vec<FixedBytes<32>>, data: Vec<u8>, block_number: u64, log_index: u64) -> Log {
    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(topics, data.into()).unwrap(),
    };
    Log {
        inner,
        block_number: Some(block_number),
        transaction_hash: Some(TX_HASH),
        log_index: Some(log_index),
        ..Default::default()
    }
}

fn economics_log(sig: FixedBytes<32>, loan_id: U256, rate: u32, maturity: u64) -> Log {
    let topic1: FixedBytes<32> = loan_id.into();
    let mut data = [0u8; 64];
    data[28..32].copy_from_slice(&rate.to_be_bytes());
    data[56..64].copy_from_slice(&maturity.to_be_bytes());
    make_log(vec![sig, topic1], data.to_vec(), 600, 0)
}

fn make_prior_snapshot() -> LoanSnapshot {
    LoanSnapshot {
        originator: "PriorOriginator".to_owned(),
        borrower_id: "BRW-PRIOR".to_owned(),
        commodity: "Coffee".to_owned(),
        corridor: "BR-US".to_owned(),
        governing_law: "NY".to_owned(),
        protection: "Prior LC".to_owned(),
        metadata_uri: Some("ipfs://Qm_prior_secondary".to_owned()),
        documents: vec![LoanDocument {
            name: "Prior Agreement".to_owned(),
            uri: "ipfs://Qm_prior_agreement".to_owned(),
        }],
        original_facility_size: BigDecimal::from_str("5000000").unwrap(),
        original_senior_tranche: BigDecimal::from_str("4000000").unwrap(),
        original_equity_tranche: BigDecimal::from_str("1000000").unwrap(),
        original_offtaker_price: BigDecimal::from_str("5000000").unwrap(),
        senior_interest_rate_bps: 950_u32,
        origination_date: 1_700_000_000_i64,
        original_maturity_date: 1_800_000_000_i64,
        next_economics_epochs_id: BigDecimal::from(2),
        next_repayment_id: BigDecimal::from(1),
        status: "Performing".to_owned(),
        current_maturity_timestamp: 1_800_001_000_i64,
        current_rate: 950_u32,
        closure_reason: "None".to_owned(),
        carved_out: false,
        disbursed: BigDecimal::from(4_000_000),
        repaid: BigDecimal::from(0),
        written_down: BigDecimal::from(0),
        interest_adjustment: BigDecimal::from(0),
        metadata_uri_onchain: "ipfs://Qm_test".to_owned(),
        repayment: RepaymentSnapshot {
            offtaker_received: BigDecimal::from(0),
            senior_principal_repaid: BigDecimal::from(0),
            senior_interest: BigDecimal::from(0),
            equity_distributed: BigDecimal::from(0),
            mgmt_fee: BigDecimal::from(0),
            perf_fee: BigDecimal::from(0),
            oet_alloc: BigDecimal::from(0),
        },
    }
}

fn assert_decodes(params: &serde_json::Value, name: &str, rate: i64, maturity: i64) {
    assert!(params.get("new_rate").is_none());
    assert!(params.get("new_maturity_timestamp").is_none());
    let row =
        EconomicsEventRow::from_event_json(name.to_owned(), params.get("event"), 1_700_000_500);
    assert_eq!(row.new_rate, rate);
    assert_eq!(row.new_maturity_timestamp, maturity);
}

#[test]
fn evm_rolled_over_round_trips_through_the_reader_mapping() {
    let loan_id = U256::from(12u64);
    let log = economics_log(
        LoanRolledOver::SIGNATURE_HASH,
        loan_id,
        50_000,
        1_900_000_000,
    );
    let ev = parse_loan_rolled_over(&log).expect("decodes");
    let params = build_loan_event_params(
        &BigDecimal::from_str("12").unwrap(),
        &ev.params,
        &make_prior_snapshot(),
    );
    assert_decodes(&params, "LoanRolledOver", 50_000, 1_900_000_000);

    let row = EconomicsEventRow::from_event_json(
        "LoanRolledOver".to_owned(),
        params.get("event"),
        1_700_000_500,
    );
    let epochs = build_epochs(1_700_000_000, 1_800_000_000, 950, &[row]);
    assert_eq!(epochs.len(), 2);
    assert_eq!(epochs[1].start, 1_800_000_000);
    assert_eq!(epochs[1].rate_bps, 500);
    assert_eq!(epochs[1].maturity, 1_900_000_000);
}

#[test]
fn evm_economics_amended_round_trips_through_the_reader_mapping() {
    let loan_id = U256::from(15u64);
    let log = economics_log(
        EconomicsAmended::SIGNATURE_HASH,
        loan_id,
        75_000,
        1_900_000_000,
    );
    let ev = parse_economics_amended(&log).expect("decodes");
    let params = build_loan_event_params(
        &BigDecimal::from_str("15").unwrap(),
        &ev.params,
        &make_prior_snapshot(),
    );
    assert_decodes(&params, "EconomicsAmended", 75_000, 1_900_000_000);

    let row = EconomicsEventRow::from_event_json(
        "EconomicsAmended".to_owned(),
        params.get("event"),
        1_700_000_500,
    );
    let epochs = build_epochs(1_700_000_000, 1_800_000_000, 950, &[row]);
    assert_eq!(epochs.len(), 1);
    assert_eq!(epochs[0].rate_bps, 750);
    assert_eq!(epochs[0].maturity, 1_900_000_000);
}

#[test]
fn stellar_encoding_round_trips_through_the_reader_mapping() {
    let parser_params = json!({
        "loan_id": "7",
        "new_rate": 50_000,
        "new_maturity_timestamp": "1900000000",
    });
    let params =
        build_loan_event_params(&BigDecimal::from(7), &parser_params, &make_prior_snapshot());
    assert_decodes(&params, "LoanRolledOver", 50_000, 1_900_000_000);
}

#[test]
fn watchlist_status_lives_under_event_and_the_sql_reads_it_there() {
    let loan_id = U256::from(5u64);
    let topic1: FixedBytes<32> = loan_id.into();
    let mut topic2 = [0u8; 32];
    topic2[31] = 2;
    let log = make_log(
        vec![
            StatusUpdated::SIGNATURE_HASH,
            topic1,
            FixedBytes::from(topic2),
        ],
        vec![],
        600,
        0,
    );
    let ev = parse_loan_status_updated(&log).expect("decodes");
    let params = build_loan_event_params(&BigDecimal::from(5), &ev.params, &make_prior_snapshot());

    assert_eq!(event_field(&params, "status"), Some(&json!("WatchList")));
    assert!(params.get("status").is_none());
    assert!(LATEST_WATCHLIST_ENTRY_SQL.contains("params->'event'->>'status' = 'WatchList'"));
    assert!(!LATEST_WATCHLIST_ENTRY_SQL.contains("params->>'status'"));
}

#[test]
fn economics_sql_selects_the_nested_event() {
    assert!(LOAN_ECONOMICS_EVENTS_SQL.contains("params->'event'"));
    assert!(!LOAN_ECONOMICS_EVENTS_SQL.contains("params->>'new_rate'"));
}

#[test]
fn builder_emits_exactly_loan_id_event_and_snapshot() {
    let parser_params = json!({"loan_id": "9", "status": "Performing"});
    let params =
        build_loan_event_params(&BigDecimal::from(9), &parser_params, &make_prior_snapshot());
    let mut keys: Vec<&str> = params
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["event", "loan_id", "snapshot"]);
    assert_eq!(params["loan_id"], json!("9"));
    assert!(params["event"].get("loan_id").is_none());
    assert_eq!(params["event"]["status"], json!("Performing"));
}
