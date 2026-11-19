// spec: docs/references/security-registry-events.md#event-table
use std::sync::atomic::{AtomicBool, Ordering};

use alloy::primitives::{Address, B256};
use alloy::rpc::types::Log;
use alloy::sol_types::SolEvent;
use anyhow::{bail, Result};
use serde_json::{json, Value};

use shared::events::ContractLog;

use crate::indexer::collateral_registry_parsers::benchmark_string;
use crate::indexer::parsers::extract_log_meta;
pub use crate::indexer::security_registry_sync::SecurityTopic;

pub mod sr {
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
        event RecordRegistered(uint256 indexed loanId, uint256 indexed recordId, uint256 lotId, uint8 protection);
        event RecordPerfected(uint256 indexed loanId, uint256 indexed recordId, bytes32 evidenceHash);
        event RecordHandedOver(uint256 indexed loanId, uint256 indexed fromRecordId, uint256 indexed toRecordId, bytes32 evidenceHash);
        event RecordAttested(uint256 indexed loanId, uint256 indexed recordId, address attestedBy);
        event RecordReleased(uint256 indexed loanId, uint256 indexed recordId, bytes32 reasonHash, bool byConsent);
        event MandateBreach(uint256 indexed loanId, bytes32 evidenceHash);
        event EnforcementStarted(uint256 indexed loanId, uint256 indexed recordId);
        event RecordEnforced(uint256 indexed loanId, uint256 indexed recordId, bytes32 proceedsHash);
        event TermsSet(uint256 indexed loanId, Terms terms);
        event Revalued(uint256 indexed loanId, uint256 indexed recordId, uint256 valuePerUnit, bytes32 benchmark, bytes32 reportHash);
        event MarginCall(uint256 indexed loanId, uint32 ltvBps, uint32 marginCallRatioBps, uint256 cureBy);
        event PriceStale(uint256 indexed loanId, uint32 ltvBps, uint32 marginCallRatioBps);
        event MarginCallCured(uint256 indexed loanId, uint32 ltvBps);
        event DefaultBreach(uint256 indexed loanId, uint32 ltvBps, uint32 defaultRatioBps);
        event DefaultBreachPriceStale(uint256 indexed loanId, uint32 ltvBps, uint32 defaultRatioBps);
        event DefaultBreachCleared(uint256 indexed loanId, uint32 ltvBps);
        event FlagResolved(uint256 indexed loanId, uint256 indexed recordId, uint256 inspectionId, uint8 outcome, bytes32 reasonHash);
        event ExtensionConsent(uint256 indexed loanId, uint64 newMaturity, bytes32 consentHash);
        event LoanRegistrySet(address loanRegistry);
        event Paused(address account);
        event Unpaused(address account);
        event DocAdded(uint256 indexed loanId, uint256 indexed recordId, uint8 kind, bytes32 hash);
        event InspectionRecorded(uint256 indexed loanId, uint256 indexed recordId, uint256 indexed inspectionId, uint256 lotId, address inspector, uint8 kind);
        event InspectionApproved(uint256 indexed loanId, uint256 indexed recordId, uint256 indexed inspectionId, address approvedBy, int32 varianceReferenceBps, int32 variancePreviousBps, int32 varianceGradeBps, bool flagged);
        event InspectorsSet(address[] inspectors);
        event Initialized(uint64 version);
        event Upgraded(address indexed implementation);
        event AuthorityUpdated(address authority);
        event SecurityRegistrySet(address securityRegistry);
        event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
        event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
        event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    }
}

pub mod sr_f92d719 {
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
        event TermsSet(uint256 indexed loanId, Terms terms);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityEmitter {
    Registry,
    RecordNft,
}

pub fn protection_name(v: u8) -> &'static str {
    match v {
        0 => "EndorsedBl",
        1 => "WarehousePledge",
        2 => "CollateralManagement",
        3 => "AssignedReceivable",
        4 => "LcProceeds",
        5 => "CashCover",
        6 => "Prepayment",
        7 => "InsuranceLossPayee",
        _ => "Unknown",
    }
}

pub fn unit_name(v: u8) -> &'static str {
    match v {
        0 => "Dmt",
        1 => "Mt",
        2 => "Bbl",
        3 => "Usd",
        _ => "Unknown",
    }
}

pub fn record_status_name(v: u8) -> &'static str {
    match v {
        0 => "PendingPerfection",
        1 => "Active",
        2 => "Released",
        3 => "UnderEnforcement",
        4 => "Enforced",
        _ => "Unknown",
    }
}

pub fn payment_term_name(v: u8) -> &'static str {
    match v {
        0 => "Lc",
        1 => "Dp",
        2 => "Da",
        3 => "OpenAccount",
        _ => "Unknown",
    }
}

pub fn flag_outcome_name(v: u8) -> &'static str {
    match v {
        0 => "Accepted",
        1 => "TopUpRequired",
        2 => "Escalated",
        _ => "Unknown",
    }
}

pub fn control_kind_name(v: u8) -> &'static str {
    match v {
        0 => "Agent",
        1 => "CollateralManager",
        2 => "StockMonitor",
        3 => "Bank",
        _ => "Unknown",
    }
}

pub fn perfection_name(v: u8) -> &'static str {
    match v {
        0 => "Endorsement",
        1 => "Registration",
        2 => "NoticeAndAcknowledgment",
        _ => "Unknown",
    }
}

pub fn doc_kind_name(v: u8) -> &'static str {
    match v {
        0 => "Ebl",
        1 => "WarehouseReceipt",
        2 => "Assay",
        3 => "Insurance",
        4 => "SupplyContract",
        5 => "OfftakeContract",
        6 => "NoticeOfAssignment",
        7 => "LC",
        8 => "Inspection",
        9 => "LegalOpinion",
        10 => "Perfection",
        11 => "Proceeds",
        12 => "Other",
        _ => "Unknown",
    }
}

pub fn inspection_kind_name(v: u8) -> &'static str {
    match v {
        0 => "LoadingTally",
        1 => "DraftSurvey",
        2 => "SamplingAssay",
        3 => "DischargeSurvey",
        4 => "StockCount",
        _ => "Unknown",
    }
}

type Decode = fn(&Log) -> Option<Value>;

struct Spec {
    emitter: SecurityEmitter,
    topic: B256,
    name: &'static str,
    decode: Decode,
}

fn dec<E: SolEvent>(log: &Log) -> Option<E> {
    E::decode_log(log.as_ref(), true).ok().map(|d| d.data)
}

fn id(v: alloy::primitives::U256) -> Value {
    json!(v.to_string())
}

fn hash(v: &B256) -> Value {
    json!(hex::encode(v.as_slice()))
}

fn addr(v: &Address) -> Value {
    json!(v.to_checksum(None))
}

#[derive(Clone, Copy)]
struct SharedTerms {
    advance_ratio_bps: u32,
    margin_call_ratio_bps: u32,
    default_rate: u32,
    tolerance_bps: u32,
    grade_tolerance_bps: u32,
    cure_period: u64,
    price_stale_after: u64,
    grace_period: u64,
    attestation_interval: u64,
    inspection_interval: u64,
    margin_call_at: u64,
    payment_term: u8,
}

fn shared_terms_keys(loan_id: alloy::primitives::U256, t: SharedTerms) -> Value {
    json!({
        "loan_id": id(loan_id),
        "advance_ratio_bps": t.advance_ratio_bps,
        "margin_call_ratio_bps": t.margin_call_ratio_bps,
        "default_rate": t.default_rate,
        "tolerance_bps": t.tolerance_bps,
        "grade_tolerance_bps": t.grade_tolerance_bps,
        "cure_period": t.cure_period.to_string(),
        "price_stale_after": t.price_stale_after.to_string(),
        "grace_period": t.grace_period.to_string(),
        "attestation_interval": t.attestation_interval.to_string(),
        "inspection_interval": t.inspection_interval.to_string(),
        "margin_call_at": t.margin_call_at.to_string(),
        "payment_term": payment_term_name(t.payment_term),
    })
}

const REGISTRY: SecurityEmitter = SecurityEmitter::Registry;
const NFT: SecurityEmitter = SecurityEmitter::RecordNft;

pub const SECURITY_REGISTRY_EVENT_TOPICS: [(SecurityEmitter, B256, &str); 26] = derive_topics();

const fn derive_topics() -> [(SecurityEmitter, B256, &'static str); 26] {
    let mut out = [(REGISTRY, B256::ZERO, ""); 26];
    let mut i = 0;
    while i < 26 {
        out[i] = (SPECS[i].emitter, SPECS[i].topic, SPECS[i].name);
        i += 1;
    }
    out
}

pub const SECURITY_REGISTRY_ALLOW_LISTED_TOPICS: [(SecurityEmitter, B256); 10] = [
    (REGISTRY, sr::Initialized::SIGNATURE_HASH),
    (REGISTRY, sr::Upgraded::SIGNATURE_HASH),
    (REGISTRY, sr::AuthorityUpdated::SIGNATURE_HASH),
    (NFT, sr::Initialized::SIGNATURE_HASH),
    (NFT, sr::Upgraded::SIGNATURE_HASH),
    (NFT, sr::AuthorityUpdated::SIGNATURE_HASH),
    (NFT, sr::SecurityRegistrySet::SIGNATURE_HASH),
    (NFT, sr::Transfer::SIGNATURE_HASH),
    (NFT, sr::Approval::SIGNATURE_HASH),
    (NFT, sr::ApprovalForAll::SIGNATURE_HASH),
];

const SPECS: [Spec; 26] = [
    Spec {
        emitter: REGISTRY,
        topic: sr::RecordRegistered::SIGNATURE_HASH,
        name: "SecurityRecordRegistered",
        decode: |log| {
            let d = dec::<sr::RecordRegistered>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "lot_id": id(d.lotId),
                "protection": protection_name(d.protection),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::RecordPerfected::SIGNATURE_HASH,
        name: "SecurityRecordPerfected",
        decode: |log| {
            let d = dec::<sr::RecordPerfected>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "evidence_hash": hash(&d.evidenceHash),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::RecordHandedOver::SIGNATURE_HASH,
        name: "SecurityRecordHandedOver",
        decode: |log| {
            let d = dec::<sr::RecordHandedOver>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "from_record_id": id(d.fromRecordId),
                "to_record_id": id(d.toRecordId),
                "evidence_hash": hash(&d.evidenceHash),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::RecordAttested::SIGNATURE_HASH,
        name: "SecurityRecordAttested",
        decode: |log| {
            let d = dec::<sr::RecordAttested>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "attested_by": addr(&d.attestedBy),
            }))
        },
    },
    Spec {
        emitter: NFT,
        topic: sr::DocAdded::SIGNATURE_HASH,
        name: "SecurityDocAdded",
        decode: |log| {
            let d = dec::<sr::DocAdded>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "kind": doc_kind_name(d.kind),
                "sha256": hash(&d.hash),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::RecordReleased::SIGNATURE_HASH,
        name: "SecurityRecordReleased",
        decode: |log| {
            let d = dec::<sr::RecordReleased>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "reason_hash": hash(&d.reasonHash),
                "by_consent": d.byConsent,
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::MandateBreach::SIGNATURE_HASH,
        name: "SecurityMandateBreach",
        decode: |log| {
            let d = dec::<sr::MandateBreach>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "evidence_hash": hash(&d.evidenceHash),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::EnforcementStarted::SIGNATURE_HASH,
        name: "SecurityEnforcementStarted",
        decode: |log| {
            let d = dec::<sr::EnforcementStarted>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::RecordEnforced::SIGNATURE_HASH,
        name: "SecurityRecordEnforced",
        decode: |log| {
            let d = dec::<sr::RecordEnforced>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "proceeds_hash": hash(&d.proceedsHash),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::TermsSet::SIGNATURE_HASH,
        name: "SecurityTermsSet",
        decode: |log| {
            let d = dec::<sr::TermsSet>(log)?;
            let t = d.terms;
            let mut v = shared_terms_keys(
                d.loanId,
                SharedTerms {
                    advance_ratio_bps: t.advanceRatioBps,
                    margin_call_ratio_bps: t.marginCallRatioBps,
                    default_rate: t.defaultRate,
                    tolerance_bps: t.toleranceBps,
                    grade_tolerance_bps: t.gradeToleranceBps,
                    cure_period: t.curePeriod,
                    price_stale_after: t.priceStaleAfter,
                    grace_period: t.gracePeriod,
                    attestation_interval: t.attestationInterval,
                    inspection_interval: t.inspectionInterval,
                    margin_call_at: t.marginCallAt,
                    payment_term: t.paymentTerm,
                },
            );
            let o = v.as_object_mut()?;
            o.insert("default_ratio_bps".into(), json!(t.defaultRatioBps));
            o.insert("originator_fee_rate".into(), json!(t.originatorFeeRate));
            o.insert(
                "default_breach_at".into(),
                json!(t.defaultBreachAt.to_string()),
            );
            Some(v)
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr_f92d719::TermsSet::SIGNATURE_HASH,
        name: "SecurityTermsSet",
        decode: |log| {
            let d = dec::<sr_f92d719::TermsSet>(log)?;
            let t = d.terms;
            Some(shared_terms_keys(
                d.loanId,
                SharedTerms {
                    advance_ratio_bps: t.advanceRatioBps,
                    margin_call_ratio_bps: t.marginCallRatioBps,
                    default_rate: t.defaultRate,
                    tolerance_bps: t.toleranceBps,
                    grade_tolerance_bps: t.gradeToleranceBps,
                    cure_period: t.curePeriod,
                    price_stale_after: t.priceStaleAfter,
                    grace_period: t.gracePeriod,
                    attestation_interval: t.attestationInterval,
                    inspection_interval: t.inspectionInterval,
                    margin_call_at: t.marginCallAt,
                    payment_term: t.paymentTerm,
                },
            ))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::Revalued::SIGNATURE_HASH,
        name: "SecurityRevalued",
        decode: |log| {
            let d = dec::<sr::Revalued>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "value_per_unit": d.valuePerUnit.to_string(),
                "benchmark": benchmark_string(&d.benchmark),
                "report_hash": hash(&d.reportHash),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::MarginCall::SIGNATURE_HASH,
        name: "SecurityMarginCall",
        decode: |log| {
            let d = dec::<sr::MarginCall>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "ltv_bps": d.ltvBps,
                "margin_call_ratio_bps": d.marginCallRatioBps,
                "cure_by": d.cureBy.to_string(),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::PriceStale::SIGNATURE_HASH,
        name: "SecurityPriceStale",
        decode: |log| {
            let d = dec::<sr::PriceStale>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "ltv_bps": d.ltvBps,
                "margin_call_ratio_bps": d.marginCallRatioBps,
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::MarginCallCured::SIGNATURE_HASH,
        name: "SecurityMarginCallCured",
        decode: |log| {
            let d = dec::<sr::MarginCallCured>(log)?;
            Some(json!({ "loan_id": id(d.loanId), "ltv_bps": d.ltvBps }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::DefaultBreach::SIGNATURE_HASH,
        name: "SecurityDefaultBreach",
        decode: |log| {
            let d = dec::<sr::DefaultBreach>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "ltv_bps": d.ltvBps,
                "default_ratio_bps": d.defaultRatioBps,
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::DefaultBreachPriceStale::SIGNATURE_HASH,
        name: "SecurityDefaultBreachPriceStale",
        decode: |log| {
            let d = dec::<sr::DefaultBreachPriceStale>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "ltv_bps": d.ltvBps,
                "default_ratio_bps": d.defaultRatioBps,
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::DefaultBreachCleared::SIGNATURE_HASH,
        name: "SecurityDefaultBreachCleared",
        decode: |log| {
            let d = dec::<sr::DefaultBreachCleared>(log)?;
            Some(json!({ "loan_id": id(d.loanId), "ltv_bps": d.ltvBps }))
        },
    },
    Spec {
        emitter: NFT,
        topic: sr::InspectionRecorded::SIGNATURE_HASH,
        name: "SecurityInspectionRecorded",
        decode: |log| {
            let d = dec::<sr::InspectionRecorded>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "inspection_id": id(d.inspectionId),
                "lot_id": id(d.lotId),
                "inspector": addr(&d.inspector),
                "kind": inspection_kind_name(d.kind),
            }))
        },
    },
    Spec {
        emitter: NFT,
        topic: sr::InspectionApproved::SIGNATURE_HASH,
        name: "SecurityInspectionApproved",
        decode: |log| {
            let d = dec::<sr::InspectionApproved>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "inspection_id": id(d.inspectionId),
                "approved_by": addr(&d.approvedBy),
                "variance_reference_bps": d.varianceReferenceBps,
                "variance_previous_bps": d.variancePreviousBps,
                "variance_grade_bps": d.varianceGradeBps,
                "flagged": d.flagged,
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::FlagResolved::SIGNATURE_HASH,
        name: "SecurityFlagResolved",
        decode: |log| {
            let d = dec::<sr::FlagResolved>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "record_id": id(d.recordId),
                "inspection_id": id(d.inspectionId),
                "outcome": flag_outcome_name(d.outcome),
                "reason_hash": hash(&d.reasonHash),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::ExtensionConsent::SIGNATURE_HASH,
        name: "SecurityExtensionConsent",
        decode: |log| {
            let d = dec::<sr::ExtensionConsent>(log)?;
            Some(json!({
                "loan_id": id(d.loanId),
                "new_maturity": d.newMaturity.to_string(),
                "consent_hash": hash(&d.consentHash),
            }))
        },
    },
    Spec {
        emitter: NFT,
        topic: sr::InspectorsSet::SIGNATURE_HASH,
        name: "SecurityInspectorsSet",
        decode: |log| {
            let d = dec::<sr::InspectorsSet>(log)?;
            Some(json!({
                "inspectors": d.inspectors.iter().map(addr).collect::<Vec<_>>(),
            }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::LoanRegistrySet::SIGNATURE_HASH,
        name: "SecurityLoanRegistrySet",
        decode: |log| {
            let d = dec::<sr::LoanRegistrySet>(log)?;
            Some(json!({ "loan_registry": addr(&d.loanRegistry) }))
        },
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::Paused::SIGNATURE_HASH,
        name: "SecurityRegistryPaused",
        decode: |log| dec::<sr::Paused>(log).map(|_| json!({})),
    },
    Spec {
        emitter: REGISTRY,
        topic: sr::Unpaused::SIGNATURE_HASH,
        name: "SecurityRegistryUnpaused",
        decode: |log| dec::<sr::Unpaused>(log).map(|_| json!({})),
    },
];

fn spec_for(emitter: SecurityEmitter, topic0: &B256) -> Option<&'static Spec> {
    SPECS
        .iter()
        .find(|s| s.emitter == emitter && s.topic == *topic0)
}

pub fn classify_security_topic(emitter: SecurityEmitter, topic0: &B256) -> SecurityTopic {
    if let Some(spec) = spec_for(emitter, topic0) {
        SecurityTopic::Stored(spec.name)
    } else if SECURITY_REGISTRY_ALLOW_LISTED_TOPICS
        .iter()
        .any(|(e, t)| *e == emitter && t == topic0)
    {
        SecurityTopic::AllowListed
    } else {
        SecurityTopic::Unknown
    }
}

pub fn parse_security_event(log: &Log, emitter: SecurityEmitter) -> Option<ContractLog> {
    let spec = spec_for(emitter, log.topic0()?)?;
    let params = (spec.decode)(log)?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;
    Some(ContractLog {
        contract_address,
        event_name: spec.name.to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params,
    })
}

pub fn dispatch_security_registry(
    log: &Log,
    registry: Address,
    nft: Address,
) -> Option<ContractLog> {
    let emitter = if log.address() == registry {
        SecurityEmitter::Registry
    } else if log.address() == nft {
        SecurityEmitter::RecordNft
    } else {
        return None;
    };
    let topic0 = log.topic0()?;
    match classify_security_topic(emitter, topic0) {
        SecurityTopic::Stored(_) => {
            let parsed = parse_security_event(log, emitter);
            if parsed.is_none() {
                tracing::warn!(
                    contract_address = %log.address(),
                    topic0 = %topic0,
                    tx_hash = ?log.transaction_hash,
                    "SecurityRegistry event failed to decode; dropped"
                );
            }
            parsed
        }
        SecurityTopic::AllowListed => None,
        SecurityTopic::Unknown => {
            tracing::warn!(
                contract_address = %log.address(),
                topic0 = %topic0,
                tx_hash = ?log.transaction_hash,
                "SecurityRegistry emitted an unrecognised topic; dropped"
            );
            None
        }
    }
}

static TRAP_WARNED: AtomicBool = AtomicBool::new(false);

pub fn is_security_only_topic(topic0: &B256) -> bool {
    SPECS.iter().any(|s| {
        s.topic == *topic0
            && !matches!(
                s.name,
                "SecurityRevalued"
                    | "SecurityDocAdded"
                    | "SecurityLoanRegistrySet"
                    | "SecurityRegistryPaused"
                    | "SecurityRegistryUnpaused"
            )
    })
}

pub fn warn_if_security_registry_topic(log: &Log) {
    let Some(topic0) = log.topic0() else {
        return;
    };
    if is_security_only_topic(topic0) && !TRAP_WARNED.swap(true, Ordering::Relaxed) {
        tracing::warn!(
            contract_address = %log.address(),
            topic0 = %topic0,
            "legacy CollateralRegistry address emits a SecurityRegistry-only topic; this address looks like a SecurityRegistry and belongs in CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS"
        );
    }
}

pub fn reject_security_collision(
    chain_id: i64,
    label: &str,
    addr: Address,
    roles: &[(&str, Address)],
) -> Result<()> {
    if roles.iter().any(|(_, a)| *a == addr) {
        bail!(
            "CHAIN_{chain_id}_EVM_INDEXER_{label} ({addr}) duplicates another configured contract address; each role must point at a distinct contract"
        );
    }
    Ok(())
}
