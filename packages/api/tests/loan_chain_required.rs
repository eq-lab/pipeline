// spec: docs/exec-plans/active/issue-1531-per-loan-chain-required.md#test-strategy
use std::collections::HashMap;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use pipeline_api::auth::{Claims, TRUSTEE_ROLE};
use pipeline_api::config::ConfiguredChain;
use pipeline_api::error::ApiError;
use pipeline_api::routes::common::trustee_loan_precheck;
use pipeline_api::routes::{
    ccr_history, collateral_valuation, loan_financials, loan_transfers, waterfall,
};
use pipeline_api::AppState;
use serde_json::Value;
use shared::chains::ChainKind;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;
use tower::ServiceExt;
use utoipa::OpenApi;
use uuid::Uuid;

const EVM: ConfiguredChain = ConfiguredChain {
    chain_id: 1,
    kind: ChainKind::Evm,
};
const STELLAR: ConfiguredChain = ConfiguredChain {
    chain_id: 99_000_001,
    kind: ChainKind::Stellar,
};
const EVM_REGISTRY: &str = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const STELLAR_REGISTRY: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";

fn make_test_state() -> AppState {
    let loan_registry_addresses = HashMap::from([
        (1, EVM_REGISTRY.to_owned()),
        (99_000_001, STELLAR_REGISTRY.to_owned()),
    ]);
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
        loan_registry_addresses,
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
        // Constructing an `ObjectStore` performs no I/O, so placeholder
        // credentials are enough to build the struct; the helpers under test
        // never touch it.
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

fn claims(roles: &[&str]) -> Claims {
    Claims {
        sub: "0xabc".to_owned(),
        chain_id: Some(1),
        account_id: Uuid::nil(),
        roles: roles.iter().map(|r| (*r).to_owned()).collect(),
        iat: 0,
        exp: usize::MAX,
    }
}

async fn call(router: Router<Arc<AppState>>, method: Method, uri: &str) -> (StatusCode, String) {
    let app = router.with_state(Arc::new(make_test_state()));
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

fn error_body(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}

fn public_routers() -> Vec<(&'static str, Router<Arc<AppState>>)> {
    vec![
        ("financials", loan_financials::router()),
        ("valuations", collateral_valuation::router()),
        ("ccr-history", ccr_history::router()),
        ("waterfall", waterfall::router()),
    ]
}

// ── Router level: public GETs reject before any query ───────────────────────

#[tokio::test]
async fn public_gets_without_chain_id_are_400() {
    for (name, router) in public_routers() {
        let (status, body) = call(router, Method::GET, &format!("/loan-book/7/{name}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{name}");
        assert_eq!(body, error_body("chain_id is required"), "{name}");
    }
}

#[tokio::test]
async fn public_gets_with_unknown_chain_id_are_400() {
    for (name, router) in public_routers() {
        let (status, body) = call(
            router,
            Method::GET,
            &format!("/loan-book/7/{name}?chain_id=5"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{name}");
        assert_eq!(
            body,
            error_body("unknown chain_id: 5 (configured: 1, 99000001)"),
            "{name}"
        );
    }
}

#[tokio::test]
async fn public_gets_with_malformed_chain_id_are_400() {
    for (name, router) in public_routers() {
        let (status, body) = call(
            router,
            Method::GET,
            &format!("/loan-book/7/{name}?chain_id=abc"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{name}");
        assert_eq!(body, error_body("invalid chain_id: abc"), "{name}");
    }
}

#[tokio::test]
async fn ccr_history_with_other_params_but_no_chain_is_chain_400() {
    let (status, body) = call(
        ccr_history::router(),
        Method::GET,
        "/loan-book/7/ccr-history?from=1&step=60",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error_body("chain_id is required"));
}

#[tokio::test]
async fn ccr_history_chain_error_beats_missing_from() {
    let (status, body) = call(
        ccr_history::router(),
        Method::GET,
        "/loan-book/7/ccr-history",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error_body("chain_id is required"));
}

#[tokio::test]
async fn waterfall_with_amount_but_no_chain_is_chain_400() {
    let (status, body) = call(
        waterfall::router(),
        Method::GET,
        "/loan-book/7/waterfall?amount=100",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error_body("chain_id is required"));
}

// ── Router level: auth is checked before the chain ──────────────────────────

#[tokio::test]
async fn trustee_routes_without_token_are_401_before_chain_validation() {
    let cases = [
        (
            Method::POST,
            "/loan-book/7/assay",
            collateral_valuation::router(),
        ),
        (
            Method::POST,
            "/loan-book/7/offtake",
            collateral_valuation::router(),
        ),
        (
            Method::GET,
            "/loan-book/7/transfers",
            loan_transfers::router(),
        ),
        (
            Method::POST,
            "/loan-book/7/transfers",
            loan_transfers::router(),
        ),
    ];
    for (method, uri, router) in cases {
        let (status, _) = call(router, method.clone(), uri).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
}

// ── Guard pre-check: each chain's own registry for the same loan_id ─────────

#[tokio::test]
async fn precheck_returns_each_chains_own_registry_for_the_same_loan() {
    let state = make_test_state();
    let trustee = claims(&[TRUSTEE_ROLE]);

    let (loan, registry) = trustee_loan_precheck(&trustee, &state, 1, "7").unwrap();
    assert_eq!(loan.to_string(), "7");
    assert_eq!(registry, EVM_REGISTRY);

    let (loan, registry) = trustee_loan_precheck(&trustee, &state, 99_000_001, "7").unwrap();
    assert_eq!(loan.to_string(), "7");
    assert_eq!(registry, STELLAR_REGISTRY);
}

#[tokio::test]
async fn precheck_non_trustee_is_forbidden() {
    let state = make_test_state();
    let err = trustee_loan_precheck(&claims(&[]), &state, 1, "7").unwrap_err();
    assert!(matches!(
        err,
        ApiError::Forbidden(m) if m == format!("this endpoint requires the `{TRUSTEE_ROLE}` role")
    ));
}

#[tokio::test]
async fn precheck_checks_role_before_loan_id() {
    let state = make_test_state();
    let err = trustee_loan_precheck(&claims(&[]), &state, 1, "abc").unwrap_err();
    assert!(matches!(err, ApiError::Forbidden(_)));
}

#[tokio::test]
async fn precheck_rejects_malformed_loan_id() {
    let state = make_test_state();
    let err = trustee_loan_precheck(&claims(&[TRUSTEE_ROLE]), &state, 1, "abc").unwrap_err();
    assert!(matches!(err, ApiError::BadRequest(m) if m == "invalid loan_id: abc"));
}

#[tokio::test]
async fn precheck_trims_loan_id() {
    let state = make_test_state();
    let (loan, _) = trustee_loan_precheck(&claims(&[TRUSTEE_ROLE]), &state, 1, " 7 ").unwrap();
    assert_eq!(loan.to_string(), "7");
}

// ── OpenAPI contract ────────────────────────────────────────────────────────

fn nine_operations() -> Vec<(Value, &'static str, &'static str)> {
    let to_json = |v: &utoipa::openapi::OpenApi| serde_json::to_value(v).unwrap();
    let financials = to_json(&loan_financials::LoanFinancialsDoc::openapi());
    let valuation = to_json(&collateral_valuation::CollateralValuationDoc::openapi());
    let ccr = to_json(&ccr_history::CcrHistoryDoc::openapi());
    let waterfall = to_json(&waterfall::WaterfallDoc::openapi());
    let transfers = to_json(&loan_transfers::LoanTransfersDoc::openapi());
    let loan_book = to_json(&pipeline_api::routes::loan_book::LoanBookDoc::openapi());
    vec![
        (financials, "/v1/loan-book/{loan_id}/financials", "get"),
        (
            valuation.clone(),
            "/v1/loan-book/{loan_id}/valuations",
            "get",
        ),
        (valuation.clone(), "/v1/loan-book/{loan_id}/assay", "post"),
        (valuation, "/v1/loan-book/{loan_id}/offtake", "post"),
        (ccr, "/v1/loan-book/{loan_id}/ccr-history", "get"),
        (waterfall, "/v1/loan-book/{loan_id}/waterfall", "get"),
        (
            transfers.clone(),
            "/v1/loan-book/{loan_id}/transfers",
            "get",
        ),
        (transfers, "/v1/loan-book/{loan_id}/transfers", "post"),
        (
            loan_book,
            "/v1/loan-book/{loan_id}/disbursement/complete",
            "post",
        ),
    ]
}

fn chain_params(op: &Value) -> Vec<&Value> {
    op["parameters"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["name"] == "chain_id")
        .collect()
}

#[test]
fn every_per_loan_operation_declares_a_required_chain_id() {
    for (doc, path, method) in nine_operations() {
        let op = &doc["paths"][path][method];
        assert!(op.is_object(), "{method} {path} missing");
        let params = chain_params(op);
        assert_eq!(params.len(), 1, "{method} {path}");
        assert_eq!(params[0]["in"], "query", "{method} {path}");
        assert_eq!(params[0]["required"], true, "{method} {path}");
        assert!(op["responses"]["400"].is_object(), "{method} {path}");
        assert_eq!(
            op["tags"],
            serde_json::json!(["LoanBook"]),
            "{method} {path}"
        );
    }
}

#[test]
fn ccr_history_and_waterfall_keep_their_own_params() {
    let ops = nine_operations();
    let names = |path: &str| -> Vec<String> {
        let (doc, _, _) = ops.iter().find(|(_, p, _)| *p == path).unwrap();
        doc["paths"][path]["get"]["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["name"].as_str().unwrap().to_owned())
            .collect()
    };
    let ccr = names("/v1/loan-book/{loan_id}/ccr-history");
    for n in ["from", "to", "step", "chain_id"] {
        assert!(ccr.contains(&n.to_owned()), "ccr-history missing {n}");
    }
    let waterfall = names("/v1/loan-book/{loan_id}/waterfall");
    for n in ["amount", "as_of", "chain_id"] {
        assert!(waterfall.contains(&n.to_owned()), "waterfall missing {n}");
    }
}

#[test]
fn response_schemas_carry_a_required_chain_id() {
    let ops = nine_operations();
    for (schema, path) in [
        (
            "LoanFinancialsResponse",
            "/v1/loan-book/{loan_id}/financials",
        ),
        ("WaterfallResponse", "/v1/loan-book/{loan_id}/waterfall"),
        ("LoanTransfersResponse", "/v1/loan-book/{loan_id}/transfers"),
    ] {
        let (doc, _, _) = ops.iter().find(|(_, p, _)| *p == path).unwrap();
        let s = &doc["components"]["schemas"][schema];
        assert_eq!(s["properties"]["chain_id"]["type"], "integer", "{schema}");
        assert!(
            s["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|r| r == "chain_id"),
            "{schema}"
        );
    }
}
