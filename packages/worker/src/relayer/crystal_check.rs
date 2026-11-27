use chrono::Utc;
use shared::crystal::client::CrystalClient;
use shared::crystal::config::CrystalSettings;
use shared::crystal::models::CrystalResponse;
use shared::kyc_repo::{KycRepo, KytTransferResult, UnverifiedTransfer, KYT_FAILED};

const BATCH_SIZE: i64 = 100;

/// Phase 2: Crystal Intelligence KYT/AML risk screening.
///
/// Sub-task 2a: one-time address screening for new profiles.
/// Sub-task 2b: deposit transaction screening + withdrawal address screening.
pub async fn phase_check_crystal(crystal: &CrystalClient, kyc_repo: &KycRepo, chain_id: i64) {
    screen_addresses(crystal, kyc_repo, chain_id).await;
    screen_events(crystal, kyc_repo).await;
}

pub async fn screen_profile(
    crystal: &CrystalClient,
    wallet: &str,
) -> anyhow::Result<(f32, serde_json::Value, bool)> {
    let resp = crystal.screen_address(wallet).await?;
    if resp.data.is_none() {
        tracing::info!(
            wallet,
            "Crystal returned no data (address has no on-chain history), treating as clean"
        );
    }
    Ok(address_verdict(crystal.settings(), &resp)?)
}

fn address_verdict(
    settings: &CrystalSettings,
    resp: &CrystalResponse,
) -> serde_json::Result<(f32, serde_json::Value, bool)> {
    let (riskscore, signals) = match resp.data.as_ref() {
        Some(data) => (
            data.counterparty.riskscore.unwrap_or(0.0),
            data.counterparty.signals.as_ref(),
        ),
        None => (0.0, None),
    };
    Ok((
        riskscore as f32,
        serde_json::to_value(signals)?,
        settings.is_risky_address(riskscore, signals),
    ))
}

fn tx_verdict(
    settings: &CrystalSettings,
    resp: &CrystalResponse,
) -> serde_json::Result<(f32, serde_json::Value, bool)> {
    let (riskscore, signals) = match resp.data.as_ref() {
        Some(data) => (
            data.counterparty.riskscore.unwrap_or(0.0),
            data.signals.as_ref(),
        ),
        None => (0.0, None),
    };
    Ok((
        riskscore as f32,
        serde_json::to_value(signals)?,
        settings.is_risky_tx(riskscore, signals),
    ))
}

/// 2a: Screen addresses that have never been checked by Crystal (for the given chain).
async fn screen_addresses(crystal: &CrystalClient, kyc_repo: &KycRepo, chain_id: i64) {
    let profiles = match kyc_repo
        .fetch_unscreened_profiles(chain_id, BATCH_SIZE)
        .await
    {
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
        let (risk, signals_json, is_risky) =
            match screen_profile(crystal, &profile.wallet_address).await {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(
                        wallet = profile.wallet_address,
                        error = %e,
                        "Crystal address screening failed, will retry next iteration"
                    );
                    continue;
                }
            };
        let screened_at = Utc::now();

        if let Err(e) = kyc_repo
            .set_kyt_address_risk(
                chain_id,
                &profile.wallet_address,
                risk,
                &signals_json,
                screened_at,
            )
            .await
        {
            tracing::error!(wallet = profile.wallet_address, error = %e, "failed to store Crystal address risk");
            continue;
        }

        if is_risky {
            tracing::warn!(
                wallet = profile.wallet_address,
                risk_score = risk,
                "Crystal address screening failed — marking profile"
            );
            if let Err(e) = kyc_repo
                .set_profile_kyt_failed(chain_id, &profile.wallet_address)
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
            if let Err(e) = kyc_repo
                .set_profile_kyt_clear(chain_id, &profile.wallet_address)
                .await
            {
                tracing::error!(wallet = profile.wallet_address, error = %e, "failed to set profile kyt_status");
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

pub async fn screen_transfer(
    crystal: &CrystalClient,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<KytTransferResult> {
    let sender = transfer.sender.as_deref().ok_or_else(|| {
        anyhow::anyhow!(
            "{} {} has no sender address",
            transfer.event_name,
            transfer.id
        )
    })?;
    let deposit = transfer.event_name == "DepositRequested";
    let (risk, signals, risky) = if deposit {
        let resp = crystal
            .screen_transaction("deposit", &transfer.tx_hash, sender)
            .await?;
        tx_verdict(crystal.settings(), &resp)?
    } else {
        let resp = crystal.screen_address(sender).await?;
        address_verdict(crystal.settings(), &resp)?
    };
    Ok(KytTransferResult::screened(deposit, risky, risk, signals))
}

async fn screen_single_event(
    crystal: &CrystalClient,
    kyc_repo: &KycRepo,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<()> {
    let result = screen_transfer(crystal, transfer).await?;
    kyc_repo
        .set_transfer_kyt_result(transfer.id, &result)
        .await?;

    if result.kyt_status == KYT_FAILED {
        let sender = transfer.sender.as_deref().unwrap_or_default();
        tracing::warn!(
            log_id = transfer.id,
            sender,
            tx_hash = transfer.tx_hash,
            event = transfer.event_name,
            "Crystal transfer screening failed — marking sender profile"
        );
        // lp_profiles stores EVM addresses lowercased; the raw event field may not be.
        if let Err(e) = kyc_repo
            .set_profile_kyt_failed(transfer.chain_id, &sender.to_lowercase())
            .await
        {
            tracing::error!(sender, error = %e, "failed to set profile kyt_status");
        }
    }

    Ok(())
}
