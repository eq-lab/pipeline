//! Per-chain indexer tuning overrides (#1435) — `CHAIN_<id>_INDEXER_*` resolving
//! through `JOB_INDEXER_*` to the hard-coded default, on both the EVM and the
//! Stellar arm. See `docs/exec-plans/active/issue-1435-per-chain-indexer-tuning.md`.

use std::sync::Mutex;

use pipeline_worker::indexer::config::{
    IndexerJobSettings, IndexerSettings, StellarIndexerSettings,
};

/// Serializes env-var mutation across this binary. Unlike `stellar_config.rs`,
/// which isolates tests by using a unique synthetic `chain_id` per test, these
/// tests write process-global `JOB_INDEXER_*` keys that no chain id can scope.
static ENV_LOCK: Mutex<()> = Mutex::new(());

const JOB_KEYS: [&str; 3] = [
    "JOB_INDEXER_POLLING_BLOCK_RANGE",
    "JOB_INDEXER_POLLING_INTERVAL_MS",
    "JOB_INDEXER_LOG_CONFIRMATIONS_DELAY",
];

const CHAIN_SUFFIXES: [&str; 3] = [
    "POLLING_BLOCK_RANGE",
    "POLLING_INTERVAL_MS",
    "LOG_CONFIRMATIONS_DELAY",
];

fn clear_tuning(chain_ids: &[i64]) {
    for key in JOB_KEYS {
        // SAFETY: serialized via ENV_LOCK; only one test runs at a time.
        unsafe { std::env::remove_var(key) };
    }
    for id in chain_ids {
        for suffix in CHAIN_SUFFIXES {
            unsafe { std::env::remove_var(format!("CHAIN_{id}_INDEXER_{suffix}")) };
        }
    }
}

fn set_job(range: &str, interval: &str, confirmations: &str) {
    unsafe {
        std::env::set_var("JOB_INDEXER_POLLING_BLOCK_RANGE", range);
        std::env::set_var("JOB_INDEXER_POLLING_INTERVAL_MS", interval);
        std::env::set_var("JOB_INDEXER_LOG_CONFIRMATIONS_DELAY", confirmations);
    }
}

fn set_chain(chain_id: i64, range: &str, interval: &str, confirmations: &str) {
    unsafe {
        std::env::set_var(
            format!("CHAIN_{chain_id}_INDEXER_POLLING_BLOCK_RANGE"),
            range,
        );
        std::env::set_var(
            format!("CHAIN_{chain_id}_INDEXER_POLLING_INTERVAL_MS"),
            interval,
        );
        std::env::set_var(
            format!("CHAIN_{chain_id}_INDEXER_LOG_CONFIRMATIONS_DELAY"),
            confirmations,
        );
    }
}

fn set_evm_required(chain_id: i64) {
    unsafe {
        std::env::set_var(format!("CHAIN_{chain_id}_ETH_RPC_URL"), "https://rpc.test");
        std::env::set_var(format!("CHAIN_{chain_id}_DM_CONTRACTS"), "0x01");
        std::env::set_var(format!("CHAIN_{chain_id}_WQ_CONTRACTS"), "0x02");
        std::env::set_var(format!("CHAIN_{chain_id}_SPLUSD_CONTRACTS"), "0x03");
        std::env::set_var(format!("CHAIN_{chain_id}_LOAN_REGISTRY_CONTRACTS"), "0x04");
        std::env::set_var(format!("CHAIN_{chain_id}_YIELD_MINTER_CONTRACTS"), "0x05");
    }
}

fn clear_evm_required(chain_id: i64) {
    for key in [
        "ETH_RPC_URL",
        "DM_CONTRACTS",
        "WQ_CONTRACTS",
        "SPLUSD_CONTRACTS",
        "LOAN_REGISTRY_CONTRACTS",
        "YIELD_MINTER_CONTRACTS",
    ] {
        unsafe { std::env::remove_var(format!("CHAIN_{chain_id}_{key}")) };
    }
}

fn set_stellar_required(chain_id: i64) {
    let p = format!("CHAIN_{chain_id}_STELLAR_");
    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(
            format!("{p}DEPOSIT_MANAGER_ID"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
        std::env::set_var(
            format!("{p}WITHDRAWAL_QUEUE_ID"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}STAKED_PLUSD_ID"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
    }
}

fn clear_stellar_required(chain_id: i64) {
    let p = format!("CHAIN_{chain_id}_STELLAR_");
    for key in [
        "RPC_URL",
        "NETWORK_PASSPHRASE",
        "DEPOSIT_MANAGER_ID",
        "WITHDRAWAL_QUEUE_ID",
        "STAKED_PLUSD_ID",
    ] {
        unsafe { std::env::remove_var(format!("{p}{key}")) };
    }
}

fn lock() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

// ── EVM arm ──────────────────────────────────────────────────────────────────

#[test]
fn evm_per_chain_overrides_win_over_job_level() {
    let _guard = lock();
    let id = 70_001_i64;
    clear_tuning(&[id]);
    set_evm_required(id);
    set_job("1111", "222", "33");
    set_chain(id, "5000", "900", "64");

    let s = IndexerJobSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_block_range, 5000);
    assert_eq!(s.polling_interval_ms, 900);
    assert_eq!(s.log_confirmations_delay, 64);

    clear_tuning(&[id]);
    clear_evm_required(id);
}

#[test]
fn evm_job_level_wins_when_per_chain_unset() {
    let _guard = lock();
    let id = 70_002_i64;
    clear_tuning(&[id]);
    set_evm_required(id);
    set_job("1111", "222", "33");

    let s = IndexerJobSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_block_range, 1111);
    assert_eq!(s.polling_interval_ms, 222);
    assert_eq!(s.log_confirmations_delay, 33);

    clear_tuning(&[id]);
    clear_evm_required(id);
}

#[test]
fn evm_both_unset_yields_current_defaults() {
    let _guard = lock();
    let id = 70_003_i64;
    clear_tuning(&[id]);
    set_evm_required(id);

    let s = IndexerJobSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_block_range, 1000);
    assert_eq!(s.polling_interval_ms, 500);
    assert_eq!(s.log_confirmations_delay, 12);

    clear_tuning(&[id]);
    clear_evm_required(id);
}

#[test]
fn evm_blank_per_chain_falls_through_to_job_level() {
    let _guard = lock();
    let id = 70_004_i64;
    clear_tuning(&[id]);
    set_evm_required(id);
    set_job("1111", "222", "33");
    set_chain(id, "", "   ", "");

    let s = IndexerJobSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_block_range, 1111);
    assert_eq!(s.polling_interval_ms, 222);
    assert_eq!(s.log_confirmations_delay, 33);

    clear_tuning(&[id]);
    clear_evm_required(id);
}

#[test]
fn evm_per_chain_value_is_trimmed() {
    let _guard = lock();
    let id = 70_005_i64;
    clear_tuning(&[id]);
    set_evm_required(id);
    set_chain(id, " 2048 ", " 750 ", " 40 ");

    let s = IndexerJobSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_block_range, 2048);
    assert_eq!(s.polling_interval_ms, 750);
    assert_eq!(s.log_confirmations_delay, 40);

    clear_tuning(&[id]);
    clear_evm_required(id);
}

#[test]
fn evm_invalid_per_chain_value_errors_naming_the_chain_key() {
    let _guard = lock();
    let id = 70_006_i64;
    clear_tuning(&[id]);
    set_evm_required(id);
    set_job("1111", "222", "33");
    unsafe {
        std::env::set_var(
            format!("CHAIN_{id}_INDEXER_POLLING_BLOCK_RANGE"),
            "not-a-number",
        );
    }

    let err = IndexerJobSettings::from_chain_env(id)
        .err()
        .expect("must reject");
    let msg = format!("{err:#}");
    assert!(
        msg.contains(&format!("CHAIN_{id}_INDEXER_POLLING_BLOCK_RANGE")),
        "error should name the per-chain key, got: {msg}"
    );
    assert!(
        !msg.contains("JOB_INDEXER_POLLING_BLOCK_RANGE"),
        "error should not blame the job-level key, got: {msg}"
    );

    clear_tuning(&[id]);
    clear_evm_required(id);
}

#[test]
fn evm_zero_polling_range_is_rejected_from_either_layer() {
    let _guard = lock();
    let id = 70_007_i64;
    clear_tuning(&[id]);
    set_evm_required(id);

    unsafe { std::env::set_var(format!("CHAIN_{id}_INDEXER_POLLING_BLOCK_RANGE"), "0") };
    let err = IndexerJobSettings::from_chain_env(id)
        .err()
        .expect("per-chain 0 must be rejected");
    assert!(format!("{err:#}").contains("must be >= 1"), "{err:#}");

    clear_tuning(&[id]);
    unsafe { std::env::set_var("JOB_INDEXER_POLLING_BLOCK_RANGE", "0") };
    let err = IndexerJobSettings::from_chain_env(id)
        .err()
        .expect("job-level 0 must be rejected");
    assert!(format!("{err:#}").contains("must be >= 1"), "{err:#}");

    clear_tuning(&[id]);
    clear_evm_required(id);
}

#[test]
fn evm_zero_interval_and_confirmations_stay_legal() {
    let _guard = lock();
    let id = 70_008_i64;
    clear_tuning(&[id]);
    set_evm_required(id);
    set_chain(id, "1000", "0", "0");

    let s = IndexerJobSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_interval_ms, 0);
    assert_eq!(s.log_confirmations_delay, 0);

    clear_tuning(&[id]);
    clear_evm_required(id);
}

#[test]
fn two_chains_resolve_tuning_independently() {
    let _guard = lock();
    let (a, b) = (70_010_i64, 70_011_i64);
    clear_tuning(&[a, b]);
    set_evm_required(a);
    set_evm_required(b);
    set_job("1111", "222", "33");
    set_chain(a, "5000", "900", "64");
    unsafe {
        std::env::set_var("CHAINS", format!("{a},{b}"));
        std::env::set_var(format!("CHAIN_{b}_INDEXER_POLLING_BLOCK_RANGE"), "250");
    }

    let all = IndexerSettings::all_from_env().expect("all_from_env");
    assert_eq!(all.len(), 2);

    let mut seen = 0;
    for settings in &all {
        let IndexerSettings::Evm(s) = settings else {
            panic!("expected both chains to be EVM")
        };
        if s.chain_id == a {
            assert_eq!(s.polling_block_range, 5000);
            assert_eq!(s.polling_interval_ms, 900);
            assert_eq!(s.log_confirmations_delay, 64);
            seen += 1;
        } else {
            assert_eq!(s.chain_id, b);
            assert_eq!(s.polling_block_range, 250);
            assert_eq!(s.polling_interval_ms, 222);
            assert_eq!(s.log_confirmations_delay, 33);
            seen += 1;
        }
    }
    assert_eq!(seen, 2);

    clear_tuning(&[a, b]);
    clear_evm_required(a);
    clear_evm_required(b);
    unsafe { std::env::remove_var("CHAINS") };
}

// ── Stellar arm ──────────────────────────────────────────────────────────────

#[test]
fn stellar_per_chain_overrides_win_over_job_level() {
    let _guard = lock();
    let id = 79_000_001_i64;
    clear_tuning(&[id]);
    set_stellar_required(id);
    set_job("1111", "222", "33");
    set_chain(id, "4096", "1500", "64");

    let s = StellarIndexerSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_ledger_range, 4096);
    assert_eq!(s.polling_interval_ms, 1500);

    clear_tuning(&[id]);
    clear_stellar_required(id);
}

#[test]
fn stellar_job_level_wins_when_per_chain_unset() {
    let _guard = lock();
    let id = 79_000_002_i64;
    clear_tuning(&[id]);
    set_stellar_required(id);
    set_job("1111", "222", "33");

    let s = StellarIndexerSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_ledger_range, 1111);
    assert_eq!(s.polling_interval_ms, 222);

    clear_tuning(&[id]);
    clear_stellar_required(id);
}

#[test]
fn stellar_both_unset_yields_current_defaults() {
    let _guard = lock();
    let id = 79_000_003_i64;
    clear_tuning(&[id]);
    set_stellar_required(id);

    let s = StellarIndexerSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_ledger_range, 1000);
    assert_eq!(s.polling_interval_ms, 500);

    clear_tuning(&[id]);
    clear_stellar_required(id);
}

#[test]
fn stellar_blank_per_chain_falls_through_to_job_level() {
    let _guard = lock();
    let id = 79_000_004_i64;
    clear_tuning(&[id]);
    set_stellar_required(id);
    set_job("1111", "222", "33");
    set_chain(id, "  ", "", "");

    let s = StellarIndexerSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_ledger_range, 1111);
    assert_eq!(s.polling_interval_ms, 222);

    clear_tuning(&[id]);
    clear_stellar_required(id);
}

#[test]
fn stellar_zero_ledger_range_is_rejected() {
    let _guard = lock();
    let id = 79_000_005_i64;
    clear_tuning(&[id]);
    set_stellar_required(id);
    unsafe { std::env::set_var(format!("CHAIN_{id}_INDEXER_POLLING_BLOCK_RANGE"), "0") };

    let err = StellarIndexerSettings::from_chain_env(id)
        .err()
        .expect("0 must be rejected");
    assert!(format!("{err:#}").contains("must be >= 1"), "{err:#}");

    clear_tuning(&[id]);
    clear_stellar_required(id);
}

#[test]
fn stellar_ignores_a_per_chain_confirmations_delay() {
    let _guard = lock();
    let id = 79_000_006_i64;
    clear_tuning(&[id]);
    set_stellar_required(id);
    unsafe {
        std::env::set_var(format!("CHAIN_{id}_INDEXER_LOG_CONFIRMATIONS_DELAY"), "64");
    }

    let s = StellarIndexerSettings::from_chain_env(id).expect("settings parse");
    assert_eq!(s.polling_ledger_range, 1000);
    assert_eq!(s.polling_interval_ms, 500);

    clear_tuning(&[id]);
    clear_stellar_required(id);
}
