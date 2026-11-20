// spec: docs/references/security-registry-events.md#event-table
#![allow(clippy::needless_pass_by_value)]
mod evm_security_support;

use alloy::primitives::{Address, B256, U256};
use alloy::rpc::types::Log;
use alloy::sol_types::SolEvent;
use evm_security_support::*;
use pipeline_worker::indexer::collateral_registry_parsers::parse_collateral_registry_log;
use pipeline_worker::indexer::parsers::*;
use pipeline_worker::indexer::security_registry_parsers::*;
use serde_json::{json, Value};
use shared::events::ContractLog;
use shared::security_registry::{
    is_security_registry_event, SECURITY_CONTRACT_EVENT_NAMES, SECURITY_LOAN_EVENT_NAMES,
};

fn check(ev: &Ev, emitter: Address, name: &str, params: Value) {
    let parsed = dispatch_security_registry(&ev.log, REGISTRY, NFT).expect(name);
    assert_eq!(parsed.event_name, name);
    assert_eq!(parsed.contract_address, emitter);
    assert_eq!(parsed.params, params, "{name}");
    assert_eq!(parsed.block_timestamp, 0);
}

fn bench(text: &[u8]) -> B256 {
    let mut b = [0u8; 32];
    b[..text.len()].copy_from_slice(text);
    B256::from(b)
}

#[test]
fn record_events_decode() {
    check(
        &registered(7, 12, 3, 1, 100, 0, 1),
        REGISTRY,
        "SecurityRecordRegistered",
        json!({"loan_id": "7", "record_id": "12", "lot_id": "3", "protection": "WarehousePledge"}),
    );
    check(
        &perfected(7, 12, 0xab, 100, 0, 2),
        REGISTRY,
        "SecurityRecordPerfected",
        json!({"loan_id": "7", "record_id": "12", "evidence_hash": hex32(0xab)}),
    );
    check(
        &handed_over(7, 12, 13, 0xcd, 100, 0, 3),
        REGISTRY,
        "SecurityRecordHandedOver",
        json!({"loan_id": "7", "from_record_id": "12", "to_record_id": "13", "evidence_hash": hex32(0xcd)}),
    );
    check(
        &ev(
            REGISTRY,
            &sr::RecordAttested {
                loanId: u(7),
                recordId: u(12),
                attestedBy: INSPECTOR,
            },
            100,
            0,
            4,
        ),
        REGISTRY,
        "SecurityRecordAttested",
        json!({"loan_id": "7", "record_id": "12", "attested_by": INSPECTOR_TEXT}),
    );
    check(
        &doc_added(7, 12, 2, 0x21, 100, 0, 5),
        NFT,
        "SecurityDocAdded",
        json!({"loan_id": "7", "record_id": "12", "kind": "Assay", "sha256": hex32(0x21)}),
    );
    check(
        &released(7, 12, 0x55, true, 100, 0, 6),
        REGISTRY,
        "SecurityRecordReleased",
        json!({"loan_id": "7", "record_id": "12", "reason_hash": hex32(0x55), "by_consent": true}),
    );
    check(
        &ev(
            REGISTRY,
            &sr::MandateBreach {
                loanId: u(7),
                evidenceHash: hash(0x31),
            },
            100,
            0,
            7,
        ),
        REGISTRY,
        "SecurityMandateBreach",
        json!({"loan_id": "7", "evidence_hash": hex32(0x31)}),
    );
    check(
        &ev(
            REGISTRY,
            &sr::EnforcementStarted {
                loanId: u(7),
                recordId: u(12),
            },
            100,
            0,
            8,
        ),
        REGISTRY,
        "SecurityEnforcementStarted",
        json!({"loan_id": "7", "record_id": "12"}),
    );
    check(
        &ev(
            REGISTRY,
            &sr::RecordEnforced {
                loanId: u(7),
                recordId: u(12),
                proceedsHash: hash(0x41),
            },
            100,
            0,
            9,
        ),
        REGISTRY,
        "SecurityRecordEnforced",
        json!({"loan_id": "7", "record_id": "12", "proceeds_hash": hex32(0x41)}),
    );
}

#[test]
fn terms_set_flattens_the_struct_with_the_evm_extras() {
    check(
        &ev(
            REGISTRY,
            &sr::TermsSet {
                loanId: u(7),
                terms: terms(1_790_000_005, 1_790_000_009, 2),
            },
            100,
            0,
            1,
        ),
        REGISTRY,
        "SecurityTermsSet",
        json!({
            "loan_id": "7",
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
            "margin_call_at": "1790000005",
            "payment_term": "Da",
            "default_ratio_bps": 9500,
            "originator_fee_rate": 25_000,
            "default_breach_at": "1790000009"
        }),
    );
}

const OLD_TERMS_TOPIC: &str = "0xafe2a37a11f39e6c1aabcfeee99c2838f1dca51206b72e457790877f82f19005";
const NEW_TERMS_TOPIC: &str = "0x35ef31a2f77f591c834f93ab744e2d6d2e96c49d289cda4237b7193b684365f0";

#[test]
fn terms_set_f92d719_stores_the_twelve_shared_keys_only() {
    let log = terms_set_f92d719(7, 0, 100, 0, 1);
    let parsed = dispatch_security_registry(&log.log, REGISTRY, NFT).unwrap();
    assert_eq!(parsed.event_name, "SecurityTermsSet");
    assert_eq!(
        parsed.params,
        json!({
            "loan_id": "7",
            "advance_ratio_bps": 6000,
            "margin_call_ratio_bps": 7500,
            "default_rate": 20_000,
            "tolerance_bps": 500,
            "grade_tolerance_bps": 200,
            "cure_period": "259200",
            "price_stale_after": "86400",
            "grace_period": "432000",
            "attestation_interval": "604800",
            "inspection_interval": "2592000",
            "margin_call_at": "0",
            "payment_term": "Dp"
        })
    );
    for key in [
        "default_ratio_bps",
        "originator_fee_rate",
        "default_breach_at",
    ] {
        assert!(parsed.params.get(key).is_none(), "{key}");
    }
}

#[test]
fn hoodi_topics_are_pinned() {
    let has = |topic: &str, name: &str| {
        SECURITY_REGISTRY_EVENT_TOPICS.iter().any(|(e, t, n)| {
            *e == SecurityEmitter::Registry && format!("{t:#x}") == topic && *n == name
        })
    };
    assert!(has(OLD_TERMS_TOPIC, "SecurityTermsSet"));
    assert!(has(NEW_TERMS_TOPIC, "SecurityTermsSet"));
    assert_eq!(
        format!("{:#x}", sr_f92d719::TermsSet::SIGNATURE_HASH),
        OLD_TERMS_TOPIC
    );
    assert!(has(
        "0x37628b827703d616bfd00f47e8d13ecabe347fa729ad6abf0724235fbe934ecb",
        "SecurityDefaultBreach"
    ));
    assert!(has(
        "0xed206567f71e87007acd11d033569eff156928e672e2d81a3c9c19872997cea7",
        "SecurityDefaultBreachPriceStale"
    ));
    assert!(has(
        "0xa6f25b5ed69f7384a6b641cd7ca5aede8fdfcd848bac4ae4d25897129be9e1e0",
        "SecurityDefaultBreachCleared"
    ));
}

#[test]
fn a_terms_set_blob_under_the_other_shapes_topic_fails_to_decode() {
    let old = terms_set_f92d719(7, 0, 100, 0, 1).log;
    let new = terms_set(7, 0, 100, 0, 2).log;
    let relabel = |log: &Log, topic0: B256| {
        let mut topics = log.inner.data.topics().to_vec();
        topics[0] = topic0;
        log_data(topics, log.inner.data.data.to_vec(), REGISTRY, 100, 3)
    };
    let old_under_new = relabel(&old, sr::TermsSet::SIGNATURE_HASH);
    let new_under_old = relabel(&new, sr_f92d719::TermsSet::SIGNATURE_HASH);
    assert!(dispatch_security_registry(&old_under_new, REGISTRY, NFT).is_none());
    assert!(dispatch_security_registry(&new_under_old, REGISTRY, NFT).is_none());
    assert!(parse_security_event(&old, SecurityEmitter::Registry).is_some());
    assert!(parse_security_event(&new, SecurityEmitter::Registry).is_some());
}

#[test]
fn revalued_and_margin_events_decode() {
    check(
        &revalued(7, 12, 5_000_000, 100, 0, 1),
        REGISTRY,
        "SecurityRevalued",
        json!({"loan_id": "7", "record_id": "12", "value_per_unit": "5000000", "benchmark": "LME", "report_hash": hex32(0x64)}),
    );
    let par = ev(
        REGISTRY,
        &sr::Revalued {
            loanId: u(7),
            recordId: u(12),
            valuePerUnit: u(1_000_000),
            benchmark: bench(b"PAR"),
            reportHash: B256::ZERO,
        },
        100,
        0,
        2,
    );
    check(
        &par,
        REGISTRY,
        "SecurityRevalued",
        json!({"loan_id": "7", "record_id": "12", "value_per_unit": "1000000", "benchmark": "PAR", "report_hash": hex32(0)}),
    );
    check(
        &margin_call(7, 9000, 1_790_604_800, 100, 0, 3),
        REGISTRY,
        "SecurityMarginCall",
        json!({"loan_id": "7", "ltv_bps": 9000, "margin_call_ratio_bps": 8500, "cure_by": "1790604800"}),
    );
    check(
        &price_stale(7, 9000, 100, 0, 4),
        REGISTRY,
        "SecurityPriceStale",
        json!({"loan_id": "7", "ltv_bps": 9000, "margin_call_ratio_bps": 8500}),
    );
    check(
        &cured(7, 8000, 100, 0, 5),
        REGISTRY,
        "SecurityMarginCallCured",
        json!({"loan_id": "7", "ltv_bps": 8000}),
    );
    check(
        &default_breach(7, 9700, 100, 0, 6),
        REGISTRY,
        "SecurityDefaultBreach",
        json!({"loan_id": "7", "ltv_bps": 9700, "default_ratio_bps": 9500}),
    );
    check(
        &default_breach_price_stale(7, 9700, 100, 0, 7),
        REGISTRY,
        "SecurityDefaultBreachPriceStale",
        json!({"loan_id": "7", "ltv_bps": 9700, "default_ratio_bps": 9500}),
    );
    check(
        &default_breach_cleared(7, 9000, 100, 0, 8),
        REGISTRY,
        "SecurityDefaultBreachCleared",
        json!({"loan_id": "7", "ltv_bps": 9000}),
    );
}

#[test]
fn inspection_events_decode_with_negative_variances() {
    check(
        &inspection_recorded(7, 12, 4, 3, 4, 100, 0, 1),
        NFT,
        "SecurityInspectionRecorded",
        json!({
            "loan_id": "7", "record_id": "12", "inspection_id": "4", "lot_id": "3",
            "inspector": INSPECTOR_TEXT, "kind": "StockCount"
        }),
    );
    check(
        &inspection_approved(7, 12, 4, true, 100, 0, 2),
        NFT,
        "SecurityInspectionApproved",
        json!({
            "loan_id": "7", "record_id": "12", "inspection_id": "4",
            "approved_by": APPROVER_TEXT,
            "variance_reference_bps": -250, "variance_previous_bps": 0, "variance_grade_bps": 0,
            "flagged": true
        }),
    );
    check(
        &flag_resolved(7, 12, 4, 1, 100, 0, 3),
        REGISTRY,
        "SecurityFlagResolved",
        json!({"loan_id": "7", "record_id": "12", "inspection_id": "4", "outcome": "TopUpRequired", "reason_hash": hex32(0x77)}),
    );
}

#[test]
fn consent_and_contract_events_decode() {
    check(
        &extension_consent(7, 1_800_000_000, 0x09, 100, 0, 1),
        REGISTRY,
        "SecurityExtensionConsent",
        json!({"loan_id": "7", "new_maturity": "1800000000", "consent_hash": hex32(9)}),
    );
    check(
        &ev(
            NFT,
            &sr::InspectorsSet {
                inspectors: vec![INSPECTOR, APPROVER],
            },
            100,
            0,
            2,
        ),
        NFT,
        "SecurityInspectorsSet",
        json!({"inspectors": [INSPECTOR_TEXT, APPROVER_TEXT]}),
    );
    check(
        &ev(NFT, &sr::InspectorsSet { inspectors: vec![] }, 100, 0, 3),
        NFT,
        "SecurityInspectorsSet",
        json!({"inspectors": []}),
    );
    check(
        &ev(
            REGISTRY,
            &sr::LoanRegistrySet {
                loanRegistry: LOAN_REGISTRY,
            },
            100,
            0,
            4,
        ),
        REGISTRY,
        "SecurityLoanRegistrySet",
        json!({"loan_registry": "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"}),
    );
    check(
        &ev(REGISTRY, &sr::Paused { account: APPROVER }, 100, 0, 5),
        REGISTRY,
        "SecurityRegistryPaused",
        json!({}),
    );
    check(
        &ev(REGISTRY, &sr::Unpaused { account: APPROVER }, 100, 0, 6),
        REGISTRY,
        "SecurityRegistryUnpaused",
        json!({}),
    );
}

#[test]
fn ids_above_u32_are_stored_verbatim() {
    let big = U256::from(u64::MAX) + U256::from(1u8);
    let log = ev(
        REGISTRY,
        &sr::RecordPerfected {
            loanId: big,
            recordId: u(1),
            evidenceHash: hash(1),
        },
        100,
        0,
        1,
    );
    let parsed = dispatch_security_registry(&log.log, REGISTRY, NFT).unwrap();
    assert_eq!(parsed.params["loan_id"], "18446744073709551616");
}

#[test]
fn the_same_log_from_a_third_address_is_ignored() {
    let log = perfected(7, 12, 1, 100, 0, 1).log;
    let mut moved = log.clone();
    moved.inner.address = OTHER;
    assert!(dispatch_security_registry(&log, REGISTRY, NFT).is_some());
    assert!(dispatch_security_registry(&moved, REGISTRY, NFT).is_none());
}

#[test]
fn an_nft_topic_from_the_registry_and_the_reverse_is_unrecognised() {
    let nft_event = doc_added(7, 12, 2, 1, 100, 0, 1).log;
    let mut from_registry = nft_event.clone();
    from_registry.inner.address = REGISTRY;
    assert!(dispatch_security_registry(&from_registry, REGISTRY, NFT).is_none());
    let registry_event = perfected(7, 12, 1, 100, 0, 2).log;
    let mut from_nft = registry_event;
    from_nft.inner.address = NFT;
    assert!(dispatch_security_registry(&from_nft, REGISTRY, NFT).is_none());
}

fn topic_only(emitter: Address, topic: B256) -> Log {
    log_data(vec![topic], vec![], emitter, 100, 1)
}

#[test]
fn allow_listed_topics_are_dropped_without_a_decode_attempt() {
    assert_eq!(SECURITY_REGISTRY_ALLOW_LISTED_TOPICS.len(), 10);
    for (emitter, topic) in SECURITY_REGISTRY_ALLOW_LISTED_TOPICS {
        assert_eq!(
            classify_security_topic(emitter, &topic),
            SecurityTopic::AllowListed
        );
        let address = match emitter {
            SecurityEmitter::Registry => REGISTRY,
            SecurityEmitter::RecordNft => NFT,
        };
        assert!(dispatch_security_registry(&topic_only(address, topic), REGISTRY, NFT).is_none());
    }
    let nft_only = [
        sr::Transfer::SIGNATURE_HASH,
        sr::Approval::SIGNATURE_HASH,
        sr::ApprovalForAll::SIGNATURE_HASH,
        sr::SecurityRegistrySet::SIGNATURE_HASH,
    ];
    for topic in nft_only {
        assert_eq!(
            classify_security_topic(SecurityEmitter::Registry, &topic),
            SecurityTopic::Unknown
        );
    }
}

#[test]
fn unknown_and_malformed_topics_are_dropped() {
    let unknown = B256::repeat_byte(0xee);
    for emitter in [SecurityEmitter::Registry, SecurityEmitter::RecordNft] {
        assert_eq!(
            classify_security_topic(emitter, &unknown),
            SecurityTopic::Unknown
        );
    }
    assert!(dispatch_security_registry(&topic_only(REGISTRY, unknown), REGISTRY, NFT).is_none());

    let good = perfected(7, 12, 1, 100, 0, 1).log;
    let (topics, data) = (
        good.inner.data.topics().to_vec(),
        good.inner.data.data.to_vec(),
    );
    let truncated = log_data(topics.clone(), data[..10].to_vec(), REGISTRY, 100, 1);
    assert!(dispatch_security_registry(&truncated, REGISTRY, NFT).is_none());
    let missing_topic = log_data(topics[..2].to_vec(), data, REGISTRY, 100, 1);
    assert!(dispatch_security_registry(&missing_topic, REGISTRY, NFT).is_none());

    let mut no_meta = good;
    no_meta.block_number = None;
    assert!(dispatch_security_registry(&no_meta, REGISTRY, NFT).is_none());
}

#[test]
fn every_enum_name_table_covers_its_variants_and_unknown() {
    type NameCase<'a> = (fn(u8) -> &'static str, &'a [&'a str]);
    let cases: [NameCase; 9] = [
        (
            protection_name,
            &[
                "EndorsedBl",
                "WarehousePledge",
                "CollateralManagement",
                "AssignedReceivable",
                "LcProceeds",
                "CashCover",
                "Prepayment",
                "InsuranceLossPayee",
            ],
        ),
        (unit_name, &["Dmt", "Mt", "Bbl", "Usd"]),
        (
            record_status_name,
            &[
                "PendingPerfection",
                "Active",
                "Released",
                "UnderEnforcement",
                "Enforced",
            ],
        ),
        (payment_term_name, &["Lc", "Dp", "Da", "OpenAccount"]),
        (
            flag_outcome_name,
            &["Accepted", "TopUpRequired", "Escalated"],
        ),
        (
            control_kind_name,
            &["Agent", "CollateralManager", "StockMonitor", "Bank"],
        ),
        (
            perfection_name,
            &["Endorsement", "Registration", "NoticeAndAcknowledgment"],
        ),
        (
            doc_kind_name,
            &[
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
            ],
        ),
        (
            inspection_kind_name,
            &[
                "LoadingTally",
                "DraftSurvey",
                "SamplingAssay",
                "DischargeSurvey",
                "StockCount",
            ],
        ),
    ];
    for (name_of, variants) in cases {
        for (i, v) in variants.iter().enumerate() {
            assert_eq!(name_of(i as u8), *v);
        }
        assert_eq!(name_of(variants.len() as u8), "Unknown");
        assert_eq!(name_of(255), "Unknown");
    }
}

#[test]
fn an_out_of_range_enum_is_stored_as_unknown() {
    check(
        &registered(7, 12, 3, 99, 100, 0, 1),
        REGISTRY,
        "SecurityRecordRegistered",
        json!({"loan_id": "7", "record_id": "12", "lot_id": "3", "protection": "Unknown"}),
    );
}

const FORGE_TOPICS: [(&str, &str); 26] = [
    (
        "SecurityRecordRegistered",
        "0x51c795991f7e40cbfd5cc4ff1e0ff1230b1d6b9494f2d5411d062ea15e2dd14f",
    ),
    (
        "SecurityRecordPerfected",
        "0xd35296661f9ae881f87dbd98d7ee741d6bbc865f9884f3c1bc308eea5ae2d733",
    ),
    (
        "SecurityRecordHandedOver",
        "0xf7441ee3b45dd435dd8e397992609232e86c1af6a338e37f799d557f7b530631",
    ),
    (
        "SecurityRecordAttested",
        "0x2f0ddc390c09945275434a7b7560f3d6bc91a80a5eba9a1aaef36c85ef3a90d5",
    ),
    (
        "SecurityDocAdded",
        "0x50d3527213b8ac059cb03a5ce6f55b3d86df514b981e47b560a48958f94d6a9b",
    ),
    (
        "SecurityRecordReleased",
        "0x31022311673fde9ec01226840af4caefbb6973dcd2bd3409c7b2e018974cd491",
    ),
    (
        "SecurityMandateBreach",
        "0x38f5081cf17982c7c65f5e4cb66b0c1154c524d31b8d44b43db3229a70a08387",
    ),
    (
        "SecurityEnforcementStarted",
        "0x14ef0a32a2dc69b1865add5cce3232420435d2c106907253bcefc628354b65ac",
    ),
    (
        "SecurityRecordEnforced",
        "0x1b360236a9cca516b2de4bd547a69a396b19d60086c8aa5b061977b5f05a5fbf",
    ),
    (
        "SecurityTermsSet",
        "0x35ef31a2f77f591c834f93ab744e2d6d2e96c49d289cda4237b7193b684365f0",
    ),
    (
        "SecurityTermsSet",
        "0xafe2a37a11f39e6c1aabcfeee99c2838f1dca51206b72e457790877f82f19005",
    ),
    (
        "SecurityRevalued",
        "0x64f678ef6df63efb0f6d3ba04efdc4c09766e05ac65b3fcfcf189f32df3f4482",
    ),
    (
        "SecurityMarginCall",
        "0x5131386fd34b702ef7635a88fbfb07567f6a28251dd470a69f971d18e4bb0835",
    ),
    (
        "SecurityPriceStale",
        "0xbb5ab5bde667fbd578834a2513b50dad5c3592847091bb1107cb3f892300d9f9",
    ),
    (
        "SecurityMarginCallCured",
        "0x5fdcfd5a4a172d24d6267861ce0dee18fa593f1ab0c11fb601c060818bedfbee",
    ),
    (
        "SecurityDefaultBreach",
        "0x37628b827703d616bfd00f47e8d13ecabe347fa729ad6abf0724235fbe934ecb",
    ),
    (
        "SecurityDefaultBreachPriceStale",
        "0xed206567f71e87007acd11d033569eff156928e672e2d81a3c9c19872997cea7",
    ),
    (
        "SecurityDefaultBreachCleared",
        "0xa6f25b5ed69f7384a6b641cd7ca5aede8fdfcd848bac4ae4d25897129be9e1e0",
    ),
    (
        "SecurityInspectionRecorded",
        "0x761da8f1049e0723a381ab3b2b2656944000382e6f417eab730beba7b8c41a9b",
    ),
    (
        "SecurityInspectionApproved",
        "0x40cf2919d1a1046bb4a7323bfd0173912bbcf75ac67b37d9569d4f62b28a2abb",
    ),
    (
        "SecurityFlagResolved",
        "0xcec9e6c524244045a86f2240eb5b553d2d9a13f2ad17606857c4dec804a08113",
    ),
    (
        "SecurityExtensionConsent",
        "0x34f4253ed06a26685954d4b2cc2221a91661c7cc385e4c14aea326aaaa00bd51",
    ),
    (
        "SecurityInspectorsSet",
        "0xe4ba83f424b0d3e26c9b2a83338a04f27febdc52f625a68e86519b7fce6a1178",
    ),
    (
        "SecurityLoanRegistrySet",
        "0xd4cdfbce98c888924938e49bf7a5fc115039dc8d14679bf83d435af2bf2b5b8c",
    ),
    (
        "SecurityRegistryPaused",
        "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258",
    ),
    (
        "SecurityRegistryUnpaused",
        "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa",
    ),
];

const FORGE_ALLOW_LISTED: [&str; 7] = [
    "0xc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d2",
    "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b",
    "0x2f658b440c35314f52658ea8a740e05b284cdc84dc9ae01e891f21b8933e7cad",
    "0x570a99c1708087b83bd449828e1d8d28c6500f1a611a1abcbf327fb22ee0936a",
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
    "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31",
];

#[test]
fn topic_hashes_match_forge_inspect_at_both_commits() {
    for (name, topic) in FORGE_TOPICS {
        assert!(
            SECURITY_REGISTRY_EVENT_TOPICS
                .iter()
                .any(|(_, t, n)| *n == name && format!("{t:#x}") == topic),
            "{name} {topic}"
        );
    }
    for topic in FORGE_ALLOW_LISTED {
        assert!(
            SECURITY_REGISTRY_ALLOW_LISTED_TOPICS
                .iter()
                .any(|(_, t)| format!("{t:#x}") == topic),
            "{topic}"
        );
    }
}

#[test]
fn topic_table_matches_the_shared_names() {
    assert_eq!(SECURITY_REGISTRY_EVENT_TOPICS.len(), 26);
    for (_, _, name) in SECURITY_REGISTRY_EVENT_TOPICS {
        assert!(is_security_registry_event(name), "{name}");
    }
    let stored: Vec<&str> = SECURITY_REGISTRY_EVENT_TOPICS
        .iter()
        .map(|(_, _, n)| *n)
        .collect();
    for name in SECURITY_LOAN_EVENT_NAMES
        .iter()
        .chain(SECURITY_CONTRACT_EVENT_NAMES.iter())
    {
        assert!(stored.contains(name), "{name}");
    }
    let nft: Vec<&str> = SECURITY_REGISTRY_EVENT_TOPICS
        .iter()
        .filter(|(e, _, _)| *e == SecurityEmitter::RecordNft)
        .map(|(_, _, n)| *n)
        .collect();
    assert_eq!(
        nft,
        vec![
            "SecurityDocAdded",
            "SecurityInspectionRecorded",
            "SecurityInspectionApproved",
            "SecurityInspectorsSet"
        ]
    );
    assert!(!is_security_registry_event("Revalued"));
}

#[test]
fn no_topic_is_duplicated() {
    let mut topics: Vec<B256> = SECURITY_REGISTRY_EVENT_TOPICS
        .iter()
        .map(|(_, t, _)| *t)
        .collect();
    topics.sort();
    topics.dedup();
    assert_eq!(topics.len(), 26);
    let mut names: Vec<&str> = SECURITY_REGISTRY_EVENT_TOPICS
        .iter()
        .map(|(_, _, n)| *n)
        .collect();
    names.sort_unstable();
    let total = names.len();
    names.dedup();
    assert_eq!(names.len(), 25);
    assert_eq!(total - names.len(), 1);
    let twice: Vec<_> = SECURITY_REGISTRY_EVENT_TOPICS
        .iter()
        .filter(|(_, _, n)| *n == "SecurityTermsSet")
        .collect();
    assert_eq!(twice.len(), 2);
}

fn all_logs() -> Vec<Log> {
    vec![
        registered(7, 12, 3, 1, 100, 0, 1).log,
        perfected(7, 12, 1, 100, 0, 2).log,
        handed_over(7, 12, 13, 1, 100, 0, 3).log,
        doc_added(7, 12, 2, 1, 100, 0, 4).log,
        released(7, 12, 1, false, 100, 0, 5).log,
        terms_set(7, 0, 100, 0, 6).log,
        terms_set_f92d719(7, 0, 100, 0, 22).log,
        revalued(7, 12, 1, 100, 0, 7).log,
        margin_call(7, 1, 1, 100, 0, 8).log,
        price_stale(7, 1, 100, 0, 9).log,
        cured(7, 1, 100, 0, 10).log,
        default_breach(7, 1, 100, 0, 11).log,
        default_breach_price_stale(7, 1, 100, 0, 12).log,
        default_breach_cleared(7, 1, 100, 0, 13).log,
        inspection_recorded(7, 12, 4, 3, 0, 100, 0, 14).log,
        inspection_approved(7, 12, 4, false, 100, 0, 15).log,
        flag_resolved(7, 12, 4, 0, 100, 0, 16).log,
        extension_consent(7, 1, 1, 100, 0, 17).log,
        log_of(NFT, &sr::InspectorsSet { inspectors: vec![] }, 100, 18),
        log_of(REGISTRY, &sr::Paused { account: OTHER }, 100, 19),
        log_of(REGISTRY, &sr::Unpaused { account: OTHER }, 100, 20),
        log_of(
            REGISTRY,
            &sr::LoanRegistrySet {
                loanRegistry: LOAN_REGISTRY,
            },
            100,
            21,
        ),
    ]
}

#[test]
fn the_unfiltered_evm_parsers_decode_none_of_the_security_topics() {
    type Parser = fn(&Log) -> Option<ContractLog>;
    let parsers: [Parser; 17] = [
        parse_deposit_requested,
        parse_withdrawal_requested,
        parse_request_claimed,
        parse_staking_deposit,
        parse_staking_withdraw,
        parse_loan_drawn,
        parse_loan_defaulted,
        parse_loan_closed,
        parse_payment_recorded,
        parse_payment_unrecorded,
        parse_loan_status_updated,
        parse_disbursed,
        parse_undisbursed,
        parse_loan_written_down,
        parse_interest_adjusted,
        parse_loan_rolled_over,
        parse_economics_amended,
    ];
    for log in all_logs() {
        for parser in parsers {
            assert!(parser(&log).is_none(), "{:?}", log.topic0());
        }
    }
}

#[test]
fn the_legacy_collateral_parser_ignores_security_only_topics_and_keeps_legacy_ones() {
    for log in all_logs() {
        let is_shared = matches!(
            dispatch_security_registry(&log, REGISTRY, NFT)
                .map(|l| l.event_name)
                .as_deref(),
            Some("SecurityRevalued" | "SecurityDocAdded")
        );
        let parsed = parse_collateral_registry_log(&log);
        assert_eq!(parsed.is_some(), is_shared, "{:?}", log.topic0());
    }
}

#[test]
fn the_security_only_trap_warns_without_panicking() {
    for log in all_logs() {
        warn_if_security_registry_topic(&log);
    }
    warn_if_security_registry_topic(&topic_only(OTHER, B256::repeat_byte(0x01)));
    let mut no_topics = perfected(1, 1, 1, 1, 0, 1).log;
    no_topics.inner.data = alloy::primitives::LogData::new_unchecked(vec![], vec![].into());
    warn_if_security_registry_topic(&no_topics);
}

#[test]
fn the_security_only_trap_excludes_topics_shared_with_the_legacy_registry() {
    for (topic, expected) in [
        (sr::Revalued::SIGNATURE_HASH, false),
        (sr::DocAdded::SIGNATURE_HASH, false),
        (sr::LoanRegistrySet::SIGNATURE_HASH, false),
        (sr::Paused::SIGNATURE_HASH, false),
        (sr::Unpaused::SIGNATURE_HASH, false),
        (sr::TermsSet::SIGNATURE_HASH, true),
        (sr_f92d719::TermsSet::SIGNATURE_HASH, true),
    ] {
        assert_eq!(is_security_only_topic(&topic), expected, "{topic}");
    }
}

#[test]
fn the_index_path_is_a_pure_synchronous_function() {
    let _: fn(&Log, Address, Address) -> Option<ContractLog> = dispatch_security_registry;
    let _: fn(&Log, SecurityEmitter) -> Option<ContractLog> = parse_security_event;
}
