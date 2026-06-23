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
//! not support Stellar today. Phase 4 (yield-mint) runs when the yield-minter
//! and loan-registry contract ids are configured — it signs `mint_yield`
//! directly with the relayer keypair (no BitGo).

use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use shared::kyc_repo::KycRepo;
use shared::yield_mint_outbox_repo::YieldMintOutboxRepo;

use crate::relayer::config::StellarRelayerSettings;
use crate::relayer::stellar::whitelist::{phase_sync_whitelist_stellar, StellarWhitelister};
use crate::relayer::stellar::yield_mint::{
    phase_yield_mint_stellar, StellarPhase4Settings, StellarYieldMinter,
};

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
        crystal_enabled = settings.crystal_enabled,
        "stellar relayer job running"
    );

    // Phase 4 (yield-mint): enabled only when both contract ids are configured.
    let yield_mint = if let (Some(yield_minter_id), Some(loan_registry_id)) =
        (settings.yield_minter_id, settings.loan_registry_id)
    {
        let submitter = StellarYieldMinter::new(
            &settings.rpc_url,
            settings.network_passphrase.clone(),
            settings.signing_key.clone(),
            yield_minter_id,
            loan_registry_id,
        );
        let outbox = YieldMintOutboxRepo::new(kyc_repo.pool.clone());
        let phase_settings = StellarPhase4Settings {
            chain_id: settings.chain_id,
            yield_minter_id,
            loan_registry_id,
            batch_size: settings.batch_size,
        };
        tracing::info!(
            chain_id = settings.chain_id,
            yield_minter = %yield_minter_id,
            loan_registry = %loan_registry_id,
            "stellar yield-mint phase enabled"
        );
        Some((submitter, outbox, phase_settings))
    } else {
        tracing::info!(
            chain_id = settings.chain_id,
            "stellar yield-mint phase disabled (YIELD_MINTER_ID/LOAN_REGISTRY_ID unset)"
        );
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

        // Phase 3: sync whitelist on-chain via access_manager.execute(set_authorized).
        phase_sync_whitelist_stellar(
            &whitelister,
            &kyc_repo,
            chain_id,
            settings.sumsub_enabled,
            settings.batch_size,
        )
        .await;

        // Phase 4: yield-mint (when configured).
        if let Some((submitter, outbox, phase_settings)) = yield_mint.as_ref() {
            if let Err(e) = phase_yield_mint_stellar(phase_settings, submitter, outbox).await {
                tracing::error!(error = %e,
                    "stellar phase_yield_mint: cycle aborted (other phases unaffected)");
            }
        }

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}
