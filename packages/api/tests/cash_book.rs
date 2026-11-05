// spec: docs/product-specs/minter-cash-book.md#api-contract
use std::collections::HashMap;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Method, Request, StatusCode};
use pipeline_api::auth::Claims;
use pipeline_api::config::ConfiguredChain;
use pipeline_api::error::ApiError;
use pipeline_api::minter_cash_book::{build_wire_outs, fold_cash};
use pipeline_api::routes::cash_book::{
    self, as_of_ledger, authorize, build_response, resolve_minter, CashBookDoc,
};
use pipeline_api::AppState;
use serde_json::json;
use shared::chains::ChainKind;
use shared::contract_logs_repo::{ContractLogsRepo, MinterEventRow};
use shared::kyc_repo::KycRepo;
use shared::lp_repo::StellarAddressHolder;
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
const STELLAR_OTHER: ConfiguredChain = ConfiguredChain {
    chain_id: 99_000_002,
    kind: ChainKind::Stellar,
};
const MINTER: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";
const LP: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";

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
        minter_addresses: HashMap::new(),
        capital_allocation_from_minter: std::collections::HashSet::new(),
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
        system_configuration_repo: shared::system_configuration_repo::SystemConfigurationRepo::new(
            pool.clone(),
        ),
        lp_requested_bank_details_repo:
            shared::lp_requested_bank_details_repo::LpRequestedBankDetailsRepo::new(pool.clone()),
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

fn minters() -> HashMap<i64, String> {
    HashMap::from([(STELLAR.chain_id, MINTER.to_owned())])
}

fn not_found_message(err: ApiError) -> String {
    match err {
        ApiError::NotFound(m) => m,
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[test]
fn an_evm_chain_has_no_minter() {
    let err = resolve_minter(EVM, &minters()).unwrap_err();
    assert_eq!(not_found_message(err), "minter_not_configured");
}

#[test]
fn an_unconfigured_stellar_chain_has_no_minter() {
    let err = resolve_minter(STELLAR_OTHER, &minters()).unwrap_err();
    assert_eq!(not_found_message(err), "minter_not_configured");
}

#[test]
fn a_configured_stellar_chain_resolves_its_minter() {
    assert_eq!(resolve_minter(STELLAR, &minters()).unwrap(), MINTER);
}

fn row(name: &str, block: i64, params: serde_json::Value) -> MinterEventRow {
    MinterEventRow {
        event_name: name.to_owned(),
        block_number: block,
        log_index: 0,
        block_timestamp: 1_790_000_000,
        params,
    }
}

fn respond(
    rows: &[MinterEventRow],
    holders: &[StellarAddressHolder],
    as_of: i64,
) -> pipeline_api::routes::cash_book::CashBookResponse {
    build_response(
        99_000_001,
        MINTER,
        as_of,
        &fold_cash(rows),
        rows,
        build_wire_outs(rows),
        holders,
    )
}

#[test]
fn the_response_carries_dollar_strings_iso_timestamps_and_resolved_lps() {
    let rows = vec![
        row(
            "MinterSnapshot",
            1,
            json!({"ledger": "1", "bank_cash": "0", "in_flight": "0", "outstanding_total": "0",
                   "unabsorbed_total": "0", "total_assets": "0", "read_failed": false}),
        ),
        row(
            "WireIn",
            2,
            json!({"id": 1, "receiver": MINTER, "amount": "12345678", "value_date": "1789000000", "ref_hash": "ab"}),
        ),
        row(
            "WireOutRequested",
            3,
            json!({"id": "1", "lp": LP, "amount": "10000000"}),
        ),
    ];
    let holders = vec![StellarAddressHolder {
        address: LP.to_owned(),
        requested_at: 1_790_000_000,
        lp_id: 7,
        legal_name: "Acme Ltd".to_owned(),
    }];
    let resp = respond(&rows, &holders, 500);
    let v = serde_json::to_value(&resp).unwrap();
    assert_eq!(v["summary"]["bank_cash"], "1.234567");
    assert_eq!(v["summary"]["in_flight"], "0.000000");
    assert_eq!(v["summary"]["complete"], true);
    assert_eq!(v["summary"]["checkpoint_ledger"], 1);
    assert_eq!(v["summary"]["as_of_ledger"], 500);
    assert_eq!(v["wire_ins"][0]["status"], "Escrowed");
    assert_eq!(v["wire_ins"][0]["amount"], "1.234567");
    assert_eq!(v["wire_ins"][0]["value_date"], "2026-09-10T00:26:40Z");
    assert!(v["wire_ins"][0].get("assigned_at").is_none());
    assert_eq!(v["wire_outs"][0]["lp_id"], 7);
    assert_eq!(v["wire_outs"][0]["lp_legal_name"], "Acme Ltd");
    assert_eq!(v["wire_outs"][0]["amount"], "1.000000");
    assert_eq!(v["ramps"], json!([]));
}

#[test]
fn an_unlinked_wire_out_lp_has_no_lp_fields() {
    let rows = vec![row(
        "WireOutRequested",
        3,
        json!({"id": "1", "lp": LP, "amount": "10"}),
    )];
    let v = serde_json::to_value(respond(&rows, &[], 0)).unwrap();
    assert!(v["wire_outs"][0].get("lp_id").is_none());
    assert!(v["wire_outs"][0].get("lp_legal_name").is_none());
    assert_eq!(v["summary"]["complete"], false);
}

fn openapi_json() -> serde_json::Value {
    serde_json::to_value(CashBookDoc::openapi()).expect("a serializable document")
}

#[test]
fn the_cash_book_path_is_documented_with_a_required_chain_id() {
    let doc = openapi_json();
    let get = &doc["paths"]["/v1/cash-book"]["get"];
    assert!(get.is_object());
    let chain = get["parameters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "chain_id")
        .expect("chain_id parameter");
    assert_eq!(chain["required"], true);
}

#[test]
fn the_cash_book_is_bearer_gated_and_documents_its_refusals() {
    let doc = openapi_json();
    let get = &doc["paths"]["/v1/cash-book"]["get"];
    assert!(get["security"].to_string().contains("bearer_auth"));
    for status in ["200", "400", "401", "403", "404"] {
        assert!(get["responses"].get(status).is_some(), "missing {status}");
    }
}

#[tokio::test]
async fn a_request_without_a_token_is_401_before_any_database_access() {
    let app = cash_book::router().with_state(Arc::new(make_test_state()));
    let req = Request::builder()
        .method(Method::GET)
        .uri("/cash-book?chain_id=99000001")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let _ = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
}

#[test]
fn a_holder_resolved_for_another_request_time_is_not_attributed() {
    let rows = vec![row(
        "WireOutRequested",
        3,
        json!({"id": "1", "lp": LP, "amount": "10"}),
    )];
    let holders = vec![StellarAddressHolder {
        address: LP.to_owned(),
        requested_at: 1,
        lp_id: 7,
        legal_name: "Old Holder".to_owned(),
    }];
    let v = serde_json::to_value(respond(&rows, &holders, 0)).unwrap();
    assert!(v["wire_outs"][0].get("lp_id").is_none());
}

#[test]
fn as_of_ledger_is_the_cursor_minus_one() {
    assert_eq!(as_of_ledger(501), 500);
    assert_eq!(as_of_ledger(1), 0);
    assert_eq!(as_of_ledger(0), 0);
}

fn claims(roles: &[&str]) -> Claims {
    Claims {
        sub: "sub".to_owned(),
        chain_id: None,
        account_id: uuid::Uuid::nil(),
        roles: roles.iter().map(|r| (*r).to_owned()).collect(),
        exp: 0,
        iat: 0,
    }
}

fn uri(q: &str) -> axum::http::Uri {
    format!("/v1/cash-book{q}").parse().unwrap()
}

#[test]
fn a_non_trustee_gets_403_with_or_without_a_chain_id() {
    let chains = [EVM, STELLAR];
    for q in ["", "?chain_id=99000001", "?chain_id=abc", "?chain_id=5"] {
        let err = authorize(&claims(&[]), &uri(q), &chains, &minters()).unwrap_err();
        assert!(matches!(err, ApiError::Forbidden(_)), "{q}: {err:?}");
    }
}

#[test]
fn a_trustee_is_checked_for_chain_then_minter() {
    let chains = [EVM, STELLAR];
    let trustee = claims(&["trustee"]);
    assert!(matches!(
        authorize(&trustee, &uri(""), &chains, &minters()).unwrap_err(),
        ApiError::BadRequest(_)
    ));
    assert!(matches!(
        authorize(&trustee, &uri("?chain_id=1"), &chains, &minters()).unwrap_err(),
        ApiError::NotFound(_)
    ));
    let configured = minters();
    let (chain, minter) =
        authorize(&trustee, &uri("?chain_id=99000001"), &chains, &configured).unwrap();
    assert_eq!((chain, minter), (STELLAR, MINTER));
}
