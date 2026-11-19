// spec: docs/references/security-registry-events.md#sync-loop
use crate::evm_http::evm_rpc_client;
use alloy::eips::BlockId;
use alloy::primitives::{Address, Bytes, B256, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::TransactionRequest;
use alloy::sol_types::{SolCall, SolError};
use alloy::transports::http::Http;
use alloy::transports::{RpcError, TransportErrorKind};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;

use shared::security_registry::{
    CountedRecordView, CoverageDetailView, DocView, InspectionView, LoanMoneyView, MarkView,
    RecordView, TermsView,
};

use crate::indexer::collateral_registry_parsers::benchmark_string;
use crate::indexer::security_registry_parsers::{
    control_kind_name, doc_kind_name, inspection_kind_name, payment_term_name, perfection_name,
    protection_name, record_status_name, unit_name,
};
pub use crate::indexer::security_registry_sync::SecurityViewSource;

pub mod rd {
    use alloy::sol;
    sol! {
        struct Terms {
            uint32 advanceRatioBps;
            uint32 marginCallRatioBps;
            uint32 defaultRatioBps;
            uint64 curePeriod;
            uint64 priceStaleAfter;
            uint8 paymentTerm;
            uint64 gracePeriod;
            uint32 defaultRate;
            uint32 originatorFeeRate;
            uint64 attestationInterval;
            uint64 inspectionInterval;
            uint32 toleranceBps;
            uint32 gradeToleranceBps;
            uint64 marginCallAt;
            uint64 defaultBreachAt;
        }
        struct Mark {
            uint256 valuePerUnit;
            uint64 at;
            bytes32 benchmark;
            bytes32 reportHash;
        }
        struct Record {
            uint256 recordId;
            uint256 loanId;
            uint256 lotId;
            uint8 protection;
            uint8 unit;
            uint8 status;
            bool hasMark;
            uint64 perfectedAt;
            uint64 attestedAt;
            address attestedBy;
            uint256 flaggedBy;
            uint256 referenceQuantity;
            uint256 referenceGrade;
            bytes32 commodityHash;
            Mark mark;
        }
        struct Control {
            uint8 kind;
            string reference;
        }
        struct Doc {
            uint8 kind;
            bytes32 hash;
        }
        struct RecordDetails {
            uint8 perfection;
            string commodity;
            string region;
            bytes32 siteHash;
            bytes32 releaseCondition;
            Control control;
            Doc[] docs;
        }
        struct RecordView {
            Record record;
            RecordDetails details;
        }
        struct Inspection {
            uint256 inspectionId;
            uint256 recordId;
            uint256 lotId;
            address inspector;
            uint8 kind;
            uint64 inspectedAt;
            address enteredBy;
            uint64 enteredAt;
            address approvedBy;
            uint64 approvedAt;
            int32 varianceReferenceBps;
            int32 variancePreviousBps;
            int32 varianceGradeBps;
            uint256 quantity;
            uint256 grade;
            bytes32 siteHash;
            bytes32 certificateHash;
            string region;
            string certificateNo;
        }
        struct CountedRecord {
            uint256 recordId;
            uint256 countedQuantity;
            uint256 valuePerUnit;
            uint64 markAt;
            bool stale;
            bool flagged;
        }
        struct CoverageDetail {
            uint256 value;
            uint256 staleValue;
            uint256 flaggedValue;
            uint256 debt;
            uint32 coverageBps;
            uint32 ltvBps;
            uint64 marginCallAt;
            uint256 cureBy;
            uint64 defaultBreachAt;
            bool priceStale;
            CountedRecord[] records;
        }
        struct LoanMoney {
            uint256 disbursed;
            uint256 repaid;
            uint256 writtenDown;
            uint256 outstanding;
            uint256 accruedInterest;
            bool carvedOut;
        }

        function record(uint256 recordId) external view returns (RecordView memory);
        function coverageDetail(uint256 loanId) external view returns (CoverageDetail memory);
        function terms(uint256 loanId) external view returns (Terms memory);
        function extensionConsents(uint256 loanId) external view returns (bytes32[] memory);
        function paused() external view returns (bool);
        function loanRegistry() external view returns (address);
        function inspection(uint256 inspectionId) external view returns (Inspection memory);
        function inspectors() external view returns (address[] memory);
        function loanMoney(uint256 loanId) external view returns (LoanMoney memory);

        error SecurityRegistryNonExistentRecord();
        error SecurityRegistryNoTerms();
        error SecurityRecordNftNonExistentInspection();
    }
}

pub mod rd_f92d719 {
    use alloy::sol;
    sol! {
        struct Terms {
            uint32 advanceRatioBps;
            uint32 marginCallRatioBps;
            uint64 curePeriod;
            uint64 priceStaleAfter;
            uint8 paymentTerm;
            uint64 gracePeriod;
            uint32 defaultRate;
            uint64 attestationInterval;
            uint64 inspectionInterval;
            uint32 toleranceBps;
            uint32 gradeToleranceBps;
            uint64 marginCallAt;
        }
        struct CountedRecord {
            uint256 recordId;
            uint256 countedQuantity;
            uint256 valuePerUnit;
            uint64 markAt;
            bool stale;
            bool flagged;
        }
        struct CoverageDetail {
            uint256 value;
            uint256 staleValue;
            uint256 flaggedValue;
            uint256 debt;
            uint32 coverageBps;
            uint32 ltvBps;
            uint64 marginCallAt;
            uint256 cureBy;
            bool priceStale;
            CountedRecord[] records;
        }
        function coverageDetail(uint256 loanId) external view returns (CoverageDetail memory);
        function terms(uint256 loanId) external view returns (Terms memory);
    }
}

type HttpProvider = alloy::providers::RootProvider<Http<Client>>;

fn hex32(v: &B256) -> String {
    hex::encode(v.as_slice())
}

fn to_u32(v: U256, what: &str) -> Result<u32> {
    u32::try_from(v).map_err(|_| anyhow!("{what} {v} exceeds u32"))
}

fn opt_address(a: Address) -> Option<String> {
    (!a.is_zero()).then(|| a.to_checksum(None))
}

pub fn decode_record(result: &[u8]) -> Result<RecordView> {
    let v = rd::recordCall::abi_decode_returns(result, true)
        .context("decode Reader.record return")?
        ._0;
    let (r, d) = (v.record, v.details);
    let mark = r.hasMark.then(|| MarkView {
        value_per_unit: r.mark.valuePerUnit.to_string(),
        at: r.mark.at.to_string(),
        benchmark: benchmark_string(&r.mark.benchmark),
        report_hash: hex32(&r.mark.reportHash),
    });
    Ok(RecordView {
        record_id: to_u32(r.recordId, "record_id")?,
        loan_id: to_u32(r.loanId, "loan_id")?,
        lot_id: to_u32(r.lotId, "lot_id")?,
        protection: protection_name(r.protection).to_owned(),
        commodity: d.commodity,
        unit: unit_name(r.unit).to_owned(),
        reference_quantity: r.referenceQuantity.to_string(),
        reference_grade: r.referenceGrade.to_string(),
        region: d.region,
        site_hash: hex32(&d.siteHash),
        control_kind: control_kind_name(d.control.kind).to_owned(),
        control_reference: d.control.reference,
        perfection: perfection_name(d.perfection).to_owned(),
        release_condition: hex32(&d.releaseCondition),
        docs: d
            .docs
            .iter()
            .map(|doc| DocView {
                kind: doc_kind_name(doc.kind).to_owned(),
                sha256: hex32(&doc.hash),
            })
            .collect(),
        status: record_status_name(r.status).to_owned(),
        perfected_at: r.perfectedAt.to_string(),
        attested_by: opt_address(r.attestedBy),
        attested_at: r.attestedAt.to_string(),
        flagged_by: to_u32(r.flaggedBy, "flagged_by")?,
        mark,
    })
}

pub fn decode_inspection(result: &[u8]) -> Result<InspectionView> {
    let i = rd::inspectionCall::abi_decode_returns(result, true)
        .context("decode inspection return")?
        ._0;
    Ok(InspectionView {
        inspection_id: to_u32(i.inspectionId, "inspection_id")?,
        record_id: to_u32(i.recordId, "record_id")?,
        lot_id: to_u32(i.lotId, "lot_id")?,
        inspector: i.inspector.to_checksum(None),
        kind: inspection_kind_name(i.kind).to_owned(),
        inspected_at: i.inspectedAt.to_string(),
        region: i.region,
        site_hash: hex32(&i.siteHash),
        quantity: i.quantity.to_string(),
        grade: i.grade.to_string(),
        certificate_hash: hex32(&i.certificateHash),
        certificate_no: i.certificateNo,
        entered_by: i.enteredBy.to_checksum(None),
        entered_at: i.enteredAt.to_string(),
        approved_by: opt_address(i.approvedBy),
        approved_at: i.approvedAt.to_string(),
        variance_reference_bps: i.varianceReferenceBps,
        variance_previous_bps: i.variancePreviousBps,
        variance_grade_bps: i.varianceGradeBps,
    })
}

pub fn decode_terms(result: &[u8]) -> Result<TermsView> {
    match rd::termsCall::abi_decode_returns(result, true) {
        Ok(r) => {
            let t = r._0;
            Ok(TermsView {
                advance_ratio_bps: t.advanceRatioBps,
                margin_call_ratio_bps: t.marginCallRatioBps,
                cure_period: t.curePeriod.to_string(),
                price_stale_after: t.priceStaleAfter.to_string(),
                payment_term: payment_term_name(t.paymentTerm).to_owned(),
                grace_period: t.gracePeriod.to_string(),
                default_rate: t.defaultRate,
                attestation_interval: t.attestationInterval.to_string(),
                inspection_interval: t.inspectionInterval.to_string(),
                tolerance_bps: t.toleranceBps,
                grade_tolerance_bps: t.gradeToleranceBps,
                margin_call_at: t.marginCallAt.to_string(),
                default_ratio_bps: Some(t.defaultRatioBps),
                originator_fee_rate: Some(t.originatorFeeRate),
                default_breach_at: Some(t.defaultBreachAt.to_string()),
            })
        }
        Err(new_err) => {
            let t = rd_f92d719::termsCall::abi_decode_returns(result, true)
                .map_err(|old_err| {
                    anyhow!(
                        "decode terms return: neither the 150631a (15-field) nor the f92d719 (12-field) shape ({new_err}; {old_err})"
                    )
                })?
                ._0;
            Ok(TermsView {
                advance_ratio_bps: t.advanceRatioBps,
                margin_call_ratio_bps: t.marginCallRatioBps,
                cure_period: t.curePeriod.to_string(),
                price_stale_after: t.priceStaleAfter.to_string(),
                payment_term: payment_term_name(t.paymentTerm).to_owned(),
                grace_period: t.gracePeriod.to_string(),
                default_rate: t.defaultRate,
                attestation_interval: t.attestationInterval.to_string(),
                inspection_interval: t.inspectionInterval.to_string(),
                tolerance_bps: t.toleranceBps,
                grade_tolerance_bps: t.gradeToleranceBps,
                margin_call_at: t.marginCallAt.to_string(),
                default_ratio_bps: None,
                originator_fee_rate: None,
                default_breach_at: None,
            })
        }
    }
}

fn counted_record(
    record_id: U256,
    counted_quantity: U256,
    value_per_unit: U256,
    mark_at: u64,
    stale: bool,
    flagged: bool,
) -> Result<CountedRecordView> {
    Ok(CountedRecordView {
        record_id: to_u32(record_id, "record_id")?,
        counted_quantity: counted_quantity.to_string(),
        value_per_unit: value_per_unit.to_string(),
        mark_at: mark_at.to_string(),
        stale,
        flagged,
    })
}

pub fn decode_coverage_detail(result: &[u8]) -> Result<CoverageDetailView> {
    match rd::coverageDetailCall::abi_decode_returns(result, true) {
        Ok(r) => {
            let d = r._0;
            let records = d
                .records
                .iter()
                .map(|r| {
                    counted_record(
                        r.recordId,
                        r.countedQuantity,
                        r.valuePerUnit,
                        r.markAt,
                        r.stale,
                        r.flagged,
                    )
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(CoverageDetailView {
                value: d.value.to_string(),
                stale_value: d.staleValue.to_string(),
                flagged_value: d.flaggedValue.to_string(),
                debt: d.debt.to_string(),
                coverage_bps: d.coverageBps,
                ltv_bps: d.ltvBps,
                margin_call_at: d.marginCallAt.to_string(),
                cure_by: d.cureBy.to_string(),
                price_stale: d.priceStale,
                records,
                default_breach_at: Some(d.defaultBreachAt.to_string()),
            })
        }
        Err(new_err) => {
            let d = rd_f92d719::coverageDetailCall::abi_decode_returns(result, true)
                .map_err(|old_err| {
                    anyhow!(
                        "decode coverageDetail return: neither the 150631a (11-field head) nor the f92d719 (10-field head) shape ({new_err}; {old_err})"
                    )
                })?
                ._0;
            let records = d
                .records
                .iter()
                .map(|r| {
                    counted_record(
                        r.recordId,
                        r.countedQuantity,
                        r.valuePerUnit,
                        r.markAt,
                        r.stale,
                        r.flagged,
                    )
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(CoverageDetailView {
                value: d.value.to_string(),
                stale_value: d.staleValue.to_string(),
                flagged_value: d.flaggedValue.to_string(),
                debt: d.debt.to_string(),
                coverage_bps: d.coverageBps,
                ltv_bps: d.ltvBps,
                margin_call_at: d.marginCallAt.to_string(),
                cure_by: d.cureBy.to_string(),
                price_stale: d.priceStale,
                records,
                default_breach_at: None,
            })
        }
    }
}

pub fn decode_loan_money(result: &[u8]) -> Result<LoanMoneyView> {
    let m = rd::loanMoneyCall::abi_decode_returns(result, true)
        .context("decode loanMoney return")?
        ._0;
    Ok(LoanMoneyView {
        disbursed: m.disbursed.to_string(),
        repaid: m.repaid.to_string(),
        written_down: m.writtenDown.to_string(),
        outstanding: m.outstanding.to_string(),
        accrued_interest: m.accruedInterest.to_string(),
        carved_out: m.carvedOut,
    })
}

pub fn decode_inspectors(result: &[u8]) -> Result<Vec<String>> {
    let list = rd::inspectorsCall::abi_decode_returns(result, true)
        .context("decode inspectors return")?
        ._0;
    Ok(list.iter().map(|a| a.to_checksum(None)).collect())
}

pub fn decode_consents(result: &[u8]) -> Result<Vec<String>> {
    let list = rd::extensionConsentsCall::abi_decode_returns(result, true)
        .context("decode extensionConsents return")?
        ._0;
    Ok(list.iter().map(hex32).collect())
}

pub fn decode_address(result: &[u8]) -> Result<String> {
    let a = rd::loanRegistryCall::abi_decode_returns(result, true)
        .context("decode address return")?
        ._0;
    Ok(a.to_checksum(None))
}

pub fn decode_bool(result: &[u8]) -> Result<bool> {
    Ok(rd::pausedCall::abi_decode_returns(result, true)
        .context("decode bool return")?
        ._0)
}

fn selector_in_hex(s: &str) -> Option<[u8; 4]> {
    let digits = s.strip_prefix("0x")?;
    if !digits.is_ascii() || digits.len() < 8 {
        return None;
    }
    hex::decode(&digits[..8]).ok()?.try_into().ok()
}

fn selector_in_data(v: &Value) -> Option<[u8; 4]> {
    match v {
        Value::String(s) => selector_in_hex(s),
        Value::Object(o) => o.get("data").and_then(selector_in_data),
        _ => None,
    }
}

pub fn revert_selector_from_payload(
    payload: &alloy::rpc::json_rpc::ErrorPayload,
) -> Option<[u8; 4]> {
    let raw = payload.data.as_ref()?;
    selector_in_data(&serde_json::from_str::<Value>(raw.get()).ok()?)
}

pub fn revert_selector(e: &anyhow::Error) -> Option<[u8; 4]> {
    e.chain()
        .find_map(|c| c.downcast_ref::<RpcError<TransportErrorKind>>())
        .and_then(RpcError::as_error_resp)
        .and_then(revert_selector_from_payload)
}

pub struct EvmSecurityViewSource {
    provider: HttpProvider,
    registry: Address,
    nft: Address,
    reader: Address,
    confirmations: u64,
}

impl EvmSecurityViewSource {
    pub fn new(
        rpc_url: &str,
        registry: Address,
        nft: Address,
        reader: Address,
        confirmations: u64,
    ) -> Result<Self> {
        let provider: HttpProvider = ProviderBuilder::new().on_client(evm_rpc_client(
            rpc_url
                .parse()
                .with_context(|| format!("EvmSecurityViewSource: invalid RPC URL {rpc_url}"))?,
        ));
        Ok(Self {
            provider,
            registry,
            nft,
            reader,
            confirmations,
        })
    }

    async fn call_at(&self, to: Address, data: Vec<u8>, at: u64) -> Result<Bytes> {
        self.provider
            .call(&TransactionRequest::default().to(to).input(data.into()))
            .block(BlockId::number(at))
            .await
            .with_context(|| format!("eth_call on {to} at block {at} failed"))
    }

    async fn call(&self, to: Address, data: Vec<u8>) -> Result<(Bytes, u64)> {
        let at = self.latest_ledger().await?;
        Ok((self.call_at(to, data, at).await?, at))
    }
}

#[async_trait]
impl SecurityViewSource for EvmSecurityViewSource {
    async fn record(&self, record_id: u32) -> Result<(RecordView, u64)> {
        let data = rd::recordCall {
            recordId: U256::from(record_id),
        }
        .abi_encode();
        let (out, at) = self.call(self.reader, data).await?;
        Ok((decode_record(&out)?, at))
    }

    async fn inspection(&self, inspection_id: u32) -> Result<(InspectionView, u64)> {
        let data = rd::inspectionCall {
            inspectionId: U256::from(inspection_id),
        }
        .abi_encode();
        let (out, at) = self.call(self.nft, data).await?;
        Ok((decode_inspection(&out)?, at))
    }

    async fn terms(&self, loan_id: u32) -> Result<(Option<TermsView>, u64)> {
        let data = rd::termsCall {
            loanId: U256::from(loan_id),
        }
        .abi_encode();
        let at = self.latest_ledger().await?;
        match self.call_at(self.registry, data, at).await {
            Ok(out) => Ok((Some(decode_terms(&out)?), at)),
            Err(e) if revert_selector(&e) == Some(rd::SecurityRegistryNoTerms::SELECTOR) => {
                Ok((None, at))
            }
            Err(e) => Err(e),
        }
    }

    async fn extension_consents(&self, loan_id: u32) -> Result<(Vec<String>, u64)> {
        let data = rd::extensionConsentsCall {
            loanId: U256::from(loan_id),
        }
        .abi_encode();
        let (out, at) = self.call(self.registry, data).await?;
        Ok((decode_consents(&out)?, at))
    }

    async fn inspectors(&self) -> Result<(Vec<String>, u64)> {
        let (out, at) = self
            .call(self.nft, rd::inspectorsCall {}.abi_encode())
            .await?;
        Ok((decode_inspectors(&out)?, at))
    }

    async fn paused(&self) -> Result<(bool, u64)> {
        let (out, at) = self
            .call(self.registry, rd::pausedCall {}.abi_encode())
            .await?;
        Ok((decode_bool(&out)?, at))
    }

    async fn loan_registry(&self) -> Result<(String, u64)> {
        let (out, at) = self
            .call(self.registry, rd::loanRegistryCall {}.abi_encode())
            .await?;
        Ok((decode_address(&out)?, at))
    }

    async fn coverage_detail(&self, loan_id: u32) -> Result<(CoverageDetailView, u64)> {
        let data = rd::coverageDetailCall {
            loanId: U256::from(loan_id),
        }
        .abi_encode();
        let (out, at) = self.call(self.reader, data).await?;
        Ok((decode_coverage_detail(&out)?, at))
    }

    async fn loan_money(&self, registry: &str, loan_id: u32) -> Result<(LoanMoneyView, u64)> {
        let to: Address = registry
            .parse()
            .with_context(|| format!("loan registry address {registry} is not an EVM address"))?;
        let data = rd::loanMoneyCall {
            loanId: U256::from(loan_id),
        }
        .abi_encode();
        let (out, at) = self.call(to, data).await?;
        Ok((decode_loan_money(&out)?, at))
    }

    async fn latest_ledger(&self) -> Result<u64> {
        Ok(self
            .provider
            .get_block_number()
            .await?
            .saturating_sub(self.confirmations))
    }

    fn is_missing_record(&self, e: &anyhow::Error) -> bool {
        revert_selector(e) == Some(rd::SecurityRegistryNonExistentRecord::SELECTOR)
    }

    fn is_missing_inspection(&self, e: &anyhow::Error) -> bool {
        revert_selector(e) == Some(rd::SecurityRecordNftNonExistentInspection::SELECTOR)
    }
}
