mod config;
mod indexer;

use config::JobSettings;
use indexer::run_job;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

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

        let pool = sqlx::PgPool::connect(&settings.postgres_url).await?;
        sqlx::migrate!("../../crates/shared/migrations")
            .run(&pool)
            .await?;

        tracing::info!(job = %name, chain_id = settings.chain_id, "indexer started");
        let handle = tokio::spawn(run_job(settings, pool));
        handles.push(handle);
    }

    if handles.is_empty() {
        tracing::warn!("no jobs enabled — set JOB_NAMES and JOB_<NAME>_ENABLED=true");
    }

    tokio::signal::ctrl_c().await?;
    Ok(())
}
