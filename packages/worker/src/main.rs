use pipeline_worker::indexer::config::{env_bool, IndexerSettings};
use pipeline_worker::indexer::run_indexer_job;
use pipeline_worker::indexer::stellar::run_stellar_indexer_job;
use pipeline_worker::kyc::config::KycOutboxJobSettings;
use pipeline_worker::kyc::kyc_outbox::run_kyc_outbox_job;
use pipeline_worker::price_poller::config::PricePollerSettings;
use pipeline_worker::price_poller::run_price_poller_job;
use pipeline_worker::relayer::config::RelayerJobSettings;
use pipeline_worker::relayer::relayer_job::run_relayer_job;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;
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
        let settings_per_chain = IndexerSettings::all_from_env()?;
        for s in settings_per_chain {
            let pool = pool.clone();
            match s {
                IndexerSettings::Evm(s) => {
                    tracing::info!(
                        chain_id = s.chain_id,
                        chain_type = "evm",
                        "indexer job started"
                    );
                    tokio::spawn(async move {
                        if let Err(e) = run_indexer_job(s, pool).await {
                            tracing::error!("evm indexer exited: {e:?}");
                        }
                    });
                }
                IndexerSettings::Stellar(s) => {
                    tracing::info!(
                        chain_id = s.chain_id,
                        chain_type = "stellar",
                        "indexer job started"
                    );
                    tokio::spawn(async move {
                        if let Err(e) = run_stellar_indexer_job(s, pool).await {
                            tracing::error!("stellar indexer exited: {e:?}");
                        }
                    });
                }
            }
        }
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

    if env_bool("JOB_PRICE_POLLER_ENABLED") {
        let settings_per_chain = PricePollerSettings::all_evm_from_env()?;
        let position_repo = Arc::new(PositionRepo::new(pool.clone()));

        for s in settings_per_chain {
            tracing::info!(chain_id = s.chain_id, "price poller job started");
            let repo = position_repo.clone();
            tokio::spawn(async move {
                run_price_poller_job(s, repo).await;
            });
        }
    }

    if env_bool("JOB_RELAYER_ENABLED") {
        let settings_per_chain = RelayerJobSettings::all_evm_from_env()?;

        for s in settings_per_chain {
            tracing::info!(chain_id = s.chain_id, "relayer job started");
            let kyc_repo = Arc::new(KycRepo::new(pool.clone()));
            tokio::spawn(async move {
                if let Err(e) = run_relayer_job(s, kyc_repo).await {
                    tracing::error!("relayer job exited with error: {e:?}");
                }
            });
        }
    }

    tokio::signal::ctrl_c().await?;
    Ok(())
}
