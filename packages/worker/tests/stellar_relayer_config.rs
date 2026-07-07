//! Per-chain config parsing tests for the Stellar relayer settings introduced in #562.
//!
//! All tests in this binary share a single env-var mutex (`CHAINS` and `CHAIN_<id>_*`
//! are process-global). The mutex pattern matches `chain_config.rs` / `stellar_config.rs`.

use std::sync::Mutex;

use pipeline_worker::relayer::config::{RelayerSettings, StellarRelayerSettings};

static ENV_LOCK: Mutex<()> = Mutex::new(());

// A well-formed Strkey for the testnet PLUSD SAC fixture — copied from the
// existing stellar voucher test fixture so we don't introduce new constants.
const FIXTURE_CONTRACT: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
/// Compute a Strkey `S…` seed at runtime — matches the pattern used by the
/// `stellar_voucher` tests so we don't have to hardcode the Strkey string.
fn fixture_seed_strkey() -> String {
    format!("{}", stellar_strkey::ed25519::PrivateKey([1u8; 32]))
}

fn clear_chain_env(id: i64) {
    let prefix = format!("CHAIN_{id}_");
    unsafe {
        std::env::remove_var("CHAINS");
        std::env::remove_var("CRYSTAL_ENABLED");
        std::env::remove_var("ELLIPTIC_ENABLED");
        std::env::remove_var("JOB_RELAYER_SUMSUB_ENABLED");
        std::env::remove_var("JOB_RELAYER_INTERVAL_SECS");
        for suffix in [
            "TYPE",
            "STELLAR_RPC_URL",
            "STELLAR_NETWORK_PASSPHRASE",
            "RELAYER_STELLAR_ACCESS_MANAGER_ID",
            "RELAYER_STELLAR_PLUSD_SAC_ID",
            "RELAYER_STELLAR_SIGNER_SECRET",
            "RELAYER_STELLAR_RPC_URL",
            "RELAYER_STELLAR_NETWORK_PASSPHRASE",
        ] {
            std::env::remove_var(format!("{prefix}{suffix}"));
        }
    }
}

#[test]
fn stellar_relayer_settings_happy_path() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_chain_env(id);
    unsafe {
        std::env::set_var(
            "CHAIN_99000001_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_ACCESS_MANAGER_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_SIGNER_SECRET",
            fixture_seed_strkey(),
        );
    }
    let s = StellarRelayerSettings::from_chain_env(id).expect("parses");
    assert_eq!(s.chain_id, id);
    assert_eq!(s.rpc_url, "https://soroban-testnet.stellar.org");
    assert_eq!(s.network_passphrase, "Test SDF Network ; September 2015");
    assert!(
        !s.elliptic_enabled,
        "Elliptic must be disabled by default on Stellar (ELLIPTIC_ENABLED not set)"
    );
    clear_chain_env(id);
}

#[test]
fn stellar_elliptic_enabled_when_env_set() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_chain_env(id);
    unsafe {
        std::env::set_var("ELLIPTIC_ENABLED", "true");
        std::env::set_var(
            "CHAIN_99000001_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_ACCESS_MANAGER_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_SIGNER_SECRET",
            fixture_seed_strkey(),
        );
    }
    let s = StellarRelayerSettings::from_chain_env(id).expect("parses");
    assert!(
        s.elliptic_enabled,
        "Elliptic must be enabled when ELLIPTIC_ENABLED=true"
    );
    clear_chain_env(id);
}

#[test]
fn stellar_elliptic_enabled_lenient_parse() {
    // ELLIPTIC_ENABLED is parsed leniently (1/true/yes, case-insensitive) so the
    // worker agrees with the API — unlike a strict bool parse that only takes
    // "true"/"false" and would error on "1".
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_chain_env(id);
    unsafe {
        std::env::set_var(
            "CHAIN_99000001_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_ACCESS_MANAGER_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_SIGNER_SECRET",
            fixture_seed_strkey(),
        );
    }

    // Truthy values enable — including "1", uppercase, and "yes".
    for truthy in ["1", "TRUE", "yes"] {
        unsafe { std::env::set_var("ELLIPTIC_ENABLED", truthy) };
        let s = StellarRelayerSettings::from_chain_env(id).expect("parses");
        assert!(s.elliptic_enabled, "ELLIPTIC_ENABLED={truthy} must enable");
    }

    // Non-truthy values disable (no startup error, unlike strict bool parsing).
    for falsy in ["0", "no", "false"] {
        unsafe { std::env::set_var("ELLIPTIC_ENABLED", falsy) };
        let s = StellarRelayerSettings::from_chain_env(id).expect("parses");
        assert!(!s.elliptic_enabled, "ELLIPTIC_ENABLED={falsy} must disable");
    }

    clear_chain_env(id);
}

#[test]
fn stellar_signer_invalid_strkey_is_error() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_chain_env(id);
    unsafe {
        std::env::set_var(
            "CHAIN_99000001_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_ACCESS_MANAGER_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_SIGNER_SECRET",
            "not-a-strkey",
        );
    }
    let err = StellarRelayerSettings::from_chain_env(id);
    assert!(err.is_err(), "bad strkey must error");
    clear_chain_env(id);
}

#[test]
fn stellar_missing_access_manager_is_error() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_chain_env(id);
    unsafe {
        std::env::set_var(
            "CHAIN_99000001_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_SIGNER_SECRET",
            fixture_seed_strkey(),
        );
    }
    assert!(StellarRelayerSettings::from_chain_env(id).is_err());
    clear_chain_env(id);
}

#[test]
fn relayer_settings_dispatch_evm_and_stellar() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    clear_chain_env(1);
    clear_chain_env(99_000_001);
    unsafe {
        std::env::set_var("CHAINS", "1,99000001");
        std::env::set_var("CHAIN_99000001_TYPE", "stellar");
        // EVM side
        std::env::set_var("CHAIN_1_ETH_RPC_URL", "http://localhost:8545");
        std::env::set_var("CHAIN_1_RELAYER_SIGNER_KEY", "0xabc"); // not parsed in from_chain_env
        std::env::set_var(
            "CHAIN_1_RELAYER_REGISTRY_ADDRESS",
            "0x0000000000000000000000000000000000000001",
        );
        std::env::set_var(
            "CHAIN_1_RELAYER_YIELD_MINTER_ADDRESS",
            "0x0000000000000000000000000000000000000002",
        );
        std::env::set_var(
            "CHAIN_1_RELAYER_LOAN_REGISTRY_ADDRESS",
            "0x0000000000000000000000000000000000000003",
        );
        // Stellar side
        std::env::set_var(
            "CHAIN_99000001_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_ACCESS_MANAGER_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID",
            FIXTURE_CONTRACT,
        );
        std::env::set_var(
            "CHAIN_99000001_RELAYER_STELLAR_SIGNER_SECRET",
            fixture_seed_strkey(),
        );
    }

    let all = RelayerSettings::all_from_env().expect("dispatch ok");
    assert_eq!(all.len(), 2);
    let kinds: Vec<&'static str> = all
        .iter()
        .map(|s| match s {
            RelayerSettings::Evm(_) => "evm",
            RelayerSettings::Stellar(_) => "stellar",
        })
        .collect();
    assert_eq!(kinds, vec!["evm", "stellar"]);

    clear_chain_env(1);
    clear_chain_env(99_000_001);
}
