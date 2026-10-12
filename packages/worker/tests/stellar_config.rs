/// Unit tests for Stellar chain type parsing and settings.
///
/// All tests set env vars directly without touching a DB.
use pipeline_worker::indexer::config::{parse_chain_type, ChainType};

// ── parse_chain_type ──────────────────────────────────────────────────────────

#[test]
fn parse_chain_type_defaults_to_evm_when_unset() {
    // Ensure the env var is not set (use a unique chain_id unlikely to conflict)
    let chain_id = 999_888_777_i64;
    let key = format!("CHAIN_{chain_id}_TYPE");
    unsafe { std::env::remove_var(&key) };

    let ty = parse_chain_type(chain_id).expect("should succeed");
    assert_eq!(ty, ChainType::Evm);
}

#[test]
fn parse_chain_type_returns_evm_for_explicit_evm() {
    let chain_id = 999_888_776_i64;
    let key = format!("CHAIN_{chain_id}_TYPE");
    unsafe { std::env::set_var(&key, "evm") };

    let ty = parse_chain_type(chain_id).expect("should succeed");
    assert_eq!(ty, ChainType::Evm);

    unsafe { std::env::remove_var(&key) };
}

#[test]
fn parse_chain_type_returns_stellar_for_stellar() {
    let chain_id = 99_000_001_i64;
    let key = format!("CHAIN_{chain_id}_TYPE");
    unsafe { std::env::set_var(&key, "stellar") };

    let ty = parse_chain_type(chain_id).expect("should succeed");
    assert_eq!(ty, ChainType::Stellar);

    unsafe { std::env::remove_var(&key) };
}

#[test]
fn parse_chain_type_rejects_unknown_value() {
    let chain_id = 999_888_775_i64;
    let key = format!("CHAIN_{chain_id}_TYPE");
    unsafe { std::env::set_var(&key, "cosmos") };

    let err = parse_chain_type(chain_id);
    assert!(err.is_err(), "should fail for unknown chain type");
    let msg = format!("{}", err.err().unwrap());
    assert!(msg.contains("cosmos"), "error should mention the bad value");

    unsafe { std::env::remove_var(&key) };
}

// ── StellarIndexerSettings::from_chain_env ───────────────────────────────────

#[test]
fn stellar_settings_from_env_happy_path() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_001_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
    }

    let s = StellarIndexerSettings::from_chain_env(id).expect("should succeed");
    assert_eq!(s.chain_id, id);
    assert_eq!(s.rpc_url, "https://soroban-testnet.stellar.org");
    // Testnet sentinel gets default passphrase
    assert_eq!(s.network_passphrase, "Test SDF Network ; September 2015");

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

#[test]
fn stellar_settings_from_env_missing_rpc_url() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_099_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    // Only set the contract IDs, not the RPC URL
    unsafe {
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
        // Ensure RPC_URL is not set
        std::env::remove_var(format!("{p}RPC_URL"));
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(err.is_err(), "should fail when RPC_URL is missing");

    unsafe {
        std::env::remove_var(format!("{p}NETWORK_PASSPHRASE"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

#[test]
fn stellar_settings_uppercases_lowercase_contract_ids() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_003_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        // Lowercase input — must be normalized to uppercase before being stored,
        // otherwise dispatch_parser's == comparison against RPC-returned uppercase
        // Strkey would silently drop every event.
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "cb62uzdtbjoqwtltqchqujjayo4bszc6qhvdhcjwd3xopwp4m3aljcoo",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
    }

    let s = StellarIndexerSettings::from_chain_env(id).expect("should succeed");
    assert_eq!(
        s.deposit_manager_id,
        "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

#[test]
fn stellar_settings_rejects_wrong_length_contract_id() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_004_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"), "CBTOOSHORT");
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(err.is_err(), "should fail on too-short contract id");
    let msg = format!("{}", err.err().unwrap());
    assert!(
        msg.contains("56-char"),
        "error should mention length: {msg}"
    );
    assert!(
        msg.contains("DEPOSIT_MANAGER_ADDRESS"),
        "error should name the bad key: {msg}"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

#[test]
fn stellar_settings_rejects_wrong_prefix_contract_id() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_005_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        // 'G' is the account prefix (ed25519 public key), not a contract.
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(err.is_err(), "should fail on G-prefixed (account) strkey");
    let msg = format!("{}", err.err().unwrap());
    assert!(
        msg.contains("starts with 'C'"),
        "error should mention C prefix: {msg}"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

#[test]
fn stellar_settings_rejects_non_base32_chars_in_contract_id() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_006_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    // '1' is not in the Strkey base32 alphabet (A-Z, 2-7). Length is correct (56).
    let bad_id = format!("C{}", "1".repeat(55));
    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"), &bad_id);
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(err.is_err(), "should fail on non-base32 chars");
    let msg = format!("{}", err.err().unwrap());
    assert!(
        msg.contains("base32"),
        "error should mention base32 alphabet: {msg}"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

#[test]
fn stellar_settings_rejects_duplicate_contract_ids() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_007_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    // WQ accidentally set to the same value as DM — copy-paste error.
    // dispatch_parser's if/else if would silently misroute WQ events to the
    // DM branch, so we must fail fast at startup.
    let dm = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"), dm);
        std::env::set_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"), dm);
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(
        err.is_err(),
        "should fail when two roles share a contract id"
    );
    let msg = format!("{}", err.err().unwrap());
    assert!(
        msg.contains("duplicates") && msg.contains("WITHDRAWAL_QUEUE_ADDRESS"),
        "error should name the duplicate role: {msg}"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

#[test]
fn stellar_settings_from_env_non_testnet_requires_passphrase() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_002_i64; // mainnet sentinel — no default passphrase
    let p = format!("CHAIN_{id}_STELLAR_");

    // Set all required vars except passphrase
    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-mainnet.stellar.org");
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
        std::env::remove_var(format!("{p}NETWORK_PASSPHRASE"));
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(
        err.is_err(),
        "should fail when passphrase is missing for mainnet"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

// ── loan_registry_id field (Issue #620) ──────────────────────────────────────

#[test]
fn loan_registry_id_unset_yields_none() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_020_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
        // Ensure LOAN_REGISTRY_ID is not set
        std::env::remove_var(format!("{p}INDEXER_LOAN_REGISTRY_ADDRESS"));
    }

    let s = StellarIndexerSettings::from_chain_env(id)
        .expect("should succeed when loan_registry_id is unset");
    assert!(
        s.loan_registry_id.is_none(),
        "loan_registry_id should be None when env var is absent"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}NETWORK_PASSPHRASE"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

#[test]
fn loan_registry_id_rejects_duplicate_of_dm() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_021_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    let dm = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"), dm);
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
        // LOAN_REGISTRY_ID set to same value as DEPOSIT_MANAGER_ID
        std::env::set_var(format!("{p}INDEXER_LOAN_REGISTRY_ADDRESS"), dm);
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(
        err.is_err(),
        "should fail when LOAN_REGISTRY_ADDRESS duplicates DEPOSIT_MANAGER_ADDRESS"
    );
    let msg = format!("{}", err.err().unwrap());
    assert!(
        msg.contains("duplicates") && msg.contains("LOAN_REGISTRY_ADDRESS"),
        "error should mention LOAN_REGISTRY_ADDRESS duplicate: {msg}"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}NETWORK_PASSPHRASE"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_LOAN_REGISTRY_ADDRESS"));
    }
}

// ── withdrawal_queue_wallet_id field (Issue #933) ─────────────────────────────

#[test]
fn withdrawal_queue_wallet_id_unset_yields_none() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_022_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS"));
    }

    let s = StellarIndexerSettings::from_chain_env(id)
        .expect("should succeed when withdrawal_queue_wallet_id is unset");
    assert!(
        s.withdrawal_queue_wallet_id.is_none(),
        "withdrawal_queue_wallet_id should be None when env var is absent"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}NETWORK_PASSPHRASE"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
    }
}

#[test]
fn withdrawal_queue_wallet_id_parses_g_account() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_023_i64;
    let p = format!("CHAIN_{id}_STELLAR_");
    let wallet = "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU";

    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS"),
            wallet,
        );
    }

    let s = StellarIndexerSettings::from_chain_env(id).expect("should succeed");
    assert_eq!(s.withdrawal_queue_wallet_id.as_deref(), Some(wallet));

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}NETWORK_PASSPHRASE"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS"));
    }
}

#[test]
fn withdrawal_queue_wallet_id_rejects_malformed_address() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_024_i64;
    let p = format!("CHAIN_{id}_STELLAR_");

    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS"),
            "NOTASTRKEY",
        );
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(err.is_err(), "malformed wallet address should fail");

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}NETWORK_PASSPHRASE"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS"));
    }
}

#[test]
fn yield_minter_id_rejects_a_bad_strkey_checksum() {
    use pipeline_worker::indexer::config::StellarIndexerSettings;

    let id = 99_000_033_i64;
    let p = format!("CHAIN_{id}_STELLAR_");
    // Right length, right alphabet, wrong CRC16 — two characters transposed.
    // The relayer refuses this id; the indexer must agree, or one component
    // boots while the other does not on the very same variable.
    let transposed = {
        let mut c: Vec<char> = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX"
            .chars()
            .collect();
        c.swap(10, 11);
        c.into_iter().collect::<String>()
    };

    unsafe {
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(
            format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"),
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        );
        std::env::set_var(
            format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
        std::env::set_var(format!("{p}INDEXER_MINTER_ADDRESS"), &transposed);
    }

    let result = StellarIndexerSettings::from_chain_env(id);
    assert!(
        result.is_err(),
        "a Strkey whose checksum does not match must fail startup, as it does in the relayer"
    );

    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}NETWORK_PASSPHRASE"));
        std::env::remove_var(format!("{p}INDEXER_DEPOSIT_MANAGER_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_WITHDRAWAL_QUEUE_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_STAKED_PLUSD_ADDRESS"));
        std::env::remove_var(format!("{p}INDEXER_MINTER_ADDRESS"));
    }
}
