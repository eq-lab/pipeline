use std::sync::Arc;

use alloy::signers::local::PrivateKeySigner;
use axum::Router;
use pipeline_api::AppState;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::eip712::Eip712Domain;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;
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

    let chain_id: i64 = std::env::var("API_CHAIN_ID")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);

    let (sumsub_client, sumsub_settings) = match sumsub {
        Some((client, settings)) => (Some(client), Some(settings)),
        None => (None, None),
    };

    // Voucher signing config (optional — endpoints return 503 if not configured)
    let (voucher_signer, dm_domain, wq_domain) = if let Ok(key) = std::env::var("API_SIGNER_KEY") {
        let signer: PrivateKeySigner = key
            .parse()
            .expect("API_SIGNER_KEY must be a valid private key");
        tracing::info!(address = %signer.address(), "voucher signer loaded");

        let chain_id: u64 = std::env::var("API_CHAIN_ID")
            .expect("API_CHAIN_ID required when API_SIGNER_KEY is set")
            .parse()
            .expect("API_CHAIN_ID must be a valid integer");

        let dm_addr = std::env::var("API_DM_ADDRESS")
            .expect("API_DM_ADDRESS required when API_SIGNER_KEY is set")
            .parse()
            .expect("API_DM_ADDRESS must be a valid address");

        let wq_addr = std::env::var("API_WQ_ADDRESS")
            .expect("API_WQ_ADDRESS required when API_SIGNER_KEY is set")
            .parse()
            .expect("API_WQ_ADDRESS must be a valid address");

        let dm_domain = Eip712Domain {
            name: "PipelineDepositManager".to_owned(),
            version: "v1".to_owned(),
            chain_id,
            verifying_contract: dm_addr,
        };
        let wq_domain = Eip712Domain {
            name: "PipelineWithdrawalQueue".to_owned(),
            version: "v1".to_owned(),
            chain_id,
            verifying_contract: wq_addr,
        };

        (Some(signer), Some(dm_domain), Some(wq_domain))
    } else {
        tracing::warn!("API_SIGNER_KEY not set, voucher endpoints will return 503");
        (None, None, None)
    };

    let crystal_enabled = std::env::var("CRYSTAL_ENABLED")
        .ok()
        .is_none_or(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"));

    let state = Arc::new(AppState {
        pool: pool.clone(),
        kyc_repo,
        position_repo,
        contract_logs_repo,
        chain_id,
        sumsub_client,
        sumsub_settings,
        voucher_signer,
        dm_domain,
        wq_domain,
        crystal_enabled,
    });

    let mut api_docs = pipeline_api::routes::kyc::ApiDoc::openapi();
    api_docs.merge(pipeline_api::routes::emails::EmailsDoc::openapi());
    api_docs.merge(pipeline_api::routes::vouchers::VouchersDoc::openapi());
    api_docs.merge(pipeline_api::routes::analytics::AnalyticsDoc::openapi());
    api_docs.merge(pipeline_api::routes::pnl::PnlDoc::openapi());
    api_docs.merge(pipeline_api::routes::stats::StatsDoc::openapi());
    api_docs.merge(pipeline_api::routes::portfolio::YieldDoc::openapi());

    let app = Router::new()
        .nest("/v1/emails", pipeline_api::routes::emails::router())
        .nest("/v1/kyc", pipeline_api::routes::kyc::router())
        .nest("/v1", pipeline_api::routes::vouchers::router())
        .nest("/v1", pipeline_api::routes::analytics::router())
        .nest("/v1", pipeline_api::routes::pnl::router())
        .nest("/v1", pipeline_api::routes::stats::router())
        .nest("/v1", pipeline_api::routes::portfolio::router())
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
