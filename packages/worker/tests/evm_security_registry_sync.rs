// spec: docs/references/security-registry-events.md#sync-loop
mod evm_security_support;

use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use evm_security_support::*;
use pipeline_worker::indexer::security_registry_sync::*;
use shared::security_registry::{
    CoverageDetailView, InspectionView, LoanMoneyView, RecordView, TermsView,
};

#[derive(Debug)]
struct Selector(&'static str);

impl std::fmt::Display for Selector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "revert {}", self.0)
    }
}

impl std::error::Error for Selector {}

fn missing(which: &'static str) -> anyhow::Error {
    anyhow::Error::from(Selector(which)).context("eth_call failed")
}

#[derive(Default)]
struct Fake {
    records: HashMap<u32, Result<RecordView, String>>,
    inspections: HashMap<u32, Result<InspectionView, String>>,
    detail: HashMap<u32, CoverageDetailView>,
    calls: Mutex<Vec<String>>,
}

impl Fake {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

#[async_trait]
impl SecurityViewSource for Fake {
    async fn record(&self, id: u32) -> Result<(RecordView, u64)> {
        self.calls.lock().unwrap().push(format!("record:{id}"));
        match self.records.get(&id) {
            Some(Ok(v)) => Ok((v.clone(), 500)),
            Some(Err(e)) => Err(anyhow!(e.clone())),
            None => Err(missing("record")),
        }
    }
    async fn inspection(&self, id: u32) -> Result<(InspectionView, u64)> {
        self.calls.lock().unwrap().push(format!("inspection:{id}"));
        match self.inspections.get(&id) {
            Some(Ok(v)) => Ok((v.clone(), 500)),
            Some(Err(e)) => Err(anyhow!(e.clone())),
            None => Err(missing("inspection")),
        }
    }
    async fn terms(&self, _: u32) -> Result<(Option<TermsView>, u64)> {
        Ok((None, 500))
    }
    async fn extension_consents(&self, _: u32) -> Result<(Vec<String>, u64)> {
        Ok((vec![], 502))
    }
    async fn inspectors(&self) -> Result<(Vec<String>, u64)> {
        Ok((vec![INSPECTOR_TEXT.to_owned()], 500))
    }
    async fn paused(&self) -> Result<(bool, u64)> {
        Ok((false, 501))
    }
    async fn loan_registry(&self) -> Result<(String, u64)> {
        Ok((format!("{LOAN_REGISTRY}"), 503))
    }
    async fn coverage_detail(&self, id: u32) -> Result<(CoverageDetailView, u64)> {
        self.detail
            .get(&id)
            .map(|d| (d.clone(), 600))
            .ok_or_else(|| missing("no_terms"))
    }
    async fn loan_money(&self, _: &str, _: u32) -> Result<(LoanMoneyView, u64)> {
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
    async fn latest_ledger(&self) -> Result<u64> {
        Ok(1_000)
    }
    fn is_missing_record(&self, e: &anyhow::Error) -> bool {
        e.downcast_ref::<Selector>()
            .is_some_and(|s| s.0 == "record")
    }
    fn is_missing_inspection(&self, e: &anyhow::Error) -> bool {
        e.downcast_ref::<Selector>()
            .is_some_and(|s| s.0 == "inspection")
    }
}

fn record(id: u32) -> RecordView {
    RecordView {
        record_id: id,
        loan_id: 7,
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
        inspector: INSPECTOR_TEXT.into(),
        kind: "StockCount".into(),
        inspected_at: "1".into(),
        region: "AE".into(),
        site_hash: hex32(1),
        quantity: "1".into(),
        grade: "0".into(),
        certificate_hash: hex32(2),
        certificate_no: "c".into(),
        entered_by: INSPECTOR_TEXT.into(),
        entered_at: "1".into(),
        approved_by: None,
        approved_at: "0".into(),
        variance_reference_bps: 0,
        variance_previous_bps: 0,
        variance_grade_bps: 0,
    }
}

fn detail(default_breach_at: Option<&str>) -> CoverageDetailView {
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
        default_breach_at: default_breach_at.map(str::to_owned),
    }
}

#[tokio::test]
async fn discovery_stops_at_the_sources_missing_record_and_skips_known_ids() {
    let mut fake = Fake::default();
    for id in 1..=4 {
        fake.records.insert(id, Ok(record(id)));
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
async fn discovery_does_not_mistake_other_reverts_for_the_end() {
    let mut fake = Fake::default();
    fake.records.insert(1, Err("rpc timeout".into()));
    let mut backoff = SyncBackoff::default();
    let writes = discover_records(&fake, &BTreeSet::new(), &mut backoff, Instant::now()).await;
    assert!(writes.is_empty());
    assert_eq!(backoff.failures((SnapshotKind::Record, 1)), 1);
    assert_eq!(fake.calls(), vec!["record:1"]);

    let mut other = Fake::default();
    other.inspections.insert(1, Err("revert no_terms".into()));
    let mut backoff = SyncBackoff::default();
    let writes = discover_inspections(&other, &BTreeSet::new(), &mut backoff, Instant::now()).await;
    assert!(writes.is_empty());
    assert_eq!(backoff.failures((SnapshotKind::Inspection, 1)), 1);
}

#[tokio::test]
async fn inspection_discovery_stops_at_the_sources_missing_inspection() {
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
    assert_eq!(writes[0].parent_record, Some(3));
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

#[tokio::test]
async fn a_snapshot_read_at_height_h_is_released_only_once_the_cursor_is_above_h() {
    let mut fake = Fake::default();
    fake.records.insert(1, Ok(record(1)));
    let needs = SnapshotNeeds {
        records: vec![1],
        ..SnapshotNeeds::default()
    };
    let writes = read_snapshots(&fake, &needs, &mut SyncBackoff::default(), Instant::now()).await;
    assert_eq!(writes[0].as_of_ledger, 500);

    let mut pending = PendingSnapshots::new();
    hold(&mut pending, writes);
    assert!(release_ready(&mut pending, 500).is_empty());
    assert!(release_ready(&mut pending, 499).is_empty());
    assert_eq!(release_ready(&mut pending, 501).len(), 1);
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

#[tokio::test]
async fn valuation_combines_both_views_with_their_own_heights_and_default_breach_at() {
    let mut fake = Fake::default();
    fake.detail.insert(7, detail(Some("1790000009")));
    let loan_registry = format!("{LOAN_REGISTRY}");
    let row = read_valuation(
        &fake,
        &loan_registry,
        7,
        42,
        &mut SyncBackoff::default(),
        Instant::now(),
    )
    .await
    .unwrap();
    assert_eq!(row.loan_id, 7);
    assert_eq!(row.ltv_bps, 8000);
    assert_eq!(row.detail_ledger, 600);
    assert_eq!(row.money_ledger, 601);
    assert_eq!(row.source_log_id, 42);
    assert_eq!(row.loan_registry, loan_registry);
    assert_eq!(row.outstanding.to_plain_string(), "90");
    assert_eq!(
        row.default_breach_at
            .map(|d| d.to_plain_string())
            .as_deref(),
        Some("1790000009")
    );

    fake.detail.insert(8, detail(None));
    let row = read_valuation(
        &fake,
        &loan_registry,
        8,
        1,
        &mut SyncBackoff::default(),
        Instant::now(),
    )
    .await
    .unwrap();
    assert_eq!(row.default_breach_at, None);
}

#[tokio::test]
async fn a_failing_coverage_read_backs_off() {
    let fake = Fake::default();
    let mut backoff = SyncBackoff::default();
    let now = Instant::now();
    assert!(read_valuation(&fake, "0x0", 7, 1, &mut backoff, now)
        .await
        .is_none());
    assert_eq!(backoff.failures((SnapshotKind::Valuation, 7)), 1);
    assert!(read_valuation(&fake, "0x0", 7, 1, &mut backoff, now)
        .await
        .is_none());
    assert_eq!(backoff.failures((SnapshotKind::Valuation, 7)), 1);
}

#[tokio::test]
async fn the_timeout_wrapper_forwards_the_head_and_both_classifiers() {
    let source = TimeoutSource::new(Fake::default(), VIEW_CALL_TIMEOUT);
    assert_eq!(source.latest_ledger().await.unwrap(), 1_000);
    assert!(source.is_missing_record(&missing("record")));
    assert!(!source.is_missing_record(&missing("inspection")));
    assert!(source.is_missing_inspection(&missing("inspection")));
    assert!(!source.is_missing_inspection(&missing("record")));
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
    async fn latest_ledger(&self) -> Result<u64> {
        std::future::pending().await
    }
    fn is_missing_record(&self, _: &anyhow::Error) -> bool {
        false
    }
    fn is_missing_inspection(&self, _: &anyhow::Error) -> bool {
        false
    }
}

#[tokio::test(start_paused = true)]
async fn a_head_read_that_never_resolves_times_out() {
    let source = TimeoutSource::new(Hang, VIEW_CALL_TIMEOUT);
    let started = tokio::time::Instant::now();
    let err = source.latest_ledger().await.unwrap_err();
    assert!(err.to_string().contains("latest_ledger"), "{err}");
    assert_eq!(started.elapsed(), VIEW_CALL_TIMEOUT);
    assert!(VIEW_CALL_TIMEOUT < Duration::from_secs(60));
}

#[test]
fn the_snapshot_lag_gate_keeps_its_stellar_value() {
    assert_eq!(SNAPSHOT_MAX_LAG, 20);
}
