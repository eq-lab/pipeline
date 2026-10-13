// spec: docs/superpowers/specs/2026-10-12-multi-chain-price-poller-design.md#settings
use std::sync::{Mutex, MutexGuard, PoisonError};

use pipeline_worker::price_poller::config::{
    EvmPricePollerSettings, PricePollerSettings, StellarPricePollerSettings,
};

static ENV_LOCK: Mutex<()> = Mutex::new(());

const EVM_A: i64 = 71_001;
const EVM_B: i64 = 71_002;
const STELLAR_TEST: i64 = 99_000_001;
const STELLAR_OTHER: i64 = 79_000_001;

const VAULT_LOWER: &str = "0x87cd1002bdb9401423cb50a860314fc8f11440cd";
const VAULT_CHECKSUM: &str = "0x87CD1002bdB9401423cb50A860314FC8f11440Cd";
const VAULT_B: &str = "0x0000000000000000000000000000000000000b0b";
const STELLAR_VAULT: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const STELLAR_VAULT_BAD_CRC: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW6";
const STELLAR_ACCOUNT: &str = "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU";

const IDS: [i64; 4] = [EVM_A, EVM_B, STELLAR_TEST, STELLAR_OTHER];

struct Env {
    _lock: MutexGuard<'static, ()>,
}

fn clear_all() {
    let prefixes: Vec<String> = IDS.iter().map(|id| format!("CHAIN_{id}_")).collect();
    let stale: Vec<String> = std::env::vars()
        .map(|(k, _)| k)
        .filter(|k| prefixes.iter().any(|p| k.starts_with(p)))
        .collect();
    unsafe {
        for k in stale {
            std::env::remove_var(k);
        }
        std::env::remove_var("CHAINS");
        for k in old_job_keys() {
            std::env::remove_var(k);
        }
    }
}

fn old_job_keys() -> Vec<String> {
    [
        "START_BLOCK",
        "BLOCK_INTERVAL",
        "POLL_INTERVAL_SECS",
        "RPC_DELAY_MS",
    ]
    .iter()
    .map(|k| ["JOB_PRICE_", "POLLER_", k].concat())
    .collect()
}

impl Env {
    fn new() -> Self {
        let lock = ENV_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        clear_all();
        Env { _lock: lock }
    }
}

fn set(key: &str, value: &str) {
    unsafe { std::env::set_var(key, value) };
}

impl Drop for Env {
    fn drop(&mut self) {
        clear_all();
    }
}

fn ek(id: i64, suffix: &str) -> String {
    format!("CHAIN_{id}_EVM_{suffix}")
}

fn sk(id: i64, suffix: &str) -> String {
    format!("CHAIN_{id}_STELLAR_{suffix}")
}

fn evm_min(id: i64) {
    set(&ek(id, "PRICE_POLLER_STAKED_PLUSD_ADDRESS"), VAULT_LOWER);
    set(&ek(id, "RPC_URL"), "http://chain-wide.example:8545");
}

fn stellar_min(id: i64) {
    set(&sk(id, "PRICE_POLLER_STAKED_PLUSD_ADDRESS"), STELLAR_VAULT);
    set(&sk(id, "RPC_URL"), "http://chain-wide.example:8000");
}

fn evm_err(id: i64) -> String {
    match EvmPricePollerSettings::from_chain_env(id) {
        Ok(_) => panic!("expected an error"),
        Err(e) => format!("{e:#}"),
    }
}

fn stellar_err(id: i64) -> String {
    match StellarPricePollerSettings::from_chain_env(id) {
        Ok(_) => panic!("expected an error"),
        Err(e) => format!("{e:#}"),
    }
}

#[test]
fn evm_defaults_with_required_keys_only() {
    let _env = Env::new();
    evm_min(EVM_A);
    let s = EvmPricePollerSettings::from_chain_env(EVM_A).unwrap();
    assert_eq!(s.chain_id, EVM_A);
    assert_eq!(s.rpc_url, "http://chain-wide.example:8545");
    assert_eq!(s.start_block, 0);
    assert_eq!(s.block_interval, 300);
    assert_eq!(s.poll_interval_secs, 60);
    assert_eq!(s.rpc_delay_ms, 200);
}

#[test]
fn evm_component_keys_win() {
    let _env = Env::new();
    evm_min(EVM_A);
    set(
        &ek(EVM_A, "PRICE_POLLER_RPC_URL"),
        "http://poller.example:8545",
    );
    set(&ek(EVM_A, "START_BLOCK"), "5");
    set(&ek(EVM_A, "PRICE_POLLER_START_BLOCK"), "3982150");
    set(&ek(EVM_A, "PRICE_POLLER_BLOCK_INTERVAL"), "25");
    set(&ek(EVM_A, "PRICE_POLLER_POLL_INTERVAL_SECS"), "30");
    set(&ek(EVM_A, "PRICE_POLLER_RPC_DELAY_MS"), "1000");
    let s = EvmPricePollerSettings::from_chain_env(EVM_A).unwrap();
    assert_eq!(s.rpc_url, "http://poller.example:8545");
    assert_eq!(s.start_block, 3_982_150);
    assert_eq!(s.block_interval, 25);
    assert_eq!(s.poll_interval_secs, 30);
    assert_eq!(s.rpc_delay_ms, 1000);
}

#[test]
fn evm_rpc_url_missing_names_both_keys() {
    let _env = Env::new();
    set(&ek(EVM_A, "PRICE_POLLER_STAKED_PLUSD_ADDRESS"), VAULT_LOWER);
    let e = evm_err(EVM_A);
    assert!(e.contains(&ek(EVM_A, "PRICE_POLLER_RPC_URL")), "{e}");
    assert!(e.contains(&ek(EVM_A, "RPC_URL")), "{e}");
}

#[test]
fn evm_start_block_falls_back_to_chain_wide() {
    let _env = Env::new();
    evm_min(EVM_A);
    set(&ek(EVM_A, "START_BLOCK"), "1234");
    assert_eq!(
        EvmPricePollerSettings::from_chain_env(EVM_A)
            .unwrap()
            .start_block,
        1234
    );
}

#[test]
fn evm_start_block_chain_wide_malformed_is_error() {
    let _env = Env::new();
    evm_min(EVM_A);
    set(&ek(EVM_A, "START_BLOCK"), "abc");
    assert!(evm_err(EVM_A).contains(&ek(EVM_A, "START_BLOCK")));
}

#[test]
fn evm_address_missing_or_blank_is_error() {
    let _env = Env::new();
    set(&ek(EVM_A, "RPC_URL"), "http://chain-wide.example:8545");
    let key = ek(EVM_A, "PRICE_POLLER_STAKED_PLUSD_ADDRESS");
    assert!(evm_err(EVM_A).contains(&key));
    set(&key, "   ");
    assert!(evm_err(EVM_A).contains(&key));
}

#[test]
fn evm_address_malformed_is_error() {
    let _env = Env::new();
    set(&ek(EVM_A, "RPC_URL"), "http://chain-wide.example:8545");
    let key = ek(EVM_A, "PRICE_POLLER_STAKED_PLUSD_ADDRESS");
    for bad in [
        "0x123",
        "87cd1002bdb9401423cb50a860314fc8f11440cd",
        "0xZZcd1002bdb9401423cb50a860314fc8f11440cd",
    ] {
        set(&key, bad);
        assert!(evm_err(EVM_A).contains(&key), "{bad}");
    }
}

#[test]
fn evm_numeric_validation() {
    let _env = Env::new();
    evm_min(EVM_A);
    let bi = ek(EVM_A, "PRICE_POLLER_BLOCK_INTERVAL");
    let pi = ek(EVM_A, "PRICE_POLLER_POLL_INTERVAL_SECS");
    let rd = ek(EVM_A, "PRICE_POLLER_RPC_DELAY_MS");
    let sb = ek(EVM_A, "PRICE_POLLER_START_BLOCK");

    set(&bi, "fast");
    assert!(evm_err(EVM_A).contains(&bi));
    set(&bi, "0");
    assert!(evm_err(EVM_A).contains(&bi));
    set(&bi, "300");

    set(&pi, "0");
    assert!(evm_err(EVM_A).contains(&pi));
    set(&pi, "60");

    set(&rd, "0");
    set(&sb, "0");
    let s = EvmPricePollerSettings::from_chain_env(EVM_A).unwrap();
    assert_eq!(s.rpc_delay_ms, 0);
    assert_eq!(s.start_block, 0);
}

#[test]
fn evm_blank_falls_through_and_padding_is_trimmed() {
    let _env = Env::new();
    evm_min(EVM_A);
    set(&ek(EVM_A, "PRICE_POLLER_RPC_URL"), "  ");
    set(&ek(EVM_A, "PRICE_POLLER_BLOCK_INTERVAL"), "");
    set(&ek(EVM_A, "PRICE_POLLER_POLL_INTERVAL_SECS"), " 15 ");
    let s = EvmPricePollerSettings::from_chain_env(EVM_A).unwrap();
    assert_eq!(s.rpc_url, "http://chain-wide.example:8545");
    assert_eq!(s.block_interval, 300);
    assert_eq!(s.poll_interval_secs, 15);
}

#[test]
fn evm_malformed_rpc_url_is_error() {
    let _env = Env::new();
    evm_min(EVM_A);
    set(&ek(EVM_A, "PRICE_POLLER_RPC_URL"), "not a url");
    assert!(evm_err(EVM_A).contains(&ek(EVM_A, "PRICE_POLLER_RPC_URL")));
}

#[test]
fn evm_old_job_keys_are_ignored() {
    let _env = Env::new();
    evm_min(EVM_A);
    for (key, value) in old_job_keys().iter().zip(["777", "11", "13", "9999"]) {
        set(key, value);
    }
    let s = EvmPricePollerSettings::from_chain_env(EVM_A).unwrap();
    assert_eq!(s.start_block, 0);
    assert_eq!(s.block_interval, 300);
    assert_eq!(s.poll_interval_secs, 60);
    assert_eq!(s.rpc_delay_ms, 200);
}

#[test]
fn evm_address_round_trips_to_checksum_form() {
    let _env = Env::new();
    evm_min(EVM_A);
    let s = EvmPricePollerSettings::from_chain_env(EVM_A).unwrap();
    assert_eq!(s.staked_plusd_address.to_checksum(None), VAULT_CHECKSUM);
}

#[test]
fn stellar_testnet_defaults() {
    let _env = Env::new();
    stellar_min(STELLAR_TEST);
    let s = StellarPricePollerSettings::from_chain_env(STELLAR_TEST).unwrap();
    assert_eq!(s.chain_id, STELLAR_TEST);
    assert_eq!(s.rpc_url, "http://chain-wide.example:8000");
    assert_eq!(s.network_passphrase, "Test SDF Network ; September 2015");
    assert_eq!(s.staked_plusd_address, STELLAR_VAULT);
    assert_eq!(s.poll_interval_secs, 60);
}

#[test]
fn stellar_component_keys_win_over_chain_wide() {
    let _env = Env::new();
    stellar_min(STELLAR_OTHER);
    set(
        &sk(STELLAR_OTHER, "NETWORK_PASSPHRASE"),
        "chain-wide passphrase",
    );
    let s = StellarPricePollerSettings::from_chain_env(STELLAR_OTHER).unwrap();
    assert_eq!(s.rpc_url, "http://chain-wide.example:8000");
    assert_eq!(s.network_passphrase, "chain-wide passphrase");

    set(
        &sk(STELLAR_OTHER, "PRICE_POLLER_RPC_URL"),
        "http://poller.example:8000",
    );
    set(
        &sk(STELLAR_OTHER, "PRICE_POLLER_NETWORK_PASSPHRASE"),
        "poller passphrase",
    );
    let s = StellarPricePollerSettings::from_chain_env(STELLAR_OTHER).unwrap();
    assert_eq!(s.rpc_url, "http://poller.example:8000");
    assert_eq!(s.network_passphrase, "poller passphrase");
}

#[test]
fn stellar_non_testnet_without_passphrase_is_error() {
    let _env = Env::new();
    stellar_min(STELLAR_OTHER);
    assert!(stellar_err(STELLAR_OTHER).contains("NETWORK_PASSPHRASE"));
}

#[test]
fn stellar_poll_interval_validation() {
    let _env = Env::new();
    stellar_min(STELLAR_TEST);
    let key = sk(STELLAR_TEST, "PRICE_POLLER_POLL_INTERVAL_SECS");
    set(&key, "10");
    assert_eq!(
        StellarPricePollerSettings::from_chain_env(STELLAR_TEST)
            .unwrap()
            .poll_interval_secs,
        10
    );
    set(&key, "0");
    assert!(stellar_err(STELLAR_TEST).contains(&key));
    set(&key, "soon");
    assert!(stellar_err(STELLAR_TEST).contains(&key));
}

#[test]
fn stellar_address_validation() {
    let _env = Env::new();
    set(
        &sk(STELLAR_TEST, "RPC_URL"),
        "http://chain-wide.example:8000",
    );
    let key = sk(STELLAR_TEST, "PRICE_POLLER_STAKED_PLUSD_ADDRESS");
    assert!(stellar_err(STELLAR_TEST).contains(&key));

    let too_short = &STELLAR_VAULT[..55];
    let bad_alphabet = format!("{}1", &STELLAR_VAULT[..55]);
    for bad in [
        STELLAR_ACCOUNT,
        too_short,
        bad_alphabet.as_str(),
        STELLAR_VAULT_BAD_CRC,
    ] {
        set(&key, bad);
        assert!(stellar_err(STELLAR_TEST).contains(&key), "{bad}");
    }

    set(&key, &STELLAR_VAULT.to_lowercase());
    let s = StellarPricePollerSettings::from_chain_env(STELLAR_TEST).unwrap();
    assert_eq!(s.staked_plusd_address, STELLAR_VAULT);
}

#[test]
fn stellar_old_keys_are_ignored() {
    let _env = Env::new();
    set(
        &sk(STELLAR_TEST, "PRICE_POLLER_STAKED_PLUSD_ADDRESS"),
        STELLAR_VAULT,
    );
    let old = |suffix: &str| {
        [
            "CHAIN_",
            &STELLAR_TEST.to_string(),
            "_PRICE_POLLER_",
            "STELLAR_",
            suffix,
        ]
        .concat()
    };
    set(&old("RPC_URL"), "http://old.example:8000");
    set(&old("NETWORK_PASSPHRASE"), "old passphrase");
    set(&old("INTERVAL_SECS"), "7");
    assert!(stellar_err(STELLAR_TEST).contains("RPC_URL"));

    set(
        &sk(STELLAR_TEST, "RPC_URL"),
        "http://chain-wide.example:8000",
    );
    let s = StellarPricePollerSettings::from_chain_env(STELLAR_TEST).unwrap();
    assert_eq!(s.rpc_url, "http://chain-wide.example:8000");
    assert_eq!(s.network_passphrase, "Test SDF Network ; September 2015");
    assert_eq!(s.poll_interval_secs, 60);
}

#[test]
fn dispatch_builds_one_arm_per_chain() {
    let _env = Env::new();
    set("CHAINS", &format!("{EVM_A},{STELLAR_TEST}"));
    evm_min(EVM_A);
    set(&ek(EVM_A, "PRICE_POLLER_BLOCK_INTERVAL"), "25");
    set(&format!("CHAIN_{STELLAR_TEST}_TYPE"), "stellar");
    stellar_min(STELLAR_TEST);
    set(&sk(STELLAR_TEST, "PRICE_POLLER_POLL_INTERVAL_SECS"), "10");

    let all = PricePollerSettings::all_from_env().unwrap();
    assert_eq!(all.len(), 2);
    match &all[0] {
        PricePollerSettings::Evm(s) => {
            assert_eq!(s.chain_id, EVM_A);
            assert_eq!(s.block_interval, 25);
        }
        PricePollerSettings::Stellar(_) => panic!("expected Evm"),
    }
    match &all[1] {
        PricePollerSettings::Stellar(s) => {
            assert_eq!(s.chain_id, STELLAR_TEST);
            assert_eq!(s.poll_interval_secs, 10);
        }
        PricePollerSettings::Evm(_) => panic!("expected Stellar"),
    }
    assert_eq!(all[0].chain_id(), EVM_A);
    assert_eq!(all[1].chain_id(), STELLAR_TEST);
}

#[test]
fn dispatch_two_evm_chains_are_independent() {
    let _env = Env::new();
    set("CHAINS", &format!("{EVM_A},{EVM_B}"));
    evm_min(EVM_A);
    evm_min(EVM_B);
    set(&ek(EVM_B, "PRICE_POLLER_STAKED_PLUSD_ADDRESS"), VAULT_B);
    set(&ek(EVM_A, "PRICE_POLLER_BLOCK_INTERVAL"), "25");
    set(&ek(EVM_B, "PRICE_POLLER_BLOCK_INTERVAL"), "600");
    set(&ek(EVM_B, "PRICE_POLLER_START_BLOCK"), "42");

    let all = PricePollerSettings::all_from_env().unwrap();
    let (PricePollerSettings::Evm(a), PricePollerSettings::Evm(b)) = (&all[0], &all[1]) else {
        panic!("expected two Evm arms");
    };
    assert_eq!((a.block_interval, a.start_block), (25, 0));
    assert_eq!((b.block_interval, b.start_block), (600, 42));
    assert_ne!(a.staked_plusd_address, b.staked_plusd_address);
}

#[test]
fn dispatch_missing_address_fails_startup() {
    let _env = Env::new();
    set("CHAINS", &EVM_A.to_string());
    set(&ek(EVM_A, "RPC_URL"), "http://chain-wide.example:8545");
    assert!(PricePollerSettings::all_from_env().is_err());
}

#[test]
fn dispatch_rejects_stellar_key_on_evm_chain() {
    let _env = Env::new();
    set("CHAINS", &EVM_A.to_string());
    evm_min(EVM_A);
    set(&sk(EVM_A, "PRICE_POLLER_RPC_URL"), "http://stray.example");
    assert!(PricePollerSettings::all_from_env().is_err());
}
