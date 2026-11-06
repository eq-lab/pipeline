// spec: docs/references/security-registry-events.md#sync-loop
#![allow(clippy::needless_pass_by_value, clippy::similar_names)]
mod stellar_security_support;

use std::collections::HashMap;
use std::str::FromStr;

use bigdecimal::BigDecimal;
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use pipeline_worker::indexer::stellar::security_registry_parsers::dispatch_security_registry;
use shared::security_registry::{
    fold_loan, DocView, InspectionView, LoanProjection, LoanView, MarkView, RecordRow, RecordView,
    Snapshot, TermsView, ZERO_HASH,
};
use stellar_security_support::*;
use stellar_xdr::curr::ScVal;

fn bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

fn replay(
    raws: Vec<RawEvent>,
    records: Vec<(u32, i64, RecordView)>,
    inspections: Vec<(u32, i64, InspectionView)>,
    loan: Option<Snapshot<LoanView>>,
) -> LoanProjection {
    let rows: Vec<_> = raws
        .iter()
        .filter_map(dispatch_security_registry)
        .enumerate()
        .map(|(i, log)| row_from(log, i as i64 + 1))
        .collect();
    let records: HashMap<_, _> = records
        .into_iter()
        .map(|(id, v, view)| {
            (
                id,
                Snapshot {
                    as_of_ledger: v,
                    view,
                },
            )
        })
        .collect();
    let inspections: HashMap<_, _> = inspections
        .into_iter()
        .map(|(id, v, view)| {
            (
                id,
                Snapshot {
                    as_of_ledger: v,
                    view,
                },
            )
        })
        .collect();
    fold_loan(1, &rows, &records, &inspections, loan.as_ref())
}

fn rec(p: &LoanProjection, id: i64) -> &RecordRow {
    p.records.iter().find(|r| r.record_id == id).unwrap()
}

fn docs_of(p: &LoanProjection, id: i64) -> Vec<(String, String, String)> {
    p.docs
        .iter()
        .filter(|d| d.record_id == id)
        .map(|d| (d.kind.clone(), d.sha256.clone(), d.source.clone()))
        .collect()
}

fn mark_view() -> MarkView {
    MarkView {
        value_per_unit: "100000000".into(),
        at: (BASE_TS + 20).to_string(),
        benchmark: "LME".into(),
        report_hash: hex32(0x64),
    }
}

fn record_view(
    id: u32,
    lot: u32,
    protection: &str,
    status: &str,
    unit: &str,
    docs: Vec<DocView>,
    mark: Option<MarkView>,
) -> RecordView {
    RecordView {
        record_id: id,
        loan_id: 1,
        lot_id: lot,
        protection: protection.into(),
        commodity: if unit == "Usd" {
            String::new()
        } else {
            "Copper".into()
        },
        unit: unit.into(),
        reference_quantity: "1000000000".into(),
        reference_grade: "0".into(),
        region: "AE".into(),
        site_hash: hex32(9),
        control_kind: "Agent".into(),
        control_reference: "ref".into(),
        perfection: "Endorsement".into(),
        release_condition: hex32(8),
        docs,
        status: status.into(),
        perfected_at: "0".into(),
        attested_by: Some(G_ADDR.into()),
        attested_at: "0".into(),
        flagged_by: 0,
        mark,
    }
}

fn doc(kind: &str, byte: u8) -> DocView {
    DocView {
        kind: kind.into(),
        sha256: hex32(byte),
    }
}

fn inspection_view(
    id: u32,
    rec: u32,
    lot: u32,
    kind: &str,
    at: &str,
    qty: &str,
    grade: &str,
) -> InspectionView {
    InspectionView {
        inspection_id: id,
        record_id: rec,
        lot_id: lot,
        inspector: G_ADDR.into(),
        kind: kind.into(),
        inspected_at: at.into(),
        region: "AE".into(),
        site_hash: hex32(1),
        quantity: qty.into(),
        grade: grade.into(),
        certificate_hash: hex32(2),
        certificate_no: "C-1".into(),
        entered_by: G_ADDR.into(),
        entered_at: "50".into(),
        approved_by: None,
        approved_at: "0".into(),
        variance_reference_bps: 0,
        variance_previous_bps: 0,
        variance_grade_bps: 0,
    }
}

fn t(i: i64) -> i64 {
    BASE_TS + i * 5
}

fn main_flow() -> Vec<RawEvent> {
    let cure_by = (t(1) + 604_800) as u64;
    vec![
        raw_at("terms_set", &[1], terms_value(0), 100, t(0), 1),
        raw_at(
            "mint",
            &[],
            encode_map(vec![("token_id", ScVal::U32(1))]),
            100,
            t(0),
            2,
        ),
        margin_call(1, u32::MAX, cure_by, 101, t(1), 3),
        registered(1, 1, 1, "CollateralManagement", 102, t(2), 4),
        perfected(1, 1, 0x63, 103, t(3), 5),
        revalued(1, 1, 100_000_000, 104, t(4), 6),
        registered(1, 2, 2, "CollateralManagement", 105, t(5), 7),
        perfected(1, 2, 0x63, 106, t(6), 8),
        revalued(1, 2, 100_000_000, 107, t(7), 9),
        cured(1, 5000, 108, t(8), 10),
        raw_at(
            "enforcement_started",
            &[1, 1],
            encode_map(vec![]),
            109,
            t(9),
            11,
        ),
        price_stale(1, 13750, 109, t(9), 12),
        raw_at(
            "burn",
            &[],
            encode_map(vec![("token_id", ScVal::U32(1))]),
            110,
            t(10),
            13,
        ),
        raw_at(
            "record_enforced",
            &[1, 1],
            encode_map(vec![("proceeds_hash", bytes32(0x65))]),
            110,
            t(10),
            14,
        ),
        price_stale(1, 13750, 110, t(10), 15),
    ]
}

#[test]
fn main_flow_without_snapshots() {
    let p = replay(main_flow(), vec![], vec![], None);
    let r1 = rec(&p, 1);
    assert_eq!(r1.status, "Enforced");
    assert_eq!(r1.closed_ledger, Some(110));
    assert_eq!(r1.mark_value_per_unit, Some(bd("100000000")));
    assert_eq!(r1.mark_benchmark.as_deref(), Some("LME"));
    assert_eq!(r1.attested_by, None);
    assert!(r1.needs_view);
    assert!(r1.complete);
    assert_eq!(
        docs_of(&p, 1),
        vec![
            (
                "Perfection".to_owned(),
                hex32(0x63),
                "perfection".to_owned()
            ),
            ("Proceeds".to_owned(), hex32(0x65), "proceeds".to_owned()),
        ]
    );
    let r2 = rec(&p, 2);
    assert_eq!(r2.status, "Active");
    assert_eq!(r2.mark_value_per_unit, Some(bd("100000000")));
    assert_eq!(
        docs_of(&p, 2),
        vec![(
            "Perfection".to_owned(),
            hex32(0x63),
            "perfection".to_owned()
        )]
    );

    let terms = p.terms.as_ref().unwrap();
    assert_eq!(terms.margin_call_at, bd("0"));
    assert!(terms.complete);
    assert_eq!(terms.set_ledger, Some(100));
    assert_eq!(terms.payment_term, "Lc");

    let kinds: Vec<&str> = p.margin_events.iter().map(|m| m.kind.as_str()).collect();
    assert_eq!(kinds, vec!["open", "cured", "price_stale", "price_stale"]);
    assert_eq!(
        p.margin_events[0].cure_by,
        Some(BigDecimal::from(t(1) + 604_800))
    );
    assert_eq!(p.margin_events[0].ltv_bps, i64::from(u32::MAX));
    assert_eq!(p.lots.len(), 2);
}

#[test]
fn main_flow_with_record_snapshots_labels_provenance_and_attestation() {
    let r1 = record_view(
        1,
        1,
        "CollateralManagement",
        "Active",
        "Mt",
        vec![doc("Perfection", 0x63)],
        Some(mark_view()),
    );
    let r2 = record_view(
        2,
        2,
        "CollateralManagement",
        "Active",
        "Mt",
        vec![doc("Perfection", 0x63)],
        Some(mark_view()),
    );
    let p = replay(main_flow(), vec![(1, 104, r1), (2, 107, r2)], vec![], None);
    let r1 = rec(&p, 1);
    assert_eq!(r1.attested_by.as_deref(), Some(G_ADDR));
    assert!(!r1.needs_view);
    assert_eq!(r1.status, "Enforced");
    assert_eq!(r1.view_ledger, Some(104));
    assert_eq!(
        docs_of(&p, 1),
        vec![
            (
                "Perfection".to_owned(),
                hex32(0x63),
                "perfection".to_owned()
            ),
            ("Proceeds".to_owned(), hex32(0x65), "proceeds".to_owned()),
        ]
    );
    let r2 = rec(&p, 2);
    assert_eq!(r2.attested_by.as_deref(), Some(G_ADDR));
    assert!(!r2.needs_view);
    assert_eq!(r2.status, "Active");
    assert_eq!(
        docs_of(&p, 2),
        vec![(
            "Perfection".to_owned(),
            hex32(0x63),
            "perfection".to_owned()
        )]
    );
}

#[test]
fn an_event_after_the_snapshot_that_hides_the_attester_marks_needs_view() {
    let r1 = record_view(
        1,
        1,
        "CollateralManagement",
        "PendingPerfection",
        "Mt",
        vec![],
        None,
    );
    let p = replay(main_flow(), vec![(1, 102, r1)], vec![], None);
    let r1 = rec(&p, 1);
    assert_eq!(r1.attested_by, None);
    assert!(r1.needs_view);
}

#[test]
fn timestamp_zero_sequence_keeps_margin_call_at_zero() {
    let events = vec![
        raw_at("terms_set", &[1], terms_value(0), 100, 0, 1),
        margin_call(1, 9000, 604_800, 101, 0, 2),
        margin_call(1, 9000, 604_800, 102, 0, 3),
        registered(1, 1, 1, "CollateralManagement", 103, 0, 4),
        perfected(1, 1, 0x63, 104, 0, 5),
        price_stale(1, 13750, 104, 0, 6),
    ];
    let p = replay(events, vec![], vec![], None);
    assert_eq!(p.terms.as_ref().unwrap().margin_call_at, bd("0"));
    let kinds: Vec<&str> = p.margin_events.iter().map(|m| m.kind.as_str()).collect();
    assert_eq!(kinds, vec!["open", "open", "price_stale"]);
}

#[test]
fn margin_call_sets_the_event_timestamp_and_cure_clears_it() {
    let events = vec![
        raw_at("terms_set", &[1], terms_value(0), 100, t(0), 1),
        margin_call(1, 9000, 700_000, 101, t(1), 2),
    ];
    let p = replay(events, vec![], vec![], None);
    assert_eq!(p.terms.unwrap().margin_call_at, BigDecimal::from(t(1)));
}

#[test]
fn handover_copies_the_mark_for_matching_commodity_and_unit() {
    let from = record_view(
        1,
        1,
        "WarehousePledge",
        "Active",
        "Mt",
        vec![],
        Some(mark_view()),
    );
    let to = record_view(
        2,
        1,
        "CollateralManagement",
        "PendingPerfection",
        "Mt",
        vec![],
        None,
    );
    let events = vec![handed_over(1, 1, 2, 0x70, 101, t(1), 1)];
    let p = replay(events, vec![(1, 100, from), (2, 100, to)], vec![], None);
    let to = rec(&p, 2);
    assert_eq!(to.status, "Active");
    assert_eq!(to.mark_value_per_unit, Some(bd("100000000")));
    assert_eq!(to.mark_benchmark.as_deref(), Some("LME"));
    assert_eq!(rec(&p, 1).status, "Released");
    assert_eq!(rec(&p, 1).closed_ledger, Some(101));
    assert_eq!(
        docs_of(&p, 2),
        vec![(
            "Perfection".to_owned(),
            hex32(0x70),
            "perfection".to_owned()
        )]
    );
}

#[test]
fn handover_with_a_different_unit_leaves_the_mark() {
    let from = record_view(
        1,
        1,
        "WarehousePledge",
        "Active",
        "Mt",
        vec![],
        Some(mark_view()),
    );
    let to = record_view(
        2,
        1,
        "CollateralManagement",
        "PendingPerfection",
        "Bbl",
        vec![],
        None,
    );
    let events = vec![handed_over(1, 1, 2, 0x70, 101, t(1), 1)];
    let p = replay(events, vec![(1, 100, from), (2, 100, to)], vec![], None);
    assert_eq!(rec(&p, 2).mark_value_per_unit, None);
    assert_eq!(rec(&p, 2).status, "Active");
}

#[test]
fn handover_without_snapshots_needs_a_view() {
    let events = vec![
        registered(1, 1, 1, "WarehousePledge", 100, t(0), 1),
        registered(1, 2, 1, "CollateralManagement", 100, t(0), 2),
        handed_over(1, 1, 2, 0x70, 101, t(1), 3),
    ];
    let p = replay(events, vec![], vec![], None);
    let to = rec(&p, 2);
    assert_eq!(to.mark_value_per_unit, None);
    assert!(to.needs_view);
    assert_eq!(rec(&p, 1).status, "Released");
}

#[test]
fn usd_record_gets_the_par_mark_and_a_later_revalue_replaces_it() {
    let events = vec![registered(1, 3, 3, "AssignedReceivable", 100, t(0), 1)];
    let p = replay(events.into_iter().collect(), vec![], vec![], None);
    let r = rec(&p, 3);
    assert_eq!(r.mark_value_per_unit, Some(bd("10000000")));
    assert_eq!(r.mark_benchmark.as_deref(), Some("PAR"));
    assert_eq!(r.mark_report_hash.as_deref(), Some(ZERO_HASH));
    assert_eq!(r.mark_at, Some(BigDecimal::from(t(0))));

    let events = vec![
        registered(1, 3, 3, "CashCover", 100, t(0), 1),
        revalued(1, 3, 9_000_000, 101, t(1), 2),
    ];
    let p = replay(events, vec![], vec![], None);
    let r = rec(&p, 3);
    assert_eq!(r.mark_value_per_unit, Some(bd("9000000")));
    assert_eq!(r.mark_benchmark.as_deref(), Some("LME"));
}

fn flag_flow(outcome: &str, kind: &str, grade: &str) -> LoanProjection {
    let events = vec![
        registered(1, 1, 1, "WarehousePledge", 100, t(0), 1),
        inspection_recorded(1, 1, 1, 1, kind, 101, t(1), 2),
        inspection_approved(1, 1, 1, true, 102, t(2), 3),
        flag_resolved(1, 1, 1, outcome, 103, t(3), 4),
    ];
    let insp = inspection_view(1, 1, 1, kind, "100", "900000000", grade);
    replay(events, vec![], vec![(1, 101, insp)], None)
}

#[test]
fn flagged_approval_sets_the_flag_and_accept_adopts_the_measured_reference() {
    let events = vec![
        registered(1, 1, 1, "WarehousePledge", 100, t(0), 1),
        inspection_recorded(1, 1, 1, 1, "LoadingTally", 101, t(1), 2),
        inspection_approved(1, 1, 1, true, 102, t(2), 3),
    ];
    let insp = inspection_view(1, 1, 1, "LoadingTally", "100", "900000000", "0");
    let p = replay(events, vec![], vec![(1, 101, insp)], None);
    assert_eq!(rec(&p, 1).flagged_by, Some(1));
    let i = &p.inspections[0];
    assert_eq!(i.flagged, Some(true));
    assert_eq!(i.approved_by.as_deref(), Some(C_ADDR));
    assert_eq!(i.variance_reference_bps, Some(-250));
    assert_eq!(i.approved_ledger, Some(102));
    assert!(i.complete);

    let p = flag_flow("Accepted", "LoadingTally", "5000000");
    let r = rec(&p, 1);
    assert_eq!(r.reference_quantity, Some(bd("900000000")));
    assert_eq!(r.reference_grade, Some(bd("5000000")));
    assert_eq!(r.flagged_by, Some(0));
    assert_eq!(p.inspections[0].resolution.as_deref(), Some("Accepted"));
}

#[test]
fn accept_of_an_assay_keeps_the_quantity_and_zero_grade_keeps_the_grade() {
    let p = flag_flow("Accepted", "SamplingAssay", "0");
    let r = rec(&p, 1);
    assert_eq!(r.reference_quantity, None);
    assert_eq!(r.reference_grade, None);
    assert_eq!(r.flagged_by, Some(0));
}

#[test]
fn top_up_clears_the_flag_and_escalation_keeps_it() {
    let p = flag_flow("TopUpRequired", "LoadingTally", "0");
    assert_eq!(rec(&p, 1).flagged_by, Some(0));
    assert_eq!(rec(&p, 1).reference_quantity, None);
    let p = flag_flow("Escalated", "LoadingTally", "0");
    assert_eq!(rec(&p, 1).flagged_by, Some(1));
    assert_eq!(p.inspections[0].resolution.as_deref(), Some("Escalated"));
}

#[test]
fn accept_without_the_inspection_snapshot_needs_a_view() {
    let events = vec![
        registered(1, 1, 1, "WarehousePledge", 100, t(0), 1),
        inspection_recorded(1, 1, 1, 1, "LoadingTally", 101, t(1), 2),
        inspection_approved(1, 1, 1, true, 102, t(2), 3),
        flag_resolved(1, 1, 1, "Accepted", 103, t(3), 4),
    ];
    let p = replay(events, vec![], vec![], None);
    let r = rec(&p, 1);
    assert_eq!(r.reference_quantity, None);
    assert!(r.needs_view);
    assert_eq!(r.flagged_by, Some(0));
    assert!(p.inspections[0].needs_view);
}

#[test]
fn lot_latest_excludes_assays_and_prefers_the_later_approval_on_a_tie() {
    let events = vec![
        registered(1, 1, 1, "WarehousePledge", 100, t(0), 1),
        registered(1, 2, 1, "CollateralManagement", 100, t(0), 2),
        inspection_recorded(1, 1, 1, 1, "LoadingTally", 101, t(1), 3),
        inspection_recorded(1, 1, 2, 1, "SamplingAssay", 101, t(1), 4),
        inspection_recorded(1, 2, 3, 1, "StockCount", 101, t(1), 5),
        inspection_approved(1, 1, 1, false, 102, t(2), 6),
        inspection_approved(1, 1, 2, false, 103, t(3), 7),
        inspection_approved(1, 2, 3, false, 104, t(4), 8),
    ];
    let inspections = vec![
        (
            1,
            101,
            inspection_view(1, 1, 1, "LoadingTally", "100", "1000", "0"),
        ),
        (
            2,
            101,
            inspection_view(2, 1, 1, "SamplingAssay", "300", "5", "0"),
        ),
        (
            3,
            101,
            inspection_view(3, 2, 1, "StockCount", "100", "2000", "0"),
        ),
    ];
    let p = replay(events, vec![], inspections, None);
    assert_eq!(p.lots.len(), 1);
    let lot = &p.lots[0];
    assert_eq!(lot.latest_inspection_id, Some(3));
    assert_eq!(lot.latest_quantity, Some(bd("2000")));
    assert!(lot.complete);
}

#[test]
fn lot_latest_is_incomplete_while_an_approved_inspection_lacks_its_snapshot() {
    let events = vec![
        registered(1, 1, 1, "WarehousePledge", 100, t(0), 1),
        inspection_recorded(1, 1, 1, 1, "LoadingTally", 101, t(1), 2),
        inspection_approved(1, 1, 1, false, 102, t(2), 3),
    ];
    let p = replay(events, vec![], vec![], None);
    assert!(!p.lots[0].complete);
    assert_eq!(p.lots[0].latest_inspection_id, None);
}

#[test]
fn release_with_consent_is_recorded() {
    let events = vec![
        registered(1, 1, 1, "WarehousePledge", 100, t(0), 1),
        raw_at(
            "record_released",
            &[1, 1],
            encode_map(vec![
                ("reason_hash", bytes32(0x55)),
                ("by_consent", ScVal::Bool(true)),
            ]),
            101,
            t(1),
            2,
        ),
    ];
    let p = replay(events, vec![], vec![], None);
    let r = rec(&p, 1);
    assert_eq!(r.status, "Released");
    assert_eq!(r.released_by_consent, Some(true));
    assert_eq!(r.release_reason_hash, Some(hex32(0x55)));
    assert_eq!(r.closed_ledger, Some(101));
}

#[test]
fn snapshot_only_rows_are_incomplete_with_view_docs() {
    let r = record_view(
        7,
        4,
        "WarehousePledge",
        "Active",
        "Mt",
        vec![doc("Ebl", 1), doc("Assay", 2)],
        None,
    );
    let p = replay(vec![], vec![(7, 100, r)], vec![], None);
    let row = rec(&p, 7);
    assert!(!row.complete);
    assert!(!row.needs_view);
    assert_eq!(row.attested_by.as_deref(), Some(G_ADDR));
    assert_eq!(
        docs_of(&p, 7)
            .iter()
            .map(|d| d.2.as_str())
            .collect::<Vec<_>>(),
        vec!["view", "view"]
    );
}

#[test]
fn events_before_the_snapshot_label_but_do_not_apply_and_later_events_do() {
    let events = vec![
        registered(1, 7, 4, "WarehousePledge", 90, t(0), 1),
        raw_at(
            "doc_added",
            &[1, 7],
            encode_map(vec![("kind", enum_val("Assay")), ("sha256", bytes32(2))]),
            95,
            t(1),
            2,
        ),
        revalued(1, 7, 7_000_000, 95, t(1), 3),
        raw_at(
            "doc_added",
            &[1, 7],
            encode_map(vec![("kind", enum_val("Other")), ("sha256", bytes32(3))]),
            105,
            t(2),
            4,
        ),
        revalued(1, 7, 8_000_000, 105, t(2), 5),
    ];
    let r = record_view(
        7,
        4,
        "WarehousePledge",
        "Active",
        "Mt",
        vec![doc("Ebl", 1), doc("Assay", 2)],
        Some(mark_view()),
    );
    let p = replay(events, vec![(7, 100, r)], vec![], None);
    let row = rec(&p, 7);
    assert!(row.complete);
    assert_eq!(row.mark_value_per_unit, Some(bd("8000000")));
    assert_eq!(
        docs_of(&p, 7),
        vec![
            ("Ebl".to_owned(), hex32(1), "register".to_owned()),
            ("Assay".to_owned(), hex32(2), "event".to_owned()),
            ("Other".to_owned(), hex32(3), "event".to_owned()),
        ]
    );
}

#[test]
fn consents_combine_the_snapshot_tail_labels_and_later_events() {
    let consent = |maturity: u64, byte: u8, ledger: u32, seq: u32| {
        raw_at(
            "extension_consent",
            &[1],
            encode_map(vec![
                ("new_maturity", ScVal::U64(maturity)),
                ("consent_hash", bytes32(byte)),
            ]),
            ledger,
            t(i64::from(seq)),
            seq,
        )
    };
    let events = vec![consent(111, 2, 95, 1), consent(222, 3, 105, 2)];
    let loan = Snapshot {
        as_of_ledger: 100,
        view: LoanView {
            terms: None::<TermsView>,
            terms_ledger: 100,
            consents: vec![hex32(1), hex32(2)],
            consents_ledger: 100,
        },
    };
    let p = replay(events, vec![], vec![], Some(loan));
    assert!(p.terms.is_none());
    assert_eq!(p.consents.len(), 3);
    assert_eq!(p.consents[0].consent_hash, hex32(1));
    assert_eq!(p.consents[0].new_maturity, None);
    assert_eq!(p.consents[0].ledger, None);
    assert_eq!(p.consents[1].new_maturity, Some(bd("111")));
    assert_eq!(p.consents[1].ledger, Some(95));
    assert_eq!(p.consents[2].consent_hash, hex32(3));
    assert_eq!(p.consents[2].new_maturity, Some(bd("222")));
    assert_eq!(
        p.consents.iter().map(|c| c.position).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
}

#[test]
fn terms_snapshot_without_a_terms_event_is_incomplete_and_later_events_apply() {
    let terms = TermsView {
        advance_ratio_bps: 8000,
        margin_call_ratio_bps: 8500,
        cure_period: "604800".into(),
        price_stale_after: "172800".into(),
        payment_term: "Da".into(),
        grace_period: "0".into(),
        default_rate: 1,
        attestation_interval: "0".into(),
        inspection_interval: "0".into(),
        tolerance_bps: 50,
        grade_tolerance_bps: 100,
        margin_call_at: "0".into(),
    };
    let loan = Snapshot {
        as_of_ledger: 100,
        view: LoanView {
            terms: Some(terms),
            terms_ledger: 100,
            consents: vec![],
            consents_ledger: 100,
        },
    };
    let events = vec![
        margin_call(1, 9000, 700_000, 105, t(2), 1),
        margin_call(1, 9000, 700_000, 95, t(1), 2),
    ];
    let p = replay(events, vec![], vec![], Some(loan));
    let terms = p.terms.unwrap();
    assert!(!terms.complete);
    assert_eq!(terms.payment_term, "Da");
    assert_eq!(terms.margin_call_at, BigDecimal::from(t(2)));
    assert_eq!(p.margin_events.len(), 2);
}
