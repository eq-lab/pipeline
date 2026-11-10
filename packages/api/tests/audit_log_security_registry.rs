// spec: docs/product-specs/audit-logging.md#trustee-dashboard-feed-get-v1audit-log
use pipeline_api::config::ConfiguredChain;
use pipeline_api::routes::audit_log::{
    build_response, format_action, AuditLogItem, AUDIT_EVENT_NAMES,
};
use serde_json::{json, Value};
use shared::chains::ChainKind;
use shared::contract_logs_repo::AuditLogRow;

const EVM: ConfiguredChain = ConfiguredChain {
    chain_id: 1,
    kind: ChainKind::Evm,
};
const STELLAR: ConfiguredChain = ConfiguredChain {
    chain_id: 99_000_001,
    kind: ChainKind::Stellar,
};
const ATTESTER: &str = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
const INSPECTOR_A: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INSPECTOR_B: &str = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const INSPECTOR_C: &str = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

const SECURITY_NAMES: [&str; 21] = [
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
    "SecurityInspectorsSet",
    "SecurityRegistryPaused",
    "SecurityRegistryUnpaused",
];

const LEGACY_NAMES: [&str; 11] = [
    "Pledged",
    "HaircutSet",
    "FloorSet",
    "Revalued",
    "StageUpdated",
    "ControlUpdated",
    "DocAdded",
    "QuantityAdjusted",
    "Released",
    "Liquidated",
    "MarginCall",
];

fn hash(byte: &str) -> String {
    byte.repeat(32)
}

fn st(event: &str, params: impl Into<Value>) -> (String, Value) {
    format_action(event, &params.into(), ChainKind::Stellar)
}

fn row(
    id: i64,
    chain_id: i64,
    ts: i64,
    event: &str,
    loan: Option<&str>,
    params: Value,
) -> AuditLogRow {
    AuditLogRow {
        id,
        chain_id,
        event_name: event.to_owned(),
        block_timestamp: ts,
        block_number: ts,
        log_index: 0,
        tx_hash: format!("0xhash{id}"),
        loan_id: loan.map(str::to_owned),
        originator: None,
        commodity: None,
        params,
    }
}

fn repaid(
    id: i64,
    chain_id: i64,
    ts: i64,
    loan: &str,
    repayment: &str,
    sale: &str,
    cash: &str,
) -> AuditLogRow {
    row(
        id,
        chain_id,
        ts,
        "CashRepaid",
        Some(loan),
        json!({
            "loan_id": loan, "repayment_id": repayment, "sale_id": sale, "cash": cash,
            "interest_minted": "0", "fee_shares": "0", "value_date": "1700000000",
        }),
    )
}

fn enforced(id: i64, chain_id: i64, ts: i64, loan: &str, record: &str) -> AuditLogRow {
    row(
        id,
        chain_id,
        ts,
        "SecurityRecordEnforced",
        Some(loan),
        json!({ "loan_id": loan, "record_id": record, "proceeds_hash": hash("cd") }),
    )
}

fn find<'a>(items: &'a [AuditLogItem], event: &str) -> &'a AuditLogItem {
    items.iter().find(|i| i.event_name == event).unwrap()
}

#[test]
fn security_registry_names_are_allow_listed() {
    for name in SECURITY_NAMES {
        assert!(AUDIT_EVENT_NAMES.contains(&name), "{name}");
    }
}

#[test]
fn only_the_expected_security_names_are_allow_listed() {
    let mut listed: Vec<&str> = AUDIT_EVENT_NAMES
        .iter()
        .copied()
        .filter(|n| n.starts_with("Security"))
        .collect();
    let mut expected = SECURITY_NAMES.to_vec();
    listed.sort_unstable();
    expected.sort_unstable();
    assert_eq!(listed, expected);
    assert!(!AUDIT_EVENT_NAMES.contains(&"SecurityLoanRegistrySet"));
}

#[test]
fn record_nft_topics_never_reach_the_feed() {
    for name in [
        "mint",
        "burn",
        "Mint",
        "Burn",
        "ownership_transfer",
        "ownership_transfer_completed",
        "ownership_renounced",
    ] {
        assert!(!AUDIT_EVENT_NAMES.contains(&name), "{name}");
    }
}

#[test]
fn record_registered_renders_protection_and_lot() {
    let (a, d) = st(
        "SecurityRecordRegistered",
        json!({ "loan_id": "7", "record_id": "3", "lot_id": "2", "protection": "Pledge" }),
    );
    assert_eq!(a, "Security record #3 registered — Pledge, lot #2");
    assert_eq!(
        d,
        json!({ "record_id": "3", "lot_id": "2", "protection": "Pledge" })
    );
}

#[test]
fn record_perfected_passes_the_evidence_hash() {
    let (a, d) = st(
        "SecurityRecordPerfected",
        json!({ "loan_id": "7", "record_id": "3", "evidence_hash": hash("ab") }),
    );
    assert_eq!(a, "Security record #3 perfected");
    assert_eq!(d, json!({ "record_id": "3", "evidence_hash": hash("ab") }));
}

#[test]
fn record_handed_over_shows_both_records() {
    let (a, d) = st(
        "SecurityRecordHandedOver",
        json!({ "loan_id": "7", "from_record_id": "3", "to_record_id": "4", "evidence_hash": hash("ab") }),
    );
    assert_eq!(a, "Security handed over — record #3 → #4");
    assert_eq!(
        d,
        json!({ "from_record_id": "3", "to_record_id": "4", "evidence_hash": hash("ab") })
    );
}

#[test]
fn record_attested_keeps_the_address_out_of_the_action() {
    let (a, d) = st(
        "SecurityRecordAttested",
        json!({ "loan_id": "7", "record_id": "3", "attested_by": ATTESTER }),
    );
    assert_eq!(a, "Security record #3 attested");
    assert_eq!(d, json!({ "record_id": "3", "attested_by": ATTESTER }));
}

#[test]
fn doc_added_renders_kind_and_record() {
    let (a, d) = st(
        "SecurityDocAdded",
        json!({ "loan_id": "7", "record_id": "3", "kind": "Assay", "sha256": hash("ef") }),
    );
    assert_eq!(a, "Security document added — Assay, record #3");
    assert_eq!(
        d,
        json!({ "record_id": "3", "kind": "Assay", "sha256": hash("ef") })
    );
}

#[test]
fn record_released_renders_both_consent_values() {
    let plain =
        json!({ "loan_id": "7", "record_id": "3", "reason_hash": hash("ab"), "by_consent": false });
    let (a, d) = st("SecurityRecordReleased", plain);
    assert_eq!(a, "Security record #3 released");
    assert_eq!(
        d,
        json!({ "record_id": "3", "by_consent": false, "reason_hash": hash("ab") })
    );
    let consent =
        json!({ "loan_id": "7", "record_id": "3", "reason_hash": hash("ab"), "by_consent": true });
    let (a, d) = st("SecurityRecordReleased", consent);
    assert_eq!(a, "Security record #3 released with Risk Council consent");
    assert_eq!(d["by_consent"], json!(true));
}

#[test]
fn mandate_breach_and_enforcement_started_render() {
    let (a, d) = st(
        "SecurityMandateBreach",
        json!({ "loan_id": "7", "evidence_hash": hash("ab") }),
    );
    assert_eq!(a, "Mandate breach reported");
    assert_eq!(d, json!({ "evidence_hash": hash("ab") }));
    let (a, d) = st(
        "SecurityEnforcementStarted",
        json!({ "loan_id": "7", "record_id": "3" }),
    );
    assert_eq!(a, "Enforcement started — security record #3");
    assert_eq!(d, json!({ "record_id": "3" }));
}

#[test]
fn record_enforced_unlinked_has_empty_proceeds() {
    let (a, d) = st(
        "SecurityRecordEnforced",
        json!({ "loan_id": "7", "record_id": "3", "proceeds_hash": hash("cd") }),
    );
    assert_eq!(a, "Security record #3 enforced");
    assert_eq!(
        d,
        json!({ "record_id": "3", "proceeds_hash": hash("cd"), "repayment_ids": [], "proceeds": null })
    );
}

#[test]
fn terms_set_renders_percents_and_raw_durations() {
    let params = json!({
        "loan_id": "7",
        "advance_ratio_bps": 8000, "margin_call_ratio_bps": 8500, "default_rate": 150_000,
        "tolerance_bps": 100, "grade_tolerance_bps": 50,
        "cure_period": "1209600", "price_stale_after": "604800", "grace_period": "259200",
        "attestation_interval": "2592000", "inspection_interval": "7776000",
        "margin_call_at": "0", "payment_term": "Net30",
    });
    let (a, d) = st("SecurityTermsSet", params);
    assert_eq!(
        a,
        "Security terms set — advance ratio 80.00%, margin call ratio 85.00%, cure period 14d"
    );
    assert_eq!(
        d,
        json!({
            "advance_ratio_pct": "80.00",
            "margin_call_ratio_pct": "85.00",
            "cure_period": "1209600",
            "price_stale_after": "604800",
            "payment_term": "Net30",
            "grace_period": "259200",
            "default_rate_pct": "15.00",
            "attestation_interval": "2592000",
            "inspection_interval": "7776000",
            "tolerance_pct": "1.00",
            "grade_tolerance_pct": "0.50",
        })
    );
}

#[test]
fn revalued_renders_the_chain_scaled_price() {
    let (a, d) = st(
        "SecurityRevalued",
        json!({ "loan_id": "7", "record_id": "3", "value_per_unit": "10000000", "benchmark": "LME", "report_hash": hash("ab") }),
    );
    assert_eq!(a, "Security record #3 revalued — $1.000000/unit (LME)");
    assert_eq!(
        d,
        json!({ "record_id": "3", "value_per_unit": "1.000000", "benchmark": "LME", "report_hash": hash("ab") })
    );
}

#[test]
fn margin_call_renders_iso_cure_by_and_keeps_it_raw_in_details() {
    let (a, d) = st(
        "SecurityMarginCall",
        json!({ "loan_id": "7", "ltv_bps": 8750, "margin_call_ratio_bps": 8500, "cure_by": "1795132800" }),
    );
    assert_eq!(
        a,
        "Margin call — LTV 87.50%, margin call ratio 85.00%, cure by 2026-11-20T00:00:00Z"
    );
    assert_eq!(
        d,
        json!({ "ltv_pct": "87.50", "margin_call_ratio_pct": "85.00", "cure_by": "1795132800" })
    );
}

#[test]
fn price_stale_and_margin_call_cured_render() {
    let (a, d) = st(
        "SecurityPriceStale",
        json!({ "loan_id": "7", "ltv_bps": 8750, "margin_call_ratio_bps": 8500 }),
    );
    assert_eq!(
        a,
        "Price stale — LTV 87.50% above 85.00% margin call ratio, no margin call until revalued"
    );
    assert_eq!(
        d,
        json!({ "ltv_pct": "87.50", "margin_call_ratio_pct": "85.00" })
    );
    let (a, d) = st(
        "SecurityMarginCallCured",
        json!({ "loan_id": "7", "ltv_bps": 7800 }),
    );
    assert_eq!(a, "Margin call cured — LTV 78.00%");
    assert_eq!(d, json!({ "ltv_pct": "78.00" }));
}

#[test]
fn inspection_recorded_renders_kind_and_record() {
    let (a, d) = st(
        "SecurityInspectionRecorded",
        json!({ "loan_id": "7", "record_id": "3", "inspection_id": "5", "lot_id": "2", "inspector": INSPECTOR_A, "kind": "Initial" }),
    );
    assert_eq!(a, "Inspection #5 recorded — Initial, security record #3");
    assert_eq!(
        d,
        json!({ "inspection_id": "5", "record_id": "3", "lot_id": "2", "kind": "Initial", "inspector": INSPECTOR_A })
    );
}

#[test]
fn inspection_approved_signs_variances_and_flags() {
    let params = |flagged: bool, reference: i64, previous: i64, grade: i64| {
        json!({
            "loan_id": "7", "record_id": "3", "inspection_id": "5", "approved_by": INSPECTOR_B,
            "variance_reference_bps": reference, "variance_previous_bps": previous,
            "variance_grade_bps": grade, "flagged": flagged,
        })
    };
    let (a, d) = st("SecurityInspectionApproved", params(false, -250, 10, 0));
    assert_eq!(
        a,
        "Inspection #5 approved — variance vs reference -2.50%, vs previous +0.10%, grade 0.00%"
    );
    assert_eq!(
        d,
        json!({
            "inspection_id": "5", "record_id": "3", "approved_by": INSPECTOR_B,
            "variance_reference_pct": "-2.50", "variance_previous_pct": "0.10",
            "variance_grade_pct": "0.00", "flagged": false,
        })
    );
    let (a, d) = st("SecurityInspectionApproved", params(true, 300, 0, -5));
    assert_eq!(
        a,
        "Inspection #5 approved — variance vs reference +3.00%, vs previous 0.00%, grade -0.05%, flagged"
    );
    assert_eq!(d["flagged"], json!(true));
}

#[test]
fn flag_resolved_renders_each_outcome() {
    for outcome in ["Accepted", "TopUpRequired", "Escalated"] {
        let (a, d) = st(
            "SecurityFlagResolved",
            json!({ "loan_id": "7", "record_id": "3", "inspection_id": "5", "outcome": outcome, "reason_hash": hash("ab") }),
        );
        assert_eq!(
            a,
            format!("Inspection flag resolved — {outcome}, security record #3 (inspection #5)")
        );
        assert_eq!(
            d,
            json!({ "record_id": "3", "inspection_id": "5", "outcome": outcome, "reason_hash": hash("ab") })
        );
    }
}

#[test]
fn extension_consent_renders_the_new_maturity() {
    let (a, d) = st(
        "SecurityExtensionConsent",
        json!({ "loan_id": "7", "new_maturity": "1801353600", "consent_hash": hash("ab") }),
    );
    assert_eq!(
        a,
        "Buyer extension consent — new maturity 2027-01-31T00:00:00Z"
    );
    assert_eq!(
        d,
        json!({ "new_maturity": "1801353600", "consent_hash": hash("ab") })
    );
}

#[test]
fn inspectors_set_counts_inspectors_and_is_protocol_scoped() {
    let cases = [
        (json!([]), "Inspector panel set — 0 inspectors"),
        (json!([INSPECTOR_A]), "Inspector panel set — 1 inspector"),
        (
            json!([INSPECTOR_A, INSPECTOR_B, INSPECTOR_C]),
            "Inspector panel set — 3 inspectors",
        ),
    ];
    for (list, action) in cases {
        let (a, d) = st("SecurityInspectorsSet", json!({ "inspectors": list }));
        assert_eq!(a, action);
        assert_eq!(d, json!({ "inspectors": list }));
    }
    let resp = build_response(
        vec![row(
            1,
            STELLAR.chain_id,
            100,
            "SecurityInspectorsSet",
            None,
            json!({ "inspectors": [INSPECTOR_A] }),
        )],
        &[STELLAR],
    );
    assert_eq!(resp.items[0].scope.label, "Protocol");
    assert_eq!(resp.items[0].scope.loan_id, None);
    assert_eq!(resp.items[0].reference, "");
}

#[test]
fn pause_rows_render_with_empty_details() {
    let (a, d) = st("SecurityRegistryPaused", json!({}));
    assert_eq!(a, "SecurityRegistry paused");
    assert_eq!(d, json!({}));
    let (a, d) = st("SecurityRegistryUnpaused", json!({}));
    assert_eq!(a, "SecurityRegistry unpaused");
    assert_eq!(d, json!({}));
}

#[test]
fn ltv_u32_max_renders_unbounded_with_null_pct() {
    let (a, d) = st(
        "SecurityMarginCall",
        json!({ "loan_id": "7", "ltv_bps": 4_294_967_295_u32, "margin_call_ratio_bps": 8500, "cure_by": "1795132800" }),
    );
    assert_eq!(
        a,
        "Margin call — LTV unbounded, margin call ratio 85.00%, cure by 2026-11-20T00:00:00Z"
    );
    assert_eq!(d["ltv_pct"], Value::Null);
    let (a, d) = st(
        "SecurityPriceStale",
        json!({ "loan_id": "7", "ltv_bps": 4_294_967_295_u32, "margin_call_ratio_bps": 8500 }),
    );
    assert!(a.starts_with("Price stale — LTV unbounded"));
    assert_eq!(d["ltv_pct"], Value::Null);
    let (a, d) = st(
        "SecurityMarginCallCured",
        json!({ "loan_id": "7", "ltv_bps": 4_294_967_295_u32 }),
    );
    assert_eq!(a, "Margin call cured — LTV unbounded");
    assert_eq!(d, json!({ "ltv_pct": null }));
}

#[test]
fn bps_pct_handles_small_negatives() {
    let (_, d) = st(
        "SecurityInspectionApproved",
        json!({
            "inspection_id": "5", "variance_reference_bps": -5,
            "variance_previous_bps": 5, "variance_grade_bps": 0,
        }),
    );
    assert_eq!(d["variance_reference_pct"], "-0.05");
    assert_eq!(d["variance_previous_pct"], "0.05");
    assert_eq!(d["variance_grade_pct"], "0.00");
}

#[test]
fn missing_fields_degrade_to_bare_labels() {
    let bare = [
        ("SecurityRecordRegistered", "Security record registered"),
        ("SecurityRecordPerfected", "Security record perfected"),
        ("SecurityRecordHandedOver", "Security handed over"),
        ("SecurityRecordAttested", "Security record attested"),
        ("SecurityDocAdded", "Security document added"),
        ("SecurityRecordReleased", "Security record released"),
        ("SecurityMandateBreach", "Mandate breach reported"),
        ("SecurityEnforcementStarted", "Enforcement started"),
        ("SecurityRecordEnforced", "Security record enforced"),
        ("SecurityTermsSet", "Security terms set"),
        ("SecurityRevalued", "Security record revalued"),
        ("SecurityMarginCall", "Margin call"),
        ("SecurityPriceStale", "Price stale"),
        ("SecurityMarginCallCured", "Margin call cured"),
        ("SecurityInspectionRecorded", "Inspection recorded"),
        ("SecurityInspectionApproved", "Inspection approved"),
        ("SecurityFlagResolved", "Inspection flag resolved"),
        ("SecurityExtensionConsent", "Buyer extension consent"),
        ("SecurityInspectorsSet", "Inspector panel set"),
        ("SecurityRegistryPaused", "SecurityRegistry paused"),
        ("SecurityRegistryUnpaused", "SecurityRegistry unpaused"),
    ];
    assert_eq!(bare.len(), SECURITY_NAMES.len());
    for (name, label) in bare {
        let (a, d) = st(name, json!({}));
        assert_eq!(a, label, "{name}");
        assert!(d.is_object(), "{name}");
    }
}

#[test]
fn cure_period_label_units() {
    let label = |secs: &str| {
        st(
            "SecurityTermsSet",
            json!({ "advance_ratio_bps": 8000, "margin_call_ratio_bps": 8500, "cure_period": secs }),
        )
        .0
    };
    for (secs, unit) in [
        ("0", "0s"),
        ("90", "90s"),
        ("7200", "2h"),
        ("1209600", "14d"),
        ("90000", "25h"),
        ("120", "2m"),
    ] {
        assert!(
            label(secs).ends_with(&format!("cure period {unit}")),
            "{secs}"
        );
    }
}

#[test]
fn loan_scoped_security_rows_get_a_loan_scope_and_empty_reference() {
    let resp = build_response(
        vec![row(
            1,
            STELLAR.chain_id,
            100,
            "SecurityMandateBreach",
            Some("7"),
            json!({ "loan_id": "7", "evidence_hash": hash("ab") }),
        )],
        &[STELLAR],
    );
    let item = &resp.items[0];
    assert_eq!(item.scope.label, "Loan #7");
    assert_eq!(item.scope.loan_id.as_deref(), Some("7"));
    assert_eq!(item.reference, "");
}

#[test]
fn enforced_links_one_repayment_with_the_sale_id() {
    let resp = build_response(
        vec![
            enforced(1, STELLAR.chain_id, 200, "7", "3"),
            repaid(2, STELLAR.chain_id, 100, "7", "2", "3", "250000000"),
        ],
        &[STELLAR],
    );
    let item = find(&resp.items, "SecurityRecordEnforced");
    assert_eq!(
        item.action,
        "Security record #3 enforced — proceeds $25.000000 repaid (repayment #2)"
    );
    assert_eq!(item.details["repayment_ids"], json!(["2"]));
    assert_eq!(item.details["proceeds"], "25.000000");
}

#[test]
fn enforced_sums_repayments_and_sorts_ids_numerically() {
    let resp = build_response(
        vec![
            enforced(1, STELLAR.chain_id, 300, "7", "3"),
            repaid(2, STELLAR.chain_id, 100, "7", "10", "3", "10000000"),
            repaid(3, STELLAR.chain_id, 200, "7", "9", "3", "20000000"),
        ],
        &[STELLAR],
    );
    let item = find(&resp.items, "SecurityRecordEnforced");
    assert_eq!(
        item.action,
        "Security record #3 enforced — proceeds $3.000000 repaid (repayments #9, #10)"
    );
    assert_eq!(item.details["repayment_ids"], json!(["9", "10"]));
    assert_eq!(item.details["proceeds"], "3.000000");
}

#[test]
fn enforced_ignores_unrelated_repayments() {
    let resp = build_response(
        vec![
            enforced(1, STELLAR.chain_id, 500, "7", "3"),
            repaid(2, STELLAR.chain_id, 100, "7", "1", "0", "10000000"),
            repaid(3, STELLAR.chain_id, 200, "8", "2", "3", "10000000"),
            repaid(4, STELLAR.chain_id, 300, "7", "3", "4", "10000000"),
            repaid(5, EVM.chain_id, 400, "7", "4", "3", "10000000"),
        ],
        &[STELLAR, EVM],
    );
    let item = resp
        .items
        .iter()
        .find(|i| i.event_name == "SecurityRecordEnforced")
        .unwrap();
    assert_eq!(item.action, "Security record #3 enforced");
    assert_eq!(item.details["repayment_ids"], json!([]));
    assert_eq!(item.details["proceeds"], Value::Null);
}

#[test]
fn enforced_excludes_a_reversed_repayment() {
    let reversal = row(
        4,
        STELLAR.chain_id,
        300,
        "CashRepaymentReversed",
        Some("7"),
        json!({ "loan_id": "7", "repayment_id": "2", "cash": "250000000" }),
    );
    let resp = build_response(
        vec![
            enforced(1, STELLAR.chain_id, 400, "7", "3"),
            repaid(2, STELLAR.chain_id, 100, "7", "2", "3", "250000000"),
            repaid(3, STELLAR.chain_id, 200, "7", "5", "3", "10000000"),
            reversal,
        ],
        &[STELLAR],
    );
    let item = find(&resp.items, "SecurityRecordEnforced");
    assert_eq!(item.details["repayment_ids"], json!(["5"]));
    assert_eq!(item.details["proceeds"], "1.000000");
}

#[test]
fn enforced_links_a_repayment_newer_than_the_enforcement() {
    let resp = build_response(
        vec![
            enforced(1, STELLAR.chain_id, 100, "7", "3"),
            repaid(2, STELLAR.chain_id, 200, "7", "2", "3", "250000000"),
        ],
        &[STELLAR],
    );
    let item = find(&resp.items, "SecurityRecordEnforced");
    assert_eq!(item.details["repayment_ids"], json!(["2"]));
}

#[test]
fn cash_repaid_items_are_unchanged_by_the_enforcement_link() {
    let repay = || repaid(2, STELLAR.chain_id, 100, "7", "2", "3", "250000000");
    let alone = build_response(vec![repay()], &[STELLAR]);
    let linked = build_response(
        vec![enforced(1, STELLAR.chain_id, 200, "7", "3"), repay()],
        &[STELLAR],
    );
    let a = find(&alone.items, "CashRepaid");
    let b = find(&linked.items, "CashRepaid");
    assert_eq!(b.event_name, "CashRepaid");
    assert_eq!(a.action, b.action);
    assert_eq!(a.details, b.details);
}

#[test]
fn stellar_collateral_registry_rows_carry_the_legacy_suffix_only() {
    let params = json!({
        "loan_id": "7", "lot_id": "2", "bps": 1500, "stage": "Sold", "location": null,
        "control": { "kind": "Cma" }, "kind": "Assay", "hash": "ab", "value_per_unit": "0",
        "benchmark": "PAR", "report_hash": "ab", "old_quantity": "0", "new_quantity": "0",
        "reason": "Payment", "quantity": "0", "ref_hash": "ab", "sale_id": "4",
        "coverage_bps": 9000, "floor_bps": 12000,
    });
    for name in LEGACY_NAMES {
        let (stellar_action, stellar_details) = format_action(name, &params, ChainKind::Stellar);
        let (evm_action, _) = format_action(name, &params, ChainKind::Evm);
        assert!(
            !evm_action.ends_with("(legacy collateral registry)"),
            "{name}"
        );
        assert_eq!(
            stellar_action,
            format!("{evm_action} (legacy collateral registry)"),
            "{name}"
        );
        let (_, evm_details) = format_action(name, &params, ChainKind::Evm);
        if !matches!(
            name,
            "Revalued" | "QuantityAdjusted" | "Released" | "Liquidated"
        ) {
            assert_eq!(stellar_details, evm_details, "{name}");
        }
    }
}

#[test]
fn legacy_suffix_skips_ccr_security_and_other_stellar_rows() {
    let (a, _) = st("LoanCCRUpdated", json!({ "new_ccr": 1_500_000 }));
    assert_eq!(a, "CCR written on-chain");
    let (a, _) = st("CashRepaid", json!({ "cash": "10000000" }));
    assert_eq!(a, "Cash repaid — $1.000000");
    let (a, _) = st("PocketOpened", json!({ "amount": "10000000" }));
    assert!(!a.contains("legacy"));
    for name in SECURITY_NAMES {
        assert!(!st(name, json!({})).0.contains("legacy"), "{name}");
    }
}

#[test]
fn hostile_amount_strings_degrade_quickly_to_null() {
    let started = std::time::Instant::now();
    let overflow = "9".repeat(40);
    for raw in [
        "1e3000000",
        "1e-300000",
        "1_000",
        "+1",
        "",
        "-",
        "1.5",
        overflow.as_str(),
    ] {
        let (a, d) = st(
            "SecurityRevalued",
            json!({ "record_id": "3", "value_per_unit": raw, "benchmark": "LME" }),
        );
        assert_eq!(a, "Security record revalued", "{raw}");
        assert_eq!(d["value_per_unit"], Value::Null, "{raw}");
        let (a, d) = format_action("Disbursed", &json!({ "amount": raw }), ChainKind::Evm);
        assert_eq!(a, "Disbursed", "{raw}");
        assert_eq!(d["amount"], Value::Null, "{raw}");
    }
    let resp = build_response(
        vec![
            enforced(1, STELLAR.chain_id, 200, "7", "3"),
            repaid(2, STELLAR.chain_id, 100, "7", "2", "3", "1e3000000"),
            repaid(3, STELLAR.chain_id, 110, "7", "4", "3", "1"),
            repaid(
                4,
                STELLAR.chain_id,
                120,
                "7",
                "5",
                "3",
                "170141183460469231731687303715884105727",
            ),
            repaid(5, STELLAR.chain_id, 130, "7", "6", "3", &"9".repeat(39)),
        ],
        &[STELLAR],
    );
    let item = find(&resp.items, "SecurityRecordEnforced");
    assert_eq!(item.details["repayment_ids"], json!(["5"]));
    assert!(started.elapsed().as_secs() < 2);
}

#[test]
fn valid_amounts_are_unchanged_and_negative_prices_put_the_sign_first() {
    let (a, d) = st(
        "SecurityRevalued",
        json!({ "record_id": "3", "value_per_unit": "10000000", "benchmark": "LME" }),
    );
    assert_eq!(a, "Security record #3 revalued — $1.000000/unit (LME)");
    assert_eq!(d["value_per_unit"], "1.000000");
    let (a, _) = st(
        "SecurityRevalued",
        json!({ "record_id": "3", "value_per_unit": "-10000000", "benchmark": "LME" }),
    );
    assert_eq!(a, "Security record #3 revalued — -$1.000000/unit (LME)");
    let (_, d) = format_action("Disbursed", &json!({ "amount": "-5" }), ChainKind::Evm);
    assert_eq!(d["amount"], "-0.000005");
    let (_, d) = format_action("Disbursed", &json!({ "amount": "-19" }), ChainKind::Stellar);
    assert_eq!(d["amount"], "-0.000001");
}

#[test]
fn default_rate_rejects_negative_and_out_of_range_values() {
    let rate = |raw: Value| {
        st(
            "SecurityTermsSet",
            json!({ "advance_ratio_bps": 8000, "margin_call_ratio_bps": 8500, "cure_period": "0", "default_rate": raw }),
        )
        .1["default_rate_pct"]
            .clone()
    };
    assert_eq!(rate(json!(-100)), Value::Null);
    assert_eq!(rate(json!(i64::MAX)), Value::Null);
    assert_eq!(rate(json!(150_000)), json!("15.00"));
}

#[test]
fn out_of_range_times_drop_the_clause_and_keep_raw_details() {
    for raw in ["18446744073709551615", "99999999999999"] {
        let (a, d) = st(
            "SecurityMarginCall",
            json!({ "ltv_bps": 8750, "margin_call_ratio_bps": 8500, "cure_by": raw }),
        );
        assert_eq!(
            a, "Margin call — LTV 87.50%, margin call ratio 85.00%",
            "{raw}"
        );
        assert_eq!(d["cure_by"], raw);
        let (a, d) = st(
            "SecurityExtensionConsent",
            json!({ "new_maturity": raw, "consent_hash": hash("ab") }),
        );
        assert_eq!(a, "Buyer extension consent", "{raw}");
        assert_eq!(d["new_maturity"], raw);
    }
}

#[test]
fn security_name_without_an_arm_falls_back_to_the_raw_name() {
    let (a, d) = st("SecurityLoanRegistrySet", json!({}));
    assert_eq!(a, "SecurityLoanRegistrySet");
    assert_eq!(d, json!({}));
}

#[test]
fn enforced_without_matching_rows_ignores_repayments_of_other_loans() {
    let resp = build_response(
        vec![repaid(1, STELLAR.chain_id, 100, "7", "2", "3", "1e3000000")],
        &[STELLAR],
    );
    assert_eq!(resp.items.len(), 1);
    assert_eq!(resp.items[0].action, "Cash repaid");
}
