// spec: docs/references/security-registry-events.md#configuration
use std::sync::Mutex;

use alloy::primitives::{address, Address};
use pipeline_worker::indexer::config::{EvmSecurityRegistry, IndexerJobSettings};
use pipeline_worker::indexer::security_registry_parsers::reject_security_collision;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const CHAIN_ID: i64 = 99_001_938;
const REQUIRED: [&str; 5] = [
    "DEPOSIT_MANAGER_ADDRESS",
    "WITHDRAWAL_QUEUE_ADDRESS",
    "STAKED_PLUSD_ADDRESS",
    "LOAN_REGISTRY_ADDRESS",
    "MINTER_ADDRESS",
];
const KEYS: [&str; 3] = [
    "SECURITY_REGISTRY_ADDRESS",
    "SECURITY_RECORD_NFT_ADDRESS",
    "SECURITY_REGISTRY_READER_ADDRESS",
];
const VALUES: [&str; 3] = [
    "0xB51E7f13420D106946376A67Fe5921C63B09BE15",
    "0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09",
    "0x8e7078c73068F9F3d4e2210cfe5B4981eB7f1b6B",
];

fn ip() -> String {
    format!("CHAIN_{CHAIN_ID}_EVM_INDEXER_")
}

fn load(values: [Option<&str>; 3]) -> anyhow::Result<Option<EvmSecurityRegistry>> {
    let _g = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let p = format!("CHAIN_{CHAIN_ID}_EVM_");
    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "http://localhost:8545");
        for key in REQUIRED {
            std::env::set_var(
                format!("{}{key}", ip()),
                "0x0000000000000000000000000000000000000001",
            );
        }
        for (key, value) in KEYS.iter().zip(values) {
            match value {
                Some(v) => std::env::set_var(format!("{}{key}", ip()), v),
                None => std::env::remove_var(format!("{}{key}", ip())),
            }
        }
    }
    let result = IndexerJobSettings::from_chain_env(CHAIN_ID).map(|s| s.security_registry);
    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        for key in REQUIRED.iter().chain(KEYS.iter()) {
            std::env::remove_var(format!("{}{key}", ip()));
        }
    }
    result
}

#[test]
fn all_unset_or_blank_gives_none() {
    assert_eq!(load([None, None, None]).unwrap(), None);
    assert_eq!(load([Some("   "), Some(""), Some("\t")]).unwrap(), None);
}

#[test]
fn all_three_set_gives_some_and_trims() {
    let s = load([
        Some(&format!("  {}  ", VALUES[0])),
        Some(VALUES[1]),
        Some(VALUES[2]),
    ])
    .unwrap()
    .unwrap();
    assert_eq!(s.registry, VALUES[0].parse::<Address>().unwrap());
    assert_eq!(s.record_nft, VALUES[1].parse::<Address>().unwrap());
    assert_eq!(s.reader, VALUES[2].parse::<Address>().unwrap());
}

#[test]
fn every_partial_combination_fails_naming_the_first_missing_key() {
    for mask in 1u8..7 {
        let values: Vec<Option<&str>> = (0..3)
            .map(|i| (mask & (1 << i) != 0).then_some(VALUES[i]))
            .collect();
        let err = load([values[0], values[1], values[2]])
            .err()
            .unwrap_or_else(|| panic!("mask {mask} should fail"));
        let msg = err.to_string();
        let first_missing = (0..3).find(|i| mask & (1 << i) == 0).unwrap();
        let first_present = (0..3).find(|i| mask & (1 << i) != 0).unwrap();
        assert!(
            msg.starts_with(&format!("{}{}", ip(), KEYS[first_missing])),
            "{msg}"
        );
        assert!(
            msg.contains(&format!(
                "must be set when {}{} is set",
                ip(),
                KEYS[first_present]
            )),
            "{msg}"
        );
        assert!(
            msg.contains("the SecurityRegistry, RecordNft and Reader keys are set together"),
            "{msg}"
        );
    }
}

#[test]
fn a_blank_key_counts_as_missing() {
    let err = load([Some(VALUES[0]), Some("  "), Some(VALUES[2])])
        .err()
        .unwrap();
    assert!(
        err.to_string().contains("SECURITY_RECORD_NFT_ADDRESS"),
        "{err}"
    );
}

#[test]
fn a_malformed_address_fails_naming_its_key() {
    for bad in 0..3 {
        let mut values = [Some(VALUES[0]), Some(VALUES[1]), Some(VALUES[2])];
        values[bad] = Some("0xnot-an-address");
        let err = load(values).err().unwrap();
        let msg = err.to_string();
        assert!(msg.contains(KEYS[bad]), "{msg}");
        assert!(msg.contains("must be a valid EVM address"), "{msg}");
    }
}

const REGISTRY: Address = address!("B51E7f13420D106946376A67Fe5921C63B09BE15");
const NFT: Address = address!("f64302337Ad1F5A66b5f023F8ffd26074a68bA09");
const READER: Address = address!("8e7078c73068F9F3d4e2210cfe5B4981eB7f1b6B");
const DM: Address = address!("0000000000000000000000000000000000000011");
const LOAN_REGISTRY: Address = address!("0000000000000000000000000000000000000012");
const LEGACY_CR: Address = address!("b3D45A8E4816321F806a5eDCB62330CAaC23b26f");

#[test]
fn a_distinct_address_is_accepted() {
    let core = [
        ("DEPOSIT_MANAGER_ADDRESS", DM),
        ("LOAN_REGISTRY_ADDRESS", LOAN_REGISTRY),
    ];
    assert!(reject_security_collision(1, "SECURITY_REGISTRY_ADDRESS", REGISTRY, &core).is_ok());
}

#[test]
fn equality_with_a_core_role_or_between_the_keys_is_the_distinct_role_error() {
    let core = [
        ("DEPOSIT_MANAGER_ADDRESS", DM),
        ("LOAN_REGISTRY_ADDRESS", LOAN_REGISTRY),
        ("COLLATERAL_REGISTRY_ADDRESS", LEGACY_CR),
    ];
    for (label, clash) in [
        ("SECURITY_REGISTRY_ADDRESS", DM),
        ("SECURITY_REGISTRY_ADDRESS", LOAN_REGISTRY),
        ("SECURITY_REGISTRY_ADDRESS", LEGACY_CR),
        ("SECURITY_RECORD_NFT_ADDRESS", LEGACY_CR),
        ("SECURITY_REGISTRY_READER_ADDRESS", DM),
    ] {
        let err = reject_security_collision(CHAIN_ID, label, clash, &core).unwrap_err();
        assert_eq!(
            err.to_string(),
            format!(
                "CHAIN_{CHAIN_ID}_EVM_INDEXER_{label} ({clash}) duplicates another configured contract address; each role must point at a distinct contract"
            )
        );
    }
    let mut taken = core.to_vec();
    taken.push(("SECURITY_REGISTRY_ADDRESS", REGISTRY));
    let err = reject_security_collision(CHAIN_ID, "SECURITY_RECORD_NFT_ADDRESS", REGISTRY, &taken)
        .unwrap_err();
    assert!(err.to_string().contains("SECURITY_RECORD_NFT_ADDRESS"));
    taken.push(("SECURITY_RECORD_NFT_ADDRESS", NFT));
    assert!(
        reject_security_collision(CHAIN_ID, "SECURITY_REGISTRY_READER_ADDRESS", NFT, &taken)
            .is_err()
    );
    assert!(reject_security_collision(
        CHAIN_ID,
        "SECURITY_REGISTRY_READER_ADDRESS",
        READER,
        &taken
    )
    .is_ok());
}
