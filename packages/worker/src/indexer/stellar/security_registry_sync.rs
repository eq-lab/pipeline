// spec: docs/references/security-registry-events.md#sync-loop
use std::collections::{BTreeSet, HashMap, HashSet};
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use async_trait::async_trait;
use chrono::Utc;
use futures::FutureExt;
use serde_json::Value;

use shared::db::EventRepo;
use shared::security_registry::{
    fold_loan, fold_registry_state, inspection_snapshot_needs, loan_snapshot_needs,
    record_snapshot_needs, valuation_due, valuation_row, ContractView, CoverageDetailView,
    InspectionView, LoanMoneyView, LoanView, RecordView, RegistryStateRow, Snapshot, TermsView,
    ValuationRow, SECURITY_PROJECTION_VERSION,
};
use shared::security_registry_repo::SecurityRegistryRepo;

use crate::indexer::stellar::rpc::StellarRpc;
use crate::indexer::stellar::security_registry_views::{
    contract_view, is_contract_error, RpcSecurityViewSource, SecurityViewSource,
    NO_INSPECTION_CODE, NO_RECORD_CODE,
};
use crate::indexer::stellar::supervise::KeyedBackoff;

pub const SECURITY_SYNC_INTERVAL: Duration = Duration::from_secs(30);
pub const VALUATION_MAX_AGE_SECS: i64 = 300;
pub const DISCOVERY_INTERVAL: Duration = Duration::from_hours(1);
pub const SNAPSHOT_MAX_LAG: u64 = 20;
pub const MAX_DISCOVERY_READS: usize = 200;
pub const VIEW_CALL_TIMEOUT: Duration = Duration::from_secs(20);
pub const STEP_BUDGET: Duration = Duration::from_secs(25);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum SnapshotKind {
    Record,
    Inspection,
    Loan,
    Contract,
    Valuation,
}

impl SnapshotKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SnapshotKind::Record => "record",
            SnapshotKind::Inspection => "inspection",
            SnapshotKind::Loan => "loan",
            SnapshotKind::Contract => "contract",
            SnapshotKind::Valuation => "valuation",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SnapshotWrite {
    pub kind: SnapshotKind,
    pub entity_id: u32,
    pub loan_id: Option<i64>,
    pub parent_record: Option<u32>,
    pub as_of_ledger: i64,
    pub payload: Value,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SnapshotNeeds {
    pub records: Vec<u32>,
    pub inspections: Vec<u32>,
    pub loans: Vec<u32>,
    pub contract: bool,
}

pub type PendingSnapshots = HashMap<(SnapshotKind, u32), SnapshotWrite>;

pub type SyncBackoff = KeyedBackoff<(SnapshotKind, u32)>;

fn fail(backoff: &mut SyncBackoff, key: (SnapshotKind, u32), now: Instant, e: &anyhow::Error) {
    backoff.record_failure(key, now);
    if backoff.first_warning(key) {
        tracing::warn!(kind = key.0.as_str(), id = key.1, error = %e, "security view read failed");
    } else {
        tracing::debug!(kind = key.0.as_str(), id = key.1, error = %e, "security view read failed");
    }
}

fn to_payload<T: serde::Serialize>(v: &T) -> Option<Value> {
    serde_json::to_value(v).ok()
}

async fn read_record(source: &dyn SecurityViewSource, id: u32) -> Result<Option<SnapshotWrite>> {
    let (view, ledger) = source.record(id).await?;
    Ok(to_payload(&view).map(|payload| SnapshotWrite {
        kind: SnapshotKind::Record,
        entity_id: id,
        loan_id: Some(i64::from(view.loan_id)),
        parent_record: None,
        as_of_ledger: ledger as i64,
        payload,
    }))
}

async fn read_inspection(
    source: &dyn SecurityViewSource,
    id: u32,
) -> Result<Option<SnapshotWrite>> {
    let (view, ledger) = source.inspection(id).await?;
    Ok(to_payload(&view).map(|payload| SnapshotWrite {
        kind: SnapshotKind::Inspection,
        entity_id: id,
        loan_id: None,
        parent_record: Some(view.record_id),
        as_of_ledger: ledger as i64,
        payload,
    }))
}

async fn read_loan(source: &dyn SecurityViewSource, id: u32) -> Result<Option<SnapshotWrite>> {
    let (terms, terms_ledger) = source.terms(id).await?;
    let (consents, consents_ledger) = source.extension_consents(id).await?;
    let view = LoanView {
        terms,
        terms_ledger: terms_ledger as i64,
        consents,
        consents_ledger: consents_ledger as i64,
    };
    Ok(to_payload(&view).map(|payload| SnapshotWrite {
        kind: SnapshotKind::Loan,
        entity_id: id,
        loan_id: Some(i64::from(id)),
        parent_record: None,
        as_of_ledger: view.terms_ledger.max(view.consents_ledger),
        payload,
    }))
}

async fn read_contract(source: &dyn SecurityViewSource) -> Result<Option<SnapshotWrite>> {
    let (paused, l1) = source.paused().await?;
    let (inspectors, l2) = source.inspectors().await?;
    let (loan_registry, l3) = source.loan_registry().await?;
    let view = contract_view(paused, inspectors, loan_registry);
    Ok(to_payload(&view).map(|payload| SnapshotWrite {
        kind: SnapshotKind::Contract,
        entity_id: 0,
        loan_id: None,
        parent_record: None,
        as_of_ledger: l1.min(l2).min(l3) as i64,
        payload,
    }))
}

async fn attempt(
    backoff: &mut SyncBackoff,
    key: (SnapshotKind, u32),
    now: Instant,
    out: &mut Vec<SnapshotWrite>,
    read: impl std::future::Future<Output = Result<Option<SnapshotWrite>>>,
) {
    if !backoff.is_due(key, now) {
        return;
    }
    match read.await {
        Ok(Some(write)) => {
            backoff.clear(key);
            out.push(write);
        }
        Ok(None) => backoff.clear(key),
        Err(e) => fail(backoff, key, now, &e),
    }
}

pub async fn read_snapshots(
    source: &dyn SecurityViewSource,
    needs: &SnapshotNeeds,
    backoff: &mut SyncBackoff,
    now: Instant,
) -> Vec<SnapshotWrite> {
    let mut out = Vec::new();
    for id in &needs.records {
        attempt(
            backoff,
            (SnapshotKind::Record, *id),
            now,
            &mut out,
            read_record(source, *id),
        )
        .await;
    }
    for id in &needs.inspections {
        attempt(
            backoff,
            (SnapshotKind::Inspection, *id),
            now,
            &mut out,
            read_inspection(source, *id),
        )
        .await;
    }
    for id in &needs.loans {
        attempt(
            backoff,
            (SnapshotKind::Loan, *id),
            now,
            &mut out,
            read_loan(source, *id),
        )
        .await;
    }
    if needs.contract {
        attempt(
            backoff,
            (SnapshotKind::Contract, 0),
            now,
            &mut out,
            read_contract(source),
        )
        .await;
    }
    out
}

pub async fn discover_records(
    source: &dyn SecurityViewSource,
    known: &BTreeSet<u32>,
    backoff: &mut SyncBackoff,
    now: Instant,
) -> Vec<SnapshotWrite> {
    let mut out = Vec::new();
    let mut reads = 0;
    let mut id = 1u32;
    while reads < MAX_DISCOVERY_READS {
        if known.contains(&id) {
            id += 1;
            continue;
        }
        let key = (SnapshotKind::Record, id);
        if !backoff.is_due(key, now) {
            break;
        }
        reads += 1;
        match read_record(source, id).await {
            Ok(Some(write)) => {
                backoff.clear(key);
                out.push(write);
            }
            Ok(None) => backoff.clear(key),
            Err(e) if is_contract_error(&e.to_string(), NO_RECORD_CODE) => break,
            Err(e) => {
                fail(backoff, key, now, &e);
                break;
            }
        }
        id += 1;
    }
    out
}

pub async fn discover_inspections(
    source: &dyn SecurityViewSource,
    known: &BTreeSet<u32>,
    backoff: &mut SyncBackoff,
    now: Instant,
) -> Vec<SnapshotWrite> {
    let mut out = Vec::new();
    let mut reads = 0;
    let mut id = 1u32;
    while reads < MAX_DISCOVERY_READS {
        if known.contains(&id) {
            id += 1;
            continue;
        }
        let key = (SnapshotKind::Inspection, id);
        if !backoff.is_due(key, now) {
            break;
        }
        reads += 1;
        match read_inspection(source, id).await {
            Ok(Some(write)) => {
                backoff.clear(key);
                out.push(write);
            }
            Ok(None) => backoff.clear(key),
            Err(e) if is_contract_error(&e.to_string(), NO_INSPECTION_CODE) => break,
            Err(e) => {
                fail(backoff, key, now, &e);
                break;
            }
        }
        id += 1;
    }
    out
}

pub fn hold(pending: &mut PendingSnapshots, writes: Vec<SnapshotWrite>) {
    for w in writes {
        let key = (w.kind, w.entity_id);
        if pending
            .get(&key)
            .is_none_or(|old| w.as_of_ledger >= old.as_of_ledger)
        {
            pending.insert(key, w);
        }
    }
}

pub fn release_ready(pending: &mut PendingSnapshots, cursor: u64) -> Vec<SnapshotWrite> {
    let ready: Vec<(SnapshotKind, u32)> = pending
        .iter()
        .filter(|(_, w)| w.as_of_ledger >= 0 && (w.as_of_ledger as u64) < cursor)
        .map(|(k, _)| *k)
        .collect();
    let mut out: Vec<SnapshotWrite> = ready.iter().filter_map(|k| pending.remove(k)).collect();
    out.sort_by_key(|w| (w.kind, w.entity_id));
    out
}

pub async fn read_valuation(
    source: &dyn SecurityViewSource,
    loan_registry: &str,
    loan_id: u32,
    source_log_id: i64,
    backoff: &mut SyncBackoff,
    now: Instant,
) -> Option<ValuationRow> {
    let key = (SnapshotKind::Valuation, loan_id);
    if !backoff.is_due(key, now) {
        return None;
    }
    let result: Result<(Snapshot<CoverageDetailView>, Snapshot<LoanMoneyView>)> = async {
        let (detail, l1) = source.coverage_detail(loan_id).await?;
        let (money, l2) = source.loan_money(loan_registry, loan_id).await?;
        Ok((
            Snapshot {
                as_of_ledger: l1 as i64,
                view: detail,
            },
            Snapshot {
                as_of_ledger: l2 as i64,
                view: money,
            },
        ))
    }
    .await;
    match result {
        Ok((detail, money)) => {
            let row = valuation_row(
                i64::from(loan_id),
                &detail,
                &money,
                loan_registry,
                source_log_id,
            );
            if row.is_some() {
                backoff.clear(key);
            } else {
                fail(
                    backoff,
                    key,
                    now,
                    &anyhow::anyhow!("valuation amounts unparsable"),
                );
            }
            row
        }
        Err(e) => {
            fail(backoff, key, now, &e);
            None
        }
    }
}

struct SyncCtx {
    source: TimeoutSource<RpcSecurityViewSource>,
    rpc: Arc<StellarRpc>,
    repo: SecurityRegistryRepo,
    events: EventRepo,
    chain_id: i64,
    contract_id: String,
    configured_loan_registry: Option<String>,
    backoff: SyncBackoff,
    pending: PendingSnapshots,
    last_discovery: Option<Instant>,
    last_contract_read: Option<Instant>,
    last_state: Option<RegistryStateRow>,
    loan_registry: Option<String>,
    mismatch_warned: bool,
}

async fn snapshot_step(ctx: &mut SyncCtx) -> Result<()> {
    let cursor = ctx.events.get_cursor(ctx.chain_id).await?;
    let latest = ctx.rpc.get_latest_ledger().await?;
    let now = Instant::now();
    if latest.saturating_sub(cursor) <= SNAPSHOT_MAX_LAG {
        let ledgers = ctx
            .repo
            .list_snapshot_ledgers(ctx.chain_id, &ctx.contract_id)
            .await?;
        let record_rows = ctx
            .repo
            .list_record_event_ledgers(ctx.chain_id, &ctx.contract_id)
            .await?;
        let inspection_ids = ctx
            .repo
            .list_inspection_ids(ctx.chain_id, &ctx.contract_id)
            .await?;
        let known_loans = ctx
            .repo
            .list_known_loans(
                ctx.chain_id,
                &ctx.contract_id,
                ctx.configured_loan_registry.as_deref(),
            )
            .await?;
        let with_terms: HashSet<u32> = ctx
            .repo
            .list_loans_with_terms_event(ctx.chain_id, &ctx.contract_id)
            .await?
            .into_iter()
            .collect();
        let snapshot_loans: HashSet<u32> = ledgers.loans.keys().copied().collect();

        let pending = &ctx.pending;
        let mut needs = SnapshotNeeds {
            records: record_snapshot_needs(&record_rows, &ledgers.records),
            inspections: inspection_snapshot_needs(&inspection_ids, &ledgers.inspections),
            loans: loan_snapshot_needs(&known_loans, &with_terms, &snapshot_loans),
            contract: ledgers.contract.is_none()
                || ctx
                    .last_contract_read
                    .is_none_or(|t| now.duration_since(t) >= DISCOVERY_INTERVAL),
        };
        needs
            .records
            .retain(|id| !pending.contains_key(&(SnapshotKind::Record, *id)));
        needs
            .inspections
            .retain(|id| !pending.contains_key(&(SnapshotKind::Inspection, *id)));
        needs
            .loans
            .retain(|id| !pending.contains_key(&(SnapshotKind::Loan, *id)));
        needs.contract &= !pending.contains_key(&(SnapshotKind::Contract, 0));

        if needs.contract {
            ctx.last_contract_read = Some(now);
        }
        let mut writes = read_snapshots(&ctx.source, &needs, &mut ctx.backoff, now).await;

        if ctx
            .last_discovery
            .is_none_or(|t| now.duration_since(t) >= DISCOVERY_INTERVAL)
        {
            ctx.last_discovery = Some(now);
            let known_records: BTreeSet<u32> = record_rows
                .iter()
                .filter(|r| r.registered)
                .map(|r| r.record_id)
                .chain(ledgers.records.keys().copied())
                .chain(
                    ctx.pending
                        .keys()
                        .filter(|k| k.0 == SnapshotKind::Record)
                        .map(|k| k.1),
                )
                .collect();
            let known_inspections: BTreeSet<u32> = inspection_ids
                .iter()
                .copied()
                .chain(ledgers.inspections.keys().copied())
                .chain(
                    ctx.pending
                        .keys()
                        .filter(|k| k.0 == SnapshotKind::Inspection)
                        .map(|k| k.1),
                )
                .collect();
            writes
                .extend(discover_records(&ctx.source, &known_records, &mut ctx.backoff, now).await);
            writes.extend(
                discover_inspections(&ctx.source, &known_inspections, &mut ctx.backoff, now).await,
            );
        }
        hold(&mut ctx.pending, writes);
    }

    let sink = RepoSink {
        repo: &ctx.repo,
        chain_id: ctx.chain_id,
        contract_id: &ctx.contract_id,
    };
    flush_snapshots(&sink, &mut ctx.pending, cursor).await;
    Ok(())
}

#[async_trait]
pub trait SnapshotSink: Send + Sync {
    async fn store(&self, write: &SnapshotWrite, loan_id: Option<i64>) -> Result<()>;
    async fn record_loans(&self) -> Result<HashMap<u32, i64>>;
}

struct RepoSink<'a> {
    repo: &'a SecurityRegistryRepo,
    chain_id: i64,
    contract_id: &'a str,
}

#[async_trait]
impl SnapshotSink for RepoSink<'_> {
    async fn store(&self, w: &SnapshotWrite, loan_id: Option<i64>) -> Result<()> {
        self.repo
            .upsert_snapshot(
                self.chain_id,
                self.contract_id,
                w.kind.as_str(),
                i64::from(w.entity_id),
                loan_id,
                w.as_of_ledger,
                &w.payload,
            )
            .await?;
        Ok(())
    }

    async fn record_loans(&self) -> Result<HashMap<u32, i64>> {
        self.repo
            .list_record_loans(self.chain_id, self.contract_id)
            .await
    }
}

pub async fn flush_snapshots(
    sink: &dyn SnapshotSink,
    pending: &mut PendingSnapshots,
    cursor: u64,
) -> usize {
    let ready = release_ready(pending, cursor);
    if ready.is_empty() {
        return 0;
    }
    let (inspections, others): (Vec<_>, Vec<_>) = ready
        .into_iter()
        .partition(|w| w.kind == SnapshotKind::Inspection);
    let mut stored = 0;
    for w in others {
        let loan = w.loan_id;
        if put_back_on_error(sink, pending, w, loan).await {
            stored += 1;
        }
    }
    if inspections.is_empty() {
        return stored;
    }
    match sink.record_loans().await {
        Ok(record_loans) => {
            for w in inspections {
                if let Some(loan) = w.parent_record.and_then(|r| record_loans.get(&r).copied()) {
                    if put_back_on_error(sink, pending, w, Some(loan)).await {
                        stored += 1;
                    }
                } else {
                    tracing::debug!(
                        inspection_id = w.entity_id,
                        "inspection snapshot held: record not stored yet"
                    );
                    hold(pending, vec![w]);
                }
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "record loan lookup failed; inspection snapshots held");
            hold(pending, inspections);
        }
    }
    stored
}

async fn put_back_on_error(
    sink: &dyn SnapshotSink,
    pending: &mut PendingSnapshots,
    write: SnapshotWrite,
    loan_id: Option<i64>,
) -> bool {
    match sink.store(&write, loan_id).await {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!(
                kind = write.kind.as_str(),
                id = write.entity_id,
                error = %e,
                "security snapshot upsert failed; held for the next cycle"
            );
            hold(pending, vec![write]);
            false
        }
    }
}

pub struct TimeoutSource<S> {
    inner: S,
    limit: Duration,
}

impl<S> TimeoutSource<S> {
    pub fn new(inner: S, limit: Duration) -> Self {
        Self { inner, limit }
    }

    async fn limited<T>(&self, name: &str, fut: impl Future<Output = Result<T>>) -> Result<T> {
        match tokio::time::timeout(self.limit, fut).await {
            Ok(result) => result,
            Err(_) => Err(anyhow::anyhow!("view read {name} timed out")),
        }
    }
}

#[async_trait]
impl<S: SecurityViewSource> SecurityViewSource for TimeoutSource<S> {
    async fn record(&self, id: u32) -> Result<(RecordView, u64)> {
        self.limited("record", self.inner.record(id)).await
    }
    async fn inspection(&self, id: u32) -> Result<(InspectionView, u64)> {
        self.limited("inspection", self.inner.inspection(id)).await
    }
    async fn terms(&self, id: u32) -> Result<(Option<TermsView>, u64)> {
        self.limited("terms", self.inner.terms(id)).await
    }
    async fn extension_consents(&self, id: u32) -> Result<(Vec<String>, u64)> {
        self.limited("extension_consents", self.inner.extension_consents(id))
            .await
    }
    async fn inspectors(&self) -> Result<(Vec<String>, u64)> {
        self.limited("inspectors", self.inner.inspectors()).await
    }
    async fn paused(&self) -> Result<(bool, u64)> {
        self.limited("paused", self.inner.paused()).await
    }
    async fn loan_registry(&self) -> Result<(String, u64)> {
        self.limited("loan_registry", self.inner.loan_registry())
            .await
    }
    async fn coverage_detail(&self, id: u32) -> Result<(CoverageDetailView, u64)> {
        self.limited("coverage_detail", self.inner.coverage_detail(id))
            .await
    }
    async fn loan_money(&self, registry: &str, id: u32) -> Result<(LoanMoneyView, u64)> {
        self.limited("loan_money", self.inner.loan_money(registry, id))
            .await
    }
}

pub async fn run_step(
    chain_id: i64,
    name: &'static str,
    budget: Duration,
    fut: impl Future<Output = Result<()>>,
) -> bool {
    match tokio::time::timeout(budget, AssertUnwindSafe(fut).catch_unwind()).await {
        Ok(Ok(Ok(()))) => true,
        Ok(Ok(Err(e))) => {
            tracing::warn!(chain_id, step = name, error = %e, "security sync step failed");
            false
        }
        Ok(Err(_)) => {
            tracing::error!(chain_id, step = name, "security sync step panicked");
            false
        }
        Err(_) => {
            tracing::warn!(
                chain_id,
                step = name,
                "security sync step exceeded its budget"
            );
            false
        }
    }
}

async fn project_loan(ctx: &SyncCtx, loan_id: u32) -> Result<()> {
    let events = ctx
        .repo
        .list_loan_events(ctx.chain_id, &ctx.contract_id, loan_id)
        .await?;
    let snaps = ctx
        .repo
        .list_loan_snapshots(ctx.chain_id, &ctx.contract_id, loan_id)
        .await?;
    let projection = fold_loan(
        loan_id,
        &events,
        &snaps.records,
        &snaps.inspections,
        snaps.loan.as_ref(),
    );
    ctx.repo
        .replace_loan_projection(ctx.chain_id, &ctx.contract_id, loan_id, &projection)
        .await
}

async fn projection_step(ctx: &SyncCtx) -> Result<()> {
    let max_id = ctx.repo.max_log_id(ctx.chain_id, &ctx.contract_id).await?;
    let snapshot_at = ctx
        .repo
        .max_snapshot_fetched_at(ctx.chain_id, &ctx.contract_id)
        .await?;
    let (version, projected_log_id, projected_snapshot_at) = ctx
        .repo
        .get_projection_state(ctx.chain_id, &ctx.contract_id)
        .await?
        .unwrap_or((0, 0, None));
    let outdated = version < SECURITY_PROJECTION_VERSION;
    if !outdated && max_id <= projected_log_id && snapshot_at <= projected_snapshot_at {
        return Ok(());
    }
    let loans = if outdated {
        ctx.repo
            .list_all_loans(ctx.chain_id, &ctx.contract_id)
            .await?
    } else {
        ctx.repo
            .list_dirty_loans(
                ctx.chain_id,
                &ctx.contract_id,
                projected_log_id,
                projected_snapshot_at,
            )
            .await?
    };
    let mut all_ok = true;
    for loan_id in loans {
        if let Err(e) = project_loan(ctx, loan_id).await {
            all_ok = false;
            tracing::warn!(chain_id = ctx.chain_id, loan_id, error = %e, "security projection rebuild failed");
        }
    }
    if all_ok {
        ctx.repo
            .update_projection_watermark(
                ctx.chain_id,
                &ctx.contract_id,
                SECURITY_PROJECTION_VERSION,
                max_id,
                snapshot_at,
            )
            .await?;
    }
    Ok(())
}

async fn state_step(ctx: &mut SyncCtx) -> Result<()> {
    let events = ctx
        .repo
        .list_contract_events(ctx.chain_id, &ctx.contract_id)
        .await?;
    let snapshot: Option<Snapshot<ContractView>> = ctx
        .repo
        .get_contract_snapshot(ctx.chain_id, &ctx.contract_id)
        .await?;
    let state = fold_registry_state(&events, snapshot.as_ref());
    if let Some(state) = state {
        ctx.loan_registry.clone_from(&state.loan_registry);
        if ctx.last_state.as_ref() != Some(&state) {
            ctx.repo
                .upsert_registry_state(ctx.chain_id, &ctx.contract_id, &state)
                .await?;
            ctx.last_state = Some(state);
        }
    }
    Ok(())
}

async fn valuation_step(ctx: &mut SyncCtx) -> Result<()> {
    let Some(loan_registry) = ctx.loan_registry.clone() else {
        return Ok(());
    };
    if !ctx.mismatch_warned
        && ctx
            .configured_loan_registry
            .as_deref()
            .is_some_and(|c| c != loan_registry)
    {
        ctx.mismatch_warned = true;
        tracing::warn!(
            security_registry_loan_registry = %loan_registry,
            configured = ?ctx.configured_loan_registry,
            "SecurityRegistry loan_registry differs from the configured LOAN_REGISTRY_ADDRESS"
        );
    }
    let log_contracts = vec![ctx.contract_id.clone(), loan_registry.clone()];
    let candidates = ctx
        .repo
        .list_valuation_candidates(ctx.chain_id, &ctx.contract_id, &log_contracts)
        .await?;
    let now = Utc::now();
    let max_age = chrono::Duration::seconds(VALUATION_MAX_AGE_SECS);
    for c in candidates {
        let last = match (c.source_log_id, c.fetched_at, c.debt.as_ref()) {
            (Some(s), Some(f), Some(d)) => Some((s, f, d)),
            _ => None,
        };
        if !valuation_due(c.latest_log_id, last, now, max_age) {
            continue;
        }
        let row = read_valuation(
            &ctx.source,
            &loan_registry,
            c.loan_id,
            c.latest_log_id,
            &mut ctx.backoff,
            Instant::now(),
        )
        .await;
        if let Some(row) = row {
            if let Err(e) = ctx
                .repo
                .upsert_valuation(ctx.chain_id, &ctx.contract_id, &row)
                .await
            {
                tracing::warn!(chain_id = ctx.chain_id, loan_id = c.loan_id, error = %e, "security valuation upsert failed");
            }
        }
    }
    Ok(())
}

pub async fn run_security_registry_sync_loop(
    rpc: Arc<StellarRpc>,
    repo: SecurityRegistryRepo,
    events: EventRepo,
    chain_id: i64,
    contract_id: String,
    configured_loan_registry: Option<String>,
) -> Result<()> {
    let mut ctx = SyncCtx {
        source: TimeoutSource::new(
            RpcSecurityViewSource::new(rpc.clone(), contract_id.clone()),
            VIEW_CALL_TIMEOUT,
        ),
        rpc,
        repo,
        events,
        chain_id,
        contract_id,
        configured_loan_registry,
        backoff: SyncBackoff::default(),
        pending: PendingSnapshots::new(),
        last_discovery: None,
        last_contract_read: None,
        last_state: None,
        loan_registry: None,
        mismatch_warned: false,
    };
    loop {
        run_step(chain_id, "snapshot", STEP_BUDGET, snapshot_step(&mut ctx)).await;
        run_step(chain_id, "projection", STEP_BUDGET, projection_step(&ctx)).await;
        run_step(chain_id, "state", STEP_BUDGET, state_step(&mut ctx)).await;
        run_step(chain_id, "valuation", STEP_BUDGET, valuation_step(&mut ctx)).await;
        tokio::time::sleep(SECURITY_SYNC_INTERVAL).await;
    }
}
