// spec: docs/references/security-registry-events.md#sync-loop
mod evm_security_support;

use alloy::primitives::{Address, B256, U256};
use alloy::rpc::json_rpc::{ErrorPayload, RpcError};
use alloy::sol_types::{SolError, SolValue};
use alloy::transports::TransportErrorKind;
use evm_security_support::*;
use pipeline_worker::indexer::security_registry_sync::SecurityViewSource;
use pipeline_worker::indexer::security_registry_views::*;

fn bench(text: &[u8]) -> B256 {
    let mut b = [0u8; 32];
    b[..text.len()].copy_from_slice(text);
    B256::from(b)
}

fn record_view(attested_by: Address, has_mark: bool, record_id: U256) -> rd::RecordView {
    rd::RecordView {
        record: rd::Record {
            recordId: record_id,
            loanId: u(7),
            lotId: u(3),
            protection: 1,
            unit: 1,
            status: 1,
            hasMark: has_mark,
            perfectedAt: 1_790_000_100,
            attestedAt: 1_790_000_200,
            attestedBy: attested_by,
            flaggedBy: u(4),
            referenceQuantity: u(900_000),
            referenceGrade: u(5_000_000),
            commodityHash: hash(0x01),
            mark: rd::Mark {
                valuePerUnit: if has_mark { u(5_000_000) } else { U256::ZERO },
                at: if has_mark { 1_790_000_300 } else { 0 },
                benchmark: if has_mark { bench(b"LME") } else { B256::ZERO },
                reportHash: if has_mark { hash(0x64) } else { B256::ZERO },
            },
        },
        details: rd::RecordDetails {
            perfection: 1,
            commodity: "Copper".into(),
            region: "AE".into(),
            siteHash: hash(0x09),
            releaseCondition: hash(0x08),
            control: rd::Control {
                kind: 2,
                reference: "ctl-1".into(),
            },
            docs: vec![
                rd::Doc {
                    kind: 0,
                    hash: hash(0x11),
                },
                rd::Doc {
                    kind: 10,
                    hash: hash(0x63),
                },
            ],
        },
    }
}

#[test]
fn record_with_mark_attester_and_docs() {
    let bytes = record_view(INSPECTOR, true, u(12)).abi_encode();
    let v = decode_record(&bytes).unwrap();
    assert_eq!((v.record_id, v.loan_id, v.lot_id), (12, 7, 3));
    assert_eq!(v.protection, "WarehousePledge");
    assert_eq!(v.unit, "Mt");
    assert_eq!(v.status, "Active");
    assert_eq!(v.commodity, "Copper");
    assert_eq!(v.region, "AE");
    assert_eq!(v.site_hash, hex32(0x09));
    assert_eq!(v.release_condition, hex32(0x08));
    assert_eq!(v.control_kind, "StockMonitor");
    assert_eq!(v.control_reference, "ctl-1");
    assert_eq!(v.perfection, "Registration");
    assert_eq!(v.reference_quantity, "900000");
    assert_eq!(v.reference_grade, "5000000");
    assert_eq!(v.perfected_at, "1790000100");
    assert_eq!(v.attested_at, "1790000200");
    assert_eq!(v.attested_by.as_deref(), Some(INSPECTOR_TEXT));
    assert_eq!(v.flagged_by, 4);
    assert_eq!(v.docs.len(), 2);
    assert_eq!(v.docs[0].kind, "Ebl");
    assert_eq!(v.docs[0].sha256, hex32(0x11));
    assert_eq!(v.docs[1].kind, "Perfection");
    let mark = v.mark.unwrap();
    assert_eq!(mark.value_per_unit, "5000000");
    assert_eq!(mark.at, "1790000300");
    assert_eq!(mark.benchmark, "LME");
    assert_eq!(mark.report_hash, hex32(0x64));
}

#[test]
fn record_without_mark_or_attester() {
    let bytes = record_view(Address::ZERO, false, u(12)).abi_encode();
    let v = decode_record(&bytes).unwrap();
    assert_eq!(v.mark, None);
    assert_eq!(v.attested_by, None);
}

#[test]
fn a_record_id_above_u32_is_refused() {
    let big = U256::from(u64::from(u32::MAX) + 1);
    let err = decode_record(&record_view(Address::ZERO, false, big).abi_encode()).unwrap_err();
    assert!(err.to_string().contains("record_id"), "{err}");
    assert!(decode_record(&[0u8; 3]).is_err());
}

fn inspection(approved_by: Address, approved_at: u64) -> rd::Inspection {
    rd::Inspection {
        inspectionId: u(4),
        recordId: u(12),
        lotId: u(3),
        inspector: INSPECTOR,
        kind: 4,
        inspectedAt: 1_790_000_100,
        enteredBy: INSPECTOR,
        enteredAt: 1_790_000_150,
        approvedBy: approved_by,
        approvedAt: approved_at,
        varianceReferenceBps: -250,
        variancePreviousBps: 10,
        varianceGradeBps: -5,
        quantity: u(900_000),
        grade: u(5_000_000),
        siteHash: hash(0x01),
        certificateHash: hash(0x02),
        region: "AE".into(),
        certificateNo: "C-1".into(),
    }
}

#[test]
fn inspection_unapproved_and_approved() {
    let v = decode_inspection(&inspection(Address::ZERO, 0).abi_encode()).unwrap();
    assert_eq!((v.inspection_id, v.record_id, v.lot_id), (4, 12, 3));
    assert_eq!(v.kind, "StockCount");
    assert_eq!(v.inspector, INSPECTOR_TEXT);
    assert_eq!(v.entered_by, INSPECTOR_TEXT);
    assert_eq!(v.approved_by, None);
    assert_eq!(v.approved_at, "0");
    assert_eq!(v.site_hash, hex32(0x01));
    assert_eq!(v.certificate_hash, hex32(0x02));
    assert_eq!(v.certificate_no, "C-1");
    assert_eq!(v.quantity, "900000");
    assert_eq!(v.grade, "5000000");
    assert_eq!(
        (
            v.variance_reference_bps,
            v.variance_previous_bps,
            v.variance_grade_bps
        ),
        (-250, 10, -5)
    );

    let v = decode_inspection(&inspection(APPROVER, 1_790_000_900).abi_encode()).unwrap();
    assert_eq!(v.approved_by.as_deref(), Some(APPROVER_TEXT));
    assert_eq!(v.approved_at, "1790000900");
}

#[test]
fn terms_decode_with_the_evm_extras() {
    let t = terms(1_790_000_005, 1_790_000_009, 3);
    let v = decode_terms(&t_as_rd(&t).abi_encode()).unwrap();
    assert_eq!(v.advance_ratio_bps, 8000);
    assert_eq!(v.margin_call_ratio_bps, 8500);
    assert_eq!(v.cure_period, "604800");
    assert_eq!(v.price_stale_after, "172800");
    assert_eq!(v.payment_term, "OpenAccount");
    assert_eq!(v.grace_period, "86400");
    assert_eq!(v.default_rate, 200_000);
    assert_eq!(v.attestation_interval, "0");
    assert_eq!(v.inspection_interval, "0");
    assert_eq!(v.tolerance_bps, 50);
    assert_eq!(v.grade_tolerance_bps, 100);
    assert_eq!(v.margin_call_at, "1790000005");
    assert_eq!(v.default_ratio_bps, Some(9500));
    assert_eq!(v.originator_fee_rate, Some(25_000));
    assert_eq!(v.default_breach_at.as_deref(), Some("1790000009"));
}

fn t_as_rd(t: &pipeline_worker::indexer::security_registry_parsers::sr::Terms) -> rd::Terms {
    rd::Terms {
        advanceRatioBps: t.advanceRatioBps,
        marginCallRatioBps: t.marginCallRatioBps,
        defaultRatioBps: t.defaultRatioBps,
        curePeriod: t.curePeriod,
        priceStaleAfter: t.priceStaleAfter,
        paymentTerm: t.paymentTerm,
        gracePeriod: t.gracePeriod,
        defaultRate: t.defaultRate,
        originatorFeeRate: t.originatorFeeRate,
        attestationInterval: t.attestationInterval,
        inspectionInterval: t.inspectionInterval,
        toleranceBps: t.toleranceBps,
        gradeToleranceBps: t.gradeToleranceBps,
        marginCallAt: t.marginCallAt,
        defaultBreachAt: t.defaultBreachAt,
    }
}

fn coverage(debt: u64, coverage_bps: u32, ltv_bps: u32) -> rd::CoverageDetail {
    rd::CoverageDetail {
        value: u(1_250_000_000),
        staleValue: u(10),
        flaggedValue: u(20),
        debt: u(debt),
        coverageBps: coverage_bps,
        ltvBps: ltv_bps,
        marginCallAt: 1_790_000_005,
        cureBy: u(1_790_604_805),
        defaultBreachAt: 1_790_000_009,
        priceStale: true,
        records: vec![
            rd::CountedRecord {
                recordId: u(12),
                countedQuantity: u(900_000),
                valuePerUnit: u(5_000_000),
                markAt: 1_790_000_300,
                stale: false,
                flagged: true,
            },
            rd::CountedRecord {
                recordId: u(13),
                countedQuantity: u(1),
                valuePerUnit: u(1_000_000),
                markAt: 0,
                stale: true,
                flagged: false,
            },
        ],
    }
}

#[test]
fn coverage_detail_with_counted_records_and_default_breach() {
    let v = decode_coverage_detail(&coverage(800_000_000, 15_625, 6400).abi_encode()).unwrap();
    assert_eq!(v.value, "1250000000");
    assert_eq!(v.stale_value, "10");
    assert_eq!(v.flagged_value, "20");
    assert_eq!(v.debt, "800000000");
    assert_eq!((v.coverage_bps, v.ltv_bps), (15_625, 6400));
    assert_eq!(v.margin_call_at, "1790000005");
    assert_eq!(v.cure_by, "1790604805");
    assert_eq!(v.default_breach_at.as_deref(), Some("1790000009"));
    assert!(v.price_stale);
    assert_eq!(v.records.len(), 2);
    assert_eq!(v.records[0].record_id, 12);
    assert_eq!(v.records[0].counted_quantity, "900000");
    assert_eq!(v.records[0].value_per_unit, "5000000");
    assert_eq!(v.records[0].mark_at, "1790000300");
    assert!(v.records[0].flagged && !v.records[0].stale);
    assert!(v.records[1].stale);
}

#[test]
fn coverage_at_zero_debt_keeps_the_max_coverage() {
    let v = decode_coverage_detail(&coverage(0, u32::MAX, 0).abi_encode()).unwrap();
    assert_eq!(v.coverage_bps, u32::MAX);
    assert_eq!(v.ltv_bps, 0);
    assert_eq!(v.debt, "0");
}

#[test]
fn loan_money_decode() {
    let m = rd::LoanMoney {
        disbursed: u(100),
        repaid: u(10),
        writtenDown: u(1),
        outstanding: u(90),
        accruedInterest: u(3),
        carvedOut: true,
    };
    let v = decode_loan_money(&m.abi_encode()).unwrap();
    assert_eq!(v.disbursed, "100");
    assert_eq!(v.repaid, "10");
    assert_eq!(v.written_down, "1");
    assert_eq!(v.outstanding, "90");
    assert_eq!(v.accrued_interest, "3");
    assert!(v.carved_out);
}

#[test]
fn address_bool_and_hash_lists_decode() {
    let inspectors: Vec<Address> = vec![INSPECTOR, APPROVER];
    assert_eq!(
        decode_inspectors(&inspectors.abi_encode()).unwrap(),
        vec![INSPECTOR_TEXT, APPROVER_TEXT]
    );
    assert!(decode_inspectors(&Vec::<Address>::new().abi_encode())
        .unwrap()
        .is_empty());
    let consents: Vec<B256> = vec![hash(1), hash(2)];
    assert_eq!(
        decode_consents(&consents.abi_encode()).unwrap(),
        vec![hex32(1), hex32(2)]
    );
    assert_eq!(
        decode_address(&LOAN_REGISTRY.abi_encode()).unwrap(),
        "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"
    );
    assert!(decode_bool(&true.abi_encode()).unwrap());
    assert!(!decode_bool(&false.abi_encode()).unwrap());
    assert!(decode_address(&[1, 2, 3]).is_err());
}

fn rpc_error(json: &str) -> anyhow::Error {
    let payload: ErrorPayload = serde_json::from_str(json).unwrap();
    anyhow::Error::from(RpcError::<TransportErrorKind>::ErrorResp(payload))
        .context("eth_call on 0x00 at block 1 failed")
}

#[test]
fn revert_selector_reads_a_hex_string_in_data() {
    let e = rpc_error(r#"{"code":3,"message":"execution reverted","data":"0xd281f404"}"#);
    assert_eq!(revert_selector(&e), Some([0xd2, 0x81, 0xf4, 0x04]));
    let long = rpc_error(
        r#"{"code":3,"message":"execution reverted","data":"0x5286b930000000000000000000000000000000000000000000000000000000000000000f"}"#,
    );
    assert_eq!(revert_selector(&long), Some([0x52, 0x86, 0xb9, 0x30]));
}

#[test]
fn revert_selector_reads_nested_json_data() {
    let e = rpc_error(
        r#"{"code":3,"message":"execution reverted","data":{"data":"0x3a418dcd","message":"x"}}"#,
    );
    assert_eq!(revert_selector(&e), Some([0x3a, 0x41, 0x8d, 0xcd]));
    let deeper = rpc_error(
        r#"{"code":3,"message":"execution reverted","data":{"data":{"data":"0xd281f404"}}}"#,
    );
    assert_eq!(revert_selector(&deeper), Some([0xd2, 0x81, 0xf4, 0x04]));
    let other_keys = rpc_error(
        r#"{"code":3,"message":"execution reverted","data":{"trace":"0x3a418dcd","extra":{"x":"0x3a418dcd"}}}"#,
    );
    assert_eq!(revert_selector(&other_keys), None);
}

#[test]
fn revert_selector_ignores_hex_in_free_text() {
    let in_message =
        rpc_error(r#"{"code":3,"message":"execution reverted: custom error 0xd281f404"}"#);
    assert_eq!(revert_selector(&in_message), None);
    let unrelated = rpc_error(
        r#"{"code":-32000,"message":"call from 0x3a418dcd5286b930d281f404aaaaaaaaaaaaaaaa failed"}"#,
    );
    assert_eq!(revert_selector(&unrelated), None);
    let message_beside_data =
        rpc_error(r#"{"code":3,"message":"reverted at 0xd281f404","data":"0x5286b930"}"#);
    assert_eq!(
        revert_selector(&message_beside_data),
        Some([0x52, 0x86, 0xb9, 0x30])
    );
    let non_hex_data = rpc_error(r#"{"code":3,"message":"m","data":"see 0xd281f404"}"#);
    assert_eq!(revert_selector(&non_hex_data), None);
}

#[test]
fn revert_selector_is_none_without_revert_data() {
    let none = rpc_error(r#"{"code":-32005,"message":"rate limited"}"#);
    assert_eq!(revert_selector(&none), None);
    let short = rpc_error(r#"{"code":3,"message":"execution reverted","data":"0x12"}"#);
    assert_eq!(revert_selector(&short), None);
    let transport = anyhow::Error::from(RpcError::<TransportErrorKind>::local_usage_str("boom"))
        .context("eth_call failed");
    assert_eq!(revert_selector(&transport), None);
    assert_eq!(revert_selector(&anyhow::anyhow!("0xd281f404")), None);
    let odd_shape = rpc_error(r#"{"code":3,"message":"m","data":[1,2]}"#);
    assert_eq!(revert_selector(&odd_shape), None);
}

#[test]
fn the_three_not_found_selectors_match_cast_sig() {
    assert_eq!(
        rd::SecurityRegistryNonExistentRecord::SELECTOR,
        [0xd2, 0x81, 0xf4, 0x04]
    );
    assert_eq!(
        rd::SecurityRegistryNoTerms::SELECTOR,
        [0x3a, 0x41, 0x8d, 0xcd]
    );
    assert_eq!(
        rd::SecurityRecordNftNonExistentInspection::SELECTOR,
        [0x52, 0x86, 0xb9, 0x30]
    );
}

#[test]
fn the_source_classifies_only_its_own_not_found_errors() {
    let source =
        EvmSecurityViewSource::new("http://127.0.0.1:1", REGISTRY, NFT, READER, 12).unwrap();
    let missing_record = rpc_error(r#"{"code":3,"message":"reverted","data":"0xd281f404"}"#);
    let no_terms = rpc_error(r#"{"code":3,"message":"reverted","data":"0x3a418dcd"}"#);
    let missing_inspection = rpc_error(r#"{"code":3,"message":"reverted","data":"0x5286b930"}"#);
    let unrelated = rpc_error(r#"{"code":3,"message":"reverted","data":"0xdeadbeef"}"#);
    assert!(source.is_missing_record(&missing_record));
    assert!(!source.is_missing_record(&no_terms));
    assert!(!source.is_missing_record(&missing_inspection));
    assert!(!source.is_missing_record(&unrelated));
    assert!(source.is_missing_inspection(&missing_inspection));
    assert!(!source.is_missing_inspection(&missing_record));
    assert!(!source.is_missing_inspection(&unrelated));
    assert!(!source.is_missing_record(&anyhow::anyhow!("rpc down")));
}

#[test]
fn an_invalid_rpc_url_is_refused() {
    assert!(EvmSecurityViewSource::new("not a url", REGISTRY, NFT, READER, 12).is_err());
}
