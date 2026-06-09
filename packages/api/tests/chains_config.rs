//! Env-var-based tests for `pipeline_api::config::ChainsConfig::from_env`.
//!
//! These mutate process-global env vars (`CHAINS`, `DEFAULT_CHAIN_ID`,
//! `CHAIN_<id>_*`), so they serialize on a local mutex. Each integration
//! test file is its own binary; cross-binary tests don't share process env,
//! so the lock only needs to cover this file.

use std::sync::Mutex;

use pipeline_api::config::ChainsConfig;

static ENV_LOCK: Mutex<()> = Mutex::new(());

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
        &[("CHAINS", "99"), ("DEFAULT_CHAIN_ID", "99")],
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
