//! Unit tests for the Stellar asset-transfer tracking config (custody/ramp flows).
//!
//! These live in their own test binary (separate process) because the config is
//! job-level and read from **process-global** `JOB_INDEXER_STELLAR_*` env vars.
//! Keeping them out of `stellar_config.rs` means that file's per-chain tests stay
//! parallel-safe without a lock, and the global mutations here can't leak into
//! another binary. Within this binary the tests still serialize on `ENV_LOCK`,
//! since they all mutate the same three globals. No DB access.

use std::sync::Mutex;

use pipeline_worker::indexer::config::StellarIndexerSettings;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const ASSET_ID: &str = "CCEMOFO5TE6MDLNKU3TB4QDVWLGWM6MBMB5RQKLB4APLDGX3RG4QYFHU";
const CUSTODY_G: &str = "GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD";
const RAMP_G: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const DM_ID: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";

const ASSET_KEY: &str = "JOB_INDEXER_STELLAR_ASSET_ID";
const CUSTODY_KEY: &str = "JOB_INDEXER_STELLAR_CUSTODY_ADDRESSES";
const RAMP_KEY: &str = "JOB_INDEXER_STELLAR_RAMP_ADDRESSES";

/// Set the always-required per-chain Stellar contract vars + RPC/passphrase for
/// `id`, and clear the process-global asset-tracking vars so each test starts
/// from a known state (guards against a prior test leaving them set).
fn set_base(id: i64) {
    let p = format!("CHAIN_{id}_STELLAR_");
    unsafe {
        std::env::remove_var(ASSET_KEY);
        std::env::remove_var(CUSTODY_KEY);
        std::env::remove_var(RAMP_KEY);
        std::env::set_var(format!("{p}RPC_URL"), "https://soroban-testnet.stellar.org");
        std::env::set_var(
            format!("{p}NETWORK_PASSPHRASE"),
            "Test SDF Network ; September 2015",
        );
        std::env::set_var(format!("{p}DEPOSIT_MANAGER_ID"), DM_ID);
        std::env::set_var(
            format!("{p}WITHDRAWAL_QUEUE_ID"),
            "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        );
        std::env::set_var(
            format!("{p}STAKED_PLUSD_ID"),
            "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        );
    }
}

fn clear(id: i64) {
    let p = format!("CHAIN_{id}_STELLAR_");
    unsafe {
        std::env::remove_var(format!("{p}RPC_URL"));
        std::env::remove_var(format!("{p}NETWORK_PASSPHRASE"));
        std::env::remove_var(format!("{p}DEPOSIT_MANAGER_ID"));
        std::env::remove_var(format!("{p}WITHDRAWAL_QUEUE_ID"));
        std::env::remove_var(format!("{p}STAKED_PLUSD_ID"));
        std::env::remove_var(ASSET_KEY);
        std::env::remove_var(CUSTODY_KEY);
        std::env::remove_var(RAMP_KEY);
    }
}

#[test]
fn tracking_enabled_when_all_set() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id = 99_000_050_i64;
    set_base(id);
    unsafe {
        std::env::set_var(ASSET_KEY, ASSET_ID);
        std::env::set_var(CUSTODY_KEY, CUSTODY_G);
        std::env::set_var(RAMP_KEY, RAMP_G);
    }

    let s = StellarIndexerSettings::from_chain_env(id).expect("should succeed");
    assert_eq!(s.asset_id.as_deref(), Some(ASSET_ID));
    assert_eq!(s.custody_addresses, vec![CUSTODY_G.to_owned()]);
    assert_eq!(s.ramp_addresses, vec![RAMP_G.to_owned()]);

    clear(id);
}

#[test]
fn parses_multiple_addresses_trimmed_and_uppercased() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id = 99_000_051_i64;
    set_base(id);
    unsafe {
        std::env::set_var(ASSET_KEY, ASSET_ID);
        // Two custody addresses, first lowercased and space-padded.
        std::env::set_var(
            CUSTODY_KEY,
            format!("  {} , {}", CUSTODY_G.to_lowercase(), ASSET_ID),
        );
        std::env::set_var(RAMP_KEY, RAMP_G);
    }

    let s = StellarIndexerSettings::from_chain_env(id).expect("should succeed");
    assert_eq!(
        s.custody_addresses,
        vec![CUSTODY_G.to_owned(), ASSET_ID.to_owned()],
        "addresses should be trimmed and uppercased"
    );

    clear(id);
}

#[test]
fn dark_when_none_set() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id = 99_000_052_i64;
    set_base(id); // set_base already clears the three globals

    let s = StellarIndexerSettings::from_chain_env(id).expect("should succeed (ships dark)");
    assert!(s.asset_id.is_none());
    assert!(s.custody_addresses.is_empty());
    assert!(s.ramp_addresses.is_empty());

    clear(id);
}

#[test]
fn disabled_on_partial_config() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id = 99_000_053_i64;
    set_base(id);
    // Asset id + custody set, ramp missing → partial → disabled (no error).
    unsafe {
        std::env::set_var(ASSET_KEY, ASSET_ID);
        std::env::set_var(CUSTODY_KEY, CUSTODY_G);
    }

    let s = StellarIndexerSettings::from_chain_env(id)
        .expect("partial config should not error, just disable");
    assert!(s.asset_id.is_none(), "partial config disables tracking");
    assert!(s.custody_addresses.is_empty());
    assert!(s.ramp_addresses.is_empty());

    clear(id);
}

#[test]
fn asset_id_duplicate_role_errors() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id = 99_000_054_i64;
    set_base(id);
    unsafe {
        // ASSET_ID duplicates DEPOSIT_MANAGER_ID; custody+ramp set so tracking enables.
        std::env::set_var(ASSET_KEY, DM_ID);
        std::env::set_var(CUSTODY_KEY, CUSTODY_G);
        std::env::set_var(RAMP_KEY, RAMP_G);
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(
        err.is_err(),
        "asset id duplicating another role should fail"
    );
    let msg = format!("{}", err.err().unwrap());
    assert!(
        msg.contains("duplicates") && msg.contains("ASSET_ID"),
        "error should mention ASSET_ID duplicate: {msg}"
    );

    clear(id);
}

#[test]
fn fully_configured_rejects_invalid_address() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id = 99_000_055_i64;
    set_base(id);
    unsafe {
        // All three present → validate strictly → a malformed address fails loudly.
        std::env::set_var(ASSET_KEY, ASSET_ID);
        std::env::set_var(CUSTODY_KEY, "NOTASTRKEY");
        std::env::set_var(RAMP_KEY, RAMP_G);
    }

    let err = StellarIndexerSettings::from_chain_env(id);
    assert!(err.is_err(), "invalid custody address should fail");
    let msg = format!("{}", err.err().unwrap());
    assert!(
        msg.contains("CUSTODY_ADDRESSES"),
        "error should name the bad key: {msg}"
    );

    clear(id);
}

#[test]
fn partial_config_with_malformed_address_disables_without_error() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let id = 99_000_056_i64;
    set_base(id);
    unsafe {
        // Custody malformed, but ramp absent → partial config. Validation is
        // deferred to the fully-configured case, so this disables (no crash)
        // rather than failing worker startup on a typo.
        std::env::set_var(ASSET_KEY, ASSET_ID);
        std::env::set_var(CUSTODY_KEY, "NOTASTRKEY");
    }

    let s = StellarIndexerSettings::from_chain_env(id)
        .expect("partial config must not error even with a malformed address");
    assert!(s.asset_id.is_none(), "partial config disables tracking");
    assert!(s.custody_addresses.is_empty());
    assert!(s.ramp_addresses.is_empty());

    clear(id);
}
