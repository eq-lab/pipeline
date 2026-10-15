//! Env-var-based tests for `pipeline_api::config::ChainsConfig::from_env`.
//!
//! These mutate process-global env vars (`CHAINS`, `DEFAULT_CHAIN_ID`,
//! `CHAIN_<id>_*`), so they serialize on a local mutex. Each integration
//! test file is its own binary; cross-binary tests don't share process env,
//! so the lock only needs to cover this file.

use std::sync::Mutex;

use pipeline_api::config::{ChainsConfig, ConfiguredChain};
use shared::chains::ChainKind;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const EVM_REGISTRY: &str = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const STELLAR_REGISTRY: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const STELLAR_REGISTRY_2: &str = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3";
const STELLAR_ACCOUNT: &str = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA";
const STELLAR_SECRET: &str = "SAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC5MY";

fn error_message(result: anyhow::Result<ChainsConfig>) -> String {
    result.err().map(|e| format!("{e:#}")).unwrap_or_default()
}

fn with_env<F: FnOnce()>(set: &[(&str, &str)], clear: &[&str], f: F) {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // SAFETY: serialized via ENV_LOCK; only one test runs at a time.
    for (k, v) in set {
        unsafe { std::env::set_var(k, v) };
    }
    for k in clear {
        unsafe { std::env::remove_var(k) };
    }
    f();
    for (k, _) in set {
        unsafe { std::env::remove_var(k) };
    }
}

#[test]
fn empty_chains_str_is_error() {
    with_env(&[("CHAINS", "")], &[], || {
        let result = ChainsConfig::from_env();
        assert!(result.is_err());
    });
}

#[test]
fn default_chain_not_in_chains_is_error() {
    with_env(&[("CHAINS", "1"), ("DEFAULT_CHAIN_ID", "2")], &[], || {
        let result = ChainsConfig::from_env();
        assert!(result.is_err());
        let msg = result.err().map(|e| e.to_string()).unwrap_or_default();
        assert!(
            msg.contains("not a member") || msg.contains("DEFAULT_CHAIN_ID"),
            "unexpected error message: {msg}"
        );
    });
}

#[test]
fn chain_with_signer_key_but_no_dm_address_is_error() {
    with_env(
        &[
            ("CHAINS", "42"),
            ("DEFAULT_CHAIN_ID", "42"),
            ("CHAIN_42_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            (
                "CHAIN_42_SIGNER_KEY",
                "0x4c0883a69102937d6231471b5dbb6e538eba2907d4019aaccc2e0c4694a507a5",
            ),
        ],
        &["CHAIN_42_DM_ADDRESS", "CHAIN_42_WQ_ADDRESS"],
        || {
            let result = ChainsConfig::from_env();
            assert!(result.is_err());
            let msg = result.err().map(|e| e.to_string()).unwrap_or_default();
            assert!(
                msg.contains("CHAIN_42_DM_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn chain_without_signer_key_produces_no_voucher_entry() {
    with_env(
        &[
            ("CHAINS", "99"),
            ("DEFAULT_CHAIN_ID", "99"),
            ("CHAIN_99_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
        ],
        &["CHAIN_99_SIGNER_KEY"],
        || {
            let result = ChainsConfig::from_env();
            assert!(result.is_ok(), "expected ChainsConfig::from_env to succeed");
            let cfg = result.expect("ChainsConfig::from_env with no signer key");
            assert_eq!(cfg.default_chain_id, 99);
            assert!(
                cfg.voucher.is_empty(),
                "no signer key → no voucher entry expected"
            );
        },
    );
}

#[test]
fn evm_loan_registry_is_stored_as_eip55_checksum() {
    with_env(
        &[
            ("CHAINS", "7001"),
            ("DEFAULT_CHAIN_ID", "7001"),
            (
                "CHAIN_7001_EVM_API_LOAN_REGISTRY_ADDRESS",
                "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
            ),
        ],
        &["CHAIN_7001_TYPE"],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with lowercase registry");
            assert_eq!(cfg.loan_registry_addresses[&7001], EVM_REGISTRY);
        },
    );
}

#[test]
fn evm_chain_without_loan_registry_is_error() {
    with_env(
        &[("CHAINS", "7002"), ("DEFAULT_CHAIN_ID", "7002")],
        &[
            "CHAIN_7002_TYPE",
            "CHAIN_7002_EVM_API_LOAN_REGISTRY_ADDRESS",
        ],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_7002_EVM_API_LOAN_REGISTRY_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn evm_chain_with_blank_loan_registry_is_error() {
    with_env(
        &[
            ("CHAINS", "7003"),
            ("DEFAULT_CHAIN_ID", "7003"),
            ("CHAIN_7003_EVM_API_LOAN_REGISTRY_ADDRESS", "   "),
        ],
        &["CHAIN_7003_TYPE"],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_7003_EVM_API_LOAN_REGISTRY_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn evm_chain_with_invalid_loan_registry_is_error() {
    with_env(
        &[
            ("CHAINS", "7004"),
            ("DEFAULT_CHAIN_ID", "7004"),
            ("CHAIN_7004_EVM_API_LOAN_REGISTRY_ADDRESS", "0xnothex"),
        ],
        &["CHAIN_7004_TYPE"],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_7004_EVM_API_LOAN_REGISTRY_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn stellar_loan_registry_is_stored_in_canonical_form() {
    with_env(
        &[
            ("CHAINS", "99000002"),
            ("DEFAULT_CHAIN_ID", "99000002"),
            ("CHAIN_99000002_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000002_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
        ],
        &[
            "CHAIN_99000002_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000002_API_STELLAR_WQ_CONTRACT_ID",
        ],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with stellar registry");
            assert_eq!(cfg.loan_registry_addresses[&99_000_002], STELLAR_REGISTRY);
        },
    );
}

#[test]
fn stellar_chain_without_loan_registry_is_error() {
    with_env(
        &[
            ("CHAINS", "99000003"),
            ("DEFAULT_CHAIN_ID", "99000003"),
            ("CHAIN_99000003_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
        ],
        &["CHAIN_99000003_STELLAR_API_LOAN_REGISTRY_ADDRESS"],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_99000003_STELLAR_API_LOAN_REGISTRY_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn stellar_chain_with_account_or_malformed_loan_registry_is_error() {
    for bad in [STELLAR_ACCOUNT, "CNOTASTRKEY"] {
        with_env(
            &[
                ("CHAINS", "99000004"),
                ("DEFAULT_CHAIN_ID", "99000004"),
                ("CHAIN_99000004_TYPE", "stellar"),
                ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
                ("CHAIN_99000004_STELLAR_API_LOAN_REGISTRY_ADDRESS", bad),
            ],
            &[],
            || {
                let msg = error_message(ChainsConfig::from_env());
                assert!(
                    msg.contains("CHAIN_99000004_STELLAR_API_LOAN_REGISTRY_ADDRESS"),
                    "unexpected error message for {bad}: {msg}"
                );
            },
        );
    }
}

#[test]
fn evm_chain_with_stellar_loan_registry_key_is_error() {
    with_env(
        &[
            ("CHAINS", "7005"),
            ("DEFAULT_CHAIN_ID", "7005"),
            ("CHAIN_7005_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            (
                "CHAIN_7005_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
        ],
        &["CHAIN_7005_TYPE"],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_7005_STELLAR_API_LOAN_REGISTRY_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn mixed_chains_each_get_their_own_loan_registry() {
    with_env(
        &[
            ("CHAINS", "7006,99000005"),
            ("DEFAULT_CHAIN_ID", "7006"),
            ("CHAIN_99000005_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            ("CHAIN_7006_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            (
                "CHAIN_99000005_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY_2,
            ),
        ],
        &[
            "CHAIN_7006_TYPE",
            "CHAIN_99000005_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000005_API_STELLAR_WQ_CONTRACT_ID",
        ],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with two chains");
            assert_eq!(cfg.loan_registry_addresses.len(), 2);
            assert_eq!(cfg.loan_registry_addresses[&7006], EVM_REGISTRY);
            assert_eq!(cfg.loan_registry_addresses[&99_000_005], STELLAR_REGISTRY_2);
        },
    );
}

#[test]
fn chains_are_recorded_in_chains_order_with_kind() {
    with_env(
        &[
            ("CHAINS", "1,2"),
            ("DEFAULT_CHAIN_ID", "1"),
            ("CHAIN_1_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            ("CHAIN_2_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
        ],
        &[
            "CHAIN_1_TYPE",
            "CHAIN_2_TYPE",
            "CHAIN_1_SIGNER_KEY",
            "CHAIN_2_SIGNER_KEY",
        ],
        || {
            let cfg = ChainsConfig::from_env().expect("config");
            assert_eq!(
                cfg.chains,
                vec![
                    ConfiguredChain {
                        chain_id: 1,
                        kind: ChainKind::Evm
                    },
                    ConfiguredChain {
                        chain_id: 2,
                        kind: ChainKind::Evm
                    },
                ]
            );
        },
    );
}

#[test]
fn duplicate_chain_ids_are_error() {
    with_env(&[("CHAINS", "1,1"), ("DEFAULT_CHAIN_ID", "1")], &[], || {
        let msg = ChainsConfig::from_env()
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        assert!(msg.contains("duplicate"), "unexpected error message: {msg}");
    });
}
