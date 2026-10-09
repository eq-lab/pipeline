//! Per-chain config parsing for `EvmRelayerSettings`, mirroring `stellar_relayer_config.rs`.
//! See `docs/exec-plans/active/evm-relayer-v5.md`.

use std::sync::Mutex;

use pipeline_worker::relayer::config::EvmRelayerSettings;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const ID: i64 = 560_048;
const RPC_URL: &str = "https://rpc.hoodi.example";
const REGISTRY: &str = "0x156522dD43cda74D0489F8B601a5622D4bbBB9A0";
const MINTER: &str = "0xE75814d9618285AE4d789D4424672597DC494D3E";
const OTHER_MINTER: &str = "0xc877b6071EBAaBa11256896dE4C1eA3A6278c1d4";

fn lock() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn clear_env() {
    unsafe {
        for key in [
            "JOB_RELAYER_EVM_BATCH_SIZE",
            "JOB_RELAYER_INTERVAL_SECS",
            "JOB_RELAYER_SUMSUB_ENABLED",
            "CRYSTAL_ENABLED",
        ] {
            std::env::remove_var(key);
        }
        for suffix in [
            "ETH_RPC_URL",
            "YIELD_MINTER_CONTRACTS",
            "RELAYER_ETH_RPC_URL",
            "RELAYER_SIGNER_KEY",
            "RELAYER_REGISTRY_ADDRESS",
        ] {
            std::env::remove_var(format!("CHAIN_{ID}_{suffix}"));
        }
    }
}

fn set_base_env() {
    unsafe {
        std::env::set_var(format!("CHAIN_{ID}_RELAYER_ETH_RPC_URL"), RPC_URL);
        std::env::set_var(format!("CHAIN_{ID}_RELAYER_SIGNER_KEY"), "0xabc");
        std::env::set_var(format!("CHAIN_{ID}_RELAYER_REGISTRY_ADDRESS"), REGISTRY);
    }
}

fn set_minters(raw: &str) {
    unsafe { std::env::set_var(format!("CHAIN_{ID}_YIELD_MINTER_CONTRACTS"), raw) };
}

#[test]
fn boots_with_only_rpc_signer_and_registry() {
    let _guard = lock();
    clear_env();
    set_base_env();

    let s = EvmRelayerSettings::from_chain_env(ID)
        .expect("parses without any yield-minter or BitGo config");
    assert_eq!(s.chain_id, ID);
    assert_eq!(s.eth_rpc_url, RPC_URL);
    assert_eq!(s.registry_address.to_checksum(None), REGISTRY);
    assert!(s.minter_addresses.is_empty());
    assert_eq!(s.batch_size, 50);
    clear_env();
}

#[test]
fn missing_signer_key_is_error() {
    let _guard = lock();
    clear_env();
    set_base_env();
    unsafe { std::env::remove_var(format!("CHAIN_{ID}_RELAYER_SIGNER_KEY")) };

    assert!(EvmRelayerSettings::from_chain_env(ID).is_err());
    clear_env();
}

#[test]
fn missing_registry_address_is_error() {
    let _guard = lock();
    clear_env();
    set_base_env();
    unsafe { std::env::remove_var(format!("CHAIN_{ID}_RELAYER_REGISTRY_ADDRESS")) };

    assert!(EvmRelayerSettings::from_chain_env(ID).is_err());
    clear_env();
}

#[test]
fn rpc_url_falls_back_to_the_chain_rpc_url() {
    let _guard = lock();
    clear_env();
    set_base_env();
    unsafe {
        std::env::remove_var(format!("CHAIN_{ID}_RELAYER_ETH_RPC_URL"));
        std::env::set_var(format!("CHAIN_{ID}_ETH_RPC_URL"), "https://shared.example");
    }

    let s = EvmRelayerSettings::from_chain_env(ID).expect("parses");
    assert_eq!(s.eth_rpc_url, "https://shared.example");
    clear_env();
}

#[test]
fn minters_come_from_the_indexer_yield_minter_key() {
    let _guard = lock();
    clear_env();
    set_base_env();
    set_minters(&format!(" {MINTER} , {OTHER_MINTER} ,"));

    let s = EvmRelayerSettings::from_chain_env(ID).expect("parses");
    assert_eq!(
        s.minter_ids(),
        vec![MINTER.to_owned(), OTHER_MINTER.to_owned()]
    );
    clear_env();
}

#[test]
fn minter_ids_are_checksummed_whatever_the_configured_case() {
    let _guard = lock();
    clear_env();
    set_base_env();
    set_minters(&MINTER.to_lowercase());

    let s = EvmRelayerSettings::from_chain_env(ID).expect("parses");
    assert_eq!(
        s.minter_ids(),
        vec![MINTER.to_owned()],
        "contract_logs stores EVM addresses checksummed, and the wire-in statements compare text"
    );
    clear_env();
}

#[test]
fn malformed_minter_entry_is_error() {
    let _guard = lock();
    clear_env();
    set_base_env();
    set_minters(&format!("{MINTER},0xnot-an-address"));

    assert!(
        EvmRelayerSettings::from_chain_env(ID).is_err(),
        "a malformed minter must fail startup, not silently drop the wire-in phase"
    );
    clear_env();
}

#[test]
fn batch_size_can_be_overridden() {
    let _guard = lock();
    clear_env();
    set_base_env();
    unsafe { std::env::set_var("JOB_RELAYER_EVM_BATCH_SIZE", "7") };

    let s = EvmRelayerSettings::from_chain_env(ID).expect("parses");
    assert_eq!(s.batch_size, 7);
    clear_env();
}
