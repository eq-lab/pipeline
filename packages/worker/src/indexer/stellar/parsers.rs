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
    extract_u32, extract_u64_from_map, get_map_entry, parse_disbursed, parse_economics_amended,
    parse_interest_adjusted, parse_loan_closed, parse_loan_defaulted, parse_loan_drawn,
    parse_loan_rolled_over, parse_loan_written_down, parse_payment_recorded,
    parse_payment_unrecorded, parse_status_updated, parse_undisbursed,
};

pub use crate::stellar::scval::extract_i128;
use crate::stellar::scval::i128_from_parts;

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

/// Minter `WireIn` event — a received bank wire, booked and minted (#1416).
/// topics: [wire_in, id: u32]
/// value:  Map { receiver: Address, amount: i128, value_date: u64, ref_hash: BytesN<32> }
///
/// `ref_hash` is `sha256(payment_reference)`, the key the relayer's wire-in
/// matching phase joins against `lp_bank_deposits.ref_hash`; it is stored as
/// lowercase hex, the same shape the API reports.
pub fn parse_wire_in(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "wire_in" {
        return None;
    }
    if raw.topics_base64.len() < 2 {
        return None;
    }

    let id = extract_u32(&raw.topics_base64[1])?;
    let receiver = extract_address_from_map(&raw.value_base64, "receiver")?;
    let amount = extract_i128_from_map(&raw.value_base64, "amount")?;
    let value_date = extract_u64_from_map(&raw.value_base64, "value_date")?;
    let ref_hash = extract_bytes32_from_map(&raw.value_base64, "ref_hash")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "WireIn".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "id": id,
            "receiver": receiver,
            "amount": amount.to_string(),
            "value_date": value_date.to_string(),
            "ref_hash": ref_hash,
        }),
    })
}

/// Minter `WireInAssigned` event — an escrowed wire staked for an LP (#1416).
/// topics: [wire_in_assigned, id: u32]
/// value:  Map { receiver: Address }
///
/// Carries no reference of its own: the matching phase recovers `ref_hash` from
/// this wire's own `WireIn` row by `id`.
pub fn parse_wire_in_assigned(raw: &RawEvent) -> Option<StellarLog> {
    if raw.event_name != "wire_in_assigned" {
        return None;
    }
    if raw.topics_base64.len() < 2 {
        return None;
    }

    let id = extract_u32(&raw.topics_base64[1])?;
    let receiver = extract_address_from_map(&raw.value_base64, "receiver")?;

    Some(StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: "WireInAssigned".to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: json!({
            "id": id,
            "receiver": receiver,
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
    parse_transfer_as(raw, "AssetTransfer")
}

/// StakedPipelineUSD share `transfer` event — the SEP-41 token half of the vault
/// (`stellar_tokens::fungible`, reached via `transfer` / `transfer_from`).
/// topics: [transfer, from: Address, to: Address]
/// value:  i128 amount (`Transfer`), or `Map { to_muxed_id, amount }`
///         (`MuxedTransfer`, when the destination is a muxed address).
///
/// Remapped to `event_name = "ShareTransfer"` — deliberately *not* reused as
/// `"AssetTransfer"`, whose consumers (`list_asset_transfers`,
/// `get_wallet_balance_as_of`) query by `event_name` with no
/// `contract_address` filter on the assumption that one asset is tracked per
/// chain. Sharing the name would fold share movements into USDC
/// custody/withdrawal-queue balances.
///
/// The vault's own mint/burn is **not** visible here: `Vault::deposit_internal`
/// and `withdraw_internal` call `Base::update` directly, which mutates balances
/// without emitting anything. Share creation/destruction is observable only via
/// `StakingDeposit` / `StakingWithdrawal`, so there is no double-count between
/// those and this event.
pub fn parse_share_transfer(raw: &RawEvent) -> Option<StellarLog> {
    parse_transfer_as(raw, "ShareTransfer")
}

/// Shared decoder for the SEP-41 `transfer` topic shape, which is identical for
/// the USDC SAC and the sPLUSD share token — only the stored `event_name`
/// differs. Keeping one body means the muxed/plain value handling can't drift
/// between the two callers.
fn parse_transfer_as(raw: &RawEvent, event_name: &str) -> Option<StellarLog> {
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
        event_name: event_name.to_owned(),
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

/// Decode the named `Address` field from a Map-encoded ScVal value, as an
/// uppercase Strkey. The topic-level `extract_address` takes a standalone
/// ScVal; a `#[contractevent]` field that is not a `#[topic]` lives in the map.
pub fn extract_address_from_map(b64: &str, key: &str) -> Option<String> {
    match get_map_entry(b64, key)? {
        ScVal::Address(addr) => sc_address_to_strkey(&addr),
        _ => None,
    }
}

/// Decode the named `BytesN<32>` field from a Map-encoded ScVal value as
/// lowercase hex. A payload of any other length is refused rather than padded
/// or truncated: a wrong-length hash would match no deposit and read as a
/// missing one.
pub fn extract_bytes32_from_map(b64: &str, key: &str) -> Option<String> {
    match get_map_entry(b64, key)? {
        ScVal::Bytes(bytes) if bytes.0.len() == 32 => Some(hex::encode(bytes.0.as_slice())),
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
/// `transfer` is likewise emitted by two configured roles and disambiguated by
/// contract id alone: from the StakedPipelineUSD vault it decodes to
/// `"ShareTransfer"` (per-user sPLUSD balance tracking), from `asset_id` to
/// `"AssetTransfer"` (USDC custody/ramp flows). The two must stay distinct —
/// see `parse_share_transfer`.
///
/// `loan_registry_id` is `None` when the contract has not yet been deployed
/// (ships dark — the new branch is a no-op until the env var is set).
///
/// `yield_minter_id` is `None` when the minter contract has not yet been deployed to
/// this chain. When set, `WireIn` / `WireInAssigned` events are collected and routed
/// to `StellarLogMapper` (contract_logs) for the relayer's wire-in matching (#1416).
/// `YieldMinted` is retired (#1433) — it belonged to a pre-#33 deployment this field
/// no longer targets.
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
        // Vault mint/burn (`deposit`/`withdraw` events, covering all four of
        // `deposit`/`mint`/`withdraw`/`redeem`) plus peer-to-peer share
        // movement. There is deliberately no token-level `mint`/`burn` parser:
        // the vault mutates balances through `Base::update`, which emits
        // nothing, and `FungibleBurnable` is not implemented on the contract —
        // so no such events exist. Should the contract ever start calling
        // `Base::mint` (which does emit `mint`), that event would double-count
        // against `StakingDeposit` and must not simply be added here.
        parse_vault_deposit(raw)
            .or_else(|| parse_vault_withdraw(raw))
            .or_else(|| parse_share_transfer(raw))
    } else if loan_registry_id == Some(raw.contract_id.as_str()) {
        // LoanRegistry events — all 12 collected events, tried in order.
        // Returns None for any event not emitted by the LoanRegistry contract.
        parse_loan_drawn(raw)
            .or_else(|| parse_status_updated(raw))
            .or_else(|| parse_disbursed(raw))
            .or_else(|| parse_undisbursed(raw))
            .or_else(|| parse_payment_recorded(raw))
            .or_else(|| parse_payment_unrecorded(raw))
            .or_else(|| parse_loan_defaulted(raw))
            .or_else(|| parse_loan_written_down(raw))
            .or_else(|| parse_interest_adjusted(raw))
            .or_else(|| parse_loan_closed(raw))
            .or_else(|| parse_loan_rolled_over(raw))
            .or_else(|| parse_economics_amended(raw))
    } else if yield_minter_id == Some(raw.contract_id.as_str()) {
        // The minter contract, under its former name (see the config field). It is
        // deployed (#36 lists `minter: CAPL5WN3…`): `YieldMinted` is retired (#1433)
        // since the rework stopped emitting it, so only `WireIn` / `WireInAssigned`
        // (#1416) are collected here now. The minter's other 19 events are
        // deliberately not collected yet and fall through as `None`.
        let parsed = parse_wire_in(raw).or_else(|| parse_wire_in_assigned(raw));
        // A `None` here is normally one of the 19 events we do not collect. But
        // for the two we do, it means the on-chain encoding differs from what the
        // parsers expect. Silence would be indistinguishable from "no wires have
        // arrived yet", for as long as it took someone to notice every deposit
        // stuck at `is_minted = false`.
        if parsed.is_none() && matches!(raw.event_name.as_str(), "wire_in" | "wire_in_assigned") {
            tracing::warn!(
                contract_id = %raw.contract_id,
                event_name = %raw.event_name,
                tx_hash = %raw.tx_hash,
                "minter event recognised by name but not decodable — its field \
                 encoding differs from what the parser expects; no contract_logs \
                 row was written"
            );
        }
        parsed
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
