// spec: docs/user-stories/epic-1521/1595-dashboard-auditlog-chain.md
use std::collections::HashMap;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Method, Request, StatusCode};
use bigdecimal::BigDecimal;
use pipeline_api::config::ConfiguredChain;
use pipeline_api::routes::audit_log::{self, build_response, format_action, AuditLogDoc};
use pipeline_api::routes::dashboard::{
    self, chain_yield_deltas, compute_summary, compute_tvl_history, compute_yield_history,
    merge_flows, merge_yield_deltas, DashboardDoc,
};
use pipeline_api::AppState;
use serde_json::{json, Value};
use shared::chains::ChainKind;
use shared::contract_logs_repo::{
    AuditLogRow, ContractLogsRepo, FlowEventRow, LoanSnapshotRow, RepaymentMintRow, YieldMintRow,
};
use shared::kyc_repo::KycRepo;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};
use shared::minted_yield::loan_minted_yield;
use shared::minted_yield::net_repayment_minted_raw;
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
const DAY: i64 = 86_400;

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

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn repayment(
    senior_interest: BigDecimal,
    mgmt_fee: BigDecimal,
    perf_fee: BigDecimal,
) -> RepaymentSnapshot {
    RepaymentSnapshot {
        offtaker_received: BigDecimal::from(0_i64),
        senior_principal_repaid: BigDecimal::from(0_i64),
        senior_interest,
        equity_distributed: BigDecimal::from(0_i64),
        mgmt_fee,
        perf_fee,
        oet_alloc: BigDecimal::from(0_i64),
    }
}

fn zero_repayment() -> RepaymentSnapshot {
    repayment(
        BigDecimal::from(0_i64),
        BigDecimal::from(0_i64),
        BigDecimal::from(0_i64),
    )
}

fn make_loan(
    chain_id: i64,
    loan_id: i64,
    senior_usdc: i64,
    equity_usdc: i64,
    rate_bps: u32,
    start_day: i64,
    end_day: i64,
) -> LoanSnapshotRow {
    LoanSnapshotRow {
        chain_id,
        loan_id: BigDecimal::from(loan_id),
        block_number: 0,
        log_index: 0,
        event_name: "LoanDrawn".to_owned(),
        block_timestamp: 0,
        snapshot: LoanSnapshot {
            originator: "orig".to_owned(),
            borrower_id: "b".to_owned(),
            commodity: "c".to_owned(),
            corridor: "cr".to_owned(),
            governing_law: "EN".to_owned(),
            protection: String::new(),
            metadata_uri: None,
            documents: Vec::new(),
            original_facility_size: usdc(senior_usdc + equity_usdc),
            original_senior_tranche: usdc(senior_usdc),
            original_equity_tranche: usdc(equity_usdc),
            original_offtaker_price: BigDecimal::from(0_i64),
            senior_interest_rate_bps: rate_bps,
            origination_date: start_day * DAY,
            original_maturity_date: end_day * DAY,
            next_economics_epochs_id: BigDecimal::from(1_i64),
            next_repayment_id: BigDecimal::from(0_i64),
            status: "Performing".to_owned(),
            current_maturity_timestamp: 0,
            current_rate: rate_bps,
            closure_reason: "None".to_owned(),
            carved_out: false,
            disbursed: usdc(senior_usdc),
            repaid: BigDecimal::from(0_i64),
            written_down: BigDecimal::from(0_i64),
            interest_adjustment: BigDecimal::from(0_i64),
            metadata_uri_onchain: String::new(),
            repayment: zero_repayment(),
        },
    }
}

fn flow(kind: &str, ts_day: i64, amount_usdc: i64) -> FlowEventRow {
    FlowEventRow {
        block_timestamp: ts_day * DAY,
        kind: kind.to_owned(),
        amount: usdc(amount_usdc),
    }
}

fn legacy_mint(ts_day: i64, amount_usdc: i64) -> YieldMintRow {
    YieldMintRow {
        block_timestamp: ts_day * DAY,
        s_plusd_amount: usdc(amount_usdc),
    }
}

fn cash_repaid(
    ts_day: i64,
    interest_raw: i64,
    fee_raw: Option<i64>,
    reversed_day: Option<i64>,
) -> RepaymentMintRow {
    RepaymentMintRow {
        loan_id: BigDecimal::from(1),
        repayment_id: BigDecimal::from(0),
        block_timestamp: ts_day * DAY,
        interest_minted: BigDecimal::from(interest_raw),
        fee_amount: fee_raw.map(BigDecimal::from),
        reversed_at: reversed_day.map(|d| d * DAY),
    }
}

fn loan_repaid(
    loan: i64,
    ts_day: i64,
    interest_raw: i64,
    fee_raw: Option<i64>,
    reversed_day: Option<i64>,
) -> RepaymentMintRow {
    RepaymentMintRow {
        loan_id: BigDecimal::from(loan),
        ..cash_repaid(ts_day, interest_raw, fee_raw, reversed_day)
    }
}

fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

// ── Dashboard: chain selection ──────────────────────────────────────────────

const DASHBOARD_PATHS: [&str; 3] = [
    "/dashboard/summary",
    "/dashboard/tvl-history",
    "/dashboard/yield-history",
];

fn error_body(msg: &str) -> String {
    json!({ "error": msg }).to_string()
}

#[tokio::test]
async fn dashboard_malformed_chain_id_is_400() {
    for path in DASHBOARD_PATHS {
        let (status, body) = call(dashboard::router(), &format!("{path}?chain_id=abc")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(body, error_body("invalid chain_id: abc"), "{path}");
    }
}

#[tokio::test]
async fn dashboard_repeated_chain_id_is_400() {
    for path in DASHBOARD_PATHS {
        let (status, _) = call(
            dashboard::router(),
            &format!("{path}?chain_id=1&chain_id=99000001"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
    }
}

#[tokio::test]
async fn dashboard_unconfigured_chain_id_is_200_zeroed_without_db() {
    let (status, body) = call(dashboard::router(), "/dashboard/summary?chain_id=5").await;
    assert_eq!(status, StatusCode::OK);
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["tvl"], "0.000000");
    assert_eq!(v["cumulative_yield_total"], "0.000000");
    assert_eq!(v["outstanding_in_loans"], "0.000000");
    assert_eq!(v["loan_book_yield"], Value::Null);
    assert_eq!(v["current_apy_net_to_splusd"], Value::Null);

    for path in ["/dashboard/tvl-history", "/dashboard/yield-history"] {
        for query in ["chain_id=5", "chain_id=5&days=7"] {
            let (status, body) = call(dashboard::router(), &format!("{path}?{query}")).await;
            assert_eq!(status, StatusCode::OK, "{path}?{query}");
            let v: Value = serde_json::from_str(&body).unwrap();
            assert_eq!(v["series"], json!([]), "{path}?{query}");
            assert_eq!(v["max"], "0.000000");
            assert_eq!(v["min"], "0.000000");
            assert_eq!(v["average"], "0.000000");
        }
    }
}

// ── Dashboard: aggregation across chains ────────────────────────────────────

#[test]
fn repayment_mints_normalise_per_chain_decimals_before_summing() {
    let evm = chain_yield_deltas(
        ChainKind::Evm,
        &[],
        &[cash_repaid(1, 2_000_000, Some(1_000_000), None)],
    );
    let stellar = chain_yield_deltas(
        ChainKind::Stellar,
        &[],
        &[cash_repaid(2, 30_000_000, Some(10_000_000), None)],
    );
    let merged = merge_yield_deltas(vec![evm, stellar]);
    let summary = compute_summary(&[], &[], &[], &merged, 5 * DAY);
    assert_eq!(summary.cumulative_yield_total, "7.000000");
}

#[test]
fn cumulative_yield_is_legacy_plus_cash_repaid_net_of_reversal() {
    let legacy = vec![legacy_mint(1, 5)];
    let repaid = vec![
        cash_repaid(2, 8_000_000, Some(2_000_000), Some(4)),
        cash_repaid(3, 1_000_000, None, None),
    ];
    let deltas = chain_yield_deltas(ChainKind::Evm, &legacy, &repaid);

    let before_reversal = compute_summary(&[], &[], &[], &deltas, 3 * DAY);
    assert_eq!(before_reversal.cumulative_yield_total, "16.000000");
    let after_reversal = compute_summary(&[], &[], &[], &deltas, 5 * DAY);
    assert_eq!(after_reversal.cumulative_yield_total, "6.000000");

    let hist = compute_yield_history(&deltas, 0, 5 * DAY, DAY);
    let points: Vec<&str> = hist
        .series
        .iter()
        .map(|p| p.cumulative_yield.as_str())
        .collect();
    assert_eq!(
        points,
        [
            "0.000000",
            "5.000000",
            "15.000000",
            "16.000000",
            "6.000000",
            "6.000000"
        ]
    );
    assert_eq!(hist.max, "16.000000");
    assert_eq!(hist.min, "0.000000");
}

#[test]
fn yield_deltas_match_shared_net_repayment_arithmetic() {
    let repaid = vec![
        cash_repaid(2, 8_000_000, Some(2_000_000), Some(4)),
        cash_repaid(3, 1_000_000, None, None),
    ];
    for as_of_day in [1, 2, 3, 4, 5] {
        let as_of = as_of_day * DAY;
        let expected = net_repayment_minted_raw(&repaid, as_of);
        let deltas = chain_yield_deltas(ChainKind::Evm, &[], &repaid);
        let got: BigDecimal = deltas
            .iter()
            .filter(|d| d.block_timestamp <= as_of)
            .map(|d| d.s_plusd_amount.clone())
            .sum();
        assert_eq!(got, expected, "as_of day {as_of_day}");
    }
}

#[test]
fn stellar_dashboard_yield_equals_sum_of_per_loan_minted_yield() {
    let repaid = vec![
        loan_repaid(1, 1, 5, Some(4), None),
        loan_repaid(1, 2, 5, Some(4), None),
        loan_repaid(1, 3, 5, Some(4), Some(5)),
        loan_repaid(2, 1, 7, None, None),
        loan_repaid(2, 2, 7, Some(1), Some(4)),
        loan_repaid(3, 2, 6, Some(6), None),
        loan_repaid(3, 4, 9, None, None),
    ];
    let deltas = chain_yield_deltas(ChainKind::Stellar, &[], &repaid);
    let zero = BigDecimal::from(0);
    for as_of_day in 0..=6 {
        let as_of = as_of_day * DAY;
        let dashboard: BigDecimal = deltas
            .iter()
            .filter(|d| d.block_timestamp <= as_of)
            .map(|d| d.s_plusd_amount.clone())
            .sum();
        let per_loan: BigDecimal = (1..=3)
            .map(|loan| {
                let rows: Vec<RepaymentMintRow> = repaid
                    .iter()
                    .filter(|r| r.loan_id == loan)
                    .cloned()
                    .collect();
                loan_minted_yield(ChainKind::Stellar, &zero, &rows, as_of)
            })
            .sum();
        assert_eq!(dashboard, per_loan, "as_of day {as_of_day}");
    }
    let per_row_floor: BigDecimal = repaid
        .iter()
        .filter(|r| r.reversed_at.is_none())
        .map(|r| {
            shared::chains::normalize_usdc_amount(
                ChainKind::Stellar,
                &(&r.interest_minted + r.fee_amount.clone().unwrap_or_default()),
            )
        })
        .sum();
    let at_end: BigDecimal = deltas.iter().map(|d| d.s_plusd_amount.clone()).sum();
    assert_ne!(at_end, per_row_floor);
}

#[test]
fn same_timestamp_up_then_down_does_not_register_a_transient_extreme() {
    let deltas = vec![
        legacy_mint(1, 5),
        legacy_mint(2, 10),
        legacy_mint(2, -10),
        legacy_mint(3, -4),
        legacy_mint(3, 4),
    ];
    let hist = compute_yield_history(&deltas, 0, 4 * DAY, DAY);
    assert_eq!(hist.max, "5.000000");
    assert_eq!(hist.min, "0.000000");
}

#[test]
fn reversal_at_or_before_the_mint_leaves_the_row_out() {
    let deltas = chain_yield_deltas(
        ChainKind::Evm,
        &[],
        &[cash_repaid(3, 5_000_000, None, Some(3))],
    );
    assert!(deltas.is_empty());
}

#[test]
fn tvl_series_sums_chains_on_one_grid_with_stats_from_the_summed_series() {
    let evm = vec![flow("deposit", 0, 100), flow("withdrawal", 6, 40)];
    let stellar = vec![flow("deposit", 2, 50)];
    let flows = merge_flows(vec![evm, stellar]);
    let hist = compute_tvl_history(&flows, 0, 10 * DAY, 5 * DAY);
    let points: Vec<&str> = hist.series.iter().map(|p| p.tvl.as_str()).collect();
    assert_eq!(points, ["100.000000", "150.000000", "110.000000"]);
    assert_eq!(hist.max, "150.000000");
    assert_eq!(hist.min, "100.000000");
    assert_eq!(hist.average, "124.000000");
}

#[test]
fn single_chain_merge_is_the_identity() {
    let flows = vec![
        flow("deposit", 0, 100),
        flow("withdrawal", 3, 10),
        flow("deposit", 3, 7),
        flow("deposit", 5, 1),
    ];
    let merged = merge_flows(vec![flows.clone()]);
    let key = |f: &FlowEventRow| (f.block_timestamp, f.kind.clone(), f.amount.clone());
    assert_eq!(
        merged.iter().map(key).collect::<Vec<_>>(),
        flows.iter().map(key).collect::<Vec<_>>()
    );

    let deltas = vec![
        legacy_mint(1, 5),
        legacy_mint(2, 7),
        legacy_mint(2, -3),
        legacy_mint(4, 2),
    ];
    let merged = merge_yield_deltas(vec![deltas.clone()]);
    let key = |m: &YieldMintRow| (m.block_timestamp, m.s_plusd_amount.clone());
    assert_eq!(
        merged.iter().map(key).collect::<Vec<_>>(),
        deltas.iter().map(key).collect::<Vec<_>>()
    );

    let loans = vec![make_loan(1, 1, 100_000, 0, 1000, 0, 180)];
    let summary = compute_summary(&loans, &[], &flows, &deltas, 90 * DAY);
    assert_eq!(summary.tvl, "98.000000");
    assert_eq!(summary.cumulative_yield_total, "11.000000");
    assert_eq!(summary.loan_book_yield.as_deref(), Some("0.100000"));
}

#[test]
fn summary_rates_are_outstanding_weighted_across_chains() {
    let loans = vec![
        make_loan(1, 1, 100, 0, 1000, 0, 180),
        make_loan(99_000_001, 1, 300, 0, 2000, 0, 180),
    ];
    let summary = compute_summary(&loans, &[], &[], &[], 90 * DAY);
    assert_eq!(summary.loan_book_yield.as_deref(), Some("0.175000"));
    assert_eq!(
        summary.current_apy_net_to_splusd.as_deref(),
        Some("0.175000")
    );
    assert_eq!(summary.outstanding_in_loans.as_deref(), Some("400.000000"));
}

#[test]
fn summary_rates_are_null_without_active_loans_on_any_chain() {
    let summary = compute_summary(&[], &[], &[], &[], 90 * DAY);
    assert_eq!(summary.loan_book_yield, None);
    assert_eq!(summary.current_apy_net_to_splusd, None);
}

// ── Dashboard: OpenAPI ──────────────────────────────────────────────────────

#[test]
fn dashboard_openapi_marks_chain_id_optional_with_400() {
    let doc = to_json(&DashboardDoc::openapi());
    for path in [
        "/v1/dashboard/summary",
        "/v1/dashboard/tvl-history",
        "/v1/dashboard/yield-history",
    ] {
        let params = doc["paths"][path]["get"]["parameters"].as_array().unwrap();
        let chain: Vec<_> = params.iter().filter(|p| p["name"] == "chain_id").collect();
        assert_eq!(chain.len(), 1, "{path}");
        assert_eq!(chain[0]["required"], false, "{path}");
        assert!(doc["paths"][path]["get"]["responses"]["400"].is_object());
    }
}

// ── AuditLog: chain selection ───────────────────────────────────────────────

#[tokio::test]
async fn audit_log_malformed_chain_id_is_400() {
    let (status, body) = call(audit_log::router(), "/audit-log?chain_id=abc").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error_body("invalid chain_id: abc"));
}

#[tokio::test]
async fn audit_log_repeated_chain_id_is_400() {
    let (status, _) = call(
        audit_log::router(),
        "/audit-log?chain_id=1&chain_id=99000001",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn audit_log_unconfigured_chain_id_is_200_empty_without_db() {
    let (status, body) = call(audit_log::router(), "/audit-log?chain_id=5").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, r#"{"items":[]}"#);
}

// ── AuditLog: merge order + per-row kind ────────────────────────────────────

fn log_row(
    id: i64,
    chain_id: i64,
    pos: (i64, i64, i64),
    event_name: &str,
    loan_id: Option<&str>,
    params: Value,
) -> AuditLogRow {
    AuditLogRow {
        id,
        chain_id,
        event_name: event_name.to_owned(),
        block_timestamp: pos.0,
        block_number: pos.1,
        log_index: pos.2,
        tx_hash: format!("0xhash{id}"),
        loan_id: loan_id.map(str::to_owned),
        originator: None,
        commodity: None,
        params,
    }
}

#[test]
fn chains_merge_newest_first_by_timestamp_then_block_then_log_index() {
    let rows = vec![
        log_row(1, 1, (100, 10, 0), "LoanDrawn", Some("1"), json!({})),
        log_row(2, 1, (300, 30, 1), "LoanClosed", Some("1"), json!({})),
        log_row(
            3,
            99_000_001,
            (300, 30, 2),
            "LoanDefaulted",
            Some("2"),
            json!({}),
        ),
        log_row(
            4,
            99_000_001,
            (200, 20, 0),
            "Disbursed",
            Some("2"),
            json!({}),
        ),
        log_row(5, 1, (300, 29, 9), "Undisbursed", Some("1"), json!({})),
    ];
    let resp = build_response(rows, &[EVM, STELLAR]);
    let order: Vec<(&str, i64)> = resp
        .items
        .iter()
        .map(|i| (i.event_name.as_str(), i.chain_id))
        .collect();
    assert_eq!(
        order,
        [
            ("LoanDefaulted", 99_000_001),
            ("LoanClosed", 1),
            ("Undisbursed", 1),
            ("Disbursed", 99_000_001),
            ("LoanDrawn", 1),
        ]
    );
}

#[test]
fn amounts_are_rendered_with_the_rows_own_chain_kind() {
    let params = json!({ "loan_id": "7", "amount": "10000000" });
    let rows = vec![
        log_row(
            1,
            1,
            (200, 2, 0),
            "CashDisbursed",
            Some("7"),
            params.clone(),
        ),
        log_row(
            2,
            99_000_001,
            (100, 1, 0),
            "CashDisbursed",
            Some("7"),
            params,
        ),
    ];
    let resp = build_response(rows, &[EVM, STELLAR]);
    assert_eq!(resp.items[0].chain_id, 1);
    assert_eq!(resp.items[0].details["amount"], "10.000000");
    assert_eq!(resp.items[1].chain_id, 99_000_001);
    assert_eq!(resp.items[1].details["amount"], "1.000000");
}

#[test]
fn rows_from_unconfigured_chains_are_dropped() {
    let rows = vec![log_row(
        1,
        5,
        (100, 1, 0),
        "LoanDrawn",
        Some("1"),
        json!({}),
    )];
    assert!(build_response(rows, &[EVM, STELLAR]).items.is_empty());
}

#[test]
fn audit_item_serialises_chain_id() {
    let rows = vec![log_row(
        1,
        99_000_001,
        (100, 1, 0),
        "WireOutCancelled",
        None,
        json!({ "id": "4" }),
    )];
    let item = to_json(&build_response(rows, &[EVM, STELLAR]).items[0]);
    assert_eq!(item["chain_id"], 99_000_001);
    assert_eq!(item["scope"]["label"], "Protocol");
}

// ── AuditLog: new events, params exactly as the parsers write them ──────────

fn act(event: &str, params: impl Into<Value>, kind: ChainKind) -> (String, Value) {
    format_action(event, &params.into(), kind)
}

#[test]
fn allow_list_has_the_new_events_and_not_deal_token_transfer() {
    for name in [
        "CashDisbursed",
        "CashDisbursementReversed",
        "CashRepaid",
        "CashRepaymentReversed",
        "WireInReturned",
        "WireOutRequested",
        "WireOutSettled",
        "WireOutCancelled",
        "RampOpened",
        "RampClosed",
        "CashRecorded",
        "MintCorrected",
        "LossAbsorbed",
        "CashCorrected",
        "Pledged",
        "HaircutSet",
        "FloorSet",
        "Revalued",
        "StageUpdated",
        "ControlUpdated",
        "DocAdded",
        "QuantityAdjusted",
        "Released",
        "Liquidated",
        "MarginCall",
        "DealRegistered",
        "DebtSynced",
        "CargoSynced",
        "YieldMinted",
        "LoanCCRUpdated",
        "LoanLocationUpdated",
    ] {
        assert!(audit_log::AUDIT_EVENT_NAMES.contains(&name), "{name}");
    }
    assert!(!audit_log::AUDIT_EVENT_NAMES.contains(&"DealTokenTransfer"));
}

#[test]
fn minter_loan_cash_events_render_on_both_arms() {
    let ev = json!({ "loan_id": "7", "entry_id": "3", "amount": "2500000", "value_date": "1700000000", "ref_hash": "ab" });
    let (a, d) = act("CashDisbursed", ev, ChainKind::Evm);
    assert_eq!(a, "Cash disbursed — $2.500000");
    assert_eq!(d["amount"], "2.500000");
    assert_eq!(d["entry_id"], "3");
    let st = json!({ "loan_id": "7", "entry_id": "3", "amount": "25000000", "value_date": "1700000000", "ref_hash": "ab" });
    assert_eq!(
        act("CashDisbursed", st, ChainKind::Stellar).0,
        "Cash disbursed — $2.500000"
    );

    let rev = json!({ "loan_id": "7", "entry_id": "4", "original_id": "3", "amount": "2500000", "ref_hash": "ab" });
    let (a, d) = act("CashDisbursementReversed", rev, ChainKind::Evm);
    assert_eq!(a, "Cash disbursement reversed — $2.500000");
    assert_eq!(d["original_id"], "3");
}

#[test]
fn cash_repaid_and_reversal_render_on_both_arms() {
    let evm = json!({
        "loan_id": "7", "repayment_id": "2", "sale_id": "0", "cash": "100000000",
        "interest_minted": "5000000", "fee_shares": "400000", "value_date": "1700000000", "ref_hash": "ab",
    });
    let (a, d) = act("CashRepaid", evm, ChainKind::Evm);
    assert_eq!(a, "Cash repaid — $100.000000");
    assert_eq!(d["interest_minted"], "5.000000");
    assert_eq!(d["fee_shares"], "400000");
    assert_eq!(d["repayment_id"], "2");
    let stellar = json!({
        "loan_id": "7", "repayment_id": "2", "sale_id": "0", "cash": "1000000000",
        "interest_minted": "50000000", "fee_shares": "4000000", "value_date": "1700000000", "ref_hash": "ab",
    });
    let (a, d) = act("CashRepaid", stellar, ChainKind::Stellar);
    assert_eq!(a, "Cash repaid — $100.000000");
    assert_eq!(d["interest_minted"], "5.000000");

    let (a, d) = act(
        "CashRepaymentReversed",
        json!({ "loan_id": "7", "repayment_id": "2", "cash": "100000000", "ref_hash": "ab" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Cash repayment reversed — $100.000000");
    assert_eq!(d["repayment_id"], "2");
}

#[test]
fn wire_events_render() {
    let (a, d) = act(
        "WireInReturned",
        json!({ "id": "9", "amount": "3000000", "ref_hash": "ab" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Wire-in returned — $3.000000");
    assert_eq!(d["id"], "9");

    let (a, d) = act(
        "WireOutRequested",
        json!({ "id": "9", "lp": "0xLP", "amount": "30000000" }),
        ChainKind::Stellar,
    );
    assert_eq!(a, "Wire-out requested — $3.000000");
    assert_eq!(d["lp"], "0xLP");

    let (a, d) = act(
        "WireOutSettled",
        json!({ "id": "9", "amount": "3000000", "value_date": "1700000000", "ref_hash": "ab" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Wire-out settled — $3.000000");
    assert_eq!(d["value_date"], "1700000000");

    let (a, d) = act("WireOutCancelled", json!({ "id": "9" }), ChainKind::Evm);
    assert_eq!(a, "Wire-out cancelled");
    assert_eq!(d["id"], "9");
}

#[test]
fn ramp_cash_and_supply_events_render() {
    let (a, d) = act(
        "RampOpened",
        json!({ "id": "1", "direction": "UsdcToBank", "amount": "5000000", "ref_hash": "ab" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Ramp opened — UsdcToBank $5.000000");
    assert_eq!(d["direction"], "UsdcToBank");

    let (a, d) = act(
        "RampClosed",
        json!({ "id": "1", "received": "50000000", "loss": "10000", "ref_hash": "ab" }),
        ChainKind::Stellar,
    );
    assert_eq!(a, "Ramp closed — received $5.000000, loss $0.001000");
    assert_eq!(d["loss"], "0.001000");

    let (a, d) = act(
        "CashRecorded",
        json!({ "reason": "Expense", "entry_id": "8", "delta": "-2000000", "value_date": "1700000000", "ref_hash": "ab" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Cash recorded — Expense -$2.000000");
    assert_eq!(d["delta"], "-2.000000");

    let (a, d) = act(
        "CashCorrected",
        json!({ "original_id": "8", "entry_id": "9", "delta": "1000000", "reason_hash": "ab" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Cash corrected — $1.000000");
    assert_eq!(d["original_id"], "8");

    let (a, _) = act(
        "MintCorrected",
        json!({ "amount": "70000000", "ref_hash": "ab" }),
        ChainKind::Stellar,
    );
    assert_eq!(a, "Mint corrected — $7.000000");

    let (a, d) = act(
        "LossAbsorbed",
        json!({ "requested": "9000000", "pulled": "4000000" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Loss absorbed — $4.000000 of $9.000000 requested");
    assert_eq!(d["requested"], "9.000000");
}

#[test]
fn collateral_registry_events_render_on_both_arms() {
    let (a, d) = act(
        "Pledged",
        json!({ "loan_id": "7", "lot_id": "2" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Collateral pledged");
    assert_eq!(d["lot_id"], "2");

    let (a, d) = act(
        "HaircutSet",
        json!({ "loan_id": "7", "lot_id": "2", "bps": 1500 }),
        ChainKind::Stellar,
    );
    assert_eq!(a, "Haircut set — 1500 bps");
    assert_eq!(d["bps"], "1500");

    let (a, _) = act(
        "FloorSet",
        json!({ "loan_id": "7", "bps": 12000 }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Coverage floor set — 12000 bps");

    let evm = json!({ "loan_id": "7", "lot_id": "2", "value_per_unit": "1000000", "benchmark": "PAR", "report_hash": "ab" });
    let (a, d) = act("Revalued", evm, ChainKind::Evm);
    assert_eq!(a, "Collateral revalued — $1.000000/unit (PAR)");
    assert_eq!(d["benchmark"], "PAR");
    let stellar = json!({ "loan_id": "7", "lot_id": "2", "value_per_unit": "10000000", "benchmark": "PAR", "report_hash": "ab" });
    assert_eq!(
        act("Revalued", stellar, ChainKind::Stellar).0,
        "Collateral revalued — $1.000000/unit (PAR)"
    );

    let located = json!({
        "loan_id": "7", "lot_id": "2", "stage": "InStorage",
        "location": { "location_type": "Warehouse", "identifier": "W1", "tracking_url": "" },
    });
    let (a, d) = act("StageUpdated", located, ChainKind::Evm);
    assert_eq!(a, "Lot stage updated → InStorage");
    assert_eq!(d["location"]["identifier"], "W1");
    let (_, d) = act(
        "StageUpdated",
        json!({ "loan_id": "7", "lot_id": "2", "stage": "Sold", "location": null }),
        ChainKind::Stellar,
    );
    assert_eq!(d["location"], Value::Null);

    let (a, d) = act(
        "ControlUpdated",
        json!({ "loan_id": "7", "lot_id": "2", "control": { "kind": "Cma", "ref": "R1" } }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Lot control updated → Cma");
    assert_eq!(d["control"]["ref"], "R1");

    let (a, d) = act(
        "DocAdded",
        json!({ "loan_id": "7", "lot_id": "2", "kind": "Assay", "hash": "ab" }),
        ChainKind::Stellar,
    );
    assert_eq!(a, "Document added — Assay");
    assert_eq!(d["hash"], "ab");

    let evm = json!({ "loan_id": "7", "lot_id": "2", "old_quantity": "5000000", "new_quantity": "4000000", "reason": "shrink", "hash": "ab" });
    let (a, d) = act("QuantityAdjusted", evm, ChainKind::Evm);
    assert_eq!(a, "Quantity adjusted — 5.000000 → 4.000000");
    assert_eq!(d["reason"], "shrink");
    let stellar = json!({ "loan_id": "7", "lot_id": "2", "old_quantity": "50000000", "new_quantity": "40000000", "reason": "shrink", "hash": "ab" });
    assert_eq!(
        act("QuantityAdjusted", stellar, ChainKind::Stellar).0,
        "Quantity adjusted — 5.000000 → 4.000000"
    );

    let (a, d) = act(
        "Released",
        json!({ "loan_id": "7", "lot_id": "2", "quantity": "10000000", "reason": "Payment", "ref_hash": "ab" }),
        ChainKind::Stellar,
    );
    assert_eq!(a, "Collateral released — Payment");
    assert_eq!(d["quantity"], "1.000000");

    let (a, d) = act(
        "Liquidated",
        json!({ "loan_id": "7", "lot_id": "2", "sale_id": "4", "quantity": "3000000" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Collateral liquidated");
    assert_eq!(d["sale_id"], "4");

    let (a, d) = act(
        "MarginCall",
        json!({ "loan_id": "7", "coverage_bps": 9000, "floor_bps": 12000 }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Margin call — coverage 9000 bps vs floor 12000 bps");
    assert_eq!(d["floor_bps"], "12000");
}

#[test]
fn deal_token_factory_events_render_on_both_arms() {
    let (a, d) = act(
        "DealRegistered",
        json!({ "loan_id": "7", "debt": "0xD", "cargo": "0xC" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Deal tokens registered");
    assert_eq!(d["cargo"], "0xC");

    let evm = json!({ "loan_id": "7", "target": "9000000", "previous": "8000000", "minted": "1000000", "clawed": "0" });
    let (a, d) = act("DebtSynced", evm, ChainKind::Evm);
    assert_eq!(
        a,
        "Debt token synced — minted 1.000000, clawed back 0.000000"
    );
    assert_eq!(d["target"], "9.000000");
    let stellar = json!({ "loan_id": "7", "target": "90000000", "previous": "80000000", "minted": "10000000", "clawed": "0" });
    assert_eq!(
        act("DebtSynced", stellar, ChainKind::Stellar).0,
        "Debt token synced — minted 1.000000, clawed back 0.000000"
    );

    let (a, d) = act(
        "CargoSynced",
        json!({ "loan_id": "7", "target": "5000000", "previous": "5000000", "minted": "0", "burned": "2000000" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Cargo token synced — minted 0.000000, burned 2.000000");
    assert_eq!(d["burned"], "2.000000");
}

#[test]
fn loan_scoped_new_events_get_a_loan_scope_and_protocol_ones_do_not() {
    let rows = vec![
        log_row(
            1,
            1,
            (200, 2, 0),
            "Pledged",
            Some("7"),
            json!({ "loan_id": "7", "lot_id": "2" }),
        ),
        log_row(
            2,
            1,
            (100, 1, 0),
            "LossAbsorbed",
            None,
            json!({ "requested": "1", "pulled": "1" }),
        ),
    ];
    let resp = build_response(rows, &[EVM]);
    assert_eq!(resp.items[0].scope.label, "Loan #7");
    assert_eq!(resp.items[1].scope.label, "Protocol");
    assert_eq!(resp.items[1].scope.loan_id, None);
}

// ── AuditLog: rollover / amendment (#1532) + historical rows ────────────────

#[test]
fn rollover_and_amendment_read_nested_event_and_convert_ppm_to_bps() {
    let nested = json!({
        "loan_id": "7",
        "event": { "loan_id": "7", "new_rate": 150_000, "new_maturity_timestamp": 1_800_000_000_i64 },
        "snapshot": { "status": "Performing" },
    });
    for event in ["LoanRolledOver", "EconomicsAmended"] {
        let (_, d) = act(event, nested.clone(), ChainKind::Evm);
        assert_eq!(d["new_rate_bps"], 1500, "{event}");
        assert_eq!(d["new_maturity_timestamp"], 1_800_000_000_i64, "{event}");
        let (_, d) = act(event, nested.clone(), ChainKind::Stellar);
        assert_eq!(d["new_rate_bps"], 1500, "{event}");
    }
}

#[test]
fn rollover_with_missing_fields_renders_null() {
    let (_, d) = act("LoanRolledOver", json!({ "loan_id": "7" }), ChainKind::Evm);
    assert_eq!(d["new_rate_bps"], Value::Null);
    assert_eq!(d["new_maturity_timestamp"], Value::Null);
}

#[test]
fn historical_events_keep_rendering() {
    let (a, d) = act(
        "YieldMinted",
        json!({ "s_plusd_amount": "9000000", "treasury_amount": "1000000" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Coupon minted — $9.000000 vault + $1.000000 treasury");
    assert_eq!(d["vault"], "9.000000");
    assert_eq!(
        act("LoanCCRUpdated", json!({ "new_ccr": 120 }), ChainKind::Evm).0,
        "CCR written on-chain"
    );
    assert_eq!(
        act(
            "LoanLocationUpdated",
            json!({ "loan_id": "7" }),
            ChainKind::Evm
        )
        .0,
        "Collateral location updated"
    );
}

// ── AuditLog: OpenAPI ───────────────────────────────────────────────────────

#[test]
fn audit_log_openapi_marks_chain_id_optional_with_400_and_item_chain_id() {
    let doc = to_json(&AuditLogDoc::openapi());
    let get = &doc["paths"]["/v1/audit-log"]["get"];
    let params = get["parameters"].as_array().unwrap();
    let chain: Vec<_> = params.iter().filter(|p| p["name"] == "chain_id").collect();
    assert_eq!(chain.len(), 1);
    assert_eq!(chain[0]["required"], false);
    assert!(get["responses"]["400"].is_object());

    let item = &doc["components"]["schemas"]["AuditLogItem"];
    assert!(item["properties"]["chain_id"].is_object());
    assert!(item["required"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == "chain_id"));
}

// ── AuditLog: no-op syncs, signed amounts ───────────────────────────────────

#[test]
fn no_op_debt_and_cargo_syncs_are_dropped_from_the_feed() {
    let chains = [EVM, STELLAR];
    let rows = vec![
        log_row(
            1,
            1,
            (1, 1, 0),
            "DebtSynced",
            Some("7"),
            json!({ "loan_id": "7", "target": "5", "previous": "5", "minted": "0", "clawed": "0" }),
        ),
        log_row(
            2,
            1,
            (2, 1, 0),
            "DebtSynced",
            Some("7"),
            json!({ "loan_id": "7", "target": "5", "previous": "4", "minted": "1000000", "clawed": "0" }),
        ),
        log_row(
            3,
            1,
            (3, 1, 0),
            "CargoSynced",
            Some("7"),
            json!({ "loan_id": "7", "target": "5", "previous": "5", "minted": "0", "burned": "0" }),
        ),
        log_row(
            4,
            1,
            (4, 1, 0),
            "CargoSynced",
            Some("7"),
            json!({ "loan_id": "7", "target": "3", "previous": "5", "minted": "0", "burned": "2" }),
        ),
        log_row(
            5,
            99_000_001,
            (5, 1, 0),
            "DebtSynced",
            Some("7"),
            json!({ "loan_id": "7", "target": "50", "previous": "50", "minted": "0", "clawed": "0" }),
        ),
        log_row(
            6,
            99_000_001,
            (6, 1, 0),
            "DebtSynced",
            Some("7"),
            json!({ "loan_id": "7", "target": "50", "previous": "50", "minted": "0", "clawed": "10000000" }),
        ),
        log_row(
            7,
            99_000_001,
            (7, 1, 0),
            "CargoSynced",
            Some("7"),
            json!({ "loan_id": "7", "target": "50", "previous": "50", "minted": "0", "burned": "0" }),
        ),
        log_row(
            8,
            99_000_001,
            (8, 1, 0),
            "DebtSynced",
            Some("7"),
            json!({ "loan_id": "7" }),
        ),
    ];
    let items = build_response(rows, &chains).items;
    let kept: Vec<(i64, &str)> = items
        .iter()
        .map(|i| (i.chain_id, i.event_name.as_str()))
        .collect();
    assert_eq!(
        kept,
        [
            (99_000_001, "DebtSynced"),
            (99_000_001, "DebtSynced"),
            (1, "CargoSynced"),
            (1, "DebtSynced"),
        ]
    );
}

#[test]
fn negative_cash_amounts_put_the_sign_before_the_dollar() {
    let (a, _) = act(
        "CashCorrected",
        json!({ "original_id": "8", "entry_id": "9", "delta": "-12340000", "reason_hash": "ab" }),
        ChainKind::Evm,
    );
    assert_eq!(a, "Cash corrected — -$12.340000");
    let (a, _) = act(
        "CashRecorded",
        json!({ "reason": "Fee", "entry_id": "1", "delta": "-123400000" }),
        ChainKind::Stellar,
    );
    assert_eq!(a, "Cash recorded — Fee -$12.340000");
}
