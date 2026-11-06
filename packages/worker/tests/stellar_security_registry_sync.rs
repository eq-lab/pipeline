// spec: docs/references/security-registry-events.md#sync-loop
mod stellar_security_support;

use std::collections::{BTreeSet, HashMap};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use chrono::{TimeZone, Utc};
use pipeline_worker::indexer::stellar::parsers::StellarLog;
use pipeline_worker::indexer::stellar::poller::is_loan_registry_event;
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use pipeline_worker::indexer::stellar::security_registry_parsers::{
    dispatch_security_registry, SECURITY_REGISTRY_EVENT_TOPICS,
};
use pipeline_worker::indexer::stellar::security_registry_sync::*;
use pipeline_worker::indexer::stellar::security_registry_views::SecurityViewSource;
use shared::security_registry::{
    valuation_due, CoverageDetailView, InspectionView, LoanMoneyView, RecordView, TermsView,
};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use stellar_security_support::*;

#[derive(Default)]
struct Fake {
    records: HashMap<u32, Result<RecordView, String>>,
    inspections: HashMap<u32, Result<InspectionView, String>>,
    terms: HashMap<u32, Result<Option<TermsView>, String>>,
    detail: HashMap<u32, Result<CoverageDetailView, String>>,
    money_fails: bool,
    calls: Mutex<Vec<String>>,
}

impl Fake {
    fn log(&self, s: String) {
        self.calls.lock().unwrap().push(s);
    }
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

#[async_trait]
impl SecurityViewSource for Fake {
    async fn record(&self, id: u32) -> Result<(RecordView, u64)> {
        self.log(format!("record:{id}"));
        match self.records.get(&id) {
            Some(Ok(v)) => Ok((v.clone(), 500)),
            Some(Err(e)) => Err(anyhow!(e.clone())),
            None => Err(anyhow!("HostError: Error(Contract, #1)")),
        }
    }
    async fn inspection(&self, id: u32) -> Result<(InspectionView, u64)> {
        self.log(format!("inspection:{id}"));
        match self.inspections.get(&id) {
            Some(Ok(v)) => Ok((v.clone(), 500)),
            Some(Err(e)) => Err(anyhow!(e.clone())),
            None => Err(anyhow!("HostError: Error(Contract, #25)")),
        }
    }
    async fn terms(&self, id: u32) -> Result<(Option<TermsView>, u64)> {
        self.log(format!("terms:{id}"));
        match self.terms.get(&id) {
            Some(Ok(v)) => Ok((v.clone(), 500)),
            Some(Err(e)) => Err(anyhow!(e.clone())),
            None => Ok((None, 500)),
        }
    }
    async fn extension_consents(&self, id: u32) -> Result<(Vec<String>, u64)> {
        self.log(format!("consents:{id}"));
        Ok((vec![], 502))
    }
    async fn inspectors(&self) -> Result<(Vec<String>, u64)> {
        Ok((vec![], 500))
    }
    async fn paused(&self) -> Result<(bool, u64)> {
        Ok((false, 501))
    }
    async fn loan_registry(&self) -> Result<(String, u64)> {
        Ok((C_ADDR.to_owned(), 503))
    }
    async fn coverage_detail(&self, id: u32) -> Result<(CoverageDetailView, u64)> {
        match self.detail.get(&id) {
            Some(Ok(v)) => Ok((v.clone(), 600)),
            Some(Err(e)) => Err(anyhow!(e.clone())),
            None => Err(anyhow!("Error(Contract, #14)")),
        }
    }
    async fn loan_money(&self, _registry: &str, _id: u32) -> Result<(LoanMoneyView, u64)> {
        if self.money_fails {
            return Err(anyhow!("rpc down"));
        }
        Ok((
            LoanMoneyView {
                disbursed: "100".into(),
                repaid: "0".into(),
                written_down: "0".into(),
                outstanding: "90".into(),
                accrued_interest: "3".into(),
                carved_out: false,
            },
            601,
        ))
    }
}

fn record(id: u32, loan: u32) -> RecordView {
    RecordView {
        record_id: id,
        loan_id: loan,
        lot_id: 1,
        protection: "WarehousePledge".into(),
        commodity: "Copper".into(),
        unit: "Mt".into(),
        reference_quantity: "1".into(),
        reference_grade: "0".into(),
        region: "AE".into(),
        site_hash: hex32(1),
        control_kind: "Agent".into(),
        control_reference: "r".into(),
        perfection: "Endorsement".into(),
        release_condition: hex32(2),
        docs: vec![],
        status: "Active".into(),
        perfected_at: "0".into(),
        attested_by: None,
        attested_at: "0".into(),
        flagged_by: 0,
        mark: None,
    }
}

fn inspection(id: u32, rec: u32) -> InspectionView {
    InspectionView {
        inspection_id: id,
        record_id: rec,
        lot_id: 1,
        inspector: G_ADDR.into(),
        kind: "StockCount".into(),
        inspected_at: "1".into(),
        region: "AE".into(),
        site_hash: hex32(1),
        quantity: "1".into(),
        grade: "0".into(),
        certificate_hash: hex32(2),
        certificate_no: "c".into(),
        entered_by: G_ADDR.into(),
        entered_at: "1".into(),
        approved_by: None,
        approved_at: "0".into(),
        variance_reference_bps: 0,
        variance_previous_bps: 0,
        variance_grade_bps: 0,
    }
}

fn detail() -> CoverageDetailView {
    CoverageDetailView {
        value: "1000".into(),
        stale_value: "0".into(),
        flagged_value: "0".into(),
        debt: "90".into(),
        coverage_bps: 12000,
        ltv_bps: 8000,
        margin_call_at: "0".into(),
        cure_by: "0".into(),
        price_stale: false,
        records: vec![],
    }
}

#[tokio::test]
async fn a_failing_read_yields_no_write_backs_off_and_does_not_stop_later_reads() {
    let mut fake = Fake::default();
    fake.records.insert(1, Ok(record(1, 7)));
    fake.records.insert(2, Err("rpc timeout".into()));
    fake.records.insert(3, Ok(record(3, 7)));
    let needs = SnapshotNeeds {
        records: vec![1, 2, 3],
        ..SnapshotNeeds::default()
    };
    let mut backoff = SyncBackoff::default();
    let now = Instant::now();
    let writes = read_snapshots(&fake, &needs, &mut backoff, now).await;
    let ids: Vec<u32> = writes.iter().map(|w| w.entity_id).collect();
    assert_eq!(ids, vec![1, 3]);
    assert_eq!(writes[0].loan_id, Some(7));
    assert_eq!(writes[0].as_of_ledger, 500);
    assert_eq!(backoff.failures((SnapshotKind::Record, 2)), 1);
    assert!(!backoff.is_due((SnapshotKind::Record, 2), now));
    assert!(backoff.is_due((SnapshotKind::Record, 2), now + Duration::from_secs(61)));

    let before = fake.calls().len();
    let again = read_snapshots(&fake, &needs, &mut backoff, now).await;
    assert_eq!(again.len(), 2);
    assert_eq!(
        fake.calls()[before..]
            .iter()
            .filter(|c| *c == "record:2")
            .count(),
        0
    );
}

#[tokio::test]
async fn inspections_loans_and_contract_are_read() {
    let mut fake = Fake::default();
    fake.inspections.insert(4, Ok(inspection(4, 9)));
    let needs = SnapshotNeeds {
        inspections: vec![4],
        loans: vec![7],
        contract: true,
        ..SnapshotNeeds::default()
    };
    let writes = read_snapshots(&fake, &needs, &mut SyncBackoff::default(), Instant::now()).await;
    assert_eq!(writes.len(), 3);
    let insp = &writes[0];
    assert_eq!(insp.kind, SnapshotKind::Inspection);
    assert_eq!(insp.parent_record, Some(9));
    assert_eq!(insp.loan_id, None);
    let loan = &writes[1];
    assert_eq!(loan.kind, SnapshotKind::Loan);
    assert_eq!(loan.payload["terms"], serde_json::Value::Null);
    assert_eq!(loan.payload["terms_ledger"], 500);
    assert_eq!(loan.payload["consents_ledger"], 502);
    assert_eq!(loan.as_of_ledger, 502);
    let contract = &writes[2];
    assert_eq!(contract.kind, SnapshotKind::Contract);
    assert_eq!(contract.as_of_ledger, 500);
    assert_eq!(contract.payload["loan_registry"], C_ADDR);
    assert_eq!(contract.payload["paused"], false);
}

#[tokio::test]
async fn discovery_stops_at_the_first_missing_record_and_skips_known_ids() {
    let mut fake = Fake::default();
    for id in 1..=4 {
        fake.records.insert(id, Ok(record(id, 1)));
    }
    let known: BTreeSet<u32> = [2].into_iter().collect();
    let writes = discover_records(&fake, &known, &mut SyncBackoff::default(), Instant::now()).await;
    assert_eq!(
        writes.iter().map(|w| w.entity_id).collect::<Vec<_>>(),
        vec![1, 3, 4]
    );
    assert_eq!(
        fake.calls(),
        vec!["record:1", "record:3", "record:4", "record:5"]
    );
}

#[tokio::test]
async fn discovery_on_an_empty_registry_costs_one_read() {
    let fake = Fake::default();
    let writes = discover_records(
        &fake,
        &BTreeSet::new(),
        &mut SyncBackoff::default(),
        Instant::now(),
    )
    .await;
    assert!(writes.is_empty());
    assert_eq!(fake.calls(), vec!["record:1"]);
}

#[tokio::test]
async fn discovery_does_not_mistake_other_errors_for_the_end() {
    let mut fake = Fake::default();
    fake.records.insert(1, Err("Error(Contract, #14)".into()));
    let mut backoff = SyncBackoff::default();
    let writes = discover_records(&fake, &BTreeSet::new(), &mut backoff, Instant::now()).await;
    assert!(writes.is_empty());
    assert_eq!(backoff.failures((SnapshotKind::Record, 1)), 1);
    assert_eq!(fake.calls(), vec!["record:1"]);
}

#[tokio::test]
async fn inspection_discovery_stops_at_the_missing_inspection_code() {
    let mut fake = Fake::default();
    fake.inspections.insert(1, Ok(inspection(1, 3)));
    fake.inspections.insert(2, Ok(inspection(2, 3)));
    let writes = discover_inspections(
        &fake,
        &BTreeSet::new(),
        &mut SyncBackoff::default(),
        Instant::now(),
    )
    .await;
    assert_eq!(writes.len(), 2);
    assert_eq!(
        fake.calls(),
        vec!["inspection:1", "inspection:2", "inspection:3"]
    );
}

fn write_at(kind: SnapshotKind, id: u32, ledger: i64) -> SnapshotWrite {
    SnapshotWrite {
        kind,
        entity_id: id,
        loan_id: Some(1),
        parent_record: None,
        as_of_ledger: ledger,
        payload: serde_json::json!({}),
    }
}

#[test]
fn snapshots_are_released_only_after_the_cursor_passes_them() {
    let mut pending = PendingSnapshots::new();
    hold(
        &mut pending,
        vec![
            write_at(SnapshotKind::Record, 1, 100),
            write_at(SnapshotKind::Record, 2, 99),
            write_at(SnapshotKind::Loan, 3, 101),
        ],
    );
    let released = release_ready(&mut pending, 100);
    assert_eq!(released.len(), 1);
    assert_eq!(released[0].entity_id, 2);
    assert_eq!(pending.len(), 2);
    let released = release_ready(&mut pending, 101);
    assert_eq!(released.len(), 1);
    assert_eq!(released[0].entity_id, 1);
    let released = release_ready(&mut pending, 102);
    assert_eq!(released.len(), 1);
    assert!(pending.is_empty());
}

#[test]
fn a_newer_read_replaces_a_pending_one_and_an_older_does_not() {
    let mut pending = PendingSnapshots::new();
    hold(&mut pending, vec![write_at(SnapshotKind::Record, 1, 100)]);
    hold(&mut pending, vec![write_at(SnapshotKind::Record, 1, 90)]);
    assert_eq!(pending[&(SnapshotKind::Record, 1)].as_of_ledger, 100);
    hold(&mut pending, vec![write_at(SnapshotKind::Record, 1, 110)]);
    assert_eq!(pending[&(SnapshotKind::Record, 1)].as_of_ledger, 110);
}

#[test]
fn valuation_is_due_on_events_on_the_timer_and_not_for_a_zero_debt_loan() {
    let fetched = Utc.with_ymd_and_hms(2026, 11, 6, 12, 0, 0).unwrap();
    let max_age = chrono::Duration::seconds(VALUATION_MAX_AGE_SECS);
    let debt = BigDecimal::from_str("90").unwrap();
    let zero = BigDecimal::from(0);
    let soon = fetched + chrono::Duration::seconds(60);
    let later = fetched + chrono::Duration::seconds(301);
    assert!(valuation_due(5, None, soon, max_age));
    assert!(valuation_due(11, Some((10, fetched, &debt)), soon, max_age));
    assert!(!valuation_due(
        10,
        Some((10, fetched, &debt)),
        soon,
        max_age
    ));
    assert!(valuation_due(
        10,
        Some((10, fetched, &debt)),
        later,
        max_age
    ));
    assert!(!valuation_due(
        10,
        Some((10, fetched, &zero)),
        later,
        max_age
    ));
    assert!(valuation_due(11, Some((10, fetched, &zero)), soon, max_age));
}

#[tokio::test]
async fn valuation_reads_combine_both_views_and_back_off_on_failure() {
    let mut fake = Fake::default();
    fake.detail.insert(7, Ok(detail()));
    let mut backoff = SyncBackoff::default();
    let now = Instant::now();
    let row = read_valuation(&fake, C_ADDR, 7, 42, &mut backoff, now)
        .await
        .unwrap();
    assert_eq!(row.loan_id, 7);
    assert_eq!(row.ltv_bps, 8000);
    assert_eq!(row.detail_ledger, 600);
    assert_eq!(row.money_ledger, 601);
    assert_eq!(row.source_log_id, 42);
    assert_eq!(row.loan_registry, C_ADDR);
    assert_eq!(row.outstanding.to_plain_string(), "90");

    fake.money_fails = true;
    assert!(read_valuation(&fake, C_ADDR, 7, 43, &mut backoff, now)
        .await
        .is_none());
    assert_eq!(backoff.failures((SnapshotKind::Valuation, 7)), 1);
    assert!(read_valuation(&fake, C_ADDR, 7, 43, &mut backoff, now)
        .await
        .is_none());
    assert_eq!(backoff.failures((SnapshotKind::Valuation, 7)), 1);
}

#[test]
fn the_index_path_is_a_pure_synchronous_function() {
    let _: fn(&RawEvent) -> Option<StellarLog> = dispatch_security_registry;
    for (_, name) in SECURITY_REGISTRY_EVENT_TOPICS {
        assert!(!is_loan_registry_event(name));
        assert_ne!(name, "DealRegistered");
        assert_ne!(name, "AssetTransfer");
    }
}

struct Hang;

#[async_trait]
impl SecurityViewSource for Hang {
    async fn record(&self, _: u32) -> Result<(RecordView, u64)> {
        std::future::pending().await
    }
    async fn inspection(&self, _: u32) -> Result<(InspectionView, u64)> {
        std::future::pending().await
    }
    async fn terms(&self, _: u32) -> Result<(Option<TermsView>, u64)> {
        std::future::pending().await
    }
    async fn extension_consents(&self, _: u32) -> Result<(Vec<String>, u64)> {
        std::future::pending().await
    }
    async fn inspectors(&self) -> Result<(Vec<String>, u64)> {
        std::future::pending().await
    }
    async fn paused(&self) -> Result<(bool, u64)> {
        std::future::pending().await
    }
    async fn loan_registry(&self) -> Result<(String, u64)> {
        std::future::pending().await
    }
    async fn coverage_detail(&self, _: u32) -> Result<(CoverageDetailView, u64)> {
        std::future::pending().await
    }
    async fn loan_money(&self, _: &str, _: u32) -> Result<(LoanMoneyView, u64)> {
        std::future::pending().await
    }
}

#[tokio::test(start_paused = true)]
async fn a_view_read_that_never_resolves_times_out_and_backs_off() {
    let source = TimeoutSource::new(Hang, VIEW_CALL_TIMEOUT);
    let needs = SnapshotNeeds {
        records: vec![1, 2],
        contract: true,
        ..SnapshotNeeds::default()
    };
    let mut backoff = SyncBackoff::default();
    let started = tokio::time::Instant::now();
    let writes = read_snapshots(&source, &needs, &mut backoff, Instant::now()).await;
    assert!(writes.is_empty());
    assert_eq!(started.elapsed(), VIEW_CALL_TIMEOUT * 3);
    assert_eq!(backoff.failures((SnapshotKind::Record, 1)), 1);
    assert_eq!(backoff.failures((SnapshotKind::Record, 2)), 1);
    assert_eq!(backoff.failures((SnapshotKind::Contract, 0)), 1);
}

#[tokio::test(start_paused = true)]
async fn a_step_over_budget_or_panicking_is_contained() {
    assert!(!run_step(1, "slow", STEP_BUDGET, std::future::pending()).await);
    assert!(
        !run_step(1, "panic", STEP_BUDGET, async {
            panic!("boom");
        })
        .await
    );
    assert!(!run_step(1, "err", STEP_BUDGET, async { Err(anyhow!("x")) }).await);
    assert!(run_step(1, "ok", STEP_BUDGET, async { Ok(()) }).await);
    assert!(STEP_BUDGET < SECURITY_SYNC_INTERVAL);
}

struct FlakySink {
    fail_once: AtomicU32,
    stored: Mutex<Vec<(u32, Option<i64>)>>,
    loans: HashMap<u32, i64>,
}

#[async_trait]
impl SnapshotSink for FlakySink {
    async fn store(&self, w: &SnapshotWrite, loan: Option<i64>) -> Result<()> {
        if w.entity_id == 2 && self.fail_once.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(anyhow!("db down"));
        }
        self.stored.lock().unwrap().push((w.entity_id, loan));
        Ok(())
    }
    async fn record_loans(&self) -> Result<HashMap<u32, i64>> {
        Ok(self.loans.clone())
    }
}

#[tokio::test]
async fn a_failed_upsert_keeps_the_rest_of_the_batch_and_is_retried() {
    let sink = Arc::new(FlakySink {
        fail_once: AtomicU32::new(0),
        stored: Mutex::new(vec![]),
        loans: [(9, 5)].into_iter().collect(),
    });
    let mut pending = PendingSnapshots::new();
    let mut insp = write_at(SnapshotKind::Inspection, 4, 90);
    insp.loan_id = None;
    insp.parent_record = Some(9);
    hold(
        &mut pending,
        vec![
            write_at(SnapshotKind::Record, 1, 90),
            write_at(SnapshotKind::Record, 2, 90),
            write_at(SnapshotKind::Record, 3, 90),
            insp,
        ],
    );
    let stored = flush_snapshots(sink.as_ref(), &mut pending, 100).await;
    assert_eq!(stored, 3);
    let ids: Vec<u32> = sink.stored.lock().unwrap().iter().map(|s| s.0).collect();
    assert_eq!(ids, vec![1, 3, 4]);
    assert_eq!(sink.stored.lock().unwrap()[2].1, Some(5));
    assert_eq!(pending.len(), 1);
    assert!(pending.contains_key(&(SnapshotKind::Record, 2)));

    let stored = flush_snapshots(sink.as_ref(), &mut pending, 100).await;
    assert_eq!(stored, 1);
    assert!(pending.is_empty());
}
