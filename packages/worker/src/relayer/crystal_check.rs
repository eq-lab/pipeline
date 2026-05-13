use chrono::Utc;
use shared::crystal::client::CrystalClient;
use shared::kyc_repo::{CrystalTransferResult, KycRepo, UnverifiedTransfer};

/// KYT status values for contract_logs.crystal_kyt_status and lp_profiles.crystal_kyt_status
const KYT_CLEAR: i16 = 1;
const KYT_FAILED: i16 = 2;

const BATCH_SIZE: i64 = 100;

/// Phase 2: Crystal Intelligence KYT/AML risk screening.
///
/// Sub-task 2a: one-time address screening for new profiles.
/// Sub-task 2b: deposit transaction screening + withdrawal address screening.
pub async fn phase_check_crystal(crystal: &CrystalClient, kyc_repo: &KycRepo) {
    screen_addresses(crystal, kyc_repo).await;
    screen_events(crystal, kyc_repo).await;
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
                tracing::error!(wallet = profile.wallet_address, error = %e, "failed to set profile crystal_kyt_status");
            }
        } else {
            tracing::info!(
                wallet = profile.wallet_address,
                risk_score = risk,
                "Crystal address screening passed"
            );
            if let Err(e) = kyc_repo
                .set_profile_kyt_clear(&profile.wallet_address)
                .await
            {
                tracing::error!(wallet = profile.wallet_address, error = %e, "failed to set profile crystal_kyt_status");
            }
        }
    }
}

/// 2b: Screen unverified DepositRequested and WithdrawalRequested events via Crystal.
async fn screen_events(crystal: &CrystalClient, kyc_repo: &KycRepo) {
    let transfers = match kyc_repo.fetch_unverified_transfers(BATCH_SIZE).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch unverified events");
            return;
        }
    };

    if !transfers.is_empty() {
        tracing::info!(count = transfers.len(), "screening events via Crystal");
    }

    for transfer in &transfers {
        match screen_single_event(crystal, kyc_repo, transfer).await {
            Ok(()) => {}
            Err(e) => {
                tracing::warn!(
                    log_id = transfer.id,
                    tx_hash = transfer.tx_hash,
                    error = %e,
                    "Crystal event screening failed, will retry next iteration"
                );
            }
        }
    }
}

async fn screen_single_event(
    crystal: &CrystalClient,
    kyc_repo: &KycRepo,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<()> {
    let sender = transfer.sender.as_deref().ok_or_else(|| {
        anyhow::anyhow!(
            "{} {} has no sender address",
            transfer.event_name,
            transfer.id
        )
    })?;

    if transfer.event_name == "DepositRequested" {
        // Deposit: Crystal deposit-type transaction screening
        let tx_resp = crystal
            .screen_transaction("deposit", &transfer.tx_hash, sender)
            .await?;

        let (tx_riskscore, tx_signals_ref) = match tx_resp.data.as_ref() {
            Some(data) => (
                data.counterparty.riskscore.unwrap_or(0.0),
                data.signals.as_ref(),
            ),
            None => (0.0, None),
        };
        let tx_risk = tx_riskscore as f32;
        let tx_signals = serde_json::to_value(tx_signals_ref)?;
        let tx_risky = crystal.settings().is_risky_tx(tx_riskscore, tx_signals_ref);

        kyc_repo
            .set_transfer_crystal_result(
                transfer.id,
                &CrystalTransferResult {
                    crystal_kyt_status: if tx_risky { KYT_FAILED } else { KYT_CLEAR },
                    tx_risk: Some(tx_risk),
                    tx_signals: Some(&tx_signals),
                    sender_risk: None,
                    sender_signals: None,
                    screened_at: Utc::now(),
                },
            )
            .await?;

        if tx_risky {
            tracing::warn!(
                log_id = transfer.id,
                sender = sender,
                tx_hash = transfer.tx_hash,
                tx_risk = tx_risk,
                "Crystal deposit screening failed — marking sender profile"
            );
            if let Err(e) = kyc_repo.set_profile_kyt_failed(sender).await {
                tracing::error!(sender = sender, error = %e, "failed to set profile crystal_kyt_status");
            }
        }
    } else {
        // WithdrawalRequested: address screening only (no tx screening per spec)
        let addr_resp = crystal.screen_address(sender).await?;
        let (riskscore, signals_ref) = match addr_resp.data.as_ref() {
            Some(data) => {
                let cp = &data.counterparty;
                (cp.riskscore.unwrap_or(0.0), cp.signals.as_ref())
            }
            None => (0.0, None),
        };
        let risk = riskscore as f32;
        let signals = serde_json::to_value(signals_ref)?;
        let risky = crystal.settings().is_risky_address(riskscore, signals_ref);

        kyc_repo
            .set_transfer_crystal_result(
                transfer.id,
                &CrystalTransferResult {
                    crystal_kyt_status: if risky { KYT_FAILED } else { KYT_CLEAR },
                    tx_risk: None,
                    tx_signals: None,
                    sender_risk: Some(risk),
                    sender_signals: Some(&signals),
                    screened_at: Utc::now(),
                },
            )
            .await?;

        if risky {
            tracing::warn!(
                log_id = transfer.id,
                sender = sender,
                "Crystal withdrawal address screening failed — marking profile"
            );
            if let Err(e) = kyc_repo.set_profile_kyt_failed(sender).await {
                tracing::error!(sender = sender, error = %e, "failed to set profile crystal_kyt_status");
            }
        }
    }

    Ok(())
}
