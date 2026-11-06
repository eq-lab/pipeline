// spec: docs/references/security-registry-events.md#event-table
#![allow(clippy::needless_pass_by_value)]
mod stellar_security_support;

use pipeline_worker::indexer::stellar::collateral_registry_parsers::{
    dispatch_collateral_registry, is_collateral_registry_event,
};
use pipeline_worker::indexer::stellar::loan_registry_parsers::extract_u32;
use pipeline_worker::indexer::stellar::pocket_parsers::{is_pocket_event, POCKET_EVENT_TOPICS};
use pipeline_worker::indexer::stellar::poller::is_loan_registry_event;
use pipeline_worker::indexer::stellar::security_registry_parsers::*;
use serde_json::json;
use shared::security_registry::{
    is_security_registry_event, SECURITY_CONTRACT_EVENT_NAMES, SECURITY_LOAN_EVENT_NAMES,
};
use stellar_security_support::*;
use stellar_xdr::curr::ScVal;

fn check(
    raw: &pipeline_worker::indexer::stellar::rpc::RawEvent,
    name: &str,
    params: serde_json::Value,
) {
    let log = dispatch_security_registry(raw).unwrap_or_else(|| panic!("{name} did not decode"));
    assert_eq!(log.event_name, name);
    assert_eq!(log.contract_address, SECURITY);
    assert_eq!(log.block_number, 1_234_567);
    assert_eq!(log.block_timestamp, BASE_TS as u64);
    assert_eq!(log.tx_hash, "tx2");
    assert_eq!(log.log_index, 2000);
    assert_eq!(log.params, params);
}

#[test]
fn record_events_decode() {
    check(
        &raw(
            "record_registered",
            &[1, 5],
            encode_map(vec![
                ("lot_id", ScVal::U32(9)),
                ("protection", enum_val("EndorsedBl")),
            ]),
        ),
        "SecurityRecordRegistered",
        json!({"loan_id": "1", "record_id": "5", "lot_id": "9", "protection": "EndorsedBl"}),
    );
    check(
        &raw(
            "record_perfected",
            &[1, 5],
            encode_map(vec![("evidence_hash", bytes32(0xab))]),
        ),
        "SecurityRecordPerfected",
        json!({"loan_id": "1", "record_id": "5", "evidence_hash": hex32(0xab)}),
    );
    check(
        &raw(
            "record_handed_over",
            &[1, 5, 6],
            encode_map(vec![("evidence_hash", bytes32(1))]),
        ),
        "SecurityRecordHandedOver",
        json!({"loan_id": "1", "from_record_id": "5", "to_record_id": "6", "evidence_hash": hex32(1)}),
    );
    check(
        &raw(
            "record_attested",
            &[1, 5],
            encode_map(vec![("attested_by", address_val(G_ADDR))]),
        ),
        "SecurityRecordAttested",
        json!({"loan_id": "1", "record_id": "5", "attested_by": G_ADDR}),
    );
    check(
        &raw(
            "doc_added",
            &[1, 5],
            encode_map(vec![
                ("kind", enum_val("WarehouseReceipt")),
                ("sha256", bytes32(2)),
            ]),
        ),
        "SecurityDocAdded",
        json!({"loan_id": "1", "record_id": "5", "kind": "WarehouseReceipt", "sha256": hex32(2)}),
    );
    check(
        &raw(
            "mandate_breach",
            &[1],
            encode_map(vec![("evidence_hash", bytes32(3))]),
        ),
        "SecurityMandateBreach",
        json!({"loan_id": "1", "evidence_hash": hex32(3)}),
    );
    check(
        &raw("enforcement_started", &[1, 5], encode_map(vec![])),
        "SecurityEnforcementStarted",
        json!({"loan_id": "1", "record_id": "5"}),
    );
    check(
        &raw(
            "record_enforced",
            &[1, 5],
            encode_map(vec![("proceeds_hash", bytes32(4))]),
        ),
        "SecurityRecordEnforced",
        json!({"loan_id": "1", "record_id": "5", "proceeds_hash": hex32(4)}),
    );
}

#[test]
fn record_released_with_and_without_consent() {
    for by_consent in [true, false] {
        check(
            &raw(
                "record_released",
                &[1, 5],
                encode_map(vec![
                    ("reason_hash", bytes32(5)),
                    ("by_consent", ScVal::Bool(by_consent)),
                ]),
            ),
            "SecurityRecordReleased",
            json!({"loan_id": "1", "record_id": "5", "reason_hash": hex32(5), "by_consent": by_consent}),
        );
    }
}

#[test]
fn terms_set_flattens_the_nested_terms_map() {
    check(
        &raw("terms_set", &[1], terms_value(0)),
        "SecurityTermsSet",
        json!({
            "loan_id": "1",
            "advance_ratio_bps": 8000,
            "margin_call_ratio_bps": 8500,
            "default_rate": 200_000,
            "tolerance_bps": 50,
            "grade_tolerance_bps": 100,
            "cure_period": "604800",
            "price_stale_after": "172800",
            "grace_period": "86400",
            "attestation_interval": "0",
            "inspection_interval": "0",
            "margin_call_at": "0",
            "payment_term": "Lc",
        }),
    );
}

#[test]
fn revalued_and_margin_events_decode() {
    check(
        &raw(
            "revalued",
            &[1, 5],
            encode_map(vec![
                ("value_per_unit", i128_val(100_000_000)),
                ("benchmark", sym("LME")),
                ("report_hash", bytes32(6)),
            ]),
        ),
        "SecurityRevalued",
        json!({"loan_id": "1", "record_id": "5", "value_per_unit": "100000000", "benchmark": "LME", "report_hash": hex32(6)}),
    );
    check(
        &raw(
            "margin_call",
            &[1],
            encode_map(vec![
                ("ltv_bps", ScVal::U32(u32::MAX)),
                ("margin_call_ratio_bps", ScVal::U32(8500)),
                ("cure_by", ScVal::U64(u64::MAX)),
            ]),
        ),
        "SecurityMarginCall",
        json!({"loan_id": "1", "ltv_bps": 4_294_967_295u32, "margin_call_ratio_bps": 8500, "cure_by": u64::MAX.to_string()}),
    );
    check(
        &raw(
            "price_stale",
            &[1],
            encode_map(vec![
                ("ltv_bps", ScVal::U32(13750)),
                ("margin_call_ratio_bps", ScVal::U32(8500)),
            ]),
        ),
        "SecurityPriceStale",
        json!({"loan_id": "1", "ltv_bps": 13750, "margin_call_ratio_bps": 8500}),
    );
    check(
        &raw(
            "margin_call_cured",
            &[1],
            encode_map(vec![("ltv_bps", ScVal::U32(5000))]),
        ),
        "SecurityMarginCallCured",
        json!({"loan_id": "1", "ltv_bps": 5000}),
    );
}

#[test]
fn inspection_events_decode_with_negative_variances() {
    check(
        &raw(
            "inspection_recorded",
            &[1, 5, 3],
            encode_map(vec![
                ("lot_id", ScVal::U32(9)),
                ("inspector", address_val(G_ADDR)),
                ("kind", enum_val("SamplingAssay")),
            ]),
        ),
        "SecurityInspectionRecorded",
        json!({"loan_id": "1", "record_id": "5", "inspection_id": "3", "lot_id": "9", "inspector": G_ADDR, "kind": "SamplingAssay"}),
    );
    for flagged in [true, false] {
        check(
            &raw(
                "inspection_approved",
                &[1, 5, 3],
                encode_map(vec![
                    ("approved_by", address_val(C_ADDR)),
                    ("variance_reference_bps", ScVal::I32(-250)),
                    ("variance_previous_bps", ScVal::I32(i32::MIN)),
                    ("variance_grade_bps", ScVal::I32(7)),
                    ("flagged", ScVal::Bool(flagged)),
                ]),
            ),
            "SecurityInspectionApproved",
            json!({
                "loan_id": "1", "record_id": "5", "inspection_id": "3", "approved_by": C_ADDR,
                "variance_reference_bps": -250, "variance_previous_bps": i32::MIN,
                "variance_grade_bps": 7, "flagged": flagged,
            }),
        );
    }
    check(
        &raw(
            "flag_resolved",
            &[1, 5],
            encode_map(vec![
                ("inspection_id", ScVal::U32(3)),
                ("outcome", enum_val("TopUpRequired")),
                ("reason_hash", bytes32(7)),
            ]),
        ),
        "SecurityFlagResolved",
        json!({"loan_id": "1", "record_id": "5", "inspection_id": "3", "outcome": "TopUpRequired", "reason_hash": hex32(7)}),
    );
}

#[test]
fn every_enum_variant_decodes() {
    for p in [
        "EndorsedBl",
        "WarehousePledge",
        "CollateralManagement",
        "AssignedReceivable",
        "LcProceeds",
        "CashCover",
        "Prepayment",
        "InsuranceLossPayee",
    ] {
        let log = dispatch_security_registry(&raw(
            "record_registered",
            &[1, 1],
            encode_map(vec![("lot_id", ScVal::U32(1)), ("protection", enum_val(p))]),
        ))
        .unwrap();
        assert_eq!(log.params["protection"], p);
    }
    for k in [
        "Ebl",
        "WarehouseReceipt",
        "Assay",
        "Insurance",
        "SupplyContract",
        "OfftakeContract",
        "NoticeOfAssignment",
        "LC",
        "Inspection",
        "LegalOpinion",
        "Perfection",
        "Proceeds",
        "Other",
    ] {
        let log = dispatch_security_registry(&raw(
            "doc_added",
            &[1, 1],
            encode_map(vec![("kind", enum_val(k)), ("sha256", bytes32(1))]),
        ))
        .unwrap();
        assert_eq!(log.params["kind"], k);
    }
    for k in [
        "LoadingTally",
        "DraftSurvey",
        "SamplingAssay",
        "DischargeSurvey",
        "StockCount",
    ] {
        let log = dispatch_security_registry(&raw(
            "inspection_recorded",
            &[1, 1, 1],
            encode_map(vec![
                ("lot_id", ScVal::U32(1)),
                ("inspector", address_val(G_ADDR)),
                ("kind", enum_val(k)),
            ]),
        ))
        .unwrap();
        assert_eq!(log.params["kind"], k);
    }
    for o in ["Accepted", "TopUpRequired", "Escalated"] {
        let log = dispatch_security_registry(&raw(
            "flag_resolved",
            &[1, 1],
            encode_map(vec![
                ("inspection_id", ScVal::U32(1)),
                ("outcome", enum_val(o)),
                ("reason_hash", bytes32(1)),
            ]),
        ))
        .unwrap();
        assert_eq!(log.params["outcome"], o);
    }
}

#[test]
fn consent_and_contract_events_decode() {
    check(
        &raw(
            "extension_consent",
            &[1],
            encode_map(vec![
                ("new_maturity", ScVal::U64(1_800_000_000)),
                ("consent_hash", bytes32(8)),
            ]),
        ),
        "SecurityExtensionConsent",
        json!({"loan_id": "1", "new_maturity": "1800000000", "consent_hash": hex32(8)}),
    );
    check(
        &raw(
            "inspectors_set",
            &[],
            encode_map(vec![("inspectors", vec_val(vec![]))]),
        ),
        "SecurityInspectorsSet",
        json!({"inspectors": []}),
    );
    check(
        &raw(
            "inspectors_set",
            &[],
            encode_map(vec![(
                "inspectors",
                vec_val(vec![address_val(G_ADDR), address_val(C_ADDR)]),
            )]),
        ),
        "SecurityInspectorsSet",
        json!({"inspectors": [G_ADDR, C_ADDR]}),
    );
    check(
        &raw(
            "loan_registry_set",
            &[],
            encode_map(vec![("loan_registry", address_val(C_ADDR))]),
        ),
        "SecurityLoanRegistrySet",
        json!({"loan_registry": C_ADDR}),
    );
    check(
        &raw("paused", &[], encode_map(vec![])),
        "SecurityRegistryPaused",
        json!({}),
    );
    check(
        &raw("unpaused", &[], encode_map(vec![])),
        "SecurityRegistryUnpaused",
        json!({}),
    );
}

#[test]
fn allow_listed_topics_are_dropped_without_a_decode_attempt() {
    let mint = raw("mint", &[], encode_map(vec![("token_id", ScVal::U32(4))]));
    let mut mint = mint;
    mint.topics_base64.push(b64(&address_val(G_ADDR)));
    let mut burn = raw("burn", &[], encode_map(vec![("token_id", ScVal::U32(4))]));
    burn.topics_base64.push(b64(&address_val(C_ADDR)));
    for ev in [&mint, &burn] {
        assert_eq!(
            classify_security_topic(&ev.event_name),
            SecurityTopic::AllowListed
        );
        assert!(dispatch_security_registry(ev).is_none());
    }
    for topic in [
        "ownership_transfer",
        "ownership_transfer_completed",
        "ownership_renounced",
    ] {
        assert_eq!(classify_security_topic(topic), SecurityTopic::AllowListed);
        assert!(dispatch_security_registry(&raw(topic, &[], encode_map(vec![]))).is_none());
    }
    assert_eq!(SECURITY_REGISTRY_ALLOW_LISTED_TOPICS.len(), 5);
}

#[test]
fn unknown_and_malformed_topics_are_dropped() {
    assert_eq!(
        classify_security_topic("something_new"),
        SecurityTopic::Unknown
    );
    assert!(dispatch_security_registry(&raw("something_new", &[], encode_map(vec![]))).is_none());

    assert!(
        dispatch_security_registry(&raw("record_perfected", &[1, 5], encode_map(vec![]))).is_none()
    );
    assert!(dispatch_security_registry(&raw(
        "record_perfected",
        &[1],
        encode_map(vec![("evidence_hash", bytes32(1))])
    ))
    .is_none());
    let short_hash = {
        let b: stellar_xdr::curr::BytesM = vec![1u8; 31].try_into().unwrap();
        ScVal::Bytes(stellar_xdr::curr::ScBytes(b))
    };
    assert!(dispatch_security_registry(&raw(
        "record_perfected",
        &[1, 5],
        encode_map(vec![("evidence_hash", short_hash)])
    ))
    .is_none());
    assert!(dispatch_security_registry(&raw(
        "margin_call",
        &[1],
        encode_map(vec![("ltv_bps", ScVal::U32(1))])
    ))
    .is_none());
    assert!(dispatch_security_registry(&raw(
        "inspectors_set",
        &[],
        encode_map(vec![("inspectors", vec_val(vec![ScVal::U32(1)]))])
    ))
    .is_none());
}

#[test]
fn topic_table_matches_the_shared_names() {
    assert_eq!(SECURITY_REGISTRY_EVENT_TOPICS.len(), 22);
    for (_, name) in SECURITY_REGISTRY_EVENT_TOPICS {
        assert!(is_security_registry_event(name), "{name}");
    }
    let stored: Vec<&str> = SECURITY_REGISTRY_EVENT_TOPICS
        .iter()
        .map(|(_, n)| *n)
        .collect();
    for name in SECURITY_LOAN_EVENT_NAMES
        .iter()
        .chain(SECURITY_CONTRACT_EVENT_NAMES.iter())
    {
        assert!(stored.contains(name), "{name}");
    }
    assert!(!is_security_registry_event("Revalued"));
}

#[test]
fn stored_names_collide_with_no_existing_name() {
    let legacy = [
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
    let loan = [
        "LoanDrawn",
        "LoanStatusUpdated",
        "LoanDefaulted",
        "LoanClosed",
        "PaymentRecorded",
        "PaymentUnrecorded",
        "LoanRolledOver",
        "EconomicsAmended",
        "Disbursed",
        "Undisbursed",
        "LoanWrittenDown",
        "InterestAdjusted",
    ];
    let others = [
        "WireIn",
        "WireInAssigned",
        "WireInReturned",
        "CashDisbursed",
        "CashDisbursementReversed",
        "CashRepaid",
        "CashRepaymentReversed",
        "WireOutRequested",
        "WireOutSettled",
        "WireOutCancelled",
        "RampOpened",
        "RampClosed",
        "CashRecorded",
        "MintCorrected",
        "LossAbsorbed",
        "MinterSnapshot",
        "DealRegistered",
        "DebtSynced",
        "CargoSynced",
        "DealTokenTransfer",
        "DepositRequested",
        "WithdrawalRequested",
        "RequestClaimed",
        "WithdrawalRateSet",
        "StakingDeposit",
        "StakingWithdrawal",
        "AssetTransfer",
    ];
    for (_, stored) in SECURITY_REGISTRY_EVENT_TOPICS {
        assert!(!legacy.contains(&stored), "{stored}");
        assert!(!loan.contains(&stored), "{stored}");
        assert!(!others.contains(&stored), "{stored}");
        assert!(!is_collateral_registry_event(stored), "{stored}");
        assert!(!is_loan_registry_event(stored), "{stored}");
        assert!(!is_pocket_event(stored), "{stored}");
        assert!(stored.starts_with("Security"));
        assert_ne!(stored, "DealRegistered");
        assert_ne!(stored, "AssetTransfer");
    }
    for (_, pocket) in POCKET_EVENT_TOPICS {
        assert!(!is_security_registry_event(pocket));
    }
    let mut names: Vec<&str> = SECURITY_REGISTRY_EVENT_TOPICS
        .iter()
        .map(|(_, n)| *n)
        .collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), 22);
}

#[test]
fn legacy_dispatcher_ignores_security_only_topics_and_still_parses_legacy_ones() {
    let ev = raw(
        "record_registered",
        &[1, 5],
        encode_map(vec![
            ("lot_id", ScVal::U32(9)),
            ("protection", enum_val("EndorsedBl")),
        ]),
    );
    assert!(dispatch_collateral_registry(&ev).is_none());
    let terms = raw("terms_set", &[1], terms_value(0));
    assert!(dispatch_collateral_registry(&terms).is_none());

    let legacy = raw(
        "haircut_set",
        &[1, 5],
        encode_map(vec![("bps", ScVal::U32(500))]),
    );
    let log = dispatch_collateral_registry(&legacy).unwrap();
    assert_eq!(log.event_name, "HaircutSet");
    assert_eq!(
        log.params,
        json!({"loan_id": "1", "lot_id": "5", "bps": 500})
    );
    assert_eq!(extract_u32(&b64(&ScVal::U32(3))), Some(3));
}
