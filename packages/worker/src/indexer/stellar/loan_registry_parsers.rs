/// Pure decoder functions for LoanRegistry Soroban contract events.
///
/// Mirrors the structure of `parsers.rs` — each function takes a `RawEvent` and
/// returns `Some(StellarLog)` on topic-name match or `None` on mismatch/missing data.
/// No DB access, no RPC calls — pure XDR decoding.
///
/// Event layout (verified against `pipeline-stellar-contracts/contracts/loan-registry/src/event.rs`):
/// - `topics[0]` = `ScVal::Symbol(snake_case_event_name)` — canonical discriminator.
/// - `topics[1..n]` = `#[topic]`-annotated fields in declaration order.
/// - `value` = `ScVal::Map(...)` with non-topic fields, sorted alphabetically by field name.
///
/// `LoanStatus` / `ClosureReason` topics are encoded by soroban-sdk as
/// `ScVal::Vec([ScVal::Symbol("VariantName")])` per the `#[contracttype]` IntoVal impl.
use serde_json::json;
use stellar_xdr::curr::{Limits, ReadXdr, ScVal};

pub use crate::indexer::loan_metadata::RepaymentDataView;
use crate::indexer::stellar::parsers::StellarLog;
use crate::indexer::stellar::{parsers::synthesise_log_index, rpc::RawEvent};

// ── Public parsers ────────────────────────────────────────────────────────────

/// LoanRegistry `LoanDrawn` event.
/// topics: [loan_drawn, loan_id: u32, holder: Address]
/// value:  Map { metadata_uri: String }
/// stored event_name = "LoanDrawn"
pub fn parse_loan_drawn(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "loan_drawn" {
        return None;
    }
    if raw.topics_base64.len() < 3 {
        return None;
    }

    let loan_id = extract_u32(&raw.topics_base64[1])?;
    let holder = extract_address_topic(&raw.topics_base64[2])?;
    let metadata_uri = extract_string_from_map(&raw.value_base64, "metadata_uri")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "LoanDrawn".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "loan_id": loan_id.to_string(),
            "holder": holder,
            "metadata_uri": metadata_uri,
        }),
    })
}

/// LoanRegistry `StatusUpdated` event.
/// topics: [status_updated, loan_id: u32, new_status: LoanStatus]
/// value:  (none)
/// stored event_name = "LoanStatusUpdated" (remapped for EVM analytics parity)
pub fn parse_status_updated(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "status_updated" {
        return None;
    }
    if raw.topics_base64.len() < 3 {
        return None;
    }

    let loan_id = extract_u32(&raw.topics_base64[1])?;
    let new_status = extract_loan_status(&raw.topics_base64[2])?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "LoanStatusUpdated".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "loan_id": loan_id.to_string(),
            "status": new_status,
        }),
    })
}

/// LoanRegistry `CcrUpdated` event.
/// topics: [ccr_updated, loan_id: u32]
/// value:  Map { new_ccr: u32 }
/// stored event_name = "LoanCCRUpdated" (remapped for EVM analytics parity)
pub fn parse_ccr_updated(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "ccr_updated" {
        return None;
    }
    if raw.topics_base64.len() < 2 {
        return None;
    }

    let loan_id = extract_u32(&raw.topics_base64[1])?;
    let new_ccr = extract_u32_from_map(&raw.value_base64, "new_ccr")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "LoanCCRUpdated".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "loan_id": loan_id.to_string(),
            "new_ccr": new_ccr,
        }),
    })
}

/// LoanRegistry `LocationUpdated` event.
/// topics: [location_updated, loan_id: u32, new_location: String]
/// value:  (none)
/// stored event_name = "LoanLocationUpdated" (remapped for EVM analytics parity)
///
/// Note: on Stellar, the location string is the full literal string (unlike EVM which
/// stores only the keccak hash). Stored verbatim in `params.new_location`.
pub fn parse_location_updated(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "location_updated" {
        return None;
    }
    if raw.topics_base64.len() < 3 {
        return None;
    }

    let loan_id = extract_u32(&raw.topics_base64[1])?;
    let new_location = extract_string(&raw.topics_base64[2])?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "LoanLocationUpdated".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "loan_id": loan_id.to_string(),
            "new_location": new_location,
        }),
    })
}

/// LoanRegistry `LoanDefaulted` event.
/// topics: [loan_defaulted, loan_id: u32]
/// value:  Map { ccr: u32 }
/// stored event_name = "LoanDefaulted"
///
/// `params.ccr_bps` matches EVM's `parse_loan_defaulted` (which emits
/// `decoded.ccrBps`). The on-chain Soroban Map key is `ccr`; we rename to
/// `ccr_bps` on the way out so downstream consumers (mapper, analytics) can
/// read a single field name across chains.
pub fn parse_loan_defaulted(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "loan_defaulted" {
        return None;
    }
    if raw.topics_base64.len() < 2 {
        return None;
    }

    let loan_id = extract_u32(&raw.topics_base64[1])?;
    let ccr_bps = extract_u32_from_map(&raw.value_base64, "ccr")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "LoanDefaulted".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "loan_id": loan_id.to_string(),
            "ccr_bps": ccr_bps,
        }),
    })
}

/// LoanRegistry `LoanClosed` event.
/// topics: [loan_closed, loan_id: u32, reason: ClosureReason]
/// value:  (none)
/// stored event_name = "LoanClosed"
pub fn parse_loan_closed(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "loan_closed" {
        return None;
    }
    if raw.topics_base64.len() < 3 {
        return None;
    }

    let loan_id = extract_u32(&raw.topics_base64[1])?;
    let closure_reason = extract_closure_reason(&raw.topics_base64[2])?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "LoanClosed".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "loan_id": loan_id.to_string(),
            "closure_reason": closure_reason,
        }),
    })
}

/// LoanRegistry `PaymentRecorded` event.
/// topics: [payment_recorded, loan_id: u32, repayment_id: u32]
/// value:  Map { repayment: RepaymentData (7 × u128) }
/// stored event_name = "PaymentRecorded"
///
/// The `repayment` field is a nested `#[contracttype]` struct, encoded as a sub-map.
/// We flatten its 7 fields directly into `params` (matching the EVM parse_payment_recorded
/// shape from `parsers.rs:234-258`).
pub fn parse_payment_recorded(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "payment_recorded" {
        return None;
    }
    if raw.topics_base64.len() < 3 {
        return None;
    }

    let loan_id = extract_u32(&raw.topics_base64[1])?;
    let repayment_id = extract_u32(&raw.topics_base64[2])?;
    let repayment = extract_repayment_data_from_map(&raw.value_base64, "repayment")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "PaymentRecorded".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "loan_id": loan_id.to_string(),
            "repayment_id": repayment_id.to_string(),
            "offtaker_received": repayment.offtaker_received.to_string(),
            "senior_principal_repaid": repayment.senior_principal_repaid.to_string(),
            "senior_interest": repayment.senior_interest.to_string(),
            "equity_distributed": repayment.equity_distributed.to_string(),
            "mgmt_fee": repayment.mgmt_fee.to_string(),
            "perf_fee": repayment.perf_fee.to_string(),
            "oet_alloc": repayment.oet_alloc.to_string(),
        }),
    })
}

/// LoanRegistry `LoanRolledOver` event.
/// topics: [loan_rolled_over, loan_id: u32]
/// value:  Map { new_maturity_timestamp: u64, new_rate: u32 }
/// stored event_name = "LoanRolledOver"
pub fn parse_loan_rolled_over(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "loan_rolled_over" {
        return None;
    }
    if raw.topics_base64.len() < 2 {
        return None;
    }

    let loan_id = extract_u32(&raw.topics_base64[1])?;
    let new_rate = extract_u32_from_map(&raw.value_base64, "new_rate")?;
    let new_maturity_timestamp = extract_u64_from_map(&raw.value_base64, "new_maturity_timestamp")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "LoanRolledOver".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "loan_id": loan_id.to_string(),
            "new_rate": new_rate,
            "new_maturity_timestamp": new_maturity_timestamp.to_string(),
        }),
    })
}

/// LoanRegistry `EconomicsAmended` event.
/// topics: [economics_amended, loan_id: u32]
/// value:  Map { new_maturity_timestamp: u64, new_rate: u32 }
/// stored event_name = "EconomicsAmended"
pub fn parse_economics_amended(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "economics_amended" {
        return None;
    }
    if raw.topics_base64.len() < 2 {
        return None;
    }

    let loan_id = extract_u32(&raw.topics_base64[1])?;
    let new_rate = extract_u32_from_map(&raw.value_base64, "new_rate")?;
    let new_maturity_timestamp = extract_u64_from_map(&raw.value_base64, "new_maturity_timestamp")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "EconomicsAmended".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "loan_id": loan_id.to_string(),
            "new_rate": new_rate,
            "new_maturity_timestamp": new_maturity_timestamp.to_string(),
        }),
    })
}

// ── ScVal helpers (pub for unit tests) ───────────────────────────────────────

/// Decode a base64-encoded XDR `ScVal::U32` topic into a `u32`.
pub fn extract_u32(b64: &str) -> Option<u32> {
    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::U32(v) => Some(v),
        _ => None,
    }
}

/// Decode a base64-encoded XDR `ScVal::U64` topic into a `u64`.
pub fn extract_u64(b64: &str) -> Option<u64> {
    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::U64(v) => Some(v),
        _ => None,
    }
}

/// Decode a base64-encoded XDR `ScVal::String` topic into a Rust `String`.
/// Used for `LocationUpdated.new_location` which Soroban stores as a full string topic
/// (unlike EVM's keccak-hashed indexed string).
pub fn extract_string(b64: &str) -> Option<String> {
    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::String(s) => Some(s.to_utf8_string_lossy()),
        _ => None,
    }
}

/// Decode the `LoanStatus` enum from a base64-encoded XDR topic.
///
/// Soroban's `#[contracttype]` encodes unit enum variants as
/// `ScVal::Vec([ScVal::Symbol("VariantName")])`. Returns the variant name string
/// (e.g. `"Performing"`, `"WatchList"`, `"Default"`, `"Closed"`), matching the
/// EVM `loan_status_name` convention in `loan_mapper.rs:29-37`.
pub fn extract_loan_status(b64: &str) -> Option<String> {
    extract_enum_variant_name(b64)
}

/// Decode the `ClosureReason` enum from a base64-encoded XDR topic.
///
/// Same encoding as `LoanStatus` — `ScVal::Vec([ScVal::Symbol("VariantName")])`.
/// Returns the variant name string (e.g. `"None"`, `"ScheduledMaturity"`, etc.),
/// matching the EVM `closure_reason_name` convention in `loan_mapper.rs:39-48`.
pub fn extract_closure_reason(b64: &str) -> Option<String> {
    extract_enum_variant_name(b64)
}

/// Decode a `u128` field from an outer `ScVal::Map` by key name.
///
/// `soroban-sdk` encodes `u128` as `ScVal::U128(UInt128Parts { hi, lo })`.
pub fn extract_u128_from_map(b64: &str, key: &str) -> Option<u128> {
    let entry = get_map_entry(b64, key)?;
    match entry {
        ScVal::U128(parts) => Some(u128_from_parts(parts.hi, parts.lo)),
        _ => None,
    }
}

/// Decode a `u32` field from an outer `ScVal::Map` by key name.
pub fn extract_u32_from_map(b64: &str, key: &str) -> Option<u32> {
    let entry = get_map_entry(b64, key)?;
    match entry {
        ScVal::U32(v) => Some(v),
        _ => None,
    }
}

/// Decode a `u64` field from an outer `ScVal::Map` by key name.
pub fn extract_u64_from_map(b64: &str, key: &str) -> Option<u64> {
    let entry = get_map_entry(b64, key)?;
    match entry {
        ScVal::U64(v) => Some(v),
        _ => None,
    }
}

/// Decode a `String` field from an outer `ScVal::Map` by key name.
pub fn extract_string_from_map(b64: &str, key: &str) -> Option<String> {
    let entry = get_map_entry(b64, key)?;
    match entry {
        ScVal::String(s) => Some(s.to_utf8_string_lossy()),
        _ => None,
    }
}

/// Decode a `RepaymentData` struct from an outer `ScVal::Map` by key name.
///
/// The value at `key` is itself a `ScVal::Map` with the 7 `u128` fields of
/// `RepaymentData` (alphabetically sorted by field name per `#[contracttype]`):
/// `equity_distributed`, `mgmt_fee`, `oet_alloc`, `offtaker_received`, `perf_fee`,
/// `senior_interest`, `senior_principal_repaid`.
///
/// Returns a `RepaymentDataView` with each field lifted to `alloy::primitives::U256`
/// via `U256::from(u128_value)` to match the existing view-struct field types.
pub fn extract_repayment_data_from_map(b64: &str, key: &str) -> Option<RepaymentDataView> {
    use alloy::primitives::U256;

    let entry = get_map_entry(b64, key)?;
    let ScVal::Map(Some(inner_map)) = entry else {
        return None;
    };

    let mut offtaker_received: Option<u128> = None;
    let mut senior_principal_repaid: Option<u128> = None;
    let mut senior_interest: Option<u128> = None;
    let mut equity_distributed: Option<u128> = None;
    let mut mgmt_fee: Option<u128> = None;
    let mut perf_fee: Option<u128> = None;
    let mut oet_alloc: Option<u128> = None;

    for entry in inner_map.0.iter() {
        if let ScVal::Symbol(sym) = &entry.key {
            let field_name = sym.0.to_utf8_string_lossy();
            if let ScVal::U128(parts) = &entry.val {
                let val = u128_from_parts(parts.hi, parts.lo);
                match field_name.as_str() {
                    "offtaker_received" => offtaker_received = Some(val),
                    "senior_principal_repaid" => senior_principal_repaid = Some(val),
                    "senior_interest" => senior_interest = Some(val),
                    "equity_distributed" => equity_distributed = Some(val),
                    "mgmt_fee" => mgmt_fee = Some(val),
                    "perf_fee" => perf_fee = Some(val),
                    "oet_alloc" => oet_alloc = Some(val),
                    _ => {}
                }
            }
        }
    }

    Some(RepaymentDataView {
        offtaker_received: U256::from(offtaker_received?),
        senior_principal_repaid: U256::from(senior_principal_repaid?),
        senior_interest: U256::from(senior_interest?),
        equity_distributed: U256::from(equity_distributed?),
        mgmt_fee: U256::from(mgmt_fee?),
        perf_fee: U256::from(perf_fee?),
        oet_alloc: U256::from(oet_alloc?),
    })
}

// ── Private helpers ───────────────────────────────────────────────────────────

/// Decode a `ScVal::Address` topic into an uppercase Strkey string (G… or C…).
/// Delegates to the same logic as `parsers::extract_address` — duplicated here to
/// avoid a circular dependency between the two sibling modules.
fn extract_address_topic(b64: &str) -> Option<String> {
    use stellar_xdr::curr::ScAddress;

    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::Address(addr) => match addr {
            ScAddress::Account(account_id) => {
                use stellar_xdr::curr::PublicKey;
                match &account_id.0 {
                    PublicKey::PublicKeyTypeEd25519(bytes) => {
                        let pk = stellar_strkey::ed25519::PublicKey(bytes.0);
                        Some(pk.to_string().to_string())
                    }
                }
            }
            ScAddress::Contract(contract_id) => {
                let strkey = stellar_strkey::Contract(contract_id.0 .0);
                Some(strkey.to_string().to_string())
            }
            _ => None,
        },
        _ => None,
    }
}

/// Decode a unit-variant `#[contracttype]` enum topic from base64 XDR.
///
/// soroban-sdk encodes unit enum variants as `ScVal::Vec([ScVal::Symbol("VariantName")])`.
/// Returns the variant name string.
fn extract_enum_variant_name(b64: &str) -> Option<String> {
    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::Vec(Some(vec_inner)) if vec_inner.0.len() == 1 => {
            if let ScVal::Symbol(sym) = &vec_inner.0[0] {
                Some(sym.0.to_utf8_string_lossy())
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Look up a key in an `ScVal::Map` and return the value by cloning it.
fn get_map_entry(b64: &str, key: &str) -> Option<ScVal> {
    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::Map(Some(map)) => {
            for entry in map.0.iter() {
                if let ScVal::Symbol(sym) = &entry.key {
                    if sym.0.to_utf8_string_lossy() == key {
                        return Some(entry.val.clone());
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn u128_from_parts(hi: u64, lo: u64) -> u128 {
    ((hi as u128) << 64) | (lo as u128)
}

// ── Conversion helpers ────────────────────────────────────────────────────────

/// Convert a `StellarLog` decoded from a LoanRegistry event into the worker-local
/// `LoanEvent<StellarAddress>` struct consumed by `LoanEventMapper`.
///
/// `StellarLog` is the general decoded form for all Stellar events; this conversion
/// makes it explicit that we are entering the generic loan-mapper path.
pub fn stellar_log_to_loan_event(
    log: crate::indexer::stellar::parsers::StellarLog,
) -> crate::indexer::loan_mapper::LoanEvent<
    crate::indexer::stellar::loan_registry_reader::StellarAddress,
> {
    use crate::indexer::stellar::loan_registry_reader::StellarAddress;
    crate::indexer::loan_mapper::LoanEvent {
        contract_address: StellarAddress(log.contract_address),
        event_name: log.event_name,
        block_number: log.block_number,
        tx_hash: log.tx_hash,
        log_index: log.log_index,
        block_timestamp: log.block_timestamp,
        params: log.params,
    }
}
