use pipeline_worker::indexer::config::{env_bool, TransferJobSettings, WqJobSettings};
use pipeline_worker::indexer::{run_transfer_job, run_wq_job};
use pipeline_worker::kyc::config::KycOutboxJobSettings;
use pipeline_worker::kyc::kyc_outbox::run_kyc_outbox_job;
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

    if env_bool("JOB_TRANSFERS_ENABLED") {
        let settings = TransferJobSettings::from_env()?;
        tracing::info!(chain_id = settings.chain_id, "transfers job started");
        tokio::spawn(run_transfer_job(settings, pool.clone()));
    }

    if env_bool("JOB_WQ_ENABLED") {
        let settings = WqJobSettings::from_env()?;
        tracing::info!(chain_id = settings.chain_id, "withdrawal queue job started");
        tokio::spawn(run_wq_job(settings, pool.clone()));
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

    tokio::signal::ctrl_c().await?;
    Ok(())
}
