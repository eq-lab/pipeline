// spec: docs/references/collateral-registry-events.md#configuration
use pipeline_worker::indexer::config::StellarIndexerSettings;

const DM: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const WQ: &str = "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL";
const SP: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const CR: &str = "CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS";

fn setup(id: i64, cr: Option<&str>, lr: Option<&str>) -> String {
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
        match cr {
            Some(v) => std::env::set_var(format!("{p}INDEXER_COLLATERAL_REGISTRY_ADDRESS"), v),
            None => std::env::remove_var(format!("{p}INDEXER_COLLATERAL_REGISTRY_ADDRESS")),
        }
        match lr {
            Some(v) => std::env::set_var(format!("{p}INDEXER_LOAN_REGISTRY_ADDRESS"), v),
            None => std::env::remove_var(format!("{p}INDEXER_LOAN_REGISTRY_ADDRESS")),
        }
    }
    p
}

fn teardown(p: &str) {
    unsafe {
        for k in [
            "RPC_URL",
            "NETWORK_PASSPHRASE",
            "INDEXER_DEPOSIT_MANAGER_ADDRESS",
            "INDEXER_WITHDRAWAL_QUEUE_ADDRESS",
            "INDEXER_STAKED_PLUSD_ADDRESS",
            "INDEXER_COLLATERAL_REGISTRY_ADDRESS",
            "INDEXER_LOAN_REGISTRY_ADDRESS",
        ] {
            std::env::remove_var(format!("{p}{k}"));
        }
    }
}

#[test]
fn unset_gives_none() {
    let id = 99_014_811_i64;
    let p = setup(id, None, None);
    let s = StellarIndexerSettings::from_chain_env(id).unwrap();
    assert_eq!(s.collateral_registry_id, None);
    teardown(&p);
}

#[test]
fn whitespace_only_gives_none() {
    let id = 99_014_812_i64;
    let p = setup(id, Some("   "), None);
    let s = StellarIndexerSettings::from_chain_env(id).unwrap();
    assert_eq!(s.collateral_registry_id, None);
    teardown(&p);
}

#[test]
fn lowercase_id_is_uppercased() {
    let id = 99_014_813_i64;
    let p = setup(id, Some(&CR.to_lowercase()), None);
    let s = StellarIndexerSettings::from_chain_env(id).unwrap();
    assert_eq!(s.collateral_registry_id.as_deref(), Some(CR));
    teardown(&p);
}

#[test]
fn bad_crc_is_error_naming_the_key() {
    let id = 99_014_814_i64;
    let bad = format!("{}A", &CR[..55]);
    let p = setup(id, Some(&bad), None);
    let err = StellarIndexerSettings::from_chain_env(id)
        .err()
        .expect("should fail");
    assert!(
        err.to_string().contains("COLLATERAL_REGISTRY_ADDRESS"),
        "{err}"
    );
    teardown(&p);
}

#[test]
fn duplicate_of_loan_registry_is_error() {
    let id = 99_014_815_i64;
    let p = setup(id, Some(CR), Some(CR));
    let err = StellarIndexerSettings::from_chain_env(id)
        .err()
        .expect("should fail");
    let msg = err.to_string();
    assert!(msg.contains("duplicates"), "{msg}");
    assert!(msg.contains("COLLATERAL_REGISTRY_ADDRESS"), "{msg}");
    teardown(&p);
}

#[test]
fn duplicate_of_deposit_manager_is_error() {
    let id = 99_014_816_i64;
    let p = setup(id, Some(DM), None);
    let err = StellarIndexerSettings::from_chain_env(id)
        .err()
        .expect("should fail");
    let msg = err.to_string();
    assert!(msg.contains("duplicates"), "{msg}");
    assert!(msg.contains("COLLATERAL_REGISTRY_ADDRESS"), "{msg}");
    teardown(&p);
}
