// spec: docs/exec-plans/active/issue-1480-stellar-minter-cash-events.md
use serde_json::{json, Value};
use stellar_xdr::curr::{Limits, ReadXdr, ScVal};

use crate::indexer::stellar::loan_registry_parsers::{
    enum_variant_name, extract_u32, extract_u32_from_map, extract_u64_from_map, get_map_entry,
};
use crate::indexer::stellar::parsers::{
    extract_address_from_map, extract_bytes32_from_map, extract_i128_from_map,
    synthesise_log_index, StellarLog,
};
use crate::indexer::stellar::rpc::RawEvent;

// ── Shared helpers ────────────────────────────────────────────────────────────

fn build(raw: &RawEvent, name: &str, params: Value) -> StellarLog {
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

fn matches(raw: &RawEvent, topic: &str, min_topics: usize) -> bool {
    raw.event_name == topic && raw.topics_base64.len() >= min_topics
}

fn id_topic(raw: &RawEvent) -> Option<u32> {
    extract_u32(&raw.topics_base64[1])
}

fn amt(raw: &RawEvent, key: &str) -> Option<String> {
    extract_i128_from_map(&raw.value_base64, key).map(|v| v.to_string())
}

fn u32s(raw: &RawEvent, key: &str) -> Option<String> {
    extract_u32_from_map(&raw.value_base64, key).map(|v| v.to_string())
}

fn date(raw: &RawEvent) -> Option<String> {
    extract_u64_from_map(&raw.value_base64, "value_date").map(|v| v.to_string())
}

fn ref_hash(raw: &RawEvent) -> Option<String> {
    extract_bytes32_from_map(&raw.value_base64, "ref_hash")
}

// ── Public parsers ────────────────────────────────────────────────────────────

pub fn parse_wire_in_returned(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "wire_in_returned", 2) {
        return None;
    }
    let params = json!({
        "id": id_topic(raw)?.to_string(),
        "amount": amt(raw, "amount")?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "WireInReturned", params))
}

pub fn parse_cash_disbursed(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "cash_disbursed", 2) {
        return None;
    }
    let params = json!({
        "loan_id": id_topic(raw)?.to_string(),
        "entry_id": u32s(raw, "entry_id")?,
        "amount": amt(raw, "amount")?,
        "value_date": date(raw)?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "CashDisbursed", params))
}

pub fn parse_cash_disbursement_reversed(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "cash_disbursement_reversed", 2) {
        return None;
    }
    let params = json!({
        "loan_id": id_topic(raw)?.to_string(),
        "entry_id": u32s(raw, "entry_id")?,
        "original_id": u32s(raw, "original_id")?,
        "amount": amt(raw, "amount")?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "CashDisbursementReversed", params))
}

pub fn parse_cash_repaid(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "cash_repaid", 2) {
        return None;
    }
    let params = json!({
        "loan_id": id_topic(raw)?.to_string(),
        "repayment_id": u32s(raw, "repayment_id")?,
        "sale_id": u32s(raw, "sale_id")?,
        "cash": amt(raw, "cash")?,
        "interest_minted": amt(raw, "interest_minted")?,
        "fee_shares": amt(raw, "fee_shares")?,
        "value_date": date(raw)?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "CashRepaid", params))
}

pub fn parse_cash_repayment_reversed(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "cash_repayment_reversed", 2) {
        return None;
    }
    let params = json!({
        "loan_id": id_topic(raw)?.to_string(),
        "repayment_id": u32s(raw, "repayment_id")?,
        "cash": amt(raw, "cash")?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "CashRepaymentReversed", params))
}

pub fn parse_wire_out_requested(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "wire_out_requested", 2) {
        return None;
    }
    let params = json!({
        "id": id_topic(raw)?.to_string(),
        "lp": extract_address_from_map(&raw.value_base64, "lp")?,
        "amount": amt(raw, "amount")?,
    });
    Some(build(raw, "WireOutRequested", params))
}

pub fn parse_wire_out_settled(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "wire_out_settled", 2) {
        return None;
    }
    let params = json!({
        "id": id_topic(raw)?.to_string(),
        "amount": amt(raw, "amount")?,
        "value_date": date(raw)?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "WireOutSettled", params))
}

pub fn parse_wire_out_cancelled(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "wire_out_cancelled", 2) {
        return None;
    }
    let params = json!({ "id": id_topic(raw)?.to_string() });
    Some(build(raw, "WireOutCancelled", params))
}

pub fn parse_ramp_opened(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "ramp_opened", 2) {
        return None;
    }
    let direction = enum_variant_name(&get_map_entry(&raw.value_base64, "direction")?)?;
    let params = json!({
        "id": id_topic(raw)?.to_string(),
        "direction": direction,
        "amount": amt(raw, "amount")?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "RampOpened", params))
}

pub fn parse_ramp_closed(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "ramp_closed", 2) {
        return None;
    }
    let params = json!({
        "id": id_topic(raw)?.to_string(),
        "received": amt(raw, "received")?,
        "loss": amt(raw, "loss")?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "RampClosed", params))
}

pub fn parse_cash_recorded(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "cash_recorded", 2) {
        return None;
    }
    let kind = ScVal::from_xdr_base64(&raw.topics_base64[1], Limits::none()).ok()?;
    let params = json!({
        "reason": enum_variant_name(&kind)?,
        "entry_id": u32s(raw, "entry_id")?,
        "delta": amt(raw, "delta")?,
        "value_date": date(raw)?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "CashRecorded", params))
}

pub fn parse_mint_corrected(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "mint_corrected", 1) {
        return None;
    }
    let params = json!({
        "amount": amt(raw, "amount")?,
        "ref_hash": ref_hash(raw)?,
    });
    Some(build(raw, "MintCorrected", params))
}

pub fn parse_loss_absorbed(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "loss_absorbed", 1) {
        return None;
    }
    let params = json!({
        "requested": amt(raw, "requested")?,
        "pulled": amt(raw, "pulled")?,
    });
    Some(build(raw, "LossAbsorbed", params))
}
