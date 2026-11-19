// spec: docs/references/access-manager-events.md#evm-configuration
use std::sync::Mutex;

use alloy::primitives::{address, Address};
use pipeline_worker::indexer::access_manager_evm_parsers::reject_access_manager_collision;
use pipeline_worker::indexer::config::{EvmSecurityRegistry, IndexerJobSettings};

static ENV_LOCK: Mutex<()> = Mutex::new(());

const CHAIN_ID: i64 = 99_001_939;
const REQUIRED: [&str; 5] = [
    "DEPOSIT_MANAGER_ADDRESS",
    "WITHDRAWAL_QUEUE_ADDRESS",
    "STAKED_PLUSD_ADDRESS",
    "LOAN_REGISTRY_ADDRESS",
    "MINTER_ADDRESS",
];
const AM: &str = "0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992";
const SECURITY_KEYS: [&str; 3] = [
    "SECURITY_REGISTRY_ADDRESS",
    "SECURITY_RECORD_NFT_ADDRESS",
    "SECURITY_REGISTRY_READER_ADDRESS",
];

fn ip() -> String {
    format!("CHAIN_{CHAIN_ID}_EVM_INDEXER_")
}

fn am_key() -> String {
    format!("{}ACCESS_MANAGER_ADDRESS", ip())
}

fn addr(n: u8) -> String {
    format!("0x{n:040x}")
}

fn reset() {
    let p = format!("CHAIN_{CHAIN_ID}_EVM_");
    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "http://localhost:8545");
        for (i, key) in REQUIRED.iter().enumerate() {
            std::env::set_var(format!("{}{key}", ip()), addr(i as u8 + 1));
        }
        std::env::remove_var(am_key());
        for key in SECURITY_KEYS {
            std::env::remove_var(format!("{}{key}", ip()));
        }
    }
}

fn set(key: &str, value: &str) {
    unsafe { std::env::set_var(key, value) };
}

fn load() -> anyhow::Result<IndexerJobSettings> {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    reset();
    IndexerJobSettings::from_chain_env(CHAIN_ID)
}

fn load_with(values: &[(String, &str)]) -> anyhow::Result<IndexerJobSettings> {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    reset();
    for (key, value) in values {
        set(key, value);
    }
    IndexerJobSettings::from_chain_env(CHAIN_ID)
}

#[test]
fn an_unset_key_gives_none() {
    assert_eq!(load().unwrap().access_manager_address, None);
}

#[test]
fn a_whitespace_only_key_gives_none() {
    let s = load_with(&[(am_key(), "   ")]).unwrap();
    assert_eq!(s.access_manager_address, None);
}

#[test]
fn a_valid_key_gives_some() {
    let s = load_with(&[(am_key(), AM)]).unwrap();
    assert_eq!(
        s.access_manager_address,
        Some(AM.parse::<Address>().unwrap())
    );
}

#[test]
fn an_invalid_key_is_an_error_naming_the_key() {
    let err = load_with(&[(am_key(), "0x1234")])
        .err()
        .expect("should fail");
    assert!(err.to_string().contains("ACCESS_MANAGER_ADDRESS"), "{err}");
}

#[test]
fn the_key_coexists_with_the_security_and_loan_registry_keys() {
    let keys: Vec<(String, String)> = SECURITY_KEYS
        .iter()
        .enumerate()
        .map(|(i, k)| (format!("{}{k}", ip()), addr(i as u8 + 20)))
        .collect();
    let mut values: Vec<(String, &str)> =
        keys.iter().map(|(k, v)| (k.clone(), v.as_str())).collect();
    values.push((am_key(), AM));
    let s = load_with(&values).unwrap();
    assert_eq!(
        s.access_manager_address,
        Some(AM.parse::<Address>().unwrap())
    );
    assert_eq!(
        s.security_registry,
        Some(EvmSecurityRegistry {
            registry: addr(20).parse().unwrap(),
            record_nft: addr(21).parse().unwrap(),
            reader: addr(22).parse().unwrap(),
        })
    );
    assert_eq!(s.loan_registry_address, addr(4));
}

#[test]
fn security_keys_all_unset_give_none() {
    assert_eq!(load().unwrap().security_registry, None);
}

#[test]
fn a_partial_security_group_names_the_missing_key() {
    let registry = format!("{}SECURITY_REGISTRY_ADDRESS", ip());
    let a = addr(20);
    let err = load_with(&[(registry, &a)]).err().expect("should fail");
    let msg = err.to_string();
    assert!(
        msg.contains("SECURITY_RECORD_NFT_ADDRESS must be set when"),
        "{msg}"
    );
    assert!(msg.contains("SECURITY_REGISTRY_ADDRESS is set"), "{msg}");
}

#[test]
fn an_invalid_security_key_is_an_error_naming_the_key() {
    let values: Vec<(String, &str)> = SECURITY_KEYS
        .iter()
        .map(|k| (format!("{}{k}", ip()), "0x1234"))
        .collect();
    let err = load_with(&values).err().expect("should fail");
    assert!(
        err.to_string().contains("SECURITY_REGISTRY_ADDRESS"),
        "{err}"
    );
}

fn roles() -> Vec<(&'static str, Address)> {
    vec![
        (
            "DEPOSIT_MANAGER_ADDRESS",
            address!("0000000000000000000000000000000000000011"),
        ),
        (
            "LOAN_REGISTRY_ADDRESS",
            address!("0000000000000000000000000000000000000012"),
        ),
        (
            "MINTER_ADDRESS",
            address!("0000000000000000000000000000000000000013"),
        ),
        (
            "COLLATERAL_REGISTRY_ADDRESS",
            address!("0000000000000000000000000000000000000014"),
        ),
        (
            "DEAL_TOKEN_FACTORY_ADDRESS",
            address!("0000000000000000000000000000000000000015"),
        ),
        (
            "PLUSD_ADDRESS",
            address!("0000000000000000000000000000000000000016"),
        ),
        (
            "ASSET_ADDRESS",
            address!("0000000000000000000000000000000000000017"),
        ),
        (
            "SECURITY_REGISTRY_ADDRESS",
            address!("0000000000000000000000000000000000000018"),
        ),
        (
            "SECURITY_RECORD_NFT_ADDRESS",
            address!("0000000000000000000000000000000000000019"),
        ),
        (
            "SECURITY_REGISTRY_READER_ADDRESS",
            address!("000000000000000000000000000000000000001a"),
        ),
    ]
}

#[test]
fn a_collision_with_each_role_names_both_keys() {
    for (role, clash) in roles() {
        let err =
            reject_access_manager_collision(CHAIN_ID, clash, &roles()).expect_err("should fail");
        let msg = err.to_string();
        assert!(msg.contains(&am_key()), "{msg}");
        let named = if role == "ASSET_ADDRESS" {
            format!("JOB_INDEXER_EVM_{CHAIN_ID}_ASSET_ADDRESS")
        } else {
            format!("{}{role}", ip())
        };
        assert!(msg.contains(&named), "{msg}");
    }
}

#[test]
fn a_distinct_address_passes() {
    let am: Address = AM.parse().unwrap();
    assert!(reject_access_manager_collision(CHAIN_ID, am, &roles()).is_ok());
    assert!(reject_access_manager_collision(CHAIN_ID, am, &[]).is_ok());
}
