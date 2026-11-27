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
use crate::relayer::revoke::{process_disallows, DisallowStore, Revoker};
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
    /// args=[user, authorized], caller=signer)` and poll until terminal.
    pub async fn submit_set_authorized(&self, holder: &ScVal, authorized: bool) -> Result<()> {
        // Inner args forwarded to `target.set_authorized(...)`: [Address(holder), Bool(authorized)].
        let inner_args: VecM<ScVal> = vec![holder.clone(), ScVal::Bool(authorized)]
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

impl Revoker for StellarWhitelister {
    async fn is_authorized(&self, wallet: &str) -> Result<bool> {
        let holder = holder_scval(wallet).context("not a valid G… or C… strkey")?;
        holds_authorization(self.plusd_authorization(&holder).await?)
    }

    async fn revoke(&self, wallet: &str) -> Result<()> {
        let holder = holder_scval(wallet).context("not a valid G… or C… strkey")?;
        self.submit_set_authorized(&holder, false).await
    }
}

fn holds_authorization(auth: PlusdAuth) -> Result<bool> {
    match auth {
        PlusdAuth::Authorized => Ok(true),
        PlusdAuth::NotAuthorized | PlusdAuth::NoTrustline => Ok(false),
        PlusdAuth::Unknown => anyhow::bail!("PLUSD authorization unknown"),
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
trait WhitelistStore: DisallowStore {
    async fn fetch_profiles_to_allow_stellar(
        &self,
        chain_id: i64,
        sumsub_enabled: bool,
        elliptic_enabled: bool,
    ) -> Result<Vec<WhitelistCandidate>>;
    async fn fetch_profiles_to_disallow_stellar(
        &self,
        chain_id: i64,
        sumsub_enabled: bool,
        elliptic_enabled: bool,
    ) -> Result<Vec<WhitelistCandidate>>;
    async fn set_on_chain_allowed(&self, chain_id: i64, wallet_address: &str) -> Result<()>;
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
    async fn fetch_profiles_to_disallow_stellar(
        &self,
        chain_id: i64,
        sumsub_enabled: bool,
        elliptic_enabled: bool,
    ) -> Result<Vec<WhitelistCandidate>> {
        KycRepo::fetch_profiles_to_disallow_stellar(
            self,
            chain_id,
            sumsub_enabled,
            elliptic_enabled,
        )
        .await
    }
    async fn set_on_chain_allowed(&self, chain_id: i64, wallet_address: &str) -> Result<()> {
        KycRepo::set_on_chain_allowed(self, chain_id, wallet_address).await
    }
}

// ─── Phase function ──────────────────────────────────────────────────────────

/// Stellar parallel of `phase_sync_whitelist`. Reads pending Stellar profiles, pre-checks
/// on-chain authorization, and submits `access_manager.execute(set_authorized(addr, true))`
/// for each candidate. On a confirmed tx, flips `lp_profiles.on_chain_allowed = TRUE`.
///
/// When `elliptic_enabled` is true, only KYT-clear profiles (kyt_status = 1) are allowed,
/// and profiles with kyt_status = 2 (failed) are deauthorized on-chain, as are relinked-away
/// settlement addresses (`crate::relayer::revoke`).
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
        async {
            let to_disallow = kyc_repo
                .fetch_profiles_to_disallow_stellar(chain_id, sumsub_enabled, elliptic_enabled)
                .await;
            process_disallows(whitelister, kyc_repo, chain_id, to_disallow, batch_size).await;
        },
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

        match whitelister.submit_set_authorized(&holder, true).await {
            Ok(()) => {
                submitted += 1;
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

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::sync::{Arc, Mutex};

    use serde_json::{json, Value};
    use stellar_xdr::curr::{
        HostFunction, InvokeContractArgs, OperationBody, TransactionEnvelope, WriteXdr,
    };

    use super::*;

    const CHAIN_ID: i64 = 7;
    const FAILED_WALLET: &str = "GKYTFAILED";

    #[test]
    fn only_an_authorized_holder_needs_a_revoke_and_unknown_falls_through_to_submit() {
        assert!(holds_authorization(PlusdAuth::Authorized).unwrap());
        assert!(!holds_authorization(PlusdAuth::NotAuthorized).unwrap());
        assert!(!holds_authorization(PlusdAuth::NoTrustline).unwrap());
        assert!(holds_authorization(PlusdAuth::Unknown).is_err());
    }

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
        disallow_fetches: Mutex<Vec<i64>>,
        disallowed: Mutex<Vec<(i64, String)>>,
    }

    impl FakeStore {
        fn new(allow_fetch_fails: bool) -> Self {
            Self {
                allow_fetch_fails,
                disallow_fetches: Mutex::new(Vec::new()),
                disallowed: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl DisallowStore for FakeStore {
        async fn set_disallowed(&self, chain_id: i64, wallet_address: &str) -> Result<()> {
            self.disallowed
                .lock()
                .unwrap()
                .push((chain_id, wallet_address.to_owned()));
            Ok(())
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
        async fn fetch_profiles_to_disallow_stellar(
            &self,
            chain_id: i64,
            _sumsub_enabled: bool,
            _elliptic_enabled: bool,
        ) -> Result<Vec<WhitelistCandidate>> {
            self.disallow_fetches.lock().unwrap().push(chain_id);
            Ok(vec![WhitelistCandidate {
                wallet_address: FAILED_WALLET.to_owned(),
            }])
        }
        async fn set_on_chain_allowed(&self, _chain_id: i64, _wallet_address: &str) -> Result<()> {
            panic!("no allow candidates, so nothing should be allowed");
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

    /// The whitelister's RPC is unreachable, so the revoke cannot be confirmed:
    /// the disallow pass must run, yet leave the DB flag alone (it follows confirmation).
    async fn assert_disallow_pass_ran_without_confirmation(store: &FakeStore) {
        sync_whitelist(&whitelister(), store, CHAIN_ID, true, true, 10).await;
        assert_eq!(*store.disallow_fetches.lock().unwrap(), vec![CHAIN_ID]);
        assert!(store.disallowed.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn disallow_pass_runs_when_allow_fetch_fails() {
        assert_disallow_pass_ran_without_confirmation(&FakeStore::new(true)).await;
    }

    #[tokio::test]
    async fn disallow_pass_runs_when_no_allow_candidates() {
        assert_disallow_pass_ran_without_confirmation(&FakeStore::new(false)).await;
    }

    fn holder_strkey() -> String {
        Ed25519Pub([9u8; 32]).to_string().as_str().to_owned()
    }

    fn invoked(envelope_b64: &str) -> InvokeContractArgs {
        let TransactionEnvelope::Tx(env) =
            TransactionEnvelope::from_xdr_base64(envelope_b64, Limits::none()).unwrap()
        else {
            panic!("not a v1 envelope");
        };
        let OperationBody::InvokeHostFunction(op) = &env.tx.operations[0].body else {
            panic!("not an invoke");
        };
        let HostFunction::InvokeContract(args) = &op.host_function else {
            panic!("not a contract call");
        };
        args.clone()
    }

    /// Runs the Stellar disallow pass for one KYT-failed holder against a fake Soroban RPC whose
    /// PLUSD `authorized` view answers `authorized` and which fails every other simulation.
    /// Returns the `access_manager.execute` args the pass simulated and the wallets it recorded.
    async fn stellar_disallow_pass(authorized: bool) -> (Vec<Vec<ScVal>>, Vec<(i64, String)>) {
        let executed = Arc::new(Mutex::new(Vec::<Vec<ScVal>>::new()));
        let mut server = mockito::Server::new_async().await;
        let seen = Arc::clone(&executed);
        let _rpc = server
            .mock("POST", "/")
            .with_header("content-type", "application/json")
            .with_body_from_request(move |req| {
                let body: Value = serde_json::from_slice(req.body().unwrap()).unwrap();
                let result = if body["method"] == "simulateTransaction" {
                    let call = invoked(body["params"]["transaction"].as_str().unwrap());
                    if ScVal::Symbol(call.function_name.clone()) == symbol("authorized") {
                        let xdr = ScVal::Bool(authorized)
                            .to_xdr_base64(Limits::none())
                            .unwrap();
                        json!({ "latestLedger": 1, "results": [{ "xdr": xdr }] })
                    } else {
                        seen.lock().unwrap().push(call.args.to_vec());
                        json!({ "latestLedger": 1, "error": "simulation refused by the fake" })
                    }
                } else {
                    json!({ "latestLedger": 1, "error": "unexpected method" })
                };
                json!({ "jsonrpc": "2.0", "id": body["id"], "result": result })
                    .to_string()
                    .into_bytes()
            })
            .create_async()
            .await;

        let whitelister = StellarWhitelister::new(
            CHAIN_ID,
            &server.url(),
            "test".to_owned(),
            ContractStrkey([1u8; 32]),
            ContractStrkey([2u8; 32]),
            SigningKey::from_bytes(&[3u8; 32]),
        );
        let store = FakeStore::new(false);
        let candidates = vec![WhitelistCandidate {
            wallet_address: holder_strkey(),
        }];
        process_disallows(&whitelister, &store, CHAIN_ID, Ok(candidates), 10).await;

        let executed = executed.lock().unwrap().clone();
        let disallowed = store.disallowed.lock().unwrap().clone();
        (executed, disallowed)
    }

    #[tokio::test]
    async fn failing_allow_submissions_do_not_use_up_the_batch() {
        let simulations = Arc::new(Mutex::new(0usize));
        let mut server = mockito::Server::new_async().await;
        let seen = Arc::clone(&simulations);
        let _rpc = server
            .mock("POST", "/")
            .with_header("content-type", "application/json")
            .with_body_from_request(move |req| {
                let body: Value = serde_json::from_slice(req.body().unwrap()).unwrap();
                *seen.lock().unwrap() += 1;
                json!({ "jsonrpc": "2.0", "id": body["id"],
                    "result": { "latestLedger": 1, "error": "refused by the fake" } })
                .to_string()
                .into_bytes()
            })
            .expect_at_least(1)
            .create_async()
            .await;
        let whitelister = StellarWhitelister::new(
            CHAIN_ID,
            &server.url(),
            "test".to_owned(),
            ContractStrkey([1u8; 32]),
            ContractStrkey([2u8; 32]),
            SigningKey::from_bytes(&[3u8; 32]),
        );
        let candidates = (0..2)
            .map(|_| WhitelistCandidate {
                wallet_address: holder_strkey(),
            })
            .collect();
        process_allows(
            &whitelister,
            &FakeStore::new(false),
            CHAIN_ID,
            candidates,
            1,
        )
        .await;
        // Per candidate: one is_authorized check plus one failed submit; a spent batch would stop at one candidate.
        assert_eq!(*simulations.lock().unwrap(), 4);
    }

    #[tokio::test]
    async fn kyt_failed_authorized_holder_gets_set_authorized_false_and_no_db_flag_until_confirmed()
    {
        let (executed, disallowed) = stellar_disallow_pass(true).await;
        let holder = address_account(&Ed25519Pub([9u8; 32]));
        let expected_inner: VecM<ScVal> = vec![holder, ScVal::Bool(false)].try_into().unwrap();
        assert_eq!(
            executed,
            [vec![
                address_contract(&ContractStrkey([2u8; 32])),
                symbol("set_authorized"),
                ScVal::Vec(Some(ScVec(expected_inner))),
                address_account(&Ed25519Pub(
                    SigningKey::from_bytes(&[3u8; 32])
                        .verifying_key()
                        .to_bytes()
                )),
            ]]
        );
        assert!(disallowed.is_empty(), "{disallowed:?}");
    }

    #[tokio::test]
    async fn kyt_failed_holder_already_deauthorized_is_recorded_without_a_tx() {
        let (executed, disallowed) = stellar_disallow_pass(false).await;
        assert!(executed.is_empty(), "{executed:?}");
        assert_eq!(disallowed, [(CHAIN_ID, holder_strkey())]);
    }
}
