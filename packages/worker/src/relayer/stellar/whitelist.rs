//! Stellar whitelister + `phase_sync_whitelist_stellar`.
//!
//! Parallels `crate::relayer::evm::whitelist::phase_sync_whitelist_evm` (EVM) but for Soroban:
//! instead of calling `WhitelistRegistry.allow(addr)`, it invokes
//! `access_manager.execute(set_authorized)` on the PLUSD SAC.
//!
//! Idempotency: tries `is_authorized(addr)` on the PLUSD SAC as a view-call first;
//! on `true`, skips submit and just flips the DB flag. If the SAC happens not to
//! expose `is_authorized`, the view-call errors and we fall through to submit; the
//! `set_authorized(addr, true)` call is itself idempotent on the SAC.

use std::future::Future;
use std::time::Duration;

use anyhow::{Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use shared::kyc_repo::{KycRepo, WhitelistCandidate};
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract as ContractStrkey};
use stellar_xdr::curr::{Limits, ReadXdr, ScVal, ScVec, VecM};

use crate::indexer::stellar::rpc::{SendResponse, StellarRpc};
use crate::indexer::stellar::security_registry_views::is_contract_error;
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

    pub async fn plusd_authorization(&self, holder: &ScVal) -> Result<PlusdAuth> {
        let envelope = build_invoke_envelope(
            &self.signer_pubkey,
            0,
            VIEW_PRECHECK_FEE,
            &self.plusd_sac_id,
            "authorized",
            vec![holder.clone()],
            vec![],
            None,
        );
        let envelope_b64 = envelope_to_base64(&envelope)?;
        let resp = self.rpc.simulate_transaction(&envelope_b64).await?;
        let value = resp
            .results
            .first()
            .and_then(|r| STANDARD.decode(r.return_value_xdr_base64.as_bytes()).ok())
            .and_then(|bytes| ScVal::from_xdr(bytes.as_slice(), Limits::none()).ok());
        Ok(classify_authorized_simulate(
            resp.error.as_deref(),
            value.as_ref(),
        ))
    }

    /// Submit `access_manager.execute(target=plusd_sac, function=set_authorized,
    /// args=[user, true], caller=signer)` and poll until terminal.
    pub async fn submit_set_authorized(&self, holder: &ScVal) -> Result<()> {
        // Inner args forwarded to `target.set_authorized(...)`: [Address(holder), Bool(true)].
        let inner_args: VecM<ScVal> = vec![holder.clone(), ScVal::Bool(true)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlusdAuth {
    Authorized,
    NotAuthorized,
    NoTrustline,
    Unknown,
}

const SAC_TRUSTLINE_MISSING_CODE: u32 = 13;

pub fn holder_scval(strkey: &str) -> Option<ScVal> {
    if let Ok(g) = Ed25519Pub::from_string(strkey) {
        return Some(address_account(&g));
    }
    ContractStrkey::from_string(strkey)
        .ok()
        .map(|c| address_contract(&c))
}

pub fn classify_authorized_simulate(
    error: Option<&str>,
    return_value: Option<&ScVal>,
) -> PlusdAuth {
    if let Some(err) = error {
        return if is_contract_error(err, SAC_TRUSTLINE_MISSING_CODE) {
            PlusdAuth::NoTrustline
        } else {
            PlusdAuth::Unknown
        };
    }
    match return_value {
        Some(ScVal::Bool(true)) => PlusdAuth::Authorized,
        Some(ScVal::Bool(false)) => PlusdAuth::NotAuthorized,
        _ => PlusdAuth::Unknown,
    }
}

#[async_trait]
trait WhitelistStore: Send + Sync {
    async fn fetch_profiles_to_allow_stellar(
        &self,
        chain_id: i64,
        sumsub_enabled: bool,
        elliptic_enabled: bool,
    ) -> Result<Vec<WhitelistCandidate>>;
    async fn fetch_profiles_to_disallow(
        &self,
        chain_id: i64,
        sumsub_enabled: bool,
        elliptic_enabled: bool,
    ) -> Result<Vec<WhitelistCandidate>>;
    async fn set_on_chain_allowed(&self, chain_id: i64, wallet_address: &str) -> Result<()>;
    async fn set_disallowed(&self, chain_id: i64, wallet_address: &str) -> Result<()>;
}

#[async_trait]
impl WhitelistStore for KycRepo {
    async fn fetch_profiles_to_allow_stellar(
        &self,
        chain_id: i64,
        sumsub_enabled: bool,
        elliptic_enabled: bool,
    ) -> Result<Vec<WhitelistCandidate>> {
        KycRepo::fetch_profiles_to_allow_stellar(self, chain_id, sumsub_enabled, elliptic_enabled)
            .await
    }
    async fn fetch_profiles_to_disallow(
        &self,
        chain_id: i64,
        sumsub_enabled: bool,
        elliptic_enabled: bool,
    ) -> Result<Vec<WhitelistCandidate>> {
        KycRepo::fetch_profiles_to_disallow(self, chain_id, sumsub_enabled, elliptic_enabled).await
    }
    async fn set_on_chain_allowed(&self, chain_id: i64, wallet_address: &str) -> Result<()> {
        KycRepo::set_on_chain_allowed(self, chain_id, wallet_address).await
    }
    async fn set_disallowed(&self, chain_id: i64, wallet_address: &str) -> Result<()> {
        KycRepo::set_disallowed(self, chain_id, wallet_address).await
    }
}

// ─── Phase function ──────────────────────────────────────────────────────────

/// Stellar parallel of `phase_sync_whitelist`. Reads pending Stellar profiles, pre-checks
/// on-chain authorization, and submits `access_manager.execute(set_authorized(addr, true))`
/// for each candidate. On a confirmed tx, flips `lp_profiles.on_chain_allowed = TRUE`.
///
/// When `elliptic_enabled` is true, only KYT-clear profiles (kyt_status = 1) are allowed,
/// and profiles with kyt_status = 2 (failed) are disallowed (DB-side only — the Stellar
/// access_manager has no deauthorize path exposed by this relayer today).
pub async fn phase_sync_whitelist_stellar(
    whitelister: &StellarWhitelister,
    kyc_repo: &KycRepo,
    chain_id: i64,
    sumsub_enabled: bool,
    elliptic_enabled: bool,
    batch_size: usize,
) {
    sync_whitelist(
        whitelister,
        kyc_repo,
        chain_id,
        sumsub_enabled,
        elliptic_enabled,
        batch_size,
    )
    .await;
}

async fn sync_whitelist(
    whitelister: &StellarWhitelister,
    kyc_repo: &dyn WhitelistStore,
    chain_id: i64,
    sumsub_enabled: bool,
    elliptic_enabled: bool,
    batch_size: usize,
) {
    // An allow-fetch error counts as zero candidates, so the disallow pass still runs (#2275).
    let candidates = match kyc_repo
        .fetch_profiles_to_allow_stellar(chain_id, sumsub_enabled, elliptic_enabled)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "stellar: failed to fetch profiles to allow");
            Vec::new()
        }
    };

    run_passes(
        candidates.len(),
        process_allows(whitelister, kyc_repo, chain_id, candidates, batch_size),
        process_disallows(kyc_repo, chain_id, sumsub_enabled, elliptic_enabled),
    )
    .await;
}

/// The allow pass runs only when there is something to allow; the disallow pass runs on every tick (BUG-27).
async fn run_passes(
    allow_count: usize,
    allow: impl Future<Output = ()>,
    disallow: impl Future<Output = ()>,
) {
    if allow_count > 0 {
        allow.await;
    }
    disallow.await;
}

async fn process_allows(
    whitelister: &StellarWhitelister,
    kyc_repo: &dyn WhitelistStore,
    chain_id: i64,
    candidates: Vec<WhitelistCandidate>,
    batch_size: usize,
) {
    let mut submitted = 0usize;
    for candidate in candidates {
        if submitted >= batch_size {
            break;
        }
        let Some(holder) = holder_scval(&candidate.wallet_address) else {
            tracing::warn!(
                wallet = %candidate.wallet_address,
                "stellar: lp_profiles row is not a valid G… or C… strkey; skipping"
            );
            continue;
        };

        match whitelister.plusd_authorization(&holder).await {
            Ok(PlusdAuth::Authorized) => {
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
            Ok(PlusdAuth::NoTrustline) => {
                tracing::debug!(
                    wallet = %candidate.wallet_address,
                    "stellar: no PLUSD trustline yet, skipping"
                );
                continue;
            }
            Ok(PlusdAuth::NotAuthorized | PlusdAuth::Unknown) => {}
            Err(e) => {
                tracing::warn!(
                    wallet = %candidate.wallet_address,
                    error = %e,
                    "stellar: is_authorized check failed, proceeding with submit"
                );
            }
        }

        submitted += 1;
        match whitelister.submit_set_authorized(&holder).await {
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

// Disallow pass: flip DB flag for profiles that have kyt_status = 2 (KYT failed).
// Note: DB-side only — the Stellar access_manager has no deauthorize path exposed
// by this relayer today. On-chain revocation is a future gap item.
async fn process_disallows(
    kyc_repo: &dyn WhitelistStore,
    chain_id: i64,
    sumsub_enabled: bool,
    elliptic_enabled: bool,
) {
    let to_disallow = match kyc_repo
        .fetch_profiles_to_disallow(chain_id, sumsub_enabled, elliptic_enabled)
        .await
    {
        Ok(d) => d,
        Err(e) => {
            tracing::error!(error = %e, "stellar: failed to fetch profiles to disallow");
            return;
        }
    };

    for candidate in to_disallow {
        if let Err(e) = kyc_repo
            .set_disallowed(chain_id, &candidate.wallet_address)
            .await
        {
            tracing::error!(
                wallet = %candidate.wallet_address,
                error = %e,
                "stellar: failed to set_disallowed in DB"
            );
        } else {
            tracing::info!(
                wallet = %candidate.wallet_address,
                "stellar: set_disallowed (DB-only; on-chain deauthorize not yet implemented)"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::sync::Mutex;

    use super::*;

    const CHAIN_ID: i64 = 7;
    const FAILED_WALLET: &str = "GKYTFAILED";

    async fn passes_run(allow_count: usize) -> Vec<&'static str> {
        let ran = RefCell::new(vec![]);
        run_passes(
            allow_count,
            async { ran.borrow_mut().push("allow") },
            async { ran.borrow_mut().push("disallow") },
        )
        .await;
        ran.into_inner()
    }

    #[tokio::test]
    async fn disallow_pass_runs_with_zero_allow_candidates() {
        assert_eq!(passes_run(0).await, ["disallow"]);
    }

    #[tokio::test]
    async fn both_passes_run_in_order_with_allow_candidates() {
        assert_eq!(passes_run(2).await, ["allow", "disallow"]);
    }

    struct FakeStore {
        allow_fetch_fails: bool,
        disallowed: Mutex<Vec<(i64, String)>>,
    }

    impl FakeStore {
        fn new(allow_fetch_fails: bool) -> Self {
            Self {
                allow_fetch_fails,
                disallowed: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl WhitelistStore for FakeStore {
        async fn fetch_profiles_to_allow_stellar(
            &self,
            _chain_id: i64,
            _sumsub_enabled: bool,
            _elliptic_enabled: bool,
        ) -> Result<Vec<WhitelistCandidate>> {
            if self.allow_fetch_fails {
                anyhow::bail!("allow query failed");
            }
            Ok(vec![])
        }
        async fn fetch_profiles_to_disallow(
            &self,
            _chain_id: i64,
            _sumsub_enabled: bool,
            _elliptic_enabled: bool,
        ) -> Result<Vec<WhitelistCandidate>> {
            Ok(vec![WhitelistCandidate {
                wallet_address: FAILED_WALLET.to_owned(),
            }])
        }
        async fn set_on_chain_allowed(&self, _chain_id: i64, _wallet_address: &str) -> Result<()> {
            panic!("no allow candidates, so nothing should be allowed");
        }
        async fn set_disallowed(&self, chain_id: i64, wallet_address: &str) -> Result<()> {
            self.disallowed
                .lock()
                .unwrap()
                .push((chain_id, wallet_address.to_owned()));
            Ok(())
        }
    }

    fn whitelister() -> StellarWhitelister {
        StellarWhitelister::new(
            CHAIN_ID,
            "http://127.0.0.1:1",
            "test".to_owned(),
            ContractStrkey([1u8; 32]),
            ContractStrkey([2u8; 32]),
            SigningKey::from_bytes(&[3u8; 32]),
        )
    }

    async fn disallowed_after_sync(store: &FakeStore) -> Vec<(i64, String)> {
        sync_whitelist(&whitelister(), store, CHAIN_ID, true, true, 10).await;
        store.disallowed.lock().unwrap().clone()
    }

    #[tokio::test]
    async fn disallow_pass_runs_when_allow_fetch_fails() {
        let store = FakeStore::new(true);
        assert_eq!(
            disallowed_after_sync(&store).await,
            vec![(CHAIN_ID, FAILED_WALLET.to_owned())]
        );
    }

    #[tokio::test]
    async fn disallow_pass_runs_when_no_allow_candidates() {
        let store = FakeStore::new(false);
        assert_eq!(
            disallowed_after_sync(&store).await,
            vec![(CHAIN_ID, FAILED_WALLET.to_owned())]
        );
    }
}
