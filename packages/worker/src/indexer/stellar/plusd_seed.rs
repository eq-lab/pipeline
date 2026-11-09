// spec: docs/references/backend.md#plusd-balance-seed
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use stellar_strkey::ed25519::PublicKey as Ed25519Pub;
use stellar_xdr::curr::ScVal;

use shared::contract_logs_repo::ContractLogsRepo;
use shared::db::EventRepo;
use shared::plusd_seed::{balance_from_sums, parse_seed};
use shared::plusd_seed_repo::PlusdSeedRepo;

use crate::indexer::stellar::loan_registry_reader::{simulate_call, simulate_value};
use crate::indexer::stellar::rpc::{SimulateResponse, StellarRpc};
use crate::indexer::stellar::security_registry_views::is_contract_error;
use crate::indexer::stellar::supervise::SeedBackoff;
use crate::stellar::scval::i128_from_parts;
use crate::stellar::tx::address_account;

pub const PLUSD_SEED_INTERVAL: Duration = Duration::from_mins(1);
pub const MAX_SEEDS_PER_CYCLE: usize = 50;
pub const CANDIDATE_FETCH: i64 = 500;
pub const MAX_VERIFY_READS_PER_CYCLE: usize = 10;
pub const PLUSD_VERIFY_INTERVAL: Duration = Duration::from_hours(6);
pub const PLUSD_IDLE_INTERVAL_CAP: Duration = Duration::from_mins(5);
pub const UNSEEDABLE_TTL: Duration = Duration::from_hours(24);
pub const FULL_SCAN_EVERY: u32 = 60;
pub const NO_BALANCE_CODE: u32 = 13;

pub type HolderKey = [u8; 32];

pub fn holder_key(holder: &str) -> Option<HolderKey> {
    Ed25519Pub::from_string(holder).ok().map(|k| k.0)
}

pub fn holder_string(key: &HolderKey) -> String {
    Ed25519Pub(*key).to_string().as_str().to_owned()
}

pub fn balance_args(key: HolderKey) -> Vec<ScVal> {
    vec![address_account(&Ed25519Pub(key))]
}

pub fn decode_balance(value: &ScVal) -> Result<i128> {
    match value {
        ScVal::I128(parts) => {
            let v = i128_from_parts(parts.hi, parts.lo);
            if v < 0 {
                Err(anyhow!("PLUSD balance is negative: {v}"))
            } else {
                Ok(v)
            }
        }
        other => Err(anyhow!("PLUSD balance: expected I128, got {other:?}")),
    }
}

pub fn is_no_balance_error(msg: &str) -> bool {
    is_contract_error(msg, NO_BALANCE_CODE)
}

pub fn is_issuer_balance(balance: i128) -> bool {
    balance == i128::from(i64::MAX)
}

pub fn balance_from_sim(sim: &SimulateResponse) -> Result<(i128, u64)> {
    match simulate_value(sim, "balance") {
        Ok(value) => Ok((decode_balance(&value)?, sim.latest_ledger)),
        Err(e) if is_no_balance_error(&e.to_string()) => Ok((0, sim.latest_ledger)),
        Err(e) => Err(e),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyOutcome {
    Matched,
    Drift,
}

pub fn verify_outcome(expected: Option<i128>, actual: i128) -> VerifyOutcome {
    if expected == Some(actual) {
        VerifyOutcome::Matched
    } else {
        VerifyOutcome::Drift
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingRead {
    pub balance: i128,
    pub ledger: u64,
    pub ts: i64,
}

#[derive(Default)]
pub struct VerifySchedule {
    holders: BTreeSet<HolderKey>,
    next: HashMap<HolderKey, Instant>,
    pending: HashMap<HolderKey, PendingRead>,
}

impl VerifySchedule {
    pub fn track(&mut self, key: HolderKey) {
        self.holders.insert(key);
    }

    pub fn due(
        &self,
        now: Instant,
        cap: usize,
        allowed: impl Fn(&HolderKey) -> bool,
    ) -> Vec<HolderKey> {
        self.holders
            .iter()
            .filter(|k| !self.pending.contains_key(*k))
            .filter(|k| self.next.get(*k).is_none_or(|at| now >= *at))
            .filter(|k| allowed(k))
            .take(cap)
            .copied()
            .collect()
    }

    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    pub fn record(&mut self, key: HolderKey, read: PendingRead) {
        self.pending.insert(key, read);
    }

    pub fn ready(&mut self, cursor: u64) -> Vec<(HolderKey, PendingRead)> {
        let mut out: Vec<(HolderKey, PendingRead)> = self
            .pending
            .iter()
            .filter(|(_, r)| r.ledger < cursor)
            .map(|(k, r)| (*k, *r))
            .collect();
        out.sort_by_key(|(k, r)| (r.ledger, *k));
        for (k, _) in &out {
            self.pending.remove(k);
        }
        out
    }

    pub fn schedule(&mut self, key: HolderKey, now: Instant) {
        self.next.insert(key, now + PLUSD_VERIFY_INTERVAL);
    }
}

pub type PlusdSeedBackoff = SeedBackoff<HolderKey>;

#[derive(Default)]
pub struct UnseedableSet(HashMap<String, Instant>);

impl UnseedableSet {
    pub fn insert(&mut self, holder: String, now: Instant) {
        self.0.insert(holder, now + UNSEEDABLE_TTL);
    }

    pub fn active(&mut self, now: Instant) -> Vec<String> {
        self.0.retain(|_, until| *until > now);
        self.0.keys().cloned().collect()
    }
}

pub fn next_interval(current: Duration, idle: bool) -> Duration {
    if idle {
        current.saturating_mul(2).min(PLUSD_IDLE_INTERVAL_CAP)
    } else {
        PLUSD_SEED_INTERVAL
    }
}

pub struct PlusdSeedCtx {
    pub rpc: Arc<StellarRpc>,
    pub seeds: PlusdSeedRepo,
    pub logs: ContractLogsRepo,
    pub events: EventRepo,
    pub chain_id: i64,
    pub plusd_id: String,
}

#[derive(Default)]
pub struct PlusdSeedState {
    pub backoff: PlusdSeedBackoff,
    pub schedule: VerifySchedule,
    pub unseedable: UnseedableSet,
    pub watermark: i64,
    pub cycles: u32,
    pub loaded: bool,
}

async fn read_balance(
    rpc: &StellarRpc,
    plusd_id: &str,
    key: HolderKey,
) -> Result<(i128, u64, i64)> {
    let sim = simulate_call(rpc, plusd_id, "balance", balance_args(key)).await?;
    let ts = chrono::Utc::now().timestamp();
    let (balance, ledger) = balance_from_sim(&sim)?;
    Ok((balance, ledger, ts))
}

fn warn_once(first: bool, chain_id: i64, holder: &str, what: &str, e: &anyhow::Error) {
    if first {
        tracing::warn!(chain_id, holder, error = %e, "{what}");
    } else {
        tracing::debug!(chain_id, holder, error = %e, "{what}");
    }
}

async fn seed_cycle(ctx: &PlusdSeedCtx, state: &mut PlusdSeedState) -> Result<usize> {
    let cursor = ctx.events.get_cursor(ctx.chain_id).await?;
    let after = if state.cycles.is_multiple_of(FULL_SCAN_EVERY) {
        0
    } else {
        state.watermark
    };
    state.cycles = state.cycles.wrapping_add(1);
    let excluded = state.unseedable.active(Instant::now());
    let candidates = ctx
        .seeds
        .list_candidates(
            ctx.chain_id,
            &ctx.plusd_id,
            CANDIDATE_FETCH,
            after,
            &excluded,
        )
        .await?;
    let found = candidates.len();
    let mut clean = found < CANDIDATE_FETCH as usize;
    let mut attempted = 0usize;
    for holder in candidates {
        let Some(key) = holder_key(&holder) else {
            state.unseedable.insert(holder, Instant::now());
            continue;
        };
        if !state.backoff.is_due(key, Instant::now()) {
            clean = false;
            continue;
        }
        if attempted >= MAX_SEEDS_PER_CYCLE {
            clean = false;
            break;
        }
        attempted += 1;
        match read_balance(&ctx.rpc, &ctx.plusd_id, key).await {
            Ok((balance, _, _)) if is_issuer_balance(balance) => {
                state.unseedable.insert(holder.clone(), Instant::now());
                tracing::debug!(
                    chain_id = ctx.chain_id,
                    holder,
                    "PLUSD issuer is not a holder"
                );
            }
            Ok((balance, ledger, ts)) => {
                let stored = ctx
                    .seeds
                    .insert(
                        ctx.chain_id,
                        &ctx.plusd_id,
                        &holder,
                        ledger as i64,
                        ts,
                        balance,
                        "initial",
                    )
                    .await;
                match stored {
                    Ok(stored) => {
                        state.backoff.clear(key);
                        state.schedule.track(key);
                        state.schedule.schedule(key, Instant::now());
                        if stored {
                            tracing::debug!(
                                chain_id = ctx.chain_id,
                                holder,
                                ledger,
                                "PLUSD balance seed stored"
                            );
                        }
                    }
                    Err(e) => {
                        clean = false;
                        state.backoff.record_failure(key, Instant::now());
                        let first = state.backoff.first_insert_warning(key);
                        warn_once(first, ctx.chain_id, &holder, "PLUSD seed insert failed", &e);
                    }
                }
            }
            Err(e) => {
                clean = false;
                state.backoff.record_failure(key, Instant::now());
                let first = state.backoff.first_read_warning(key);
                warn_once(first, ctx.chain_id, &holder, "PLUSD seed read failed", &e);
            }
        }
    }
    if clean {
        state.watermark = i64::try_from(cursor.saturating_sub(1)).unwrap_or(0);
    }
    Ok(found)
}

async fn compare_read(ctx: &PlusdSeedCtx, key: HolderKey, read: PendingRead) -> Result<()> {
    let holder = holder_string(&key);
    let ledger = read.ledger as i64;
    let Some(row) = ctx
        .seeds
        .latest(ctx.chain_id, &ctx.plusd_id, &holder)
        .await?
    else {
        return Ok(());
    };
    let Some(seed) = parse_seed(&row) else {
        tracing::warn!(
            chain_id = ctx.chain_id,
            holder,
            "PLUSD seed row malformed; skipping verify"
        );
        return Ok(());
    };
    if seed.as_of_ledger >= ledger {
        return Ok(());
    }
    let sums = ctx
        .logs
        .plusd_window_sums(
            ctx.chain_id,
            &ctx.plusd_id,
            &holder,
            seed.as_of_ledger,
            ledger,
        )
        .await?;
    let expected = balance_from_sums(seed.balance, &sums);
    match verify_outcome(expected, read.balance) {
        VerifyOutcome::Matched => {
            tracing::debug!(
                chain_id = ctx.chain_id,
                holder,
                ledger,
                "PLUSD balance verified"
            );
        }
        VerifyOutcome::Drift => {
            let difference = expected.and_then(|e| read.balance.checked_sub(e));
            tracing::warn!(
                chain_id = ctx.chain_id,
                holder,
                ledger,
                expected = ?expected,
                actual = read.balance,
                difference = ?difference,
                "PLUSD balance drift; re-anchoring seed"
            );
            ctx.seeds
                .insert(
                    ctx.chain_id,
                    &ctx.plusd_id,
                    &holder,
                    ledger,
                    read.ts,
                    read.balance,
                    "reanchor",
                )
                .await?;
        }
    }
    Ok(())
}

async fn verify_cycle(ctx: &PlusdSeedCtx, state: &mut PlusdSeedState) -> Result<()> {
    if !state.loaded {
        for holder in ctx
            .seeds
            .seeded_holders(ctx.chain_id, &ctx.plusd_id)
            .await?
        {
            if let Some(key) = holder_key(&holder) {
                state.schedule.track(key);
            }
        }
        state.loaded = true;
    }
    let now = Instant::now();
    let backoff = &state.backoff;
    let due = state
        .schedule
        .due(now, MAX_VERIFY_READS_PER_CYCLE, |k| backoff.is_due(*k, now));
    for key in due {
        let holder = holder_string(&key);
        match read_balance(&ctx.rpc, &ctx.plusd_id, key).await {
            Ok((balance, ledger, ts)) if !is_issuer_balance(balance) => {
                state.backoff.clear(key);
                state.schedule.record(
                    key,
                    PendingRead {
                        balance,
                        ledger,
                        ts,
                    },
                );
            }
            Ok(_) => state.schedule.schedule(key, Instant::now()),
            Err(e) => {
                state.backoff.record_failure(key, Instant::now());
                let first = state.backoff.first_verify_warning(key);
                warn_once(first, ctx.chain_id, &holder, "PLUSD verify read failed", &e);
            }
        }
    }

    if !state.schedule.has_pending() {
        return Ok(());
    }
    let cursor = ctx.events.get_cursor(ctx.chain_id).await?;
    for (key, read) in state.schedule.ready(cursor) {
        match compare_read(ctx, key, read).await {
            Ok(()) => state.schedule.schedule(key, Instant::now()),
            Err(e) => {
                state.schedule.record(key, read);
                tracing::warn!(
                    chain_id = ctx.chain_id,
                    holder = holder_string(&key),
                    error = %e,
                    "PLUSD verify compare failed; retrying"
                );
            }
        }
    }
    Ok(())
}

pub async fn run_plusd_seed_loop(ctx: PlusdSeedCtx) {
    let mut state = PlusdSeedState::default();
    let mut interval = PLUSD_SEED_INTERVAL;
    loop {
        let found = seed_cycle(&ctx, &mut state).await.unwrap_or_else(|e| {
            tracing::warn!(chain_id = ctx.chain_id, error = %e, "PLUSD seed cycle failed");
            1
        });
        if let Err(e) = verify_cycle(&ctx, &mut state).await {
            tracing::warn!(chain_id = ctx.chain_id, error = %e, "PLUSD verify cycle failed");
        }
        interval = next_interval(interval, found == 0);
        tokio::time::sleep(interval).await;
    }
}
