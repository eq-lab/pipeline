use pipeline_worker::config::JobSettings;
use pipeline_worker::indexer::run_job;

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

    tokio::signal::ctrl_c().await?;
    Ok(())
}
