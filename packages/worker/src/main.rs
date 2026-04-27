use pipeline_worker::config::JobSettings;
use pipeline_worker::indexer::run_job;
use pipeline_worker::kyc::kyc_outbox::{run_kyc_outbox_job, KycOutboxJobSettings};
use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // initialize logging and load .env
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    // initialize DB pool
    let postgres_url = std::env::var("POSTGRES_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .map_err(|_| anyhow::anyhow!("POSTGRES_URL is not set"))?;
    let pool = sqlx::PgPool::connect(&postgres_url).await?;

    // run DB migrations
    sqlx::migrate!("../shared/migrations").run(&pool).await?;

    // indexer jobs
    let indexer_job_names: Vec<String> = std::env::var("INDEXER_JOB_NAMES")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();

    for name in &indexer_job_names {
        let settings = JobSettings::from_env(name)?;
        if !settings.enabled {
            tracing::info!(job = %name, "job disabled — skipping");
            continue;
        }

        tracing::info!(job = %name, chain_id = settings.chain_id, "indexer started");
        tokio::spawn(run_job(settings, pool.clone()));
    }

    // KYC outbox job
    let kyc_outbox_enabled = std::env::var("JOB_KYC_OUTBOX_ENABLED")
        .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);

    if kyc_outbox_enabled {
        let outbox_settings = KycOutboxJobSettings::from_env();
        let sumsub_settings = SumsubSettings::from_env()?;
        let sumsub_client = Arc::new(SumsubClient::new(sumsub_settings));
        let kyc_repo = Arc::new(KycRepo::new(pool.clone()));

        tracing::info!("KYC outbox job started");
        tokio::spawn(async move {
            if let Err(e) = run_kyc_outbox_job(outbox_settings, kyc_repo, sumsub_client).await {
                tracing::error!("KYC outbox job exited with error: {e:?}");
            }
        });
    }

    tokio::signal::ctrl_c().await?;
    Ok(())
}
