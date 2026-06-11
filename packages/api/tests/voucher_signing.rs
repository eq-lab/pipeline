//! Tests for `pipeline_api::routes::vouchers` pure dispatch helpers.
//!
//! Pure helpers — no DB access, no env-var mutation. The `AppState` is
//! constructed in-memory with a lazy (never-connected) sqlx pool, just so the
//! struct can be built; the helpers themselves only read the per-chain HashMaps.

use std::collections::HashMap;

use alloy::signers::local::PrivateKeySigner;

use pipeline_api::routes::vouchers::{
    normalise_wallet, resolve_evm_voucher_signing, resolve_stellar_voucher_signing, VoucherError,
};
use pipeline_api::AppState;
use shared::chains::ChainKind;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::eip712::Eip712Domain;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;

fn make_test_state(chain_id: i64, with_evm_signer: bool) -> AppState {
    // `connect_lazy` does not open a connection; the pool is never actually
    // used because the helpers being tested are pure.
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap();

    let mut voucher_signers = HashMap::new();
    let mut dm_domains = HashMap::new();
    let mut wq_domains = HashMap::new();

    if with_evm_signer {
        // Well-known Hardhat test private key.
        let signer: PrivateKeySigner =
            "0x4c0883a69102937d6231471b5dbb6e538eba2907d4019aaccc2e0c4694a507a5"
                .parse()
                .unwrap();
        let addr = signer.address();
        let dm = Eip712Domain {
            name: "PipelineDepositManager".to_owned(),
            version: "v1".to_owned(),
            chain_id: chain_id as u64,
            verifying_contract: addr,
        };
        let wq = Eip712Domain {
            name: "PipelineWithdrawalQueue".to_owned(),
            version: "v1".to_owned(),
            chain_id: chain_id as u64,
            verifying_contract: addr,
        };
        voucher_signers.insert(chain_id, signer);
        dm_domains.insert(chain_id, dm);
        wq_domains.insert(chain_id, wq);
    }

    AppState {
        pool: pool.clone(),
        kyc_repo: KycRepo::new(pool.clone()),
        position_repo: PositionRepo::new(pool.clone()),
        contract_logs_repo: ContractLogsRepo::new(pool),
        default_chain_id: chain_id,
        sumsub_client: None,
        sumsub_settings: None,
        voucher_signers,
        dm_domains,
        wq_domains,
        stellar_voucher_signers: HashMap::new(),
        crystal_enabled: false,
    }
}

// ── EVM dispatch ──────────────────────────────────────────────────────────────

#[tokio::test(flavor = "current_thread")]
async fn resolve_evm_voucher_signing_chain_present() {
    let state = make_test_state(1, true);
    let result = resolve_evm_voucher_signing(&state, 1, true);
    assert!(result.is_ok(), "chain 1 has a signer, should succeed");
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_evm_voucher_signing_chain_missing() {
    let state = make_test_state(1, false);
    let result = resolve_evm_voucher_signing(&state, 1, true);
    assert!(result.is_err());
    let VoucherError::ChainNotConfigured(cid) = result.unwrap_err();
    assert_eq!(cid, 1);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_evm_voucher_signing_wrong_chain() {
    // State has chain 1 configured; asking for chain 99 → error.
    let state = make_test_state(1, true);
    let result = resolve_evm_voucher_signing(&state, 99, true);
    assert!(result.is_err());
    let VoucherError::ChainNotConfigured(cid) = result.unwrap_err();
    assert_eq!(cid, 99);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_evm_voucher_signing_wq_domain() {
    let state = make_test_state(42, true);
    let result = resolve_evm_voucher_signing(&state, 42, false);
    assert!(result.is_ok(), "chain 42 should have wq domain");
    let (_, domain) = result.expect("wq domain for chain 42");
    assert_eq!(domain.name, "PipelineWithdrawalQueue");
}

// ── Stellar dispatch ──────────────────────────────────────────────────────────

#[tokio::test(flavor = "current_thread")]
async fn resolve_stellar_voucher_signing_no_config_returns_err() {
    // stellar_voucher_signers is empty — any chain_id returns ChainNotConfigured.
    let state = make_test_state(99_000_001, false);
    let result = resolve_stellar_voucher_signing(&state, 99_000_001);
    assert!(result.is_err());
    let VoucherError::ChainNotConfigured(cid) = result.unwrap_err();
    assert_eq!(cid, 99_000_001);
}

// ── Wallet normalisation ──────────────────────────────────────────────────────

#[test]
fn evm_wallet_lowercased() {
    let result = normalise_wallet(ChainKind::Evm, "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12");
    assert_eq!(
        result.unwrap(),
        "0xabcdef1234567890abcdef1234567890abcdef12"
    );
}

#[test]
fn stellar_wallet_passthrough_valid() {
    let valid = "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM";
    let result = normalise_wallet(ChainKind::Stellar, valid);
    assert_eq!(result.unwrap(), valid);
}

#[test]
fn stellar_wallet_lowercase_rejected() {
    let result =
        normalise_wallet(ChainKind::Stellar, "gc5suaxmrok67lie3ddmjg3ahhevsfdaz55a4ws655xyskin46rg7acm");
    assert!(result.is_err());
}

#[test]
fn u128_overflow_is_detected() {
    // 2^128 overflows u128
    let big = "340282366920938463463374607431768211456"; // 2^128
    let result: Result<u128, _> = big.parse();
    assert!(result.is_err(), "2^128 must not parse as u128");
}
