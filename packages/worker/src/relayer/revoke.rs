//! On-chain revocation shared by the EVM and Stellar disallow passes (TD-31, TD-184).
//! spec: docs/product-specs/relayer-service.md (KYT failure revocation)

use anyhow::Result;
use async_trait::async_trait;
use shared::kyc_repo::{KycRepo, WhitelistCandidate};

/// Where a confirmed revocation is recorded (`on_chain_allowed = FALSE`).
#[async_trait]
pub trait DisallowStore: Send + Sync {
    async fn set_disallowed(&self, chain_id: i64, wallet_address: &str) -> Result<()>;
}

#[async_trait]
impl DisallowStore for KycRepo {
    async fn set_disallowed(&self, chain_id: i64, wallet_address: &str) -> Result<()> {
        KycRepo::set_disallowed(self, chain_id, wallet_address).await
    }
}

pub trait Revoker {
    fn is_authorized(&self, wallet: &str) -> impl std::future::Future<Output = Result<bool>>;
    fn revoke(&self, wallet: &str) -> impl std::future::Future<Output = Result<()>>;
}

pub async fn revoke_confirmed(
    chain: &impl Revoker,
    chain_id: i64,
    wallets: Vec<String>,
    batch_size: usize,
) -> Vec<String> {
    let mut submitted = 0usize;
    let mut confirmed = vec![];
    for wallet in wallets {
        match chain.is_authorized(&wallet).await {
            Ok(false) => {
                confirmed.push(wallet);
                continue;
            }
            Ok(true) => {}
            Err(e) => {
                tracing::warn!(chain_id, %wallet, error = %e, "revoke: authorization check failed, submitting");
            }
        }
        if submitted >= batch_size {
            break;
        }
        match chain.revoke(&wallet).await {
            Ok(()) => {
                submitted += 1;
                tracing::info!(chain_id, %wallet, "revoke: on-chain revocation confirmed");
                confirmed.push(wallet);
            }
            Err(e) => {
                tracing::error!(chain_id, %wallet, error = %e, "revoke: tx failed, will retry next iteration");
            }
        }
    }
    confirmed
}

pub async fn process_disallows(
    chain: &impl Revoker,
    kyc_repo: &(impl DisallowStore + ?Sized),
    chain_id: i64,
    candidates: Result<Vec<WhitelistCandidate>>,
    batch_size: usize,
) {
    let candidates = match candidates {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(chain_id, error = %e, "failed to fetch profiles to disallow");
            return;
        }
    };
    let wallets = candidates.into_iter().map(|c| c.wallet_address).collect();
    for wallet in revoke_confirmed(chain, chain_id, wallets, batch_size).await {
        if let Err(e) = kyc_repo.set_disallowed(chain_id, &wallet).await {
            tracing::error!(chain_id, %wallet, error = %e, "failed to set_disallowed in DB");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{process_disallows, revoke_confirmed, DisallowStore, Revoker};
    use async_trait::async_trait;
    use shared::kyc_repo::WhitelistCandidate;
    use std::cell::RefCell;
    use std::future::{ready, Future};
    use std::sync::Mutex;

    struct FakeChain {
        authorized: RefCell<Vec<&'static str>>,
        fail_next_revoke: RefCell<bool>,
        revoked: RefCell<Vec<String>>,
    }

    impl FakeChain {
        fn new(authorized: &[&'static str]) -> Self {
            Self {
                authorized: RefCell::new(authorized.to_vec()),
                fail_next_revoke: RefCell::new(false),
                revoked: RefCell::new(vec![]),
            }
        }
    }

    impl Revoker for FakeChain {
        fn is_authorized(&self, wallet: &str) -> impl Future<Output = anyhow::Result<bool>> {
            ready(Ok(self.authorized.borrow().contains(&wallet)))
        }

        fn revoke(&self, wallet: &str) -> impl Future<Output = anyhow::Result<()>> {
            if self.fail_next_revoke.replace(false) {
                return ready(Err(anyhow::anyhow!("rpc down")));
            }
            self.authorized.borrow_mut().retain(|w| *w != wallet);
            self.revoked.borrow_mut().push(wallet.to_owned());
            ready(Ok(()))
        }
    }

    fn wallets(ws: &[&str]) -> Vec<String> {
        ws.iter().map(|w| (*w).to_owned()).collect()
    }

    #[tokio::test]
    async fn authorized_wallet_is_revoked_on_chain_before_it_is_confirmed() {
        let chain = FakeChain::new(&["A"]);
        let confirmed = revoke_confirmed(&chain, 1, wallets(&["A"]), 10).await;
        assert_eq!(*chain.revoked.borrow(), ["A"]);
        assert_eq!(confirmed, ["A"]);
    }

    #[tokio::test]
    async fn unauthorized_wallet_is_confirmed_without_a_tx() {
        let chain = FakeChain::new(&[]);
        let confirmed = revoke_confirmed(&chain, 1, wallets(&["A"]), 10).await;
        assert!(chain.revoked.borrow().is_empty());
        assert_eq!(confirmed, ["A"]);
    }

    #[tokio::test]
    async fn failed_revoke_is_not_confirmed_and_succeeds_on_the_next_tick() {
        let chain = FakeChain::new(&["A"]);
        chain.fail_next_revoke.replace(true);
        assert!(revoke_confirmed(&chain, 1, wallets(&["A"]), 10)
            .await
            .is_empty());
        assert_eq!(
            revoke_confirmed(&chain, 1, wallets(&["A"]), 10).await,
            ["A"]
        );
        assert_eq!(*chain.revoked.borrow(), ["A"]);
    }

    #[tokio::test]
    async fn submissions_stop_at_the_batch_size() {
        let chain = FakeChain::new(&["A", "B"]);
        let confirmed = revoke_confirmed(&chain, 1, wallets(&["A", "B"]), 1).await;
        assert_eq!(confirmed, ["A"]);
    }

    #[tokio::test]
    async fn failing_wallets_do_not_use_up_the_batch() {
        let chain = FakeChain::new(&["bad", "B"]);
        chain.fail_next_revoke.replace(true);
        let confirmed = revoke_confirmed(&chain, 1, wallets(&["bad", "B"]), 1).await;
        assert_eq!(confirmed, ["B"]);
    }

    #[derive(Default)]
    struct FakeStore {
        disallowed: Mutex<Vec<(i64, String)>>,
    }

    #[async_trait]
    impl DisallowStore for FakeStore {
        async fn set_disallowed(&self, chain_id: i64, wallet_address: &str) -> anyhow::Result<()> {
            self.disallowed
                .lock()
                .unwrap()
                .push((chain_id, wallet_address.to_owned()));
            Ok(())
        }
    }

    fn candidates(ws: &[&str]) -> Vec<WhitelistCandidate> {
        ws.iter()
            .map(|w| WhitelistCandidate {
                wallet_address: (*w).to_owned(),
            })
            .collect()
    }

    #[tokio::test]
    async fn db_flag_is_cleared_only_after_the_revoke_is_confirmed() {
        let chain = FakeChain::new(&["A"]);
        let store = FakeStore::default();
        chain.fail_next_revoke.replace(true);

        process_disallows(&chain, &store, 7, Ok(candidates(&["A"])), 10).await;
        assert!(store.disallowed.lock().unwrap().is_empty());

        process_disallows(&chain, &store, 7, Ok(candidates(&["A"])), 10).await;
        assert_eq!(*chain.revoked.borrow(), ["A"]);
        assert_eq!(*store.disallowed.lock().unwrap(), [(7, "A".to_owned())]);
    }

    #[tokio::test]
    async fn candidate_fetch_error_touches_neither_chain_nor_db() {
        let chain = FakeChain::new(&["A"]);
        let store = FakeStore::default();
        process_disallows(&chain, &store, 7, Err(anyhow::anyhow!("db down")), 10).await;
        assert!(chain.revoked.borrow().is_empty());
        assert!(store.disallowed.lock().unwrap().is_empty());
    }
}
