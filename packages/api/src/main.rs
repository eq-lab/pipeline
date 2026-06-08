use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use pipeline_api::config::ChainsConfig;
use pipeline_api::AppState;
use shared::contract_logs_repo::ContractLogsRepo;
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

    // Parse multi-chain config (CHAINS, DEFAULT_CHAIN_ID, per-chain signer keys).
    let chains_config = ChainsConfig::from_env()?;

    let (sumsub_client, sumsub_settings) = match sumsub {
        Some((client, settings)) => (Some(client), Some(settings)),
        None => (None, None),
    };

    // Decompose per-chain voucher config into separate maps for AppState.
    let mut voucher_signers = HashMap::new();
    let mut dm_domains = HashMap::new();
    let mut wq_domains = HashMap::new();
    for (chain_id, vcfg) in chains_config.voucher {
        voucher_signers.insert(chain_id, vcfg.signer);
        dm_domains.insert(chain_id, vcfg.dm_domain);
        wq_domains.insert(chain_id, vcfg.wq_domain);
    }

    let crystal_enabled = std::env::var("CRYSTAL_ENABLED")
        .ok()
        .is_none_or(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"));

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
