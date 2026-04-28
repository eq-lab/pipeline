use pipeline_worker::indexer::config::IndexerJobSettings;
use pipeline_worker::indexer::run_job;
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

    let job_names: Vec<String> = std::env::var("ENABLED_JOB_NAMES")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();

    for name in &job_names {
        let prefix = format!("JOB_{}_", name.to_uppercase());
        let job_type = std::env::var(format!("{prefix}TYPE"))
            .map_err(|_| anyhow::anyhow!("{prefix}TYPE is not set"))?;

        match job_type.to_lowercase().as_str() {
            "transfer" | "withdrawal_queue" => {
                let settings = IndexerJobSettings::from_env(name)?;
                tracing::info!(job = %name, chain_id = settings.chain_id, "indexer job started");
                tokio::spawn(run_job(settings, pool.clone()));
            }
            "kyc_outbox" => {
                let settings = KycOutboxJobSettings::from_env(name);
                let sumsub_settings = SumsubSettings::from_env()?;
                let sumsub_client = Arc::new(SumsubClient::new(sumsub_settings));
                let kyc_repo = Arc::new(KycRepo::new(pool.clone()));

                tracing::info!(job = %name, "kyc outbox job started");
                let job_name = name.clone();
                tokio::spawn(async move {
                    if let Err(e) = run_kyc_outbox_job(settings, kyc_repo, sumsub_client).await {
                        tracing::error!(job = %job_name, "kyc outbox job exited with error: {e:?}");
                    }
                });
            }
            other => {
                anyhow::bail!("{prefix}TYPE must be 'transfer', 'withdrawal_queue', or 'kyc_outbox', got '{other}'");
            }
        }
    }

    tokio::signal::ctrl_c().await?;
    Ok(())
}
