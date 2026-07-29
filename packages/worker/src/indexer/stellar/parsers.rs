/// Pure decoder functions for Soroban contract events.
///
/// Each parser takes a `RawEvent` and returns `Some(StellarLog)` on success or `None`
/// on topic mismatch / missing data. No DB access, no RPC calls — pure decoding.
///
/// Event layout per `#[contractevent]` macro (soroban-sdk):
/// - `topics[0]` = `ScVal::Symbol(snake_case_event_name)` — the canonical discriminator.
/// - `topics[1..n]` = `#[topic]`-annotated fields in declaration order.
/// - `value` = `ScVal::Map(...)` with non-topic fields (sorted alphabetically by field name).
///
/// Note: `extract_i128` was promoted to `crate::stellar::scval` (Issue #568) and is
/// re-exported from here for backward compatibility. New callers should import from
/// `crate::stellar::scval` directly.
use serde_json::{json, Value};
use stellar_xdr::curr::{Limits, ReadXdr, ScAddress, ScVal};

use crate::indexer::stellar::loan_registry_parsers::{
    extract_u128_from_map, parse_ccr_updated, parse_economics_amended, parse_loan_closed,
    parse_loan_defaulted, parse_loan_drawn, parse_loan_rolled_over, parse_location_updated,
    parse_payment_recorded, parse_status_updated,
};

pub use crate::stellar::scval::extract_i128;

use crate::indexer::stellar::rpc::RawEvent;

/// A fully-decoded Soroban contract event, ready to be persisted as a `contract_logs` row.
pub struct StellarLog {
    /// Strkey (C…) contract address — stored as-is, no lowercasing (see Open Q4).
    pub contract_address: String,
    /// Event name stored in `contract_logs.event_name`. May be remapped
    /// (e.g., Vault `Deposit` → `"StakingDeposit"` for EVM analytics parity).
    pub event_name: String,
    /// Ledger sequence (maps to `block_number`).
    pub block_number: u64,
    /// Transaction hash (hex, no 0x prefix).
    pub tx_hash: String,
    /// Synthesised log index: `tx_index * 1000 + op_index * 100 + event_index_in_op`.
    /// Fits in `INT` for all realistic Soroban tx patterns; see risk note in design doc.
    pub log_index: u64,
    /// Ledger close time as Unix seconds (pre-populated from `ledgerClosedAt`).
    pub block_timestamp: u64,
    /// Event-specific params JSON — mirrors the EVM `params` column shape.
    pub params: Value,
}

// ── Public parsers ────────────────────────────────────────────────────────────

/// DepositManager `DepositRequested` event.
/// topics: [deposit_requested, request_id: u128, user: Address]
/// value:  Map { amount: i128 }
pub fn parse_deposit_requested(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "deposit_requested" {
        return None;
    }
    if raw.topics_base64.len() < 3 {
        return None;
    }

    let request_id = extract_u128(&raw.topics_base64[1])?;
    let user = extract_address(&raw.topics_base64[2])?;
    let amount = extract_i128_from_map(&raw.value_base64, "amount")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "DepositRequested".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "request_id": request_id.to_string(),
            "user": user,
            "amount": amount.to_string(),
        }),
    })
}

/// WithdrawalQueue `WithdrawalRequested` event.
/// topics: [withdrawal_requested, withdrawer: Address, request_id: u128]
/// value:  Map { amount: i128, queued: i128 }
pub fn parse_withdrawal_requested(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "withdrawal_requested" {
        return None;
    }
    if raw.topics_base64.len() < 3 {
        return None;
    }

    let withdrawer = extract_address(&raw.topics_base64[1])?;
    let request_id = extract_u128(&raw.topics_base64[2])?;
    let amount = extract_i128_from_map(&raw.value_base64, "amount")?;
    let queued = extract_i128_from_map(&raw.value_base64, "queued")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "WithdrawalRequested".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "withdrawer": withdrawer,
            "request_id": request_id.to_string(),
            "amount": amount.to_string(),
            "queued": queued.to_string(),
        }),
    })
}

/// Shared `request_queue::claim_request` `RequestClaimed` event — emitted by both
/// DepositManager and WithdrawalQueue.
/// topics: [request_claimed, request_id: u128, user: Address]
/// value:  Map { amount: i128 }
pub fn parse_request_claimed(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "request_claimed" {
        return None;
    }
    if raw.topics_base64.len() < 3 {
        return None;
    }

    let request_id = extract_u128(&raw.topics_base64[1])?;
    let user = extract_address(&raw.topics_base64[2])?;
    let amount = extract_i128_from_map(&raw.value_base64, "amount")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "RequestClaimed".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "request_id": request_id.to_string(),
            "user": user,
            "amount": amount.to_string(),
        }),
    })
}

/// StakedPipelineUSD `Deposit` (from `stellar_tokens::vault::Vault`).
/// Remapped to `event_name = "StakingDeposit"` for EVM analytics parity.
/// topics: [deposit, operator: Address, from: Address, receiver: Address]
/// value:  Map { assets: i128, shares: i128 }
///
/// `params` is normalized to the ERC-4626 shape so downstream consumers
/// (`/v1/requests` analytics, the position-fields mapper) can key on `owner`:
/// `sender` = Soroban `operator` (the caller), `owner` = Soroban `receiver`
/// (the share holder). The `from` topic is decoded for event-shape validation
/// but not persisted — it's redundant with `sender`/`owner` in the normal
/// end-user deposit flow.
pub fn parse_vault_deposit(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "deposit" {
        return None;
    }
    if raw.topics_base64.len() < 4 {
        return None;
    }

    let operator = extract_address(&raw.topics_base64[1])?;
    let _from = extract_address(&raw.topics_base64[2])?;
    let receiver = extract_address(&raw.topics_base64[3])?;
    let assets = extract_i128_from_map(&raw.value_base64, "assets")?;
    let shares = extract_i128_from_map(&raw.value_base64, "shares")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "StakingDeposit".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "sender": operator,
            "owner": receiver,
            "assets": assets.to_string(),
            "shares": shares.to_string(),
        }),
    })
}

/// StakedPipelineUSD `Withdraw` (from `stellar_tokens::vault::Vault`).
/// Remapped to `event_name = "StakingWithdrawal"` for EVM analytics parity.
/// topics: [withdraw, operator: Address, receiver: Address, owner: Address]
/// value:  Map { assets: i128, shares: i128 }
///
/// `params` matches the EVM ERC-4626 shape: `sender` (= Soroban `operator`,
/// the caller), `receiver` (assets destination), `owner` (share holder being
/// burned). The Stellar topic naming `operator` is renamed to `sender` so
/// downstream code can read a single field name across chains.
pub fn parse_vault_withdraw(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "withdraw" {
        return None;
    }
    if raw.topics_base64.len() < 4 {
        return None;
    }

    let operator = extract_address(&raw.topics_base64[1])?;
    let receiver = extract_address(&raw.topics_base64[2])?;
    let owner = extract_address(&raw.topics_base64[3])?;
    let assets = extract_i128_from_map(&raw.value_base64, "assets")?;
    let shares = extract_i128_from_map(&raw.value_base64, "shares")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "StakingWithdrawal".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "sender": operator,
            "receiver": receiver,
            "owner": owner,
            "assets": assets.to_string(),
            "shares": shares.to_string(),
        }),
    })
}

/// YieldMinter `YieldMinted` event.
/// topics: [yield_minted]
/// value:  Map { s_plusd_amount: u128, treasury_amount: u128 }
///
/// Params shape matches the EVM `parse_yield_minted` in `packages/worker/src/indexer/parsers.rs`
/// so that `list_yield_mints` (`params->>'s_plusd_amount'`) works identically on both chains.
/// On Stellar this event is loan-repayment-only: `s_plusd_amount` = net senior coupon,
/// `treasury_amount` = mgmt_fee + perf_fee + oet_alloc.
pub fn parse_yield_minted(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "yield_minted" {
        return None;
    }
    if raw.topics_base64.is_empty() {
        return None;
    }

    let s_plusd_amount = extract_u128_from_map(&raw.value_base64, "s_plusd_amount")?;
    let treasury_amount = extract_u128_from_map(&raw.value_base64, "treasury_amount")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "YieldMinted".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "s_plusd_amount": s_plusd_amount.to_string(),
            "treasury_amount": treasury_amount.to_string(),
        }),
    })
}

/// SAC / SEP-41 asset `transfer` event.
/// topics: [transfer, from: Address, to: Address, (optional) sep0011 asset: String]
/// value:  i128 amount (plain `ScVal::I128`), or `Map { amount: i128 }` on
///         muxed / newer-protocol variants.
///
/// Remapped to `event_name = "AssetTransfer"`. Only `from` / `to` / `amount`
/// are persisted (raw transfer, no role/direction labeling — see Issue #789).
/// Membership filtering against the custody/ramp sets happens in the poller;
/// this decoder is intentionally address-agnostic and pure.
pub fn parse_asset_transfer(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "transfer" {
        return None;
    }
    if raw.topics_base64.len() < 3 {
        return None;
    }

    let from = extract_address(&raw.topics_base64[1])?;
    let to = extract_address(&raw.topics_base64[2])?;
    // Standard SAC transfer carries the amount as a plain i128 value; tolerate a
    // `Map { amount }` shape for muxed / newer-protocol variants.
    let amount = extract_i128(&raw.value_base64)
        .or_else(|| extract_i128_from_map(&raw.value_base64, "amount"))?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "AssetTransfer".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "from": from,
            "to": to,
            "amount": amount.to_string(),
        }),
    })
}

/// True when **both** a transfer's `from` and `to` are in the tracked address
/// set (custody ∪ ramp) — i.e. an internal movement between tracked accounts.
/// Transfers with an untracked counterparty (external inflows/outflows) are
/// excluded. Pure helper so the poller's filter is unit-testable.
pub fn transfer_between_tracked<S: std::hash::BuildHasher>(
    from: &str,
    to: &str,
    tracked: &std::collections::HashSet<String, S>,
) -> bool {
    tracked.contains(from) && tracked.contains(to)
}

/// True when a transfer's `from` **or** `to` matches a single tracked contract
/// — one-sided, any counterparty. Used for the WithdrawalQueue (Issue #933):
/// every USDC movement in or out is of interest, not just movements between two
/// already-tracked accounts (contrast `transfer_between_tracked`, which is AND).
/// Pure helper so the poller's filter is unit-testable.
pub fn transfer_touches_address(from: &str, to: &str, address: &str) -> bool {
    from == address || to == address
}

// ── ScVal helpers (exposed for unit tests) ────────────────────────────────────

/// Decode a base64-encoded XDR `ScVal::U128` into a `u128`.
pub fn extract_u128(b64: &str) -> Option<u128> {
    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::U128(parts) => Some(u128_from_parts(parts.hi, parts.lo)),
        _ => None,
    }
}

/// Decode a base64-encoded XDR `ScVal::Address` into an uppercase Strkey string.
/// Handles both `Account` (G…) and `Contract` (C…) address types.
pub fn extract_address(b64: &str) -> Option<String> {
    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::Address(addr) => sc_address_to_strkey(&addr),
        _ => None,
    }
}

/// Decode the named `i128` field from a Map-encoded ScVal value.
///
/// The `#[contractevent]` macro encodes non-topic fields as a `ScVal::Map`
/// with string Symbol keys and ScVal values, sorted alphabetically.
pub fn extract_i128_from_map(b64: &str, key: &str) -> Option<i128> {
    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::Map(Some(map)) => {
            for entry in map.0.iter() {
                if let ScVal::Symbol(sym) = &entry.key {
                    if sym.0.to_utf8_string_lossy() == key {
                        if let ScVal::I128(parts) = &entry.val {
                            return Some(i128_from_parts(parts.hi, parts.lo));
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/// Synthesise a `log_index` from Soroban event coordinates.
///
/// Formula: `tx_index * 1000 + op_index * 100 + event_index_in_op`
///
/// Risk: collapses if any tx emits >100 events per op or >10 ops per tx.
/// For the events we care about, each fires once per operation — well within limits.
pub fn synthesise_log_index(tx_index: u32, op_index: u32, event_index_in_op: u32) -> u64 {
    tx_index as u64 * 1000 + op_index as u64 * 100 + event_index_in_op as u64
}

fn u128_from_parts(hi: u64, lo: u64) -> u128 {
    ((hi as u128) << 64) | (lo as u128)
}

fn i128_from_parts(hi: i64, lo: u64) -> i128 {
    ((hi as i128) << 64) | (lo as i128)
}

fn sc_address_to_strkey(addr: &ScAddress) -> Option<String> {
    match addr {
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
        // Other address types (MuxedAccount, ClaimableBalance, LiquidityPool) are not
        // expected in our event streams; return None to signal a parse failure.
        _ => None,
    }
}

/// Dispatch a `RawEvent` to the parsers permitted for its emitting contract.
///
/// Mirrors the EVM `add_event_handler(contracts.<type>_contracts, …)` binding in
/// `evm_parsers.rs`: each parser group only runs for events from the contract
/// whose role it represents. The Soroban RPC `contractIds` filter is the first
/// line of defense; this is the second — fail closed for any contract id that
/// is not one of the configured roles.
///
/// `request_claimed` is intentionally shared between DepositManager and
/// WithdrawalQueue (`request_queue::claim_request` emits it from both).
///
/// `loan_registry_id` is `None` when the contract has not yet been deployed
/// (ships dark — the new branch is a no-op until the env var is set).
///
/// `yield_minter_id` is `None` when the YieldMinter contract has not yet been deployed to
/// this chain. When set, `YieldMinted` events are collected and routed to `StellarLogMapper`
/// (contract_logs), matching the EVM path. Loan-repayment-only on Stellar today.
///
/// `asset_id` is `Some` when asset-transfer tracking is configured (Issue #789 /
/// #933). When set, `transfer` events from the asset contract are decoded to
/// `"AssetTransfer"` logs; the poller then filters them — one-sided against the
/// WithdrawalQueue, and/or both-sides against the custody/ramp set — before
/// persisting.
pub fn dispatch_parser(
    raw: &RawEvent,
    deposit_manager_id: &str,
    withdrawal_queue_id: &str,
    staked_plusd_id: &str,
    loan_registry_id: Option<&str>,
    yield_minter_id: Option<&str>,
    asset_id: Option<&str>,
) -> Option<StellarLog> {
    if raw.contract_id == deposit_manager_id {
        parse_deposit_requested(raw).or_else(|| parse_request_claimed(raw))
    } else if raw.contract_id == withdrawal_queue_id {
        parse_withdrawal_requested(raw).or_else(|| parse_request_claimed(raw))
    } else if raw.contract_id == staked_plusd_id {
        parse_vault_deposit(raw).or_else(|| parse_vault_withdraw(raw))
    } else if loan_registry_id == Some(raw.contract_id.as_str()) {
        // LoanRegistry events — all 9 events, tried in order.
        // Returns None for any event not emitted by the LoanRegistry contract.
        parse_loan_drawn(raw)
            .or_else(|| parse_status_updated(raw))
            .or_else(|| parse_ccr_updated(raw))
            .or_else(|| parse_location_updated(raw))
            .or_else(|| parse_loan_defaulted(raw))
            .or_else(|| parse_loan_closed(raw))
            .or_else(|| parse_payment_recorded(raw))
            .or_else(|| parse_loan_rolled_over(raw))
            .or_else(|| parse_economics_amended(raw))
    } else if yield_minter_id == Some(raw.contract_id.as_str()) {
        // YieldMinter events — routes to StellarLogMapper → contract_logs.
        parse_yield_minted(raw)
    } else if asset_id == Some(raw.contract_id.as_str()) {
        // Asset (SAC) transfer events — routed to StellarLogMapper → contract_logs
        // after the poller applies the custody/ramp membership filter.
        parse_asset_transfer(raw)
    } else {
        // The RPC `contractIds` filter should make this branch unreachable.
        // If we ever hit it, either config has drifted from what the RPC was
        // told to filter on, or the RPC ignored the filter — both are
        // observability signals worth surfacing rather than swallowing.
        tracing::warn!(
            contract_id = %raw.contract_id,
            "stellar event from unexpected contract — RPC contractIds filter drift?"
        );
        None
    }
}
