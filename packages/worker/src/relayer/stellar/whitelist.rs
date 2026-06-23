//! Stellar whitelister + `phase_sync_whitelist_stellar`.
//!
//! Parallels `crate::relayer::whitelist::phase_sync_whitelist` (EVM) but for Soroban:
//! instead of calling `WhitelistRegistry.allow(addr)`, it invokes
//! `access_manager.execute(set_authorized)` on the PLUSD SAC.
//!
//! Idempotency: tries `is_authorized(addr)` on the PLUSD SAC as a view-call first;
//! on `true`, skips submit and just flips the DB flag. If the SAC happens not to
//! expose `is_authorized`, the view-call errors and we fall through to submit; the
//! `set_authorized(addr, true)` call is itself idempotent on the SAC.

use std::time::Duration;

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use shared::kyc_repo::KycRepo;
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract as ContractStrkey};
use stellar_xdr::curr::{Limits, ReadXdr, ScVal, ScVec, VecM};

use crate::indexer::stellar::rpc::{SendResponse, StellarRpc};
use crate::relayer::stellar::sim_decode::{decode_auth_entries, decode_soroban_data};
use crate::stellar::tx::{
    address_account, address_contract, build_invoke_envelope, envelope_to_base64, sign_envelope,
    symbol,
};

/// Per-submit polling cap for `getTransaction`.
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const POLL_MAX_ATTEMPTS: u32 = 30;

/// Fee paid for the pre-check view simulate (never charged — simulate doesn't
/// require a real tx). Any value works; pick a reasonable one for clarity.
const VIEW_PRECHECK_FEE: u32 = 1_000_000;

/// Stellar/Soroban whitelister — issues `access_manager.execute(set_authorized)`
/// transactions on behalf of the relayer signer (which must hold the `executor`
/// role on the access-manager — granted out-of-band via `just grant-executor`).
pub struct StellarWhitelister {
    pub chain_id: i64,
    pub rpc: StellarRpc,
    pub network_passphrase: String,
    pub access_manager_id: ContractStrkey,
    pub plusd_sac_id: ContractStrkey,
    pub signing_key: SigningKey,
    pub signer_pubkey: Ed25519Pub,
}

impl StellarWhitelister {
    pub fn new(
        chain_id: i64,
        rpc_url: &str,
        network_passphrase: String,
        access_manager_id: ContractStrkey,
        plusd_sac_id: ContractStrkey,
        signing_key: SigningKey,
    ) -> Self {
        let signer_pubkey = Ed25519Pub(signing_key.verifying_key().to_bytes());
        Self {
            chain_id,
            rpc: StellarRpc::new(rpc_url),
            network_passphrase,
            access_manager_id,
            plusd_sac_id,
            signing_key,
            signer_pubkey,
        }
    }

    /// Pre-check whether the PLUSD SAC already reports `is_authorized(user) = true`.
    ///
    /// Returns `Ok(false)` (i.e. "proceed with submit") if the SAC view is missing,
    /// the simulate response errored, or the return value was not a `ScVal::Bool`.
    /// A wasted submit is preferable to a wrong skip.
    pub async fn is_already_authorized(&self, user: &Ed25519Pub) -> Result<bool> {
        let envelope = build_invoke_envelope(
            &self.signer_pubkey,
            0,
            VIEW_PRECHECK_FEE,
            &self.plusd_sac_id,
            "authorized",
            vec![address_account(user)],
            vec![],
            None,
        );
        let envelope_b64 = envelope_to_base64(&envelope)?;
        let resp = self.rpc.simulate_transaction(&envelope_b64).await?;
        if let Some(err) = &resp.error {
            tracing::debug!(
                wallet = %strkey_g(user),
                error = %err,
                "stellar is_authorized simulate errored — falling through to submit"
            );
            return Ok(false);
        }
        let Some(first) = resp.results.first() else {
            return Ok(false);
        };
        let Ok(xdr_bytes) = STANDARD.decode(first.return_value_xdr_base64.as_bytes()) else {
            return Ok(false);
        };
        let Ok(val) = ScVal::from_xdr(xdr_bytes.as_slice(), Limits::none()) else {
            return Ok(false);
        };
        Ok(matches!(val, ScVal::Bool(true)))
    }

    /// Submit `access_manager.execute(target=plusd_sac, function=set_authorized,
    /// args=[user, true], caller=signer)` and poll until terminal.
    pub async fn submit_set_authorized(&self, user: &Ed25519Pub) -> Result<()> {
        // Inner args forwarded to `target.set_authorized(...)`: [Address(user), Bool(true)].
        let inner_args: VecM<ScVal> = vec![address_account(user), ScVal::Bool(true)]
            .try_into()
            .expect("two args fit in VecM");

        // access_manager.execute signature: (target, function, args, caller).
        let args = vec![
            address_contract(&self.plusd_sac_id),
            symbol("set_authorized"),
            ScVal::Vec(Some(ScVec(inner_args))),
            address_account(&self.signer_pubkey),
        ];

        // Step 1: simulate (no real seq required — simulate doesn't validate it).
        let probe_envelope = build_invoke_envelope(
            &self.signer_pubkey,
            0,
            VIEW_PRECHECK_FEE,
            &self.access_manager_id,
            "execute",
            args.clone(),
            vec![],
            None,
        );
        let probe_b64 = envelope_to_base64(&probe_envelope)?;
        let sim = self.rpc.simulate_transaction(&probe_b64).await?;
        if let Some(err) = sim.error {
            anyhow::bail!("simulate access_manager.execute failed: {err}");
        }
        let tx_data_b64 = sim
            .transaction_data_xdr_base64
            .context("simulate response missing transactionData")?;
        let min_fee = sim
            .min_resource_fee
            .context("simulate response missing minResourceFee")?;
        let soroban_data = decode_soroban_data(&tx_data_b64)?;

        let auth_entries = decode_auth_entries(&sim.results)?;

        // Step 2: fetch the real account sequence and bump by 1.
        let current_seq = self
            .rpc
            .get_account_sequence(&self.signer_pubkey.0)
            .await?
            .context("signer account does not exist on the network — fund it first")?;
        let seq_num = current_seq.checked_add(1).context("seq overflow")?;

        // Step 3: assemble the real envelope. Total fee = inclusion (100 stroops min)
        // + resource fee returned by simulate.
        let inclusion_fee: u32 = 100;
        let total_fee = inclusion_fee
            .checked_add(u32::try_from(min_fee).context("min_resource_fee > u32::MAX")?)
            .context("total fee overflow")?;
        let mut envelope = build_invoke_envelope(
            &self.signer_pubkey,
            seq_num,
            total_fee,
            &self.access_manager_id,
            "execute",
            args,
            auth_entries,
            Some(soroban_data),
        );

        sign_envelope(&mut envelope, &self.signing_key, &self.network_passphrase)?;
        let envelope_b64 = envelope_to_base64(&envelope)?;
        let send_resp = self.rpc.send_transaction(&envelope_b64).await?;

        match send_resp.status.as_str() {
            "PENDING" | "DUPLICATE" => {}
            other => {
                anyhow::bail!(
                    "sendTransaction returned status={other} (hash={}, error_result_xdr={:?})",
                    send_resp.hash,
                    send_resp.error_result_xdr,
                );
            }
        }

        self.poll_tx_until_terminal(&send_resp).await
    }

    async fn poll_tx_until_terminal(&self, send_resp: &SendResponse) -> Result<()> {
        for _ in 0..POLL_MAX_ATTEMPTS {
            tokio::time::sleep(POLL_INTERVAL).await;
            let resp = self.rpc.get_transaction(&send_resp.hash).await?;
            match resp.status.as_str() {
                "SUCCESS" => return Ok(()),
                "FAILED" => {
                    anyhow::bail!(
                        "Stellar tx {} FAILED (result_xdr={:?})",
                        send_resp.hash,
                        resp.result_xdr_base64
                    );
                }
                _ => {}
            }
        }
        anyhow::bail!(
            "Stellar tx {} did not reach terminal state within {}s",
            send_resp.hash,
            POLL_MAX_ATTEMPTS
        );
    }
}

fn strkey_g(p: &Ed25519Pub) -> String {
    format!("{p}")
}

// ─── Phase function ──────────────────────────────────────────────────────────

/// Stellar parallel of `phase_sync_whitelist`. Reads pending Stellar profiles, pre-checks
/// on-chain authorization, and submits `access_manager.execute(set_authorized(addr, true))`
/// for each candidate. On a confirmed tx, flips `lp_profiles.on_chain_allowed = TRUE`.
pub async fn phase_sync_whitelist_stellar(
    whitelister: &StellarWhitelister,
    kyc_repo: &KycRepo,
    chain_id: i64,
    sumsub_enabled: bool,
    batch_size: usize,
) {
    let candidates = match kyc_repo
        .fetch_profiles_to_allow_stellar(chain_id, sumsub_enabled)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "stellar: failed to fetch profiles to allow");
            return;
        }
    };

    if candidates.is_empty() {
        return;
    }

    tracing::info!(
        chain_id,
        count = candidates.len(),
        "stellar: processing whitelist allows"
    );

    for candidate in candidates.into_iter().take(batch_size) {
        let Ok(user) = Ed25519Pub::from_string(&candidate.wallet_address) else {
            tracing::warn!(
                wallet = %candidate.wallet_address,
                "stellar: lp_profiles row is not a valid G… strkey; skipping"
            );
            continue;
        };

        match whitelister.is_already_authorized(&user).await {
            Ok(true) => {
                tracing::debug!(
                    wallet = %candidate.wallet_address,
                    "stellar: already authorized on-chain, syncing DB"
                );
                if let Err(e) = kyc_repo
                    .set_on_chain_allowed(chain_id, &candidate.wallet_address)
                    .await
                {
                    tracing::error!(wallet = %candidate.wallet_address, error = %e, "stellar: failed to sync DB");
                }
                continue;
            }
            Ok(false) => {} // proceed
            Err(e) => {
                tracing::warn!(
                    wallet = %candidate.wallet_address,
                    error = %e,
                    "stellar: is_authorized check failed, proceeding with submit"
                );
            }
        }

        match whitelister.submit_set_authorized(&user).await {
            Ok(()) => {
                if let Err(e) = kyc_repo
                    .set_on_chain_allowed(chain_id, &candidate.wallet_address)
                    .await
                {
                    tracing::error!(
                        wallet = %candidate.wallet_address,
                        error = %e,
                        "stellar: failed to update DB after set_authorized tx"
                    );
                } else {
                    tracing::info!(
                        wallet = %candidate.wallet_address,
                        "stellar: set_authorized tx confirmed"
                    );
                }
            }
            Err(e) => {
                tracing::error!(
                    wallet = %candidate.wallet_address,
                    error = %e,
                    "stellar: set_authorized tx failed, will retry next iteration"
                );
            }
        }
    }
}
