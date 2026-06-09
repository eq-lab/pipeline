//! Per-chain config-parsing tests for indexer / price-poller / relayer.
//!
//! All three modules read `CHAINS` + `CHAIN_<id>_*` env vars, so the tests
//! must serialize their env-var mutations on a single mutex. Each
//! integration test file is its own binary; cross-binary tests don't share
//! process env vars, so the lock only needs to cover this file.

use std::sync::Mutex;

use pipeline_worker::indexer::config::{parse_chains_env, IndexerJobSettings};
use pipeline_worker::price_poller::config::PricePollerSettings;
use pipeline_worker::relayer::config::RelayerJobSettings;

/// Mutex used to serialize env-var mutations across tests in this binary.
/// `cargo test` runs tests in parallel within a binary, and `CHAINS` /
/// `CHAIN_<id>_*` env vars are process-global.
static ENV_LOCK: Mutex<()> = Mutex::new(());

// ── parse_chains_env ─────────────────────────────────────────────────────────

#[test]
fn parse_chains_env_single_chain() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // SAFETY: serialized via ENV_LOCK; only one test runs at a time.
    unsafe { std::env::set_var("CHAINS", "1") };
    let ids = parse_chains_env().unwrap();
    assert_eq!(ids, vec![1i64]);
    unsafe { std::env::remove_var("CHAINS") };
}

#[test]
fn parse_chains_env_multi_chain() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    unsafe { std::env::set_var("CHAINS", "1, 99999") };
    let ids = parse_chains_env().unwrap();
    assert_eq!(ids, vec![1i64, 99999i64]);
    unsafe { std::env::remove_var("CHAINS") };
}

#[test]
fn parse_chains_env_empty_is_error() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    unsafe { std::env::set_var("CHAINS", "") };
    assert!(parse_chains_env().is_err());
    unsafe { std::env::remove_var("CHAINS") };
}

// ── IndexerJobSettings ───────────────────────────────────────────────────────

#[test]
fn indexer_from_chain_env_missing_rpc_url_is_error() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    unsafe {
        std::env::set_var("CHAINS", "77777");
        std::env::remove_var("CHAIN_77777_ETH_RPC_URL");
    }
    assert!(IndexerJobSettings::from_chain_env(77777).is_err());
    unsafe { std::env::remove_var("CHAINS") };
}

// ── PricePollerSettings ──────────────────────────────────────────────────────

#[test]
fn price_poller_from_chain_env_missing_rpc_url_is_error() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    unsafe {
        std::env::remove_var("CHAIN_88888_ETH_RPC_URL");
    }
    assert!(PricePollerSettings::from_chain_env(88888).is_err());
}

// ── RelayerJobSettings ───────────────────────────────────────────────────────

#[test]
fn relayer_from_chain_env_missing_signer_key_is_error() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    unsafe {
        std::env::remove_var("CHAIN_66666_RELAYER_SIGNER_KEY");
        std::env::remove_var("CHAIN_66666_RELAYER_ETH_RPC_URL");
        std::env::remove_var("CHAIN_66666_ETH_RPC_URL");
    }
    assert!(RelayerJobSettings::from_chain_env(66666).is_err());
}
