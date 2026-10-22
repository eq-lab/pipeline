// spec: docs/user-stories/epic-1521/1608-chains-endpoint.md
use std::collections::HashMap;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Method, Request, StatusCode};
use pipeline_api::config::ConfiguredChain;
use pipeline_api::routes::chains::{self, chains_response, ChainsDoc};
use pipeline_api::AppState;
use serde_json::json;
use shared::chains::ChainKind;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;
use tower::ServiceExt;
use utoipa::OpenApi;

const EVM: ConfiguredChain = ConfiguredChain {
    chain_id: 1,
    kind: ChainKind::Evm,
};
const STELLAR: ConfiguredChain = ConfiguredChain {
    chain_id: 99_000_001,
    kind: ChainKind::Stellar,
};

fn make_test_state() -> AppState {
    let pool = sqlx::PgPool::connect_lazy("postgres://unreachable.invalid:1/test").unwrap();

    AppState {
        pool: pool.clone(),
        kyc_repo: KycRepo::new(pool.clone()),
        position_repo: PositionRepo::new(pool.clone()),
        contract_logs_repo: ContractLogsRepo::new(pool.clone()),
        default_chain_id: 1,
        chains: vec![STELLAR, EVM],
        sumsub_client: None,
        sumsub_settings: None,
        voucher_signers: HashMap::new(),
        dm_domains: HashMap::new(),
        wq_domains: HashMap::new(),
        stellar_voucher_signers: HashMap::new(),
        transfer_addresses: HashMap::new(),
        withdrawal_queue_wallets: HashMap::new(),
        asset_decimals: HashMap::new(),
        loan_registry_addresses: HashMap::new(),
        crystal_enabled: false,
        elliptic_enabled: false,
        auth_user_repo: shared::auth_user_repo::AuthUserRepo::new(pool.clone()),
        submitted_loan_repo: shared::submitted_loan_repo::SubmittedLoanRepo::new(pool.clone()),
        loan_metadata_fetcher: std::sync::Arc::new(
            shared::loan_metadata::HttpLoanMetadataFetcher::new(
                shared::metadata_fetcher::MetadataFetcher::new(
                    reqwest::Client::new(),
                    "https://ipfs.io/ipfs/".to_owned(),
                ),
            ),
        ),
        loan_fee_schedule_repo: shared::loan_fee_schedule_repo::LoanFeeScheduleRepo::new(
            pool.clone(),
        ),
        loan_asset_price_repo: shared::loan_asset_price_repo::LoanAssetPriceRepo::new(pool.clone()),
        collateral_valuation_repo: shared::collateral_valuation_repo::CollateralValuationRepo::new(
            pool.clone(),
        ),
        loan_disbursement_repo: shared::loan_disbursement_repo::LoanDisbursementRepo::new(
            pool.clone(),
        ),
        jwt_keys: None,
        loan_capital_transfers_repo:
            shared::loan_capital_transfers_repo::LoanCapitalTransfersRepo::new(pool.clone()),
        lp_repo: shared::lp_repo::LpRepo::new(pool.clone()),
        lp_ledger_repo: shared::lp_ledger_repo::LpLedgerRepo::new(pool.clone()),
        lp_bank_deposit_repo: shared::lp_bank_deposit_repo::LpBankDepositRepo::new(pool.clone()),
        kyb_document_repo: shared::kyb_document_repo::KybDocumentRepo::new(pool.clone()),
        object_store: shared::object_store::ObjectStore::new(
            "test-key",
            "test-secret",
            "https://test.digitaloceanspaces.com",
            "test",
            "test-bucket",
        ),
        kyb_limits: pipeline_api::config::KybLimits {
            max_document_bytes: pipeline_api::config::DEFAULT_KYB_MAX_DOCUMENT_BYTES,
            max_files_per_request: pipeline_api::config::DEFAULT_KYB_MAX_FILES_PER_REQUEST,
            max_documents_per_lp: pipeline_api::config::DEFAULT_KYB_MAX_DOCUMENTS_PER_LP,
        },
        account_repo: shared::account_repo::AccountRepo::new(pool.clone()),
        otp_repo: shared::otp_repo::OtpRepo::new(pool.clone()),
        captcha: Box::new(pipeline_api::captcha::DisabledCaptcha),
        email_sender: std::sync::Arc::new(shared::email::LoggingEmailSender),
        login_attempt_repo: shared::login_attempt_repo::LoginAttemptRepo::new(pool),
        password_reset: pipeline_api::password_reset::PasswordResetConfig {
            app_base_url: pipeline_api::password_reset::DEV_APP_BASE_URL.to_owned(),
            ttl_minutes: pipeline_api::password_reset::DEFAULT_PASSWORD_RESET_TTL_MINUTES,
        },
    }
}

#[test]
fn response_lists_chains_in_given_order_with_kind() {
    let body = serde_json::to_value(chains_response(&[STELLAR, EVM])).unwrap();
    assert_eq!(
        body,
        json!({
            "chains": [
                { "chain_id": 99_000_001, "kind": "stellar" },
                { "chain_id": 1, "kind": "evm" },
            ]
        })
    );
}

#[test]
fn response_for_single_chain() {
    let body = serde_json::to_value(chains_response(&[EVM])).unwrap();
    assert_eq!(
        body,
        json!({ "chains": [{ "chain_id": 1, "kind": "evm" }] })
    );
}

#[tokio::test]
async fn get_chains_without_credentials_returns_configured_chains() {
    let app = chains::router().with_state(Arc::new(make_test_state()));
    let req = Request::builder()
        .method(Method::GET)
        .uri("/chains")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        body,
        json!({
            "chains": [
                { "chain_id": 99_000_001, "kind": "stellar" },
                { "chain_id": 1, "kind": "evm" },
            ]
        })
    );
}

#[test]
fn openapi_documents_public_chains_path() {
    let doc = serde_json::to_value(ChainsDoc::openapi()).unwrap();
    let op = &doc["paths"]["/v1/chains"]["get"];
    assert!(op["responses"]["200"].is_object());
    assert!(op.get("security").is_none());
    assert!(op.get("parameters").is_none());
}

#[test]
fn openapi_chain_item_schema() {
    let doc = serde_json::to_value(ChainsDoc::openapi()).unwrap();
    let schemas = &doc["components"]["schemas"];
    assert_eq!(schemas["ChainKind"]["enum"], json!(["evm", "stellar"]));
    let required = schemas["ChainItem"]["required"].as_array().unwrap();
    for field in ["chain_id", "kind"] {
        assert!(required.iter().any(|v| v == field), "{field}");
    }
    assert!(schemas["ChainsResponse"]["required"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == "chains"));
}
