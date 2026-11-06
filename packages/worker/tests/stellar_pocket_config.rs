// spec: docs/references/backend.md#stellar-pocket-indexing
use pipeline_worker::indexer::config::StellarIndexerSettings;

const DM: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const WQ: &str = "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL";
const SP: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const POCKET: &str = "CD464CN7ZWOYRGCTHE74Q5PR3JSRPTHDRZYD4OZR4DY64ZSBJ6YZ2RA5";
const MINTER: &str = "CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS";

fn setup(id: i64, pocket: Option<&str>, minter: Option<&str>, lr: Option<&str>) -> String {
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
        for (key, value) in [
            ("POCKET_ADDRESS", pocket),
            ("MINTER_ADDRESS", minter),
            ("LOAN_REGISTRY_ADDRESS", lr),
        ] {
            match value {
                Some(v) => std::env::set_var(format!("{p}INDEXER_{key}"), v),
                None => std::env::remove_var(format!("{p}INDEXER_{key}")),
            }
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
            "INDEXER_POCKET_ADDRESS",
            "INDEXER_MINTER_ADDRESS",
            "INDEXER_LOAN_REGISTRY_ADDRESS",
        ] {
            std::env::remove_var(format!("{p}{k}"));
        }
    }
}

#[test]
fn unset_gives_none() {
    let id = 99_017_891_i64;
    let p = setup(id, None, None, None);
    let s = StellarIndexerSettings::from_chain_env(id).unwrap();
    assert_eq!(s.pocket_id, None);
    teardown(&p);
}

#[test]
fn whitespace_only_gives_none() {
    let id = 99_017_892_i64;
    let p = setup(id, Some("   "), None, None);
    let s = StellarIndexerSettings::from_chain_env(id).unwrap();
    assert_eq!(s.pocket_id, None);
    teardown(&p);
}

#[test]
fn valid_id_gives_some() {
    let id = 99_017_893_i64;
    let p = setup(id, Some(POCKET), None, None);
    let s = StellarIndexerSettings::from_chain_env(id).unwrap();
    assert_eq!(s.pocket_id.as_deref(), Some(POCKET));
    teardown(&p);
}

#[test]
fn bad_crc_is_error_naming_the_key() {
    let id = 99_017_894_i64;
    let bad = format!("{}A", &POCKET[..55]);
    let p = setup(id, Some(&bad), None, None);
    let err = StellarIndexerSettings::from_chain_env(id)
        .err()
        .expect("should fail");
    assert!(err.to_string().contains("POCKET_ADDRESS"), "{err}");
    teardown(&p);
}

#[test]
fn duplicate_of_minter_is_error() {
    let id = 99_017_895_i64;
    let p = setup(id, Some(MINTER), Some(MINTER), None);
    let err = StellarIndexerSettings::from_chain_env(id)
        .err()
        .expect("should fail");
    let msg = err.to_string();
    assert!(msg.contains("duplicates"), "{msg}");
    assert!(msg.contains("POCKET_ADDRESS"), "{msg}");
    teardown(&p);
}

#[test]
fn duplicate_of_loan_registry_is_error() {
    let id = 99_017_896_i64;
    let p = setup(id, Some(POCKET), None, Some(POCKET));
    let err = StellarIndexerSettings::from_chain_env(id)
        .err()
        .expect("should fail");
    let msg = err.to_string();
    assert!(msg.contains("duplicates"), "{msg}");
    assert!(msg.contains("POCKET_ADDRESS"), "{msg}");
    teardown(&p);
}
