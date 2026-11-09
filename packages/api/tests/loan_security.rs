// spec: docs/product-specs/loan-security-state.md#api-contract
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Method, Request, StatusCode};
use bigdecimal::num_bigint::BigInt;
use bigdecimal::BigDecimal;
use chrono::{TimeZone, Utc};
use pipeline_api::config::ConfiguredChain;
use pipeline_api::error::ApiError;
use pipeline_api::routes::loan_security::{
    self, parse_loan_id, resolve_security_registry, LoanSecurityDoc,
};
use pipeline_api::security_state::build_security_response;
use pipeline_api::AppState;
use serde_json::{json, Value};
use shared::chains::ChainKind;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;
use shared::security_registry::{
    ConsentRow, DocRow, InspectionRow, LotRow, MarginCallEventRow, RecordRow, RegistryStateRow,
    TermsRow, ValuationRow,
};
use shared::security_registry_repo::{LoanSecurityRows, SaleRepaymentRow};
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
const REGISTRY: &str = "CDTUMAT6QBBPUZQFTZWMPHXHVQSLPUWRPDHKVQEMEF2YKCV4QTSCSQVN";
const LOAN_REGISTRY: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";
const NOW: u64 = 1_762_400_000;
const UNIT: i128 = 10_000_000;

fn make_test_state(security: HashMap<i64, String>) -> AppState {
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
        withdrawal_queue_addresses: HashMap::new(),
        pocket_addresses: HashMap::new(),
        security_registry_addresses: security,
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

fn registries() -> HashMap<i64, String> {
    HashMap::from([(STELLAR.chain_id, REGISTRY.to_owned())])
}

fn not_found_message(err: ApiError) -> String {
    match err {
        ApiError::NotFound(m) => m,
        other => panic!("expected NotFound, got {other:?}"),
    }
}

async fn get(state: AppState, uri: &str) -> (StatusCode, Vec<u8>) {
    let app = axum::Router::new()
        .nest("/v1", loan_security::router())
        .with_state(Arc::new(state));
    let req = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, body.to_vec())
}

fn dec(n: i128) -> BigDecimal {
    BigDecimal::from_str(&n.to_string()).unwrap()
}

fn terms() -> TermsRow {
    TermsRow {
        loan_id: 7,
        advance_ratio_bps: 8000,
        margin_call_ratio_bps: 8500,
        cure_period: dec(604_800),
        price_stale_after: dec(86_400),
        payment_term: "Lc".to_owned(),
        grace_period: dec(0),
        default_rate: 0,
        attestation_interval: dec(0),
        inspection_interval: dec(0),
        tolerance_bps: 200,
        grade_tolerance_bps: 100,
        margin_call_at: dec(0),
        set_ledger: Some(123),
        complete: true,
    }
}

fn valuation_row(ltv_bps: i64, counted_records: Value) -> ValuationRow {
    ValuationRow {
        loan_id: 7,
        value: dec(12_500 * UNIT),
        stale_value: dec(0),
        flagged_value: dec(0),
        debt: dec(8_000 * UNIT),
        coverage_bps: 15_625,
        ltv_bps,
        margin_call_at: dec(0),
        cure_by: dec(0),
        price_stale: false,
        counted_records,
        detail_ledger: 500,
        loan_registry: LOAN_REGISTRY.to_owned(),
        outstanding: dec(7_900 * UNIT),
        accrued_interest: dec(100 * UNIT),
        money_ledger: 501,
        source_log_id: 40,
    }
}

fn fetched_at() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 6, 12, 0, 0).unwrap()
}

fn record(id: i64, protection: &str, status: &str) -> RecordRow {
    RecordRow {
        record_id: id,
        loan_id: 7,
        lot_id: id,
        protection: protection.to_owned(),
        status: status.to_owned(),
        perfected_at: Some(dec(i128::from(NOW) - 1_000)),
        attested_at: Some(dec(i128::from(NOW) - 1_000)),
        mark_value_per_unit: Some(dec(UNIT)),
        mark_at: Some(dec(i128::from(NOW) - 100)),
        complete: true,
        ..RecordRow::default()
    }
}

fn counted_entry(id: u32, qty: i128, vpu: i128) -> Value {
    json!({
        "record_id": id,
        "counted_quantity": qty.to_string(),
        "value_per_unit": vpu.to_string(),
        "mark_at": (NOW - 100).to_string(),
        "stale": false,
        "flagged": false
    })
}

fn base_rows() -> LoanSecurityRows {
    LoanSecurityRows {
        terms: Some(terms()),
        records: vec![record(1, "WarehousePledge", "Active")],
        lots: vec![LotRow {
            lot_id: 1,
            loan_id: 7,
            latest_inspection_id: None,
            latest_inspected_at: None,
            latest_quantity: None,
            complete: true,
        }],
        registry: Some((
            RegistryStateRow {
                paused: Some(false),
                inspectors: Some(json!(["GINSPECTOR"])),
                loan_registry: Some(LOAN_REGISTRY.to_owned()),
            },
            100,
        )),
        valuation: Some((
            valuation_row(6400, json!([counted_entry(1, 1_000 * UNIT, 2 * UNIT)])),
            fetched_at(),
        )),
        sr_log_id: 90,
        valuation_log_id: 40,
        ..LoanSecurityRows::default()
    }
}

fn build(rows: &LoanSecurityRows, status: Option<&str>) -> Value {
    let mut rows = rows.clone();
    rows.loan_status = status.map(str::to_owned);
    serde_json::to_value(build_security_response(
        STELLAR.chain_id,
        REGISTRY,
        "7",
        &rows,
        NOW,
    ))
    .unwrap()
}

fn sqlx_dec(digits: i64, scale: i64) -> BigDecimal {
    BigDecimal::new(BigInt::from(digits), scale)
}

fn margin_event(block: i64, kind: &str, ltv: i64, cure_by: Option<i128>) -> MarginCallEventRow {
    MarginCallEventRow {
        block_number: block,
        log_index: 0,
        loan_id: 7,
        kind: kind.to_owned(),
        ltv_bps: ltv,
        margin_call_ratio_bps: Some(8500),
        cure_by: cure_by.map(dec),
        block_timestamp: i64::try_from(NOW).unwrap() - 5_000 + block,
        tx_hash: format!("tx{block}"),
    }
}

fn open_call_rows(ltv: i64, cure_by: i128) -> LoanSecurityRows {
    let mut rows = base_rows();
    let at = i128::from(NOW) - 5_000 + 10;
    rows.terms.as_mut().unwrap().margin_call_at = dec(at);
    rows.margin_events = vec![margin_event(10, "open", 9000, Some(cure_by))];
    let (v, _) = rows.valuation.as_mut().unwrap();
    v.ltv_bps = ltv;
    v.margin_call_at = dec(at);
    v.cure_by = dec(at + 604_800);
    rows
}

#[test]
fn an_evm_chain_has_no_security_registry() {
    let err = resolve_security_registry(EVM, &registries()).unwrap_err();
    assert_eq!(not_found_message(err), "security_registry_not_configured");
}

#[test]
fn an_unconfigured_stellar_chain_has_no_security_registry() {
    let err = resolve_security_registry(STELLAR_OTHER, &registries()).unwrap_err();
    assert_eq!(not_found_message(err), "security_registry_not_configured");
}

#[test]
fn a_configured_stellar_chain_resolves() {
    assert_eq!(
        resolve_security_registry(STELLAR, &registries()).unwrap(),
        REGISTRY
    );
}

#[test]
fn loan_ids_are_plain_u32() {
    assert_eq!(parse_loan_id("7").unwrap(), 7);
    assert_eq!(parse_loan_id(" 7 ").unwrap(), 7);
    for bad in ["", "abc", "-1", "1.5", "1e9", "99999999999", "1e999999999"] {
        assert!(
            matches!(parse_loan_id(bad), Err(ApiError::BadRequest(_))),
            "{bad}"
        );
    }
}

#[tokio::test]
async fn an_evm_chain_is_404_security_registry_not_configured() {
    let (status, body) = get(
        make_test_state(registries()),
        "/v1/loan-book/7/security?chain_id=1",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let v: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v, json!({"error": "security_registry_not_configured"}));
}

#[tokio::test]
async fn a_missing_or_unknown_chain_id_is_400() {
    for uri in [
        "/v1/loan-book/7/security",
        "/v1/loan-book/7/security?chain_id=abc",
        "/v1/loan-book/7/security?chain_id=5",
    ] {
        let (status, _) = get(make_test_state(registries()), uri).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
    }
}

#[tokio::test]
async fn a_malformed_loan_id_is_400_before_any_database_access() {
    for id in ["abc", "1e999999999", "-3"] {
        let (status, _) = get(
            make_test_state(registries()),
            &format!("/v1/loan-book/{id}/security?chain_id=99000001"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{id}");
    }
}

#[test]
fn the_openapi_document_lists_the_route_and_its_refusals() {
    let doc = serde_json::to_value(LoanSecurityDoc::openapi()).unwrap();
    let get = &doc["paths"]["/v1/loan-book/{loan_id}/security"]["get"];
    assert!(get.is_object());
    for status in ["200", "400", "404", "500"] {
        assert!(get["responses"].get(status).is_some(), "missing {status}");
    }
    assert!(get.get("security").is_none());
}

#[test]
fn empty_rows_give_empty_state() {
    let v = build(&LoanSecurityRows::default(), None);
    assert!(v["terms"].is_null());
    assert!(v["valuation"].is_null());
    assert!(v["margin_call"].is_null());
    assert!(v["prices"].is_null());
    assert_eq!(v["records"], json!([]));
    assert_eq!(v["extension_consents"], json!([]));
    assert_eq!(v["inspectors"], json!([]));
    assert!(v["loan_status"].is_null());
    assert_eq!(v["refresh_pending"], false);
    assert_eq!(v["loan_id"], "7");
    assert_eq!(v["now"], NOW.to_string());
    assert_eq!(v["security_registry"], REGISTRY);
}

#[test]
fn valuation_fields_are_read_verbatim_from_the_snapshot() {
    let mut rows = base_rows();
    let (val, _) = rows.valuation.as_mut().unwrap();
    val.ltv_bps = i64::from(u32::MAX);
    val.coverage_bps = i64::from(u32::MAX);
    val.debt = dec(0);
    val.value = dec(0);
    let v = build(&rows, Some("Performing"));
    let val = &v["valuation"];
    assert_eq!(val["ltv_bps"], json!(4_294_967_295_u64));
    assert!(val["ltv_bps"].is_number());
    assert_eq!(val["coverage_bps"], json!(4_294_967_295_u64));
    assert_eq!(val["value"], "0.0000000");
    assert_eq!(val["debt"], "0.0000000");
    assert_eq!(val["outstanding"], "7900.0000000");
    assert_eq!(val["accrued_interest"], "100.0000000");
    assert_eq!(val["as_of"]["detail_ledger"], 500);
    assert_eq!(val["as_of"]["money_ledger"], 501);
    assert_eq!(val["as_of"]["fetched_at"], "2026-11-06T12:00:00Z");
    assert_eq!(v["loan_status"], "Performing");
}

#[test]
fn amounts_are_plain_7dp_strings_without_exponent() {
    let mut rows = base_rows();
    let (val, _) = rows.valuation.as_mut().unwrap();
    val.value = BigDecimal::from_str("123456789012345678901234567890").unwrap();
    let v = build(&rows, None);
    assert_eq!(v["valuation"]["value"], "12345678901234567890123.4567890");
}

#[test]
fn terms_are_served_with_string_durations_and_numeric_bps() {
    let v = build(&base_rows(), None);
    let t = &v["terms"];
    assert_eq!(t["advance_ratio_bps"], 8000);
    assert_eq!(t["margin_call_ratio_bps"], 8500);
    assert_eq!(t["cure_period"], "604800");
    assert_eq!(t["price_stale_after"], "86400");
    assert_eq!(t["payment_term"], "Lc");
    assert_eq!(t["set_ledger"], 123);
    assert_eq!(t["complete"], true);
    assert_eq!(v["paused"], false);
    assert_eq!(v["inspectors"], json!(["GINSPECTOR"]));
}

#[test]
fn a_record_valuation_joins_counted_records_by_record_id() {
    let mut rows = base_rows();
    rows.records.push(record(2, "InsuranceLossPayee", "Active"));
    rows.records.push(record(3, "EndorsedBl", "Released"));
    let v = build(&rows, None);
    let r1 = &v["records"][0]["valuation"];
    assert_eq!(r1["counted_quantity"], "1000.0000000");
    assert_eq!(r1["value_per_unit"], "2.0000000");
    assert_eq!(r1["value"], "2000.0000000");
    assert_eq!(r1["mark_at"], (NOW - 100).to_string());
    assert_eq!(r1["stale"], false);
    assert!(v["records"][1]["valuation"].is_null());
    assert!(v["records"][2]["valuation"].is_null());
}

#[test]
fn per_record_goods_value_floors_and_other_value_is_the_quantity() {
    let mut rows = base_rows();
    rows.records = vec![
        record(1, "WarehousePledge", "Active"),
        record(2, "CashCover", "Active"),
    ];
    rows.valuation.as_mut().unwrap().0.counted_records = json!([
        counted_entry(1, 1, 5_000_000),
        counted_entry(2, 33 * UNIT, 0)
    ]);
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["valuation"]["value"], "0.0000000");
    assert_eq!(v["records"][1]["valuation"]["value"], "33.0000000");
}

#[test]
fn counts_toward_value_follows_status_and_protection() {
    let mut rows = base_rows();
    rows.records.clear();
    let mut expected = Vec::new();
    for (i, (status, protection, counts)) in [
        ("Active", "WarehousePledge", true),
        ("Active", "EndorsedBl", true),
        ("Active", "CashCover", true),
        ("Active", "InsuranceLossPayee", false),
        ("PendingPerfection", "WarehousePledge", false),
        ("Released", "WarehousePledge", false),
        ("Enforced", "EndorsedBl", false),
    ]
    .into_iter()
    .enumerate()
    {
        rows.records
            .push(record(i64::try_from(i).unwrap() + 1, protection, status));
        expected.push(counts);
    }
    let v = build(&rows, None);
    for (i, counts) in expected.into_iter().enumerate() {
        assert_eq!(v["records"][i]["counts_toward_value"], counts, "{i}");
    }
}

#[test]
fn open_means_not_released_and_not_enforced() {
    let mut rows = base_rows();
    rows.records = vec![
        record(1, "WarehousePledge", "Active"),
        record(2, "WarehousePledge", "PendingPerfection"),
        record(3, "WarehousePledge", "Released"),
        record(4, "WarehousePledge", "Enforced"),
    ];
    let v = build(&rows, None);
    let open: Vec<bool> = (0..4)
        .map(|i| v["records"][i]["open"].as_bool().unwrap())
        .collect();
    assert_eq!(open, [true, true, false, false]);
}

#[test]
fn staleness_flags_are_null_for_non_active_records_and_computed_for_active() {
    let mut rows = base_rows();
    {
        let t = rows.terms.as_mut().unwrap();
        t.attestation_interval = dec(500);
        t.inspection_interval = dec(500);
    }
    rows.records = vec![
        record(1, "WarehousePledge", "Active"),
        record(2, "WarehousePledge", "Released"),
        record(3, "CashCover", "Active"),
    ];
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["attestation_stale"], true);
    assert_eq!(v["records"][0]["inspection_stale"], true);
    assert!(v["records"][1]["attestation_stale"].is_null());
    assert!(v["records"][1]["inspection_stale"].is_null());
    assert_eq!(v["records"][2]["attestation_stale"], true);
    assert_eq!(v["records"][2]["inspection_stale"], false);
}

#[test]
fn the_lots_latest_inspection_resets_the_inspection_clock() {
    let mut rows = base_rows();
    rows.terms.as_mut().unwrap().inspection_interval = dec(500);
    rows.lots[0].latest_inspected_at = Some(dec(i128::from(NOW) - 10));
    rows.lots[0].latest_inspection_id = Some(2);
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["inspection_stale"], false);
}

#[test]
fn mark_staleness_follows_the_price_stale_after_window() {
    let mut rows = base_rows();
    rows.records = vec![
        record(1, "WarehousePledge", "Active"),
        record(2, "WarehousePledge", "Active"),
        record(3, "CashCover", "Active"),
        record(4, "WarehousePledge", "Released"),
    ];
    rows.records[1].mark_at = Some(dec(i128::from(NOW) - 86_401));
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["mark_stale"], false);
    assert_eq!(v["records"][1]["mark_stale"], true);
    assert_eq!(v["records"][2]["mark_stale"], false);
    assert_eq!(v["records"][3]["mark_stale"], false);
}

#[test]
fn an_unmarked_counted_goods_record_is_stale_and_ages_to_the_max() {
    let mut rows = base_rows();
    rows.records[0].mark_value_per_unit = None;
    rows.records[0].mark_at = None;
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["mark_stale"], true);
    assert_eq!(v["prices"]["mark_age"], u64::MAX.to_string());
    assert_eq!(v["prices"]["price_stale"], true);
    assert!(v["records"][0]["mark"].is_null());
}

#[test]
fn prices_use_the_oldest_counted_goods_mark() {
    let mut rows = base_rows();
    rows.records = vec![
        record(1, "WarehousePledge", "Active"),
        record(2, "EndorsedBl", "Active"),
        record(3, "CashCover", "Active"),
    ];
    rows.records[1].mark_at = Some(dec(i128::from(NOW) - 900));
    let v = build(&rows, None);
    assert_eq!(v["prices"]["mark_age"], "900");
    assert_eq!(v["prices"]["price_stale"], false);
    let mut none = base_rows();
    none.records = vec![record(3, "CashCover", "Active")];
    assert_eq!(build(&none, None)["prices"]["mark_age"], "0");
}

#[test]
fn ltv_above_the_ratio_with_no_call_is_flagged() {
    let mut rows = base_rows();
    rows.valuation.as_mut().unwrap().0.ltv_bps = 9000;
    let v = build(&rows, Some("Performing"));
    assert_eq!(v["margin_call"]["ltv_above_ratio_no_onchain_call"], true);
    assert_eq!(v["margin_call"]["open"], false);
    assert_eq!(v["margin_call"]["open_call_curable"], false);
    assert_eq!(v["margin_call"]["cure_overdue"], false);
}

#[test]
fn ltv_equal_to_the_ratio_is_not_flagged() {
    let mut rows = base_rows();
    rows.valuation.as_mut().unwrap().0.ltv_bps = 8500;
    let v = build(&rows, None);
    assert_eq!(v["margin_call"]["ltv_above_ratio_no_onchain_call"], false);
}

#[test]
fn an_open_call_suppresses_the_no_call_flag() {
    let rows = open_call_rows(9000, 1);
    let v = build(&rows, None);
    assert_eq!(v["margin_call"]["ltv_above_ratio_no_onchain_call"], false);
    assert_eq!(v["margin_call"]["open"], true);
}

#[test]
fn without_a_valuation_the_margin_flags_are_false() {
    let mut rows = base_rows();
    rows.valuation = None;
    rows.records[0].status = "Active".to_owned();
    let v = build(&rows, None);
    assert!(v["valuation"].is_null());
    assert_eq!(v["margin_call"]["ltv_above_ratio_no_onchain_call"], false);
    assert_eq!(v["margin_call"]["open_call_curable"], false);
    assert!(v["records"][0]["valuation"].is_null());
    assert!(v["records"][0]["agent_release"].is_null());
}

#[test]
fn a_closed_loan_carries_no_ltv_alarm() {
    let mut rows = base_rows();
    rows.valuation.as_mut().unwrap().0.ltv_bps = 9000;
    let v = build(&rows, Some("Closed"));
    assert_eq!(v["margin_call"]["ltv_above_ratio_no_onchain_call"], false);
}

#[test]
fn cure_overdue_is_strictly_after_cure_by() {
    let cure_by = i128::from(NOW);
    let at = build(&open_call_rows(9000, cure_by), None);
    assert_eq!(at["margin_call"]["cure_overdue"], false);
    let after = build(&open_call_rows(9000, cure_by - 1), None);
    assert_eq!(after["margin_call"]["cure_overdue"], true);
    assert_eq!(after["margin_call"]["cure_by_source"], "event");
}

#[test]
fn an_open_call_is_curable_at_or_below_the_advance_ratio() {
    let curable = build(&open_call_rows(8000, 1), None);
    assert_eq!(curable["margin_call"]["open_call_curable"], true);
    let not = build(&open_call_rows(8001, 1), None);
    assert_eq!(not["margin_call"]["open_call_curable"], false);
}

#[test]
fn a_closed_loan_with_an_open_call_and_open_records_is_served_without_alarm() {
    let mut rows = open_call_rows(0, 1);
    {
        let (v, _) = rows.valuation.as_mut().unwrap();
        v.debt = dec(0);
        v.outstanding = dec(0);
        v.accrued_interest = dec(0);
        v.coverage_bps = i64::from(u32::MAX);
    }
    let v = build(&rows, Some("Closed"));
    assert_eq!(v["records"].as_array().unwrap().len(), 1);
    assert_eq!(v["records"][0]["open"], true);
    assert_eq!(v["records"][0]["agent_release"], "allowed");
    assert_eq!(v["margin_call"]["cure_overdue"], false);
    assert_eq!(v["margin_call"]["open_call_curable"], true);
    assert_eq!(v["margin_call"]["ltv_above_ratio_no_onchain_call"], false);
}

#[test]
fn cure_by_comes_from_the_event_even_after_set_terms_changed_the_period() {
    let rows = open_call_rows(9000, 777);
    let v = build(&rows, None);
    assert_eq!(v["margin_call"]["cure_by"], "777");
    assert_eq!(v["margin_call"]["cure_by_source"], "event");
}

#[test]
fn cure_by_falls_back_to_the_snapshot_when_no_event_is_indexed() {
    let mut rows = open_call_rows(9000, 777);
    rows.margin_events.clear();
    let v = build(&rows, None);
    let at = i128::from(NOW) - 5_000 + 10;
    assert_eq!(v["margin_call"]["cure_by"], (at + 604_800).to_string());
    assert_eq!(v["margin_call"]["cure_by_source"], "coverage_detail");
}

#[test]
fn cure_by_is_null_when_neither_source_matches() {
    let mut rows = open_call_rows(9000, 777);
    rows.margin_events.clear();
    rows.valuation.as_mut().unwrap().0.margin_call_at = dec(1);
    let v = build(&rows, None);
    assert!(v["margin_call"]["cure_by"].is_null());
    assert!(v["margin_call"]["cure_by_source"].is_null());
    assert_eq!(v["margin_call"]["open"], true);
}

#[test]
fn without_a_call_there_is_no_cure_by() {
    let v = build(&base_rows(), None);
    assert!(v["margin_call"]["cure_by"].is_null());
    assert!(v["margin_call"]["opened_at"].is_null());
    assert!(v["margin_call"]["cure_by_source"].is_null());
}

#[test]
fn the_latest_event_of_each_kind_is_reported() {
    let mut rows = base_rows();
    rows.margin_events = vec![
        margin_event(1, "open", 9000, Some(10)),
        margin_event(2, "price_stale", 9100, None),
        margin_event(3, "cured", 7000, None),
        margin_event(4, "open", 9500, Some(20)),
        margin_event(5, "price_stale", 9700, None),
    ];
    let v = build(&rows, None);
    let mc = &v["margin_call"];
    assert_eq!(mc["last_margin_call_ltv_bps"], 9500);
    assert_eq!(mc["last_price_stale"]["ltv_bps"], 9700);
    assert_eq!(mc["events"].as_array().unwrap().len(), 5);
    assert_eq!(mc["events"][0]["kind"], "open");
    assert_eq!(mc["events"][0]["cure_by"], "10");
    assert!(mc["events"][1]["cure_by"].is_null());
    assert_eq!(mc["events"][4]["block_number"], 5);
}

#[test]
fn with_no_events_the_last_fields_are_null() {
    let v = build(&base_rows(), None);
    assert!(v["margin_call"]["last_margin_call_ltv_bps"].is_null());
    assert!(v["margin_call"]["last_price_stale"].is_null());
}

fn doc(record_id: i64, position: i32, kind: &str) -> DocRow {
    DocRow {
        record_id,
        position,
        loan_id: 7,
        kind: kind.to_owned(),
        sha256: format!("hash{position}"),
        source: "register".to_owned(),
        ledger: None,
    }
}

fn inspection(id: i64, record_id: i64) -> InspectionRow {
    InspectionRow {
        inspection_id: id,
        loan_id: 7,
        record_id,
        lot_id: record_id,
        inspector: "GINSPECTOR".to_owned(),
        kind: "StockCount".to_owned(),
        quantity: Some(dec(5 * UNIT)),
        complete: true,
        ..InspectionRow::default()
    }
}

#[test]
fn docs_and_inspections_keep_order_and_mark_the_lots_latest() {
    let mut rows = base_rows();
    rows.records.push(record(2, "WarehousePledge", "Active"));
    rows.docs = vec![
        doc(1, 0, "WarehouseReceipt"),
        doc(1, 1, "Invoice"),
        doc(2, 0, "Other"),
    ];
    rows.inspections = vec![inspection(1, 1), inspection(2, 1), inspection(3, 2)];
    rows.lots[0].latest_inspection_id = Some(2);
    let v = build(&rows, None);
    let r1 = &v["records"][0];
    assert_eq!(r1["docs"].as_array().unwrap().len(), 2);
    assert_eq!(r1["docs"][0]["kind"], "WarehouseReceipt");
    assert_eq!(r1["docs"][1]["position"], 1);
    assert_eq!(r1["inspections"][0]["inspection_id"], "1");
    assert_eq!(r1["inspections"][0]["is_lot_latest"], false);
    assert_eq!(r1["inspections"][1]["inspection_id"], "2");
    assert_eq!(r1["inspections"][1]["is_lot_latest"], true);
    assert_eq!(r1["inspections"][1]["quantity"], "5.0000000");
    assert_eq!(v["records"][1]["inspections"].as_array().unwrap().len(), 1);
    assert_eq!(v["records"][1]["inspections"][0]["is_lot_latest"], false);
    assert_eq!(r1["lot"]["latest_inspection_id"], "2");
}

#[test]
fn flagged_by_zero_or_absent_is_null() {
    for flagged in [None, Some(0)] {
        let mut rows = base_rows();
        rows.records[0].flagged_by = flagged;
        assert!(build(&rows, None)["records"][0]["flagged_by"].is_null());
    }
    let mut rows = base_rows();
    rows.records[0].flagged_by = Some(4);
    assert_eq!(build(&rows, None)["records"][0]["flagged_by"], "4");
}

fn repayment(sale: i64, repayment_id: i64, reversed_at: Option<i64>) -> SaleRepaymentRow {
    SaleRepaymentRow {
        params: json!({
            "loan_id": "7",
            "repayment_id": repayment_id.to_string(),
            "sale_id": sale.to_string(),
            "cash": (100 * UNIT).to_string(),
            "interest_minted": (5 * UNIT).to_string(),
            "fee_shares": "250000",
            "value_date": "1762300000",
            "ref_hash": "ab12"
        }),
        tx_hash: format!("tx{repayment_id}"),
        block_timestamp: 1_762_390_000,
        reversed_at,
    }
}

#[test]
fn repayments_attach_to_the_matching_record_only() {
    let mut rows = base_rows();
    rows.records.push(record(2, "WarehousePledge", "Enforced"));
    rows.repayments = vec![
        repayment(2, 3, None),
        repayment(2, 4, Some(1_762_395_000)),
        repayment(9, 5, None),
    ];
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["repayments"], json!([]));
    let r = &v["records"][1]["repayments"];
    assert_eq!(r.as_array().unwrap().len(), 2);
    assert_eq!(r[0]["repayment_id"], "3");
    assert_eq!(r[0]["cash"], "100.0000000");
    assert_eq!(r[0]["interest_minted"], "5.0000000");
    assert_eq!(r[0]["fee_shares"], "0.0250000");
    assert_eq!(r[0]["value_date"], "1762300000");
    assert_eq!(r[0]["ref_hash"], "ab12");
    assert_eq!(r[0]["tx_hash"], "tx3");
    assert!(r[0]["reversed_at"].is_null());
    assert_eq!(r[1]["reversed_at"], "1762395000");
}

#[test]
fn a_repayment_with_unreadable_params_is_skipped() {
    let mut rows = base_rows();
    let mut bad = repayment(1, 3, None);
    bad.params["cash"] = json!("not-a-number");
    rows.repayments = vec![bad];
    assert_eq!(build(&rows, None)["records"][0]["repayments"], json!([]));
}

#[test]
fn refresh_pending_truth_table() {
    let mut rows = base_rows();
    assert_eq!(build(&rows, None)["refresh_pending"], false);

    rows.sr_log_id = 101;
    assert_eq!(build(&rows, None)["refresh_pending"], true);
    rows.sr_log_id = 100;
    assert_eq!(build(&rows, None)["refresh_pending"], false);

    rows.valuation_log_id = 41;
    assert_eq!(build(&rows, None)["refresh_pending"], true);
    rows.valuation_log_id = 40;

    rows.valuation = None;
    assert_eq!(build(&rows, None)["refresh_pending"], true);

    rows.terms = None;
    rows.records.clear();
    assert_eq!(build(&rows, None)["refresh_pending"], false);

    rows.registry = None;
    rows.sr_log_id = 1;
    assert_eq!(build(&rows, None)["refresh_pending"], true);
}

#[test]
fn malformed_counted_records_leave_record_valuations_null_without_failing() {
    for bad in [json!({"not": "an array"}), json!([{"record_id": 1}])] {
        let mut rows = base_rows();
        rows.valuation.as_mut().unwrap().0.counted_records = bad;
        let v = build(&rows, None);
        assert!(v["records"][0]["valuation"].is_null());
        assert!(v["records"][0]["agent_release"].is_null());
        assert!(v["valuation"].is_object());
    }
}

fn release_rows(outstanding: i128, counted: &Value) -> LoanSecurityRows {
    let mut rows = base_rows();
    rows.records = vec![
        record(1, "WarehousePledge", "Active"),
        record(2, "WarehousePledge", "Active"),
    ];
    let (v, _) = rows.valuation.as_mut().unwrap();
    v.outstanding = dec(outstanding);
    v.accrued_interest = dec(0);
    v.counted_records = counted.clone();
    rows
}

#[test]
fn agent_release_needs_consent_when_the_rest_cannot_carry_the_debt() {
    let counted = json!([
        counted_entry(1, 1_000 * UNIT, UNIT),
        counted_entry(2, 1_000 * UNIT, UNIT)
    ]);
    let v = build(&release_rows(1_600 * UNIT, &counted), None);
    assert_eq!(v["records"][0]["agent_release"], "needs_consent");
    assert_eq!(v["records"][1]["agent_release"], "needs_consent");
}

#[test]
fn agent_release_is_allowed_at_exactly_the_advance_ratio() {
    let counted = json!([
        counted_entry(1, 1_000 * UNIT, UNIT),
        counted_entry(2, 1_000 * UNIT, UNIT)
    ]);
    let v = build(&release_rows(800 * UNIT, &counted), None);
    assert_eq!(v["records"][0]["agent_release"], "allowed");
    let v = build(&release_rows(800 * UNIT + 1, &counted), None);
    assert_eq!(v["records"][0]["agent_release"], "needs_consent");
}

#[test]
fn agent_release_is_allowed_for_pending_perfection_loss_payee_and_zero_outstanding() {
    let counted = json!([counted_entry(1, 1_000 * UNIT, UNIT)]);
    let mut rows = release_rows(5_000 * UNIT, &counted);
    rows.records = vec![
        record(1, "WarehousePledge", "Active"),
        record(2, "WarehousePledge", "PendingPerfection"),
        record(3, "InsuranceLossPayee", "Active"),
    ];
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["agent_release"], "needs_consent");
    assert_eq!(v["records"][1]["agent_release"], "allowed");
    assert_eq!(v["records"][2]["agent_release"], "allowed");
    let v = build(&release_rows(0, &counted), None);
    assert_eq!(v["records"][0]["agent_release"], "allowed");
}

#[test]
fn agent_release_is_null_for_a_closed_record() {
    let counted = json!([counted_entry(1, 1_000 * UNIT, UNIT)]);
    let mut rows = release_rows(0, &counted);
    rows.records = vec![record(1, "WarehousePledge", "Released")];
    assert!(build(&rows, None)["records"][0]["agent_release"].is_null());
}

#[test]
fn consents_are_served_in_position_order() {
    let mut rows = base_rows();
    rows.consents = vec![
        ConsentRow {
            loan_id: 7,
            position: 0,
            consent_hash: "aa".to_owned(),
            new_maturity: Some(dec(1_800_000_000)),
            ledger: Some(9),
            block_timestamp: Some(1_762_000_000),
        },
        ConsentRow {
            loan_id: 7,
            position: 1,
            consent_hash: "bb".to_owned(),
            new_maturity: None,
            ledger: None,
            block_timestamp: None,
        },
    ];
    let v = build(&rows, None);
    assert_eq!(v["extension_consents"][0]["consent_hash"], "aa");
    assert_eq!(v["extension_consents"][0]["new_maturity"], "1800000000");
    assert_eq!(v["extension_consents"][0]["at"], "1762000000");
    assert!(v["extension_consents"][1]["new_maturity"].is_null());
}

#[test]
fn a_record_mark_is_served_with_a_7dp_price() {
    let mut rows = base_rows();
    rows.records[0].mark_value_per_unit = Some(dec(25_000_000));
    rows.records[0].mark_benchmark = Some("LME".to_owned());
    rows.records[0].mark_report_hash = Some("ff".to_owned());
    let v = build(&rows, None);
    let m = &v["records"][0]["mark"];
    assert_eq!(m["value_per_unit"], "2.5000000");
    assert_eq!(m["benchmark"], "LME");
    assert_eq!(m["report_hash"], "ff");
    assert_eq!(m["at"], (NOW - 100).to_string());
}

#[test]
fn values_decoded_with_a_negative_exponent_are_served_correctly() {
    let mut rows = open_call_rows(9000, 1);
    {
        let t = rows.terms.as_mut().unwrap();
        t.margin_call_at = sqlx_dec(17_624, -5);
        t.cure_period = sqlx_dec(1, -6);
        t.attestation_interval = sqlx_dec(5, -2);
        t.inspection_interval = sqlx_dec(0, 0);
        t.price_stale_after = sqlx_dec(864, -2);
        let (v, _) = rows.valuation.as_mut().unwrap();
        v.debt = sqlx_dec(8, -10);
        v.value = sqlx_dec(125, -8);
        v.outstanding = sqlx_dec(79, -9);
        v.margin_call_at = sqlx_dec(17_624, -5);
        v.cure_by = sqlx_dec(17_624, -5);
    }
    rows.records[0].attested_at = Some(sqlx_dec(17_623, -5));
    rows.records[0].mark_at = Some(sqlx_dec(17_623, -5));
    rows.records[0].mark_value_per_unit = Some(sqlx_dec(1, -7));
    rows.margin_events.clear();
    let v = build(&rows, None);
    assert_eq!(v["terms"]["cure_period"], "1000000");
    assert_eq!(v["terms"]["attestation_interval"], "500");
    assert_eq!(v["valuation"]["debt"], "8000.0000000");
    assert_eq!(v["valuation"]["value"], "1250.0000000");
    assert_eq!(v["valuation"]["outstanding"], "7900.0000000");
    assert_eq!(v["records"][0]["mark"]["value_per_unit"], "1.0000000");
    assert_eq!(v["records"][0]["mark"]["at"], "1762300000");
    assert_eq!(v["margin_call"]["open"], true);
    assert_eq!(v["margin_call"]["opened_at"], "1762400000");
    assert_eq!(v["margin_call"]["cure_by"], "1762400000");
    assert_eq!(v["margin_call"]["cure_by_source"], "coverage_detail");
    assert_eq!(v["margin_call"]["cure_overdue"], false);
    assert_eq!(v["records"][0]["attestation_stale"], true);
    assert_eq!(v["records"][0]["mark_stale"], true);
    assert_eq!(v["prices"]["mark_age"], "100000");
    assert_eq!(v["prices"]["price_stale"], true);
}

#[test]
fn an_undecodable_number_makes_the_dependent_flags_null_not_zero() {
    let mut rows = base_rows();
    rows.terms.as_mut().unwrap().margin_call_at = sqlx_dec(1, -1_000_000);
    let v = build(&rows, None);
    let mc = &v["margin_call"];
    for key in [
        "open",
        "opened_at",
        "cure_overdue",
        "ltv_above_ratio_no_onchain_call",
        "open_call_curable",
    ] {
        assert!(mc[key].is_null(), "{key}");
    }

    let mut rows = base_rows();
    rows.terms.as_mut().unwrap().attestation_interval = sqlx_dec(1, -1_000_000);
    rows.terms.as_mut().unwrap().price_stale_after = sqlx_dec(1, -1_000_000);
    let v = build(&rows, None);
    assert!(v["terms"]["attestation_interval"].is_null());
    assert!(v["records"][0]["attestation_stale"].is_null());
    assert!(v["records"][0]["mark_stale"].is_null());
    assert!(v["prices"]["price_stale"].is_null());
    assert!(v["prices"]["mark_age"].is_string());

    let mut rows = base_rows();
    rows.terms.as_mut().unwrap().inspection_interval = dec(500);
    rows.records[0].perfected_at = Some(sqlx_dec(1, -1_000_000));
    assert!(build(&rows, None)["records"][0]["inspection_stale"].is_null());

    let mut rows = base_rows();
    rows.records[0].mark_at = Some(sqlx_dec(1, -1_000_000));
    let v = build(&rows, None);
    assert!(v["records"][0]["mark_stale"].is_null());
    assert!(v["prices"]["mark_age"].is_null());
    assert!(v["prices"]["price_stale"].is_null());
}

#[test]
fn a_counted_record_missing_from_the_projection_only_affects_itself() {
    let mut rows = base_rows();
    rows.records = vec![
        record(1, "WarehousePledge", "Active"),
        record(2, "WarehousePledge", "Active"),
    ];
    rows.valuation.as_mut().unwrap().0.counted_records = json!([
        counted_entry(1, 1_000 * UNIT, UNIT),
        counted_entry(2, 1_000 * UNIT, UNIT),
        counted_entry(9, 1_000 * UNIT, UNIT)
    ]);
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["valuation"]["value"], "1000.0000000");
    assert_eq!(v["records"][1]["valuation"]["value"], "1000.0000000");
    assert!(v["records"][0]["agent_release"].is_null());
}

#[test]
fn one_unparsable_counted_entry_leaves_the_other_valuations_intact() {
    let mut rows = base_rows();
    rows.records = vec![
        record(1, "WarehousePledge", "Active"),
        record(2, "WarehousePledge", "Active"),
    ];
    rows.valuation.as_mut().unwrap().0.counted_records = json!([
        counted_entry(1, 1_000 * UNIT, UNIT),
        {"record_id": 2, "counted_quantity": "x", "value_per_unit": "1", "mark_at": "1", "stale": false, "flagged": false}
    ]);
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["valuation"]["value"], "1000.0000000");
    assert!(v["records"][1]["valuation"].is_null());
    assert!(v["records"][0]["agent_release"].is_null());
}

#[test]
fn agent_release_short_circuits_before_the_snapshot_is_needed() {
    let mut rows = base_rows();
    rows.valuation = None;
    rows.records = vec![
        record(1, "WarehousePledge", "PendingPerfection"),
        record(2, "InsuranceLossPayee", "Active"),
        record(3, "WarehousePledge", "Active"),
    ];
    let v = build(&rows, None);
    assert_eq!(v["records"][0]["agent_release"], "allowed");
    assert_eq!(v["records"][1]["agent_release"], "allowed");
    assert!(v["records"][2]["agent_release"].is_null());

    let mut rows = base_rows();
    rows.valuation.as_mut().unwrap().0.counted_records = json!({"bad": true});
    rows.valuation.as_mut().unwrap().0.outstanding = dec(0);
    assert_eq!(build(&rows, None)["records"][0]["agent_release"], "allowed");

    let mut rows = base_rows();
    rows.valuation.as_mut().unwrap().0.counted_records = json!({"bad": true});
    rows.records = vec![record(1, "WarehousePledge", "PendingPerfection")];
    assert_eq!(build(&rows, None)["records"][0]["agent_release"], "allowed");
}

#[test]
fn the_loan_status_comes_from_the_rows() {
    let mut rows = base_rows();
    rows.loan_status = Some("Closed".to_owned());
    let v = serde_json::to_value(build_security_response(
        STELLAR.chain_id,
        REGISTRY,
        "7",
        &rows,
        NOW,
    ))
    .unwrap();
    assert_eq!(v["loan_status"], "Closed");
}

#[test]
fn repayment_params_may_be_json_numbers_or_strings() {
    let mut rows = base_rows();
    rows.records.push(record(2, "WarehousePledge", "Enforced"));
    let mut numeric = repayment(2, 3, None);
    numeric.params["repayment_id"] = json!(3);
    numeric.params["sale_id"] = json!(2);
    numeric.params["value_date"] = json!(1_762_300_000);
    rows.repayments = vec![numeric];
    let v = build(&rows, None);
    assert_eq!(v["records"][1]["repayments"][0]["repayment_id"], "3");
    assert_eq!(v["records"][1]["repayments"][0]["value_date"], "1762300000");
}
