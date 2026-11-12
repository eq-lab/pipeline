// spec: docs/product-specs/loan-security-state.md#behavior
use std::cell::Cell;
use std::collections::HashMap;
use std::sync::LazyLock;

use bigdecimal::BigDecimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use shared::collateral_valuation_repo::{AssayRow, OfftakeTermsRow};
use shared::security_marks::{
    effective_max_age, mark_due, mark_pairs, move_bps, suggest_with, CommodityMap,
    CommodityMapping, MarkMode, MarkPolicy, MarkSettings, PriceMap, SuggestCtx, Suggestion,
    SuggestionStatus,
};
use shared::security_registry::{
    is_goods, p_dec, p_i64, p_str, ConsentRow, CountedRecordView, DocRow, InspectionRow, LotRow,
    MarginCallEventRow, RecordRow, TermsRow, ValuationRow,
};
use shared::security_registry_repo::{LoanBookSecurityRow, LoanSecurityRows, SaleRepaymentRow};
use shared::security_state::{
    agent_release, attestation_stale, counts_toward_value, cure_by, dec_to_i128, dec_to_u128,
    dec_to_u64, format_7dp, format_7dp_i128, inspection_stale, integer_string, is_open_status,
    mark_age, mark_stale, price_stale, record_term_value, release_unconditional, CountedTerm,
};
use utoipa::ToSchema;

use crate::formatting::iso_utc;

#[derive(Debug, Serialize, ToSchema)]
pub struct SecurityTermsDto {
    pub advance_ratio_bps: u32,
    pub margin_call_ratio_bps: u32,
    pub cure_period: Option<String>,
    pub price_stale_after: Option<String>,
    pub payment_term: String,
    pub grace_period: Option<String>,
    pub default_rate: u32,
    pub attestation_interval: Option<String>,
    pub inspection_interval: Option<String>,
    pub tolerance_bps: u32,
    pub grade_tolerance_bps: u32,
    pub set_ledger: Option<i64>,
    pub complete: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ValuationAsOfDto {
    pub detail_ledger: i64,
    pub money_ledger: i64,
    pub fetched_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SecurityValuationDto {
    /// Exact 7-dp decimal string of the contract's `coverage_detail.value`.
    pub value: Option<String>,
    pub stale_value: Option<String>,
    pub flagged_value: Option<String>,
    pub debt: Option<String>,
    pub outstanding: Option<String>,
    pub accrued_interest: Option<String>,
    /// `4294967295` is the contract's `u32::MAX` sentinel (no value for a debt).
    pub ltv_bps: u32,
    /// `4294967295` is the contract's `u32::MAX` sentinel (no debt).
    pub coverage_bps: u32,
    pub price_stale: bool,
    pub as_of: ValuationAsOfDto,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MarginEventDto {
    /// `open`, `price_stale` or `cured`.
    pub kind: String,
    pub ltv_bps: u32,
    pub margin_call_ratio_bps: Option<u32>,
    pub cure_by: Option<String>,
    pub at: String,
    pub block_number: i64,
    pub tx_hash: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LastPriceStaleDto {
    pub ltv_bps: u32,
    pub at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[allow(clippy::struct_excessive_bools)]
pub struct MarginCallDto {
    /// `null` when the stored `margin_call_at` cannot be decoded.
    pub open: Option<bool>,
    pub opened_at: Option<String>,
    pub cure_by: Option<String>,
    /// `event`, `coverage_detail` or `null`.
    pub cure_by_source: Option<String>,
    pub cure_overdue: Option<bool>,
    pub last_margin_call_ltv_bps: Option<u32>,
    pub last_price_stale: Option<LastPriceStaleDto>,
    pub ltv_above_ratio_no_onchain_call: Option<bool>,
    pub open_call_curable: Option<bool>,
    pub events: Vec<MarginEventDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PricesDto {
    /// Seconds since the oldest counted goods mark; `18446744073709551615` when one is unmarked.
    pub mark_age: Option<String>,
    pub price_stale: Option<bool>,
    pub mark_max_age: Option<String>,
    pub mark_move_bps: u32,
    pub marks_due: Option<u32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SuggestedMarkDto {
    pub value_per_unit: String,
    pub benchmark: String,
    pub source_price: String,
    pub source_at: String,
    pub asset: String,
    pub price_provider: String,
    pub quote_unit: Option<String>,
    pub mode: String,
    pub assay_id: Option<String>,
    pub offtake_id: Option<String>,
    pub report: String,
    pub report_hash: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ConsentDto {
    pub position: i32,
    pub consent_hash: String,
    pub new_maturity: Option<String>,
    pub ledger: Option<i64>,
    pub at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecordDocDto {
    pub position: i32,
    pub kind: String,
    pub sha256: String,
    pub source: String,
    pub ledger: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecordMarkDto {
    pub value_per_unit: Option<String>,
    pub at: Option<String>,
    pub benchmark: Option<String>,
    pub report_hash: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LotDto {
    pub latest_inspection_id: Option<String>,
    pub latest_inspected_at: Option<String>,
    pub latest_quantity: Option<String>,
    pub complete: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecordValuationDto {
    pub counted_quantity: String,
    pub value_per_unit: String,
    pub mark_at: String,
    /// Per-record value; the contract divides once over the sum, so these can sum a few raw units above `valuation.value`.
    pub value: String,
    pub stale: bool,
    pub flagged: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct InspectionDto {
    pub inspection_id: String,
    pub inspector: String,
    pub kind: String,
    pub inspected_at: Option<String>,
    pub region: Option<String>,
    pub site_hash: Option<String>,
    pub quantity: Option<String>,
    pub grade: Option<String>,
    pub certificate_hash: Option<String>,
    pub certificate_no: Option<String>,
    pub entered_by: Option<String>,
    pub entered_at: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    pub variance_reference_bps: Option<i32>,
    pub variance_previous_bps: Option<i32>,
    pub variance_grade_bps: Option<i32>,
    pub flagged: Option<bool>,
    pub resolution: Option<String>,
    pub resolution_reason_hash: Option<String>,
    pub resolved_at: Option<String>,
    pub is_lot_latest: bool,
    pub complete: bool,
    pub needs_view: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SaleRepaymentDto {
    pub repayment_id: String,
    pub cash: String,
    pub interest_minted: String,
    pub fee_shares: String,
    pub value_date: String,
    pub ref_hash: Option<String>,
    pub tx_hash: String,
    pub at: String,
    pub reversed_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[allow(clippy::struct_excessive_bools)]
pub struct SecurityRecordDto {
    pub record_id: String,
    pub lot_id: String,
    pub protection: String,
    pub commodity: Option<String>,
    pub unit: Option<String>,
    pub reference_quantity: Option<String>,
    pub reference_grade: Option<String>,
    pub region: Option<String>,
    pub site_hash: Option<String>,
    pub control_kind: Option<String>,
    pub control_reference: Option<String>,
    pub perfection: Option<String>,
    pub release_condition: Option<String>,
    pub status: String,
    /// `status` is neither `Released` nor `Enforced`.
    pub open: bool,
    pub perfected_at: Option<String>,
    pub attested_by: Option<String>,
    pub attested_at: Option<String>,
    pub flagged_by: Option<String>,
    pub registered_ledger: Option<i64>,
    pub closed_ledger: Option<i64>,
    pub release_reason_hash: Option<String>,
    pub released_by_consent: Option<bool>,
    pub complete: bool,
    pub needs_view: bool,
    pub docs: Vec<RecordDocDto>,
    pub mark: Option<RecordMarkDto>,
    pub suggested_mark: Option<SuggestedMarkDto>,
    pub suggestion_status: Option<String>,
    pub move_bps: Option<i32>,
    pub mark_due: Option<bool>,
    pub mark_due_reasons: Vec<String>,
    pub mark_due_at: Option<String>,
    pub lot: Option<LotDto>,
    pub counts_toward_value: bool,
    /// `null` unless the record is `Active`.
    pub attestation_stale: Option<bool>,
    /// `null` unless the record is `Active`.
    pub inspection_stale: Option<bool>,
    /// `null` when a stored mark time or interval cannot be decoded.
    pub mark_stale: Option<bool>,
    /// `null` when the record does not count or the loan has no valuation snapshot.
    pub valuation: Option<RecordValuationDto>,
    /// `allowed` when the Security Agent's own `release` passes `ensure_releasable`, else `needs_consent`; `null` for closed records or without a snapshot.
    pub agent_release: Option<String>,
    pub inspections: Vec<InspectionDto>,
    pub repayments: Vec<SaleRepaymentDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LoanSecurityResponse {
    pub chain_id: i64,
    pub loan_id: String,
    pub security_registry: String,
    pub now: String,
    pub loan_status: Option<String>,
    pub paused: Option<bool>,
    pub inspectors: Vec<String>,
    /// The projection or the valuation snapshot lags the loan's newest indexed logs.
    pub refresh_pending: bool,
    pub terms: Option<SecurityTermsDto>,
    pub valuation: Option<SecurityValuationDto>,
    pub margin_call: Option<MarginCallDto>,
    pub prices: Option<PricesDto>,
    pub extension_consents: Vec<ConsentDto>,
    pub records: Vec<SecurityRecordDto>,
}

struct CountedEntry {
    counted_quantity: i128,
    value_per_unit: i128,
    mark_at: String,
    stale: bool,
    flagged: bool,
}

static NO_MARKS: LazyLock<MarkSettings> = LazyLock::new(MarkSettings::default);

pub struct MarkInputs<'a> {
    pub settings: &'a MarkSettings,
    pub prices: PriceMap,
    pub concentrate: Option<(AssayRow, OfftakeTermsRow)>,
}

impl Default for MarkInputs<'static> {
    fn default() -> Self {
        Self {
            settings: &NO_MARKS,
            prices: PriceMap::new(),
            concentrate: None,
        }
    }
}

struct Unreadable(Cell<bool>);

impl Unreadable {
    fn i128(&self, d: &BigDecimal) -> Option<i128> {
        let v = dec_to_i128(d);
        if v.is_none() {
            self.0.set(true);
        }
        v
    }

    fn u64(&self, d: &BigDecimal) -> Option<u64> {
        let v = dec_to_u64(d);
        if v.is_none() {
            self.0.set(true);
        }
        v
    }
}

fn clamp_u32(v: i64) -> u32 {
    u32::try_from(v).unwrap_or(if v < 0 { 0 } else { u32::MAX })
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LoanBookSecurityFields {
    pub ltv_bps: Option<u32>,
    pub margin_call_open: Option<bool>,
    pub price_stale: Option<bool>,
}

pub fn loan_book_security_fields(row: &LoanBookSecurityRow) -> LoanBookSecurityFields {
    LoanBookSecurityFields {
        ltv_bps: row.ltv_bps.map(clamp_u32),
        margin_call_open: row
            .margin_call_at
            .as_ref()
            .and_then(dec_to_u64)
            .map(|m| m != 0),
        price_stale: row.price_stale,
    }
}

fn int_opt(d: Option<&BigDecimal>) -> Option<String> {
    d.and_then(integer_string)
}

fn qty_opt(d: Option<&BigDecimal>) -> Option<String> {
    d.and_then(format_7dp)
}

fn parse_counted(value: &Value) -> Option<(HashMap<u32, CountedEntry>, bool)> {
    let views = match Vec::<CountedRecordView>::deserialize(value) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "security valuation counted_records unreadable; ignored");
            return None;
        }
    };
    let mut out = HashMap::with_capacity(views.len());
    let mut complete = true;
    for v in views {
        let parsed = (
            v.counted_quantity.parse::<i128>(),
            v.value_per_unit.parse::<i128>(),
            v.mark_at.parse::<u64>(),
        );
        let (Ok(counted_quantity), Ok(value_per_unit), Ok(mark_at)) = parsed else {
            tracing::warn!(
                record_id = v.record_id,
                "security valuation counted record unreadable; ignored"
            );
            complete = false;
            continue;
        };
        out.insert(
            v.record_id,
            CountedEntry {
                counted_quantity,
                value_per_unit,
                mark_at: mark_at.to_string(),
                stale: v.stale,
                flagged: v.flagged,
            },
        );
    }
    Some((out, complete))
}

fn repayment_dto(r: &SaleRepaymentRow) -> Option<SaleRepaymentDto> {
    let p = &r.params;
    let dto = (|| {
        Some(SaleRepaymentDto {
            repayment_id: p_i64(p, "repayment_id")?.to_string(),
            cash: format_7dp(&p_dec(p, "cash")?)?,
            interest_minted: format_7dp(&p_dec(p, "interest_minted")?)?,
            fee_shares: format_7dp(&p_dec(p, "fee_shares")?)?,
            value_date: p_i64(p, "value_date")?.to_string(),
            ref_hash: p_str(p, "ref_hash"),
            tx_hash: r.tx_hash.clone(),
            at: r.block_timestamp.to_string(),
            reversed_at: r.reversed_at.map(|t| t.to_string()),
        })
    })();
    if dto.is_none() {
        tracing::warn!(tx_hash = %r.tx_hash, "minter CashRepaid params unreadable; skipped");
    }
    dto
}

fn terms_dto(t: &TermsRow) -> SecurityTermsDto {
    SecurityTermsDto {
        advance_ratio_bps: clamp_u32(t.advance_ratio_bps),
        margin_call_ratio_bps: clamp_u32(t.margin_call_ratio_bps),
        cure_period: integer_string(&t.cure_period),
        price_stale_after: integer_string(&t.price_stale_after),
        payment_term: t.payment_term.clone(),
        grace_period: integer_string(&t.grace_period),
        default_rate: clamp_u32(t.default_rate),
        attestation_interval: integer_string(&t.attestation_interval),
        inspection_interval: integer_string(&t.inspection_interval),
        tolerance_bps: clamp_u32(t.tolerance_bps),
        grade_tolerance_bps: clamp_u32(t.grade_tolerance_bps),
        set_ledger: t.set_ledger,
        complete: t.complete,
    }
}

fn valuation_dto(
    v: &ValuationRow,
    fetched_at: &chrono::DateTime<chrono::Utc>,
) -> SecurityValuationDto {
    SecurityValuationDto {
        value: format_7dp(&v.value),
        stale_value: format_7dp(&v.stale_value),
        flagged_value: format_7dp(&v.flagged_value),
        debt: format_7dp(&v.debt),
        outstanding: format_7dp(&v.outstanding),
        accrued_interest: format_7dp(&v.accrued_interest),
        ltv_bps: clamp_u32(v.ltv_bps),
        coverage_bps: clamp_u32(v.coverage_bps),
        price_stale: v.price_stale,
        as_of: ValuationAsOfDto {
            detail_ledger: v.detail_ledger,
            money_ledger: v.money_ledger,
            fetched_at: iso_utc(fetched_at),
        },
    }
}

fn margin_event_dto(e: &MarginCallEventRow) -> MarginEventDto {
    MarginEventDto {
        kind: e.kind.clone(),
        ltv_bps: clamp_u32(e.ltv_bps),
        margin_call_ratio_bps: e.margin_call_ratio_bps.map(clamp_u32),
        cure_by: int_opt(e.cure_by.as_ref()),
        at: e.block_timestamp.to_string(),
        block_number: e.block_number,
        tx_hash: e.tx_hash.clone(),
    }
}

fn consent_dto(c: &ConsentRow) -> ConsentDto {
    ConsentDto {
        position: c.position,
        consent_hash: c.consent_hash.clone(),
        new_maturity: int_opt(c.new_maturity.as_ref()),
        ledger: c.ledger,
        at: c.block_timestamp.map(|t| t.to_string()),
    }
}

fn doc_dto(d: &DocRow) -> RecordDocDto {
    RecordDocDto {
        position: d.position,
        kind: d.kind.clone(),
        sha256: d.sha256.clone(),
        source: d.source.clone(),
        ledger: d.ledger,
    }
}

fn lot_dto(l: &LotRow) -> LotDto {
    LotDto {
        latest_inspection_id: l.latest_inspection_id.map(|i| i.to_string()),
        latest_inspected_at: int_opt(l.latest_inspected_at.as_ref()),
        latest_quantity: qty_opt(l.latest_quantity.as_ref()),
        complete: l.complete,
    }
}

fn inspection_dto(i: &InspectionRow, lot_latest: Option<i64>) -> InspectionDto {
    InspectionDto {
        inspection_id: i.inspection_id.to_string(),
        inspector: i.inspector.clone(),
        kind: i.kind.clone(),
        inspected_at: int_opt(i.inspected_at.as_ref()),
        region: i.region.clone(),
        site_hash: i.site_hash.clone(),
        quantity: qty_opt(i.quantity.as_ref()),
        grade: qty_opt(i.grade.as_ref()),
        certificate_hash: i.certificate_hash.clone(),
        certificate_no: i.certificate_no.clone(),
        entered_by: i.entered_by.clone(),
        entered_at: int_opt(i.entered_at.as_ref()),
        approved_by: i.approved_by.clone(),
        approved_at: int_opt(i.approved_at.as_ref()),
        variance_reference_bps: i.variance_reference_bps,
        variance_previous_bps: i.variance_previous_bps,
        variance_grade_bps: i.variance_grade_bps,
        flagged: i.flagged,
        resolution: i.resolution.clone(),
        resolution_reason_hash: i.resolution_reason_hash.clone(),
        resolved_at: int_opt(i.resolved_at.as_ref()),
        is_lot_latest: lot_latest == Some(i.inspection_id),
        complete: i.complete,
        needs_view: i.needs_view,
    }
}

fn mark_state(r: &RecordRow, un: &Unreadable) -> Result<Option<u64>, ()> {
    match (&r.mark_value_per_unit, &r.mark_at) {
        (Some(_), Some(at)) => un.u64(at).map(Some).ok_or(()),
        _ => Ok(None),
    }
}

fn is_open_goods(r: &RecordRow) -> bool {
    is_goods(&r.protection) && is_open_status(&r.status)
}

fn mapping_of<'a>(map: &'a CommodityMap, r: &RecordRow) -> Option<&'a CommodityMapping> {
    if !is_open_goods(r) {
        return None;
    }
    map.get(r.commodity.as_deref()?)
}

pub fn needs_concentrate_inputs(rows: &LoanSecurityRows, map: &CommodityMap) -> bool {
    rows.records
        .iter()
        .filter_map(|r| mapping_of(map, r))
        .any(|m| m.mode == MarkMode::MetalConcentrate)
}

pub fn mark_price_pairs(
    rows: &LoanSecurityRows,
    map: &CommodityMap,
    offtake: Option<&OfftakeTermsRow>,
) -> Vec<(String, String)> {
    let metals = || -> Vec<&str> {
        offtake
            .iter()
            .flat_map(|o| o.payable_terms.0.iter().map(|t| t.metal.as_str()))
            .collect()
    };
    mark_pairs(
        rows.records
            .iter()
            .filter_map(|r| mapping_of(map, r))
            .map(|m| (m, metals())),
    )
}

struct Ctx<'a> {
    chain_id: i64,
    contract: &'a str,
    marks: &'a MarkInputs<'a>,
    now: u64,
    terms: Option<&'a TermsRow>,
    valuation: Option<&'a ValuationRow>,
    counted: Option<&'a HashMap<u32, CountedEntry>>,
    resolved_terms: Vec<CountedTerm>,
    terms_complete: bool,
    un: &'a Unreadable,
}

fn term_of(entry: &CountedEntry, record_id: u32, r: &RecordRow) -> CountedTerm {
    CountedTerm {
        record_id,
        goods: is_goods(&r.protection),
        counted_quantity: entry.counted_quantity,
        value_per_unit: entry.value_per_unit,
    }
}

fn resolve_terms(
    counted: Option<&HashMap<u32, CountedEntry>>,
    parsed_all: bool,
    by_id: &HashMap<u32, &RecordRow>,
) -> (Vec<CountedTerm>, bool) {
    let Some(counted) = counted else {
        return (Vec::new(), false);
    };
    let mut complete = parsed_all;
    let mut terms = Vec::with_capacity(counted.len());
    for (id, entry) in counted {
        match by_id.get(id) {
            Some(r) => terms.push(term_of(entry, *id, r)),
            None => complete = false,
        }
    }
    (terms, complete)
}

fn record_valuation(ctx: &Ctx<'_>, r: &RecordRow) -> Option<RecordValuationDto> {
    let id = u32::try_from(r.record_id).ok()?;
    let entry = ctx.counted?.get(&id)?;
    let term = term_of(entry, id, r);
    Some(RecordValuationDto {
        counted_quantity: format_7dp_i128(entry.counted_quantity),
        value_per_unit: format_7dp_i128(entry.value_per_unit),
        mark_at: entry.mark_at.clone(),
        value: format_7dp_i128(record_term_value(&term)?),
        stale: entry.stale,
        flagged: entry.flagged,
    })
}

fn agent_release_of(ctx: &Ctx<'_>, r: &RecordRow) -> Option<String> {
    if !is_open_status(&r.status) {
        return None;
    }
    let valuation = ctx.valuation;
    let outstanding = valuation.and_then(|v| dec_to_u128(&v.outstanding));
    if release_unconditional(&r.status, &r.protection, outstanding) {
        return Some("allowed".to_owned());
    }
    let valuation = valuation?;
    let terms = ctx.terms?;
    if !ctx.terms_complete {
        return None;
    }
    let record_id = u32::try_from(r.record_id).ok()?;
    Some(
        agent_release(
            &r.status,
            &r.protection,
            outstanding?,
            dec_to_u128(&valuation.accrued_interest)?,
            &ctx.resolved_terms,
            record_id,
            clamp_u32(terms.advance_ratio_bps),
        )
        .as_str()
        .to_owned(),
    )
}

fn attestation_flag(ctx: &Ctx<'_>, r: &RecordRow, t: &TermsRow) -> Option<bool> {
    let interval = ctx.un.u64(&t.attestation_interval)?;
    if interval == 0 {
        return Some(false);
    }
    let attested_at = ctx.un.u64(r.attested_at.as_ref()?)?;
    Some(attestation_stale(ctx.now, attested_at, interval))
}

fn inspection_flag(
    ctx: &Ctx<'_>,
    r: &RecordRow,
    t: &TermsRow,
    lot: Option<&LotRow>,
) -> Option<bool> {
    let interval = ctx.un.u64(&t.inspection_interval)?;
    if interval == 0 {
        return Some(false);
    }
    let latest = match lot.and_then(|l| l.latest_inspected_at.as_ref()) {
        Some(d) => Some(ctx.un.u64(d)?),
        None => None,
    };
    let perfected_at = match (latest, r.perfected_at.as_ref()) {
        (Some(_), _) => 0,
        (None, Some(d)) => ctx.un.u64(d)?,
        (None, None) => return None,
    };
    Some(inspection_stale(
        ctx.now,
        &r.protection,
        perfected_at,
        latest,
        interval,
    ))
}

fn mark_flag(ctx: &Ctx<'_>, r: &RecordRow, t: &TermsRow) -> Option<bool> {
    let psa = ctx.un.u64(&t.price_stale_after)?;
    let mark_at = mark_state(r, ctx.un).ok()?;
    Some(mark_stale(ctx.now, is_goods(&r.protection), mark_at, psa))
}

fn suggested_mark_dto(s: &Suggestion) -> SuggestedMarkDto {
    SuggestedMarkDto {
        value_per_unit: format_7dp_i128(s.value_per_unit),
        benchmark: s.benchmark.clone(),
        source_price: s.source_price.clone(),
        source_at: s.source_at.to_string(),
        asset: s.asset.clone(),
        price_provider: s.price_provider.clone(),
        quote_unit: s.quote_unit.clone(),
        mode: s.mode.as_str().to_owned(),
        assay_id: s.assay_id.clone(),
        offtake_id: s.offtake_id.clone(),
        report: s.report.clone(),
        report_hash: s.report_hash.clone(),
    }
}

fn suggestion_of(
    ctx: &Ctx<'_>,
    r: &RecordRow,
    mapping: Option<&CommodityMapping>,
) -> (Option<Suggestion>, Option<SuggestionStatus>) {
    if !is_open_goods(r) {
        return (None, None);
    }
    let Ok(record_id) = u32::try_from(r.record_id) else {
        return (None, Some(SuggestionStatus::Unreadable));
    };
    let Some(mapping) = mapping else {
        return (None, Some(SuggestionStatus::Unmapped));
    };
    let Some(unit) = r.unit.as_deref() else {
        return (None, Some(SuggestionStatus::UnsupportedUnit));
    };
    let sctx = SuggestCtx {
        chain_id: ctx.chain_id,
        security_registry: ctx.contract,
        record_id,
        map: &ctx.marks.settings.map,
        prices: &ctx.marks.prices,
        concentrate: ctx.marks.concentrate.as_ref().map(|(a, o)| (a, o)),
    };
    match suggest_with(&sctx, mapping, unit) {
        Ok(s) => (Some(s), Some(SuggestionStatus::Ok)),
        Err(status) => {
            if status == SuggestionStatus::Unreadable {
                tracing::warn!(record_id, "mark suggestion inputs unreadable");
            }
            (None, Some(status))
        }
    }
}

type OnchainMark = Result<Option<(i128, u64)>, ()>;

fn onchain_mark(ctx: &Ctx<'_>, r: &RecordRow, counted_goods: bool) -> OnchainMark {
    if !counted_goods {
        return Ok(None);
    }
    match (&r.mark_value_per_unit, &r.mark_at) {
        (Some(v), Some(at)) => match (ctx.un.i128(v), ctx.un.u64(at)) {
            (Some(v), Some(at)) => Ok(Some((v, at))),
            _ => Err(()),
        },
        _ => Ok(None),
    }
}

fn due_fields(
    ctx: &Ctx<'_>,
    counted_goods: bool,
    mark: &OnchainMark,
    suggested: Option<i128>,
) -> (Option<bool>, Vec<String>, Option<String>) {
    if !counted_goods {
        return (Some(false), Vec::new(), None);
    }
    let psa = match ctx.terms {
        Some(t) => ctx.un.u64(&t.price_stale_after),
        None => Some(0),
    };
    let (Some(psa), Ok(mark)) = (psa, mark) else {
        return (None, Vec::new(), None);
    };
    let due = mark_due(ctx.now, *mark, suggested, psa, &ctx.marks.settings.policy);
    (
        Some(due.due),
        due.reasons.iter().map(|s| (*s).to_owned()).collect(),
        due.due_at.map(|a| a.to_string()),
    )
}

fn record_dto(
    ctx: &Ctx<'_>,
    r: &RecordRow,
    docs: &[&DocRow],
    lot: Option<&LotRow>,
    inspections: &[&InspectionRow],
    repayments: Vec<SaleRepaymentDto>,
) -> SecurityRecordDto {
    let counts = counts_toward_value(&r.status, &r.protection);
    let active = r.status == "Active";
    let mark = match (&r.mark_value_per_unit, &r.mark_at) {
        (Some(vpu), Some(at)) => Some(RecordMarkDto {
            value_per_unit: format_7dp(vpu),
            at: integer_string(at),
            benchmark: r.mark_benchmark.clone(),
            report_hash: r.mark_report_hash.clone(),
        }),
        _ => None,
    };
    let (attestation, inspection) = match (active, ctx.terms) {
        (true, Some(t)) => (attestation_flag(ctx, r, t), inspection_flag(ctx, r, t, lot)),
        _ => (None, None),
    };
    let mark_is_stale = if counts {
        ctx.terms.and_then(|t| mark_flag(ctx, r, t))
    } else {
        Some(false)
    };
    let counted_goods = counts && is_goods(&r.protection);
    let mapping = mapping_of(&ctx.marks.settings.map, r);
    let (suggestion, status) = suggestion_of(ctx, r, mapping);
    let suggested_vpu = suggestion.as_ref().map(|s| s.value_per_unit);
    let onchain = onchain_mark(ctx, r, counted_goods);
    let move_bps_value = match (&onchain, suggested_vpu) {
        (Ok(Some((m, _))), Some(sv)) => move_bps(*m, sv),
        _ => None,
    };
    let (due, due_reasons, due_at) = due_fields(ctx, counted_goods, &onchain, suggested_vpu);
    let flagged_by = r.flagged_by.filter(|f| *f != 0).map(|f| f.to_string());
    let lot_latest_id = lot.and_then(|l| l.latest_inspection_id);
    SecurityRecordDto {
        record_id: r.record_id.to_string(),
        lot_id: r.lot_id.to_string(),
        protection: r.protection.clone(),
        commodity: r.commodity.clone(),
        unit: r.unit.clone(),
        reference_quantity: qty_opt(r.reference_quantity.as_ref()),
        reference_grade: qty_opt(r.reference_grade.as_ref()),
        region: r.region.clone(),
        site_hash: r.site_hash.clone(),
        control_kind: r.control_kind.clone(),
        control_reference: r.control_reference.clone(),
        perfection: r.perfection.clone(),
        release_condition: r.release_condition.clone(),
        status: r.status.clone(),
        open: is_open_status(&r.status),
        perfected_at: int_opt(r.perfected_at.as_ref()),
        attested_by: r.attested_by.clone(),
        attested_at: int_opt(r.attested_at.as_ref()),
        flagged_by,
        registered_ledger: r.registered_ledger,
        closed_ledger: r.closed_ledger,
        release_reason_hash: r.release_reason_hash.clone(),
        released_by_consent: r.released_by_consent,
        complete: r.complete,
        needs_view: r.needs_view,
        docs: docs.iter().map(|d| doc_dto(d)).collect(),
        mark,
        suggested_mark: suggestion.as_ref().map(suggested_mark_dto),
        suggestion_status: status.map(|s| s.as_str().to_owned()),
        move_bps: move_bps_value,
        mark_due: due,
        mark_due_reasons: due_reasons,
        mark_due_at: due_at,
        lot: lot.map(lot_dto),
        counts_toward_value: counts,
        attestation_stale: attestation,
        inspection_stale: inspection,
        mark_stale: mark_is_stale,
        valuation: if counts {
            record_valuation(ctx, r)
        } else {
            None
        },
        agent_release: agent_release_of(ctx, r),
        inspections: inspections
            .iter()
            .map(|i| inspection_dto(i, lot_latest_id))
            .collect(),
        repayments,
    }
}

fn marks_due_count(records: &[SecurityRecordDto]) -> Option<u32> {
    let mut n = 0u32;
    for r in records
        .iter()
        .filter(|r| r.counts_toward_value && is_goods(&r.protection))
    {
        match r.mark_due {
            Some(true) => n = n.saturating_add(1),
            Some(false) => {}
            None => return None,
        }
    }
    Some(n)
}

fn prices_dto(
    now: u64,
    terms: &TermsRow,
    rows: &LoanSecurityRows,
    policy: &MarkPolicy,
    marks_due: Option<u32>,
    un: &Unreadable,
) -> PricesDto {
    let states: Result<Vec<Option<u64>>, ()> = rows
        .records
        .iter()
        .filter(|r| counts_toward_value(&r.status, &r.protection) && is_goods(&r.protection))
        .map(|r| mark_state(r, un))
        .collect();
    let psa = un.u64(&terms.price_stale_after);
    let mark_max_age = psa.map(|p| effective_max_age(policy.max_age, p).to_string());
    let Ok(marks) = states else {
        return PricesDto {
            mark_age: None,
            price_stale: None,
            mark_max_age,
            mark_move_bps: policy.move_bps,
            marks_due,
        };
    };
    let age = mark_age(now, &marks);
    let any_unmarked = marks.iter().any(Option::is_none);
    PricesDto {
        mark_age: Some(age.to_string()),
        price_stale: psa.map(|p| price_stale(age, p, any_unmarked)),
        mark_max_age,
        mark_move_bps: policy.move_bps,
        marks_due,
    }
}

fn margin_call_dto(
    now: u64,
    closed: bool,
    terms: &TermsRow,
    valuation: Option<&ValuationRow>,
    events: &[MarginCallEventRow],
    un: &Unreadable,
) -> MarginCallDto {
    let margin_call_at = un.u64(&terms.margin_call_at);
    let open = margin_call_at.map(|m| m != 0);
    let open_events: Vec<(u64, u64)> = events
        .iter()
        .filter(|e| e.kind == "open")
        .filter_map(|e| {
            let at = u64::try_from(e.block_timestamp).ok()?;
            Some((at, dec_to_u64(e.cure_by.as_ref()?)?))
        })
        .collect();
    let snapshot =
        valuation.and_then(|v| Some((dec_to_u64(&v.margin_call_at)?, dec_to_u64(&v.cure_by)?)));
    let (cure_by_at, source) =
        margin_call_at.map_or((None, None), |m| cure_by(m, &open_events, snapshot));
    let ltv = valuation.map(|v| v.ltv_bps);
    let last_open = events.iter().rev().find(|e| e.kind == "open");
    let last_stale = events.iter().rev().find(|e| e.kind == "price_stale");
    MarginCallDto {
        open,
        opened_at: margin_call_at.filter(|m| *m != 0).map(|m| m.to_string()),
        cure_by: cure_by_at.map(|c| c.to_string()),
        cure_by_source: source.map(str::to_owned),
        cure_overdue: open.map(|o| o && !closed && cure_by_at.is_some_and(|c| now > c)),
        last_margin_call_ltv_bps: last_open.map(|e| clamp_u32(e.ltv_bps)),
        last_price_stale: last_stale.map(|e| LastPriceStaleDto {
            ltv_bps: clamp_u32(e.ltv_bps),
            at: e.block_timestamp.to_string(),
        }),
        ltv_above_ratio_no_onchain_call: open
            .map(|o| !o && !closed && ltv.is_some_and(|l| l > terms.margin_call_ratio_bps)),
        open_call_curable: open.map(|o| o && ltv.is_some_and(|l| l <= terms.advance_ratio_bps)),
        events: events.iter().map(margin_event_dto).collect(),
    }
}

fn inspectors_of(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

pub fn build_security_response(
    chain_id: i64,
    contract: &str,
    loan_id: &str,
    rows: &LoanSecurityRows,
    now: u64,
    marks: &MarkInputs<'_>,
) -> LoanSecurityResponse {
    let terms = rows.terms.as_ref();
    let valuation = rows.valuation.as_ref().map(|(v, _)| v);
    let loan_status = rows.loan_status.clone();
    let closed = loan_status.as_deref() == Some("Closed");
    let parsed = valuation.and_then(|v| parse_counted(&v.counted_records));
    let (counted, parsed_all) = match parsed {
        Some((map, all)) => (Some(map), all),
        None => (None, false),
    };
    let by_id: HashMap<u32, &RecordRow> = rows
        .records
        .iter()
        .filter_map(|r| u32::try_from(r.record_id).ok().map(|id| (id, r)))
        .collect();
    let (resolved_terms, terms_complete) = resolve_terms(counted.as_ref(), parsed_all, &by_id);
    let un = Unreadable(Cell::new(false));
    let ctx = Ctx {
        chain_id,
        contract,
        marks,
        now,
        terms,
        valuation,
        counted: counted.as_ref(),
        resolved_terms,
        terms_complete,
        un: &un,
    };

    let mut repayments_by_sale: HashMap<i64, Vec<SaleRepaymentDto>> = HashMap::new();
    for r in &rows.repayments {
        let (Some(sale), Some(dto)) = (p_i64(&r.params, "sale_id"), repayment_dto(r)) else {
            continue;
        };
        repayments_by_sale.entry(sale).or_default().push(dto);
    }

    let mut docs_by_record: HashMap<i64, Vec<&DocRow>> = HashMap::new();
    for d in &rows.docs {
        docs_by_record.entry(d.record_id).or_default().push(d);
    }
    let mut inspections_by_record: HashMap<i64, Vec<&InspectionRow>> = HashMap::new();
    for i in &rows.inspections {
        inspections_by_record
            .entry(i.record_id)
            .or_default()
            .push(i);
    }
    let lots: HashMap<i64, &LotRow> = rows.lots.iter().map(|l| (l.lot_id, l)).collect();

    let records: Vec<SecurityRecordDto> = rows
        .records
        .iter()
        .map(|r| {
            record_dto(
                &ctx,
                r,
                docs_by_record.get(&r.record_id).map_or(&[], Vec::as_slice),
                lots.get(&r.lot_id).copied(),
                inspections_by_record
                    .get(&r.record_id)
                    .map_or(&[], Vec::as_slice),
                repayments_by_sale.remove(&r.record_id).unwrap_or_default(),
            )
        })
        .collect();

    let margin_call =
        terms.map(|t| margin_call_dto(now, closed, t, valuation, &rows.margin_events, &un));
    let marks_due = marks_due_count(&records);
    let prices = terms.map(|t| prices_dto(now, t, rows, &marks.settings.policy, marks_due, &un));
    if un.0.get() {
        tracing::warn!(
            loan_id,
            "security projection holds an undecodable number; dependent flags are null"
        );
    }

    let projected_log_id = rows.registry.as_ref().map_or(0, |(_, id)| *id);
    let refresh_pending = rows.sr_log_id > projected_log_id
        || (terms.is_some()
            && rows
                .valuation
                .as_ref()
                .is_none_or(|(v, _)| rows.valuation_log_id > v.source_log_id));

    LoanSecurityResponse {
        chain_id,
        loan_id: loan_id.to_owned(),
        security_registry: contract.to_owned(),
        now: now.to_string(),
        loan_status,
        paused: rows.registry.as_ref().and_then(|(s, _)| s.paused),
        inspectors: inspectors_of(
            rows.registry
                .as_ref()
                .and_then(|(s, _)| s.inspectors.as_ref()),
        ),
        refresh_pending,
        terms: terms.map(terms_dto),
        valuation: rows.valuation.as_ref().map(|(v, at)| valuation_dto(v, at)),
        margin_call,
        prices,
        extension_consents: rows.consents.iter().map(consent_dto).collect(),
        records,
    }
}
