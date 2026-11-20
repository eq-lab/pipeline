// spec: docs/references/security-registry-events.md#sync-loop
#![allow(clippy::needless_pass_by_value, clippy::similar_names)]
mod evm_security_support;

use std::collections::HashMap;
use std::str::FromStr;

use bigdecimal::BigDecimal;
use evm_security_support::*;
use pipeline_worker::indexer::security_registry_parsers::dispatch_security_registry;
use pipeline_worker::indexer::security_registry_views::{decode_coverage_detail, decode_terms};
use shared::security_registry::{
    fold_loan_report, valuation_row, DocView, InspectionView, LoanMoneyView, LoanProjection,
    LoanView, MarkView, RecordRow, RecordView, Snapshot, TermsView, EVM_SECURITY_PARAMS, ZERO_HASH,
};

const WAREHOUSE: u8 = 1;
const COLLATERAL_MGMT: u8 = 2;
const RECEIVABLE: u8 = 3;
const CASH_COVER: u8 = 5;
const LOADING_TALLY: u8 = 0;
const SAMPLING_ASSAY: u8 = 2;
const STOCK_COUNT: u8 = 4;
const ACCEPTED: u8 = 0;
const TOP_UP: u8 = 1;
const ESCALATED: u8 = 2;
const DOC_ASSAY: u8 = 2;
const DOC_OTHER: u8 = 12;

fn bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

fn t(i: i64) -> i64 {
    BASE_TS + i * 5
}

fn replay_report(
    evs: Vec<Ev>,
    records: Vec<(u32, i64, RecordView)>,
    inspections: Vec<(u32, i64, InspectionView)>,
    loan: Option<Snapshot<LoanView>>,
) -> (LoanProjection, usize) {
    let rows: Vec<_> = evs
        .iter()
        .filter_map(|e| dispatch_security_registry(&e.log, REGISTRY, NFT).map(|l| (l, e.ts)))
        .enumerate()
        .map(|(i, (log, ts))| row_from(log, i as i64 + 1, ts))
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
    fold_loan_report(
        1,
        &rows,
        &records,
        &inspections,
        loan.as_ref(),
        &EVM_SECURITY_PARAMS,
    )
}

fn replay(
    evs: Vec<Ev>,
    records: Vec<(u32, i64, RecordView)>,
    inspections: Vec<(u32, i64, InspectionView)>,
    loan: Option<Snapshot<LoanView>>,
) -> LoanProjection {
    let (p, skipped) = replay_report(evs, records, inspections, loan);
    assert_eq!(skipped, 0);
    p
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
        value_per_unit: "5000000".into(),
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
        reference_quantity: "1000000".into(),
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
        attested_by: Some(INSPECTOR_TEXT.into()),
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
        inspector: INSPECTOR_TEXT.into(),
        kind: kind.into(),
        inspected_at: at.into(),
        region: "AE".into(),
        site_hash: hex32(1),
        quantity: qty.into(),
        grade: grade.into(),
        certificate_hash: hex32(2),
        certificate_no: "C-1".into(),
        entered_by: INSPECTOR_TEXT.into(),
        entered_at: "50".into(),
        approved_by: None,
        approved_at: "0".into(),
        variance_reference_bps: 0,
        variance_previous_bps: 0,
        variance_grade_bps: 0,
    }
}

fn main_flow() -> Vec<Ev> {
    let cure_by = (t(9) + 604_800) as u64;
    vec![
        terms_set(1, 0, 100, t(0), 1),
        registered(1, 1, 1, RECEIVABLE, 101, t(1), 2),
        registered(1, 2, 2, WAREHOUSE, 102, t(2), 3),
        perfected(1, 2, 0x63, 103, t(3), 4),
        doc_added(1, 2, DOC_ASSAY, 0x21, 104, t(4), 5),
        inspection_recorded(1, 2, 1, 2, LOADING_TALLY, 105, t(5), 6),
        inspection_approved(1, 2, 1, true, 106, t(6), 7),
        flag_resolved(1, 2, 1, ACCEPTED, 107, t(7), 8),
        revalued(1, 2, 5_000_000, 108, t(8), 9),
        margin_call(1, 9000, cure_by, 109, t(9), 10),
        default_breach(1, 9700, 110, t(10), 11),
        default_breach_price_stale(1, 9700, 111, t(11), 12),
        default_breach_cleared(1, 9000, 112, t(12), 13),
        cured(1, 8000, 113, t(13), 14),
        released(1, 1, 0x55, false, 114, t(14), 15),
    ]
}

fn flow_inspection() -> Vec<(u32, i64, InspectionView)> {
    vec![(
        1,
        105,
        inspection_view(1, 2, 2, "LoadingTally", "100", "900000", "5000000"),
    )]
}

#[test]
fn main_flow_with_the_inspection_snapshot_covers_every_evm_rule() {
    let p = replay(main_flow(), vec![], flow_inspection(), None);

    let usd = rec(&p, 1);
    assert_eq!(usd.mark_value_per_unit, Some(bd("1000000")));
    assert_eq!(usd.mark_benchmark.as_deref(), Some("PAR"));
    assert_eq!(usd.mark_report_hash.as_deref(), Some(ZERO_HASH));
    assert_eq!(usd.status, "Released");
    assert_eq!(usd.closed_ledger, Some(114));

    let goods = rec(&p, 2);
    assert_eq!(goods.status, "Active");
    assert_eq!(goods.mark_value_per_unit, Some(bd("5000000")));
    assert_eq!(goods.mark_benchmark.as_deref(), Some("LME"));
    assert_eq!(goods.reference_quantity, Some(bd("900000")));
    assert_eq!(goods.reference_grade, Some(bd("5000000")));
    assert_eq!(goods.flagged_by, Some(0));
    assert_eq!(
        docs_of(&p, 2),
        vec![
            (
                "Perfection".to_owned(),
                hex32(0x63),
                "perfection".to_owned()
            ),
            ("Assay".to_owned(), hex32(0x21), "event".to_owned()),
        ]
    );

    let insp = &p.inspections[0];
    assert_eq!(insp.inspector, INSPECTOR_TEXT);
    assert_eq!(insp.approved_by.as_deref(), Some(APPROVER_TEXT));
    assert_eq!(insp.flagged, Some(true));
    assert_eq!(insp.variance_reference_bps, Some(-250));
    assert_eq!(insp.resolution.as_deref(), Some("Accepted"));
    assert_eq!(p.lots.len(), 2);
    let lot = p.lots.iter().find(|l| l.lot_id == 2).unwrap();
    assert_eq!(lot.latest_inspection_id, Some(1));
    assert_eq!(lot.latest_quantity, Some(bd("900000")));
    assert!(lot.complete);

    let terms = p.terms.as_ref().unwrap();
    assert!(terms.complete);
    assert_eq!(terms.set_ledger, Some(100));
    assert_eq!(terms.payment_term, "Lc");
    assert_eq!(terms.default_ratio_bps, Some(9500));
    assert_eq!(terms.originator_fee_rate, Some(25_000));
    assert_eq!(terms.default_breach_at, Some(bd("0")));
    assert_eq!(terms.margin_call_at, bd("0"));

    let kinds: Vec<&str> = p.margin_events.iter().map(|m| m.kind.as_str()).collect();
    assert_eq!(
        kinds,
        vec![
            "open",
            "default_breach",
            "default_breach_price_stale",
            "default_breach_cleared",
            "cured"
        ]
    );
    assert_eq!(p.margin_events[0].default_ratio_bps, None);
    assert_eq!(p.margin_events[1].default_ratio_bps, Some(9500));
    assert_eq!(p.margin_events[1].ltv_bps, 9700);
    assert_eq!(p.margin_events[2].default_ratio_bps, Some(9500));
    assert_eq!(p.margin_events[3].default_ratio_bps, None);
}

#[test]
fn main_flow_without_snapshots_leaves_view_gaps_but_keeps_history() {
    let p = replay(main_flow(), vec![], vec![], None);
    let goods = rec(&p, 2);
    assert_eq!(goods.attested_by, None);
    assert!(goods.needs_view);
    assert_eq!(goods.reference_quantity, None);
    assert!(p.inspections[0].needs_view);
    assert!(!p.lots[1].complete);
    assert_eq!(p.margin_events.len(), 5);
}

#[test]
fn default_breach_sets_the_event_timestamp_until_it_is_cleared() {
    let events = vec![
        terms_set(1, 0, 100, t(0), 1),
        margin_call(1, 9000, 700_000, 101, t(1), 2),
        default_breach(1, 9700, 102, t(2), 3),
    ];
    let p = replay(events, vec![], vec![], None);
    let terms = p.terms.unwrap();
    assert_eq!(terms.margin_call_at, BigDecimal::from(t(1)));
    assert_eq!(terms.default_breach_at, Some(BigDecimal::from(t(2))));
}

const HOODI_TERMS: &str = "00000000000000000000000000000000000000000000000000000000000017700000000000000000000000000000000000000000000000000000000000001d4c000000000000000000000000000000000000000000000000000000000003f4800000000000000000000000000000000000000000000000000000000000015180000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000697800000000000000000000000000000000000000000000000000000000000004e200000000000000000000000000000000000000000000000000000000000093a800000000000000000000000000000000000000000000000000000000000278d0000000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000000c80000000000000000000000000000000000000000000000000000000000000000";
const HOODI_COVERAGE: &str = "000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000074a5ed5200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000000";

fn assert_f92d719_terms(p: &LoanProjection) {
    let terms = p.terms.as_ref().unwrap();
    assert_eq!(terms.advance_ratio_bps, 6000);
    assert_eq!(terms.margin_call_ratio_bps, 7500);
    assert_eq!(terms.cure_period, bd("259200"));
    assert_eq!(terms.price_stale_after, bd("86400"));
    assert_eq!(terms.payment_term, "Dp");
    assert_eq!(terms.grace_period, bd("432000"));
    assert_eq!(terms.default_rate, 20_000);
    assert_eq!(terms.attestation_interval, bd("604800"));
    assert_eq!(terms.inspection_interval, bd("2592000"));
    assert_eq!(terms.tolerance_bps, 500);
    assert_eq!(terms.grade_tolerance_bps, 200);
    assert_eq!(terms.default_ratio_bps, None);
    assert_eq!(terms.originator_fee_rate, None);
    assert_eq!(terms.default_breach_at, None);
}

#[test]
fn f92d719_terms_fold_to_null_extras() {
    let events = vec![
        terms_set_f92d719(1, 0, 100, t(0), 1),
        margin_call(1, 7600, 700_000, 101, t(1), 2),
        cured(1, 7000, 102, t(2), 3),
    ];
    let p = replay(events, vec![], vec![], None);
    assert_f92d719_terms(&p);
    let kinds: Vec<&str> = p.margin_events.iter().map(|m| m.kind.as_str()).collect();
    assert_eq!(kinds.len(), 2);
    assert!(
        kinds.iter().all(|k| !k.contains("default_breach")),
        "{kinds:?}"
    );

    let view = decode_terms(&hex::decode(HOODI_TERMS).unwrap()).unwrap();
    let loan = Snapshot {
        as_of_ledger: 100,
        view: LoanView {
            terms: Some(view),
            terms_ledger: 100,
            consents: vec![],
            consents_ledger: 100,
        },
    };
    let p = replay(
        vec![terms_set_f92d719(1, 0, 100, t(0), 1)],
        vec![],
        vec![],
        Some(loan),
    );
    assert_f92d719_terms(&p);
}

#[test]
fn f92d719_coverage_gives_a_valuation_without_default_breach() {
    let detail = Snapshot {
        as_of_ledger: 100,
        view: decode_coverage_detail(&hex::decode(HOODI_COVERAGE).unwrap()).unwrap(),
    };
    let money = Snapshot {
        as_of_ledger: 100,
        view: LoanMoneyView {
            disbursed: "0".into(),
            repaid: "0".into(),
            written_down: "0".into(),
            outstanding: "0".into(),
            accrued_interest: "0".into(),
            carved_out: false,
        },
    };
    let row = valuation_row(1, &detail, &money, "0x0", 1).unwrap();
    assert_eq!(row.default_breach_at, None);
    assert_eq!(row.debt, bd("501000000000"));
}

#[test]
fn default_breach_before_the_terms_snapshot_does_not_overwrite_it() {
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
        default_ratio_bps: Some(9500),
        originator_fee_rate: Some(0),
        default_breach_at: Some("777".into()),
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
        default_breach(1, 9700, 95, t(1), 1),
        default_breach_cleared(1, 9000, 105, t(2), 2),
    ];
    let p = replay(events, vec![], vec![], Some(loan));
    let terms = p.terms.unwrap();
    assert!(!terms.complete);
    assert_eq!(terms.default_ratio_bps, Some(9500));
    assert_eq!(terms.default_breach_at, Some(bd("0")));
    assert_eq!(p.margin_events.len(), 2);
}

#[test]
fn main_flow_with_record_snapshots_labels_provenance_and_attestation() {
    let r2 = record_view(
        2,
        2,
        "WarehousePledge",
        "Active",
        "Mt",
        vec![
            doc("Ebl", 0x11),
            doc("Perfection", 0x63),
            doc("Assay", 0x21),
        ],
        Some(mark_view()),
    );
    let p = replay(main_flow(), vec![(2, 108, r2)], flow_inspection(), None);
    let goods = rec(&p, 2);
    assert_eq!(goods.attested_by.as_deref(), Some(INSPECTOR_TEXT));
    assert!(!goods.needs_view);
    assert_eq!(goods.view_ledger, Some(108));
    assert_eq!(
        docs_of(&p, 2),
        vec![
            ("Ebl".to_owned(), hex32(0x11), "register".to_owned()),
            (
                "Perfection".to_owned(),
                hex32(0x63),
                "perfection".to_owned()
            ),
            ("Assay".to_owned(), hex32(0x21), "event".to_owned()),
        ]
    );
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
    assert_eq!(to.mark_value_per_unit, Some(bd("5000000")));
    assert_eq!(to.mark_benchmark.as_deref(), Some("LME"));
    assert_eq!(rec(&p, 1).status, "Released");
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
        registered(1, 1, 1, WAREHOUSE, 100, t(0), 1),
        registered(1, 2, 1, COLLATERAL_MGMT, 100, t(0), 2),
        handed_over(1, 1, 2, 0x70, 101, t(1), 3),
    ];
    let p = replay(events, vec![], vec![], None);
    let to = rec(&p, 2);
    assert_eq!(to.mark_value_per_unit, None);
    assert!(to.needs_view);
    assert_eq!(rec(&p, 1).status, "Released");
}

#[test]
fn usd_record_gets_the_evm_par_mark_and_a_later_revalue_replaces_it() {
    let p = replay(
        vec![registered(1, 3, 3, RECEIVABLE, 100, t(0), 1)],
        vec![],
        vec![],
        None,
    );
    let r = rec(&p, 3);
    assert_eq!(r.mark_value_per_unit, Some(bd("1000000")));
    assert_eq!(r.mark_benchmark.as_deref(), Some("PAR"));
    assert_eq!(r.mark_report_hash.as_deref(), Some(ZERO_HASH));
    assert_eq!(r.mark_at, Some(BigDecimal::from(t(0))));

    let events = vec![
        registered(1, 3, 3, CASH_COVER, 100, t(0), 1),
        revalued(1, 3, 900_000, 101, t(1), 2),
    ];
    let p = replay(events, vec![], vec![], None);
    let r = rec(&p, 3);
    assert_eq!(r.mark_value_per_unit, Some(bd("900000")));
    assert_eq!(r.mark_benchmark.as_deref(), Some("LME"));
}

fn flag_flow(outcome: u8, kind: u8, kind_name: &str, grade: &str) -> LoanProjection {
    let events = vec![
        registered(1, 1, 1, WAREHOUSE, 100, t(0), 1),
        inspection_recorded(1, 1, 1, 1, kind, 101, t(1), 2),
        inspection_approved(1, 1, 1, true, 102, t(2), 3),
        flag_resolved(1, 1, 1, outcome, 103, t(3), 4),
    ];
    let insp = inspection_view(1, 1, 1, kind_name, "100", "900000", grade);
    replay(events, vec![], vec![(1, 101, insp)], None)
}

#[test]
fn flagged_approval_sets_the_flag_and_accept_adopts_the_measured_reference() {
    let events = vec![
        registered(1, 1, 1, WAREHOUSE, 100, t(0), 1),
        inspection_recorded(1, 1, 1, 1, LOADING_TALLY, 101, t(1), 2),
        inspection_approved(1, 1, 1, true, 102, t(2), 3),
    ];
    let insp = inspection_view(1, 1, 1, "LoadingTally", "100", "900000", "0");
    let p = replay(events, vec![], vec![(1, 101, insp)], None);
    assert_eq!(rec(&p, 1).flagged_by, Some(1));
    let i = &p.inspections[0];
    assert_eq!(i.flagged, Some(true));
    assert_eq!(i.approved_ledger, Some(102));
    assert!(i.complete);

    let p = flag_flow(ACCEPTED, LOADING_TALLY, "LoadingTally", "5000000");
    let r = rec(&p, 1);
    assert_eq!(r.reference_quantity, Some(bd("900000")));
    assert_eq!(r.reference_grade, Some(bd("5000000")));
    assert_eq!(r.flagged_by, Some(0));
    assert_eq!(p.inspections[0].resolution.as_deref(), Some("Accepted"));
}

#[test]
fn accept_of_an_assay_keeps_the_quantity_and_zero_grade_keeps_the_grade() {
    let p = flag_flow(ACCEPTED, SAMPLING_ASSAY, "SamplingAssay", "0");
    let r = rec(&p, 1);
    assert_eq!(r.reference_quantity, None);
    assert_eq!(r.reference_grade, None);
    assert_eq!(r.flagged_by, Some(0));
}

#[test]
fn top_up_clears_the_flag_and_escalation_keeps_it() {
    let p = flag_flow(TOP_UP, LOADING_TALLY, "LoadingTally", "0");
    assert_eq!(rec(&p, 1).flagged_by, Some(0));
    assert_eq!(rec(&p, 1).reference_quantity, None);
    let p = flag_flow(ESCALATED, LOADING_TALLY, "LoadingTally", "0");
    assert_eq!(rec(&p, 1).flagged_by, Some(1));
    assert_eq!(p.inspections[0].resolution.as_deref(), Some("Escalated"));
}

#[test]
fn accept_without_the_inspection_snapshot_needs_a_view() {
    let events = vec![
        registered(1, 1, 1, WAREHOUSE, 100, t(0), 1),
        inspection_recorded(1, 1, 1, 1, LOADING_TALLY, 101, t(1), 2),
        inspection_approved(1, 1, 1, true, 102, t(2), 3),
        flag_resolved(1, 1, 1, ACCEPTED, 103, t(3), 4),
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
        registered(1, 1, 1, WAREHOUSE, 100, t(0), 1),
        registered(1, 2, 1, COLLATERAL_MGMT, 100, t(0), 2),
        inspection_recorded(1, 1, 1, 1, LOADING_TALLY, 101, t(1), 3),
        inspection_recorded(1, 1, 2, 1, SAMPLING_ASSAY, 101, t(1), 4),
        inspection_recorded(1, 2, 3, 1, STOCK_COUNT, 101, t(1), 5),
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
        registered(1, 1, 1, WAREHOUSE, 100, t(0), 1),
        inspection_recorded(1, 1, 1, 1, LOADING_TALLY, 101, t(1), 2),
        inspection_approved(1, 1, 1, false, 102, t(2), 3),
    ];
    let p = replay(events, vec![], vec![], None);
    assert!(!p.lots[0].complete);
    assert_eq!(p.lots[0].latest_inspection_id, None);
}

#[test]
fn release_with_consent_is_recorded() {
    let events = vec![
        registered(1, 1, 1, WAREHOUSE, 100, t(0), 1),
        released(1, 1, 0x55, true, 101, t(1), 2),
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
    assert_eq!(row.attested_by.as_deref(), Some(INSPECTOR_TEXT));
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
        registered(1, 7, 4, WAREHOUSE, 90, t(0), 1),
        doc_added(1, 7, DOC_ASSAY, 2, 95, t(1), 2),
        revalued(1, 7, 7_000_000, 95, t(1), 3),
        doc_added(1, 7, DOC_OTHER, 3, 105, t(2), 4),
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
    let events = vec![
        extension_consent(1, 111, 2, 95, t(1), 1),
        extension_consent(1, 222, 3, 105, t(2), 2),
    ];
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
    assert_eq!(p.consents[1].new_maturity, Some(bd("111")));
    assert_eq!(p.consents[1].ledger, Some(95));
    assert_eq!(p.consents[2].consent_hash, hex32(3));
    assert_eq!(p.consents[2].new_maturity, Some(bd("222")));
}

#[test]
fn the_registry_and_nft_streams_order_by_block_and_log_index() {
    let events = vec![
        registered(1, 1, 1, WAREHOUSE, 100, t(0), 1),
        inspection_recorded(1, 1, 1, 1, LOADING_TALLY, 100, t(0), 2),
        inspection_approved(1, 1, 1, false, 100, t(0), 3),
    ];
    let p = replay(events, vec![], vec![], None);
    assert_eq!(p.inspections.len(), 1);
    assert_eq!(p.inspections[0].recorded_ledger, Some(100));
}
