//! Config-parsing tests for the Stellar price-poller settings introduced in #568.
//!
//! Mirrors `stellar_relayer_config.rs`'s `ENV_LOCK` mutex pattern — env vars are
//! process-global, so tests within this binary must serialize their mutations.

use std::sync::Mutex;

use pipeline_worker::price_poller::config::{PricePollerSettings, StellarPricePollerSettings};

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn clear_price_poller_env(id: i64) {
    let poller_p = format!("CHAIN_{id}_PRICE_POLLER_STELLAR_");
    let indexer_p = format!("CHAIN_{id}_STELLAR_");
    unsafe {
        std::env::remove_var("CHAINS");
        std::env::remove_var("JOB_PRICE_POLLER_POLL_INTERVAL_SECS");
        for suffix in ["RPC_URL", "NETWORK_PASSPHRASE", "INTERVAL_SECS"] {
            std::env::remove_var(format!("{poller_p}{suffix}"));
        }
        for suffix in ["RPC_URL", "NETWORK_PASSPHRASE"] {
            std::env::remove_var(format!("{indexer_p}{suffix}"));
        }
        std::env::remove_var(format!("CHAIN_{id}_TYPE"));
        // EVM vars — clear to avoid cross-contamination in dispatch tests.
        std::env::remove_var(format!("CHAIN_{id}_ETH_RPC_URL"));
    }
}

// ── Happy path ────────────────────────────────────────────────────────────────

/// Testnet chain (99000001) with explicit price-poller vars set.
/// Network passphrase should default to the testnet value when unset.
#[test]
fn stellar_price_poller_settings_happy_path() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_price_poller_env(id);
    unsafe {
        std::env::set_var(
            "CHAIN_99000001_PRICE_POLLER_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
        // Leave NETWORK_PASSPHRASE unset — should default to testnet value.
    }
    let s = StellarPricePollerSettings::from_chain_env(id).expect("parses");
    assert_eq!(s.chain_id, id);
    assert_eq!(s.rpc_url, "https://soroban-testnet.stellar.org");
    assert_eq!(s.network_passphrase, "Test SDF Network ; September 2015");
    assert_eq!(s.poll_interval_secs, 60); // default
    clear_price_poller_env(id);
}

/// When `CHAIN_<id>_PRICE_POLLER_STELLAR_RPC_URL` is unset, fall back to the
/// indexer's `CHAIN_<id>_STELLAR_RPC_URL`.
#[test]
fn stellar_price_poller_settings_rpc_url_fallback() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_price_poller_env(id);
    unsafe {
        // Only set the indexer-level var — price-poller var is absent.
        std::env::set_var(
            "CHAIN_99000001_STELLAR_RPC_URL",
            "https://soroban-testnet-fallback.stellar.org",
        );
    }
    let s = StellarPricePollerSettings::from_chain_env(id).expect("fallback parses");
    assert_eq!(s.rpc_url, "https://soroban-testnet-fallback.stellar.org");
    clear_price_poller_env(id);
}

/// When `CHAIN_<id>_PRICE_POLLER_STELLAR_NETWORK_PASSPHRASE` is unset, fall back
/// to the indexer's `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE`.
#[test]
fn stellar_price_poller_settings_passphrase_fallback() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_price_poller_env(id);
    unsafe {
        std::env::set_var(
            "CHAIN_99000001_PRICE_POLLER_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
        // Only set the indexer-level passphrase — price-poller-specific var is absent.
        std::env::set_var(
            "CHAIN_99000001_STELLAR_NETWORK_PASSPHRASE",
            "Test SDF Network ; September 2015",
        );
    }
    let s = StellarPricePollerSettings::from_chain_env(id).expect("passphrase fallback parses");
    assert_eq!(s.network_passphrase, "Test SDF Network ; September 2015");
    clear_price_poller_env(id);
}

/// The Stellar arm reads the per-chain `CHAIN_<id>_PRICE_POLLER_STELLAR_INTERVAL_SECS`
/// and is independent of `JOB_PRICE_POLLER_POLL_INTERVAL_SECS` (which only the EVM arm reads).
#[test]
fn stellar_poll_interval_is_independent_from_evm() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_price_poller_env(id);
    unsafe {
        std::env::set_var(
            "CHAIN_99000001_PRICE_POLLER_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
        // EVM-side var is set to a sentinel value; Stellar arm must ignore it.
        std::env::set_var("JOB_PRICE_POLLER_POLL_INTERVAL_SECS", "999");
        std::env::set_var("CHAIN_99000001_PRICE_POLLER_STELLAR_INTERVAL_SECS", "7");
    }
    let s = StellarPricePollerSettings::from_chain_env(id).expect("parses");
    assert_eq!(
        s.poll_interval_secs, 7,
        "Stellar arm must honor CHAIN_<id>_PRICE_POLLER_STELLAR_INTERVAL_SECS"
    );
    clear_price_poller_env(id);
}

// ── Dispatch test ─────────────────────────────────────────────────────────────

/// `PricePollerSettings::all_from_env` with `CHAINS=1,99000001` should dispatch
/// one `Evm` variant and one `Stellar` variant in that order.
#[test]
fn price_poller_settings_dispatches_evm_and_stellar() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    clear_price_poller_env(1);
    clear_price_poller_env(99_000_001);
    unsafe {
        std::env::set_var("CHAINS", "1,99000001");
        std::env::set_var("CHAIN_99000001_TYPE", "stellar");
        // EVM side.
        std::env::set_var("CHAIN_1_ETH_RPC_URL", "http://localhost:8545");
        // Stellar side.
        std::env::set_var(
            "CHAIN_99000001_STELLAR_RPC_URL",
            "https://soroban-testnet.stellar.org",
        );
    }

    let all = PricePollerSettings::all_from_env().expect("dispatch ok");
    assert_eq!(all.len(), 2);
    let kinds: Vec<&'static str> = all
        .iter()
        .map(|s| match s {
            PricePollerSettings::Evm(_) => "evm",
            PricePollerSettings::Stellar(_) => "stellar",
        })
        .collect();
    assert_eq!(kinds, vec!["evm", "stellar"]);
    assert_eq!(all[0].chain_id(), 1);
    assert_eq!(all[1].chain_id(), 99_000_001);

    clear_price_poller_env(1);
    clear_price_poller_env(99_000_001);
}

// ── Error cases ───────────────────────────────────────────────────────────────

/// Missing RPC URL (neither price-poller-specific nor indexer fallback set) must error.
#[test]
fn stellar_price_poller_missing_rpc_url_is_error() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id: i64 = 99_000_001;
    clear_price_poller_env(id);
    // No RPC URL set at all.
    let err = StellarPricePollerSettings::from_chain_env(id);
    assert!(err.is_err(), "missing RPC URL must error");
    clear_price_poller_env(id);
}
