// spec: docs/product-specs/minter-cash-book.md#behavior
use std::collections::HashMap;
use std::str::FromStr;

use bigdecimal::{BigDecimal, ToPrimitive};
use serde_json::Value;
use shared::chains::{normalize_usdc_amount, ChainKind};
use shared::contract_logs_repo::MinterEventRow;
use shared::loan_event_params::json_i64;

use crate::formatting::base6_to_decimal_string;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireInStatus {
    Direct,
    Escrowed,
    Assigned,
    Returned,
}

impl WireInStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Direct => "Direct",
            Self::Escrowed => "Escrowed",
            Self::Assigned => "Assigned",
            Self::Returned => "Returned",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireOutStatus {
    Pending,
    Settled,
    Cancelled,
}

impl WireOutStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::Settled => "Settled",
            Self::Cancelled => "Cancelled",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RampStatus {
    Open,
    Closed,
}

impl RampStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "Open",
            Self::Closed => "Closed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CashBookWireIn {
    pub id: i64,
    pub status: WireInStatus,
    pub receiver: String,
    pub amount: i128,
    pub value_date: i64,
    pub ref_hash: String,
    pub recorded_at: i64,
    pub assigned_at: Option<i64>,
    pub returned_at: Option<i64>,
    pub return_ref_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CashBookWireOut {
    pub id: i64,
    pub status: WireOutStatus,
    pub lp: String,
    pub amount: i128,
    pub requested_at: i64,
    pub settled_at: Option<i64>,
    pub value_date: Option<i64>,
    pub ref_hash: Option<String>,
    pub cancelled_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CashBookRamp {
    pub id: i64,
    pub status: RampStatus,
    pub direction: String,
    pub amount: i128,
    pub opened_at: i64,
    pub open_ref_hash: String,
    pub received: Option<i128>,
    pub loss: Option<i128>,
    pub closed_at: Option<i64>,
    pub close_ref_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CashBookFold {
    pub bank_cash: i128,
    pub in_flight: i128,
    pub complete: bool,
    pub checkpoint_ledger: Option<i64>,
}

fn amount(params: &Value, key: &str) -> Option<i128> {
    match params.get(key)? {
        Value::String(s) => s.parse().ok(),
        Value::Number(n) => n.as_i64().map(i128::from),
        _ => None,
    }
}

fn text(params: &Value, key: &str) -> Option<String> {
    params.get(key)?.as_str().map(str::to_owned)
}

fn id(params: &Value) -> Option<i64> {
    json_i64(params.get("id")?)
}

fn date(params: &Value, key: &str) -> Option<i64> {
    json_i64(params.get(key)?)
}

pub fn build_wire_ins(rows: &[MinterEventRow], minter: &str) -> Vec<CashBookWireIn> {
    let mut out: Vec<CashBookWireIn> = Vec::new();
    let mut index: HashMap<i64, usize> = HashMap::new();
    for row in rows {
        let p = &row.params;
        match row.event_name.as_str() {
            "WireIn" => {
                let (Some(id), Some(receiver), Some(amount), Some(value_date), Some(ref_hash)) = (
                    id(p),
                    text(p, "receiver"),
                    amount(p, "amount"),
                    date(p, "value_date"),
                    text(p, "ref_hash"),
                ) else {
                    continue;
                };
                let status = if receiver == minter {
                    WireInStatus::Escrowed
                } else {
                    WireInStatus::Direct
                };
                index.insert(id, out.len());
                out.push(CashBookWireIn {
                    id,
                    status,
                    receiver,
                    amount,
                    value_date,
                    ref_hash,
                    recorded_at: row.block_timestamp,
                    assigned_at: None,
                    returned_at: None,
                    return_ref_hash: None,
                });
            }
            "WireInAssigned" => {
                let (Some(id), Some(receiver)) = (id(p), text(p, "receiver")) else {
                    continue;
                };
                if let Some(&i) = index.get(&id) {
                    out[i].status = WireInStatus::Assigned;
                    out[i].receiver = receiver;
                    out[i].assigned_at = Some(row.block_timestamp);
                }
            }
            "WireInReturned" => {
                let Some(id) = id(p) else { continue };
                if let Some(&i) = index.get(&id) {
                    out[i].status = WireInStatus::Returned;
                    out[i].returned_at = Some(row.block_timestamp);
                    out[i].return_ref_hash = text(p, "ref_hash");
                }
            }
            _ => {}
        }
    }
    out.sort_by_key(|w| std::cmp::Reverse(w.id));
    out
}

pub fn build_lp_wire_ins(
    rows: &[MinterEventRow],
    minter: &str,
    wallet: &str,
) -> Vec<CashBookWireIn> {
    build_wire_ins(rows, minter)
        .into_iter()
        .filter(|w| matches!(w.status, WireInStatus::Direct | WireInStatus::Assigned))
        .filter(|w| w.receiver == wallet)
        .collect()
}

pub fn build_wire_outs(rows: &[MinterEventRow]) -> Vec<CashBookWireOut> {
    let mut out: Vec<CashBookWireOut> = Vec::new();
    let mut index: HashMap<i64, usize> = HashMap::new();
    for row in rows {
        let p = &row.params;
        match row.event_name.as_str() {
            "WireOutRequested" => {
                let (Some(id), Some(lp), Some(amount)) =
                    (id(p), text(p, "lp"), amount(p, "amount"))
                else {
                    continue;
                };
                index.insert(id, out.len());
                out.push(CashBookWireOut {
                    id,
                    status: WireOutStatus::Pending,
                    lp,
                    amount,
                    requested_at: row.block_timestamp,
                    settled_at: None,
                    value_date: None,
                    ref_hash: None,
                    cancelled_at: None,
                });
            }
            "WireOutSettled" => {
                let Some(id) = id(p) else { continue };
                if let Some(&i) = index.get(&id) {
                    out[i].status = WireOutStatus::Settled;
                    out[i].settled_at = Some(row.block_timestamp);
                    out[i].value_date = date(p, "value_date");
                    out[i].ref_hash = text(p, "ref_hash");
                }
            }
            "WireOutCancelled" => {
                let Some(id) = id(p) else { continue };
                if let Some(&i) = index.get(&id) {
                    out[i].status = WireOutStatus::Cancelled;
                    out[i].cancelled_at = Some(row.block_timestamp);
                }
            }
            _ => {}
        }
    }
    out.sort_by_key(|w| std::cmp::Reverse(w.id));
    out
}

fn escrow_steps_with(
    wire_outs: &[CashBookWireOut],
    units_of: impl Fn(i128) -> Option<i128>,
) -> Vec<(i64, i128)> {
    let mut steps = Vec::with_capacity(wire_outs.len() * 2);
    let mut dropped = 0usize;
    for w in wire_outs {
        let units = (w.amount > 0).then(|| units_of(w.amount)).flatten();
        let Some(units) = units else {
            dropped += 1;
            continue;
        };
        steps.push((w.requested_at, units));
        if let Some(closed_at) = w.settled_at.or(w.cancelled_at) {
            match units.checked_neg() {
                Some(neg) => steps.push((closed_at, neg)),
                None => dropped += 1,
            }
        }
    }
    if dropped > 0 {
        tracing::warn!(dropped, "ignored wire-outs with a non-positive amount");
    }
    steps.sort_by_key(|&(at, delta)| (at, delta < 0));
    steps
}

pub fn wire_out_escrow_steps(wire_outs: &[CashBookWireOut], kind: ChainKind) -> Vec<(i64, i128)> {
    escrow_steps_with(wire_outs, |amount| match kind {
        ChainKind::Stellar => normalized_base6(amount).to_i128(),
        ChainKind::Evm => Some(amount),
    })
}

pub fn wire_out_raw_steps(wire_outs: &[CashBookWireOut]) -> Vec<(i64, i128)> {
    escrow_steps_with(wire_outs, Some)
}

pub fn build_ramps(rows: &[MinterEventRow]) -> Vec<CashBookRamp> {
    let mut out: Vec<CashBookRamp> = Vec::new();
    let mut index: HashMap<i64, usize> = HashMap::new();
    for row in rows {
        let p = &row.params;
        match row.event_name.as_str() {
            "RampOpened" => {
                let (Some(id), Some(direction), Some(amount), Some(ref_hash)) = (
                    id(p),
                    text(p, "direction"),
                    amount(p, "amount"),
                    text(p, "ref_hash"),
                ) else {
                    continue;
                };
                index.insert(id, out.len());
                out.push(CashBookRamp {
                    id,
                    status: RampStatus::Open,
                    direction,
                    amount,
                    opened_at: row.block_timestamp,
                    open_ref_hash: ref_hash,
                    received: None,
                    loss: None,
                    closed_at: None,
                    close_ref_hash: None,
                });
            }
            "RampClosed" => {
                let Some(id) = id(p) else { continue };
                if let Some(&i) = index.get(&id) {
                    out[i].status = RampStatus::Closed;
                    out[i].received = amount(p, "received");
                    out[i].loss = amount(p, "loss");
                    out[i].closed_at = Some(row.block_timestamp);
                    out[i].close_ref_hash = text(p, "ref_hash");
                }
            }
            _ => {}
        }
    }
    out.sort_by_key(|r| std::cmp::Reverse(r.id));
    out
}

struct Checkpoint {
    index: usize,
    ledger: i64,
    bank_cash: i128,
    in_flight: i128,
}

fn parse_snapshot(index: usize, row: &MinterEventRow) -> Option<Checkpoint> {
    if row.event_name != "MinterSnapshot" {
        return None;
    }
    let p = &row.params;
    for key in ["outstanding_total", "unabsorbed_total", "total_assets"] {
        amount(p, key)?;
    }
    p.get("read_failed")?.as_bool()?;
    Some(Checkpoint {
        index,
        ledger: json_i64(p.get("ledger")?)?,
        bank_cash: amount(p, "bank_cash")?,
        in_flight: amount(p, "in_flight")?,
    })
}

fn ramp_opens(rows: &[MinterEventRow]) -> HashMap<i64, (String, i128)> {
    rows.iter()
        .filter(|r| r.event_name == "RampOpened")
        .filter_map(|r| {
            let p = &r.params;
            Some((id(p)?, (text(p, "direction")?, amount(p, "amount")?)))
        })
        .collect()
}

fn apply(
    row: &MinterEventRow,
    opens: &HashMap<i64, (String, i128)>,
    bank: &mut i128,
    flight: &mut i128,
) -> bool {
    let p = &row.params;
    match row.event_name.as_str() {
        "WireIn" | "CashDisbursementReversed" => amount(p, "amount").map(|a| *bank += a).is_some(),
        "CashRepaid" => amount(p, "cash").map(|a| *bank += a).is_some(),
        "WireInReturned" | "CashDisbursed" | "WireOutSettled" => {
            amount(p, "amount").map(|a| *bank -= a).is_some()
        }
        "CashRepaymentReversed" => amount(p, "cash").map(|a| *bank -= a).is_some(),
        "CashRecorded" => amount(p, "delta").map(|a| *bank += a).is_some(),
        "RampOpened" => {
            let Some((direction, opened)) = id(p).and_then(|i| opens.get(&i)) else {
                return false;
            };
            *flight += opened;
            match direction.as_str() {
                "BankToUsdc" => {
                    *bank -= opened;
                    true
                }
                "UsdcToBank" => true,
                _ => false,
            }
        }
        "RampClosed" => {
            let (Some(received), Some(loss)) = (amount(p, "received"), amount(p, "loss")) else {
                return false;
            };
            *flight -= received + loss;
            let Some((direction, opened)) = id(p).and_then(|i| opens.get(&i)) else {
                return false;
            };
            if received + loss != *opened {
                return false;
            }
            match direction.as_str() {
                "UsdcToBank" => {
                    *bank += received;
                    true
                }
                "BankToUsdc" => true,
                _ => false,
            }
        }
        _ => true,
    }
}

pub fn fold_cash(rows: &[MinterEventRow]) -> CashBookFold {
    let checkpoint = rows
        .iter()
        .enumerate()
        .rev()
        .find_map(|(i, r)| parse_snapshot(i, r));
    let opens = ramp_opens(rows);
    let mut bank = checkpoint.as_ref().map_or(0, |c| c.bank_cash);
    let mut flight = checkpoint.as_ref().map_or(0, |c| c.in_flight);
    let mut complete = checkpoint.is_some();
    let after = checkpoint.as_ref().map_or(0, |c| c.index + 1);
    for row in &rows[after..] {
        if !apply(row, &opens, &mut bank, &mut flight) {
            complete = false;
        }
    }
    CashBookFold {
        bank_cash: bank,
        in_flight: flight,
        complete,
        checkpoint_ledger: checkpoint.map(|c| c.ledger),
    }
}

pub fn normalized_base6(raw: i128) -> BigDecimal {
    let value = BigDecimal::from_str(&raw.to_string()).unwrap_or_default();
    normalize_usdc_amount(ChainKind::Stellar, &value)
}

pub fn to_base6_string(raw: i128) -> String {
    base6_to_decimal_string(&normalized_base6(raw))
}
