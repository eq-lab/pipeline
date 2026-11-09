// spec: docs/references/security-registry-events.md#sync-loop
#![allow(clippy::implicit_hasher)]
use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::str::FromStr;

use bigdecimal::{BigDecimal, ToPrimitive, Zero};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const SECURITY_PROJECTION_VERSION: i32 = 1;

pub const SECURITY_LOAN_EVENT_NAMES: [&str; 18] = [
    "SecurityRecordRegistered",
    "SecurityRecordPerfected",
    "SecurityRecordHandedOver",
    "SecurityRecordAttested",
    "SecurityDocAdded",
    "SecurityRecordReleased",
    "SecurityMandateBreach",
    "SecurityEnforcementStarted",
    "SecurityRecordEnforced",
    "SecurityTermsSet",
    "SecurityRevalued",
    "SecurityMarginCall",
    "SecurityPriceStale",
    "SecurityMarginCallCured",
    "SecurityInspectionRecorded",
    "SecurityInspectionApproved",
    "SecurityFlagResolved",
    "SecurityExtensionConsent",
];

pub const SECURITY_CONTRACT_EVENT_NAMES: [&str; 4] = [
    "SecurityInspectorsSet",
    "SecurityLoanRegistrySet",
    "SecurityRegistryPaused",
    "SecurityRegistryUnpaused",
];

pub const SECURITY_RECORD_EVENT_NAMES: [&str; 11] = [
    "SecurityRecordRegistered",
    "SecurityRecordPerfected",
    "SecurityRecordAttested",
    "SecurityDocAdded",
    "SecurityRecordReleased",
    "SecurityEnforcementStarted",
    "SecurityRecordEnforced",
    "SecurityRevalued",
    "SecurityInspectionRecorded",
    "SecurityInspectionApproved",
    "SecurityFlagResolved",
];

pub const SECURITY_OPAQUE_RECORD_EVENT_NAMES: [&str; 2] =
    ["SecurityRecordPerfected", "SecurityRecordHandedOver"];

pub const PAR_VALUE_PER_UNIT: &str = "10000000";
pub const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

pub fn is_security_registry_event(name: &str) -> bool {
    SECURITY_LOAN_EVENT_NAMES.contains(&name) || SECURITY_CONTRACT_EVENT_NAMES.contains(&name)
}

pub fn is_goods(protection: &str) -> bool {
    matches!(
        protection,
        "EndorsedBl" | "WarehousePledge" | "CollateralManagement"
    )
}

#[derive(Debug, Clone, PartialEq)]
pub struct SecurityEventRow {
    pub id: i64,
    pub event_name: String,
    pub block_number: i64,
    pub log_index: i64,
    pub block_timestamp: i64,
    pub tx_hash: String,
    pub params: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snapshot<T> {
    pub as_of_ledger: i64,
    pub view: T,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocView {
    pub kind: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MarkView {
    pub value_per_unit: String,
    pub at: String,
    pub benchmark: String,
    pub report_hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordView {
    pub record_id: u32,
    pub loan_id: u32,
    pub lot_id: u32,
    pub protection: String,
    pub commodity: String,
    pub unit: String,
    pub reference_quantity: String,
    pub reference_grade: String,
    pub region: String,
    pub site_hash: String,
    pub control_kind: String,
    pub control_reference: String,
    pub perfection: String,
    pub release_condition: String,
    pub docs: Vec<DocView>,
    pub status: String,
    pub perfected_at: String,
    pub attested_by: Option<String>,
    pub attested_at: String,
    pub flagged_by: u32,
    pub mark: Option<MarkView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InspectionView {
    pub inspection_id: u32,
    pub record_id: u32,
    pub lot_id: u32,
    pub inspector: String,
    pub kind: String,
    pub inspected_at: String,
    pub region: String,
    pub site_hash: String,
    pub quantity: String,
    pub grade: String,
    pub certificate_hash: String,
    pub certificate_no: String,
    pub entered_by: String,
    pub entered_at: String,
    pub approved_by: Option<String>,
    pub approved_at: String,
    pub variance_reference_bps: i32,
    pub variance_previous_bps: i32,
    pub variance_grade_bps: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TermsView {
    pub advance_ratio_bps: u32,
    pub margin_call_ratio_bps: u32,
    pub cure_period: String,
    pub price_stale_after: String,
    pub payment_term: String,
    pub grace_period: String,
    pub default_rate: u32,
    pub attestation_interval: String,
    pub inspection_interval: String,
    pub tolerance_bps: u32,
    pub grade_tolerance_bps: u32,
    pub margin_call_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanView {
    pub terms: Option<TermsView>,
    pub terms_ledger: i64,
    pub consents: Vec<String>,
    pub consents_ledger: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContractView {
    pub paused: bool,
    pub inspectors: Vec<String>,
    pub loan_registry: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CountedRecordView {
    pub record_id: u32,
    pub counted_quantity: String,
    pub value_per_unit: String,
    pub mark_at: String,
    pub stale: bool,
    pub flagged: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoverageDetailView {
    pub value: String,
    pub stale_value: String,
    pub flagged_value: String,
    pub debt: String,
    pub coverage_bps: u32,
    pub ltv_bps: u32,
    pub margin_call_at: String,
    pub cure_by: String,
    pub price_stale: bool,
    pub records: Vec<CountedRecordView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanMoneyView {
    pub disbursed: String,
    pub repaid: String,
    pub written_down: String,
    pub outstanding: String,
    pub accrued_interest: String,
    pub carved_out: bool,
}

#[derive(Debug, Clone, PartialEq, Default, sqlx::FromRow)]
pub struct RecordRow {
    pub record_id: i64,
    pub loan_id: i64,
    pub lot_id: i64,
    pub protection: String,
    pub commodity: Option<String>,
    pub unit: Option<String>,
    pub reference_quantity: Option<BigDecimal>,
    pub reference_grade: Option<BigDecimal>,
    pub region: Option<String>,
    pub site_hash: Option<String>,
    pub control_kind: Option<String>,
    pub control_reference: Option<String>,
    pub perfection: Option<String>,
    pub release_condition: Option<String>,
    pub status: String,
    pub perfected_at: Option<BigDecimal>,
    pub attested_by: Option<String>,
    pub attested_at: Option<BigDecimal>,
    pub flagged_by: Option<i64>,
    pub mark_value_per_unit: Option<BigDecimal>,
    pub mark_at: Option<BigDecimal>,
    pub mark_benchmark: Option<String>,
    pub mark_report_hash: Option<String>,
    pub registered_ledger: Option<i64>,
    pub closed_ledger: Option<i64>,
    pub release_reason_hash: Option<String>,
    pub released_by_consent: Option<bool>,
    pub complete: bool,
    pub needs_view: bool,
    pub view_ledger: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct DocRow {
    pub record_id: i64,
    pub position: i32,
    pub loan_id: i64,
    pub kind: String,
    pub sha256: String,
    pub source: String,
    pub ledger: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Default, sqlx::FromRow)]
pub struct TermsRow {
    pub loan_id: i64,
    pub advance_ratio_bps: i64,
    pub margin_call_ratio_bps: i64,
    pub cure_period: BigDecimal,
    pub price_stale_after: BigDecimal,
    pub payment_term: String,
    pub grace_period: BigDecimal,
    pub default_rate: i64,
    pub attestation_interval: BigDecimal,
    pub inspection_interval: BigDecimal,
    pub tolerance_bps: i64,
    pub grade_tolerance_bps: i64,
    pub margin_call_at: BigDecimal,
    pub set_ledger: Option<i64>,
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct MarginCallEventRow {
    pub block_number: i64,
    pub log_index: i64,
    pub loan_id: i64,
    pub kind: String,
    pub ltv_bps: i64,
    pub margin_call_ratio_bps: Option<i64>,
    pub cure_by: Option<BigDecimal>,
    pub block_timestamp: i64,
    pub tx_hash: String,
}

#[derive(Debug, Clone, PartialEq, Default, sqlx::FromRow)]
pub struct InspectionRow {
    pub inspection_id: i64,
    pub loan_id: i64,
    pub record_id: i64,
    pub lot_id: i64,
    pub inspector: String,
    pub kind: String,
    pub inspected_at: Option<BigDecimal>,
    pub region: Option<String>,
    pub site_hash: Option<String>,
    pub quantity: Option<BigDecimal>,
    pub grade: Option<BigDecimal>,
    pub certificate_hash: Option<String>,
    pub certificate_no: Option<String>,
    pub entered_by: Option<String>,
    pub entered_at: Option<BigDecimal>,
    pub approved_by: Option<String>,
    pub approved_at: Option<BigDecimal>,
    pub variance_reference_bps: Option<i32>,
    pub variance_previous_bps: Option<i32>,
    pub variance_grade_bps: Option<i32>,
    pub flagged: Option<bool>,
    pub resolution: Option<String>,
    pub resolution_reason_hash: Option<String>,
    pub resolved_at: Option<BigDecimal>,
    pub recorded_ledger: Option<i64>,
    pub approved_ledger: Option<i64>,
    pub complete: bool,
    pub needs_view: bool,
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct LotRow {
    pub lot_id: i64,
    pub loan_id: i64,
    pub latest_inspection_id: Option<i64>,
    pub latest_inspected_at: Option<BigDecimal>,
    pub latest_quantity: Option<BigDecimal>,
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct ConsentRow {
    pub loan_id: i64,
    pub position: i32,
    pub consent_hash: String,
    pub new_maturity: Option<BigDecimal>,
    pub ledger: Option<i64>,
    pub block_timestamp: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Default, sqlx::FromRow)]
pub struct RegistryStateRow {
    pub paused: Option<bool>,
    pub inspectors: Option<Value>,
    pub loan_registry: Option<String>,
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct ValuationRow {
    pub loan_id: i64,
    pub value: BigDecimal,
    pub stale_value: BigDecimal,
    pub flagged_value: BigDecimal,
    pub debt: BigDecimal,
    pub coverage_bps: i64,
    pub ltv_bps: i64,
    pub margin_call_at: BigDecimal,
    pub cure_by: BigDecimal,
    pub price_stale: bool,
    pub counted_records: Value,
    pub detail_ledger: i64,
    pub loan_registry: String,
    pub outstanding: BigDecimal,
    pub accrued_interest: BigDecimal,
    pub money_ledger: i64,
    pub source_log_id: i64,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct LoanProjection {
    pub terms: Option<TermsRow>,
    pub records: Vec<RecordRow>,
    pub docs: Vec<DocRow>,
    pub margin_events: Vec<MarginCallEventRow>,
    pub inspections: Vec<InspectionRow>,
    pub lots: Vec<LotRow>,
    pub consents: Vec<ConsentRow>,
}

pub fn p_str(p: &Value, k: &str) -> Option<String> {
    p.get(k)?.as_str().map(str::to_owned)
}

pub fn p_i64(p: &Value, k: &str) -> Option<i64> {
    match p.get(k)? {
        Value::String(s) => s.parse().ok(),
        Value::Number(n) => n.as_i64(),
        _ => None,
    }
}

pub fn p_dec(p: &Value, k: &str) -> Option<BigDecimal> {
    match p.get(k)? {
        Value::String(s) => BigDecimal::from_str(s).ok(),
        Value::Number(n) => BigDecimal::from_str(&n.to_string()).ok(),
        _ => None,
    }
}

fn p_bool(p: &Value, k: &str) -> Option<bool> {
    p.get(k)?.as_bool()
}

fn dec(s: &str) -> Option<BigDecimal> {
    BigDecimal::from_str(s).ok()
}

fn ts(ev: &SecurityEventRow) -> BigDecimal {
    BigDecimal::from(ev.block_timestamp)
}

fn after(v: Option<i64>, ev: &SecurityEventRow) -> bool {
    v.is_none_or(|v| ev.block_number > v)
}

pub fn label_snapshot_tail<T: Clone, L: Clone>(items: &[T], tail: &[L], lead: &L) -> Vec<(T, L)> {
    let k = tail.len().min(items.len());
    let lead_len = items.len() - k;
    let tail = &tail[tail.len() - k..];
    items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let label = if i < lead_len {
                lead.clone()
            } else {
                tail[i - lead_len].clone()
            };
            (item.clone(), label)
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct LotCandidate {
    pub inspection_id: i64,
    pub measures_quantity: bool,
    pub approved: bool,
    pub inspected_at: Option<BigDecimal>,
    pub quantity: Option<BigDecimal>,
    pub approval_order: (i64, i64, i64),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct LotLatest {
    pub inspection_id: Option<i64>,
    pub inspected_at: Option<BigDecimal>,
    pub quantity: Option<BigDecimal>,
    pub complete: bool,
}

pub fn lot_latest(candidates: &[LotCandidate]) -> LotLatest {
    let relevant: Vec<&LotCandidate> = candidates
        .iter()
        .filter(|c| c.approved && c.measures_quantity)
        .collect();
    let complete = relevant
        .iter()
        .all(|c| c.inspected_at.is_some() && c.quantity.is_some());
    let best = relevant
        .iter()
        .filter(|c| c.inspected_at.is_some() && c.quantity.is_some())
        .max_by(|a, b| {
            a.inspected_at
                .cmp(&b.inspected_at)
                .then(a.approval_order.cmp(&b.approval_order))
        });
    LotLatest {
        inspection_id: best.map(|c| c.inspection_id),
        inspected_at: best.and_then(|c| c.inspected_at.clone()),
        quantity: best.and_then(|c| c.quantity.clone()),
        complete,
    }
}

fn record_from_view(v: &RecordView, ledger: i64) -> Option<RecordRow> {
    let mark = v.mark.as_ref();
    Some(RecordRow {
        record_id: i64::from(v.record_id),
        loan_id: i64::from(v.loan_id),
        lot_id: i64::from(v.lot_id),
        protection: v.protection.clone(),
        commodity: Some(v.commodity.clone()),
        unit: Some(v.unit.clone()),
        reference_quantity: Some(dec(&v.reference_quantity)?),
        reference_grade: Some(dec(&v.reference_grade)?),
        region: Some(v.region.clone()),
        site_hash: Some(v.site_hash.clone()),
        control_kind: Some(v.control_kind.clone()),
        control_reference: Some(v.control_reference.clone()),
        perfection: Some(v.perfection.clone()),
        release_condition: Some(v.release_condition.clone()),
        status: v.status.clone(),
        perfected_at: Some(dec(&v.perfected_at)?),
        attested_by: v.attested_by.clone(),
        attested_at: Some(dec(&v.attested_at)?),
        flagged_by: Some(i64::from(v.flagged_by)),
        mark_value_per_unit: mark.and_then(|m| dec(&m.value_per_unit)),
        mark_at: mark.and_then(|m| dec(&m.at)),
        mark_benchmark: mark.map(|m| m.benchmark.clone()),
        mark_report_hash: mark.map(|m| m.report_hash.clone()),
        view_ledger: Some(ledger),
        ..RecordRow::default()
    })
}

fn inspection_from_view(v: &InspectionView, loan_id: i64) -> Option<InspectionRow> {
    let approved = v.approved_by.is_some();
    Some(InspectionRow {
        inspection_id: i64::from(v.inspection_id),
        loan_id,
        record_id: i64::from(v.record_id),
        lot_id: i64::from(v.lot_id),
        inspector: v.inspector.clone(),
        kind: v.kind.clone(),
        inspected_at: Some(dec(&v.inspected_at)?),
        region: Some(v.region.clone()),
        site_hash: Some(v.site_hash.clone()),
        quantity: Some(dec(&v.quantity)?),
        grade: Some(dec(&v.grade)?),
        certificate_hash: Some(v.certificate_hash.clone()),
        certificate_no: Some(v.certificate_no.clone()),
        entered_by: Some(v.entered_by.clone()),
        entered_at: Some(dec(&v.entered_at)?),
        approved_by: v.approved_by.clone(),
        approved_at: if approved {
            Some(dec(&v.approved_at)?)
        } else {
            None
        },
        variance_reference_bps: approved.then_some(v.variance_reference_bps),
        variance_previous_bps: approved.then_some(v.variance_previous_bps),
        variance_grade_bps: approved.then_some(v.variance_grade_bps),
        ..InspectionRow::default()
    })
}

pub fn terms_from_view(loan_id: i64, v: &TermsView) -> Option<TermsRow> {
    Some(TermsRow {
        loan_id,
        advance_ratio_bps: i64::from(v.advance_ratio_bps),
        margin_call_ratio_bps: i64::from(v.margin_call_ratio_bps),
        cure_period: dec(&v.cure_period)?,
        price_stale_after: dec(&v.price_stale_after)?,
        payment_term: v.payment_term.clone(),
        grace_period: dec(&v.grace_period)?,
        default_rate: i64::from(v.default_rate),
        attestation_interval: dec(&v.attestation_interval)?,
        inspection_interval: dec(&v.inspection_interval)?,
        tolerance_bps: i64::from(v.tolerance_bps),
        grade_tolerance_bps: i64::from(v.grade_tolerance_bps),
        margin_call_at: dec(&v.margin_call_at)?,
        set_ledger: None,
        complete: false,
    })
}

fn terms_from_params(loan_id: i64, p: &Value) -> Option<TermsRow> {
    Some(TermsRow {
        loan_id,
        advance_ratio_bps: p_i64(p, "advance_ratio_bps")?,
        margin_call_ratio_bps: p_i64(p, "margin_call_ratio_bps")?,
        cure_period: p_dec(p, "cure_period")?,
        price_stale_after: p_dec(p, "price_stale_after")?,
        payment_term: p_str(p, "payment_term")?,
        grace_period: p_dec(p, "grace_period")?,
        default_rate: p_i64(p, "default_rate")?,
        attestation_interval: p_dec(p, "attestation_interval")?,
        inspection_interval: p_dec(p, "inspection_interval")?,
        tolerance_bps: p_i64(p, "tolerance_bps")?,
        grade_tolerance_bps: p_i64(p, "grade_tolerance_bps")?,
        margin_call_at: p_dec(p, "margin_call_at")?,
        set_ledger: None,
        complete: false,
    })
}

#[derive(Clone)]
struct DocEntry {
    kind: String,
    sha256: String,
    source: String,
    ledger: Option<i64>,
}

struct RecState {
    row: RecordRow,
    docs: Vec<DocEntry>,
    v: Option<i64>,
}

struct InspState {
    row: InspectionRow,
    v: Option<i64>,
    approval_event: Option<(i64, i64)>,
}

fn warn_skip(ev: &SecurityEventRow) {
    tracing::warn!(
        event_name = %ev.event_name,
        block_number = ev.block_number,
        log_index = ev.log_index,
        "security registry event with missing or invalid params skipped in fold"
    );
}

fn tail_label(ev: &SecurityEventRow, record_id: u32) -> Option<(String, Option<i64>)> {
    let p = &ev.params;
    let ledger = Some(ev.block_number);
    match ev.event_name.as_str() {
        "SecurityDocAdded" if p_i64(p, "record_id") == Some(i64::from(record_id)) => {
            Some(("event".to_owned(), ledger))
        }
        "SecurityRecordPerfected" if p_i64(p, "record_id") == Some(i64::from(record_id)) => {
            Some(("perfection".to_owned(), ledger))
        }
        "SecurityRecordHandedOver" if p_i64(p, "to_record_id") == Some(i64::from(record_id)) => {
            Some(("perfection".to_owned(), ledger))
        }
        "SecurityRecordEnforced" if p_i64(p, "record_id") == Some(i64::from(record_id)) => {
            Some(("proceeds".to_owned(), ledger))
        }
        _ => None,
    }
}

fn set(target: &mut String, value: &str) {
    value.clone_into(target);
}

fn par_mark(row: &mut RecordRow, at: BigDecimal) {
    row.mark_value_per_unit = dec(PAR_VALUE_PER_UNIT);
    row.mark_at = Some(at);
    row.mark_benchmark = Some("PAR".to_owned());
    row.mark_report_hash = Some(ZERO_HASH.to_owned());
}

fn activate(state: &mut RecState, ev: &SecurityEventRow, evidence_hash: String) {
    let now = ts(ev);
    set(&mut state.row.status, "Active");
    state.row.perfected_at = Some(now.clone());
    state.row.attested_at = Some(now);
    state.row.attested_by = None;
    state.row.needs_view = true;
    state.docs.push(DocEntry {
        kind: "Perfection".to_owned(),
        sha256: evidence_hash,
        source: "perfection".to_owned(),
        ledger: Some(ev.block_number),
    });
}

fn p_id(p: &Value, k: &str) -> Option<u32> {
    p_i64(p, k).and_then(|v| u32::try_from(v).ok())
}

fn apply_record_event(
    states: &mut BTreeMap<u32, RecState>,
    ev: &SecurityEventRow,
    inspections: &HashMap<u32, Snapshot<InspectionView>>,
) -> Option<()> {
    let p = &ev.params;
    let loan_id = p_i64(p, "loan_id")?;
    match ev.event_name.as_str() {
        "SecurityRecordRegistered" => {
            let rid = p_id(p, "record_id")?;
            if let Entry::Vacant(slot) = states.entry(rid) {
                let protection = p_str(p, "protection")?;
                let mut row = RecordRow {
                    record_id: i64::from(rid),
                    loan_id,
                    lot_id: p_i64(p, "lot_id")?,
                    status: "PendingPerfection".to_owned(),
                    flagged_by: Some(0),
                    perfected_at: Some(BigDecimal::from(0)),
                    attested_at: Some(BigDecimal::from(0)),
                    needs_view: true,
                    protection: protection.clone(),
                    ..RecordRow::default()
                };
                if !is_goods(&protection) {
                    par_mark(&mut row, ts(ev));
                }
                slot.insert(RecState {
                    row,
                    docs: Vec::new(),
                    v: None,
                });
            }
            let st = states.get_mut(&rid)?;
            st.row.registered_ledger = Some(ev.block_number);
            st.row.complete = true;
        }
        "SecurityRecordPerfected" => {
            let rid = p_id(p, "record_id")?;
            let hash = p_str(p, "evidence_hash")?;
            if let Some(st) = states.get_mut(&rid).filter(|s| after(s.v, ev)) {
                activate(st, ev, hash);
            }
        }
        "SecurityRecordHandedOver" => {
            let from_id = p_id(p, "from_record_id")?;
            let to_id = p_id(p, "to_record_id")?;
            let hash = p_str(p, "evidence_hash")?;
            let from_mark = states.get(&from_id).map(|s| {
                (
                    s.row.commodity.clone(),
                    s.row.unit.clone(),
                    s.row.mark_value_per_unit.clone(),
                    s.row.mark_at.clone(),
                    s.row.mark_benchmark.clone(),
                    s.row.mark_report_hash.clone(),
                )
            });
            if let Some(to) = states.get_mut(&to_id).filter(|s| after(s.v, ev)) {
                activate(to, ev, hash);
                if let Some((commodity, unit, value, at, benchmark, report_hash)) = from_mark {
                    match (&commodity, &unit, &to.row.commodity, &to.row.unit) {
                        (Some(c), Some(u), Some(tc), Some(tu)) => {
                            if c == tc && u == tu {
                                to.row.mark_value_per_unit = value;
                                to.row.mark_at = at;
                                to.row.mark_benchmark = benchmark;
                                to.row.mark_report_hash = report_hash;
                            }
                        }
                        _ => to.row.needs_view = true,
                    }
                } else {
                    to.row.needs_view = true;
                }
            }
            if let Some(from) = states.get_mut(&from_id).filter(|s| after(s.v, ev)) {
                set(&mut from.row.status, "Released");
                from.row.closed_ledger = Some(ev.block_number);
            }
        }
        "SecurityRecordAttested" => {
            let rid = p_id(p, "record_id")?;
            let by = p_str(p, "attested_by")?;
            if let Some(st) = states.get_mut(&rid).filter(|s| after(s.v, ev)) {
                st.row.attested_by = Some(by);
                st.row.attested_at = Some(ts(ev));
            }
        }
        "SecurityDocAdded" => {
            let rid = p_id(p, "record_id")?;
            let kind = p_str(p, "kind")?;
            let sha256 = p_str(p, "sha256")?;
            if let Some(st) = states.get_mut(&rid).filter(|s| after(s.v, ev)) {
                st.docs.push(DocEntry {
                    kind,
                    sha256,
                    source: "event".to_owned(),
                    ledger: Some(ev.block_number),
                });
            }
        }
        "SecurityRecordReleased" => {
            let rid = p_id(p, "record_id")?;
            let reason = p_str(p, "reason_hash")?;
            let by_consent = p_bool(p, "by_consent")?;
            if let Some(st) = states.get_mut(&rid).filter(|s| after(s.v, ev)) {
                set(&mut st.row.status, "Released");
                st.row.closed_ledger = Some(ev.block_number);
                st.row.release_reason_hash = Some(reason);
                st.row.released_by_consent = Some(by_consent);
            }
        }
        "SecurityEnforcementStarted" => {
            let rid = p_id(p, "record_id")?;
            if let Some(st) = states.get_mut(&rid).filter(|s| after(s.v, ev)) {
                set(&mut st.row.status, "UnderEnforcement");
            }
        }
        "SecurityRecordEnforced" => {
            let rid = p_id(p, "record_id")?;
            let hash = p_str(p, "proceeds_hash")?;
            if let Some(st) = states.get_mut(&rid).filter(|s| after(s.v, ev)) {
                set(&mut st.row.status, "Enforced");
                st.row.closed_ledger = Some(ev.block_number);
                st.docs.push(DocEntry {
                    kind: "Proceeds".to_owned(),
                    sha256: hash,
                    source: "proceeds".to_owned(),
                    ledger: Some(ev.block_number),
                });
            }
        }
        "SecurityRevalued" => {
            let rid = p_id(p, "record_id")?;
            let value = p_dec(p, "value_per_unit")?;
            let benchmark = p_str(p, "benchmark")?;
            let report_hash = p_str(p, "report_hash")?;
            if let Some(st) = states.get_mut(&rid).filter(|s| after(s.v, ev)) {
                st.row.mark_value_per_unit = Some(value);
                st.row.mark_at = Some(ts(ev));
                st.row.mark_benchmark = Some(benchmark);
                st.row.mark_report_hash = Some(report_hash);
            }
        }
        "SecurityInspectionApproved" => {
            let rid = p_id(p, "record_id")?;
            let iid = p_i64(p, "inspection_id")?;
            let flagged = p_bool(p, "flagged")?;
            if let Some(st) = states.get_mut(&rid).filter(|s| after(s.v, ev)) {
                if flagged {
                    st.row.flagged_by = Some(iid);
                }
            }
        }
        "SecurityFlagResolved" => {
            let rid = p_id(p, "record_id")?;
            let iid = p_id(p, "inspection_id")?;
            let outcome = p_str(p, "outcome")?;
            if let Some(st) = states.get_mut(&rid).filter(|s| after(s.v, ev)) {
                match outcome.as_str() {
                    "Accepted" => {
                        match inspections.get(&iid) {
                            Some(snap) => {
                                if snap.view.kind != "SamplingAssay" {
                                    st.row.reference_quantity = dec(&snap.view.quantity);
                                }
                                if snap.view.grade != "0" {
                                    st.row.reference_grade = dec(&snap.view.grade);
                                }
                            }
                            None => st.row.needs_view = true,
                        }
                        st.row.flagged_by = Some(0);
                    }
                    "TopUpRequired" => st.row.flagged_by = Some(0),
                    _ => {}
                }
            }
        }
        _ => {}
    }
    Some(())
}

fn apply_inspection_event(
    states: &mut BTreeMap<u32, InspState>,
    ev: &SecurityEventRow,
) -> Option<()> {
    let p = &ev.params;
    match ev.event_name.as_str() {
        "SecurityInspectionRecorded" => {
            let iid = p_id(p, "inspection_id")?;
            if let Entry::Vacant(slot) = states.entry(iid) {
                let row = InspectionRow {
                    inspection_id: i64::from(iid),
                    loan_id: p_i64(p, "loan_id")?,
                    record_id: p_i64(p, "record_id")?,
                    lot_id: p_i64(p, "lot_id")?,
                    inspector: p_str(p, "inspector")?,
                    kind: p_str(p, "kind")?,
                    entered_at: Some(ts(ev)),
                    needs_view: true,
                    ..InspectionRow::default()
                };
                slot.insert(InspState {
                    row,
                    v: None,
                    approval_event: None,
                });
            }
            let st = states.get_mut(&iid)?;
            st.row.recorded_ledger = Some(ev.block_number);
            st.row.complete = true;
        }
        "SecurityInspectionApproved" => {
            let iid = p_id(p, "inspection_id")?;
            let approved_by = p_str(p, "approved_by")?;
            let reference = i32::try_from(p_i64(p, "variance_reference_bps")?).ok()?;
            let previous = i32::try_from(p_i64(p, "variance_previous_bps")?).ok()?;
            let grade = i32::try_from(p_i64(p, "variance_grade_bps")?).ok()?;
            let flagged = p_bool(p, "flagged")?;
            let Some(st) = states.get_mut(&iid) else {
                return Some(());
            };
            if after(st.v, ev) {
                st.row.approved_by = Some(approved_by);
                st.row.approved_at = Some(ts(ev));
                st.row.variance_reference_bps = Some(reference);
                st.row.variance_previous_bps = Some(previous);
                st.row.variance_grade_bps = Some(grade);
            }
            st.row.flagged = Some(flagged);
            st.row.approved_ledger = Some(ev.block_number);
            st.approval_event = Some((ev.block_number, ev.log_index));
        }
        "SecurityFlagResolved" => {
            let iid = p_id(p, "inspection_id")?;
            let outcome = p_str(p, "outcome")?;
            let reason = p_str(p, "reason_hash")?;
            if let Some(st) = states.get_mut(&iid) {
                st.row.resolution = Some(outcome);
                st.row.resolution_reason_hash = Some(reason);
                st.row.resolved_at = Some(ts(ev));
            }
        }
        _ => {}
    }
    Some(())
}

fn margin_call_row(ev: &SecurityEventRow, loan_id: i64) -> Option<MarginCallEventRow> {
    let p = &ev.params;
    Some(MarginCallEventRow {
        block_number: ev.block_number,
        log_index: ev.log_index,
        loan_id,
        kind: "open".to_owned(),
        ltv_bps: p_i64(p, "ltv_bps")?,
        margin_call_ratio_bps: Some(p_i64(p, "margin_call_ratio_bps")?),
        cure_by: Some(p_dec(p, "cure_by")?),
        block_timestamp: ev.block_timestamp,
        tx_hash: ev.tx_hash.clone(),
    })
}

fn is_name(ev: &SecurityEventRow, name: &str) -> bool {
    ev.event_name == name
}

pub fn fold_loan(
    loan_id: u32,
    events: &[SecurityEventRow],
    records: &HashMap<u32, Snapshot<RecordView>>,
    inspections: &HashMap<u32, Snapshot<InspectionView>>,
    loan: Option<&Snapshot<LoanView>>,
) -> LoanProjection {
    fold_loan_report(loan_id, events, records, inspections, loan).0
}

pub fn fold_loan_report(
    loan_id: u32,
    events: &[SecurityEventRow],
    records: &HashMap<u32, Snapshot<RecordView>>,
    inspections: &HashMap<u32, Snapshot<InspectionView>>,
    loan: Option<&Snapshot<LoanView>>,
) -> (LoanProjection, usize) {
    let loan_id_i = i64::from(loan_id);
    let registered: HashSet<i64> = events
        .iter()
        .filter(|e| is_name(e, "SecurityRecordRegistered"))
        .filter_map(|e| p_i64(&e.params, "record_id"))
        .collect();

    let mut rec_states: BTreeMap<u32, RecState> = BTreeMap::new();
    for (rid, snap) in records {
        let Some(row) = record_from_view(&snap.view, snap.as_of_ledger) else {
            tracing::warn!(
                record_id = rid,
                "record snapshot has unparsable amounts; ignored"
            );
            continue;
        };
        let is_complete = registered.contains(&i64::from(*rid));
        let tail: Vec<(String, Option<i64>)> = events
            .iter()
            .filter(|e| e.block_number <= snap.as_of_ledger)
            .filter_map(|e| tail_label(e, *rid))
            .collect();
        let lead = (
            if is_complete { "register" } else { "view" }.to_owned(),
            None,
        );
        let items: Vec<DocView> = snap.view.docs.clone();
        let docs = label_snapshot_tail(&items, &tail, &lead)
            .into_iter()
            .map(|(d, (source, ledger))| DocEntry {
                kind: d.kind,
                sha256: d.sha256,
                source,
                ledger,
            })
            .collect();
        rec_states.insert(
            *rid,
            RecState {
                row,
                docs,
                v: Some(snap.as_of_ledger),
            },
        );
    }

    let mut insp_states: BTreeMap<u32, InspState> = BTreeMap::new();
    for (iid, snap) in inspections {
        let Some(row) = inspection_from_view(&snap.view, loan_id_i) else {
            tracing::warn!(
                inspection_id = iid,
                "inspection snapshot has unparsable amounts; ignored"
            );
            continue;
        };
        insp_states.insert(
            *iid,
            InspState {
                row: InspectionRow {
                    loan_id: loan_id_i,
                    ..row
                },
                v: Some(snap.as_of_ledger),
                approval_event: None,
            },
        );
    }

    let terms_v = loan.map(|l| l.view.terms_ledger);
    let mut terms: Option<TermsRow> = loan
        .and_then(|l| l.view.terms.as_ref())
        .and_then(|t| terms_from_view(loan_id_i, t));
    let mut terms_set_ledger: Option<i64> = None;
    let mut margin_events: Vec<MarginCallEventRow> = Vec::new();
    let mut consent_events: Vec<&SecurityEventRow> = Vec::new();

    let mut skipped = 0usize;
    for ev in events {
        let p = &ev.params;
        let ok = match ev.event_name.as_str() {
            "SecurityTermsSet" => match terms_from_params(loan_id_i, p) {
                Some(row) => {
                    terms_set_ledger = Some(ev.block_number);
                    if after(terms_v, ev) {
                        terms = Some(row);
                    }
                    true
                }
                None => false,
            },
            "SecurityMarginCall" => {
                let row = margin_call_row(ev, loan_id_i);
                match row {
                    Some(row) => {
                        if after(terms_v, ev) {
                            if let Some(t) = terms.as_mut() {
                                t.margin_call_at = ts(ev);
                            }
                        }
                        margin_events.push(row);
                        true
                    }
                    None => false,
                }
            }
            "SecurityPriceStale" => {
                match (p_i64(p, "ltv_bps"), p_i64(p, "margin_call_ratio_bps")) {
                    (Some(ltv), Some(ratio)) => {
                        margin_events.push(MarginCallEventRow {
                            block_number: ev.block_number,
                            log_index: ev.log_index,
                            loan_id: loan_id_i,
                            kind: "price_stale".to_owned(),
                            ltv_bps: ltv,
                            margin_call_ratio_bps: Some(ratio),
                            cure_by: None,
                            block_timestamp: ev.block_timestamp,
                            tx_hash: ev.tx_hash.clone(),
                        });
                        true
                    }
                    _ => false,
                }
            }
            "SecurityMarginCallCured" => match p_i64(p, "ltv_bps") {
                Some(ltv) => {
                    if after(terms_v, ev) {
                        if let Some(t) = terms.as_mut() {
                            t.margin_call_at = BigDecimal::from(0);
                        }
                    }
                    margin_events.push(MarginCallEventRow {
                        block_number: ev.block_number,
                        log_index: ev.log_index,
                        loan_id: loan_id_i,
                        kind: "cured".to_owned(),
                        ltv_bps: ltv,
                        margin_call_ratio_bps: None,
                        cure_by: None,
                        block_timestamp: ev.block_timestamp,
                        tx_hash: ev.tx_hash.clone(),
                    });
                    true
                }
                None => false,
            },
            "SecurityExtensionConsent" => {
                if p_str(p, "consent_hash").is_some() {
                    consent_events.push(ev);
                    true
                } else {
                    false
                }
            }
            "SecurityInspectionRecorded"
            | "SecurityInspectionApproved"
            | "SecurityFlagResolved" => {
                let a = apply_inspection_event(&mut insp_states, ev).is_some();
                let b = apply_record_event(&mut rec_states, ev, inspections).is_some();
                a && b
            }
            _ => apply_record_event(&mut rec_states, ev, inspections).is_some(),
        };
        if !ok {
            skipped += 1;
            warn_skip(ev);
        }
    }

    if let Some(t) = terms.as_mut() {
        t.set_ledger = terms_set_ledger;
        t.complete = terms_set_ledger.is_some();
    }

    let consents = fold_consents(loan_id_i, &consent_events, loan);

    let mut docs: Vec<DocRow> = Vec::new();
    let mut record_rows: Vec<RecordRow> = Vec::new();
    for (rid, st) in rec_states {
        for (i, d) in st.docs.iter().enumerate() {
            docs.push(DocRow {
                record_id: i64::from(rid),
                position: i as i32,
                loan_id: loan_id_i,
                kind: d.kind.clone(),
                sha256: d.sha256.clone(),
                source: d.source.clone(),
                ledger: d.ledger,
            });
        }
        let mut row = st.row;
        row.loan_id = loan_id_i;
        record_rows.push(row);
    }

    let mut lot_ids: BTreeSet<i64> = record_rows.iter().map(|r| r.lot_id).collect();
    let mut inspection_rows: Vec<InspectionRow> = Vec::new();
    let mut candidates: BTreeMap<i64, Vec<LotCandidate>> = BTreeMap::new();
    for (iid, st) in insp_states {
        lot_ids.insert(st.row.lot_id);
        let approval_order = match st.approval_event {
            Some((ledger, log_index)) => (1, ledger, log_index),
            None => (
                0,
                st.row
                    .approved_at
                    .as_ref()
                    .and_then(ToPrimitive::to_i64)
                    .unwrap_or(0),
                i64::from(iid),
            ),
        };
        candidates
            .entry(st.row.lot_id)
            .or_default()
            .push(LotCandidate {
                inspection_id: i64::from(iid),
                measures_quantity: st.row.kind != "SamplingAssay",
                approved: st.row.approved_by.is_some(),
                inspected_at: st.row.inspected_at.clone(),
                quantity: st.row.quantity.clone(),
                approval_order,
            });
        inspection_rows.push(st.row);
    }
    let lots = lot_ids
        .into_iter()
        .map(|lot_id| {
            let latest = lot_latest(candidates.get(&lot_id).map_or(&[][..], Vec::as_slice));
            LotRow {
                lot_id,
                loan_id: loan_id_i,
                latest_inspection_id: latest.inspection_id,
                latest_inspected_at: latest.inspected_at,
                latest_quantity: latest.quantity,
                complete: latest.complete,
            }
        })
        .collect();

    (
        LoanProjection {
            terms,
            records: record_rows,
            docs,
            margin_events,
            inspections: inspection_rows,
            lots,
            consents,
        },
        skipped,
    )
}

type ConsentLabel = Option<(BigDecimal, i64, i64)>;

fn consent_label(ev: &SecurityEventRow) -> ConsentLabel {
    Some((
        p_dec(&ev.params, "new_maturity")?,
        ev.block_number,
        ev.block_timestamp,
    ))
}

fn fold_consents(
    loan_id: i64,
    events: &[&SecurityEventRow],
    loan: Option<&Snapshot<LoanView>>,
) -> Vec<ConsentRow> {
    let mut out: Vec<(String, ConsentLabel)> = Vec::new();
    let cutoff = loan.map(|l| l.view.consents_ledger);
    if let Some(l) = loan {
        let tail: Vec<ConsentLabel> = events
            .iter()
            .copied()
            .filter(|e| e.block_number <= l.view.consents_ledger)
            .map(consent_label)
            .collect();
        out.extend(label_snapshot_tail(&l.view.consents, &tail, &None));
    }
    for ev in events.iter().filter(|e| after(cutoff, e)) {
        if let Some(hash) = p_str(&ev.params, "consent_hash") {
            out.push((hash, consent_label(ev)));
        }
    }
    out.into_iter()
        .enumerate()
        .map(|(i, (hash, label))| ConsentRow {
            loan_id,
            position: i as i32,
            consent_hash: hash,
            new_maturity: label.as_ref().map(|l| l.0.clone()),
            ledger: label.as_ref().map(|l| l.1),
            block_timestamp: label.as_ref().map(|l| l.2),
        })
        .collect()
}

pub fn fold_registry_state(
    events: &[SecurityEventRow],
    contract: Option<&Snapshot<ContractView>>,
) -> Option<RegistryStateRow> {
    let mut state = RegistryStateRow::default();
    let v = contract.map(|c| c.as_of_ledger);
    if let Some(c) = contract {
        state.paused = Some(c.view.paused);
        state.inspectors = Some(json!(c.view.inspectors));
        state.loan_registry = Some(c.view.loan_registry.clone());
    }
    for ev in events.iter().filter(|e| after(v, e)) {
        match ev.event_name.as_str() {
            "SecurityRegistryPaused" => state.paused = Some(true),
            "SecurityRegistryUnpaused" => state.paused = Some(false),
            "SecurityInspectorsSet" => match ev.params.get("inspectors") {
                Some(list) if list.is_array() => state.inspectors = Some(list.clone()),
                _ => warn_skip(ev),
            },
            "SecurityLoanRegistrySet" => match p_str(&ev.params, "loan_registry") {
                Some(addr) => state.loan_registry = Some(addr),
                None => warn_skip(ev),
            },
            _ => {}
        }
    }
    (state != RegistryStateRow::default()).then_some(state)
}

pub fn valuation_row(
    loan_id: i64,
    detail: &Snapshot<CoverageDetailView>,
    money: &Snapshot<LoanMoneyView>,
    loan_registry: &str,
    source_log_id: i64,
) -> Option<ValuationRow> {
    let d = &detail.view;
    Some(ValuationRow {
        loan_id,
        value: dec(&d.value)?,
        stale_value: dec(&d.stale_value)?,
        flagged_value: dec(&d.flagged_value)?,
        debt: dec(&d.debt)?,
        coverage_bps: i64::from(d.coverage_bps),
        ltv_bps: i64::from(d.ltv_bps),
        margin_call_at: dec(&d.margin_call_at)?,
        cure_by: dec(&d.cure_by)?,
        price_stale: d.price_stale,
        counted_records: serde_json::to_value(&d.records).ok()?,
        detail_ledger: detail.as_of_ledger,
        loan_registry: loan_registry.to_owned(),
        outstanding: dec(&money.view.outstanding)?,
        accrued_interest: dec(&money.view.accrued_interest)?,
        money_ledger: money.as_of_ledger,
        source_log_id,
    })
}

pub fn valuation_due(
    latest_log_id: i64,
    last: Option<(i64, DateTime<Utc>, &BigDecimal)>,
    now: DateTime<Utc>,
    max_age: Duration,
) -> bool {
    match last {
        None => true,
        Some((source_log_id, fetched_at, debt)) => {
            latest_log_id > source_log_id || (!debt.is_zero() && now - fetched_at >= max_age)
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RecordEventLedgers {
    pub record_id: u32,
    pub opaque_ledger: Option<i64>,
    pub registered: bool,
}

pub fn record_snapshot_needs(
    rows: &[RecordEventLedgers],
    snapshot_ledgers: &HashMap<u32, i64>,
) -> Vec<u32> {
    let mut out: Vec<u32> = rows
        .iter()
        .filter(|r| match snapshot_ledgers.get(&r.record_id) {
            None => true,
            Some(v) => r.opaque_ledger.is_some_and(|l| l > *v),
        })
        .map(|r| r.record_id)
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

pub fn inspection_snapshot_needs(ids: &[u32], snapshot_ledgers: &HashMap<u32, i64>) -> Vec<u32> {
    let mut out: Vec<u32> = ids
        .iter()
        .copied()
        .filter(|id| !snapshot_ledgers.contains_key(id))
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

pub fn loan_snapshot_needs(
    known_loans: &[u32],
    with_terms_event: &HashSet<u32>,
    snapshot_loans: &HashSet<u32>,
) -> Vec<u32> {
    let mut out: Vec<u32> = known_loans
        .iter()
        .copied()
        .filter(|l| !with_terms_event.contains(l) && !snapshot_loans.contains(l))
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}
