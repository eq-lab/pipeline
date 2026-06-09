//! Tests for `pipeline_api::routes::vouchers::resolve_voucher_signing`.
//!
//! Pure helper — no DB access, no env-var mutation. The `AppState` is
//! constructed in-memory with a lazy (never-connected) sqlx pool, just so the
//! struct can be built; the helper itself only reads the three per-chain
//! HashMaps.

use std::collections::HashMap;

use alloy::signers::local::PrivateKeySigner;

use pipeline_api::routes::vouchers::{resolve_voucher_signing, VoucherError};
use pipeline_api::AppState;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::eip712::Eip712Domain;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;

fn make_test_state(chain_id: i64, with_signer: bool) -> AppState {
    // `connect_lazy` does not open a connection; the pool is never actually
    // used because `resolve_voucher_signing` is pure.
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap();

    let mut voucher_signers = HashMap::new();
    let mut dm_domains = HashMap::new();
    let mut wq_domains = HashMap::new();

    if with_signer {
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
        crystal_enabled: false,
    }
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_voucher_signing_chain_present() {
    let state = make_test_state(1, true);
    let result = resolve_voucher_signing(&state, 1, true);
    assert!(result.is_ok(), "chain 1 has a signer, should succeed");
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_voucher_signing_chain_missing() {
    let state = make_test_state(1, false);
    let result = resolve_voucher_signing(&state, 1, true);
    assert!(result.is_err());
    let VoucherError::ChainNotConfigured(cid) = result.unwrap_err();
    assert_eq!(cid, 1);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_voucher_signing_wrong_chain() {
    // State has chain 1 configured; asking for chain 99 → error.
    let state = make_test_state(1, true);
    let result = resolve_voucher_signing(&state, 99, true);
    assert!(result.is_err());
    let VoucherError::ChainNotConfigured(cid) = result.unwrap_err();
    assert_eq!(cid, 99);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_voucher_signing_wq_domain() {
    let state = make_test_state(42, true);
    let result = resolve_voucher_signing(&state, 42, false);
    assert!(result.is_ok(), "chain 42 should have wq domain");
    let (_, domain) = result.expect("wq domain for chain 42");
    assert_eq!(domain.name, "PipelineWithdrawalQueue");
}
