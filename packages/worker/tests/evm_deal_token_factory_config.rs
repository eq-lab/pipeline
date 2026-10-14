use std::sync::Mutex;

use alloy::primitives::Address;
use pipeline_worker::indexer::{config::IndexerJobSettings, deal_tokens::reject_core_collision};

static ENV_LOCK: Mutex<()> = Mutex::new(());

const CHAIN_ID: i64 = 99_001_485;
const ADDR: &str = "0x2886135EDF68665dC796A33F7723000fe2E0DC81";

fn key(suffix: &str) -> String {
    format!("CHAIN_{CHAIN_ID}_EVM_{suffix}")
}

fn set_required() {
    unsafe {
        std::env::set_var(key("RPC_URL"), "http://localhost:8545");
        for role in [
            "DEPOSIT_MANAGER_ADDRESS",
            "WITHDRAWAL_QUEUE_ADDRESS",
            "STAKED_PLUSD_ADDRESS",
            "LOAN_REGISTRY_ADDRESS",
            "MINTER_ADDRESS",
        ] {
            std::env::set_var(key(&format!("INDEXER_{role}")), ADDR);
        }
    }
}

fn factory_key() -> String {
    key("INDEXER_DEAL_TOKEN_FACTORY_ADDRESS")
}

#[test]
fn factory_address_unset_blank_and_set() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    set_required();

    unsafe { std::env::remove_var(factory_key()) };
    let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
    assert_eq!(s.deal_token_factory_address, None);

    unsafe { std::env::set_var(factory_key(), "  ") };
    let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
    assert_eq!(s.deal_token_factory_address, None);

    unsafe { std::env::set_var(factory_key(), format!(" {ADDR} ")) };
    let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
    assert_eq!(s.deal_token_factory_address.as_deref(), Some(ADDR));

    unsafe { std::env::remove_var(factory_key()) };
}

#[test]
fn factory_equal_to_core_address_is_rejected() {
    let core: Address = ADDR.parse().unwrap();
    let other: Address = "0x0000000000000000000000000000000000000002"
        .parse()
        .unwrap();
    let roles = [("DEPOSIT_MANAGER_ADDRESS", other), ("MINTER_ADDRESS", core)];

    let err = reject_core_collision(CHAIN_ID, core, &roles).unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains(&factory_key()), "{msg}");
    assert!(msg.contains("MINTER_ADDRESS"), "{msg}");

    assert!(reject_core_collision(CHAIN_ID, other, &[("MINTER_ADDRESS", core)]).is_ok());
}
