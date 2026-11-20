// spec: docs/references/backend.md#plusd-transfer-indexing
mod deal_token_support;

use std::sync::Mutex;

use alloy::{
    primitives::{address, Address, U256},
    sol_types::SolEvent,
};
use deal_token_support::*;
use pipeline_worker::indexer::config::IndexerJobSettings;
use pipeline_worker::indexer::deal_tokens::DealTokenRegistry;
use pipeline_worker::indexer::plusd_transfers::{
    parse_plusd_transfer, plusd_transfer_filter, reject_plusd_collision,
};
use pipeline_worker::indexer::poller::DynamicAddressSource;
use shared::contract_logs_repo::DealRegistrationRow;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const PLUSD: Address = address!("a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1");
const OTHER: Address = address!("dac17f958d2ee523a2206206994597c13d831ec7");
const LP: Address = address!("fb6916095ca1df60bb79ce92ce3ea74c37c5d359");
const VAULT: Address = address!("5000000000000000000000000000000000000001");

const CHAIN_ID: i64 = 99_018_660;
const CORE: &str = "0x2886135EDF68665dC796A33F7723000fe2E0DC81";

fn key(suffix: &str) -> String {
    format!("CHAIN_{CHAIN_ID}_EVM_{suffix}")
}

fn with_env<F: FnOnce()>(plusd: Option<&str>, f: F) {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    unsafe {
        std::env::set_var(key("RPC_URL"), "http://localhost:8545");
        for role in [
            "DEPOSIT_MANAGER_ADDRESS",
            "WITHDRAWAL_QUEUE_ADDRESS",
            "STAKED_PLUSD_ADDRESS",
            "LOAN_REGISTRY_ADDRESS",
            "MINTER_ADDRESS",
        ] {
            std::env::set_var(key(&format!("INDEXER_{role}")), CORE);
        }
        match plusd {
            Some(v) => std::env::set_var(key("INDEXER_PLUSD_ADDRESS"), v),
            None => std::env::remove_var(key("INDEXER_PLUSD_ADDRESS")),
        }
    }
    f();
    unsafe {
        std::env::remove_var(key("INDEXER_PLUSD_ADDRESS"));
        std::env::remove_var(key("RPC_URL"));
        for role in [
            "DEPOSIT_MANAGER_ADDRESS",
            "WITHDRAWAL_QUEUE_ADDRESS",
            "STAKED_PLUSD_ADDRESS",
            "LOAN_REGISTRY_ADDRESS",
            "MINTER_ADDRESS",
        ] {
            std::env::remove_var(key(&format!("INDEXER_{role}")));
        }
    }
}

#[test]
fn the_filter_is_the_plusd_address_plus_the_transfer_topic() {
    let filter = plusd_transfer_filter(PLUSD);
    assert!(filter.address.matches(&PLUSD));
    assert!(!filter.address.matches(&OTHER));
    assert!(filter.topics[0].matches(&Transfer::SIGNATURE_HASH));
    assert!(!filter.topics[0].is_empty());
    assert!(filter.topics[1].is_empty());
    assert!(filter.topics[2].is_empty());
}

#[test]
fn a_mint_has_a_null_from() {
    let log = transfer(PLUSD, Address::ZERO, LP, 1_500_000, 7, 3);
    let ev = parse_plusd_transfer(&log, PLUSD).unwrap();
    assert_eq!(ev.event_name, "PlusdTransfer");
    assert_eq!(ev.contract_address, PLUSD);
    assert_eq!(ev.block_number, 7);
    assert_eq!(ev.log_index, 3);
    assert_eq!(ev.params["kind"], "mint");
    assert!(ev.params["from"].is_null());
    assert_eq!(ev.params["to"], LP.to_checksum(None));
    assert_eq!(ev.params["amount"], "1500000");
}

#[test]
fn a_burn_has_a_null_to() {
    let ev = parse_plusd_transfer(&transfer(PLUSD, LP, Address::ZERO, 9, 1, 0), PLUSD).unwrap();
    assert_eq!(ev.params["kind"], "burn");
    assert_eq!(ev.params["from"], LP.to_checksum(None));
    assert!(ev.params["to"].is_null());
}

#[test]
fn a_transfer_has_checksummed_sides() {
    let ev = parse_plusd_transfer(&transfer(PLUSD, LP, VAULT, 5, 1, 0), PLUSD).unwrap();
    assert_eq!(ev.params["kind"], "transfer");
    assert_eq!(ev.params["from"], LP.to_checksum(None));
    assert_eq!(ev.params["to"], VAULT.to_checksum(None));
    let mut keys: Vec<&str> = ev
        .params
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["amount", "from", "kind", "to"]);
}

#[test]
fn another_address_gives_none() {
    assert!(parse_plusd_transfer(&transfer(OTHER, LP, VAULT, 5, 1, 0), PLUSD).is_none());
}

#[test]
fn an_amount_above_i128_is_stored_as_its_decimal_string() {
    let ev = Transfer {
        from: LP,
        to: VAULT,
        value: U256::MAX,
    };
    let log = make_log(PLUSD, ev.encode_log_data(), 2, 0);
    let parsed = parse_plusd_transfer(&log, PLUSD).unwrap();
    assert_eq!(parsed.params["amount"], U256::MAX.to_string());
}

#[test]
fn a_collision_names_the_clashing_role() {
    let roles = [("MINTER_ADDRESS", PLUSD), ("DEPOSIT_MANAGER_ADDRESS", LP)];
    let msg = reject_plusd_collision(1, PLUSD, &roles)
        .unwrap_err()
        .to_string();
    assert!(msg.contains("CHAIN_1_EVM_INDEXER_PLUSD_ADDRESS"), "{msg}");
    assert!(
        msg.contains("must not equal CHAIN_1_EVM_INDEXER_MINTER_ADDRESS ("),
        "{msg}"
    );
    assert!(reject_plusd_collision(1, PLUSD, &[("MINTER_ADDRESS", LP)]).is_ok());
}

#[test]
fn an_asset_collision_names_the_job_level_key() {
    let msg = reject_plusd_collision(7, PLUSD, &[("ASSET_ADDRESS", PLUSD)])
        .unwrap_err()
        .to_string();
    assert!(
        msg.contains("must not equal JOB_INDEXER_EVM_7_ASSET_ADDRESS ("),
        "{msg}"
    );
    assert!(!msg.contains("EVM_INDEXER_ASSET_ADDRESS"), "{msg}");
}

#[test]
fn plusd_is_never_claimed_as_a_dynamic_deal_token() {
    let registry = DealTokenRegistry::new(FACTORY).excluding(Some(PLUSD));
    let log = deal_registered(U256::from(1u64), PLUSD, CARGO, 10, 0);
    assert_eq!(registry.observe(&log), vec![CARGO]);
    assert!(registry.lookup(&PLUSD).is_none());
    assert!(!registry.addresses().contains(&PLUSD));
    let seeded = DealTokenRegistry::new(FACTORY).excluding(Some(PLUSD));
    seeded.seed(&[DealRegistrationRow {
        loan_id: "2".to_owned(),
        debt: PLUSD.to_checksum(None),
        cargo: None,
    }]);
    assert!(seeded.addresses().is_empty());
}

#[test]
fn the_config_key_parses_and_is_off_when_unset_or_blank() {
    with_env(None, || {
        let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
        assert_eq!(s.plusd_address, None);
    });
    with_env(Some("  "), || {
        let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
        assert_eq!(s.plusd_address, None);
    });
    with_env(Some(&PLUSD.to_checksum(None).to_lowercase()), || {
        let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
        assert_eq!(s.plusd_address, Some(PLUSD));
    });
}

#[test]
fn a_malformed_key_is_a_startup_error() {
    with_env(Some("not-an-address"), || {
        let err = IndexerJobSettings::from_chain_env(CHAIN_ID)
            .err()
            .expect("should fail");
        assert!(err.to_string().contains("PLUSD_ADDRESS"), "{err}");
    });
}
