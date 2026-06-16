//! Stellar relayer job entry point.
//!
//! Mirrors `relayer_job::run_relayer_job` but only runs the phases relevant to
//! Stellar:
//!   - Phase 0: populate `lp_profiles` from indexed `DepositRequested` events
//!     (Stellar-aware variant — preserves Strkey case).
//!   - Phase 3: sync whitelist to on-chain `access_manager.set_authorized`.
//!
//! Sumsub (Phase 1) is a no-op everywhere — Sumsub statuses are populated by
//! the API's webhook handler. Crystal (Phase 2) is skipped because Crystal does
//! not support Stellar today. Phase 4 (yield-mint) has no Soroban counterpart.

use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use shared::kyc_repo::KycRepo;

use crate::relayer::config::StellarRelayerSettings;
use crate::relayer::stellar::whitelist::{phase_sync_whitelist_stellar, StellarWhitelister};

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
        settings.signing_key,
    );

    tracing::info!(
        chain_id = settings.chain_id,
        interval_secs = settings.interval_secs,
        signer = %whitelister.signer_pubkey,
        access_manager = %settings.access_manager_id,
        plusd_sac = %settings.plusd_sac_id,
        sumsub_enabled = settings.sumsub_enabled,
        crystal_enabled = settings.crystal_enabled,
        "stellar relayer job running"
    );

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

        // Phase 3: sync whitelist on-chain via access_manager.execute(set_authorized).
        phase_sync_whitelist_stellar(
            &whitelister,
            &kyc_repo,
            chain_id,
            settings.sumsub_enabled,
            settings.batch_size,
        )
        .await;

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}
