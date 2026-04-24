use std::sync::Arc;

use axum::Router;
use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod middleware;
mod routes;

pub struct AppState {
    pub kyc_repo: KycRepo,
    pub sumsub_client: SumsubClient,
    pub sumsub_settings: SumsubSettings,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let postgres_url = std::env::var("POSTGRES_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .map_err(|_| anyhow::anyhow!("POSTGRES_URL is not set"))?;

    let pool = sqlx::PgPool::connect(&postgres_url).await?;
    sqlx::migrate!("../shared/migrations").run(&pool).await?;

    let sumsub_settings = SumsubSettings::from_env()?;
    let sumsub_client = SumsubClient::new(sumsub_settings.clone());
    let kyc_repo = KycRepo::new(pool.clone());

    let state = Arc::new(AppState {
        kyc_repo,
        sumsub_client,
        sumsub_settings,
    });

    let app = Router::new()
        .nest("/v1/kyc", routes::kyc::router())
        .merge(
            SwaggerUi::new("/swagger")
                .url("/api-docs/openapi.json", routes::kyc::ApiDoc::openapi()),
        )
        .with_state(state);

    let port = std::env::var("API_PORT").unwrap_or_else(|_| "8080".to_owned());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("API listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
