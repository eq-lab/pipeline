// spec: docs/references/security-registry-events.md#sync-loop
mod stellar_security_support;

use pipeline_worker::indexer::stellar::security_registry_views::*;
use stellar_security_support::*;
use stellar_xdr::curr::ScVal;

fn control() -> ScVal {
    map_val(vec![
        ("kind", enum_val("Agent")),
        ("reference", str_val("ref-1")),
    ])
}

fn mark() -> ScVal {
    map_val(vec![
        ("value_per_unit", i128_val(100_000_000)),
        ("at", ScVal::U64(1_790_000_000)),
        ("benchmark", sym("LME")),
        ("report_hash", bytes32(0x64)),
    ])
}

fn record_val(attested_by: ScVal, marks: Vec<ScVal>, docs: Vec<ScVal>) -> ScVal {
    map_val(vec![
        ("record_id", ScVal::U32(5)),
        ("loan_id", ScVal::U32(1)),
        ("lot_id", ScVal::U32(2)),
        ("protection", enum_val("WarehousePledge")),
        ("commodity", str_val("Copper")),
        ("unit", enum_val("Mt")),
        ("reference_quantity", i128_val(10_000_000_000)),
        ("reference_grade", i128_val(0)),
        ("region", str_val("AE")),
        ("site_hash", bytes32(9)),
        ("control", control()),
        ("perfection", enum_val("Endorsement")),
        ("release_condition", bytes32(8)),
        ("docs", vec_val(docs)),
        ("status", enum_val("Active")),
        ("perfected_at", ScVal::U64(10)),
        ("attested_by", attested_by),
        ("attested_at", ScVal::U64(11)),
        ("flagged_by", ScVal::U32(0)),
        ("mark", vec_val(marks)),
    ])
}

#[test]
fn record_without_mark_or_attester() {
    let v = decode_record(&record_val(ScVal::Void, vec![], vec![])).unwrap();
    assert_eq!(v.record_id, 5);
    assert_eq!(v.protection, "WarehousePledge");
    assert_eq!(v.commodity, "Copper");
    assert_eq!(v.reference_quantity, "10000000000");
    assert_eq!(v.control_kind, "Agent");
    assert_eq!(v.control_reference, "ref-1");
    assert_eq!(v.status, "Active");
    assert_eq!(v.attested_by, None);
    assert!(v.mark.is_none());
    assert!(v.docs.is_empty());
}

#[test]
fn record_with_mark_attester_and_docs() {
    let docs = vec![
        map_val(vec![("kind", enum_val("Ebl")), ("sha256", bytes32(1))]),
        map_val(vec![
            ("kind", enum_val("Perfection")),
            ("sha256", bytes32(2)),
        ]),
    ];
    let v = decode_record(&record_val(address_val(G_ADDR), vec![mark()], docs)).unwrap();
    assert_eq!(v.attested_by.as_deref(), Some(G_ADDR));
    let m = v.mark.unwrap();
    assert_eq!(m.value_per_unit, "100000000");
    assert_eq!(m.benchmark, "LME");
    assert_eq!(m.report_hash, hex32(0x64));
    assert_eq!(v.docs.len(), 2);
    assert_eq!(v.docs[1].kind, "Perfection");
    assert_eq!(v.docs[1].sha256, hex32(2));
}

#[test]
fn record_with_two_marks_is_refused() {
    assert!(decode_record(&record_val(ScVal::Void, vec![mark(), mark()], vec![])).is_err());
}

fn inspection_val(approved_by: ScVal) -> ScVal {
    map_val(vec![
        ("inspection_id", ScVal::U32(3)),
        ("record_id", ScVal::U32(5)),
        ("lot_id", ScVal::U32(2)),
        ("inspector", address_val(G_ADDR)),
        ("kind", enum_val("DraftSurvey")),
        ("inspected_at", ScVal::U64(100)),
        ("region", str_val("AE")),
        ("site_hash", bytes32(1)),
        ("quantity", i128_val(9_000_000_000)),
        ("grade", i128_val(5_000_000)),
        ("certificate_hash", bytes32(2)),
        ("certificate_no", str_val("C-77")),
        ("entered_by", address_val(C_ADDR)),
        ("entered_at", ScVal::U64(101)),
        ("approved_by", approved_by),
        ("approved_at", ScVal::U64(0)),
        ("variance_reference_bps", ScVal::I32(-250)),
        ("variance_previous_bps", ScVal::I32(0)),
        ("variance_grade_bps", ScVal::I32(12)),
    ])
}

#[test]
fn inspection_unapproved_and_approved() {
    let v = decode_inspection(&inspection_val(ScVal::Void)).unwrap();
    assert_eq!(v.inspection_id, 3);
    assert_eq!(v.kind, "DraftSurvey");
    assert_eq!(v.certificate_no, "C-77");
    assert_eq!(v.entered_by, C_ADDR);
    assert_eq!(v.approved_by, None);
    assert_eq!(v.variance_reference_bps, -250);
    let v = decode_inspection(&inspection_val(address_val(G_ADDR))).unwrap();
    assert_eq!(v.approved_by.as_deref(), Some(G_ADDR));
    assert_eq!(v.variance_grade_bps, 12);
}

#[test]
fn terms_decode() {
    let v = decode_terms(&map_val(vec![
        ("advance_ratio_bps", ScVal::U32(8000)),
        ("margin_call_ratio_bps", ScVal::U32(8500)),
        ("cure_period", ScVal::U64(604_800)),
        ("price_stale_after", ScVal::U64(172_800)),
        ("payment_term", enum_val("OpenAccount")),
        ("grace_period", ScVal::U64(1)),
        ("default_rate", ScVal::U32(200_000)),
        ("attestation_interval", ScVal::U64(2)),
        ("inspection_interval", ScVal::U64(3)),
        ("tolerance_bps", ScVal::U32(50)),
        ("grade_tolerance_bps", ScVal::U32(100)),
        ("margin_call_at", ScVal::U64(0)),
    ]))
    .unwrap();
    assert_eq!(v.payment_term, "OpenAccount");
    assert_eq!(v.cure_period, "604800");
    assert_eq!(v.default_rate, 200_000);
    assert_eq!(v.margin_call_at, "0");
}

fn u128_val(v: u128) -> ScVal {
    ScVal::U128(stellar_xdr::curr::UInt128Parts {
        hi: (v >> 64) as u64,
        lo: v as u64,
    })
}

#[test]
fn coverage_detail_with_counted_records() {
    let counted = map_val(vec![
        ("record_id", ScVal::U32(5)),
        ("counted_quantity", i128_val(10_000_000_000)),
        ("value_per_unit", i128_val(100_000_000)),
        ("mark_at", ScVal::U64(55)),
        ("stale", ScVal::Bool(true)),
        ("flagged", ScVal::Bool(false)),
    ]);
    let big = u128_val(u128::from(u64::MAX) * 3);
    let v = decode_coverage_detail(&map_val(vec![
        ("value", i128_val(1_000_000_000_000)),
        ("stale_value", i128_val(0)),
        ("flagged_value", i128_val(7)),
        ("debt", big),
        ("coverage_bps", ScVal::U32(12500)),
        ("ltv_bps", ScVal::U32(8000)),
        ("margin_call_at", ScVal::U64(0)),
        ("cure_by", ScVal::U64(0)),
        ("price_stale", ScVal::Bool(false)),
        ("records", vec_val(vec![counted])),
    ]))
    .unwrap();
    assert_eq!(v.value, "1000000000000");
    assert_eq!(v.debt, (u128::from(u64::MAX) * 3).to_string());
    assert_eq!(v.ltv_bps, 8000);
    assert_eq!(v.records.len(), 1);
    assert!(v.records[0].stale);
    assert_eq!(v.records[0].counted_quantity, "10000000000");
}

#[test]
fn loan_money_decode() {
    let v = decode_loan_money(&map_val(vec![
        ("disbursed", u128_val(100)),
        ("repaid", u128_val(10)),
        ("written_down", u128_val(0)),
        ("outstanding", u128_val(90)),
        ("accrued_interest", u128_val(3)),
        ("carved_out", ScVal::Bool(true)),
    ]))
    .unwrap();
    assert_eq!(v.outstanding, "90");
    assert_eq!(v.accrued_interest, "3");
    assert!(v.carved_out);
}

#[test]
fn address_and_hash_lists_decode() {
    assert_eq!(
        decode_inspectors(&vec_val(vec![])).unwrap(),
        Vec::<String>::new()
    );
    assert_eq!(
        decode_inspectors(&vec_val(vec![address_val(G_ADDR), address_val(C_ADDR)])).unwrap(),
        vec![G_ADDR.to_owned(), C_ADDR.to_owned()]
    );
    assert_eq!(
        decode_consents(&vec_val(vec![bytes32(1), bytes32(2)])).unwrap(),
        vec![hex32(1), hex32(2)]
    );
    assert!(decode_consents(&vec_val(vec![ScVal::U32(1)])).is_err());
    assert!(decode_bool(&ScVal::Bool(true)).unwrap());
    assert_eq!(decode_address(&address_val(C_ADDR)).unwrap(), C_ADDR);
}

#[test]
fn contract_error_codes_match_exactly() {
    let msg = "simulateTransaction(record) error: HostError: Error(Contract, #1)";
    assert!(is_contract_error(msg, 1));
    assert!(!is_contract_error(msg, 14));
    let msg14 = "HostError: Error(Contract, #14)";
    assert!(!is_contract_error(msg14, 1));
    assert!(is_contract_error(msg14, 14));
    assert!(is_contract_error("Error(Contract, #25)", 25));
    assert!(!is_contract_error("Error(Contract, #250)", 25));
}
