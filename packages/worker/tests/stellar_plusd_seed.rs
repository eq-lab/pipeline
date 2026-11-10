// spec: docs/references/backend.md#plusd-balance-seed
use std::time::{Duration, Instant};

use pipeline_worker::indexer::stellar::plusd_seed::{
    balance_args, balance_from_sim, decode_balance, holder_key, holder_string, is_issuer_balance,
    is_no_balance_error, next_interval, verify_outcome, PendingRead, PlusdSeedBackoff,
    UnseedableSet, VerifyOutcome, VerifySchedule, PLUSD_IDLE_INTERVAL_CAP, PLUSD_SEED_INTERVAL,
    PLUSD_VERIFY_INTERVAL, UNSEEDABLE_TTL,
};
use pipeline_worker::indexer::stellar::rpc::{SimulateResponse, SimulateResult};
use stellar_strkey::ed25519::{MuxedAccount, PublicKey as Ed25519Pub};
use stellar_strkey::Contract;
use stellar_xdr::curr::{
    AccountId, Int128Parts, Limits, PublicKey, ScAddress, ScVal, Uint256, WriteXdr,
};

fn g_address(byte: u8) -> String {
    Ed25519Pub([byte; 32]).to_string().as_str().to_owned()
}

fn i128_val(v: i128) -> ScVal {
    ScVal::I128(Int128Parts {
        hi: (v >> 64) as i64,
        lo: (v & 0xFFFF_FFFF_FFFF_FFFF) as u64,
    })
}

fn sim_ok(v: &ScVal, ledger: u64) -> SimulateResponse {
    SimulateResponse {
        latest_ledger: ledger,
        transaction_data_xdr_base64: None,
        min_resource_fee: None,
        results: vec![SimulateResult {
            return_value_xdr_base64: v.to_xdr_base64(Limits::none()).unwrap(),
            auth_xdr_base64: vec![],
        }],
        error: None,
    }
}

fn sim_err(msg: &str, ledger: u64) -> SimulateResponse {
    SimulateResponse {
        latest_ledger: ledger,
        transaction_data_xdr_base64: None,
        min_resource_fee: None,
        results: vec![],
        error: Some(msg.to_owned()),
    }
}

fn read(ledger: u64) -> PendingRead {
    PendingRead {
        balance: 5,
        ledger,
        ts: 100,
    }
}

#[test]
fn holder_key_parses_only_g_strkeys() {
    let g = g_address(7);
    assert_eq!(holder_key(&g), Some([7u8; 32]));
    assert_eq!(holder_string(&[7u8; 32]), g);

    let c = Contract([3u8; 32]).to_string().as_str().to_owned();
    assert!(holder_key(&c).is_none());
    let m = MuxedAccount {
        ed25519: [4u8; 32],
        id: 9,
    }
    .to_string()
    .as_str()
    .to_owned();
    assert!(holder_key(&m).is_none());
    assert!(holder_key(&g.to_lowercase()).is_none());

    let mut bad = g.clone();
    let last = bad.pop().unwrap();
    bad.push(if last == 'A' { 'B' } else { 'A' });
    assert!(holder_key(&bad).is_none());
    assert!(holder_key("").is_none());
}

#[test]
fn balance_args_is_one_account_address() {
    let args = balance_args([9u8; 32]);
    assert_eq!(args.len(), 1);
    let ScVal::Address(ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(k))))) =
        &args[0]
    else {
        panic!("not an account address: {:?}", args[0]);
    };
    assert_eq!(k, &[9u8; 32]);
}

#[test]
fn decode_balance_accepts_i128_and_rejects_the_rest() {
    assert_eq!(decode_balance(&i128_val(0)).unwrap(), 0);
    let big = i128::from(u64::MAX) * 5;
    assert_eq!(decode_balance(&i128_val(big)).unwrap(), big);
    assert!(decode_balance(&i128_val(-1)).is_err());
    assert!(decode_balance(&ScVal::U32(5)).is_err());
    assert!(decode_balance(&ScVal::Void).is_err());
}

#[test]
fn no_balance_error_is_contract_13_only() {
    assert!(is_no_balance_error("HostError: Error(Contract, #13)"));
    assert!(!is_no_balance_error("HostError: Error(Contract, #6)"));
    assert!(!is_no_balance_error("HostError: Error(Contract, #130)"));
    assert!(!is_no_balance_error("connection refused"));
}

#[test]
fn issuer_balance_is_i64_max() {
    assert!(is_issuer_balance(i128::from(i64::MAX)));
    assert!(!is_issuer_balance(i128::from(i64::MAX) - 1));
    assert!(!is_issuer_balance(0));
}

#[test]
fn balance_from_sim_reads_a_value_and_maps_a_missing_trustline_to_zero() {
    assert_eq!(
        balance_from_sim(&sim_ok(&i128_val(42), 900)).unwrap(),
        (42, 900)
    );
    assert_eq!(
        balance_from_sim(&sim_err("HostError: Error(Contract, #13)", 901)).unwrap(),
        (0, 901)
    );
    assert!(balance_from_sim(&sim_err("HostError: Error(Contract, #6)", 902)).is_err());
    assert!(balance_from_sim(&sim_ok(&ScVal::Void, 903)).is_err());
}

#[test]
fn verify_outcome_matches_or_drifts() {
    assert_eq!(verify_outcome(Some(7), 7), VerifyOutcome::Matched);
    assert_eq!(verify_outcome(Some(7), 8), VerifyOutcome::Drift);
    assert_eq!(verify_outcome(Some(-3), 0), VerifyOutcome::Drift);
    assert_eq!(verify_outcome(None, 0), VerifyOutcome::Drift);
}

#[test]
fn due_respects_the_cap_and_skips_untracked_pending_not_yet_due_and_disallowed() {
    let now = Instant::now();
    let mut schedule = VerifySchedule::default();
    let keys: Vec<[u8; 32]> = (1..=5u8).map(|b| [b; 32]).collect();
    assert!(schedule.due(now, 3, |_| true).is_empty());
    for k in &keys {
        schedule.track(*k);
    }
    assert_eq!(schedule.due(now, 3, |_| true), keys[..3].to_vec());

    schedule.record(keys[0], read(10));
    schedule.schedule(keys[1], now);
    assert_eq!(schedule.due(now, 10, |_| true), keys[2..].to_vec());
    assert_eq!(
        schedule.due(now + PLUSD_VERIFY_INTERVAL, 10, |_| true),
        keys[1..].to_vec()
    );
    assert_eq!(schedule.due(now, 10, |k| *k != keys[2]), keys[3..].to_vec());
}

#[test]
fn pending_reads_are_reported() {
    let mut schedule = VerifySchedule::default();
    assert!(!schedule.has_pending());
    schedule.record([1; 32], read(10));
    assert!(schedule.has_pending());
    let _ = schedule.ready(11);
    assert!(!schedule.has_pending());
}

#[test]
fn ready_returns_only_fully_indexed_reads_and_removes_them() {
    let mut schedule = VerifySchedule::default();
    schedule.record([1; 32], read(100));
    schedule.record([2; 32], read(200));
    schedule.record([3; 32], read(201));
    let ready = schedule.ready(201);
    assert_eq!(
        ready.iter().map(|(k, _)| k[0]).collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert!(schedule.ready(201).is_empty());
    assert_eq!(schedule.ready(202).len(), 1);
}

#[test]
fn schedule_pushes_the_next_check_six_hours_out() {
    assert_eq!(PLUSD_VERIFY_INTERVAL, Duration::from_hours(6));
    let now = Instant::now();
    let key = [1u8; 32];
    let mut schedule = VerifySchedule::default();
    schedule.record(key, read(10));
    let _ = schedule.ready(11);
    schedule.track(key);
    assert_eq!(schedule.due(now, 1, |_| true), vec![key]);
    schedule.schedule(key, now);
    assert!(schedule.due(now, 1, |_| true).is_empty());
    assert!(schedule
        .due(now + PLUSD_VERIFY_INTERVAL / 2, 1, |_| true)
        .is_empty());
    assert_eq!(
        schedule.due(now + PLUSD_VERIFY_INTERVAL, 1, |_| true),
        vec![key]
    );
}

#[test]
fn backoff_keeps_separate_warn_once_channels_and_resets_them_on_success() {
    let mut backoff = PlusdSeedBackoff::default();
    let key = [1u8; 32];
    let now = Instant::now();
    assert!(backoff.is_due(key, now));
    assert_eq!(backoff.record_failure(key, now), 1);
    assert!(!backoff.is_due(key, now));
    assert!(backoff.first_read_warning(key));
    assert!(!backoff.first_read_warning(key));
    assert!(backoff.first_insert_warning(key));
    assert!(!backoff.first_insert_warning(key));
    assert!(backoff.first_verify_warning(key));
    assert!(!backoff.first_verify_warning(key));
    assert!(backoff.first_read_warning([2u8; 32]));
    backoff.clear(key);
    assert!(backoff.is_due(key, now));
    assert!(backoff.first_read_warning(key));
    assert!(backoff.first_verify_warning(key));
}

#[test]
fn unseedable_holders_expire_after_the_ttl() {
    let now = Instant::now();
    let mut set = UnseedableSet::default();
    assert!(set.active(now).is_empty());
    set.insert("GA".to_owned(), now);
    set.insert("GB".to_owned(), now + Duration::from_hours(1));
    let mut active = set.active(now + Duration::from_hours(1));
    active.sort();
    assert_eq!(active, vec!["GA".to_owned(), "GB".to_owned()]);
    assert_eq!(set.active(now + UNSEEDABLE_TTL), vec!["GB".to_owned()]);
    assert!(set
        .active(now + UNSEEDABLE_TTL + Duration::from_hours(1))
        .is_empty());
}

#[test]
fn idle_cycles_back_off_to_the_cap_and_work_resets_the_cadence() {
    let mut d = PLUSD_SEED_INTERVAL;
    d = next_interval(d, true);
    assert_eq!(d, Duration::from_mins(2));
    d = next_interval(d, true);
    assert_eq!(d, Duration::from_mins(4));
    d = next_interval(d, true);
    assert_eq!(d, PLUSD_IDLE_INTERVAL_CAP);
    assert_eq!(next_interval(d, true), PLUSD_IDLE_INTERVAL_CAP);
    assert_eq!(next_interval(d, false), PLUSD_SEED_INTERVAL);
}
