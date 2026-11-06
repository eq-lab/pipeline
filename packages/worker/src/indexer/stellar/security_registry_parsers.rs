// spec: docs/references/security-registry-events.md#event-table
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Map, Value};
use stellar_xdr::curr::{Limits, ReadXdr, ScMap, ScVal};

use crate::indexer::stellar::loan_registry_parsers::{enum_variant_name, extract_u32};
use crate::indexer::stellar::loan_registry_reader::map_entry;
use crate::indexer::stellar::parsers::{sc_address_to_strkey, synthesise_log_index, StellarLog};
use crate::indexer::stellar::rpc::RawEvent;
use crate::stellar::scval::i128_from_parts;

pub const SECURITY_REGISTRY_EVENT_TOPICS: [(&str, &str); 22] = derive_topics();

const fn derive_topics() -> [(&'static str, &'static str); 22] {
    let mut out = [("", ""); 22];
    let mut i = 0;
    while i < 22 {
        out[i] = (SPECS[i].topic, SPECS[i].name);
        i += 1;
    }
    out
}

pub const SECURITY_REGISTRY_ALLOW_LISTED_TOPICS: [&str; 5] = [
    "mint",
    "burn",
    "ownership_transfer",
    "ownership_transfer_completed",
    "ownership_renounced",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityTopic {
    Stored(&'static str),
    AllowListed,
    Unknown,
}

pub fn classify_security_topic(topic: &str) -> SecurityTopic {
    if let Some(spec) = SPECS.iter().find(|s| s.topic == topic) {
        SecurityTopic::Stored(spec.name)
    } else if SECURITY_REGISTRY_ALLOW_LISTED_TOPICS.contains(&topic) {
        SecurityTopic::AllowListed
    } else {
        SecurityTopic::Unknown
    }
}

#[derive(Clone, Copy)]
enum Kind {
    IdStr,
    Bps,
    I32,
    U64,
    I128,
    Bool,
    Enum,
    Symbol,
    Hash,
    Addr,
    AddrVec,
}

struct Spec {
    topic: &'static str,
    name: &'static str,
    id_topics: &'static [&'static str],
    nested: Option<&'static str>,
    fields: &'static [(&'static str, Kind)],
}

const TERMS_FIELDS: [(&str, Kind); 12] = [
    ("advance_ratio_bps", Kind::Bps),
    ("margin_call_ratio_bps", Kind::Bps),
    ("default_rate", Kind::Bps),
    ("tolerance_bps", Kind::Bps),
    ("grade_tolerance_bps", Kind::Bps),
    ("cure_period", Kind::U64),
    ("price_stale_after", Kind::U64),
    ("grace_period", Kind::U64),
    ("attestation_interval", Kind::U64),
    ("inspection_interval", Kind::U64),
    ("margin_call_at", Kind::U64),
    ("payment_term", Kind::Enum),
];

const LOAN: &[&str] = &["loan_id"];
const LOAN_RECORD: &[&str] = &["loan_id", "record_id"];
const LOAN_RECORD_INSPECTION: &[&str] = &["loan_id", "record_id", "inspection_id"];

const SPECS: [Spec; 22] = [
    Spec {
        topic: "record_registered",
        name: "SecurityRecordRegistered",
        id_topics: LOAN_RECORD,
        nested: None,
        fields: &[("lot_id", Kind::IdStr), ("protection", Kind::Enum)],
    },
    Spec {
        topic: "record_perfected",
        name: "SecurityRecordPerfected",
        id_topics: LOAN_RECORD,
        nested: None,
        fields: &[("evidence_hash", Kind::Hash)],
    },
    Spec {
        topic: "record_handed_over",
        name: "SecurityRecordHandedOver",
        id_topics: &["loan_id", "from_record_id", "to_record_id"],
        nested: None,
        fields: &[("evidence_hash", Kind::Hash)],
    },
    Spec {
        topic: "record_attested",
        name: "SecurityRecordAttested",
        id_topics: LOAN_RECORD,
        nested: None,
        fields: &[("attested_by", Kind::Addr)],
    },
    Spec {
        topic: "doc_added",
        name: "SecurityDocAdded",
        id_topics: LOAN_RECORD,
        nested: None,
        fields: &[("kind", Kind::Enum), ("sha256", Kind::Hash)],
    },
    Spec {
        topic: "record_released",
        name: "SecurityRecordReleased",
        id_topics: LOAN_RECORD,
        nested: None,
        fields: &[("reason_hash", Kind::Hash), ("by_consent", Kind::Bool)],
    },
    Spec {
        topic: "mandate_breach",
        name: "SecurityMandateBreach",
        id_topics: LOAN,
        nested: None,
        fields: &[("evidence_hash", Kind::Hash)],
    },
    Spec {
        topic: "enforcement_started",
        name: "SecurityEnforcementStarted",
        id_topics: LOAN_RECORD,
        nested: None,
        fields: &[],
    },
    Spec {
        topic: "record_enforced",
        name: "SecurityRecordEnforced",
        id_topics: LOAN_RECORD,
        nested: None,
        fields: &[("proceeds_hash", Kind::Hash)],
    },
    Spec {
        topic: "terms_set",
        name: "SecurityTermsSet",
        id_topics: LOAN,
        nested: Some("terms"),
        fields: &TERMS_FIELDS,
    },
    Spec {
        topic: "revalued",
        name: "SecurityRevalued",
        id_topics: LOAN_RECORD,
        nested: None,
        fields: &[
            ("value_per_unit", Kind::I128),
            ("benchmark", Kind::Symbol),
            ("report_hash", Kind::Hash),
        ],
    },
    Spec {
        topic: "margin_call",
        name: "SecurityMarginCall",
        id_topics: LOAN,
        nested: None,
        fields: &[
            ("ltv_bps", Kind::Bps),
            ("margin_call_ratio_bps", Kind::Bps),
            ("cure_by", Kind::U64),
        ],
    },
    Spec {
        topic: "price_stale",
        name: "SecurityPriceStale",
        id_topics: LOAN,
        nested: None,
        fields: &[("ltv_bps", Kind::Bps), ("margin_call_ratio_bps", Kind::Bps)],
    },
    Spec {
        topic: "margin_call_cured",
        name: "SecurityMarginCallCured",
        id_topics: LOAN,
        nested: None,
        fields: &[("ltv_bps", Kind::Bps)],
    },
    Spec {
        topic: "inspection_recorded",
        name: "SecurityInspectionRecorded",
        id_topics: LOAN_RECORD_INSPECTION,
        nested: None,
        fields: &[
            ("lot_id", Kind::IdStr),
            ("inspector", Kind::Addr),
            ("kind", Kind::Enum),
        ],
    },
    Spec {
        topic: "inspection_approved",
        name: "SecurityInspectionApproved",
        id_topics: LOAN_RECORD_INSPECTION,
        nested: None,
        fields: &[
            ("approved_by", Kind::Addr),
            ("variance_reference_bps", Kind::I32),
            ("variance_previous_bps", Kind::I32),
            ("variance_grade_bps", Kind::I32),
            ("flagged", Kind::Bool),
        ],
    },
    Spec {
        topic: "flag_resolved",
        name: "SecurityFlagResolved",
        id_topics: LOAN_RECORD,
        nested: None,
        fields: &[
            ("inspection_id", Kind::IdStr),
            ("outcome", Kind::Enum),
            ("reason_hash", Kind::Hash),
        ],
    },
    Spec {
        topic: "extension_consent",
        name: "SecurityExtensionConsent",
        id_topics: LOAN,
        nested: None,
        fields: &[("new_maturity", Kind::U64), ("consent_hash", Kind::Hash)],
    },
    Spec {
        topic: "inspectors_set",
        name: "SecurityInspectorsSet",
        id_topics: &[],
        nested: None,
        fields: &[("inspectors", Kind::AddrVec)],
    },
    Spec {
        topic: "loan_registry_set",
        name: "SecurityLoanRegistrySet",
        id_topics: &[],
        nested: None,
        fields: &[("loan_registry", Kind::Addr)],
    },
    Spec {
        topic: "paused",
        name: "SecurityRegistryPaused",
        id_topics: &[],
        nested: None,
        fields: &[],
    },
    Spec {
        topic: "unpaused",
        name: "SecurityRegistryUnpaused",
        id_topics: &[],
        nested: None,
        fields: &[],
    },
];

fn decode_field(v: &ScVal, kind: Kind) -> Option<Value> {
    match (kind, v) {
        (Kind::IdStr, ScVal::U32(n)) => Some(json!(n.to_string())),
        (Kind::Bps, ScVal::U32(n)) => Some(json!(n)),
        (Kind::I32, ScVal::I32(n)) => Some(json!(n)),
        (Kind::U64, ScVal::U64(n)) => Some(json!(n.to_string())),
        (Kind::I128, ScVal::I128(p)) => Some(json!(i128_from_parts(p.hi, p.lo).to_string())),
        (Kind::Bool, ScVal::Bool(b)) => Some(json!(b)),
        (Kind::Enum, _) => enum_variant_name(v).map(Value::String),
        (Kind::Symbol, ScVal::Symbol(s)) => Some(json!(s.0.to_utf8_string_lossy())),
        (Kind::Hash, ScVal::Bytes(b)) if b.0.len() == 32 => {
            Some(json!(hex::encode(b.0.as_slice())))
        }
        (Kind::Addr, ScVal::Address(a)) => sc_address_to_strkey(a).map(Value::String),
        (Kind::AddrVec, ScVal::Vec(items)) => {
            let slice: &[ScVal] = items.as_ref().map_or(&[], |i| i.0.as_slice());
            slice
                .iter()
                .map(|item| match item {
                    ScVal::Address(a) => sc_address_to_strkey(a).map(Value::String),
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()
                .map(Value::Array)
        }
        _ => None,
    }
}

fn parse_with(raw: &RawEvent, name: &str, spec: &Spec) -> Option<StellarLog> {
    if raw.topics_base64.len() < 1 + spec.id_topics.len() {
        return None;
    }
    let mut params = Map::new();
    for (i, key) in spec.id_topics.iter().enumerate() {
        let id = extract_u32(&raw.topics_base64[1 + i])?;
        params.insert((*key).to_owned(), json!(id.to_string()));
    }
    let value = ScVal::from_xdr_base64(&raw.value_base64, Limits::none()).ok()?;
    let empty = ScMap::default();
    let outer = match &value {
        ScVal::Map(Some(m)) => m,
        ScVal::Map(None) | ScVal::Void => &empty,
        _ => return None,
    };
    let source = match spec.nested {
        Some(key) => match map_entry(outer, key)? {
            ScVal::Map(Some(inner)) => inner,
            _ => return None,
        },
        None => outer,
    };
    for (key, kind) in spec.fields {
        params.insert(
            (*key).to_owned(),
            decode_field(map_entry(source, key)?, *kind)?,
        );
    }
    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: name.to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: Value::Object(params),
    })
}

pub fn parse_security_event(raw: &RawEvent) -> Option<StellarLog> {
    let spec = SPECS.iter().find(|s| s.topic == raw.event_name)?;
    parse_with(raw, spec.name, spec)
}

pub fn dispatch_security_registry(raw: &RawEvent) -> Option<StellarLog> {
    match classify_security_topic(&raw.event_name) {
        SecurityTopic::Stored(_) => {
            let parsed = parse_security_event(raw);
            if parsed.is_none() {
                tracing::warn!(
                    contract_id = %raw.contract_id,
                    event_name = %raw.event_name,
                    tx_hash = %raw.tx_hash,
                    "SecurityRegistry event failed to decode; dropped"
                );
            }
            parsed
        }
        SecurityTopic::AllowListed => None,
        SecurityTopic::Unknown => {
            tracing::warn!(
                contract_id = %raw.contract_id,
                event_name = %raw.event_name,
                tx_hash = %raw.tx_hash,
                "SecurityRegistry emitted an unrecognised topic; dropped"
            );
            None
        }
    }
}

static TRAP_WARNED: AtomicBool = AtomicBool::new(false);

pub fn warn_if_security_registry_topic(raw: &RawEvent, legacy_topics: &[&str]) {
    if legacy_topics.contains(&raw.event_name.as_str())
        || matches!(raw.event_name.as_str(), "paused" | "unpaused")
    {
        return;
    }
    if matches!(
        classify_security_topic(&raw.event_name),
        SecurityTopic::Stored(_)
    ) && !TRAP_WARNED.swap(true, Ordering::Relaxed)
    {
        tracing::warn!(
            contract_id = %raw.contract_id,
            event_name = %raw.event_name,
            "legacy CollateralRegistry address emits a SecurityRegistry-only topic; this id looks like a SecurityRegistry and belongs in CHAIN_<id>_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS"
        );
    }
}
