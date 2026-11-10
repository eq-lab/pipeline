// spec: docs/references/security-registry-events.md#sync-loop
use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::time::{Duration, Instant};

pub const BACKOFF_BASE: Duration = Duration::from_mins(1);
pub const BACKOFF_CAP: Duration = Duration::from_hours(1);
pub const RESTART_BASE: Duration = Duration::from_secs(30);
pub const RESTART_CAP: Duration = Duration::from_mins(10);
pub const HEALTHY_RUN: Duration = Duration::from_mins(10);

pub fn backoff_delay(failures: u32) -> Duration {
    let exp = failures.saturating_sub(1).min(16);
    BACKOFF_BASE.saturating_mul(1u32 << exp).min(BACKOFF_CAP)
}

pub fn restart_delay(failures: u32) -> Duration {
    let exp = failures.saturating_sub(1).min(16);
    RESTART_BASE.saturating_mul(1u32 << exp).min(RESTART_CAP)
}

pub struct KeyedBackoff<K> {
    entries: HashMap<K, (u32, Instant)>,
    warned: HashMap<K, u8>,
}

impl<K> Default for KeyedBackoff<K> {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            warned: HashMap::new(),
        }
    }
}

impl<K: Hash + Eq + Copy> KeyedBackoff<K> {
    pub fn is_due(&self, key: K, now: Instant) -> bool {
        self.entries.get(&key).is_none_or(|(_, next)| now >= *next)
    }

    pub fn record_failure(&mut self, key: K, now: Instant) -> u32 {
        let entry = self.entries.entry(key).or_insert((0, now));
        entry.0 += 1;
        entry.1 = now + backoff_delay(entry.0);
        entry.0
    }

    pub fn clear(&mut self, key: K) {
        self.entries.remove(&key);
        self.warned.remove(&key);
    }

    pub fn failures(&self, key: K) -> u32 {
        self.entries.get(&key).map_or(0, |(n, _)| *n)
    }

    pub fn first_warning(&mut self, key: K) -> bool {
        self.first_warning_on(key, 0)
    }

    pub fn first_warning_on(&mut self, key: K, channel: u8) -> bool {
        let bit = 1u8 << (channel & 7);
        let seen = self.warned.entry(key).or_insert(0);
        let first = *seen & bit == 0;
        *seen |= bit;
        first
    }
}

pub struct SeedBackoff<K>(KeyedBackoff<K>);

impl<K> Default for SeedBackoff<K> {
    fn default() -> Self {
        Self(KeyedBackoff::default())
    }
}

impl<K: Hash + Eq + Copy> SeedBackoff<K> {
    pub fn is_due(&self, key: K, now: Instant) -> bool {
        self.0.is_due(key, now)
    }

    pub fn record_failure(&mut self, key: K, now: Instant) -> u32 {
        self.0.record_failure(key, now)
    }

    pub fn clear(&mut self, key: K) {
        self.0.clear(key);
    }

    pub fn first_read_warning(&mut self, key: K) -> bool {
        self.0.first_warning_on(key, 0)
    }

    pub fn first_insert_warning(&mut self, key: K) -> bool {
        self.0.first_warning_on(key, 1)
    }

    pub fn first_verify_warning(&mut self, key: K) -> bool {
        self.0.first_warning_on(key, 2)
    }
}

pub struct AbortOnDrop(pub tokio::task::AbortHandle);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub fn spawn_supervised<F, Fut>(name: &'static str, chain_id: i64, make: F) -> AbortOnDrop
where
    F: Fn() -> Fut + Send + 'static,
    Fut: Future<Output = anyhow::Result<()>> + Send + 'static,
{
    let outer = tokio::spawn(async move {
        let mut failures = 0u32;
        loop {
            let started = Instant::now();
            let handle = tokio::spawn(make());
            let _inner = AbortOnDrop(handle.abort_handle());
            let result = handle.await;
            match result {
                Ok(Ok(())) => tracing::warn!(chain_id, task = name, "supervised task exited"),
                Ok(Err(e)) => {
                    tracing::error!(chain_id, task = name, error = %e, "supervised task failed");
                }
                Err(e) if e.is_panic() => {
                    tracing::error!(chain_id, task = name, error = %e, "supervised task panicked");
                }
                Err(_) => return,
            }
            if started.elapsed() >= HEALTHY_RUN {
                failures = 0;
            }
            failures += 1;
            tokio::time::sleep(restart_delay(failures)).await;
        }
    });
    AbortOnDrop(outer.abort_handle())
}
