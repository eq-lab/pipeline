//! EVM twin of `relayer::stellar::whitelist`: `WhitelistRegistry.allow`/`disallow` in place of
//! `access_manager.execute(set_authorized)`. See `docs/exec-plans/active/evm-relayer-v5.md` (D2).

use std::time::Duration;

use alloy::network::Ethereum;
use alloy::primitives::{Address, TxHash};
use alloy::providers::{PendingTransactionBuilder, Provider};
use alloy::sol;
use alloy::transports::Transport;
use anyhow::{Context, Result};
use shared::kyc_repo::KycRepo;

use crate::relayer::revoke::{process_disallows, RevokeBackoff, Revoker};

const CONFIRM_TIMEOUT: Duration = Duration::from_mins(2);

sol! {
    #[sol(rpc)]
    contract WhitelistRegistry {
        function allow(address user) external;
        function disallow(address user) external;
        function isAllowed(address user) external view returns (bool);
    }
}

pub struct EvmWhitelister<T, P> {
    pub chain_id: i64,
    pub signer: Address,
    registry: WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    revoke_backoff: RevokeBackoff,
}

impl<T, P> EvmWhitelister<T, P>
where
    T: Transport + Clone,
    P: Provider<T>,
{
    pub fn new(chain_id: i64, registry_address: Address, provider: P, signer: Address) -> Self {
        Self {
            chain_id,
            signer,
            registry: WhitelistRegistry::new(registry_address, provider),
            revoke_backoff: RevokeBackoff::default(),
        }
    }

    pub fn registry_address(&self) -> Address {
        *self.registry.address()
    }

    pub async fn is_already_allowed(&self, user: Address) -> Result<bool> {
        let ret = self
            .registry
            .isAllowed(user)
            .call()
            .await
            .context("isAllowed call failed")?;
        Ok(ret._0)
    }

    pub async fn submit_allow(&self, user: Address) -> Result<TxHash> {
        let pending = self.registry.allow(user).send().await;
        confirm("allow", pending).await
    }
}

async fn confirm<T: Transport + Clone>(
    what: &str,
    pending: alloy::contract::Result<PendingTransactionBuilder<T, Ethereum>>,
) -> Result<TxHash> {
    let pending = pending.with_context(|| format!("{what} send failed"))?;
    let tx_hash = *pending.tx_hash();
    let receipt = pending
        .with_timeout(Some(CONFIRM_TIMEOUT))
        .get_receipt()
        .await
        .with_context(|| {
            format!(
                "{what} tx {tx_hash} did not reach a receipt within {}s",
                CONFIRM_TIMEOUT.as_secs()
            )
        })?;
    if !receipt.status() {
        anyhow::bail!("{what} tx {tx_hash} reverted");
    }
    Ok(tx_hash)
}

impl<T, P> Revoker for EvmWhitelister<T, P>
where
    T: Transport + Clone,
    P: Provider<T>,
{
    async fn is_authorized(&self, wallet: &str) -> Result<bool> {
        self.is_already_allowed(wallet.parse()?).await
    }

    async fn revoke(&self, wallet: &str) -> Result<()> {
        let pending = self.registry.disallow(wallet.parse()?).send().await;
        confirm("disallow", pending).await.map(drop)
    }
}

pub async fn phase_sync_whitelist_evm<T, P>(
    whitelister: &EvmWhitelister<T, P>,
    kyc_repo: &KycRepo,
    chain_id: i64,
    sumsub_enabled: bool,
    crystal_enabled: bool,
    batch_size: usize,
) where
    T: Transport + Clone,
    P: Provider<T>,
{
    process_allows(
        whitelister,
        kyc_repo,
        chain_id,
        sumsub_enabled,
        crystal_enabled,
        batch_size,
    )
    .await;
    let to_disallow = kyc_repo
        .fetch_profiles_to_disallow(chain_id, crystal_enabled)
        .await;
    process_disallows(
        whitelister,
        kyc_repo,
        chain_id,
        to_disallow,
        batch_size,
        &whitelister.revoke_backoff,
    )
    .await;
}

async fn process_allows<T, P>(
    whitelister: &EvmWhitelister<T, P>,
    kyc_repo: &KycRepo,
    chain_id: i64,
    sumsub_enabled: bool,
    crystal_enabled: bool,
    batch_size: usize,
) where
    T: Transport + Clone,
    P: Provider<T>,
{
    let candidates = match kyc_repo
        .fetch_profiles_to_allow(chain_id, sumsub_enabled, crystal_enabled)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "evm: failed to fetch profiles to allow");
            return;
        }
    };

    if candidates.is_empty() {
        return;
    }

    tracing::info!(
        chain_id,
        count = candidates.len(),
        "evm: processing whitelist allows"
    );

    let (mut submitted, mut failed) = (0usize, 0usize);
    for candidate in candidates {
        if submitted >= batch_size || failed >= batch_size {
            break;
        }
        let Ok(user) = candidate.wallet_address.parse::<Address>() else {
            tracing::warn!(
                wallet = %candidate.wallet_address,
                "evm: lp_profiles row is not a valid EVM address; skipping"
            );
            continue;
        };

        match whitelister.is_already_allowed(user).await {
            Ok(true) => {
                tracing::debug!(
                    wallet = %candidate.wallet_address,
                    "evm: already allowed on-chain, syncing DB"
                );
                if let Err(e) = kyc_repo
                    .set_on_chain_allowed(chain_id, &candidate.wallet_address)
                    .await
                {
                    tracing::error!(wallet = %candidate.wallet_address, error = %e, "evm: failed to sync DB");
                }
                continue;
            }
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(
                    wallet = %candidate.wallet_address,
                    error = %e,
                    "evm: isAllowed check failed, proceeding with submit"
                );
            }
        }

        match whitelister.submit_allow(user).await {
            Ok(tx_hash) => {
                submitted += 1;
                if let Err(e) = kyc_repo
                    .set_on_chain_allowed(chain_id, &candidate.wallet_address)
                    .await
                {
                    tracing::error!(
                        wallet = %candidate.wallet_address,
                        %tx_hash,
                        error = %e,
                        "evm: failed to update DB after allow tx"
                    );
                } else {
                    tracing::info!(
                        wallet = %candidate.wallet_address,
                        %tx_hash,
                        "evm: allow tx confirmed"
                    );
                }
            }
            Err(e) => {
                failed += 1;
                tracing::error!(
                    wallet = %candidate.wallet_address,
                    error = %e,
                    "evm: allow tx failed, will retry next iteration"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use alloy::primitives::address;
    use alloy::providers::ProviderBuilder;
    use alloy::sol_types::SolCall;
    use async_trait::async_trait;
    use serde_json::{json, Value};
    use shared::kyc_repo::WhitelistCandidate;

    use super::*;
    use crate::evm_http::evm_rpc_client;
    use crate::relayer::revoke::DisallowStore;

    const CHAIN_ID: i64 = 11;
    const REGISTRY: Address = address!("00000000000000000000000000000000000000aa");
    const KYT_FAILED: &str = "0x00000000000000000000000000000000000000bb";

    #[derive(Default)]
    struct FakeStore {
        disallowed: Mutex<Vec<(i64, String)>>,
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

    /// Runs the EVM disallow pass for one KYT-failed wallet against a fake JSON-RPC node whose
    /// `isAllowed` answers `allowed` and which refuses every `eth_sendTransaction`.
    /// Returns the transactions the pass tried to send and the wallets it recorded as disallowed.
    async fn disallow_pass(allowed: bool) -> (Vec<Value>, Vec<(i64, String)>) {
        let sent = Arc::new(Mutex::new(Vec::<Value>::new()));
        let mut server = mockito::Server::new_async().await;
        let seen = Arc::clone(&sent);
        let _node = server
            .mock("POST", "/")
            .with_header("content-type", "application/json")
            .with_body_from_request(move |req| {
                let body: Value = serde_json::from_slice(req.body().unwrap()).unwrap();
                let reply = match body["method"].as_str().unwrap() {
                    "eth_blockNumber" => json!({ "result": "0x1" }),
                    "eth_call" => json!({ "result": format!("0x{:064x}", u8::from(allowed)) }),
                    "eth_sendTransaction" => {
                        seen.lock().unwrap().push(body["params"][0].clone());
                        json!({ "error": { "code": -32000, "message": "node refuses txs" } })
                    }
                    _ => json!({ "error": { "code": -32601, "message": "method not found" } }),
                };
                let mut reply = reply.as_object().unwrap().clone();
                reply.insert("jsonrpc".into(), json!("2.0"));
                reply.insert("id".into(), body["id"].clone());
                Value::Object(reply).to_string().into_bytes()
            })
            .create_async()
            .await;

        let provider =
            ProviderBuilder::new().on_client(evm_rpc_client(server.url().parse().unwrap()));
        let whitelister = EvmWhitelister::new(CHAIN_ID, REGISTRY, provider, Address::ZERO);
        let store = FakeStore::default();
        let candidates = vec![WhitelistCandidate {
            wallet_address: KYT_FAILED.to_owned(),
        }];
        let backoff = &whitelister.revoke_backoff;
        process_disallows(&whitelister, &store, CHAIN_ID, Ok(candidates), 10, backoff).await;

        let sent = sent.lock().unwrap().clone();
        let disallowed = store.disallowed.lock().unwrap().clone();
        (sent, disallowed)
    }

    #[tokio::test]
    async fn kyt_failed_allowed_wallet_gets_a_registry_disallow_and_no_db_flag_until_confirmed() {
        let (sent, disallowed) = disallow_pass(true).await;
        assert_eq!(sent.len(), 1, "{sent:?}");
        let tx = &sent[0];
        assert_eq!(
            tx["to"].as_str().unwrap().parse::<Address>().unwrap(),
            REGISTRY
        );
        let input = tx.get("input").or_else(|| tx.get("data")).unwrap();
        let expected = WhitelistRegistry::disallowCall {
            user: KYT_FAILED.parse().unwrap(),
        }
        .abi_encode();
        assert_eq!(
            input.as_str().unwrap(),
            format!("0x{}", alloy::hex::encode(expected))
        );
        assert!(disallowed.is_empty(), "{disallowed:?}");
    }

    #[tokio::test]
    async fn kyt_failed_wallet_the_registry_no_longer_allows_is_recorded_without_a_tx() {
        let (sent, disallowed) = disallow_pass(false).await;
        assert!(sent.is_empty(), "{sent:?}");
        assert_eq!(disallowed, [(CHAIN_ID, KYT_FAILED.to_owned())]);
    }
}
