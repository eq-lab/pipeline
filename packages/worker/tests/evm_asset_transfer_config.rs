// spec: docs/exec-plans/active/financial-apis-multichain.md (Part B — EVM sources)
use std::sync::Mutex;

use alloy::primitives::Address;
use pipeline_worker::indexer::config::IndexerJobSettings;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const CHAIN_ID: i64 = 99_001_600;
const CORE: &str = "0x2886135EDF68665dC796A33F7723000fe2E0DC81";
const USDC: &str = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WALLET: &str = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const CUSTODY: &str = "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB";
const RAMP: &str = "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb";

fn key(suffix: &str) -> String {
    format!("CHAIN_{CHAIN_ID}_EVM_{suffix}")
}

fn addr(s: &str) -> Address {
    s.parse().unwrap()
}

fn with_tracking_env<F: FnOnce()>(set: &[(&str, &str)], f: F) {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let tracking_keys = [
        "INDEXER_ASSET_ADDRESS",
        "INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS",
        "INDEXER_CUSTODY_ADDRESSES",
        "INDEXER_RAMP_ADDRESSES",
    ];
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
        for k in tracking_keys {
            std::env::remove_var(key(k));
        }
        for (k, v) in set {
            std::env::set_var(key(k), v);
        }
    }
    f();
    unsafe {
        for k in tracking_keys {
            std::env::remove_var(key(k));
        }
    }
}

#[test]
fn tracking_is_off_without_asset_address() {
    with_tracking_env(
        &[("INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS", WALLET)],
        || {
            let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
            assert_eq!(s.asset_tracking, None);
        },
    );
}

#[test]
fn full_config_parses_wallet_and_deduped_custody_ramp_union() {
    let custody = format!("{}, {}", CUSTODY.to_lowercase(), RAMP);
    with_tracking_env(
        &[
            (
                "INDEXER_ASSET_ADDRESS",
                &format!(" {} ", USDC.to_lowercase()),
            ),
            ("INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS", WALLET),
            ("INDEXER_CUSTODY_ADDRESSES", &custody),
            ("INDEXER_RAMP_ADDRESSES", RAMP),
        ],
        || {
            let t = IndexerJobSettings::from_chain_env(CHAIN_ID)
                .unwrap()
                .asset_tracking
                .unwrap();
            assert_eq!(t.asset, addr(USDC));
            assert_eq!(t.withdrawal_queue_wallet, Some(addr(WALLET)));
            assert_eq!(t.tracked, vec![addr(CUSTODY), addr(RAMP)]);
        },
    );
}

#[test]
fn partial_custody_ramp_pair_is_disabled_but_wallet_kept() {
    with_tracking_env(
        &[
            ("INDEXER_ASSET_ADDRESS", USDC),
            ("INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS", WALLET),
            ("INDEXER_CUSTODY_ADDRESSES", "not-an-address"),
        ],
        || {
            let t = IndexerJobSettings::from_chain_env(CHAIN_ID)
                .unwrap()
                .asset_tracking
                .unwrap();
            assert!(t.tracked.is_empty());
            assert_eq!(t.withdrawal_queue_wallet, Some(addr(WALLET)));
        },
    );
}

#[test]
fn asset_without_wallet_or_pair_tracks_nothing() {
    with_tracking_env(&[("INDEXER_ASSET_ADDRESS", USDC)], || {
        let t = IndexerJobSettings::from_chain_env(CHAIN_ID)
            .unwrap()
            .asset_tracking
            .unwrap();
        assert_eq!(t.withdrawal_queue_wallet, None);
        assert!(t.tracked.is_empty());
    });
}

#[test]
fn invalid_addresses_are_rejected_with_their_key() {
    for (bad_key, set) in [
        (
            "INDEXER_ASSET_ADDRESS",
            vec![("INDEXER_ASSET_ADDRESS", "0x123")],
        ),
        (
            "INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS",
            vec![
                ("INDEXER_ASSET_ADDRESS", USDC),
                ("INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS", "GABC"),
            ],
        ),
        (
            "INDEXER_RAMP_ADDRESSES",
            vec![
                ("INDEXER_ASSET_ADDRESS", USDC),
                ("INDEXER_CUSTODY_ADDRESSES", CUSTODY),
                ("INDEXER_RAMP_ADDRESSES", "0xnope"),
            ],
        ),
    ] {
        with_tracking_env(&set, || {
            let err = IndexerJobSettings::from_chain_env(CHAIN_ID)
                .err()
                .map(|e| e.to_string())
                .unwrap_or_default();
            assert!(err.contains(&key(bad_key)), "{bad_key}: {err}");
        });
    }
}
