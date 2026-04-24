use pipeline_worker::config::JobSettings;
use pipeline_worker::indexer::run_job;
use pipeline_worker::jobs::kyc_outbox::{run_kyc_outbox_job, KycOutboxJobSettings};
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

    let job_names: Vec<String> = std::env::var("JOB_NAMES")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();

    let mut handles = vec![];

    for name in &job_names {
        let settings = JobSettings::from_env(name)?;
        if !settings.enabled {
            tracing::info!(job = %name, "job disabled — skipping");
            continue;
        }

        tracing::info!(job = %name, chain_id = settings.chain_id, "indexer started");
        let handle = tokio::spawn(run_job(settings, pool.clone()));
        handles.push(handle);
    }

    if handles.is_empty() {
        tracing::warn!("no jobs enabled — set JOB_NAMES and JOB_<NAME>_ENABLED=true");
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
        let handle = tokio::spawn(async move {
            if let Err(e) = run_kyc_outbox_job(outbox_settings, kyc_repo, sumsub_client).await {
                tracing::error!("KYC outbox job exited with error: {e:?}");
            }
        });
        handles.push(handle);
    }

    tokio::signal::ctrl_c().await?;
    Ok(())
}
