use chrono::Utc;
use shared::elliptic::client::EllipticClient;
use shared::elliptic::config::EllipticSettings;
use shared::elliptic::models::EllipticResponse;
use shared::kyc_repo::{KycRepo, KytTransferResult, UnverifiedTransfer, KYT_FAILED};

const BATCH_SIZE: i64 = 100;

/// Stellar Phase 2: Elliptic KYT/AML screening.
///   2a: one-time wallet_exposure screening for new profiles.
///   2b: deposit transaction screening + withdrawal address screening.
pub async fn phase_check_elliptic(elliptic: &EllipticClient, kyc_repo: &KycRepo, chain_id: i64) {
    screen_addresses(elliptic, kyc_repo, chain_id).await;
    screen_events(elliptic, kyc_repo, chain_id).await;
}

fn verdict(settings: &EllipticSettings, resp: &EllipticResponse) -> (f32, serde_json::Value, bool) {
    // evaluation_detail is already a JSON value; store it verbatim as the audit signals.
    (
        resp.risk_score.unwrap_or(0.0) as f32,
        resp.evaluation_detail.clone(),
        settings.is_risky(resp),
    )
}

pub async fn screen_profile(
    elliptic: &EllipticClient,
    wallet: &str,
) -> anyhow::Result<(f32, serde_json::Value, bool)> {
    let resp = elliptic.screen_wallet(wallet).await?;
    Ok(verdict(elliptic.settings(), &resp))
}

async fn screen_addresses(elliptic: &EllipticClient, kyc_repo: &KycRepo, chain_id: i64) {
    let profiles = match kyc_repo
        .fetch_unscreened_profiles(chain_id, BATCH_SIZE)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "elliptic: failed to fetch unscreened profiles");
            return;
        }
    };
    if !profiles.is_empty() {
        tracing::info!(count = profiles.len(), "screening addresses via Elliptic");
    }

    for profile in &profiles {
        let (risk, signals_json, is_risky) =
            match screen_profile(elliptic, &profile.wallet_address).await {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(wallet = profile.wallet_address, error = %e,
                    "Elliptic address screening failed, will retry next iteration");
                    continue;
                }
            };
        if let Err(e) = kyc_repo
            .set_kyt_address_risk(
                chain_id,
                &profile.wallet_address,
                risk,
                &signals_json,
                Utc::now(),
            )
            .await
        {
            tracing::error!(wallet = profile.wallet_address, error = %e, "store address risk failed");
            continue;
        }

        let setter = if is_risky {
            tracing::warn!(
                wallet = profile.wallet_address,
                risk,
                "Elliptic address screening failed"
            );
            kyc_repo
                .set_profile_kyt_failed(chain_id, &profile.wallet_address)
                .await
        } else {
            kyc_repo
                .set_profile_kyt_clear(chain_id, &profile.wallet_address)
                .await
        };
        if let Err(e) = setter {
            tracing::error!(wallet = profile.wallet_address, error = %e, "set kyt_status failed");
        }
    }
}

async fn screen_events(elliptic: &EllipticClient, kyc_repo: &KycRepo, chain_id: i64) {
    let transfers = match kyc_repo
        .fetch_unverified_transfers_for_chain(chain_id, BATCH_SIZE)
        .await
    {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "elliptic: failed to fetch unverified events");
            return;
        }
    };
    if !transfers.is_empty() {
        tracing::info!(count = transfers.len(), "screening events via Elliptic");
    }
    for transfer in &transfers {
        if let Err(e) = screen_single_event(elliptic, kyc_repo, transfer).await {
            tracing::warn!(log_id = transfer.id, tx_hash = transfer.tx_hash, error = %e,
                "Elliptic event screening failed, will retry next iteration");
        }
    }
}

pub async fn screen_transfer(
    elliptic: &EllipticClient,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<KytTransferResult> {
    // Stellar addresses are case-sensitive Strkeys — do NOT lowercase.
    let addr = transfer
        .sender
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("{} {} has no address", transfer.event_name, transfer.id))?;

    // Deposit → transaction (source_of_funds) screening; store on the tx_* fields.
    // Withdrawal → wallet_exposure address screening; store on the sender_* fields.
    let deposit = transfer.event_name == "DepositRequested";
    let resp = if deposit {
        elliptic
            .screen_transaction(&transfer.tx_hash, addr, addr)
            .await?
    } else {
        elliptic.screen_wallet(addr).await?
    };
    let (risk, signals, risky) = verdict(elliptic.settings(), &resp);
    Ok(KytTransferResult::screened(deposit, risky, risk, signals))
}

async fn screen_single_event(
    elliptic: &EllipticClient,
    kyc_repo: &KycRepo,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<()> {
    let chain_id = transfer.chain_id;
    let result = screen_transfer(elliptic, transfer).await?;
    kyc_repo
        .set_transfer_kyt_result(transfer.id, &result)
        .await?;

    if result.kyt_status == KYT_FAILED {
        let addr = transfer.sender.as_deref().unwrap_or_default();
        tracing::warn!(
            log_id = transfer.id,
            address = addr,
            "Elliptic screening failed — marking profile"
        );
        if let Err(e) = kyc_repo.set_profile_kyt_failed(chain_id, addr).await {
            tracing::error!(address = addr, error = %e, "set profile kyt_status failed");
        }
    }
    Ok(())
}
