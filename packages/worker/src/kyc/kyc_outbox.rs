use anyhow::Result;
use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::models::KycStatus;
use std::sync::Arc;
use std::time::Duration;

pub struct KycOutboxJobSettings {
    pub interval_secs: u64,
    pub batch_size: i64,
}

impl KycOutboxJobSettings {
    pub fn from_env() -> Self {
        let interval_secs: u64 = std::env::var("JOB_KYC_OUTBOX_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        let batch_size: i64 = std::env::var("JOB_KYC_OUTBOX_BATCH_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100);
        Self {
            interval_secs,
            batch_size,
        }
    }
}

pub async fn run_kyc_outbox_job(
    settings: KycOutboxJobSettings,
    kyc_repo: Arc<KycRepo>,
    sumsub_client: Arc<SumsubClient>,
) -> Result<()> {
    tracing::info!(
        interval_secs = settings.interval_secs,
        batch_size = settings.batch_size,
        "KYC outbox job started"
    );

    loop {
        if let Err(e) = process_batch(&kyc_repo, &sumsub_client, settings.batch_size).await {
            tracing::error!("KYC outbox batch error: {e:?}");
        }
        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}

async fn process_batch(
    kyc_repo: &KycRepo,
    sumsub_client: &SumsubClient,
    batch_size: i64,
) -> Result<()> {
    let records = kyc_repo.fetch_unprocessed_outbox(batch_size).await?;
    if records.is_empty() {
        return Ok(());
    }

    tracing::info!(count = records.len(), "processing KYC outbox records");

    for record in records {
        let result = process_record(kyc_repo, sumsub_client, &record).await;
        match result {
            Ok(()) => {
                kyc_repo.mark_outbox_processed(record.id).await?;
            }
            Err(e) => {
                tracing::error!(id = record.id, error = %e, "failed to process KYC outbox record");
                kyc_repo
                    .mark_outbox_error(record.id, &format!("{e:#}"))
                    .await?;
            }
        }
    }

    Ok(())
}

async fn process_record(
    kyc_repo: &KycRepo,
    sumsub_client: &SumsubClient,
    record: &shared::kyc_repo::KycOutboxRow,
) -> Result<()> {
    let is_green = record.kyc_status == Some(KycStatus::Green as i16);
    if !is_green {
        return Ok(());
    }

    let applicant = sumsub_client
        .get_applicant_by_external_id(&record.wallet_address)
        .await?;

    if let Some(info) = &applicant.info {
        kyc_repo
            .update_lp_info(
                &record.wallet_address,
                info.first_name.as_deref(),
                info.last_name.as_deref(),
                info.country.as_deref(),
            )
            .await?;
    }

    tracing::info!(
        wallet = record.wallet_address,
        "KYC approved — applicant info updated"
    );
    Ok(())
}
