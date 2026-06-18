/// Unit tests for Stellar Soroban event parsers.
///
/// All tests use locally constructed `RawEvent` values — no live RPC, no DB.
/// ScVal encoding helpers mirror what `#[contractevent]` macros produce:
///   - topics[0] = ScVal::Symbol(snake_case_event_name)
///   - topics[1..n] = #[topic] fields in declaration order
///   - value = ScVal::Map with non-topic fields (sorted alphabetically)
use pipeline_worker::indexer::stellar::parsers::{
    dispatch_parser, parse_deposit_requested, parse_request_claimed, parse_vault_deposit,
    parse_vault_withdraw, parse_withdrawal_requested,
};
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use stellar_xdr::curr::{
    AccountId, Int128Parts, Limits, PublicKey, ScAddress, ScMap, ScMapEntry, ScSymbol, ScVal,
    StringM, UInt128Parts, Uint256, VecM, WriteXdr,
};

// ── ScVal encode helpers ─────────────────────────────────────────────────────

fn encode_symbol(s: &str) -> String {
    let sym: StringM<32> = s.try_into().unwrap();
    ScVal::Symbol(ScSymbol(sym))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

fn encode_u128(v: u128) -> String {
    let hi = (v >> 64) as u64;
    let lo = (v & 0xFFFF_FFFF_FFFF_FFFF) as u64;
    ScVal::U128(UInt128Parts { hi, lo })
        .to_xdr_base64(Limits::none())
        .unwrap()
}

/// Encode a Stellar G… account address as ScVal::Address.
fn encode_account(strkey: &str) -> String {
    let pk = stellar_strkey::ed25519::PublicKey::from_string(strkey).unwrap();
    ScVal::Address(ScAddress::Account(AccountId(
        PublicKey::PublicKeyTypeEd25519(Uint256(pk.0)),
    )))
    .to_xdr_base64(Limits::none())
    .unwrap()
}

/// Encode an i128 map with keys sorted alphabetically (matching #[contractevent] default).
fn encode_map_i128(pairs: &[(&str, i128)]) -> String {
    let mut sorted = pairs.to_vec();
    sorted.sort_by_key(|(k, _)| *k);

    let entries: Vec<ScMapEntry> = sorted
        .iter()
        .map(|(k, v)| {
            let key_sym: StringM<32> = (*k).try_into().unwrap();
            let hi = (*v >> 64) as i64;
            let lo = (*v & 0xFFFF_FFFF_FFFF_FFFF) as u64;
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(key_sym)),
                val: ScVal::I128(Int128Parts { hi, lo }),
            }
        })
        .collect();

    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

// ── Test addresses ────────────────────────────────────────────────────────────

const DM_CONTRACT: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const WQ_CONTRACT: &str = "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL";
const SPLUSD_CONTRACT: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const USER_G: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const OPERATOR_G: &str = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

fn make_raw_event(
    contract_id: &str,
    event_name_sym: &str,
    topics_after_sym: Vec<String>,
    value: String,
) -> RawEvent {
    let mut topics = vec![encode_symbol(event_name_sym)];
    topics.extend(topics_after_sym);
    RawEvent {
        contract_id: contract_id.to_owned(),
        event_name: event_name_sym.to_owned(),
        topics_base64: topics,
        value_base64: value,
        ledger: 1_234_567,
        ledger_closed_at_unix: 1_700_000_000,
        tx_hash: "abc123".to_owned(),
        tx_index: 0,
        op_index: 0,
        event_index_in_op: 0,
    }
}

// ── parse_deposit_requested ───────────────────────────────────────────────────

#[test]
fn deposit_requested_decodes_fixture() {
    let request_id: u128 = 42;
    let amount: i128 = 1_000_000;

    let raw = make_raw_event(
        DM_CONTRACT,
        "deposit_requested",
        vec![encode_u128(request_id), encode_account(USER_G)],
        encode_map_i128(&[("amount", amount)]),
    );

    let log = parse_deposit_requested(&raw).expect("should decode DepositRequested");
    assert_eq!(log.event_name, "DepositRequested");
    assert_eq!(log.contract_address, DM_CONTRACT);
    assert_eq!(log.params["request_id"], request_id.to_string());
    assert_eq!(log.params["user"], USER_G);
    assert_eq!(log.params["amount"], amount.to_string());
    assert_eq!(log.block_number, 1_234_567);
    assert_eq!(log.block_timestamp, 1_700_000_000);
}

#[test]
fn deposit_requested_rejects_wrong_event_name() {
    let raw = make_raw_event(
        DM_CONTRACT,
        "request_claimed",
        vec![encode_u128(1), encode_account(USER_G)],
        encode_map_i128(&[("amount", 100)]),
    );
    assert!(parse_deposit_requested(&raw).is_none());
}

#[test]
fn deposit_requested_rejects_short_topics() {
    let raw = RawEvent {
        event_name: "deposit_requested".to_owned(),
        topics_base64: vec![encode_symbol("deposit_requested")], // only 1 topic, need 3
        value_base64: encode_map_i128(&[("amount", 100)]),
        contract_id: DM_CONTRACT.to_owned(),
        ledger: 1,
        ledger_closed_at_unix: 0,
        tx_hash: String::new(),
        tx_index: 0,
        op_index: 0,
        event_index_in_op: 0,
    };
    assert!(parse_deposit_requested(&raw).is_none());
}

// ── parse_withdrawal_requested ────────────────────────────────────────────────

#[test]
fn withdrawal_requested_decodes_fixture() {
    let request_id: u128 = 7;
    let amount: i128 = 500_000;
    let queued: i128 = 2_000_000;

    let raw = make_raw_event(
        WQ_CONTRACT,
        "withdrawal_requested",
        vec![encode_account(USER_G), encode_u128(request_id)],
        encode_map_i128(&[("amount", amount), ("queued", queued)]),
    );

    let log = parse_withdrawal_requested(&raw).expect("should decode WithdrawalRequested");
    assert_eq!(log.event_name, "WithdrawalRequested");
    assert_eq!(log.params["withdrawer"], USER_G);
    assert_eq!(log.params["request_id"], request_id.to_string());
    assert_eq!(log.params["amount"], amount.to_string());
    assert_eq!(log.params["queued"], queued.to_string());
}

#[test]
fn withdrawal_requested_rejects_wrong_event_name() {
    let raw = make_raw_event(
        WQ_CONTRACT,
        "deposit_requested",
        vec![encode_account(USER_G), encode_u128(1)],
        encode_map_i128(&[("amount", 100), ("queued", 200)]),
    );
    assert!(parse_withdrawal_requested(&raw).is_none());
}

#[test]
fn withdrawal_requested_rejects_short_topics() {
    let raw = RawEvent {
        event_name: "withdrawal_requested".to_owned(),
        topics_base64: vec![
            encode_symbol("withdrawal_requested"),
            encode_account(USER_G),
        ], // missing request_id topic
        value_base64: encode_map_i128(&[("amount", 100), ("queued", 200)]),
        contract_id: WQ_CONTRACT.to_owned(),
        ledger: 1,
        ledger_closed_at_unix: 0,
        tx_hash: String::new(),
        tx_index: 0,
        op_index: 0,
        event_index_in_op: 0,
    };
    assert!(parse_withdrawal_requested(&raw).is_none());
}

// ── parse_request_claimed ─────────────────────────────────────────────────────

#[test]
fn request_claimed_decodes_fixture() {
    let request_id: u128 = 99;
    let amount: i128 = 750_000;

    let raw = make_raw_event(
        DM_CONTRACT,
        "request_claimed",
        vec![encode_u128(request_id), encode_account(USER_G)],
        encode_map_i128(&[("amount", amount)]),
    );

    let log = parse_request_claimed(&raw).expect("should decode RequestClaimed");
    assert_eq!(log.event_name, "RequestClaimed");
    assert_eq!(log.params["request_id"], request_id.to_string());
    assert_eq!(log.params["user"], USER_G);
    assert_eq!(log.params["amount"], amount.to_string());
}

#[test]
fn request_claimed_rejects_wrong_event_name() {
    let raw = make_raw_event(
        DM_CONTRACT,
        "deposit_requested",
        vec![encode_u128(1), encode_account(USER_G)],
        encode_map_i128(&[("amount", 100)]),
    );
    assert!(parse_request_claimed(&raw).is_none());
}

// ── parse_vault_deposit (StakingDeposit) ──────────────────────────────────────

#[test]
fn vault_deposit_decodes_fixture() {
    let assets: i128 = 1_000_000;
    let shares: i128 = 980_000;

    let raw = make_raw_event(
        SPLUSD_CONTRACT,
        "deposit",
        vec![
            encode_account(OPERATOR_G),
            encode_account(USER_G),
            encode_account(USER_G),
        ],
        encode_map_i128(&[("assets", assets), ("shares", shares)]),
    );

    let log = parse_vault_deposit(&raw).expect("should decode StakingDeposit");
    assert_eq!(log.event_name, "StakingDeposit");
    assert_eq!(log.params["operator"], OPERATOR_G);
    assert_eq!(log.params["assets"], assets.to_string());
    assert_eq!(log.params["shares"], shares.to_string());
}

#[test]
fn vault_deposit_rejects_wrong_event_name() {
    let raw = make_raw_event(
        SPLUSD_CONTRACT,
        "withdraw",
        vec![
            encode_account(OPERATOR_G),
            encode_account(USER_G),
            encode_account(USER_G),
        ],
        encode_map_i128(&[("assets", 100), ("shares", 90)]),
    );
    assert!(parse_vault_deposit(&raw).is_none());
}

#[test]
fn vault_deposit_rejects_short_topics() {
    let raw = RawEvent {
        event_name: "deposit".to_owned(),
        topics_base64: vec![encode_symbol("deposit"), encode_account(OPERATOR_G)], // missing from + receiver topics
        value_base64: encode_map_i128(&[("assets", 100), ("shares", 90)]),
        contract_id: SPLUSD_CONTRACT.to_owned(),
        ledger: 1,
        ledger_closed_at_unix: 0,
        tx_hash: String::new(),
        tx_index: 0,
        op_index: 0,
        event_index_in_op: 0,
    };
    assert!(parse_vault_deposit(&raw).is_none());
}

// ── parse_vault_withdraw (StakingWithdrawal) ──────────────────────────────────

#[test]
fn vault_withdraw_decodes_fixture() {
    let assets: i128 = 800_000;
    let shares: i128 = 790_000;

    let raw = make_raw_event(
        SPLUSD_CONTRACT,
        "withdraw",
        vec![
            encode_account(OPERATOR_G),
            encode_account(USER_G),
            encode_account(USER_G),
        ],
        encode_map_i128(&[("assets", assets), ("shares", shares)]),
    );

    let log = parse_vault_withdraw(&raw).expect("should decode StakingWithdrawal");
    assert_eq!(log.event_name, "StakingWithdrawal");
    assert_eq!(log.params["operator"], OPERATOR_G);
    assert_eq!(log.params["assets"], assets.to_string());
    assert_eq!(log.params["shares"], shares.to_string());
}

#[test]
fn vault_withdraw_rejects_wrong_event_name() {
    let raw = make_raw_event(
        SPLUSD_CONTRACT,
        "deposit",
        vec![
            encode_account(OPERATOR_G),
            encode_account(USER_G),
            encode_account(USER_G),
        ],
        encode_map_i128(&[("assets", 100), ("shares", 90)]),
    );
    assert!(parse_vault_withdraw(&raw).is_none());
}

// ── dispatch_parser: per-contract routing ─────────────────────────────────────

const UNKNOWN_CONTRACT: &str = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

fn make_deposit_requested(contract_id: &str) -> RawEvent {
    make_raw_event(
        contract_id,
        "deposit_requested",
        vec![encode_u128(1), encode_account(USER_G)],
        encode_map_i128(&[("amount", 100)]),
    )
}

fn make_withdrawal_requested(contract_id: &str) -> RawEvent {
    make_raw_event(
        contract_id,
        "withdrawal_requested",
        vec![encode_account(USER_G), encode_u128(1)],
        encode_map_i128(&[("amount", 100), ("queued", 200)]),
    )
}

fn make_request_claimed(contract_id: &str) -> RawEvent {
    make_raw_event(
        contract_id,
        "request_claimed",
        vec![encode_u128(1), encode_account(USER_G)],
        encode_map_i128(&[("amount", 100)]),
    )
}

fn make_vault_deposit(contract_id: &str) -> RawEvent {
    make_raw_event(
        contract_id,
        "deposit",
        vec![
            encode_account(OPERATOR_G),
            encode_account(USER_G),
            encode_account(USER_G),
        ],
        encode_map_i128(&[("assets", 100), ("shares", 90)]),
    )
}

fn make_vault_withdraw(contract_id: &str) -> RawEvent {
    make_raw_event(
        contract_id,
        "withdraw",
        vec![
            encode_account(OPERATOR_G),
            encode_account(USER_G),
            encode_account(USER_G),
        ],
        encode_map_i128(&[("assets", 100), ("shares", 90)]),
    )
}

#[test]
fn dispatch_deposit_requested_from_dm_succeeds() {
    let raw = make_deposit_requested(DM_CONTRACT);
    let log = dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None)
        .expect("DM-emitted deposit_requested should decode");
    assert_eq!(log.event_name, "DepositRequested");
}

#[test]
fn dispatch_deposit_requested_from_wq_rejected() {
    // A `deposit_requested` event topic coming from the WQ contract must NOT
    // decode as DepositRequested. The RPC filter shouldn't deliver it, but if
    // it ever did (config typo, future overlapping contracts), we fail closed.
    let raw = make_deposit_requested(WQ_CONTRACT);
    assert!(dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None).is_none());
}

#[test]
fn dispatch_withdrawal_requested_from_wq_succeeds() {
    let raw = make_withdrawal_requested(WQ_CONTRACT);
    let log = dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None)
        .expect("WQ-emitted withdrawal_requested should decode");
    assert_eq!(log.event_name, "WithdrawalRequested");
}

#[test]
fn dispatch_request_claimed_from_dm_succeeds() {
    let raw = make_request_claimed(DM_CONTRACT);
    let log = dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None)
        .expect("DM-emitted request_claimed should decode");
    assert_eq!(log.event_name, "RequestClaimed");
}

#[test]
fn dispatch_request_claimed_from_wq_succeeds() {
    // request_queue::claim_request is intentionally shared — must work for both
    // DM and WQ origins.
    let raw = make_request_claimed(WQ_CONTRACT);
    let log = dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None)
        .expect("WQ-emitted request_claimed should decode");
    assert_eq!(log.event_name, "RequestClaimed");
}

#[test]
fn dispatch_vault_deposit_from_splusd_succeeds() {
    let raw = make_vault_deposit(SPLUSD_CONTRACT);
    let log = dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None)
        .expect("splusd-emitted vault deposit should decode");
    assert_eq!(log.event_name, "StakingDeposit");
}

#[test]
fn dispatch_vault_deposit_from_dm_rejected() {
    // The vault event name `deposit` is generic. A `deposit` event from the DM
    // contract must NOT decode as StakingDeposit — the most likely real-world
    // name collision if RPC filtering ever loosens.
    let raw = make_vault_deposit(DM_CONTRACT);
    assert!(dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None).is_none());
}

#[test]
fn dispatch_unknown_contract_returns_none() {
    let raw = make_deposit_requested(UNKNOWN_CONTRACT);
    assert!(dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None).is_none());
}

#[test]
fn dispatch_withdrawal_requested_from_dm_rejected() {
    // Symmetric to dispatch_deposit_requested_from_wq_rejected: a WQ event
    // coming from the DM contract must not decode as WithdrawalRequested.
    let raw = make_withdrawal_requested(DM_CONTRACT);
    assert!(dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None).is_none());
}

#[test]
fn dispatch_request_claimed_from_splusd_rejected() {
    // request_claimed is shared between DM and WQ by design (request_queue
    // library), but the splusd vault never emits it. From splusd, the
    // dispatch tries only vault parsers, both of which reject by event_name.
    let raw = make_request_claimed(SPLUSD_CONTRACT);
    assert!(dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None).is_none());
}

#[test]
fn dispatch_vault_withdraw_from_dm_rejected() {
    // Symmetric to dispatch_vault_deposit_from_dm_rejected: a vault `withdraw`
    // event from the DM contract must not decode as StakingWithdrawal.
    let raw = make_vault_withdraw(DM_CONTRACT);
    assert!(dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None).is_none());
}

// ── i128 boundary values ──────────────────────────────────────────────────────

#[test]
fn i128_boundary_min() {
    let v = i128::MIN;
    let raw = make_raw_event(
        DM_CONTRACT,
        "deposit_requested",
        vec![encode_u128(1), encode_account(USER_G)],
        encode_map_i128(&[("amount", v)]),
    );
    let log = parse_deposit_requested(&raw).expect("should decode with i128::MIN amount");
    assert_eq!(log.params["amount"], v.to_string());
}

#[test]
fn i128_boundary_max() {
    let v = i128::MAX;
    let raw = make_raw_event(
        DM_CONTRACT,
        "deposit_requested",
        vec![encode_u128(u128::MAX)],
        encode_map_i128(&[("amount", v)]),
    );
    // missing user topic → should return None
    assert!(parse_deposit_requested(&raw).is_none());
}

#[test]
fn i128_zero() {
    let raw = make_raw_event(
        DM_CONTRACT,
        "deposit_requested",
        vec![encode_u128(0), encode_account(USER_G)],
        encode_map_i128(&[("amount", 0)]),
    );
    let log = parse_deposit_requested(&raw).expect("should decode with 0 amount");
    assert_eq!(log.params["amount"], "0");
}

// ── dispatch_parser: loan_registry_id routing ────────────────────────────────

const LR_CONTRACT: &str = "CDWGDGLKZRGYPZYVXELOWBHIVRPAHGK3DM6AF4M4J3QKQB47QPNKM2LB";

fn encode_u32(v: u32) -> String {
    ScVal::U32(v).to_xdr_base64(Limits::none()).unwrap()
}

fn make_loan_drawn_event(contract_id: &str) -> RawEvent {
    make_raw_event(
        contract_id,
        "loan_drawn",
        vec![encode_u32(1), encode_account(USER_G)],
        encode_map_string(&[("metadata_uri", "ipfs://QmTest")]),
    )
}

fn encode_map_string(pairs: &[(&str, &str)]) -> String {
    let mut sorted = pairs.to_vec();
    sorted.sort_by_key(|(k, _)| *k);

    let entries: Vec<ScMapEntry> = sorted
        .iter()
        .map(|(k, v)| {
            let key_sym: StringM<32> = (*k).try_into().unwrap();
            let val_str: StringM<{ u32::MAX }> = (*v).try_into().unwrap();
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(key_sym)),
                val: ScVal::String(stellar_xdr::curr::ScString(val_str)),
            }
        })
        .collect();

    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

#[test]
fn loan_registry_branch_routes_to_parsers() {
    // When loan_registry_id is Some and the event comes from that contract,
    // dispatch should decode a LoanDrawn event successfully.
    let raw = make_loan_drawn_event(LR_CONTRACT);
    let log = dispatch_parser(
        &raw,
        DM_CONTRACT,
        WQ_CONTRACT,
        SPLUSD_CONTRACT,
        Some(LR_CONTRACT),
    )
    .expect("loan_drawn from LR contract should decode");
    assert_eq!(log.event_name, "LoanDrawn");
    assert_eq!(log.contract_address, LR_CONTRACT);
    assert_eq!(log.params["loan_id"], "1");
}

#[test]
fn unconfigured_loan_registry_id_skips_branch() {
    // When loan_registry_id is None, a loan_drawn event from the LR contract
    // falls into the unexpected-contract warn+None path.
    let raw = make_loan_drawn_event(LR_CONTRACT);
    assert!(
        dispatch_parser(&raw, DM_CONTRACT, WQ_CONTRACT, SPLUSD_CONTRACT, None).is_none(),
        "loan_drawn with no loan_registry_id configured should return None"
    );
}

// ── log_index synthesis ───────────────────────────────────────────────────────

#[test]
fn synthesise_log_index_basic() {
    use pipeline_worker::indexer::stellar::parsers::synthesise_log_index;
    assert_eq!(synthesise_log_index(0, 0, 0), 0);
    assert_eq!(synthesise_log_index(1, 0, 0), 1000);
    assert_eq!(synthesise_log_index(0, 1, 0), 100);
    assert_eq!(synthesise_log_index(0, 0, 1), 1);
    assert_eq!(synthesise_log_index(2, 3, 4), 2304);
}

#[test]
fn synthesise_log_index_unique_for_realistic_inputs() {
    use pipeline_worker::indexer::stellar::parsers::synthesise_log_index;
    use std::collections::HashSet;

    let mut seen = HashSet::new();
    for tx in 0..10u32 {
        for op in 0..10u32 {
            for ev in 0..10u32 {
                let idx = synthesise_log_index(tx, op, ev);
                assert!(
                    seen.insert(idx),
                    "collision at tx={tx} op={op} ev={ev}: idx={idx}"
                );
                // Must fit in i32 (the DB column type)
                assert!(
                    i32::try_from(idx).is_ok(),
                    "overflow at tx={tx} op={op} ev={ev}"
                );
            }
        }
    }
}
