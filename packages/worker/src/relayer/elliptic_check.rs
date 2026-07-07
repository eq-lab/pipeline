use chrono::Utc;
use shared::elliptic::client::EllipticClient;
use shared::kyc_repo::{KycRepo, KytTransferResult, UnverifiedTransfer};

// KYT status values shared with the whitelist gate.
const KYT_CLEAR: i16 = 1;
const KYT_FAILED: i16 = 2;
const BATCH_SIZE: i64 = 100;

/// Stellar Phase 2: Elliptic KYT/AML screening.
///   2a: one-time wallet_exposure screening for new profiles.
///   2b: deposit transaction screening + withdrawal address screening.
pub async fn phase_check_elliptic(elliptic: &EllipticClient, kyc_repo: &KycRepo, chain_id: i64) {
    screen_addresses(elliptic, kyc_repo, chain_id).await;
    screen_events(elliptic, kyc_repo, chain_id).await;
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
        let resp = match elliptic.screen_wallet(&profile.wallet_address).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(wallet = profile.wallet_address, error = %e,
                    "Elliptic address screening failed, will retry next iteration");
                continue;
            }
        };
        let risk = resp.risk_score.unwrap_or(0.0) as f32;
        // evaluation_detail is already a JSON value; store it verbatim as the audit signals.
        let signals_json = resp.evaluation_detail.clone();
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

        let setter = if elliptic.settings().is_risky(&resp) {
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

async fn screen_single_event(
    elliptic: &EllipticClient,
    kyc_repo: &KycRepo,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<()> {
    let chain_id = transfer.chain_id;
    // Stellar addresses are case-sensitive Strkeys — do NOT lowercase.
    let addr = transfer
        .sender
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("{} {} has no address", transfer.event_name, transfer.id))?;

    // Deposit → transaction (source_of_funds) screening; store on the tx_* fields.
    // Withdrawal → wallet_exposure address screening; store on the sender_* fields.
    // Mirrors crystal_check.rs::screen_single_event, minus the EVM lowercasing.
    let risky = if transfer.event_name == "DepositRequested" {
        let resp = elliptic
            .screen_transaction(&transfer.tx_hash, addr, addr)
            .await?;
        let tx_risk = resp.risk_score.unwrap_or(0.0) as f32;
        let tx_signals = resp.evaluation_detail.clone();
        let risky = elliptic.settings().is_risky(&resp);
        kyc_repo
            .set_transfer_kyt_result(
                transfer.id,
                &KytTransferResult {
                    kyt_status: if risky { KYT_FAILED } else { KYT_CLEAR },
                    tx_risk: Some(tx_risk),
                    tx_signals: Some(&tx_signals),
                    sender_risk: None,
                    sender_signals: None,
                    screened_at: Utc::now(),
                },
            )
            .await?;
        risky
    } else {
        let resp = elliptic.screen_wallet(addr).await?;
        let risk = resp.risk_score.unwrap_or(0.0) as f32;
        let signals = resp.evaluation_detail.clone();
        let risky = elliptic.settings().is_risky(&resp);
        kyc_repo
            .set_transfer_kyt_result(
                transfer.id,
                &KytTransferResult {
                    kyt_status: if risky { KYT_FAILED } else { KYT_CLEAR },
                    tx_risk: None,
                    tx_signals: None,
                    sender_risk: Some(risk),
                    sender_signals: Some(&signals),
                    screened_at: Utc::now(),
                },
            )
            .await?;
        risky
    };

    if risky {
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
