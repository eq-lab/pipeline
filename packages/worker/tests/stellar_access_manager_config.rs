// spec: docs/references/access-manager-events.md#configuration
use pipeline_worker::indexer::config::StellarIndexerSettings;

const DM: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const WQ: &str = "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL";
const SP: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const SECURITY: &str = "CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX";
const LOAN_REGISTRY: &str = "CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ";
const AM: &str = "CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW";

const KEYS: [&str; 3] = [
    "ACCESS_MANAGER_ADDRESS",
    "SECURITY_REGISTRY_ADDRESS",
    "LOAN_REGISTRY_ADDRESS",
];

fn load(id: i64, values: [Option<&str>; 3]) -> anyhow::Result<StellarIndexerSettings> {
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
    let result = StellarIndexerSettings::from_chain_env(id);
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
    result
}

#[test]
fn unset_gives_none() {
    let s = load(99_021_921, [None; 3]).unwrap();
    assert_eq!(s.access_manager_id, None);
}

#[test]
fn whitespace_only_gives_none() {
    let s = load(99_021_922, [Some("   "), None, None]).unwrap();
    assert_eq!(s.access_manager_id, None);
}

#[test]
fn valid_id_gives_some() {
    let s = load(99_021_923, [Some(AM), None, None]).unwrap();
    assert_eq!(s.access_manager_id.as_deref(), Some(AM));
}

#[test]
fn bad_strkey_is_an_error_naming_the_key() {
    let bad = format!("{}A", &AM[..55]);
    let err = load(99_021_924, [Some(&bad), None, None])
        .err()
        .expect("should fail");
    assert!(err.to_string().contains("ACCESS_MANAGER_ADDRESS"), "{err}");
}

#[test]
fn same_id_as_another_role_is_the_distinct_role_error() {
    for (idx, id) in [(1usize, 99_021_925_i64), (2, 99_021_926)] {
        let mut values = [Some(AM), None, None];
        values[idx] = Some(AM);
        let err = load(id, values).err().expect("should fail");
        let msg = err.to_string();
        assert!(msg.contains("duplicates"), "{msg}");
        assert!(msg.contains("ACCESS_MANAGER_ADDRESS"), "{msg}");
    }
}

#[test]
fn coexists_with_security_and_loan_registry() {
    let s = load(99_021_927, [Some(AM), Some(SECURITY), Some(LOAN_REGISTRY)]).unwrap();
    assert_eq!(s.access_manager_id.as_deref(), Some(AM));
    assert_eq!(s.security_registry_id.as_deref(), Some(SECURITY));
    assert_eq!(s.loan_registry_id.as_deref(), Some(LOAN_REGISTRY));
}
