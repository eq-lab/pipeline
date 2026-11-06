// spec: docs/references/security-registry-events.md#sync-loop
use std::sync::Arc;

use anyhow::{anyhow, bail, Result};
use async_trait::async_trait;
use stellar_xdr::curr::ScVal;

use shared::security_registry::{
    ContractView, CountedRecordView, CoverageDetailView, DocView, InspectionView, LoanMoneyView,
    MarkView, RecordView, TermsView,
};

use crate::indexer::stellar::loan_registry_reader::{
    expect_map, map_bool, map_bytes32, map_entry, map_enum_variant, map_i128, map_string, map_u128,
    map_u32, map_u64, simulate_view, ScMapSlice,
};
use crate::indexer::stellar::parsers::sc_address_to_strkey;
use crate::indexer::stellar::rpc::StellarRpc;

pub const NO_RECORD_CODE: u32 = 1;
pub const NO_TERMS_CODE: u32 = 14;
pub const NO_INSPECTION_CODE: u32 = 25;

pub fn is_contract_error(msg: &str, code: u32) -> bool {
    msg.contains(&format!("Error(Contract, #{code})"))
}

fn address(map: &ScMapSlice, key: &str, ctx: &str) -> Result<String> {
    match map_entry(map, key) {
        Some(ScVal::Address(a)) => {
            sc_address_to_strkey(a).ok_or_else(|| anyhow!("{ctx}.{key}: unsupported address"))
        }
        other => bail!("{ctx}.{key}: expected Address, got {other:?}"),
    }
}

fn opt_address(map: &ScMapSlice, key: &str, ctx: &str) -> Result<Option<String>> {
    match map_entry(map, key) {
        Some(ScVal::Void) => Ok(None),
        Some(ScVal::Address(a)) => {
            Ok(Some(sc_address_to_strkey(a).ok_or_else(|| {
                anyhow!("{ctx}.{key}: unsupported address")
            })?))
        }
        other => bail!("{ctx}.{key}: expected Void or Address, got {other:?}"),
    }
}

fn symbol(map: &ScMapSlice, key: &str, ctx: &str) -> Result<String> {
    match map_entry(map, key) {
        Some(ScVal::Symbol(s)) => Ok(s.0.to_utf8_string_lossy()),
        other => bail!("{ctx}.{key}: expected Symbol, got {other:?}"),
    }
}

fn i32_field(map: &ScMapSlice, key: &str, ctx: &str) -> Result<i32> {
    match map_entry(map, key) {
        Some(ScVal::I32(v)) => Ok(*v),
        other => bail!("{ctx}.{key}: expected I32, got {other:?}"),
    }
}

fn hex32(map: &ScMapSlice, key: &str, ctx: &str) -> Result<String> {
    Ok(hex::encode(map_bytes32(map, key, ctx)?))
}

fn list<'a>(map: &'a ScMapSlice, key: &str, ctx: &str) -> Result<&'a [ScVal]> {
    match map_entry(map, key) {
        Some(ScVal::Vec(items)) => Ok(items.as_ref().map_or(&[], |i| i.0.as_slice())),
        other => bail!("{ctx}.{key}: expected Vec, got {other:?}"),
    }
}

fn mark_from(v: &ScVal) -> Result<MarkView> {
    let m = expect_map(v, "Mark")?;
    Ok(MarkView {
        value_per_unit: map_i128(&m, "value_per_unit", "Mark")?.to_string(),
        at: map_u64(&m, "at", "Mark")?.to_string(),
        benchmark: symbol(&m, "benchmark", "Mark")?,
        report_hash: hex32(&m, "report_hash", "Mark")?,
    })
}

pub fn decode_record(scval: &ScVal) -> Result<RecordView> {
    let m = expect_map(scval, "Record")?;
    let control = match map_entry(&m, "control") {
        Some(v) => expect_map(v, "Record.control")?,
        None => bail!("Record.control: field missing"),
    };
    let docs = list(&m, "docs", "Record")?
        .iter()
        .map(|d| {
            let dm = expect_map(d, "Doc")?;
            Ok(DocView {
                kind: map_enum_variant(&dm, "kind", "Doc")?,
                sha256: hex32(&dm, "sha256", "Doc")?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let marks = list(&m, "mark", "Record")?;
    let mark = match marks {
        [] => None,
        [one] => Some(mark_from(one)?),
        _ => bail!("Record.mark: expected 0 or 1 elements"),
    };
    Ok(RecordView {
        record_id: map_u32(&m, "record_id", "Record")?,
        loan_id: map_u32(&m, "loan_id", "Record")?,
        lot_id: map_u32(&m, "lot_id", "Record")?,
        protection: map_enum_variant(&m, "protection", "Record")?,
        commodity: map_string(&m, "commodity", "Record")?,
        unit: map_enum_variant(&m, "unit", "Record")?,
        reference_quantity: map_i128(&m, "reference_quantity", "Record")?.to_string(),
        reference_grade: map_i128(&m, "reference_grade", "Record")?.to_string(),
        region: map_string(&m, "region", "Record")?,
        site_hash: hex32(&m, "site_hash", "Record")?,
        control_kind: map_enum_variant(&control, "kind", "Control")?,
        control_reference: map_string(&control, "reference", "Control")?,
        perfection: map_enum_variant(&m, "perfection", "Record")?,
        release_condition: hex32(&m, "release_condition", "Record")?,
        docs,
        status: map_enum_variant(&m, "status", "Record")?,
        perfected_at: map_u64(&m, "perfected_at", "Record")?.to_string(),
        attested_by: opt_address(&m, "attested_by", "Record")?,
        attested_at: map_u64(&m, "attested_at", "Record")?.to_string(),
        flagged_by: map_u32(&m, "flagged_by", "Record")?,
        mark,
    })
}

pub fn decode_inspection(scval: &ScVal) -> Result<InspectionView> {
    let m = expect_map(scval, "Inspection")?;
    Ok(InspectionView {
        inspection_id: map_u32(&m, "inspection_id", "Inspection")?,
        record_id: map_u32(&m, "record_id", "Inspection")?,
        lot_id: map_u32(&m, "lot_id", "Inspection")?,
        inspector: address(&m, "inspector", "Inspection")?,
        kind: map_enum_variant(&m, "kind", "Inspection")?,
        inspected_at: map_u64(&m, "inspected_at", "Inspection")?.to_string(),
        region: map_string(&m, "region", "Inspection")?,
        site_hash: hex32(&m, "site_hash", "Inspection")?,
        quantity: map_i128(&m, "quantity", "Inspection")?.to_string(),
        grade: map_i128(&m, "grade", "Inspection")?.to_string(),
        certificate_hash: hex32(&m, "certificate_hash", "Inspection")?,
        certificate_no: map_string(&m, "certificate_no", "Inspection")?,
        entered_by: address(&m, "entered_by", "Inspection")?,
        entered_at: map_u64(&m, "entered_at", "Inspection")?.to_string(),
        approved_by: opt_address(&m, "approved_by", "Inspection")?,
        approved_at: map_u64(&m, "approved_at", "Inspection")?.to_string(),
        variance_reference_bps: i32_field(&m, "variance_reference_bps", "Inspection")?,
        variance_previous_bps: i32_field(&m, "variance_previous_bps", "Inspection")?,
        variance_grade_bps: i32_field(&m, "variance_grade_bps", "Inspection")?,
    })
}

pub fn decode_terms(scval: &ScVal) -> Result<TermsView> {
    let m = expect_map(scval, "Terms")?;
    Ok(TermsView {
        advance_ratio_bps: map_u32(&m, "advance_ratio_bps", "Terms")?,
        margin_call_ratio_bps: map_u32(&m, "margin_call_ratio_bps", "Terms")?,
        cure_period: map_u64(&m, "cure_period", "Terms")?.to_string(),
        price_stale_after: map_u64(&m, "price_stale_after", "Terms")?.to_string(),
        payment_term: map_enum_variant(&m, "payment_term", "Terms")?,
        grace_period: map_u64(&m, "grace_period", "Terms")?.to_string(),
        default_rate: map_u32(&m, "default_rate", "Terms")?,
        attestation_interval: map_u64(&m, "attestation_interval", "Terms")?.to_string(),
        inspection_interval: map_u64(&m, "inspection_interval", "Terms")?.to_string(),
        tolerance_bps: map_u32(&m, "tolerance_bps", "Terms")?,
        grade_tolerance_bps: map_u32(&m, "grade_tolerance_bps", "Terms")?,
        margin_call_at: map_u64(&m, "margin_call_at", "Terms")?.to_string(),
    })
}

pub fn decode_coverage_detail(scval: &ScVal) -> Result<CoverageDetailView> {
    let m = expect_map(scval, "CoverageDetail")?;
    let records = list(&m, "records", "CoverageDetail")?
        .iter()
        .map(|r| {
            let rm = expect_map(r, "CountedRecord")?;
            Ok(CountedRecordView {
                record_id: map_u32(&rm, "record_id", "CountedRecord")?,
                counted_quantity: map_i128(&rm, "counted_quantity", "CountedRecord")?.to_string(),
                value_per_unit: map_i128(&rm, "value_per_unit", "CountedRecord")?.to_string(),
                mark_at: map_u64(&rm, "mark_at", "CountedRecord")?.to_string(),
                stale: map_bool(&rm, "stale", "CountedRecord")?,
                flagged: map_bool(&rm, "flagged", "CountedRecord")?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(CoverageDetailView {
        value: map_i128(&m, "value", "CoverageDetail")?.to_string(),
        stale_value: map_i128(&m, "stale_value", "CoverageDetail")?.to_string(),
        flagged_value: map_i128(&m, "flagged_value", "CoverageDetail")?.to_string(),
        debt: map_u128(&m, "debt", "CoverageDetail")?.to_string(),
        coverage_bps: map_u32(&m, "coverage_bps", "CoverageDetail")?,
        ltv_bps: map_u32(&m, "ltv_bps", "CoverageDetail")?,
        margin_call_at: map_u64(&m, "margin_call_at", "CoverageDetail")?.to_string(),
        cure_by: map_u64(&m, "cure_by", "CoverageDetail")?.to_string(),
        price_stale: map_bool(&m, "price_stale", "CoverageDetail")?,
        records,
    })
}

pub fn decode_loan_money(scval: &ScVal) -> Result<LoanMoneyView> {
    let m = expect_map(scval, "LoanMoney")?;
    Ok(LoanMoneyView {
        disbursed: map_u128(&m, "disbursed", "LoanMoney")?.to_string(),
        repaid: map_u128(&m, "repaid", "LoanMoney")?.to_string(),
        written_down: map_u128(&m, "written_down", "LoanMoney")?.to_string(),
        outstanding: map_u128(&m, "outstanding", "LoanMoney")?.to_string(),
        accrued_interest: map_u128(&m, "accrued_interest", "LoanMoney")?.to_string(),
        carved_out: map_bool(&m, "carved_out", "LoanMoney")?,
    })
}

fn vec_items<'a>(scval: &'a ScVal, ctx: &str) -> Result<&'a [ScVal]> {
    match scval {
        ScVal::Vec(items) => Ok(items.as_ref().map_or(&[], |i| i.0.as_slice())),
        other => bail!("{ctx}: expected Vec, got {other:?}"),
    }
}

pub fn decode_address(scval: &ScVal) -> Result<String> {
    match scval {
        ScVal::Address(a) => {
            sc_address_to_strkey(a).ok_or_else(|| anyhow!("unsupported address {a:?}"))
        }
        other => bail!("expected Address, got {other:?}"),
    }
}

pub fn decode_inspectors(scval: &ScVal) -> Result<Vec<String>> {
    vec_items(scval, "inspectors")?
        .iter()
        .map(decode_address)
        .collect()
}

pub fn decode_consents(scval: &ScVal) -> Result<Vec<String>> {
    vec_items(scval, "extension_consents")?
        .iter()
        .map(|v| match v {
            ScVal::Bytes(b) if b.0.len() == 32 => Ok(hex::encode(b.0.as_slice())),
            other => bail!("extension_consents: expected 32-byte Bytes, got {other:?}"),
        })
        .collect()
}

pub fn decode_bool(scval: &ScVal) -> Result<bool> {
    match scval {
        ScVal::Bool(b) => Ok(*b),
        other => bail!("expected Bool, got {other:?}"),
    }
}

pub fn contract_view(paused: bool, inspectors: Vec<String>, loan_registry: String) -> ContractView {
    ContractView {
        paused,
        inspectors,
        loan_registry,
    }
}

#[async_trait]
pub trait SecurityViewSource: Send + Sync {
    async fn record(&self, record_id: u32) -> Result<(RecordView, u64)>;
    async fn inspection(&self, inspection_id: u32) -> Result<(InspectionView, u64)>;
    async fn terms(&self, loan_id: u32) -> Result<(Option<TermsView>, u64)>;
    async fn extension_consents(&self, loan_id: u32) -> Result<(Vec<String>, u64)>;
    async fn inspectors(&self) -> Result<(Vec<String>, u64)>;
    async fn paused(&self) -> Result<(bool, u64)>;
    async fn loan_registry(&self) -> Result<(String, u64)>;
    async fn coverage_detail(&self, loan_id: u32) -> Result<(CoverageDetailView, u64)>;
    async fn loan_money(&self, registry: &str, loan_id: u32) -> Result<(LoanMoneyView, u64)>;
}

pub struct RpcSecurityViewSource {
    rpc: Arc<StellarRpc>,
    contract_id: String,
}

impl RpcSecurityViewSource {
    pub fn new(rpc: Arc<StellarRpc>, contract_id: String) -> Self {
        Self { rpc, contract_id }
    }

    async fn call(&self, contract: &str, name: &str, args: Vec<ScVal>) -> Result<(ScVal, u64)> {
        simulate_view(&self.rpc, contract, name, args).await
    }
}

#[async_trait]
impl SecurityViewSource for RpcSecurityViewSource {
    async fn record(&self, record_id: u32) -> Result<(RecordView, u64)> {
        let (v, l) = self
            .call(&self.contract_id, "record", vec![ScVal::U32(record_id)])
            .await?;
        Ok((decode_record(&v)?, l))
    }

    async fn inspection(&self, inspection_id: u32) -> Result<(InspectionView, u64)> {
        let (v, l) = self
            .call(
                &self.contract_id,
                "inspection",
                vec![ScVal::U32(inspection_id)],
            )
            .await?;
        Ok((decode_inspection(&v)?, l))
    }

    async fn terms(&self, loan_id: u32) -> Result<(Option<TermsView>, u64)> {
        let before = self.rpc.get_latest_ledger().await?;
        match self
            .call(&self.contract_id, "terms", vec![ScVal::U32(loan_id)])
            .await
        {
            Ok((v, l)) => Ok((Some(decode_terms(&v)?), l)),
            Err(e) if is_contract_error(&e.to_string(), NO_TERMS_CODE) => Ok((None, before)),
            Err(e) => Err(e),
        }
    }

    async fn extension_consents(&self, loan_id: u32) -> Result<(Vec<String>, u64)> {
        let (v, l) = self
            .call(
                &self.contract_id,
                "extension_consents",
                vec![ScVal::U32(loan_id)],
            )
            .await?;
        Ok((decode_consents(&v)?, l))
    }

    async fn inspectors(&self) -> Result<(Vec<String>, u64)> {
        let (v, l) = self.call(&self.contract_id, "inspectors", vec![]).await?;
        Ok((decode_inspectors(&v)?, l))
    }

    async fn paused(&self) -> Result<(bool, u64)> {
        let (v, l) = self.call(&self.contract_id, "paused", vec![]).await?;
        Ok((decode_bool(&v)?, l))
    }

    async fn loan_registry(&self) -> Result<(String, u64)> {
        let (v, l) = self
            .call(&self.contract_id, "loan_registry", vec![])
            .await?;
        Ok((decode_address(&v)?, l))
    }

    async fn coverage_detail(&self, loan_id: u32) -> Result<(CoverageDetailView, u64)> {
        let (v, l) = self
            .call(
                &self.contract_id,
                "coverage_detail",
                vec![ScVal::U32(loan_id)],
            )
            .await?;
        Ok((decode_coverage_detail(&v)?, l))
    }

    async fn loan_money(&self, registry: &str, loan_id: u32) -> Result<(LoanMoneyView, u64)> {
        let (v, l) = self
            .call(registry, "loan_money", vec![ScVal::U32(loan_id)])
            .await?;
        Ok((decode_loan_money(&v)?, l))
    }
}
