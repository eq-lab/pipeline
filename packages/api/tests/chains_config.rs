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
    result
        .err()
        .map_or_else(Default::default, |e| format!("{e:#}"))
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
        let msg = result
            .err()
            .map_or_else(Default::default, |e| e.to_string());
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
            let msg = result
                .err()
                .map_or_else(Default::default, |e| e.to_string());
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
            .map_or_else(Default::default, |e| e.to_string());
        assert!(msg.contains("duplicate"), "unexpected error message: {msg}");
    });
}

const EVM_CUSTODY: &str = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const EVM_RAMP: &str = "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB";
const EVM_WALLET: &str = "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb";

#[test]
fn evm_capital_sources_are_stored_as_eip55_with_default_decimals() {
    let custody = EVM_CUSTODY.to_lowercase();
    let ramp = EVM_RAMP.to_lowercase();
    let wallet = EVM_WALLET.to_lowercase();
    with_env(
        &[
            ("CHAINS", "7101"),
            ("DEFAULT_CHAIN_ID", "7101"),
            ("CHAIN_7101_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            ("CHAIN_7101_EVM_API_CUSTODY_ADDRESSES", &custody),
            ("CHAIN_7101_EVM_API_RAMP_ADDRESSES", &format!(" {ramp} ,")),
            (
                "CHAIN_7101_EVM_API_WITHDRAWAL_QUEUE_WALLET_ADDRESS",
                &wallet,
            ),
        ],
        &["CHAIN_7101_TYPE", "CHAIN_7101_EVM_API_ASSET_DECIMALS"],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with EVM capital sources");
            let sets = &cfg.transfer_addresses[&7101];
            assert!(sets.custody.contains(EVM_CUSTODY));
            assert!(sets.ramp.contains(EVM_RAMP));
            assert_eq!(sets.asset_decimals, 6);
            assert_eq!(cfg.withdrawal_queue_wallets[&7101], EVM_WALLET);
            assert_eq!(cfg.asset_decimals[&7101], 6);
        },
    );
}

#[test]
fn evm_asset_decimals_override_is_shared_with_the_address_sets() {
    with_env(
        &[
            ("CHAINS", "7102"),
            ("DEFAULT_CHAIN_ID", "7102"),
            ("CHAIN_7102_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            ("CHAIN_7102_EVM_API_CUSTODY_ADDRESSES", EVM_CUSTODY),
            ("CHAIN_7102_EVM_API_RAMP_ADDRESSES", EVM_RAMP),
            ("CHAIN_7102_EVM_API_ASSET_DECIMALS", "18"),
        ],
        &["CHAIN_7102_TYPE"],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with EVM decimals");
            assert_eq!(cfg.asset_decimals[&7102], 18);
            assert_eq!(cfg.transfer_addresses[&7102].asset_decimals, 18);
        },
    );
}

#[test]
fn evm_chain_without_capital_sources_has_decimals_only() {
    with_env(
        &[
            ("CHAINS", "7103"),
            ("DEFAULT_CHAIN_ID", "7103"),
            ("CHAIN_7103_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            ("CHAIN_7103_EVM_API_CUSTODY_ADDRESSES", EVM_CUSTODY),
        ],
        &[
            "CHAIN_7103_TYPE",
            "CHAIN_7103_EVM_API_RAMP_ADDRESSES",
            "CHAIN_7103_EVM_API_WITHDRAWAL_QUEUE_WALLET_ADDRESS",
        ],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with partial EVM sources");
            assert!(!cfg.transfer_addresses.contains_key(&7103));
            assert!(!cfg.withdrawal_queue_wallets.contains_key(&7103));
            assert_eq!(cfg.asset_decimals[&7103], 6);
        },
    );
}

#[test]
fn evm_invalid_capital_source_address_is_error() {
    with_env(
        &[
            ("CHAINS", "7104"),
            ("DEFAULT_CHAIN_ID", "7104"),
            ("CHAIN_7104_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            (
                "CHAIN_7104_EVM_API_WITHDRAWAL_QUEUE_WALLET_ADDRESS",
                STELLAR_ACCOUNT,
            ),
        ],
        &["CHAIN_7104_TYPE"],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_7104_EVM_API_WITHDRAWAL_QUEUE_WALLET_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn stellar_chain_with_evm_capital_source_key_is_error() {
    with_env(
        &[
            ("CHAINS", "99000003"),
            ("DEFAULT_CHAIN_ID", "99000003"),
            ("CHAIN_99000003_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000003_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            ("CHAIN_99000003_EVM_API_CUSTODY_ADDRESSES", EVM_CUSTODY),
        ],
        &[],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_99000003_EVM_API_CUSTODY_ADDRESSES"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn stellar_chain_keeps_seven_decimal_default() {
    with_env(
        &[
            ("CHAINS", "99000004"),
            ("DEFAULT_CHAIN_ID", "99000004"),
            ("CHAIN_99000004_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000004_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
        ],
        &[
            "CHAIN_99000004_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000004_API_STELLAR_WQ_CONTRACT_ID",
            "CHAIN_99000004_API_STELLAR_ASSET_DECIMALS",
        ],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with stellar defaults");
            assert_eq!(cfg.asset_decimals[&99_000_004], 7);
        },
    );
}

const STELLAR_POCKET: &str = "CD464CN7ZWOYRGCTHE74Q5PR3JSRPTHDRZYD4OZR4DY64ZSBJ6YZ2RA5";

#[test]
fn stellar_pocket_address_is_parsed() {
    with_env(
        &[
            ("CHAINS", "99000011"),
            ("DEFAULT_CHAIN_ID", "99000011"),
            ("CHAIN_99000011_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000011_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            ("CHAIN_99000011_STELLAR_API_POCKET_ADDRESS", STELLAR_POCKET),
        ],
        &[
            "CHAIN_99000011_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000011_API_STELLAR_WQ_CONTRACT_ID",
        ],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with pocket key");
            assert_eq!(cfg.pocket_addresses[&99_000_011], STELLAR_POCKET);
        },
    );
}

#[test]
fn stellar_pocket_address_unset_or_blank_gives_no_entry() {
    for (chain, value) in [(99_000_012_i64, None), (99_000_013_i64, Some("   "))] {
        let key = format!("CHAIN_{chain}_STELLAR_API_POCKET_ADDRESS");
        let chains = chain.to_string();
        let registry_key = format!("CHAIN_{chain}_STELLAR_API_LOAN_REGISTRY_ADDRESS");
        let type_key = format!("CHAIN_{chain}_TYPE");
        let mut set: Vec<(&str, &str)> = vec![
            ("CHAINS", &chains),
            ("DEFAULT_CHAIN_ID", &chains),
            (&type_key, "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (&registry_key, STELLAR_REGISTRY),
        ];
        if let Some(v) = value {
            set.push((&key, v));
        }
        let dm = format!("CHAIN_{chain}_API_STELLAR_DM_CONTRACT_ID");
        let wq = format!("CHAIN_{chain}_API_STELLAR_WQ_CONTRACT_ID");
        with_env(&set, &[&dm, &wq, &key], || {
            let cfg = ChainsConfig::from_env().expect("from_env without pocket key");
            assert!(cfg.pocket_addresses.is_empty());
        });
    }
}

#[test]
fn stellar_pocket_address_bad_strkey_is_error() {
    with_env(
        &[
            ("CHAINS", "99000014"),
            ("DEFAULT_CHAIN_ID", "99000014"),
            ("CHAIN_99000014_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000014_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            ("CHAIN_99000014_STELLAR_API_POCKET_ADDRESS", "CNOTAREALID"),
        ],
        &[
            "CHAIN_99000014_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000014_API_STELLAR_WQ_CONTRACT_ID",
        ],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_99000014_STELLAR_API_POCKET_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn stellar_security_registry_address_is_parsed_and_normalised() {
    let padded = format!(" {STELLAR_REGISTRY_2} ");
    with_env(
        &[
            ("CHAINS", "99000021"),
            ("DEFAULT_CHAIN_ID", "99000021"),
            ("CHAIN_99000021_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000021_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            (
                "CHAIN_99000021_STELLAR_API_SECURITY_REGISTRY_ADDRESS",
                &padded,
            ),
        ],
        &[
            "CHAIN_99000021_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000021_API_STELLAR_WQ_CONTRACT_ID",
        ],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with security registry key");
            assert_eq!(
                cfg.security_registry_addresses[&99_000_021],
                STELLAR_REGISTRY_2
            );
        },
    );
}

#[test]
fn stellar_security_registry_address_unset_or_blank_gives_no_entry() {
    for (chain, value) in [(99_000_022_i64, None), (99_000_023_i64, Some("   "))] {
        let key = format!("CHAIN_{chain}_STELLAR_API_SECURITY_REGISTRY_ADDRESS");
        let chains = chain.to_string();
        let registry_key = format!("CHAIN_{chain}_STELLAR_API_LOAN_REGISTRY_ADDRESS");
        let type_key = format!("CHAIN_{chain}_TYPE");
        let mut set: Vec<(&str, &str)> = vec![
            ("CHAINS", &chains),
            ("DEFAULT_CHAIN_ID", &chains),
            (&type_key, "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (&registry_key, STELLAR_REGISTRY),
        ];
        if let Some(v) = value {
            set.push((&key, v));
        }
        let dm = format!("CHAIN_{chain}_API_STELLAR_DM_CONTRACT_ID");
        let wq = format!("CHAIN_{chain}_API_STELLAR_WQ_CONTRACT_ID");
        with_env(&set, &[&dm, &wq, &key], || {
            let cfg = ChainsConfig::from_env().expect("from_env without security registry key");
            assert!(cfg.security_registry_addresses.is_empty());
        });
    }
}

#[test]
fn stellar_security_registry_address_bad_strkey_is_error() {
    with_env(
        &[
            ("CHAINS", "99000024"),
            ("DEFAULT_CHAIN_ID", "99000024"),
            ("CHAIN_99000024_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000024_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            (
                "CHAIN_99000024_STELLAR_API_SECURITY_REGISTRY_ADDRESS",
                "CNOTAREALID",
            ),
        ],
        &[
            "CHAIN_99000024_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000024_API_STELLAR_WQ_CONTRACT_ID",
        ],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_99000024_STELLAR_API_SECURITY_REGISTRY_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn evm_chain_with_stellar_security_registry_key_is_error() {
    with_env(
        &[
            ("CHAINS", "7002"),
            ("DEFAULT_CHAIN_ID", "7002"),
            ("CHAIN_7002_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            (
                "CHAIN_7002_STELLAR_API_SECURITY_REGISTRY_ADDRESS",
                STELLAR_REGISTRY_2,
            ),
        ],
        &["CHAIN_7002_TYPE"],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_7002_STELLAR_API_SECURITY_REGISTRY_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn wq_scope_unset_has_no_entry_and_boot_is_ok() {
    with_env(
        &[
            ("CHAINS", "99000010"),
            ("DEFAULT_CHAIN_ID", "99000010"),
            ("CHAIN_99000010_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000010_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
        ],
        &[
            "CHAIN_99000010_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000010_API_STELLAR_WQ_CONTRACT_ID",
        ],
        || {
            let cfg = ChainsConfig::from_env().expect("boot without WQ key");
            assert!(cfg.withdrawal_queue_addresses.is_empty());
        },
    );
}

#[test]
fn wq_scope_valid_is_stored_canonical_even_without_dm_key() {
    with_env(
        &[
            ("CHAINS", "99000011"),
            ("DEFAULT_CHAIN_ID", "99000011"),
            ("CHAIN_99000011_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000011_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            (
                "CHAIN_99000011_API_STELLAR_WQ_CONTRACT_ID",
                " CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3 ",
            ),
        ],
        &["CHAIN_99000011_API_STELLAR_DM_CONTRACT_ID"],
        || {
            let cfg = ChainsConfig::from_env().expect("boot with WQ key only");
            assert_eq!(
                cfg.withdrawal_queue_addresses[&99_000_011],
                STELLAR_REGISTRY_2
            );
            assert!(cfg.stellar_voucher.is_empty());
        },
    );
}

#[test]
fn wq_scope_blank_has_no_entry() {
    with_env(
        &[
            ("CHAINS", "99000012"),
            ("DEFAULT_CHAIN_ID", "99000012"),
            ("CHAIN_99000012_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000012_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            ("CHAIN_99000012_API_STELLAR_WQ_CONTRACT_ID", "   "),
        ],
        &["CHAIN_99000012_API_STELLAR_DM_CONTRACT_ID"],
        || {
            let cfg = ChainsConfig::from_env().expect("boot with blank WQ key");
            assert!(cfg.withdrawal_queue_addresses.is_empty());
        },
    );
}

#[test]
fn wq_scope_malformed_without_dm_key_does_not_fail_boot() {
    with_env(
        &[
            ("CHAINS", "99000013"),
            ("DEFAULT_CHAIN_ID", "99000013"),
            ("CHAIN_99000013_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000013_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            (
                "CHAIN_99000013_API_STELLAR_WQ_CONTRACT_ID",
                "not-a-contract",
            ),
        ],
        &["CHAIN_99000013_API_STELLAR_DM_CONTRACT_ID"],
        || {
            let cfg = ChainsConfig::from_env().expect("malformed WQ key must not fail boot");
            assert!(cfg.withdrawal_queue_addresses.is_empty());
        },
    );
}

#[test]
fn wq_scope_is_not_read_on_evm_chains() {
    with_env(
        &[
            ("CHAINS", "7010"),
            ("DEFAULT_CHAIN_ID", "7010"),
            ("CHAIN_7010_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            ("CHAIN_7010_API_STELLAR_WQ_CONTRACT_ID", STELLAR_REGISTRY_2),
        ],
        &["CHAIN_7010_TYPE", "CHAIN_7010_SIGNER_KEY"],
        || {
            let cfg = ChainsConfig::from_env().expect("EVM boot ignores the Stellar WQ key");
            assert!(cfg.withdrawal_queue_addresses.is_empty());
            assert!(cfg.voucher.is_empty());
        },
    );
}

const MINTER_ADDR_KEY: &str = "CHAIN_99000021_STELLAR_API_MINTER_ADDRESS";
const MINTER_FLAG_KEY: &str = "CHAIN_99000021_STELLAR_API_CAPITAL_ALLOCATION_FROM_MINTER";

fn with_stellar_minter_env<F: FnOnce()>(extra: &[(&str, &str)], clear: &[&str], f: F) {
    let mut set = vec![
        ("CHAINS", "99000021"),
        ("DEFAULT_CHAIN_ID", "99000021"),
        ("CHAIN_99000021_TYPE", "stellar"),
        ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
        (
            "CHAIN_99000021_STELLAR_API_LOAN_REGISTRY_ADDRESS",
            STELLAR_REGISTRY,
        ),
    ];
    set.extend_from_slice(extra);
    let mut cleared = vec![
        "CHAIN_99000021_API_STELLAR_DM_CONTRACT_ID",
        "CHAIN_99000021_API_STELLAR_WQ_CONTRACT_ID",
    ];
    cleared.extend_from_slice(clear);
    with_env(&set, &cleared, f);
}

#[test]
fn minter_address_is_parsed_and_normalised() {
    let padded = format!(" {STELLAR_REGISTRY_2} ");
    with_stellar_minter_env(
        &[(MINTER_ADDR_KEY, padded.as_str())],
        &[MINTER_FLAG_KEY],
        || {
            let cfg = ChainsConfig::from_env().expect("config");
            assert_eq!(cfg.minter_addresses[&99_000_021], STELLAR_REGISTRY_2);
            assert!(cfg.capital_allocation_from_minter.is_empty());
        },
    );
}

#[test]
fn unset_minter_keys_mean_absent() {
    with_stellar_minter_env(&[], &[MINTER_ADDR_KEY, MINTER_FLAG_KEY], || {
        let cfg = ChainsConfig::from_env().expect("config");
        assert!(cfg.minter_addresses.is_empty());
        assert!(cfg.capital_allocation_from_minter.is_empty());
    });
}

#[test]
fn malformed_minter_address_is_error() {
    for bad in [STELLAR_ACCOUNT, "CNOTASTRKEY"] {
        with_stellar_minter_env(&[(MINTER_ADDR_KEY, bad)], &[MINTER_FLAG_KEY], || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(msg.contains(MINTER_ADDR_KEY), "{bad}: {msg}");
        });
    }
}

#[test]
fn the_switch_flag_parses_true_and_false_case_insensitively() {
    for (raw, expected) in [
        ("true", true),
        (" TRUE ", true),
        ("False", false),
        ("false", false),
    ] {
        with_stellar_minter_env(
            &[
                (MINTER_ADDR_KEY, STELLAR_REGISTRY_2),
                (MINTER_FLAG_KEY, raw),
            ],
            &[],
            || {
                let cfg = ChainsConfig::from_env().expect("config");
                assert_eq!(
                    cfg.capital_allocation_from_minter.contains(&99_000_021),
                    expected,
                    "{raw}"
                );
            },
        );
    }
}

#[test]
fn malformed_switch_flag_is_error() {
    for bad in ["yes", "1", "on"] {
        with_stellar_minter_env(
            &[
                (MINTER_ADDR_KEY, STELLAR_REGISTRY_2),
                (MINTER_FLAG_KEY, bad),
            ],
            &[],
            || {
                let msg = error_message(ChainsConfig::from_env());
                assert!(msg.contains(MINTER_FLAG_KEY), "{bad}: {msg}");
            },
        );
    }
}

#[test]
fn the_switch_flag_without_a_minter_address_is_error() {
    with_stellar_minter_env(&[(MINTER_FLAG_KEY, "true")], &[MINTER_ADDR_KEY], || {
        let msg = error_message(ChainsConfig::from_env());
        assert!(msg.contains(MINTER_FLAG_KEY), "{msg}");
        assert!(msg.contains(MINTER_ADDR_KEY), "{msg}");
    });
}

#[test]
fn an_evm_chain_loads_with_neither_minter_entry() {
    with_env(
        &[
            ("CHAINS", "7011"),
            ("DEFAULT_CHAIN_ID", "7011"),
            ("CHAIN_7011_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
        ],
        &["CHAIN_7011_TYPE"],
        || {
            let cfg = ChainsConfig::from_env().expect("config");
            assert!(cfg.minter_addresses.is_empty());
            assert!(cfg.capital_allocation_from_minter.is_empty());
        },
    );
}

#[test]
fn evm_plusd_address_is_optional_and_normalised_to_eip55() {
    let lower = EVM_REGISTRY.to_lowercase();
    with_env(
        &[
            ("CHAINS", "7101"),
            ("DEFAULT_CHAIN_ID", "7101"),
            ("CHAIN_7101_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            ("CHAIN_7101_EVM_API_PLUSD_ADDRESS", &format!(" {lower} ")),
        ],
        &["CHAIN_7101_TYPE"],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with plusd key");
            assert_eq!(cfg.plusd_addresses[&7101], EVM_REGISTRY);
        },
    );
}

#[test]
fn plusd_address_unset_or_blank_gives_no_entry() {
    for (chain, value) in [(7102_i64, None), (7103_i64, Some("   "))] {
        let key = format!("CHAIN_{chain}_EVM_API_PLUSD_ADDRESS");
        let chains = chain.to_string();
        let registry_key = format!("CHAIN_{chain}_EVM_API_LOAN_REGISTRY_ADDRESS");
        let type_key = format!("CHAIN_{chain}_TYPE");
        let mut set: Vec<(&str, &str)> = vec![
            ("CHAINS", &chains),
            ("DEFAULT_CHAIN_ID", &chains),
            (&registry_key, EVM_REGISTRY),
        ];
        if let Some(v) = value {
            set.push((&key, v));
        }
        with_env(&set, &[&type_key, &key], || {
            let cfg = ChainsConfig::from_env().expect("from_env without plusd key");
            assert!(cfg.plusd_addresses.is_empty());
        });
    }
}

#[test]
fn evm_plusd_address_that_is_not_an_address_is_error() {
    with_env(
        &[
            ("CHAINS", "7104"),
            ("DEFAULT_CHAIN_ID", "7104"),
            ("CHAIN_7104_EVM_API_LOAN_REGISTRY_ADDRESS", EVM_REGISTRY),
            ("CHAIN_7104_EVM_API_PLUSD_ADDRESS", "0xnope"),
        ],
        &["CHAIN_7104_TYPE"],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_7104_EVM_API_PLUSD_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}

#[test]
fn stellar_plusd_address_is_parsed_and_normalised() {
    let padded = format!(" {STELLAR_REGISTRY_2} ");
    with_env(
        &[
            ("CHAINS", "99000031"),
            ("DEFAULT_CHAIN_ID", "99000031"),
            ("CHAIN_99000031_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000031_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            ("CHAIN_99000031_STELLAR_API_PLUSD_ADDRESS", &padded),
        ],
        &[
            "CHAIN_99000031_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000031_API_STELLAR_WQ_CONTRACT_ID",
        ],
        || {
            let cfg = ChainsConfig::from_env().expect("from_env with stellar plusd key");
            assert_eq!(cfg.plusd_addresses[&99_000_031], STELLAR_REGISTRY_2);
        },
    );
}

#[test]
fn stellar_plusd_address_bad_strkey_is_error() {
    with_env(
        &[
            ("CHAINS", "99000032"),
            ("DEFAULT_CHAIN_ID", "99000032"),
            ("CHAIN_99000032_TYPE", "stellar"),
            ("STELLAR_VERIFIER_SECRET", STELLAR_SECRET),
            (
                "CHAIN_99000032_STELLAR_API_LOAN_REGISTRY_ADDRESS",
                STELLAR_REGISTRY,
            ),
            ("CHAIN_99000032_STELLAR_API_PLUSD_ADDRESS", "CNOTAREALID"),
        ],
        &[
            "CHAIN_99000032_API_STELLAR_DM_CONTRACT_ID",
            "CHAIN_99000032_API_STELLAR_WQ_CONTRACT_ID",
        ],
        || {
            let msg = error_message(ChainsConfig::from_env());
            assert!(
                msg.contains("CHAIN_99000032_STELLAR_API_PLUSD_ADDRESS"),
                "unexpected error message: {msg}"
            );
        },
    );
}
