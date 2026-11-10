// spec: docs/references/backend.md#plusd-transfer-indexing
use std::sync::Mutex;

use pipeline_worker::indexer::config::StellarIndexerSettings;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const DM: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const WQ: &str = "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL";
const SP: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const PLUSD: &str = "CDGHLVGY2GH2GKIRPVA2PCC27GVYQONVYHKGEEYF2S5PXTLRP2XEN6AU";
const ASSET_KEY: &str = "JOB_INDEXER_STELLAR_ASSET_ID";

fn with_env<F: FnOnce(i64)>(id: i64, plusd: Option<&str>, asset: Option<&str>, f: F) {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let p = format!("CHAIN_{id}_STELLAR_");
    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"), DM);
        std::env::set_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"), WQ);
        std::env::set_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"), SP);
        match plusd {
            Some(v) => std::env::set_var(format!("{p}INDEXER_PLUSD_ADDRESS"), v),
            None => std::env::remove_var(format!("{p}INDEXER_PLUSD_ADDRESS")),
        }
        match asset {
            Some(v) => std::env::set_var(ASSET_KEY, v),
            None => std::env::remove_var(ASSET_KEY),
        }
    }
    f(id);
    unsafe {
        for k in [
            "RPC_URL",
            "NETWORK_PASSPHRASE",
            "INDEXER_DEPOSIT_MANAGER_ADDRESS",
            "INDEXER_WITHDRAWAL_QUEUE_ADDRESS",
            "INDEXER_STAKED_PLUSD_ADDRESS",
            "INDEXER_PLUSD_ADDRESS",
        ] {
            std::env::remove_var(format!("{p}{k}"));
        }
        std::env::remove_var(ASSET_KEY);
    }
}

#[test]
fn unset_gives_none() {
    with_env(99_018_651, None, None, |id| {
        let s = StellarIndexerSettings::from_chain_env(id).unwrap();
        assert_eq!(s.plusd_id, None);
    });
}

#[test]
fn blank_gives_none() {
    with_env(99_018_652, Some("   "), None, |id| {
        let s = StellarIndexerSettings::from_chain_env(id).unwrap();
        assert_eq!(s.plusd_id, None);
    });
}

#[test]
fn valid_id_is_stored() {
    with_env(99_018_653, Some(PLUSD), None, |id| {
        let s = StellarIndexerSettings::from_chain_env(id).unwrap();
        assert_eq!(s.plusd_id.as_deref(), Some(PLUSD));
    });
}

#[test]
fn bad_crc_is_an_error_naming_the_key() {
    let bad = format!("{}A", &PLUSD[..55]);
    with_env(99_018_654, Some(&bad), None, |id| {
        let err = StellarIndexerSettings::from_chain_env(id)
            .err()
            .expect("should fail");
        assert!(err.to_string().contains("PLUSD_ADDRESS"), "{err}");
    });
}

#[test]
fn equal_to_the_asset_id_is_the_duplicate_role_error() {
    with_env(99_018_655, Some(PLUSD), Some(PLUSD), |id| {
        let msg = StellarIndexerSettings::from_chain_env(id)
            .err()
            .expect("should fail")
            .to_string();
        assert!(msg.contains("duplicates"), "{msg}");
        assert!(msg.contains("ASSET_ID"), "{msg}");
    });
}

#[test]
fn equal_to_the_staked_plusd_id_is_the_duplicate_role_error() {
    with_env(99_018_656, Some(SP), None, |id| {
        let msg = StellarIndexerSettings::from_chain_env(id)
            .err()
            .expect("should fail")
            .to_string();
        assert!(msg.contains("duplicates"), "{msg}");
        assert!(msg.contains("PLUSD_ADDRESS"), "{msg}");
    });
}
