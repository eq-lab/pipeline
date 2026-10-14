// spec: docs/references/backend.md#stellar-deal-token-factory-indexing
use std::collections::HashMap;

use serde_json::{json, Value};
use shared::contract_logs_repo::DealRegistrationRow;

use crate::indexer::stellar::loan_registry_parsers::extract_u32;
use crate::indexer::stellar::parsers::{
    extract_address, extract_address_from_map, extract_i128, extract_i128_from_map,
    synthesise_log_index, StellarLog,
};
use crate::indexer::stellar::rpc::RawEvent;

pub const DEAL_TOKEN_FACTORY_EVENT_TOPICS: [&str; 3] =
    ["deal_registered", "debt_synced", "cargo_synced"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DealTokenKind {
    Debt,
    Cargo,
}

impl DealTokenKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DealTokenKind::Debt => "debt",
            DealTokenKind::Cargo => "cargo",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DealTokenRef {
    pub loan_id: String,
    pub kind: DealTokenKind,
}

#[derive(Default)]
pub struct DealTokenSet {
    tokens: HashMap<String, DealTokenRef>,
}

impl DealTokenSet {
    pub fn insert_deal(&mut self, loan_id: &str, debt: &str, cargo: &str) -> usize {
        let mut added = 0;
        for (id, kind) in [(debt, DealTokenKind::Debt), (cargo, DealTokenKind::Cargo)] {
            if !self.tokens.contains_key(id) {
                self.tokens.insert(
                    id.to_owned(),
                    DealTokenRef {
                        loan_id: loan_id.to_owned(),
                        kind,
                    },
                );
                added += 1;
            }
        }
        added
    }

    pub fn seed(&mut self, rows: &[DealRegistrationRow]) -> usize {
        let mut added = 0;
        for row in rows {
            let valid = stellar_strkey::Contract::from_string(&row.debt).is_ok()
                && stellar_strkey::Contract::from_string(&row.cargo).is_ok();
            if !valid {
                tracing::warn!(
                    loan_id = %row.loan_id,
                    debt = %row.debt,
                    cargo = %row.cargo,
                    "skipping DealRegistered row whose debt/cargo is not a Stellar contract id"
                );
                continue;
            }
            added += self.insert_deal(&row.loan_id, &row.debt, &row.cargo);
        }
        added
    }

    pub fn get(&self, contract_id: &str) -> Option<DealTokenRef> {
        self.tokens.get(contract_id).cloned()
    }

    pub fn contract_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.tokens.keys().cloned().collect();
        ids.sort();
        ids
    }

    pub fn len(&self) -> usize {
        self.tokens.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }

    pub fn absorb_deal_registered(&mut self, log: &StellarLog) -> bool {
        if log.event_name != "DealRegistered" {
            return false;
        }
        let field = |k: &str| log.params.get(k).and_then(Value::as_str);
        let (Some(loan_id), Some(debt), Some(cargo)) =
            (field("loan_id"), field("debt"), field("cargo"))
        else {
            return false;
        };
        self.insert_deal(loan_id, debt, cargo);
        true
    }
}

fn base_log(raw: &RawEvent, event_name: &str, params: Value) -> StellarLog {
    StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: event_name.to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params,
    }
}

fn loan_id_topic(raw: &RawEvent) -> Option<u32> {
    extract_u32(raw.topics_base64.get(1)?)
}

fn i128_field(raw: &RawEvent, key: &str) -> Option<String> {
    extract_i128_from_map(&raw.value_base64, key).map(|v| v.to_string())
}

pub fn parse_deal_registered(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "deal_registered" {
        return None;
    }
    let loan_id = loan_id_topic(raw)?;
    let debt = extract_address_from_map(&raw.value_base64, "debt")?;
    let cargo = extract_address_from_map(&raw.value_base64, "cargo")?;
    Some(base_log(
        raw,
        "DealRegistered",
        json!({ "loan_id": loan_id.to_string(), "debt": debt, "cargo": cargo }),
    ))
}

pub fn parse_debt_synced(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "debt_synced" {
        return None;
    }
    let loan_id = loan_id_topic(raw)?;
    Some(base_log(
        raw,
        "DebtSynced",
        json!({
            "loan_id": loan_id.to_string(),
            "target": i128_field(raw, "target")?,
            "previous": i128_field(raw, "previous")?,
            "minted": i128_field(raw, "minted")?,
            "clawed": i128_field(raw, "clawed")?,
        }),
    ))
}

pub fn parse_cargo_synced(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "cargo_synced" {
        return None;
    }
    let loan_id = loan_id_topic(raw)?;
    Some(base_log(
        raw,
        "CargoSynced",
        json!({
            "loan_id": loan_id.to_string(),
            "target": i128_field(raw, "target")?,
            "previous": i128_field(raw, "previous")?,
            "minted": i128_field(raw, "minted")?,
            "burned": i128_field(raw, "burned")?,
        }),
    ))
}

fn last_address_topic(raw: &RawEvent) -> Option<String> {
    raw.topics_base64
        .iter()
        .skip(1)
        .rev()
        .find_map(|t| extract_address(t))
}

pub fn parse_deal_token_movement(raw: &RawEvent, token: &DealTokenRef) -> Option<StellarLog> {
    let (from, to) = match raw.event_name.as_str() {
        "mint" => (None, Some(last_address_topic(raw)?)),
        "clawback" | "burn" => (Some(last_address_topic(raw)?), None),
        "transfer" => {
            if raw.topics_base64.len() < 3 {
                return None;
            }
            (
                Some(extract_address(&raw.topics_base64[1])?),
                Some(extract_address(&raw.topics_base64[2])?),
            )
        }
        _ => return None,
    };
    let amount = extract_i128(&raw.value_base64)
        .or_else(|| extract_i128_from_map(&raw.value_base64, "amount"))?;
    Some(base_log(
        raw,
        "DealTokenTransfer",
        json!({
            "loan_id": token.loan_id,
            "token_kind": token.kind.as_str(),
            "token": raw.contract_id,
            "from": from,
            "to": to,
            "amount": amount.to_string(),
        }),
    ))
}

pub fn route_deal_token_events(raws: &[RawEvent], set: &DealTokenSet) -> Vec<StellarLog> {
    let mut out = Vec::new();
    for raw in raws {
        let Some(token) = set.get(&raw.contract_id) else {
            tracing::warn!(
                contract_id = %raw.contract_id,
                "stellar event from a contract outside the deal-token set"
            );
            continue;
        };
        if let Some(log) = parse_deal_token_movement(raw, &token) {
            out.push(log);
        }
    }
    out
}
