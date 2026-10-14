use std::sync::Mutex;

use pipeline_worker::indexer::config::IndexerJobSettings;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const CHAIN_ID: i64 = 99_000_484;
const REQUIRED: [&str; 5] = [
    "DEPOSIT_MANAGER_ADDRESS",
    "WITHDRAWAL_QUEUE_ADDRESS",
    "STAKED_PLUSD_ADDRESS",
    "LOAN_REGISTRY_ADDRESS",
    "MINTER_ADDRESS",
];

fn ip() -> String {
    format!("CHAIN_{CHAIN_ID}_EVM_INDEXER_")
}

fn reset() {
    let p = format!("CHAIN_{CHAIN_ID}_EVM_");
    // SAFETY: serialized via ENV_LOCK; only one test runs at a time.
    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "http://localhost:8545");
        for key in REQUIRED {
            std::env::set_var(
                format!("{}{key}", ip()),
                "0x0000000000000000000000000000000000000001",
            );
        }
        std::env::remove_var(format!("{}COLLATERAL_REGISTRY_ADDRESS", ip()));
    }
}

fn cr_key() -> String {
    format!("{}COLLATERAL_REGISTRY_ADDRESS", ip())
}

#[test]
fn unset_key_is_none() {
    let _g = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    reset();
    let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
    assert_eq!(s.collateral_registry_address, None);
}

#[test]
fn blank_key_is_none() {
    let _g = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    reset();
    for v in ["", "   ", "\t"] {
        unsafe { std::env::set_var(cr_key(), v) };
        let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
        assert_eq!(s.collateral_registry_address, None);
    }
}

#[test]
fn set_key_is_trimmed() {
    let _g = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    reset();
    unsafe { std::env::set_var(cr_key(), "  0xb3D45A8E4816321F806a5eDCB62330CAaC23b26f  ") };
    let s = IndexerJobSettings::from_chain_env(CHAIN_ID).unwrap();
    assert_eq!(
        s.collateral_registry_address.as_deref(),
        Some("0xb3D45A8E4816321F806a5eDCB62330CAaC23b26f")
    );
}

#[test]
fn required_keys_still_error_when_missing() {
    let _g = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for key in REQUIRED {
        reset();
        unsafe { std::env::remove_var(format!("{}{key}", ip())) };
        assert!(
            IndexerJobSettings::from_chain_env(CHAIN_ID).is_err(),
            "{key} must stay required"
        );
    }
}

mod boot_check {
    use alloy::primitives::Address;
    use pipeline_worker::indexer::parse_collateral_registry_contracts;

    const A: &str = "0x00000000000000000000000000000000000000aB";

    fn others() -> Vec<Address> {
        vec![
            "0x0000000000000000000000000000000000000001"
                .parse()
                .unwrap(),
            A.parse().unwrap(),
        ]
    }

    #[test]
    fn unset_ships_dark() {
        assert!(parse_collateral_registry_contracts(7, None, &others())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn duplicate_is_rejected_case_insensitively_naming_key() {
        let err = parse_collateral_registry_contracts(
            7,
            Some("0x00000000000000000000000000000000000000AB"),
            &others(),
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("CHAIN_7_EVM_INDEXER_COLLATERAL_REGISTRY_ADDRESS"));
        let lower = A.to_lowercase();
        assert!(parse_collateral_registry_contracts(7, Some(&lower), &others()).is_err());
    }

    #[test]
    fn distinct_is_accepted() {
        let got = parse_collateral_registry_contracts(
            7,
            Some("0x0000000000000000000000000000000000000002"),
            &others(),
        )
        .unwrap();
        assert_eq!(got.len(), 1);
    }
}
