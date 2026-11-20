// spec: docs/references/backend.md#plusd-transfer-indexing
use serde_json::json;

use crate::indexer::stellar::parsers::{decode_sac_movement, synthesise_log_index, StellarLog};
use crate::indexer::stellar::rpc::RawEvent;

pub const PLUSD_EVENT_TOPICS: [&str; 4] = ["transfer", "mint", "burn", "clawback"];

pub fn parse_plusd_event(raw: &RawEvent) -> Option<StellarLog> {
    let (kind, from, to, amount) = decode_sac_movement(raw)?;
    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "PlusdTransfer".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "kind": kind,
            "from": from,
            "to": to,
            "amount": amount.to_string(),
        }),
    })
}

pub fn dispatch_plusd(raw: &RawEvent) -> Option<StellarLog> {
    let parsed = parse_plusd_event(raw);
    if parsed.is_none() && PLUSD_EVENT_TOPICS.contains(&raw.event_name.as_str()) {
        tracing::warn!(
            contract_id = %raw.contract_id,
            event_name = %raw.event_name,
            ledger = raw.ledger,
            "PLUSD event recognised by name but not decodable"
        );
    }
    parsed
}
