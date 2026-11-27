// Relayer Phase 2: provider-agnostic KYT screening (2a profiles, 2b transfers).
// spec: docs/superpowers/specs/2026-07-06-elliptic-stellar-kyt-design.md
use chrono::Utc;
use shared::kyc_repo::{KycRepo, KytTransferResult, UnverifiedTransfer, KYT_FAILED};
use shared::kyt::{KytProvider, KytVerdict};

const BATCH_SIZE: i64 = 100;

pub async fn phase_check_kyt<P: KytProvider>(
    provider: &P,
    kyc_repo: &KycRepo,
    chain_id: i64,
    backlog_warn_secs: i64,
) {
    screen_addresses(provider, kyc_repo, chain_id).await;
    screen_events(provider, kyc_repo, chain_id).await;
    report_backlog(provider.name(), kyc_repo, chain_id, backlog_warn_secs).await;
}

pub fn backlog_age_secs(oldest_ts: Option<i64>, now_ts: i64) -> i64 {
    oldest_ts.map_or(0, |ts| (now_ts - ts).max(0))
}

pub fn error_class(e: &anyhow::Error) -> &'static str {
    if e.downcast_ref::<sqlx::Error>().is_some() {
        return "db";
    }
    match e.downcast_ref::<reqwest::Error>() {
        Some(r) if r.is_timeout() => "timeout",
        Some(r) if r.is_connect() => "connect",
        Some(r) if r.is_decode() => "decode",
        Some(_) => "request",
        None => "provider",
    }
}

async fn report_backlog(provider: &str, kyc_repo: &KycRepo, chain_id: i64, warn_secs: i64) {
    let b = match kyc_repo.kyt_backlog(chain_id).await {
        Ok(b) => b,
        Err(e) => {
            tracing::error!(provider, chain_id, error = %e, "failed to read kyt backlog");
            return;
        }
    };
    let now = Utc::now().timestamp();
    let transfer_age = backlog_age_secs(b.oldest_transfer_ts, now);
    let profile_age = backlog_age_secs(b.oldest_profile_ts, now);
    if transfer_age.max(profile_age) > warn_secs {
        tracing::warn!(
            provider,
            chain_id,
            unscreened_transfers = b.transfers,
            oldest_transfer_age_secs = transfer_age,
            unscreened_profiles = b.profiles,
            oldest_profile_age_secs = profile_age,
            threshold_secs = warn_secs,
            "kyt backlog over threshold"
        );
    } else {
        tracing::info!(
            provider,
            chain_id,
            unscreened_transfers = b.transfers,
            oldest_transfer_age_secs = transfer_age,
            unscreened_profiles = b.profiles,
            oldest_profile_age_secs = profile_age,
            "kyt backlog"
        );
    }
}

pub async fn screen_profile<P: KytProvider>(
    provider: &P,
    wallet: &str,
) -> anyhow::Result<KytVerdict> {
    provider.address_verdict(wallet).await
}

pub async fn screen_transfer<P: KytProvider>(
    provider: &P,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<KytTransferResult> {
    let sender = transfer.sender.as_deref().ok_or_else(|| {
        anyhow::anyhow!(
            "{} {} has no sender address, so it has no address to screen",
            transfer.event_name,
            transfer.id
        )
    })?;
    let deposit = transfer.event_name == "DepositRequested";
    let (risk, signals, risky) = if deposit {
        provider.deposit_verdict(&transfer.tx_hash, sender).await?
    } else {
        provider.address_verdict(sender).await?
    };
    Ok(KytTransferResult::screened(deposit, risky, risk, signals))
}

async fn screen_addresses<P: KytProvider>(provider: &P, kyc_repo: &KycRepo, chain_id: i64) {
    let name = provider.name();
    let profiles = match kyc_repo
        .fetch_unscreened_profiles(chain_id, BATCH_SIZE)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(provider = name, error = %e, "failed to fetch unscreened profiles");
            return;
        }
    };

    if !profiles.is_empty() {
        tracing::info!(count = profiles.len(), "screening addresses via {name}");
    }

    for profile in &profiles {
        let wallet = profile.wallet_address.as_str();
        let (risk, signals_json, is_risky) = match screen_profile(provider, wallet).await {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(
                    provider = name,
                    chain_id,
                    kind = "profile",
                    error_class = error_class(&e),
                    wallet,
                    error = format!("{e:#}"),
                    "kyt provider error, will retry next tick"
                );
                continue;
            }
        };

        if let Err(e) = kyc_repo
            .set_kyt_address_risk(chain_id, wallet, risk, &signals_json, Utc::now())
            .await
        {
            tracing::error!(wallet, error = %e, "failed to store {name} address risk");
            continue;
        }

        let status = if is_risky {
            tracing::warn!(
                wallet,
                risk_score = risk,
                "{name} address screening failed — marking profile"
            );
            kyc_repo.set_profile_kyt_failed(chain_id, wallet).await
        } else {
            tracing::info!(wallet, risk_score = risk, "{name} address screening passed");
            kyc_repo.set_profile_kyt_clear(chain_id, wallet).await
        };
        if let Err(e) = status {
            tracing::error!(wallet, error = %e, "failed to set profile kyt_status");
        }
    }
}

async fn screen_events<P: KytProvider>(provider: &P, kyc_repo: &KycRepo, chain_id: i64) {
    let name = provider.name();
    let transfers = match kyc_repo
        .fetch_unverified_transfers_for_chain(chain_id, BATCH_SIZE)
        .await
    {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(provider = name, error = %e, "failed to fetch unverified events");
            return;
        }
    };

    if !transfers.is_empty() {
        tracing::info!(count = transfers.len(), "screening events via {name}");
    }

    for transfer in &transfers {
        if let Err(e) = screen_single_event(provider, kyc_repo, transfer).await {
            tracing::error!(
                provider = name,
                chain_id = transfer.chain_id,
                kind = "transfer",
                error_class = if transfer.sender.is_none() {
                    "no_sender"
                } else {
                    error_class(&e)
                },
                log_id = transfer.id,
                tx_hash = transfer.tx_hash,
                error = format!("{e:#}"),
                "kyt provider error, will retry next tick"
            );
        }
    }
}

async fn screen_single_event<P: KytProvider>(
    provider: &P,
    kyc_repo: &KycRepo,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<()> {
    let result = screen_transfer(provider, transfer).await?;
    kyc_repo
        .set_transfer_kyt_result(transfer.id, &result)
        .await?;

    if result.kyt_status == KYT_FAILED {
        let sender = transfer.sender.as_deref().unwrap_or_default();
        let address = provider.profile_address(sender);
        tracing::warn!(
            log_id = transfer.id,
            sender,
            address,
            tx_hash = transfer.tx_hash,
            event = transfer.event_name,
            "{} transfer screening failed — marking sender profile",
            provider.name()
        );
        if let Err(e) = kyc_repo
            .set_profile_kyt_failed(transfer.chain_id, &address)
            .await
        {
            tracing::error!(sender, address, error = %e, "failed to set profile kyt_status");
        }
    }

    Ok(())
}
