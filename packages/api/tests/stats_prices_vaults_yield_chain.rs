// spec: docs/user-stories/epic-1521/1583-stats-prices-vaults-yield-chain.md
use std::collections::HashMap;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Method, Request, StatusCode};
use pipeline_api::config::ConfiguredChain;
use pipeline_api::routes::portfolio::{self, YieldDoc};
use pipeline_api::routes::stats::{self, StatsDoc};
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
const VAULT: &str = "0x00000000000000000000000000000000000000aa";

fn make_test_state() -> AppState {
    let pool = sqlx::PgPool::connect_lazy("postgres://unreachable.invalid:1/test").unwrap();

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

async fn call(router: axum::Router<Arc<AppState>>, uri: &str) -> (StatusCode, String) {
    let app = router.with_state(Arc::new(make_test_state()));
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

// ── Prices + yield: required chain_id ───────────────────────────────────────

fn route(path: &str) -> axum::Router<Arc<AppState>> {
    if path == "/stats/yield" {
        portfolio::router()
    } else {
        stats::router()
    }
}

const REQUIRED: [&str; 2] = ["/stats/prices", "/stats/yield"];

#[tokio::test]
async fn missing_chain_id_is_400_on_prices_and_yield() {
    for path in REQUIRED {
        let (status, body) = call(route(path), &format!("{path}?vault={VAULT}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(body, error_body("chain_id is required"), "{path}");
    }
}

#[tokio::test]
async fn unknown_chain_id_is_400_on_prices_and_yield() {
    for path in REQUIRED {
        let (status, body) = call(route(path), &format!("{path}?chain_id=5&vault={VAULT}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(
            body,
            error_body("unknown chain_id: 5 (configured: 1, 99000001)"),
            "{path}"
        );
    }
}

#[tokio::test]
async fn malformed_chain_id_is_400_on_prices_and_yield() {
    for path in REQUIRED {
        let (status, body) = call(route(path), &format!("{path}?chain_id=abc&vault={VAULT}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(body, error_body("invalid chain_id: abc"), "{path}");
    }
}

// ── Stats + vaults: optional lenient chain_id ───────────────────────────────

const OPTIONAL: [&str; 2] = ["/stats", "/stats/vaults"];

#[tokio::test]
async fn malformed_chain_id_is_400_on_stats_and_vaults() {
    for path in OPTIONAL {
        let (status, body) = call(stats::router(), &format!("{path}?chain_id=abc")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(body, error_body("invalid chain_id: abc"), "{path}");
    }
}

#[tokio::test]
async fn repeated_chain_id_is_400_on_stats_and_vaults() {
    for path in OPTIONAL {
        let (status, _) = call(
            stats::router(),
            &format!("{path}?chain_id=1&chain_id=99000001"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
    }
}

#[tokio::test]
async fn unconfigured_chain_id_is_200_empty_without_db_on_stats_and_vaults() {
    for path in OPTIONAL {
        let (status, body) = call(stats::router(), &format!("{path}?chain_id=5")).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert_eq!(body, r#"{"vaults":[]}"#, "{path}");
    }
}

// ── OpenAPI ─────────────────────────────────────────────────────────────────

fn chain_param(doc: &serde_json::Value, path: &str) -> serde_json::Value {
    let params = doc["paths"][path]["get"]["parameters"].as_array().unwrap();
    let chain: Vec<_> = params.iter().filter(|p| p["name"] == "chain_id").collect();
    assert_eq!(chain.len(), 1, "{path}");
    chain[0].clone()
}

#[test]
fn openapi_marks_chain_id_required_on_prices_and_yield() {
    let stats_doc = serde_json::to_value(StatsDoc::openapi()).unwrap();
    let yield_doc = serde_json::to_value(YieldDoc::openapi()).unwrap();
    for (doc, path) in [
        (&stats_doc, "/v1/stats/prices"),
        (&yield_doc, "/v1/stats/yield"),
    ] {
        assert_eq!(chain_param(doc, path)["required"], true, "{path}");
        assert!(doc["paths"][path]["get"]["responses"]["400"].is_object());
    }
}

#[test]
fn openapi_marks_chain_id_optional_on_stats_and_vaults() {
    let doc = serde_json::to_value(StatsDoc::openapi()).unwrap();
    for path in ["/v1/stats", "/v1/stats/vaults"] {
        assert_eq!(chain_param(&doc, path)["required"], false, "{path}");
        assert!(doc["paths"][path]["get"]["responses"]["400"].is_object());
    }
}

#[test]
fn openapi_vault_stats_item_requires_chain_id() {
    let doc = serde_json::to_value(StatsDoc::openapi()).unwrap();
    let item = &doc["components"]["schemas"]["VaultStatsItem"];
    assert!(item["properties"]["chain_id"].is_object());
    assert!(item["required"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == "chain_id"));
}
