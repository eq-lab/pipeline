// spec: docs/references/access-manager-events.md
use std::fmt::Write;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use stellar_xdr::curr::{
    FeeBumpTransactionInnerTx, HostFunction, InvokeContractArgs, Limits, Operation, OperationBody,
    ReadXdr, ScMap, ScMapEntry, ScSymbol, ScVal, SorobanAuthorizationEntry,
    SorobanAuthorizedFunction, SorobanAuthorizedInvocation, TransactionEnvelope, VecM, WriteXdr,
};

use crate::indexer::stellar::loan_registry_reader::map_entry;
use crate::indexer::stellar::parsers::{sc_address_to_strkey, synthesise_log_index, StellarLog};
use crate::indexer::stellar::rpc::RawEvent;
use shared::access_manager_repo::{OP_EVENT_CANCELED, OP_EVENT_EXECUTED, OP_EVENT_SCHEDULED};

use crate::indexer::access_manager_sync::{num_param, str_param};
pub use crate::indexer::access_manager_sync::{AmTopic, CanceledRow, LoanRef};

pub const ACCESS_MANAGER_ALLOW_LISTED_TOPICS: [&str; 8] = [
    "role_granted",
    "role_revoked",
    "role_admin_changed",
    "role_guardian_changed",
    "role_grant_delay_changed",
    "target_function_role_updated",
    "target_closed",
    "target_admin_delay_updated",
];

pub fn classify_access_manager_topic(topic: &str) -> AmTopic {
    match topic {
        "operation_scheduled" => AmTopic::Scheduled,
        "operation_canceled" => AmTopic::Canceled,
        "operation_executed" => AmTopic::Executed,
        t if ACCESS_MANAGER_ALLOW_LISTED_TOPICS.contains(&t) => AmTopic::AllowListed,
        _ => AmTopic::Unknown,
    }
}

fn topic_val(raw: &RawEvent, i: usize) -> Option<ScVal> {
    ScVal::from_xdr_base64(raw.topics_base64.get(i)?, Limits::none()).ok()
}

fn topic_hash(raw: &RawEvent, i: usize) -> Option<String> {
    match topic_val(raw, i)? {
        ScVal::Bytes(b) if b.0.len() == 32 => Some(hex::encode(b.0.as_slice())),
        _ => None,
    }
}

fn topic_address(raw: &RawEvent, i: usize) -> Option<String> {
    match topic_val(raw, i)? {
        ScVal::Address(a) => sc_address_to_strkey(&a),
        _ => None,
    }
}

fn topic_symbol(raw: &RawEvent, i: usize) -> Option<String> {
    match topic_val(raw, i)? {
        ScVal::Symbol(s) => Some(s.0.to_utf8_string_lossy()),
        _ => None,
    }
}

fn value_map(raw: &RawEvent) -> Option<ScMap> {
    match ScVal::from_xdr_base64(&raw.value_base64, Limits::none()).ok()? {
        ScVal::Map(Some(m)) => Some(m),
        _ => None,
    }
}

fn entry_u32(map: &ScMap, key: &str) -> Option<u32> {
    match map_entry(map, key)? {
        ScVal::U32(n) => Some(*n),
        _ => None,
    }
}

fn entry_u64(map: &ScMap, key: &str) -> Option<u64> {
    match map_entry(map, key)? {
        ScVal::U64(n) => Some(*n),
        _ => None,
    }
}

fn entry_address(map: &ScMap, key: &str) -> Option<String> {
    match map_entry(map, key)? {
        ScVal::Address(a) => sc_address_to_strkey(a),
        _ => None,
    }
}

fn entry_symbol(map: &ScMap, key: &str) -> Option<String> {
    match map_entry(map, key)? {
        ScVal::Symbol(s) => Some(s.0.to_utf8_string_lossy()),
        _ => None,
    }
}

fn log_of(raw: &RawEvent, name: &str, params: Value) -> StellarLog {
    StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: name.to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params,
    }
}

fn parse_scheduled(raw: &RawEvent) -> Option<StellarLog> {
    if raw.topics_base64.len() != 3 {
        return None;
    }
    let operation_id = topic_hash(raw, 1)?;
    let caller = topic_address(raw, 2)?;
    let map = value_map(raw)?;
    let params = json!({
        "operation_id": operation_id,
        "caller": caller,
        "nonce": entry_u32(&map, "nonce")?.to_string(),
        "when": entry_u64(&map, "when")?.to_string(),
        "target": entry_address(&map, "target")?,
        "function": entry_symbol(&map, "function")?,
    });
    Some(log_of(raw, OP_EVENT_SCHEDULED, params))
}

fn parse_canceled(raw: &RawEvent) -> Option<StellarLog> {
    if raw.topics_base64.len() != 2 {
        return None;
    }
    let operation_id = topic_hash(raw, 1)?;
    let map = value_map(raw)?;
    let params = json!({
        "operation_id": operation_id,
        "nonce": entry_u32(&map, "nonce")?.to_string(),
    });
    Some(log_of(raw, OP_EVENT_CANCELED, params))
}

fn parse_executed(raw: &RawEvent) -> Option<StellarLog> {
    if raw.topics_base64.len() != 4 {
        return None;
    }
    let params = json!({
        "target": topic_address(raw, 1)?,
        "function": topic_symbol(raw, 2)?,
        "caller": topic_address(raw, 3)?,
    });
    Some(log_of(raw, OP_EVENT_EXECUTED, params))
}

pub fn dispatch_access_manager(raw: &RawEvent) -> Option<StellarLog> {
    let parsed = match classify_access_manager_topic(&raw.event_name) {
        AmTopic::Scheduled => parse_scheduled(raw),
        AmTopic::Canceled => parse_canceled(raw),
        AmTopic::Executed => parse_executed(raw),
        AmTopic::AllowListed => return None,
        AmTopic::Unknown => {
            tracing::warn!(
                contract_id = %raw.contract_id,
                event_name = %raw.event_name,
                tx_hash = %raw.tx_hash,
                "AccessManager emitted an unrecognised topic; dropped"
            );
            return None;
        }
    };
    if parsed.is_none() {
        tracing::warn!(
            contract_id = %raw.contract_id,
            event_name = %raw.event_name,
            tx_hash = %raw.tx_hash,
            "AccessManager event failed to decode; dropped"
        );
    }
    parsed
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledRow {
    pub operation_id: String,
    pub caller: String,
    pub nonce: u32,
    pub when: u64,
    pub target: String,
    pub function: String,
}

impl ScheduledRow {
    pub fn from_params(p: &Value) -> Option<Self> {
        Some(Self {
            operation_id: str_param(p, "operation_id")?,
            caller: str_param(p, "caller")?,
            nonce: num_param(p, "nonce")?,
            when: num_param(p, "when")?,
            target: str_param(p, "target")?,
            function: str_param(p, "function")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutedRow {
    pub target: String,
    pub function: String,
    pub caller: String,
}

impl ExecutedRow {
    pub fn from_params(p: &Value) -> Option<Self> {
        Some(Self {
            target: str_param(p, "target")?,
            function: str_param(p, "function")?,
            caller: str_param(p, "caller")?,
        })
    }
}

fn collect_from_invocation(
    inv: &SorobanAuthorizedInvocation,
    contract: &str,
    function: &str,
    out: &mut Vec<Vec<ScVal>>,
) {
    if let SorobanAuthorizedFunction::ContractFn(args) = &inv.function {
        push_if_match(args, contract, function, out);
    }
    for sub in inv.sub_invocations.iter() {
        collect_from_invocation(sub, contract, function, out);
    }
}

fn push_if_match(
    args: &InvokeContractArgs,
    contract: &str,
    function: &str,
    out: &mut Vec<Vec<ScVal>>,
) {
    let same_contract = sc_address_to_strkey(&args.contract_address).as_deref() == Some(contract);
    if same_contract && args.function_name.0.to_utf8_string_lossy() == function {
        out.push(args.args.to_vec());
    }
}

fn collect_from_operations(
    ops: &[Operation],
    contract: &str,
    function: &str,
    out: &mut Vec<Vec<ScVal>>,
) {
    for op in ops {
        let OperationBody::InvokeHostFunction(invoke) = &op.body else {
            continue;
        };
        if let HostFunction::InvokeContract(args) = &invoke.host_function {
            push_if_match(args, contract, function, out);
        }
        for entry in invoke.auth.iter() {
            let SorobanAuthorizationEntry {
                root_invocation, ..
            } = entry;
            collect_from_invocation(root_invocation, contract, function, out);
        }
    }
}

pub fn contract_invocations(envelope_b64: &str, contract: &str, function: &str) -> Vec<Vec<ScVal>> {
    let Ok(envelope) = TransactionEnvelope::from_xdr_base64(envelope_b64, Limits::none()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    match &envelope {
        TransactionEnvelope::TxV0(_) => {}
        TransactionEnvelope::Tx(env) => {
            collect_from_operations(env.tx.operations.as_slice(), contract, function, &mut out);
        }
        TransactionEnvelope::TxFeeBump(env) => {
            let FeeBumpTransactionInnerTx::Tx(inner) = &env.tx.inner_tx;
            collect_from_operations(inner.tx.operations.as_slice(), contract, function, &mut out);
        }
    }
    out
}

fn sym_key(name: &str) -> ScVal {
    ScVal::Symbol(ScSymbol(
        name.try_into().expect("symbol fits in StringM<32>"),
    ))
}

pub fn hash_operation(caller: &ScVal, target: &ScVal, function: &ScVal, args: &ScVal) -> [u8; 32] {
    let entries: Vec<ScMapEntry> = [
        ("args", args),
        ("caller", caller),
        ("function", function),
        ("target", target),
    ]
    .into_iter()
    .map(|(k, v)| ScMapEntry {
        key: sym_key(k),
        val: v.clone(),
    })
    .collect();
    let entries: VecM<ScMapEntry> = entries.try_into().expect("four map entries");
    let xdr = ScVal::Map(Some(ScMap(entries)))
        .to_xdr(Limits::none())
        .expect("encode operation preimage");
    Sha256::digest(xdr).into()
}

fn address_strkey(v: &ScVal) -> Option<String> {
    match v {
        ScVal::Address(a) => sc_address_to_strkey(a),
        _ => None,
    }
}

fn symbol_name(v: &ScVal) -> Option<String> {
    match v {
        ScVal::Symbol(s) => Some(s.0.to_utf8_string_lossy()),
        _ => None,
    }
}

pub fn recover_schedule_args(row: &ScheduledRow, candidates: &[Vec<ScVal>]) -> Option<ScVal> {
    candidates
        .iter()
        .filter(|c| c.len() == 5)
        .find(|c| hex::encode(hash_operation(&c[4], &c[0], &c[1], &c[2])) == row.operation_id)
        .map(|c| c[2].clone())
}

pub fn execute_candidate_ids(row: &ExecutedRow, candidates: &[Vec<ScVal>]) -> Vec<[u8; 32]> {
    let mut ids: Vec<[u8; 32]> = Vec::new();
    for c in candidates.iter().filter(|c| c.len() == 4) {
        let same = address_strkey(&c[0]).as_deref() == Some(row.target.as_str())
            && symbol_name(&c[1]).as_deref() == Some(row.function.as_str())
            && address_strkey(&c[3]).as_deref() == Some(row.caller.as_str());
        if !same {
            continue;
        }
        let id = hash_operation(&c[3], &c[0], &c[1], &c[2]);
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

fn limbs_decimal(mut limbs: [u64; 4]) -> String {
    const CHUNK: u128 = 10_000_000_000_000_000_000;
    let mut parts: Vec<u64> = Vec::new();
    while limbs.iter().any(|l| *l != 0) {
        let mut rem: u128 = 0;
        for limb in &mut limbs {
            let cur = (rem << 64) | u128::from(*limb);
            *limb = (cur / CHUNK) as u64;
            rem = cur % CHUNK;
        }
        parts.push(rem as u64);
    }
    let Some((last, rest)) = parts.split_last() else {
        return "0".to_owned();
    };
    let mut out = last.to_string();
    for part in rest.iter().rev() {
        let _ = write!(out, "{part:019}");
    }
    out
}

fn i256_decimal(limbs: [u64; 4], negative: bool) -> String {
    if !negative {
        return limbs_decimal(limbs);
    }
    let mut neg = [0u64; 4];
    let mut carry = true;
    for i in (0..4).rev() {
        let (v, c) = (!limbs[i]).overflowing_add(u64::from(carry));
        neg[i] = v;
        carry = c;
    }
    format!("-{}", limbs_decimal(neg))
}

fn xdr_fallback(v: &ScVal) -> Value {
    json!({ "xdr": v.to_xdr_base64(Limits::none()).unwrap_or_default() })
}

fn json_text(s: &[u8]) -> String {
    String::from_utf8_lossy(s).replace('\0', "\u{FFFD}")
}

pub fn args_display_json(args: &ScVal) -> Value {
    match args {
        ScVal::U32(n) => json!(n),
        ScVal::I32(n) => json!(n),
        ScVal::U64(n) => json!(n.to_string()),
        ScVal::I64(n) => json!(n.to_string()),
        ScVal::Timepoint(t) => json!(t.0.to_string()),
        ScVal::Duration(d) => json!(d.0.to_string()),
        ScVal::U128(p) => json!(((u128::from(p.hi) << 64) | u128::from(p.lo)).to_string()),
        ScVal::I128(p) => json!(crate::stellar::scval::i128_from_parts(p.hi, p.lo).to_string()),
        ScVal::U256(p) => json!(limbs_decimal([p.hi_hi, p.hi_lo, p.lo_hi, p.lo_lo])),
        ScVal::I256(p) => json!(i256_decimal(
            [p.hi_hi as u64, p.hi_lo, p.lo_hi, p.lo_lo],
            p.hi_hi < 0
        )),
        ScVal::Bool(b) => json!(b),
        ScVal::Void => Value::Null,
        ScVal::Symbol(s) => json!(json_text(s.0.as_slice())),
        ScVal::String(s) => json!(json_text(s.0.as_slice())),
        ScVal::Bytes(b) => json!(hex::encode(b.0.as_slice())),
        ScVal::Address(a) => match sc_address_to_strkey(a) {
            Some(s) => json!(s),
            None => xdr_fallback(args),
        },
        ScVal::Vec(items) => Value::Array(
            items
                .as_ref()
                .map_or(&[][..], |v| v.0.as_slice())
                .iter()
                .map(args_display_json)
                .collect(),
        ),
        ScVal::Map(m) => map_display_json(m.as_ref().map_or(&[][..], |m| m.0.as_slice())),
        _ => xdr_fallback(args),
    }
}

fn map_display_json(entries: &[ScMapEntry]) -> Value {
    if entries.iter().all(|e| matches!(e.key, ScVal::Symbol(_))) {
        let mut obj = Map::new();
        for e in entries {
            if let ScVal::Symbol(k) = &e.key {
                obj.insert(json_text(k.0.as_slice()), args_display_json(&e.val));
            }
        }
        return Value::Object(obj);
    }
    Value::Array(
        entries
            .iter()
            .map(
                |e| json!({ "key": args_display_json(&e.key), "value": args_display_json(&e.val) }),
            )
            .collect(),
    )
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TargetIds {
    pub loan_registry: Option<String>,
    pub minter: Option<String>,
    pub security_registry: Option<String>,
}

const LOAN_REGISTRY_FUNCTIONS: [&str; 6] = [
    "set_default",
    "cure",
    "amend_economics",
    "adjust_interest",
    "write_down",
    "close_defaulted",
];

fn first_u32(args: &ScVal) -> Option<u32> {
    match args {
        ScVal::Vec(Some(v)) => match v.0.first()? {
            ScVal::U32(n) => Some(*n),
            _ => None,
        },
        _ => None,
    }
}

pub fn loan_ref(target: &str, function: &str, args: &ScVal, ids: &TargetIds) -> LoanRef {
    let is = |id: &Option<String>| id.as_deref() == Some(target);
    let Some(first) = first_u32(args) else {
        return LoanRef::None;
    };
    let loan_call = (is(&ids.loan_registry) && LOAN_REGISTRY_FUNCTIONS.contains(&function))
        || (is(&ids.minter) && function == "reverse_repay");
    if loan_call {
        LoanRef::Loan(first)
    } else if is(&ids.security_registry) {
        match function {
            "set_terms" => LoanRef::Loan(first),
            "resolve_flag" | "release_with_consent" => LoanRef::Record(first),
            _ => LoanRef::None,
        }
    } else {
        LoanRef::None
    }
}
