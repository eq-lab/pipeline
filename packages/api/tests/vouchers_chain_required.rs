// spec: docs/user-stories/epic-1521/1563-vouchers-chain-required.md
use std::collections::HashMap;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Method, Request, StatusCode};
use pipeline_api::config::ConfiguredChain;
use pipeline_api::routes::vouchers::{self, VouchersDoc};
use pipeline_api::AppState;
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
const ADDR: &str = "0x00000000000000000000000000000000000000aa";
const STELLAR_ADDR: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";

fn make_test_state() -> AppState {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap();

    AppState {
        pool: pool.clone(),
        kyc_repo: KycRepo::new(pool.clone()),
        position_repo: PositionRepo::new(pool.clone()),
        contract_logs_repo: ContractLogsRepo::new(pool.clone()),
        default_chain_id: 1,
        chains: vec![EVM, STELLAR],
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

async fn call(uri: &str) -> (StatusCode, String) {
    let app = vouchers::router().with_state(Arc::new(make_test_state()));
    let req = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

fn error_body(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}

const ROUTES: [&str; 2] = ["/deposits/42/voucher", "/withdrawals/42/voucher"];

// ── chain_id validation ─────────────────────────────────────────────────────

#[tokio::test]
async fn missing_chain_id_is_400_on_both_routes() {
    for route in ROUTES {
        let (status, body) = call(&format!("{route}?wallet={ADDR}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{route}");
        assert_eq!(body, error_body("chain_id is required"), "{route}");
    }
}

#[tokio::test]
async fn unknown_chain_id_is_400_on_both_routes() {
    for route in ROUTES {
        let (status, body) = call(&format!("{route}?chain_id=5&wallet={ADDR}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{route}");
        assert_eq!(
            body,
            error_body("unknown chain_id: 5 (configured: 1, 99000001)"),
            "{route}"
        );
    }
}

#[tokio::test]
async fn malformed_chain_id_is_400_on_both_routes() {
    for route in ROUTES {
        let (status, body) = call(&format!("{route}?chain_id=abc&wallet={ADDR}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{route}");
        assert_eq!(body, error_body("invalid chain_id: abc"), "{route}");
    }
}

// ── Configured chain without signer ─────────────────────────────────────────

#[tokio::test]
async fn configured_evm_chain_without_signer_is_400() {
    for route in ROUTES {
        let (status, body) = call(&format!("{route}?chain_id=1&wallet={ADDR}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{route}");
        assert_eq!(
            body,
            error_body("voucher signing not configured for chain 1"),
            "{route}"
        );
    }
}

#[tokio::test]
async fn configured_stellar_chain_without_signer_is_400() {
    for route in ROUTES {
        let (status, body) =
            call(&format!("{route}?chain_id=99000001&wallet={STELLAR_ADDR}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{route}");
        assert_eq!(
            body,
            error_body("voucher signing not configured for chain 99000001"),
            "{route}"
        );
    }
}

// ── Kind dispatch ───────────────────────────────────────────────────────────

#[tokio::test]
async fn wallet_normalisation_follows_the_configured_chain_kind() {
    let (status, body) = call(&format!("{}?chain_id=99000001&wallet={ADDR}", ROUTES[0])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("invalid Stellar wallet address"), "{body}");
}

// ── OpenAPI ─────────────────────────────────────────────────────────────────

#[test]
fn openapi_marks_chain_id_required_on_both_endpoints() {
    let doc = serde_json::to_value(VouchersDoc::openapi()).unwrap();
    for path in [
        "/v1/deposits/{request_id}/voucher",
        "/v1/withdrawals/{request_id}/voucher",
    ] {
        let get = &doc["paths"][path]["get"];
        let params = get["parameters"].as_array().unwrap();
        let chain: Vec<_> = params.iter().filter(|p| p["name"] == "chain_id").collect();
        assert_eq!(chain.len(), 1, "{path}");
        assert_eq!(chain[0]["required"], true, "{path}");
        assert!(get["responses"]["400"].is_object(), "{path}");
    }
}
