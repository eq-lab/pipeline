//! Stellar relayer job entry point.
//!
//! Mirrors `relayer_job::run_relayer_job` but only runs the phases relevant to
//! Stellar:
//!   - Phase 0: populate `lp_profiles` from indexed `DepositRequested` events
//!     (Stellar-aware variant — preserves Strkey case).
//!   - Phase 2: Elliptic KYT/AML screening (address + deposit-tx, chain-scoped).
//!   - Phase 3: sync whitelist to on-chain `access_manager.set_authorized`.
//!   - Phase 5: match indexed minter wire-ins to recorded bank deposits (#1416),
//!     when the minter contract id is configured.
//!
//! Sumsub (Phase 1) is a no-op everywhere — Sumsub statuses are populated by
//! the API's webhook handler. Crystal (Phase 2) is skipped because Crystal does
//! not support Stellar today; Elliptic is used instead when `ELLIPTIC_ENABLED=true`.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use shared::elliptic::client::EllipticClient;
use shared::elliptic::config::EllipticSettings;
use shared::kyc_repo::KycRepo;
use shared::lp_bank_deposit_repo::LpBankDepositRepo;

use crate::relayer::config::StellarRelayerSettings;
use crate::relayer::elliptic_check::phase_check_elliptic;
use crate::relayer::stellar::whitelist::{phase_sync_whitelist_stellar, StellarWhitelister};
use crate::relayer::wire_in_match::phase_match_wire_ins;

/// Stellar relayer loop body. Called only by the top-level dispatcher
/// `crate::relayer::relayer_job::run_relayer_job`; not exported from `mod.rs`.
pub(crate) async fn run_stellar_relayer_inner(
    settings: StellarRelayerSettings,
    kyc_repo: Arc<KycRepo>,
) -> Result<()> {
    let whitelister = StellarWhitelister::new(
        settings.chain_id,
        &settings.rpc_url,
        settings.network_passphrase.clone(),
        settings.access_manager_id,
        settings.plusd_sac_id,
        settings.signing_key.clone(),
    );

    tracing::info!(
        chain_id = settings.chain_id,
        interval_secs = settings.interval_secs,
        signer = %whitelister.signer_pubkey,
        access_manager = %settings.access_manager_id,
        plusd_sac = %settings.plusd_sac_id,
        sumsub_enabled = settings.sumsub_enabled,
        elliptic_enabled = settings.elliptic_enabled,
        "stellar relayer job running"
    );

    if !settings.legacy_env_keys.is_empty() {
        tracing::warn!(
            chain_id = settings.chain_id,
            keys = ?settings.legacy_env_keys,
            "deprecated Stellar relayer env vars are set and ignored — the yield-mint phase was removed; delete them"
        );
    }

    // Phase 5 (#1416): enabled only once the minter contract id is configured.
    // Pure database work — no RPC, no signing, so it needs nothing but the pool.
    let wire_in_matching = if let Some(minter_id) = settings.minter_id.clone() {
        tracing::info!(
            chain_id = settings.chain_id,
            minter = %minter_id,
            "stellar wire-in matching phase enabled"
        );
        Some((LpBankDepositRepo::new(kyc_repo.pool.clone()), minter_id))
    } else {
        tracing::info!(
            chain_id = settings.chain_id,
            "stellar wire-in matching phase disabled — set CHAIN_<id>_STELLAR_INDEXER_MINTER_ADDRESS"
        );
        None
    };

    let elliptic_client = if settings.elliptic_enabled {
        let s = EllipticSettings::from_env()
            .context("ELLIPTIC_ENABLED=true but Elliptic settings are missing")?;
        Some(EllipticClient::new(s))
    } else {
        None
    };

    let chain_id = settings.chain_id;

    loop {
        // Phase 0: auto-populate lp_profiles from Stellar DepositRequested events.
        match kyc_repo
            .populate_profiles_from_deposits_stellar(chain_id)
            .await
        {
            Ok(n) if n > 0 => {
                tracing::info!(
                    chain_id,
                    count = n,
                    "stellar: created new profiles from DepositRequested events"
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "stellar phase 0: failed to populate profiles");
            }
            _ => {}
        }

        // Phase 2: Elliptic KYT/AML screening (chain-scoped).
        if let Some(ref elliptic) = elliptic_client {
            phase_check_elliptic(elliptic, &kyc_repo, chain_id).await;
        }

        // Phase 3: sync whitelist on-chain via access_manager.execute(set_authorized).
        phase_sync_whitelist_stellar(
            &whitelister,
            &kyc_repo,
            chain_id,
            settings.sumsub_enabled,
            settings.elliptic_enabled,
            settings.batch_size,
        )
        .await;

        // Phase 5: wire-in matching (when configured).
        if let Some((matcher, minter_id)) = wire_in_matching.as_ref() {
            if let Err(e) = phase_match_wire_ins(matcher, chain_id, minter_id).await {
                tracing::error!(error = %e,
                    "stellar phase_match_wire_ins: cycle aborted (other phases unaffected)");
            }
        }

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}
