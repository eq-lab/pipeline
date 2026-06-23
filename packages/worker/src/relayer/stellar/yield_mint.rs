//! Stellar/Soroban yield-mint phase.
//!
//! Mirrors the EVM Phase 4 (`relayer/yield_mint/`) discover → submit → confirm
//! cycle, but signs `yield_minter.mint_yield(caller, loan_id, repayment_id)`
//! directly with the relayer ed25519 keypair (no BitGo). Double-mint is
//! prevented on-chain by `loan_registry.consume_yield`; `can_yield_be_minted`
//! is a pre-submit optimization, not the safety mechanism.

use anyhow::{Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use bigdecimal::{BigDecimal, ToPrimitive};
use ed25519_dalek::SigningKey;
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract as ContractStrkey};
use stellar_xdr::curr::{Limits, ReadXdr, ScVal};

use shared::yield_mint_outbox_repo::{OutboxKey, OutboxStore, YieldMintOutboxRepo};

use crate::indexer::stellar::rpc::StellarRpc;
use crate::relayer::stellar::sim_decode::{decode_auth_entries, decode_soroban_data};
use crate::stellar::tx::{
    address_account, build_invoke_envelope, envelope_to_base64, sign_envelope, u32_val,
};

/// Fee used for simulate-only envelopes (never charged).
const SIM_FEE: u32 = 1_000_000;
/// Minimum inclusion fee added on top of the resource fee from simulate.
const INCLUSION_FEE: u32 = 100;

/// Map a `getTransaction` status string to a tri-state confirm result:
/// `Some(true)` = SUCCESS, `Some(false)` = FAILED, `None` = not yet terminal.
pub fn map_get_transaction_status(status: &str) -> Option<bool> {
    match status {
        "SUCCESS" => Some(true),
        "FAILED" => Some(false),
        _ => None,
    }
}

/// Submitter seam — lets the phase be unit-tested without RPC.
#[async_trait]
pub trait StellarYieldSubmitter: Send + Sync {
    async fn can_yield_be_minted(&self, loan_id: u32, repayment_id: u32) -> Result<bool>;
    /// simulate → sign → send `mint_yield`; returns the tx hash. Does NOT poll.
    async fn submit_mint_yield(&self, loan_id: u32, repayment_id: u32) -> Result<String>;
    /// One `getTransaction` poll: `Some(true)`=SUCCESS, `Some(false)`=FAILED, `None`=in-flight.
    async fn check_tx(&self, tx_hash: &str) -> Result<Option<bool>>;
}

/// Production submitter: signs Soroban invocations with the relayer keypair.
pub struct StellarYieldMinter {
    pub rpc: StellarRpc,
    pub network_passphrase: String,
    pub signing_key: SigningKey,
    pub signer_pubkey: Ed25519Pub,
    pub yield_minter_id: ContractStrkey,
    pub loan_registry_id: ContractStrkey,
}

impl StellarYieldMinter {
    pub fn new(
        rpc_url: &str,
        network_passphrase: String,
        signing_key: SigningKey,
        yield_minter_id: ContractStrkey,
        loan_registry_id: ContractStrkey,
    ) -> Self {
        let signer_pubkey = Ed25519Pub(signing_key.verifying_key().to_bytes());
        Self {
            rpc: StellarRpc::new(rpc_url),
            network_passphrase,
            signing_key,
            signer_pubkey,
            yield_minter_id,
            loan_registry_id,
        }
    }
}

#[async_trait]
impl StellarYieldSubmitter for StellarYieldMinter {
    async fn can_yield_be_minted(&self, loan_id: u32, repayment_id: u32) -> Result<bool> {
        let envelope = build_invoke_envelope(
            &self.signer_pubkey,
            0,
            SIM_FEE,
            &self.loan_registry_id,
            "can_yield_be_minted",
            vec![u32_val(loan_id), u32_val(repayment_id)],
            vec![],
            None,
        );
        let envelope_b64 = envelope_to_base64(&envelope)?;
        let resp = self.rpc.simulate_transaction(&envelope_b64).await?;
        if let Some(err) = &resp.error {
            anyhow::bail!("simulate can_yield_be_minted failed: {err}");
        }
        let first = resp
            .results
            .first()
            .context("simulate can_yield_be_minted returned no results")?;
        let xdr_bytes = STANDARD
            .decode(first.return_value_xdr_base64.as_bytes())
            .context("decode can_yield_be_minted return base64")?;
        let val = ScVal::from_xdr(xdr_bytes.as_slice(), Limits::none())
            .context("decode can_yield_be_minted ScVal")?;
        Ok(matches!(val, ScVal::Bool(true)))
    }

    async fn submit_mint_yield(&self, loan_id: u32, repayment_id: u32) -> Result<String> {
        // mint_yield(caller, loan_id, repayment_id)
        let args = vec![
            address_account(&self.signer_pubkey),
            u32_val(loan_id),
            u32_val(repayment_id),
        ];

        // Step 1: simulate (seq 0 — simulate doesn't validate it).
        let probe = build_invoke_envelope(
            &self.signer_pubkey,
            0,
            SIM_FEE,
            &self.yield_minter_id,
            "mint_yield",
            args.clone(),
            vec![],
            None,
        );
        let probe_b64 = envelope_to_base64(&probe)?;
        let sim = self.rpc.simulate_transaction(&probe_b64).await?;
        if let Some(err) = sim.error {
            anyhow::bail!("simulate mint_yield failed: {err}");
        }
        let tx_data_b64 = sim
            .transaction_data_xdr_base64
            .context("simulate response missing transactionData")?;
        let min_fee = sim
            .min_resource_fee
            .context("simulate response missing minResourceFee")?;
        let soroban_data = decode_soroban_data(&tx_data_b64)?;
        let auth_entries = decode_auth_entries(&sim.results)?;

        // Step 2: real sequence.
        let current_seq = self
            .rpc
            .get_account_sequence(&self.signer_pubkey.0)
            .await?
            .context("signer account does not exist on the network — fund it first")?;
        let seq_num = current_seq.checked_add(1).context("seq overflow")?;

        // Step 3: assemble + sign.
        let total_fee = INCLUSION_FEE
            .checked_add(u32::try_from(min_fee).context("min_resource_fee > u32::MAX")?)
            .context("total fee overflow")?;
        let mut envelope = build_invoke_envelope(
            &self.signer_pubkey,
            seq_num,
            total_fee,
            &self.yield_minter_id,
            "mint_yield",
            args,
            auth_entries,
            Some(soroban_data),
        );
        sign_envelope(&mut envelope, &self.signing_key, &self.network_passphrase)?;
        let envelope_b64 = envelope_to_base64(&envelope)?;

        let send_resp = self.rpc.send_transaction(&envelope_b64).await?;
        match send_resp.status.as_str() {
            "PENDING" | "DUPLICATE" => Ok(send_resp.hash),
            other => anyhow::bail!(
                "sendTransaction mint_yield status={other} (hash={}, error_result_xdr={:?})",
                send_resp.hash,
                send_resp.error_result_xdr,
            ),
        }
    }

    async fn check_tx(&self, tx_hash: &str) -> Result<Option<bool>> {
        let resp = self.rpc.get_transaction(tx_hash).await?;
        Ok(map_get_transaction_status(&resp.status))
    }
}

// ---------------------------------------------------------------------------
// Phase orchestration
// ---------------------------------------------------------------------------

/// Settings consumed by the Stellar yield-mint phase.
pub struct StellarPhase4Settings {
    pub chain_id: i64,
    pub yield_minter_id: ContractStrkey,
    pub loan_registry_id: ContractStrkey,
    pub batch_size: usize,
}

/// Range-check a `NUMERIC` id into `u32`. Returns `None` if out of range.
pub fn u32_from_bigdecimal(v: &BigDecimal) -> Option<u32> {
    v.to_u32()
}

fn key_of(row: &shared::yield_mint_outbox_repo::YieldMintOutboxRow) -> OutboxKey {
    OutboxKey {
        chain_id: row.chain_id,
        yield_minter_address: row.yield_minter_address.clone(),
        loan_id: row.loan_id.clone(),
        repayment_id: row.repayment_id.clone(),
    }
}

/// Run one Stellar yield-mint cycle: discover → submit → confirm.
///
/// Per-row errors are logged and skipped. Only a DB list failure aborts the
/// cycle (returns `Err`); the relayer loop and other phases are unaffected.
pub async fn phase_yield_mint_stellar(
    settings: &StellarPhase4Settings,
    submitter: &dyn StellarYieldSubmitter,
    outbox: &YieldMintOutboxRepo,
) -> Result<()> {
    let minter_addr = settings.yield_minter_id.to_string();
    let registry_addr = settings.loan_registry_id.to_string();

    let inserted = outbox
        .discover_pending_stellar(settings.chain_id, &minter_addr, &registry_addr)
        .await?;
    if inserted > 0 {
        tracing::info!(
            count = inserted,
            "stellar yield_mint: discovered new pending rows"
        );
    }

    submit_pending_stellar(settings, submitter, outbox).await?;
    confirm_submitted_stellar(settings, submitter, outbox).await?;
    Ok(())
}

pub async fn submit_pending_stellar(
    settings: &StellarPhase4Settings,
    submitter: &dyn StellarYieldSubmitter,
    outbox: &dyn OutboxStore,
) -> Result<()> {
    let minter_addr = settings.yield_minter_id.to_string();
    let pending = outbox
        .list_pending(settings.chain_id, &minter_addr, settings.batch_size as i64)
        .await?;

    for row in pending {
        let key = key_of(&row);
        let loan_disp = row.loan_id.to_string();
        let rep_disp = row.repayment_id.to_string();

        let (Some(loan_id), Some(repayment_id)) = (
            u32_from_bigdecimal(&row.loan_id),
            u32_from_bigdecimal(&row.repayment_id),
        ) else {
            tracing::error!(
                loan_id = loan_disp,
                repayment_id = rep_disp,
                "stellar yield_mint: id out of u32 range — marking failed"
            );
            if let Err(e) = outbox
                .mark_failed(&key, "loan_id or repayment_id out of u32 range")
                .await
            {
                tracing::error!(error = %e, "stellar yield_mint: DB error marking failed (range)");
            }
            continue;
        };

        match submitter.can_yield_be_minted(loan_id, repayment_id).await {
            Ok(false) => {
                tracing::info!(
                    loan_id,
                    repayment_id,
                    "stellar yield_mint: can_yield_be_minted=false, marking skipped_already_minted"
                );
                if let Err(e) = outbox.mark_skipped_already_minted(&key).await {
                    tracing::error!(error = %e, "stellar yield_mint: DB error marking skipped");
                }
                continue;
            }
            Err(e) => {
                tracing::warn!(loan_id, repayment_id, error = %e,
                    "stellar yield_mint: transient guard failure, retrying next cycle");
                continue;
            }
            Ok(true) => {}
        }

        match submitter.submit_mint_yield(loan_id, repayment_id).await {
            Ok(tx_hash) => {
                tracing::info!(
                    loan_id,
                    repayment_id,
                    tx_hash,
                    "stellar yield_mint: pending -> submitted"
                );
                if let Err(e) = outbox.mark_submitted_stellar(&key, &tx_hash).await {
                    tracing::error!(error = %e, "stellar yield_mint: DB error marking submitted");
                }
            }
            Err(e) => {
                // No terminal failure on submit errors: re-submit is safe
                // (consume_yield is idempotent on-chain).
                tracing::warn!(loan_id, repayment_id, error = %e,
                    "stellar yield_mint: submit failed, retrying next cycle");
            }
        }
    }
    Ok(())
}

pub async fn confirm_submitted_stellar(
    settings: &StellarPhase4Settings,
    submitter: &dyn StellarYieldSubmitter,
    outbox: &dyn OutboxStore,
) -> Result<()> {
    let minter_addr = settings.yield_minter_id.to_string();
    let submitted_rows = outbox
        .list_submitted(settings.chain_id, &minter_addr, settings.batch_size as i64)
        .await?;

    for row in submitted_rows {
        let key = key_of(&row);
        let loan_disp = row.loan_id.to_string();
        let Some(tx_hash) = row.tx_hash.clone() else {
            tracing::error!(
                loan_id = loan_disp,
                "stellar yield_mint: submitted row has no tx_hash"
            );
            continue;
        };

        match submitter.check_tx(&tx_hash).await {
            Ok(Some(true)) => {
                tracing::info!(
                    loan_id = loan_disp,
                    tx_hash,
                    "stellar yield_mint: submitted -> confirmed"
                );
                if let Err(e) = outbox.mark_confirmed(&key, &tx_hash).await {
                    tracing::error!(error = %e, "stellar yield_mint: DB error marking confirmed");
                }
            }
            Ok(Some(false)) => {
                let msg = format!("stellar yield_mint tx FAILED on-chain: {tx_hash}");
                tracing::error!(loan_id = loan_disp, tx_hash,
                    "stellar yield_mint: tx FAILED on-chain — row terminated with status=failed (operator review)");
                if let Err(e) = outbox.mark_failed(&key, &msg).await {
                    tracing::error!(error = %e, "stellar yield_mint: DB error marking failed (on-chain FAILED)");
                }
            }
            Ok(None) => {
                tracing::info!(
                    loan_id = loan_disp,
                    tx_hash,
                    "stellar yield_mint: tx not yet terminal, retrying next cycle"
                );
            }
            Err(e) => {
                tracing::warn!(loan_id = loan_disp, tx_hash, error = %e,
                    "stellar yield_mint: transient failure polling tx, retrying next cycle");
            }
        }
    }
    Ok(())
}
