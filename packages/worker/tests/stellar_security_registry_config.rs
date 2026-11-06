// spec: docs/references/backend.md#stellar-contract-ids-and-signer-roles
use pipeline_worker::indexer::config::StellarIndexerSettings;

const DM: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const WQ: &str = "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL";
const SP: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const SECURITY: &str = "CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX";
const POCKET: &str = "CD464CN7ZWOYRGCTHE74Q5PR3JSRPTHDRZYD4OZR4DY64ZSBJ6YZ2RA5";
const LEGACY: &str = "CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS";
const LOAN_REGISTRY: &str = "CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ";

const KEYS: [&str; 4] = [
    "SECURITY_REGISTRY_ADDRESS",
    "POCKET_ADDRESS",
    "COLLATERAL_REGISTRY_ADDRESS",
    "LOAN_REGISTRY_ADDRESS",
];

fn setup(id: i64, values: [Option<&str>; 4]) -> String {
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
        for (key, value) in KEYS.iter().zip(values) {
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
        ] {
            std::env::remove_var(format!("{p}{k}"));
        }
        for k in KEYS {
            std::env::remove_var(format!("{p}INDEXER_{k}"));
        }
    }
}

fn load(id: i64, values: [Option<&str>; 4]) -> anyhow::Result<StellarIndexerSettings> {
    let p = setup(id, values);
    let result = StellarIndexerSettings::from_chain_env(id);
    teardown(&p);
    result
}

#[test]
fn unset_gives_none() {
    let s = load(99_017_911, [None; 4]).unwrap();
    assert_eq!(s.security_registry_id, None);
}

#[test]
fn whitespace_only_gives_none() {
    let s = load(99_017_912, [Some("   "), None, None, None]).unwrap();
    assert_eq!(s.security_registry_id, None);
}

#[test]
fn valid_id_gives_some() {
    let s = load(99_017_913, [Some(SECURITY), None, None, None]).unwrap();
    assert_eq!(s.security_registry_id.as_deref(), Some(SECURITY));
}

#[test]
fn bad_crc_is_error_naming_the_key() {
    let bad = format!("{}A", &SECURITY[..55]);
    let err = load(99_017_914, [Some(&bad), None, None, None])
        .err()
        .expect("should fail");
    assert!(
        err.to_string().contains("SECURITY_REGISTRY_ADDRESS"),
        "{err}"
    );
}

#[test]
fn equal_to_another_role_is_the_distinct_role_error() {
    for (idx, id) in [(1usize, 99_017_915_i64), (2, 99_017_916), (3, 99_017_917)] {
        let mut values = [Some(SECURITY), None, None, None];
        values[idx] = Some(SECURITY);
        let err = load(id, values).err().expect("should fail");
        let msg = err.to_string();
        assert!(msg.contains("duplicates"), "{msg}");
        assert!(msg.contains("SECURITY_REGISTRY_ADDRESS"), "{msg}");
    }
}

#[test]
fn legacy_collateral_key_alone_still_works() {
    let s = load(99_017_918, [None, None, Some(LEGACY), None]).unwrap();
    assert_eq!(s.collateral_registry_id.as_deref(), Some(LEGACY));
    assert_eq!(s.security_registry_id, None);
}

#[test]
fn security_and_legacy_collateral_coexist() {
    let s = load(
        99_017_919,
        [
            Some(SECURITY),
            Some(POCKET),
            Some(LEGACY),
            Some(LOAN_REGISTRY),
        ],
    )
    .unwrap();
    assert_eq!(s.security_registry_id.as_deref(), Some(SECURITY));
    assert_eq!(s.collateral_registry_id.as_deref(), Some(LEGACY));
}
