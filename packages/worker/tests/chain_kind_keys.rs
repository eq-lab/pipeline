//! A per-chain key of the wrong network kind is configuration the chain can never
//! read, so startup rejects it (#1456). See
//! `docs/superpowers/specs/2026-10-09-env-naming-standardization-design.md`.

use std::sync::Mutex;

use pipeline_worker::indexer::config::{
    parse_chain_type, validate_chain_kind_keys, ChainType, IndexerJobSettings, IndexerSettings,
};

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn clear(chain_id: i64) {
    for key in [
        format!("CHAIN_{chain_id}_TYPE"),
        format!("CHAIN_{chain_id}_EVM_RPC_URL"),
        format!("CHAIN_{chain_id}_STELLAR_RPC_URL"),
        format!("CHAIN_{chain_id}_EVM_INDEXER_DEPOSIT_MANAGER_ADDRESS"),
        format!("CHAIN_{chain_id}_STELLAR_INDEXER_DEPOSIT_MANAGER_ADDRESS"),
    ] {
        // SAFETY: serialized via ENV_LOCK; only one test runs at a time.
        unsafe { std::env::remove_var(key) };
    }
    unsafe { std::env::remove_var("CHAINS") };
}

#[test]
fn stellar_key_on_an_evm_chain_is_rejected() {
    let _guard = lock();
    let id = 60_001_i64;
    clear(id);
    unsafe {
        std::env::set_var(format!("CHAIN_{id}_TYPE"), "evm");
        std::env::set_var(
            format!("CHAIN_{id}_STELLAR_INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
    }

    let err = validate_chain_kind_keys(id, ChainType::Evm).expect_err("must be rejected");
    let msg = format!("{err:#}");
    assert!(msg.contains("declared 'evm'"), "{msg}");
    assert!(
        msg.contains(&format!(
            "CHAIN_{id}_STELLAR_INDEXER_DEPOSIT_MANAGER_ADDRESS"
        )),
        "the error must name the stray key, got: {msg}"
    );

    clear(id);
}

#[test]
fn evm_key_on_a_stellar_chain_is_rejected() {
    let _guard = lock();
    let id = 60_002_i64;
    clear(id);
    unsafe {
        std::env::set_var(format!("CHAIN_{id}_TYPE"), "stellar");
        std::env::set_var(format!("CHAIN_{id}_EVM_RPC_URL"), "https://rpc.test");
    }

    let err = validate_chain_kind_keys(id, ChainType::Stellar).expect_err("must be rejected");
    let msg = format!("{err:#}");
    assert!(msg.contains("declared 'stellar'"), "{msg}");
    assert!(msg.contains(&format!("CHAIN_{id}_EVM_RPC_URL")), "{msg}");

    clear(id);
}

#[test]
fn matching_keys_are_accepted() {
    let _guard = lock();
    let id = 60_003_i64;
    clear(id);
    unsafe {
        std::env::set_var(format!("CHAIN_{id}_TYPE"), "evm");
        std::env::set_var(format!("CHAIN_{id}_EVM_RPC_URL"), "https://rpc.test");
    }

    assert_eq!(parse_chain_type(id).expect("accepted"), ChainType::Evm);
    validate_chain_kind_keys(id, ChainType::Evm).expect("matching keys are accepted");

    clear(id);
}

/// `parse_chain_type` runs on request paths, so it must stay a cheap read of the
/// declaration alone — the environment audit belongs to startup.
#[test]
fn parse_chain_type_alone_does_not_audit_the_environment() {
    let _guard = lock();
    let id = 60_005_i64;
    clear(id);
    unsafe {
        std::env::set_var(format!("CHAIN_{id}_TYPE"), "evm");
        std::env::set_var(
            format!("CHAIN_{id}_STELLAR_INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
    }

    assert_eq!(
        parse_chain_type(id).expect("the declaration alone still parses"),
        ChainType::Evm
    );

    clear(id);
}

/// The audit is wired into the job's own startup, not just available to it.
#[test]
fn indexer_startup_rejects_a_stray_key() {
    let _guard = lock();
    let id = 60_006_i64;
    clear(id);
    unsafe {
        std::env::set_var("CHAINS", id.to_string());
        std::env::set_var(format!("CHAIN_{id}_TYPE"), "evm");
        std::env::set_var(format!("CHAIN_{id}_EVM_RPC_URL"), "https://rpc.test");
        std::env::set_var(
            format!("CHAIN_{id}_STELLAR_INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
    }

    let err = IndexerSettings::all_from_env()
        .err()
        .expect("startup must abort");
    assert!(format!("{err:#}").contains("will never be read"), "{err:#}");

    clear(id);
}

#[test]
fn a_missing_contract_address_aborts_startup() {
    let _guard = lock();
    let id = 60_004_i64;
    clear(id);
    unsafe {
        std::env::set_var(format!("CHAIN_{id}_EVM_RPC_URL"), "https://rpc.test");
    }

    let err = IndexerJobSettings::from_chain_env(id)
        .err()
        .expect("a missing contract address must abort");
    assert!(
        format!("{err:#}").contains("EVM_INDEXER_DEPOSIT_MANAGER_ADDRESS"),
        "{err:#}"
    );

    clear(id);
}
