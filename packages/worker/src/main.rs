use pipeline_worker::indexer::config::{env_bool, IndexerJobSettings};
use pipeline_worker::indexer::run_indexer_job;
use pipeline_worker::kyc::config::KycOutboxJobSettings;
use pipeline_worker::kyc::kyc_outbox::run_kyc_outbox_job;
use pipeline_worker::relayer::config::RelayerJobSettings;
use pipeline_worker::relayer::relayer_job::run_relayer_job;
use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let postgres_url = std::env::var("POSTGRES_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .map_err(|_| anyhow::anyhow!("POSTGRES_URL is not set"))?;
    let pool = sqlx::PgPool::connect(&postgres_url).await?;

    sqlx::migrate!("../shared/migrations").run(&pool).await?;

    if env_bool("JOB_INDEXER_ENABLED") {
        let settings = IndexerJobSettings::from_env()?;
        tracing::info!(chain_id = settings.chain_id, "indexer job started");
        tokio::spawn(run_indexer_job(settings, pool.clone()));
    }

    if env_bool("JOB_KYC_ENABLED") {
        let settings = KycOutboxJobSettings::from_env();
        let sumsub_settings = SumsubSettings::from_env()?;
        let sumsub_client = Arc::new(SumsubClient::new(sumsub_settings));
        let kyc_repo = Arc::new(KycRepo::new(pool.clone()));

        tracing::info!("kyc outbox job started");
        tokio::spawn(async move {
            if let Err(e) = run_kyc_outbox_job(settings, kyc_repo, sumsub_client).await {
                tracing::error!("kyc outbox job exited with error: {e:?}");
            }
        });
    }

    if env_bool("JOB_RELAYER_ENABLED") {
        let settings = RelayerJobSettings::from_env()?;
        let kyc_repo = Arc::new(KycRepo::new(pool.clone()));
        let relayer_pool = pool.clone();

        tracing::info!("relayer job started");
        tokio::spawn(async move {
            if let Err(e) = run_relayer_job(settings, kyc_repo, relayer_pool).await {
                tracing::error!("relayer job exited with error: {e:?}");
            }
        });
    }

    tokio::signal::ctrl_c().await?;
    Ok(())
}
