use chrono::Utc;
use shared::crystal::client::CrystalClient;
use shared::kyc_repo::{KycRepo, UnverifiedTransfer};

/// KYT status values for contract_logs.kyt_status and lp_profiles.kyt_status
const KYT_CLEAR: i16 = 1;
const KYT_FAILED: i16 = 2;

const BATCH_SIZE: i64 = 100;

/// Phase 2: Crystal Intelligence KYT/AML risk screening.
///
/// Sub-task 2a: one-time address screening for new profiles.
/// Sub-task 2b: transaction + sender screening for unverified transfers.
pub async fn phase_check_crystal(crystal: &CrystalClient, kyc_repo: &KycRepo) {
    screen_addresses(crystal, kyc_repo).await;
    screen_transfers(crystal, kyc_repo).await;
}

/// 2a: Screen addresses that have never been checked by Crystal.
async fn screen_addresses(crystal: &CrystalClient, kyc_repo: &KycRepo) {
    let profiles = match kyc_repo.fetch_unscreened_profiles(BATCH_SIZE).await {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch unscreened profiles");
            return;
        }
    };

    if !profiles.is_empty() {
        tracing::info!(count = profiles.len(), "screening addresses via Crystal");
    }

    for profile in &profiles {
        let resp = match crystal.screen_address(&profile.wallet_address).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(
                    wallet = profile.wallet_address,
                    error = %e,
                    "Crystal address screening failed, will retry next iteration"
                );
                continue;
            }
        };

        let (riskscore, signals_ref) = match resp.data.as_ref() {
            Some(data) => {
                let cp = &data.counterparty;
                (cp.riskscore.unwrap_or(0.0), cp.signals.as_ref())
            }
            None => {
                tracing::info!(
                    wallet = profile.wallet_address,
                    "Crystal returned no data (address has no on-chain history), treating as clean"
                );
                (0.0, None)
            }
        };

        let risk = riskscore as f32;
        let signals_json = match serde_json::to_value(signals_ref) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(wallet = profile.wallet_address, error = %e, "failed to serialize Crystal signals");
                continue;
            }
        };
        let screened_at = Utc::now();

        if let Err(e) = kyc_repo
            .set_crystal_address_risk(&profile.wallet_address, risk, &signals_json, screened_at)
            .await
        {
            tracing::error!(wallet = profile.wallet_address, error = %e, "failed to store Crystal address risk");
            continue;
        }

        let is_risky = crystal.settings().is_risky_address(riskscore, signals_ref);
        if is_risky {
            tracing::warn!(
                wallet = profile.wallet_address,
                risk_score = risk,
                "Crystal address screening failed — marking profile"
            );
            if let Err(e) = kyc_repo
                .set_profile_kyt_failed(&profile.wallet_address)
                .await
            {
                tracing::error!(wallet = profile.wallet_address, error = %e, "failed to set profile kyt_status");
            }
        } else {
            tracing::info!(
                wallet = profile.wallet_address,
                risk_score = risk,
                "Crystal address screening passed"
            );
        }
    }
}

/// 2b: Screen unverified Transfer and WithdrawalRequested transactions via Crystal.
async fn screen_transfers(crystal: &CrystalClient, kyc_repo: &KycRepo) {
    let transfers = match kyc_repo.fetch_unverified_transfers(BATCH_SIZE).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch unverified transfers");
            return;
        }
    };

    if !transfers.is_empty() {
        tracing::info!(count = transfers.len(), "screening transfers via Crystal");
    }

    for transfer in &transfers {
        match screen_single_transfer(crystal, kyc_repo, transfer).await {
            Ok(()) => {}
            Err(e) => {
                tracing::warn!(
                    log_id = transfer.id,
                    tx_hash = transfer.tx_hash,
                    error = %e,
                    "Crystal transfer screening failed, will retry next iteration"
                );
            }
        }
    }
}

async fn screen_single_transfer(
    crystal: &CrystalClient,
    kyc_repo: &KycRepo,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<()> {
    // Transfer events are deposits (address = receiver);
    // WithdrawalRequested are withdrawals (address = sender).
    let (direction, tx_address) = if transfer.event_name == "Transfer" {
        let receiver = transfer
            .receiver
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("Transfer {} has no receiver address", transfer.id))?;
        ("deposit", receiver)
    } else {
        let sender = transfer.sender.as_deref().ok_or_else(|| {
            anyhow::anyhow!("WithdrawalRequested {} has no sender address", transfer.id)
        })?;
        ("withdrawal", sender)
    };

    // Screen the transaction
    let tx_resp = crystal
        .screen_transaction(direction, &transfer.tx_hash, tx_address)
        .await?;
    let tx_data = tx_resp
        .data
        .ok_or_else(|| anyhow::anyhow!("Crystal returned no data for tx {}", transfer.tx_hash))?;
    let tx_riskscore = tx_data.counterparty.riskscore.unwrap_or(0.0);
    let tx_risk = tx_riskscore as f32;
    let tx_signals = serde_json::to_value(&tx_data.signals)?;
    let tx_risky = crystal
        .settings()
        .is_risky_tx(tx_riskscore, tx_data.signals.as_ref());

    // Screen the sender address (Transfer events only; WithdrawalRequested uses tx hash only)
    let (sender_risk, sender_signals, sender_risky) = if transfer.event_name == "Transfer" {
        if let Some(ref sender) = transfer.sender {
            let addr_resp = crystal.screen_address(sender).await?;
            let (rs, sig_ref) = match addr_resp.data.as_ref() {
                Some(data) => {
                    let cp = &data.counterparty;
                    (cp.riskscore.unwrap_or(0.0), cp.signals.as_ref())
                }
                None => (0.0, None),
            };
            let risk = rs as f32;
            let signals = serde_json::to_value(sig_ref)?;
            let risky = crystal.settings().is_risky_address(rs, sig_ref);
            (Some(risk), Some(signals), risky)
        } else {
            (None, None, false)
        }
    } else {
        (None, None, false)
    };

    let screened_at = Utc::now();

    // Store Crystal response details on contract_logs
    if let Err(e) = kyc_repo
        .set_transfer_crystal_result(
            transfer.id,
            Some(tx_risk),
            Some(&tx_signals),
            sender_risk,
            sender_signals.as_ref(),
            screened_at,
        )
        .await
    {
        tracing::error!(log_id = transfer.id, error = %e, "failed to store Crystal transfer result");
    }

    let failed = tx_risky || sender_risky;
    let status = if failed { KYT_FAILED } else { KYT_CLEAR };

    kyc_repo
        .set_transfer_kyt_status(transfer.id, status)
        .await?;

    if failed {
        if let Some(ref sender) = transfer.sender {
            tracing::warn!(
                log_id = transfer.id,
                sender = sender,
                tx_hash = transfer.tx_hash,
                tx_risk = tx_risk,
                sender_risk = sender_risk,
                "Crystal transfer screening failed — marking sender profile"
            );
            if let Err(e) = kyc_repo.set_profile_kyt_failed(sender).await {
                tracing::error!(sender = sender, error = %e, "failed to set profile kyt_status");
            }
        }
    }

    Ok(())
}
