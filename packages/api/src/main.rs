use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use pipeline_api::auth::JwtKeys;
use pipeline_api::config::{ipfs_gateway_url_from_env, ChainsConfig};
use pipeline_api::AppState;
use shared::auth_user_repo::AuthUserRepo;
use shared::collateral_valuation_repo::CollateralValuationRepo;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::kyc_repo::KycRepo;
use shared::loan_asset_price_repo::LoanAssetPriceRepo;
use shared::loan_capital_transfers_repo::LoanCapitalTransfersRepo;
use shared::loan_disbursement_repo::LoanDisbursementRepo;
use shared::loan_fee_schedule_repo::LoanFeeScheduleRepo;
use shared::loan_metadata::HttpLoanMetadataFetcher;
use shared::metadata_fetcher::MetadataFetcher;
use shared::position_repo::PositionRepo;
use shared::submitted_loan_repo::SubmittedLoanRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;
use tower_http::cors::CorsLayer;
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let postgres_url = std::env::var("POSTGRES_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .map_err(|_| anyhow::anyhow!("POSTGRES_URL is not set"))?;

    let pool = sqlx::PgPool::connect(&postgres_url).await?;
    sqlx::migrate!("../shared/migrations").run(&pool).await?;

    let sumsub = match SumsubSettings::from_env() {
        Ok(settings) => {
            let client = SumsubClient::new(settings.clone());
            Some((client, settings))
        }
        Err(e) => {
            tracing::warn!("Sumsub not configured, KYC endpoints will be unavailable: {e}");
            None
        }
    };
    let kyc_repo = KycRepo::new(pool.clone());
    let position_repo = PositionRepo::new(pool.clone());
    let contract_logs_repo = ContractLogsRepo::new(pool.clone());
    let auth_user_repo = AuthUserRepo::new(pool.clone());
    let submitted_loan_repo = SubmittedLoanRepo::new(pool.clone());
    let loan_fee_schedule_repo = LoanFeeScheduleRepo::new(pool.clone());
    let loan_asset_price_repo = LoanAssetPriceRepo::new(pool.clone());
    let collateral_valuation_repo = CollateralValuationRepo::new(pool.clone());
    let loan_disbursement_repo = LoanDisbursementRepo::new(pool.clone());
    let loan_capital_transfers_repo = LoanCapitalTransfersRepo::new(pool.clone());

    // Loan-metadata fetcher for `submit_loan`'s `metadata_uri` validation. Single
    // attempt (no retry backoff) — this is a synchronous write path, so a dead URI
    // must fail fast rather than block the request for the default ~36s of retries;
    // the submitter can retry.
    let loan_metadata_fetcher = Arc::new(HttpLoanMetadataFetcher::new(
        MetadataFetcher::new(reqwest::Client::new(), ipfs_gateway_url_from_env())
            .with_backoffs(vec![]),
    ));

    // JWT keys are optional — when unset the auth endpoints are unavailable but
    // the rest of the API still boots (mirrors the Sumsub / per-chain handling).
    let jwt_keys = JwtKeys::from_env()?;

    // Parse multi-chain config (CHAINS, DEFAULT_CHAIN_ID, per-chain signer keys).
    let chains_config = ChainsConfig::from_env()?;

    let (sumsub_client, sumsub_settings) = match sumsub {
        Some((client, settings)) => (Some(client), Some(settings)),
        None => (None, None),
    };

    // Decompose per-chain EVM voucher config into separate maps for AppState.
    let mut voucher_signers = HashMap::new();
    let mut dm_domains = HashMap::new();
    let mut wq_domains = HashMap::new();
    for (chain_id, vcfg) in chains_config.voucher {
        voucher_signers.insert(chain_id, vcfg.signer);
        dm_domains.insert(chain_id, vcfg.dm_domain);
        wq_domains.insert(chain_id, vcfg.wq_domain);
    }
    // Stellar voucher config maps directly — one entry per configured Stellar chain.
    let stellar_voucher_signers = chains_config.stellar_voucher;
    // Custody/ramp address sets for the capital-allocation in_transit bucket.
    let transfer_addresses = chains_config.transfer_addresses;
    // Withdrawal Queue Wallet addresses + shared asset decimals for the
    // capital-allocation withdrawal_queue bucket.
    let withdrawal_queue_wallets = chains_config.withdrawal_queue_wallets;
    let asset_decimals = chains_config.asset_decimals;

    let crystal_enabled = std::env::var("CRYSTAL_ENABLED")
        .ok()
        .is_none_or(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"));

    // Elliptic KYT (Stellar). Defaults to false — matches the worker's ELLIPTIC_ENABLED.
    let elliptic_enabled = std::env::var("ELLIPTIC_ENABLED")
        .ok()
        .is_some_and(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"));

    let state = Arc::new(AppState {
        pool: pool.clone(),
        kyc_repo,
        position_repo,
        contract_logs_repo,
        default_chain_id: chains_config.default_chain_id,
        sumsub_client,
        sumsub_settings,
        voucher_signers,
        dm_domains,
        wq_domains,
        stellar_voucher_signers,
        transfer_addresses,
        withdrawal_queue_wallets,
        asset_decimals,
        crystal_enabled,
        elliptic_enabled,
        auth_user_repo,
        submitted_loan_repo,
        loan_metadata_fetcher,
        loan_fee_schedule_repo,
        loan_asset_price_repo,
        collateral_valuation_repo,
        loan_disbursement_repo,
        jwt_keys,
        loan_capital_transfers_repo,
    });

    let mut api_docs = pipeline_api::routes::kyc::ApiDoc::openapi();
    api_docs.merge(pipeline_api::routes::emails::EmailsDoc::openapi());
    api_docs.merge(pipeline_api::routes::vouchers::VouchersDoc::openapi());
    api_docs.merge(pipeline_api::routes::analytics::AnalyticsDoc::openapi());
    api_docs.merge(pipeline_api::routes::pnl::PnlDoc::openapi());
    api_docs.merge(pipeline_api::routes::stats::StatsDoc::openapi());
    api_docs.merge(pipeline_api::routes::portfolio::YieldDoc::openapi());
    api_docs.merge(pipeline_api::routes::loan_book::LoanBookDoc::openapi());
    api_docs.merge(pipeline_api::routes::financial_position::FinancialPositionDoc::openapi());
    api_docs.merge(pipeline_api::routes::capital_allocation::CapitalAllocationDoc::openapi());
    api_docs.merge(pipeline_api::routes::withdrawal_queue::WithdrawalQueueDoc::openapi());
    api_docs.merge(pipeline_api::routes::auth::AuthDoc::openapi());
    api_docs.merge(pipeline_api::routes::dashboard::DashboardDoc::openapi());
    api_docs.merge(pipeline_api::routes::collateral_valuation::CollateralValuationDoc::openapi());
    api_docs.merge(pipeline_api::routes::loan_financials::LoanFinancialsDoc::openapi());
    api_docs.merge(pipeline_api::routes::ccr_history::CcrHistoryDoc::openapi());
    api_docs.merge(pipeline_api::routes::waterfall::WaterfallDoc::openapi());
    api_docs.merge(pipeline_api::routes::loan_transfers::LoanTransfersDoc::openapi());
    api_docs.merge(pipeline_api::routes::ramp::RampDoc::openapi());
    api_docs.merge(pipeline_api::routes::audit_log::AuditLogDoc::openapi());

    let app = Router::new()
        .nest("/v1/emails", pipeline_api::routes::emails::router())
        .nest("/v1", pipeline_api::routes::auth::router())
        .nest("/v1/kyc", pipeline_api::routes::kyc::router())
        .nest("/v1", pipeline_api::routes::vouchers::router())
        .nest("/v1", pipeline_api::routes::analytics::router())
        .nest("/v1", pipeline_api::routes::pnl::router())
        .nest("/v1", pipeline_api::routes::stats::router())
        .nest("/v1", pipeline_api::routes::portfolio::router())
        .nest("/v1", pipeline_api::routes::loan_book::router())
        .nest("/v1", pipeline_api::routes::financial_position::router())
        .nest("/v1", pipeline_api::routes::capital_allocation::router())
        .nest("/v1", pipeline_api::routes::withdrawal_queue::router())
        .nest("/v1", pipeline_api::routes::dashboard::router())
        .nest("/v1", pipeline_api::routes::collateral_valuation::router())
        .nest("/v1", pipeline_api::routes::loan_financials::router())
        .nest("/v1", pipeline_api::routes::ccr_history::router())
        .nest("/v1", pipeline_api::routes::waterfall::router())
        .nest("/v1", pipeline_api::routes::loan_transfers::router())
        .nest("/v1", pipeline_api::routes::ramp::router())
        .nest("/v1", pipeline_api::routes::audit_log::router())
        .merge(SwaggerUi::new("/swagger").url("/api-docs/openapi.json", api_docs))
        .layer(CorsLayer::very_permissive())
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .with_state(state);

    let port = std::env::var("API_PORT").unwrap_or_else(|_| "8080".to_owned());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("API listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
