use shared::kyc_repo::{KycRepo, UnverifiedTransfer};

/// KYT status values for contract_logs.kyt_status and lp_profiles.kyt_status
const KYT_CLEAR: i16 = 1;
const KYT_FAILED: i16 = 2;

const KYT_BATCH_SIZE: i64 = 100;

pub async fn phase_kyt(kyc_repo: &KycRepo) {
    let transfers = match kyc_repo.fetch_unverified_transfers(KYT_BATCH_SIZE).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch unverified transfers");
            return;
        }
    };

    if !transfers.is_empty() {
        tracing::info!(count = transfers.len(), "processing KYT verification");
    }

    for transfer in &transfers {
        let result = verify_transaction(transfer).await;

        let status = if result { KYT_CLEAR } else { KYT_FAILED };

        if let Err(e) = kyc_repo.set_transfer_kyt_status(transfer.id, status).await {
            tracing::error!(log_id = transfer.id, error = %e, "failed to update transfer kyt_status");
            continue;
        }

        if !result {
            if let Some(ref sender) = transfer.sender {
                tracing::warn!(
                    log_id = transfer.id,
                    sender = sender,
                    tx_hash = transfer.tx_hash,
                    "KYT verification failed — marking sender profile"
                );
                if let Err(e) = kyc_repo.set_profile_kyt_failed(sender).await {
                    tracing::error!(sender = sender, error = %e, "failed to set profile kyt_status");
                }
            }
        }
    }
}

/// Verifies a transfer against external KYT/AML service.
///
/// TODO: integrate with external KYT/AML service (provider TBD).
/// TODO: add a new column in contract_logs to store the detailed AML verification result.
async fn verify_transaction(_transfer: &UnverifiedTransfer) -> bool {
    // For now, all transfers pass verification.
    // When the external service is integrated, this function will:
    // 1. Call the KYT provider API with the transaction details
    // 2. Parse the risk score / verdict
    // 3. Return false if the transaction fails AML checks
    true
}
