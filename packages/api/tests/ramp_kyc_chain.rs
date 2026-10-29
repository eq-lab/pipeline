// spec: docs/user-stories/epic-1521/1609-ramp-kyc-chain.md
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use bigdecimal::BigDecimal;
use pipeline_api::config::{ConfiguredChain, TransferAddressSets};
use pipeline_api::routes::kyc::{self, ApiDoc as KycDoc};
use pipeline_api::routes::ramp::{
    self, filter_pending_ramp_events, sort_ramp_events_newest_first, RampDoc,
};
use pipeline_api::AppState;
use shared::chains::ChainKind;
use shared::contract_logs_repo::{AssetTransferRow, ContractLogsRepo};
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
const RAMP_G: &str = "GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD";
const CUSTODY_G: &str = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const RAMP_E: &str = "0x00000000000000000000000000000000000000b1";
const CUSTODY_E: &str = "0x00000000000000000000000000000000000000c1";

fn make_test_state(transfer_addresses: HashMap<i64, TransferAddressSets>) -> AppState {
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
        transfer_addresses,
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

fn sets(custody: &str, ramp: &[&str], decimals: u32) -> TransferAddressSets {
    TransferAddressSets {
        custody: HashSet::from([custody.to_owned()]),
        ramp: ramp.iter().map(|s| (*s).to_owned()).collect(),
        asset_decimals: decimals,
    }
}

async fn call(app: Router, method: Method, uri: &str, body: Option<&str>) -> (StatusCode, String) {
    let mut req = Request::builder().method(method).uri(uri);
    let body = match body {
        Some(b) => {
            req = req.header("content-type", "application/json");
            Body::from(b.to_owned())
        }
        None => Body::empty(),
    };
    let resp = app.oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

async fn kyc_call(method: Method, uri: &str, body: Option<&str>) -> (StatusCode, String) {
    let app = kyc::router().with_state(Arc::new(make_test_state(HashMap::new())));
    call(app, method, uri, body).await
}

async fn ramp_call(
    transfer_addresses: HashMap<i64, TransferAddressSets>,
    uri: &str,
) -> (StatusCode, String) {
    let app = ramp::router().with_state(Arc::new(make_test_state(transfer_addresses)));
    call(app, Method::GET, uri, None).await
}

fn error_body(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}

fn kyc_requests(query: &str, wallet: &str) -> Vec<(Method, String, Option<String>)> {
    let body = format!(r#"{{"wallet_address":"{wallet}"}}"#);
    vec![
        (
            Method::POST,
            format!("/applicants{query}"),
            Some(body.clone()),
        ),
        (Method::POST, format!("/token{query}"), Some(body)),
        (Method::GET, format!("/status/{wallet}{query}"), None),
    ]
}

// ── KYC chain_id validation ─────────────────────────────────────────────────

#[tokio::test]
async fn kyc_missing_chain_id_is_400_before_any_db_call() {
    for (m, uri, body) in kyc_requests("", ADDR) {
        let (status, resp) = kyc_call(m, &uri, body.as_deref()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(resp, error_body("chain_id is required"), "{uri}");
    }
}

#[tokio::test]
async fn kyc_unknown_chain_id_is_400() {
    for (m, uri, body) in kyc_requests("?chain_id=5", ADDR) {
        let (status, resp) = kyc_call(m, &uri, body.as_deref()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(
            resp,
            error_body("unknown chain_id: 5 (configured: 1, 99000001)"),
            "{uri}"
        );
    }
}

#[tokio::test]
async fn kyc_malformed_chain_id_is_400() {
    for (m, uri, body) in kyc_requests("?chain_id=abc", ADDR) {
        let (status, resp) = kyc_call(m, &uri, body.as_deref()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(resp, error_body("invalid chain_id: abc"), "{uri}");
    }
}

#[tokio::test]
async fn kyc_wallet_validation_follows_the_configured_chain_kind() {
    for (m, uri, body) in kyc_requests("?chain_id=99000001", ADDR) {
        let (status, resp) = kyc_call(m, &uri, body.as_deref()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert!(resp.contains("invalid Stellar wallet address"), "{resp}");
    }
}

// ── Ramp addresses ──────────────────────────────────────────────────────────

#[tokio::test]
async fn ramp_addresses_chain_id_cases() {
    let cases = [
        ("/ramp/addresses", "chain_id is required"),
        ("/ramp/addresses?chain_id=abc", "invalid chain_id: abc"),
        (
            "/ramp/addresses?chain_id=5",
            "unknown chain_id: 5 (configured: 1, 99000001)",
        ),
    ];
    for (uri, msg) in cases {
        let (status, body) = ramp_call(HashMap::new(), uri).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(body, error_body(msg), "{uri}");
    }
}

#[tokio::test]
async fn ramp_addresses_are_per_chain_and_empty_without_config() {
    let map = HashMap::from([(1, sets(CUSTODY_E, &[RAMP_E], 6))]);
    let (status, body) = ramp_call(
        HashMap::from([(1, sets(CUSTODY_E, &[RAMP_E], 6))]),
        "/ramp/addresses?chain_id=1",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, format!(r#"{{"ramp_addresses":["{RAMP_E}"]}}"#));

    let (status, body) = ramp_call(map, "/ramp/addresses?chain_id=99000001").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, r#"{"ramp_addresses":[]}"#);
}

// ── Ramp events ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ramp_events_malformed_or_repeated_chain_id_is_400() {
    for uri in [
        "/ramp/events?chain_id=abc",
        "/ramp/events?chain_id=1&chain_id=1",
    ] {
        let (status, body) = ramp_call(HashMap::new(), uri).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert!(body.contains("invalid chain_id"), "{body}");
    }
}

#[tokio::test]
async fn ramp_events_unconfigured_chain_is_empty_without_db() {
    let (status, body) = ramp_call(HashMap::new(), "/ramp/events?chain_id=5").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, r#"{"events":[]}"#);
}

#[tokio::test]
async fn ramp_events_configured_chains_without_transfer_config_are_empty_without_db() {
    for uri in ["/ramp/events", "/ramp/events?chain_id=1"] {
        let (status, body) = ramp_call(HashMap::new(), uri).await;
        assert_eq!(status, StatusCode::OK, "{uri}");
        assert_eq!(body, r#"{"events":[]}"#, "{uri}");
    }
}

fn transfer(
    id: i64,
    chain_id: i64,
    from: &str,
    to: &str,
    ts: i64,
    whole: i64,
    units: u32,
) -> AssetTransferRow {
    AssetTransferRow {
        id,
        chain_id,
        from_addr: from.to_owned(),
        to_addr: to.to_owned(),
        amount: BigDecimal::from(whole * 10_i64.pow(units)),
        block_timestamp: ts,
        review_decision: None,
        review_reason: None,
        reviewed_at: None,
    }
}

#[test]
fn merged_events_carry_chain_id_use_own_chain_sets_and_sort_newest_first() {
    let evm = sets(CUSTODY_E, &[RAMP_E], 6);
    let stellar = sets(CUSTODY_G, &[RAMP_G], 7);
    let mut events = filter_pending_ramp_events(
        &[
            transfer(10, 1, RAMP_E, CUSTODY_E, 100, 5, 6),
            transfer(11, 1, RAMP_G, CUSTODY_G, 300, 9, 6),
        ],
        &evm,
    );
    events.extend(filter_pending_ramp_events(
        &[
            transfer(20, 99_000_001, CUSTODY_G, RAMP_G, 200, 7, 7),
            transfer(21, 99_000_001, CUSTODY_G, RAMP_G, 100, 3, 7),
        ],
        &stellar,
    ));
    assert_eq!(events.len(), 3);

    sort_ramp_events_newest_first(&mut events);
    let order: Vec<(i64, i64)> = events.iter().map(|e| (e.id, e.chain_id)).collect();
    assert_eq!(order, vec![(20, 99_000_001), (21, 99_000_001), (10, 1)]);
    assert_eq!(events[0].amount, "7.000000");
    assert_eq!(events[2].amount, "5.000000");

    let json = serde_json::to_value(&events[0]).unwrap();
    assert_eq!(json["chain_id"], 99_000_001);
}

#[test]
fn same_second_events_of_one_chain_keep_on_chain_order_newest_first() {
    // Reader order is on-chain (block, log). Ids are deliberately out of that order
    // (31 first on chain, 30 second) to show the tiebreak is the chain, not the id.
    let evm = sets(CUSTODY_E, &[RAMP_E], 6);
    let mut events = filter_pending_ramp_events(
        &[
            transfer(31, 1, RAMP_E, CUSTODY_E, 50, 1, 6),
            transfer(30, 1, RAMP_E, CUSTODY_E, 50, 2, 6),
        ],
        &evm,
    );
    sort_ramp_events_newest_first(&mut events);
    let ids: Vec<i64> = events.iter().map(|e| e.id).collect();
    assert_eq!(ids, vec![30, 31]);
}

// ── OpenAPI ─────────────────────────────────────────────────────────────────

fn chain_param(doc: &serde_json::Value, path: &str, method: &str) -> serde_json::Value {
    let params = doc["paths"][path][method]["parameters"].as_array().unwrap();
    let chain: Vec<_> = params.iter().filter(|p| p["name"] == "chain_id").collect();
    assert_eq!(chain.len(), 1, "{path}");
    chain[0].clone()
}

#[test]
fn openapi_chain_id_flags() {
    let kyc_doc = serde_json::to_value(KycDoc::openapi()).unwrap();
    for (path, method) in [
        ("/v1/kyc/applicants", "post"),
        ("/v1/kyc/token", "post"),
        ("/v1/kyc/status/{wallet_address}", "get"),
    ] {
        assert_eq!(
            chain_param(&kyc_doc, path, method)["required"],
            true,
            "{path}"
        );
        assert!(kyc_doc["paths"][path][method]["responses"]["400"].is_object());
    }

    let ramp_doc = serde_json::to_value(RampDoc::openapi()).unwrap();
    assert_eq!(
        chain_param(&ramp_doc, "/v1/ramp/addresses", "get")["required"],
        true
    );
    assert_ne!(
        chain_param(&ramp_doc, "/v1/ramp/events", "get")["required"],
        true
    );
    let review = ramp_doc["paths"]["/v1/ramp/events/{id}/review"]["post"]["parameters"]
        .as_array()
        .unwrap();
    assert!(review.iter().all(|p| p["name"] != "chain_id"));
    assert!(ramp_doc["components"]["schemas"]["RampEvent"]["properties"]["chain_id"].is_object());
}
