// spec: docs/references/security-registry-events.md#sync-loop
use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use bigdecimal::BigDecimal;
use serde_json::{json, Value};
use shared::security_registry::*;

fn bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

fn ev(id: i64, name: &str, ledger: i64, params: Value) -> SecurityEventRow {
    SecurityEventRow {
        id,
        event_name: name.to_owned(),
        block_number: ledger,
        log_index: id,
        block_timestamp: 1_790_000_000 + ledger,
        tx_hash: format!("tx{id}"),
        params,
    }
}

fn fold(events: &[SecurityEventRow]) -> LoanProjection {
    fold_loan(1, events, &HashMap::new(), &HashMap::new(), None)
}

fn registered(id: i64, ledger: i64, record: &str, protection: &str) -> SecurityEventRow {
    ev(
        id,
        "SecurityRecordRegistered",
        ledger,
        json!({"loan_id": "1", "record_id": record, "lot_id": "1", "protection": protection}),
    )
}

#[test]
fn label_snapshot_tail_covers_zero_partial_full_and_oversized_tails() {
    let items: [&'static str; 3] = ["a", "b", "c"];
    let lead: &'static str = "lead";
    let labels = |tail: &[&'static str]| -> Vec<&'static str> {
        label_snapshot_tail(&items, tail, &lead)
            .into_iter()
            .map(|(_, l)| l)
            .collect()
    };
    assert_eq!(labels(&[]), vec!["lead", "lead", "lead"]);
    assert_eq!(labels(&["x"]), vec!["lead", "lead", "x"]);
    assert_eq!(labels(&["x", "y", "z"]), vec!["x", "y", "z"]);
    assert_eq!(labels(&["w", "x", "y", "z"]), vec!["x", "y", "z"]);
    assert!(label_snapshot_tail::<&str, &str>(&[], &["x"], &lead).is_empty());
}

#[test]
fn registered_record_starts_pending_with_no_attester() {
    let p = fold(&[registered(1, 10, "5", "WarehousePledge")]);
    let r = &p.records[0];
    assert_eq!(r.status, "PendingPerfection");
    assert_eq!(r.registered_ledger, Some(10));
    assert_eq!(r.flagged_by, Some(0));
    assert_eq!(r.mark_value_per_unit, None);
    assert!(r.complete);
    assert!(r.needs_view);
    assert_eq!(p.lots.len(), 1);
}

#[test]
fn each_non_goods_protection_gets_the_par_mark_and_goods_do_not() {
    for protection in [
        "AssignedReceivable",
        "LcProceeds",
        "CashCover",
        "Prepayment",
        "InsuranceLossPayee",
    ] {
        let p = fold(&[registered(1, 10, "5", protection)]);
        assert_eq!(
            p.records[0].mark_value_per_unit,
            Some(bd("10000000")),
            "{protection}"
        );
    }
    for protection in ["EndorsedBl", "WarehousePledge", "CollateralManagement"] {
        assert!(is_goods(protection));
        let p = fold(&[registered(1, 10, "5", protection)]);
        assert_eq!(p.records[0].mark_value_per_unit, None, "{protection}");
    }
    assert!(!is_goods("CashCover"));
}

#[test]
fn attested_enforcement_and_release_effects_apply_in_isolation() {
    let events = vec![
        registered(1, 10, "5", "WarehousePledge"),
        ev(
            2,
            "SecurityRecordAttested",
            11,
            json!({"loan_id": "1", "record_id": "5", "attested_by": "GATT"}),
        ),
        ev(
            3,
            "SecurityEnforcementStarted",
            12,
            json!({"loan_id": "1", "record_id": "5"}),
        ),
    ];
    let p = fold(&events);
    assert_eq!(p.records[0].attested_by.as_deref(), Some("GATT"));
    assert_eq!(p.records[0].status, "UnderEnforcement");
}

#[test]
fn bad_params_are_skipped_without_a_panic() {
    let events = vec![
        registered(1, 10, "5", "WarehousePledge"),
        ev(
            2,
            "SecurityRecordPerfected",
            11,
            json!({"loan_id": "1", "record_id": "5"}),
        ),
        ev(
            3,
            "SecurityRevalued",
            12,
            json!({"loan_id": "1", "record_id": "x"}),
        ),
        ev(4, "SecurityTermsSet", 13, json!({"loan_id": "1"})),
        ev(
            5,
            "SecurityMarginCall",
            14,
            json!({"loan_id": "1", "ltv_bps": 1}),
        ),
        ev(6, "SecurityExtensionConsent", 15, json!({"loan_id": "1"})),
        ev(7, "SecurityDocAdded", 16, json!(null)),
    ];
    let p = fold(&events);
    assert_eq!(p.records[0].status, "PendingPerfection");
    assert!(p.terms.is_none());
    assert!(p.margin_events.is_empty());
    assert!(p.consents.is_empty());
}

fn candidate(
    id: i64,
    approved: bool,
    quantity_kind: bool,
    at: Option<&str>,
    order: (i64, i64, i64),
) -> LotCandidate {
    LotCandidate {
        inspection_id: id,
        measures_quantity: quantity_kind,
        approved,
        inspected_at: at.map(bd),
        quantity: at.map(|_| bd("100")),
        approval_order: order,
    }
}

#[test]
fn lot_latest_ties_and_exclusions() {
    let latest = lot_latest(&[
        candidate(1, true, true, Some("100"), (1, 10, 0)),
        candidate(2, true, true, Some("100"), (1, 11, 0)),
        candidate(3, true, false, Some("900"), (1, 12, 0)),
        candidate(4, false, true, Some("900"), (1, 13, 0)),
    ]);
    assert_eq!(latest.inspection_id, Some(2));
    assert!(latest.complete);

    let latest = lot_latest(&[
        candidate(1, true, true, Some("200"), (1, 10, 0)),
        candidate(2, true, true, Some("100"), (1, 11, 0)),
    ]);
    assert_eq!(latest.inspection_id, Some(1));

    let latest = lot_latest(&[
        candidate(1, true, true, Some("100"), (0, 50, 1)),
        candidate(2, true, true, Some("100"), (1, 10, 0)),
    ]);
    assert_eq!(latest.inspection_id, Some(2));

    let latest = lot_latest(&[
        candidate(1, true, true, Some("100"), (1, 10, 0)),
        candidate(2, true, true, None, (1, 11, 0)),
    ]);
    assert!(!latest.complete);
    assert_eq!(latest.inspection_id, Some(1));

    let latest = lot_latest(&[]);
    assert!(latest.complete);
    assert_eq!(latest.inspection_id, None);
}

#[test]
fn record_snapshot_needs_reads_new_records_and_records_with_a_newer_opaque_event() {
    let rows = vec![
        RecordEventLedgers {
            record_id: 1,
            opaque_ledger: None,
            registered: true,
        },
        RecordEventLedgers {
            record_id: 2,
            opaque_ledger: Some(120),
            registered: true,
        },
        RecordEventLedgers {
            record_id: 3,
            opaque_ledger: Some(100),
            registered: true,
        },
        RecordEventLedgers {
            record_id: 4,
            opaque_ledger: Some(90),
            registered: false,
        },
    ];
    let ledgers: HashMap<u32, i64> = [(1, 100), (2, 110), (3, 100)].into_iter().collect();
    assert_eq!(record_snapshot_needs(&rows, &ledgers), vec![2, 4]);
}

#[test]
fn inspection_and_loan_needs() {
    let ledgers: HashMap<u32, i64> = [(1, 100)].into_iter().collect();
    assert_eq!(
        inspection_snapshot_needs(&[1, 2, 3, 2], &ledgers),
        vec![2, 3]
    );
    let with_terms: HashSet<u32> = [10].into_iter().collect();
    let snapshots: HashSet<u32> = [11].into_iter().collect();
    assert_eq!(
        loan_snapshot_needs(&[10, 11, 12, 13], &with_terms, &snapshots),
        vec![12, 13]
    );
}

fn contract(paused: bool) -> Snapshot<ContractView> {
    Snapshot {
        as_of_ledger: 100,
        view: ContractView {
            paused,
            inspectors: vec!["GA".into()],
            loan_registry: "CLR".into(),
        },
    }
}

#[test]
fn registry_state_takes_the_newer_of_snapshot_and_events_per_field() {
    assert!(fold_registry_state(&[], None).is_none());

    let events = vec![
        ev(1, "SecurityRegistryPaused", 90, json!({})),
        ev(
            2,
            "SecurityInspectorsSet",
            110,
            json!({"inspectors": ["GB", "CC"]}),
        ),
        ev(
            3,
            "SecurityLoanRegistrySet",
            120,
            json!({"loan_registry": "CNEW"}),
        ),
        ev(4, "SecurityRegistryUnpaused", 95, json!({})),
    ];
    let state = fold_registry_state(&events, Some(&contract(true))).unwrap();
    assert_eq!(state.paused, Some(true));
    assert_eq!(state.inspectors, Some(json!(["GB", "CC"])));
    assert_eq!(state.loan_registry.as_deref(), Some("CNEW"));

    let later = vec![ev(5, "SecurityRegistryUnpaused", 101, json!({}))];
    let state = fold_registry_state(&later, Some(&contract(true))).unwrap();
    assert_eq!(state.paused, Some(false));
    assert_eq!(state.inspectors, Some(json!(["GA"])));

    let only_events =
        fold_registry_state(&[ev(6, "SecurityRegistryPaused", 5, json!({}))], None).unwrap();
    assert_eq!(only_events.paused, Some(true));
    assert_eq!(only_events.inspectors, None);
    assert_eq!(only_events.loan_registry, None);
}

#[test]
fn valuation_row_renders_plain_integers() {
    let detail = Snapshot {
        as_of_ledger: 600,
        view: CoverageDetailView {
            value: "100000000000000000000000".into(),
            stale_value: "0".into(),
            flagged_value: "0".into(),
            debt: "340282366920938463463374607431768211455".into(),
            coverage_bps: 1,
            ltv_bps: 2,
            margin_call_at: "0".into(),
            cure_by: "0".into(),
            price_stale: true,
            records: vec![CountedRecordView {
                record_id: 5,
                counted_quantity: "7".into(),
                value_per_unit: "8".into(),
                mark_at: "9".into(),
                stale: false,
                flagged: true,
            }],
        },
    };
    let money = Snapshot {
        as_of_ledger: 601,
        view: LoanMoneyView {
            disbursed: "1".into(),
            repaid: "0".into(),
            written_down: "0".into(),
            outstanding: "1".into(),
            accrued_interest: "0".into(),
            carved_out: false,
        },
    };
    let row = valuation_row(3, &detail, &money, "CLR", 77).unwrap();
    assert_eq!(row.value.to_plain_string(), "100000000000000000000000");
    assert_eq!(
        row.debt.to_plain_string(),
        "340282366920938463463374607431768211455"
    );
    assert_eq!(row.counted_records[0]["record_id"], 5);
    assert_eq!(row.counted_records[0]["flagged"], true);
    assert_eq!(row.source_log_id, 77);
    assert!(row.price_stale);
}

#[test]
fn event_name_lists_are_complete_and_disjoint() {
    assert_eq!(SECURITY_LOAN_EVENT_NAMES.len(), 18);
    assert_eq!(SECURITY_CONTRACT_EVENT_NAMES.len(), 4);
    for n in SECURITY_LOAN_EVENT_NAMES {
        assert!(!SECURITY_CONTRACT_EVENT_NAMES.contains(&n));
        assert!(is_security_registry_event(n));
    }
    for n in SECURITY_RECORD_EVENT_NAMES
        .iter()
        .chain(SECURITY_OPAQUE_RECORD_EVENT_NAMES.iter())
    {
        assert!(SECURITY_LOAN_EVENT_NAMES.contains(n), "{n}");
    }
}

#[test]
fn attested_event_for_an_unknown_record_is_skipped_silently() {
    let events = vec![ev(
        1,
        "SecurityRecordAttested",
        11,
        json!({"loan_id": "1", "record_id": "5", "attested_by": "GATT"}),
    )];
    let (p, skipped) = fold_loan_report(1, &events, &HashMap::new(), &HashMap::new(), None);
    assert_eq!(skipped, 0);
    assert!(p.records.is_empty());

    let bad = vec![ev(2, "SecurityRecordAttested", 11, json!({"loan_id": "1"}))];
    let (_, skipped) = fold_loan_report(1, &bad, &HashMap::new(), &HashMap::new(), None);
    assert_eq!(skipped, 1);
}

fn seeded_inspection(id: u32, approved_at: &str) -> InspectionView {
    InspectionView {
        inspection_id: id,
        record_id: 1,
        lot_id: 1,
        inspector: "GI".into(),
        kind: "StockCount".into(),
        inspected_at: "100".into(),
        region: "AE".into(),
        site_hash: "00".into(),
        quantity: "5".into(),
        grade: "0".into(),
        certificate_hash: "00".into(),
        certificate_no: "c".into(),
        entered_by: "GE".into(),
        entered_at: "50".into(),
        approved_by: Some("GA".into()),
        approved_at: approved_at.into(),
        variance_reference_bps: 0,
        variance_previous_bps: 0,
        variance_grade_bps: 0,
    }
}

#[test]
fn seeded_approval_tie_break_handles_exponent_scale_times() {
    let snaps: HashMap<u32, Snapshot<InspectionView>> = [
        (
            1,
            Snapshot {
                as_of_ledger: 10,
                view: seeded_inspection(1, "179e7"),
            },
        ),
        (
            2,
            Snapshot {
                as_of_ledger: 10,
                view: seeded_inspection(2, "1789999999"),
            },
        ),
    ]
    .into_iter()
    .collect();
    let p = fold_loan(1, &[], &HashMap::new(), &snaps, None);
    assert_eq!(p.lots.len(), 1);
    assert_eq!(p.lots[0].latest_inspection_id, Some(1));
}
