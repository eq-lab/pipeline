//! On-chain revocation shared by the EVM and Stellar disallow passes (TD-31, TD-184).
//! spec: docs/product-specs/relayer-service.md (KYT failure revocation)

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Instant;

use anyhow::Result;
use async_trait::async_trait;
use shared::kyc_repo::{KycRepo, WhitelistCandidate};

use crate::indexer::supervise::backoff_delay;

// shortcut: in memory only, so a restart retries every failing wallet once more (still capped
// per tick); persist it in the DB if restarts become frequent.
pub type RevokeBackoff = Mutex<HashMap<String, (u32, Instant)>>;

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
    backoff: &RevokeBackoff,
    clock: impl Fn() -> Instant,
) -> Vec<String> {
    let mut retry = std::mem::take(&mut *backoff.lock().unwrap());
    let candidates: HashSet<&String> = wallets.iter().collect();
    retry.retain(|w, _| candidates.contains(w));
    let (mut submitted, mut failed) = (0usize, 0usize);
    let mut confirmed = vec![];
    for wallet in wallets {
        if retry.get(&wallet).is_some_and(|(_, at)| clock() < *at) {
            continue;
        }
        match chain.is_authorized(&wallet).await {
            Ok(false) => {
                retry.remove(&wallet);
                confirmed.push(wallet);
                continue;
            }
            Ok(true) => {}
            Err(e) => {
                tracing::warn!(chain_id, %wallet, error = %e, "revoke: authorization check failed, submitting");
            }
        }
        if submitted >= batch_size || failed >= batch_size {
            break;
        }
        match chain.revoke(&wallet).await {
            Ok(()) => {
                submitted += 1;
                retry.remove(&wallet);
                tracing::info!(chain_id, %wallet, "revoke: on-chain revocation confirmed");
                confirmed.push(wallet);
            }
            Err(e) => {
                failed += 1;
                let failures = retry.get(&wallet).map_or(0, |(n, _)| *n) + 1;
                let delay = backoff_delay(failures);
                tracing::error!(chain_id, %wallet, error = %e, failures, retry_in_secs = delay.as_secs(), "revoke: tx failed, backing off");
                retry.insert(wallet, (failures, clock() + delay));
            }
        }
    }
    *backoff.lock().unwrap() = retry;
    confirmed
}

pub async fn process_disallows(
    chain: &impl Revoker,
    kyc_repo: &(impl DisallowStore + ?Sized),
    chain_id: i64,
    candidates: Result<Vec<WhitelistCandidate>>,
    batch_size: usize,
    backoff: &RevokeBackoff,
) {
    let candidates = match candidates {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(chain_id, error = %e, "failed to fetch profiles to disallow");
            return;
        }
    };
    let wallets = candidates.into_iter().map(|c| c.wallet_address).collect();
    let confirmed =
        revoke_confirmed(chain, chain_id, wallets, batch_size, backoff, Instant::now).await;
    for wallet in confirmed {
        if let Err(e) = kyc_repo.set_disallowed(chain_id, &wallet).await {
            tracing::error!(chain_id, %wallet, error = %e, "failed to set_disallowed in DB");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{process_disallows, revoke_confirmed, DisallowStore, RevokeBackoff, Revoker};
    use async_trait::async_trait;
    use shared::kyc_repo::WhitelistCandidate;
    use std::cell::RefCell;
    use std::future::{ready, Future};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    struct FakeChain {
        authorized: RefCell<Vec<&'static str>>,
        failing: RefCell<Vec<&'static str>>,
        attempts: RefCell<usize>,
        revoked: RefCell<Vec<String>>,
    }

    impl FakeChain {
        fn new(authorized: &[&'static str]) -> Self {
            Self {
                authorized: RefCell::new(authorized.to_vec()),
                failing: RefCell::new(vec![]),
                attempts: RefCell::new(0),
                revoked: RefCell::new(vec![]),
            }
        }
    }

    impl Revoker for FakeChain {
        fn is_authorized(&self, wallet: &str) -> impl Future<Output = anyhow::Result<bool>> {
            ready(Ok(self.authorized.borrow().contains(&wallet)))
        }

        fn revoke(&self, wallet: &str) -> impl Future<Output = anyhow::Result<()>> {
            *self.attempts.borrow_mut() += 1;
            if self.failing.borrow().contains(&wallet) {
                return ready(Err(anyhow::anyhow!("rpc down")));
            }
            self.authorized.borrow_mut().retain(|w| *w != wallet);
            self.revoked.borrow_mut().push(wallet.to_owned());
            ready(Ok(()))
        }
    }

    async fn tick(
        chain: &FakeChain,
        ws: &[&str],
        batch_size: usize,
        backoff: &RevokeBackoff,
        at: Instant,
    ) -> Vec<String> {
        let ws = ws.iter().map(|w| (*w).to_owned()).collect();
        revoke_confirmed(chain, 1, ws, batch_size, backoff, || at).await
    }

    #[tokio::test]
    async fn authorized_wallet_is_revoked_on_chain_before_it_is_confirmed() {
        let chain = FakeChain::new(&["A"]);
        let confirmed = tick(
            &chain,
            &["A"],
            10,
            &RevokeBackoff::default(),
            Instant::now(),
        )
        .await;
        assert_eq!(*chain.revoked.borrow(), ["A"]);
        assert_eq!(confirmed, ["A"]);
    }

    #[tokio::test]
    async fn unauthorized_wallet_is_confirmed_without_a_tx() {
        let chain = FakeChain::new(&[]);
        let confirmed = tick(
            &chain,
            &["A"],
            10,
            &RevokeBackoff::default(),
            Instant::now(),
        )
        .await;
        assert!(chain.revoked.borrow().is_empty());
        assert_eq!(confirmed, ["A"]);
    }

    #[tokio::test]
    async fn failed_revoke_is_backed_off_then_retried() {
        let chain = FakeChain::new(&["A"]);
        let backoff = RevokeBackoff::default();
        let t0 = Instant::now();
        chain.failing.replace(vec!["A"]);
        assert!(tick(&chain, &["A"], 10, &backoff, t0).await.is_empty());
        chain.failing.replace(vec![]);
        assert!(
            tick(&chain, &["A"], 10, &backoff, t0 + Duration::from_secs(59))
                .await
                .is_empty()
        );
        assert_eq!(*chain.attempts.borrow(), 1);
        let confirmed = tick(&chain, &["A"], 10, &backoff, t0 + Duration::from_mins(1)).await;
        assert_eq!(confirmed, ["A"]);
        assert_eq!(*chain.revoked.borrow(), ["A"]);
    }

    #[tokio::test]
    async fn backoff_doubles_while_the_revoke_keeps_failing() {
        let chain = FakeChain::new(&["A"]);
        chain.failing.replace(vec!["A"]);
        let backoff = RevokeBackoff::default();
        let t0 = Instant::now();
        tick(&chain, &["A"], 10, &backoff, t0).await;
        tick(&chain, &["A"], 10, &backoff, t0 + Duration::from_mins(1)).await;
        tick(&chain, &["A"], 10, &backoff, t0 + Duration::from_mins(2)).await;
        assert_eq!(*chain.attempts.borrow(), 2);
        tick(&chain, &["A"], 10, &backoff, t0 + Duration::from_mins(3)).await;
        assert_eq!(*chain.attempts.borrow(), 3);
    }

    #[tokio::test]
    async fn submissions_stop_at_the_batch_size() {
        let chain = FakeChain::new(&["A", "B"]);
        let confirmed = tick(
            &chain,
            &["A", "B"],
            1,
            &RevokeBackoff::default(),
            Instant::now(),
        )
        .await;
        assert_eq!(confirmed, ["A"]);
    }

    #[tokio::test]
    async fn failed_attempts_per_tick_stop_at_the_batch_size() {
        let chain = FakeChain::new(&["A", "B", "C"]);
        chain.failing.replace(vec!["A", "B", "C"]);
        tick(
            &chain,
            &["A", "B", "C"],
            2,
            &RevokeBackoff::default(),
            Instant::now(),
        )
        .await;
        assert_eq!(*chain.attempts.borrow(), 2);
    }

    #[tokio::test]
    async fn backed_off_wallets_do_not_starve_the_rest() {
        let chain = FakeChain::new(&["bad", "B"]);
        chain.failing.replace(vec!["bad"]);
        let backoff = RevokeBackoff::default();
        let t0 = Instant::now();
        assert!(tick(&chain, &["bad", "B"], 1, &backoff, t0)
            .await
            .is_empty());
        assert_eq!(tick(&chain, &["bad", "B"], 1, &backoff, t0).await, ["B"]);
    }

    #[tokio::test]
    async fn backoff_is_dropped_for_wallets_no_longer_in_the_candidates() {
        let chain = FakeChain::new(&["A"]);
        chain.failing.replace(vec!["A"]);
        let backoff = RevokeBackoff::default();
        let t0 = Instant::now();
        tick(&chain, &["A"], 10, &backoff, t0).await;
        tick(&chain, &[], 10, &backoff, t0).await;
        tick(&chain, &["A"], 10, &backoff, t0).await;
        assert_eq!(*chain.attempts.borrow(), 2);
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
        chain.failing.replace(vec!["A"]);

        let backoff = RevokeBackoff::default();
        process_disallows(&chain, &store, 7, Ok(candidates(&["A"])), 10, &backoff).await;
        assert!(store.disallowed.lock().unwrap().is_empty());

        chain.failing.replace(vec![]);
        let backoff = RevokeBackoff::default();
        process_disallows(&chain, &store, 7, Ok(candidates(&["A"])), 10, &backoff).await;
        assert_eq!(*chain.revoked.borrow(), ["A"]);
        assert_eq!(*store.disallowed.lock().unwrap(), [(7, "A".to_owned())]);
    }

    #[tokio::test]
    async fn candidate_fetch_error_touches_neither_chain_nor_db() {
        let chain = FakeChain::new(&["A"]);
        let store = FakeStore::default();
        let backoff = RevokeBackoff::default();
        process_disallows(
            &chain,
            &store,
            7,
            Err(anyhow::anyhow!("db down")),
            10,
            &backoff,
        )
        .await;
        assert!(chain.revoked.borrow().is_empty());
        assert!(store.disallowed.lock().unwrap().is_empty());
    }
}
