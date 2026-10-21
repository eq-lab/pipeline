//! Trustee Audit Log endpoint (`GET /v1/audit-log`).
//!
//! Read-only, paginated, reverse-chronological feed backing Surface 17 ("Audit Log") of
//! the Trustee dashboard. Sourced entirely from `contract_logs` — the indexed on-chain
//! event store — matching the sourcing of the other Trustee reads (`loan_book`,
//! `withdrawal_queue`, `ccr_history`). Conventions match `routes::financial_position`:
//! Axum handler, utoipa schema, `chain_id?` — omitted = every configured chain merged
//! newest-first (`block_timestamp`, then block / log order), a configured id = that chain,
//! a well-formed unconfigured id = `{"items":[]}` with no DB call, malformed or repeated = 400.
//! Each item carries its `chain_id`, and amounts are rendered with that row's chain kind.
//!
//! **On-chain only (v1).** The full protocol audit log (see
//! `docs/product-specs/audit-logging.md`) also records off-chain relayer/operator actions
//! — fiat wire confirmations, MPC co-signatures, USDC↔USYC swaps — which are not persisted
//! in a queryable store today. Those rows do not appear here yet; serving them is a
//! follow-up. See `docs/exec-plans/completed/issue-1000-audit-log-endpoint.md`.
//!
//! Each item carries a server-rendered human-readable `action`, the raw `event_name`, a
//! curated `details` object (the same scalars the action string is built from), the
//! resolved `scope` (`Loan #<id>` / `Protocol`), an ISO-8601 `timestamp`, and `reference`
//! — the friendly loan name (`"<originator> — <commodity>"`, sourced from the loan
//! snapshot), empty string for protocol-scoped events, for loans missing either field, and
//! for Minter / CollateralRegistry / DealTokenFactory rows (no snapshot).
//!
//! Besides the loan lifecycle, the feed carries the Minter cash events, the
//! CollateralRegistry lot events and the DealTokenFactory events (#1478); per-transfer
//! `DealTokenTransfer` rows are deliberately left out. Historical `YieldMinted`,
//! `LoanCCRUpdated` and `LoanLocationUpdated` rows are no longer indexed but keep rendering.
//!
//! The feed is returned in full (newest first) — it is not paginated.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use serde::Serialize;
use serde_json::{json, Value};
use utoipa::{OpenApi, ToSchema};

use shared::chains::ChainKind;
use shared::contract_logs_repo::AuditLogRow;
use shared::loan_economics::economics_rate_to_bps;

use crate::config::ConfiguredChain;
use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::routes::common::LenientChainFilter;
use crate::AppState;

/// On-chain events surfaced in the Trustee audit feed: loan lifecycle, Minter cash,
/// CollateralRegistry and DealTokenFactory events, plus the historical `YieldMinted` /
/// `LoanCCRUpdated` / `LoanLocationUpdated` rows. LP-facing events (deposits, withdrawals,
/// staking, raw transfers) and `DealTokenTransfer` are deliberately excluded as low-signal.
/// This allow-list also gates the action formatter — an `event_name` outside it never
/// reaches `format_action`.
pub const AUDIT_EVENT_NAMES: &[&str] = &[
    "LoanDrawn",
    "PaymentRecorded",
    "YieldMinted",
    "LoanCCRUpdated",
    "LoanStatusUpdated",
    "LoanClosed",
    "LoanDefaulted",
    "LoanRolledOver",
    "EconomicsAmended",
    "LoanLocationUpdated",
    "Disbursed",
    "Undisbursed",
    "PaymentUnrecorded",
    "LoanWrittenDown",
    "InterestAdjusted",
    "CashDisbursed",
    "CashDisbursementReversed",
    "CashRepaid",
    "CashRepaymentReversed",
    "WireInReturned",
    "WireOutRequested",
    "WireOutSettled",
    "WireOutCancelled",
    "RampOpened",
    "RampClosed",
    "CashRecorded",
    "CashCorrected",
    "MintCorrected",
    "LossAbsorbed",
    "Pledged",
    "HaircutSet",
    "FloorSet",
    "Revalued",
    "StageUpdated",
    "ControlUpdated",
    "DocAdded",
    "QuantityAdjusted",
    "Released",
    "Liquidated",
    "MarginCall",
    "DealRegistered",
    "DebtSynced",
    "CargoSynced",
];

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// What a log entry pertains to: a specific loan, or the protocol at large.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditScope {
    /// On-chain loan id (`uint256`, decimal string) for loan-scoped events; `null` for
    /// protocol-scoped events (e.g. `WireOutRequested`).
    pub loan_id: Option<String>,
    /// Human-readable scope label, e.g. `"Loan #4492"` or `"Protocol"`. This is the
    /// loan **number** — see `AuditLogItem::reference` for the loan **name**.
    pub label: String,
}

/// One row of the Audit Log table.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditLogItem {
    /// Chain the event was indexed on.
    pub chain_id: i64,
    /// Event time, ISO-8601 UTC (from the on-chain block timestamp).
    pub timestamp: String,
    /// Server-rendered, human-readable description of the action.
    pub action: String,
    /// What the action pertains to.
    pub scope: AuditScope,
    /// Friendly loan name, `"<originator> — <commodity>"` (e.g. `"Open Mineral — Copper
    /// Concentrate"`), sourced from the loan's on-chain snapshot. Empty string for
    /// rows without a snapshot (protocol-scoped, Minter, CollateralRegistry,
    /// DealTokenFactory) and for any
    /// loan-scoped row missing either the originator or the commodity. This is
    /// deliberately distinct from `scope.label` (`"Loan #<id>"` / `"Protocol"`), which
    /// is the loan number, not the loan name.
    pub reference: String,
    /// Raw on-chain event name (e.g. `"PaymentRecorded"`), for clients that prefer to
    /// format their own action string.
    pub event_name: String,
    /// Curated scalar fields backing `action` (amounts already in decimal dollar units),
    /// so clients can re-render without re-parsing raw params. Shape varies by event.
    pub details: Value,
}

/// Response for `GET /v1/audit-log`.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditLogResponse {
    /// All log entries, newest first (all configured chains merged when `chain_id` is omitted).
    pub items: Vec<AuditLogItem>,
}

/// OpenAPI doc bundle for the audit-log route.
#[derive(OpenApi)]
#[openapi(
    paths(get_audit_log),
    components(schemas(AuditLogResponse, AuditLogItem, AuditScope)),
    tags((name = "AuditLog", description = "Trustee audit log feed (on-chain events)"))
)]
pub struct AuditLogDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/audit-log", get(get_audit_log))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/audit-log",
    params(LenientChainFilter),
    responses(
        (status = 200, description = "The full audit log feed, newest first, for the selected chain or merged over all configured chains when `chain_id` is omitted; a well-formed but unconfigured `chain_id` yields an empty list", body = AuditLogResponse),
        (status = 400, description = "Malformed or repeated chain_id"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "AuditLog"
)]
async fn get_audit_log(
    State(state): State<Arc<AppState>>,
    chain: LenientChainFilter,
) -> Result<Json<AuditLogResponse>, ApiError> {
    let chains = chain.configured(&state.chains);
    let mut rows = Vec::new();
    for c in chains {
        rows.extend(
            state
                .contract_logs_repo
                .list_audit_log(&state.pool, c.chain_id, AUDIT_EVENT_NAMES)
                .await?,
        );
    }

    Ok(Json(build_response(rows, chains)))
}

// ── Compute (pure — unit-tested without DB/HTTP) ──────────────────────────────

/// Order `rows` newest-first (`block_timestamp`, then `block_number`, then `log_index`,
/// then `chain_id`) and map them into the response. Each row's amount scale comes from
/// its own chain's kind in `chains` (Stellar's Soroban contracts store monetary fields at
/// 7 decimals vs. EVM's 6, #901); a row whose chain is not in `chains` is dropped.
///
/// Public so `packages/api/tests/audit_log.rs` can exercise the mapping without a DB.
pub fn build_response(mut rows: Vec<AuditLogRow>, chains: &[ConfiguredChain]) -> AuditLogResponse {
    rows.sort_by(|a, b| {
        (b.block_timestamp, b.block_number, b.log_index, b.chain_id).cmp(&(
            a.block_timestamp,
            a.block_number,
            a.log_index,
            a.chain_id,
        ))
    });
    let items = rows
        .into_iter()
        .filter(|row| !is_noop_sync(&row.event_name, &row.params))
        .filter_map(|row| {
            let kind = chains.iter().find(|c| c.chain_id == row.chain_id)?.kind;
            Some(map_item(row, kind))
        })
        .collect();
    AuditLogResponse { items }
}

/// A permissionless `DebtSynced` (`minted` and `clawed`) / `CargoSynced` (`minted` and
/// `burned`) that moved nothing: both raw amounts are present and zero. A missing or
/// unparseable amount keeps the row.
fn is_noop_sync(event_name: &str, params: &Value) -> bool {
    let keys: [&str; 2] = match event_name {
        "DebtSynced" => ["minted", "clawed"],
        "CargoSynced" => ["minted", "burned"],
        _ => return false,
    };
    keys.iter().all(|k| {
        param_str(params, k)
            .and_then(|raw| BigDecimal::from_str(&raw).ok())
            .is_some_and(|v| v == 0)
    })
}

/// Map one raw row to an API item, rendering the action string, scope, and friendly
/// loan name.
fn map_item(row: AuditLogRow, chain_kind: ChainKind) -> AuditLogItem {
    let (action, details) = format_action(&row.event_name, &row.params, chain_kind);
    let scope = match row.loan_id.as_deref() {
        Some(id) if !id.is_empty() => AuditScope {
            loan_id: Some(id.to_owned()),
            label: format!("Loan #{id}"),
        },
        _ => AuditScope {
            loan_id: None,
            label: "Protocol".to_owned(),
        },
    };
    let reference = build_reference_name(row.originator.as_deref(), row.commodity.as_deref())
        .unwrap_or_default();
    AuditLogItem {
        chain_id: row.chain_id,
        timestamp: iso_utc_from_unix(row.block_timestamp),
        action,
        scope,
        reference,
        event_name: row.event_name,
        details,
    }
}

/// Build the friendly loan name `"<originator> — <commodity>"` from the loan snapshot's
/// two name fields. `None` unless **both** are present and non-empty — a partial
/// snapshot (or a protocol-scoped event with no snapshot at all, e.g. `YieldMinted`)
/// must not render a dangling `" — "` or a lone half of the name.
fn build_reference_name(originator: Option<&str>, commodity: Option<&str>) -> Option<String> {
    match (originator, commodity) {
        (Some(o), Some(c)) if !o.is_empty() && !c.is_empty() => Some(format!("{o} — {c}")),
        _ => None,
    }
}

/// Read a `params` field as a plain string, accepting either a JSON string or a JSON
/// number (the indexer stores `uint256`s as strings but smaller ints as numbers).
///
/// Looks at the top level first, then under `params.event`: the two indexer mappers
/// store different shapes. `ContractLogMapper` writes parser fields flat, while
/// `LoanEventMapper` rewraps them as `{loan_id, event: {...}, snapshot: {...}}`
/// (`worker/src/indexer/loan_mapper.rs`), which is why `yield_mint_outbox_repo` reads
/// `params->'event'->>'repayment_id'`. Reading only the top level made every
/// loan-registry `details` field null in production — issue #1096.
fn param_str(params: &Value, key: &str) -> Option<String> {
    let value = params
        .get(key)
        .or_else(|| params.get("event").and_then(|event| event.get(key)))?;
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn param_value<'a>(params: &'a Value, key: &str) -> Option<&'a Value> {
    params
        .get(key)
        .or_else(|| params.get("event").and_then(|event| event.get(key)))
}

fn param_i64(params: &Value, key: &str) -> Option<i64> {
    match param_value(params, key)? {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// Format an on-chain integer amount string as decimal dollars. `chain_kind` selects
/// the native scale — EVM's `uint256` monetary fields are already 6-decimal
/// (`normalize_usdc_amount` is a no-op); Stellar's Soroban contracts store them at
/// 7 decimals (#901), so the value is normalized to 6 decimals before formatting.
/// Returns `None` when the value is missing or unparseable.
fn param_amount(params: &Value, key: &str, chain_kind: ChainKind) -> Option<String> {
    let raw = param_str(params, key)?;
    let bd = BigDecimal::from_str(&raw).ok()?;
    Some(base6_to_decimal_string(
        &shared::chains::normalize_usdc_amount(chain_kind, &bd),
    ))
}

/// Map an `(event_name, params)` pair to a human-readable action string plus a curated
/// `details` object (amounts already in decimal dollars, normalized for `chain_kind`).
/// Pure and total: any event outside [`AUDIT_EVENT_NAMES`] falls back to the raw event
/// name with empty details.
///
/// Public so `packages/api/tests/audit_log.rs` can exercise every branch without a DB.
pub fn format_action(event_name: &str, params: &Value, chain_kind: ChainKind) -> (String, Value) {
    match event_name {
        "LoanDrawn" => ("Loan approved & minted".to_owned(), json!({})),

        "PaymentRecorded" => {
            let interest = param_amount(params, "senior_interest", chain_kind);
            let principal = param_amount(params, "senior_principal_repaid", chain_kind);
            // Principal untouched ⇒ interest-only coupon; otherwise a principal repayment.
            let interest_only = principal.as_deref() == Some("0.000000");
            let action = if interest_only {
                "Coupon recorded — interest only, principal unchanged".to_owned()
            } else {
                "Repayment recorded — principal + interest".to_owned()
            };
            (
                action,
                json!({ "senior_interest": interest, "senior_principal_repaid": principal }),
            )
        }

        // Historical rows only (no longer indexed); yield now arrives as `CashRepaid`.
        "YieldMinted" => {
            let vault = param_amount(params, "s_plusd_amount", chain_kind);
            let treasury = param_amount(params, "treasury_amount", chain_kind);
            let action = match (&vault, &treasury) {
                (Some(v), Some(t)) => format!("Coupon minted — ${v} vault + ${t} treasury"),
                _ => "Coupon minted".to_owned(),
            };
            (action, json!({ "vault": vault, "treasury": treasury }))
        }

        // Historical rows only (no longer indexed). CCR scale is ambiguous between the 1e6
        // (`CCR_ONE`) and bps conventions, so the raw value is passed through unrendered.
        "LoanCCRUpdated" => (
            "CCR written on-chain".to_owned(),
            json!({ "new_ccr": params.get("new_ccr") }),
        ),

        "LoanStatusUpdated" => {
            let status = param_str(params, "status");
            let action = match &status {
                Some(s) => format!("Status updated → {s}"),
                None => "Status updated".to_owned(),
            };
            (action, json!({ "status": status }))
        }

        "LoanClosed" => {
            let reason = param_str(params, "closure_reason");
            let action = match &reason {
                Some(r) => format!("Loan closed — {r}"),
                None => "Loan closed".to_owned(),
            };
            (action, json!({ "closure_reason": reason }))
        }

        // Shape-tolerant (#1433 D4): post-rework rows carry `outstanding`/`moved` with
        // no CCR; legacy rows (pre-rework parser) still carry `ccr_bps`. Project
        // whichever keys the row actually has rather than a fixed three-key shape
        // with nulls, so legacy rows keep rendering their original fields.
        "LoanDefaulted" => {
            let mut details = json!({});
            if let Some(outstanding) = param_amount(params, "outstanding", chain_kind) {
                details["outstanding"] = json!(outstanding);
            }
            if let Some(moved) = param_amount(params, "moved", chain_kind) {
                details["moved"] = json!(moved);
            }
            if let Some(ccr_bps) = params.get("ccr_bps") {
                details["ccr_bps"] = ccr_bps.clone();
            }
            ("Loan defaulted".to_owned(), details)
        }

        "LoanRolledOver" => ("Loan rolled over".to_owned(), economics_details(params)),

        "EconomicsAmended" => ("Economics amended".to_owned(), economics_details(params)),

        // Historical rows only (no longer indexed).
        "LoanLocationUpdated" => ("Collateral location updated".to_owned(), json!({})),

        "Disbursed" => {
            let amount = param_amount(params, "amount", chain_kind);
            let action = match &amount {
                Some(a) => format!("Disbursed — ${a}"),
                None => "Disbursed".to_owned(),
            };
            (action, json!({ "amount": amount }))
        }

        "Undisbursed" => {
            let amount = param_amount(params, "amount", chain_kind);
            let action = match &amount {
                Some(a) => format!("Disbursement reversed — ${a}"),
                None => "Disbursement reversed".to_owned(),
            };
            (action, json!({ "amount": amount }))
        }

        // Shape-tolerant (#1434 D6) — same treatment as `LoanDefaulted` above.
        "PaymentUnrecorded" => {
            let mut details = json!({});
            if let Some(principal) = param_amount(params, "senior_principal_repaid", chain_kind) {
                details["senior_principal_repaid"] = json!(principal);
            }
            if let Some(interest) = param_amount(params, "senior_interest", chain_kind) {
                details["senior_interest"] = json!(interest);
            }
            if let Some(outstanding) = param_amount(params, "outstanding", chain_kind) {
                details["outstanding"] = json!(outstanding);
            }
            ("Payment reversed".to_owned(), details)
        }

        "LoanWrittenDown" => {
            let amount = param_amount(params, "amount", chain_kind);
            let action = match &amount {
                Some(a) => format!("Loan written down — ${a}"),
                None => "Loan written down".to_owned(),
            };
            (action, json!({ "amount": amount }))
        }

        "InterestAdjusted" => {
            let delta = param_amount(params, "delta", chain_kind);
            ("Interest adjusted".to_owned(), json!({ "delta": delta }))
        }

        "CashDisbursed" => with_amount(
            "Cash disbursed",
            params,
            chain_kind,
            "amount",
            &["entry_id", "value_date"],
        ),

        "CashDisbursementReversed" => with_amount(
            "Cash disbursement reversed",
            params,
            chain_kind,
            "amount",
            &["entry_id", "original_id"],
        ),

        "CashRepaid" => {
            let interest = param_amount(params, "interest_minted", chain_kind);
            let (action, mut details) = with_amount(
                "Cash repaid",
                params,
                chain_kind,
                "cash",
                &["repayment_id", "sale_id", "value_date", "fee_shares"],
            );
            details["interest_minted"] = json!(interest);
            (action, details)
        }

        "CashRepaymentReversed" => with_amount(
            "Cash repayment reversed",
            params,
            chain_kind,
            "cash",
            &["repayment_id"],
        ),

        "WireInReturned" => with_amount("Wire-in returned", params, chain_kind, "amount", &["id"]),

        "WireOutRequested" => with_amount(
            "Wire-out requested",
            params,
            chain_kind,
            "amount",
            &["id", "lp"],
        ),

        "WireOutSettled" => with_amount(
            "Wire-out settled",
            params,
            chain_kind,
            "amount",
            &["id", "value_date"],
        ),

        "WireOutCancelled" => ("Wire-out cancelled".to_owned(), pass(params, &["id"])),

        "RampOpened" => {
            let direction = param_str(params, "direction");
            let amount = param_amount(params, "amount", chain_kind);
            let action = match (&direction, &amount) {
                (Some(d), Some(a)) => format!("Ramp opened — {d} ${a}"),
                _ => "Ramp opened".to_owned(),
            };
            (
                action,
                json!({ "id": param_str(params, "id"), "direction": direction, "amount": amount }),
            )
        }

        "RampClosed" => {
            let received = param_amount(params, "received", chain_kind);
            let loss = param_amount(params, "loss", chain_kind);
            let action = match (&received, &loss) {
                (Some(r), Some(l)) => format!("Ramp closed — received ${r}, loss ${l}"),
                _ => "Ramp closed".to_owned(),
            };
            (
                action,
                json!({ "id": param_str(params, "id"), "received": received, "loss": loss }),
            )
        }

        "CashRecorded" => {
            let reason = param_str(params, "reason");
            let delta = param_amount(params, "delta", chain_kind);
            let action = match (&reason, &delta) {
                (Some(r), Some(d)) => format!("Cash recorded — {r} {}", dollars(d)),
                _ => "Cash recorded".to_owned(),
            };
            (
                action,
                json!({
                    "reason": reason,
                    "delta": delta,
                    "entry_id": param_str(params, "entry_id"),
                    "value_date": param_str(params, "value_date"),
                }),
            )
        }

        "CashCorrected" => with_amount(
            "Cash corrected",
            params,
            chain_kind,
            "delta",
            &["entry_id", "original_id"],
        ),

        "MintCorrected" => with_amount("Mint corrected", params, chain_kind, "amount", &[]),

        "LossAbsorbed" => {
            let requested = param_amount(params, "requested", chain_kind);
            let pulled = param_amount(params, "pulled", chain_kind);
            let action = match (&requested, &pulled) {
                (Some(r), Some(p)) => format!("Loss absorbed — ${p} of ${r} requested"),
                _ => "Loss absorbed".to_owned(),
            };
            (action, json!({ "requested": requested, "pulled": pulled }))
        }

        "Pledged" => ("Collateral pledged".to_owned(), pass(params, &["lot_id"])),

        "HaircutSet" => {
            let bps = param_str(params, "bps");
            let action = match &bps {
                Some(b) => format!("Haircut set — {b} bps"),
                None => "Haircut set".to_owned(),
            };
            (action, pass(params, &["lot_id", "bps"]))
        }

        "FloorSet" => {
            let bps = param_str(params, "bps");
            let action = match &bps {
                Some(b) => format!("Coverage floor set — {b} bps"),
                None => "Coverage floor set".to_owned(),
            };
            (action, pass(params, &["bps"]))
        }

        "Revalued" => {
            let value = param_amount(params, "value_per_unit", chain_kind);
            let benchmark = param_str(params, "benchmark");
            let action = match (&value, &benchmark) {
                (Some(v), Some(b)) => format!("Collateral revalued — ${v}/unit ({b})"),
                (Some(v), None) => format!("Collateral revalued — ${v}/unit"),
                _ => "Collateral revalued".to_owned(),
            };
            (
                action,
                json!({
                    "lot_id": param_str(params, "lot_id"),
                    "value_per_unit": value,
                    "benchmark": benchmark,
                    "report_hash": param_str(params, "report_hash"),
                }),
            )
        }

        "StageUpdated" => {
            let stage = param_str(params, "stage");
            let action = match &stage {
                Some(s) => format!("Lot stage updated → {s}"),
                None => "Lot stage updated".to_owned(),
            };
            (
                action,
                json!({
                    "lot_id": param_str(params, "lot_id"),
                    "stage": stage,
                    "location": param_value(params, "location"),
                }),
            )
        }

        "ControlUpdated" => {
            let control = param_value(params, "control");
            let kind = control
                .and_then(|c| c.get("kind"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            let action = match &kind {
                Some(k) => format!("Lot control updated → {k}"),
                None => "Lot control updated".to_owned(),
            };
            (
                action,
                json!({ "lot_id": param_str(params, "lot_id"), "control": control }),
            )
        }

        "DocAdded" => {
            let kind = param_str(params, "kind");
            let action = match &kind {
                Some(k) => format!("Document added — {k}"),
                None => "Document added".to_owned(),
            };
            (action, pass(params, &["lot_id", "kind", "hash"]))
        }

        "QuantityAdjusted" => {
            let old = param_amount(params, "old_quantity", chain_kind);
            let new = param_amount(params, "new_quantity", chain_kind);
            let action = match (&old, &new) {
                (Some(o), Some(n)) => format!("Quantity adjusted — {o} → {n}"),
                _ => "Quantity adjusted".to_owned(),
            };
            (
                action,
                json!({
                    "lot_id": param_str(params, "lot_id"),
                    "old_quantity": old,
                    "new_quantity": new,
                    "reason": param_str(params, "reason"),
                    "hash": param_str(params, "hash"),
                }),
            )
        }

        "Released" => {
            let reason = param_str(params, "reason");
            let action = match &reason {
                Some(r) => format!("Collateral released — {r}"),
                None => "Collateral released".to_owned(),
            };
            (
                action,
                json!({
                    "lot_id": param_str(params, "lot_id"),
                    "quantity": param_amount(params, "quantity", chain_kind),
                    "reason": reason,
                    "ref_hash": param_str(params, "ref_hash"),
                }),
            )
        }

        "Liquidated" => (
            "Collateral liquidated".to_owned(),
            json!({
                "lot_id": param_str(params, "lot_id"),
                "sale_id": param_str(params, "sale_id"),
                "quantity": param_amount(params, "quantity", chain_kind),
            }),
        ),

        "MarginCall" => {
            let coverage = param_str(params, "coverage_bps");
            let floor = param_str(params, "floor_bps");
            let action = match (&coverage, &floor) {
                (Some(c), Some(f)) => format!("Margin call — coverage {c} bps vs floor {f} bps"),
                _ => "Margin call".to_owned(),
            };
            (action, pass(params, &["coverage_bps", "floor_bps"]))
        }

        "DealRegistered" => (
            "Deal tokens registered".to_owned(),
            pass(params, &["debt", "cargo"]),
        ),

        "DebtSynced" => {
            let minted = param_amount(params, "minted", chain_kind);
            let clawed = param_amount(params, "clawed", chain_kind);
            let action = match (&minted, &clawed) {
                (Some(m), Some(c)) => format!("Debt token synced — minted {m}, clawed back {c}"),
                _ => "Debt token synced".to_owned(),
            };
            (
                action,
                json!({
                    "target": param_amount(params, "target", chain_kind),
                    "previous": param_amount(params, "previous", chain_kind),
                    "minted": minted,
                    "clawed": clawed,
                }),
            )
        }

        "CargoSynced" => {
            let minted = param_amount(params, "minted", chain_kind);
            let burned = param_amount(params, "burned", chain_kind);
            let action = match (&minted, &burned) {
                (Some(m), Some(b)) => format!("Cargo token synced — minted {m}, burned {b}"),
                _ => "Cargo token synced".to_owned(),
            };
            (
                action,
                json!({
                    "target": param_amount(params, "target", chain_kind),
                    "previous": param_amount(params, "previous", chain_kind),
                    "minted": minted,
                    "burned": burned,
                }),
            )
        }

        // Unreachable in practice — the SQL allow-list filters these out before they get
        // here — but keep it total rather than panicking on an unexpected event.
        other => (other.to_owned(), json!({})),
    }
}

/// `$12.34`, or `-$12.34` for a negative decimal string.
fn dollars(amount: &str) -> String {
    match amount.strip_prefix('-') {
        Some(abs) => format!("-${abs}"),
        None => format!("${amount}"),
    }
}

/// `{key: string}` for each of `keys` (numbers stringified), `null` when absent.
fn pass(params: &Value, keys: &[&str]) -> Value {
    let mut details = serde_json::Map::new();
    for key in keys {
        details.insert((*key).to_owned(), json!(param_str(params, key)));
    }
    Value::Object(details)
}

/// `"<label> — $<amount>"` (just `<label>` when the amount is missing) plus details with
/// the normalised `amount_key` and the pass-through `extra` keys.
fn with_amount(
    label: &str,
    params: &Value,
    chain_kind: ChainKind,
    amount_key: &str,
    extra: &[&str],
) -> (String, Value) {
    let amount = param_amount(params, amount_key, chain_kind);
    let action = match &amount {
        Some(a) => format!("{label} — {}", dollars(a)),
        None => label.to_owned(),
    };
    let mut details = pass(params, extra);
    details[amount_key] = json!(amount);
    (action, details)
}

/// Rollover / amendment details: `new_rate_bps` (the event's 1e6-scaled rate converted to
/// bps) and `new_maturity_timestamp`, read from the top level or the nested `event`.
fn economics_details(params: &Value) -> Value {
    json!({
        "new_rate_bps": param_i64(params, "new_rate").map(economics_rate_to_bps),
        "new_maturity_timestamp": param_i64(params, "new_maturity_timestamp"),
    })
}
