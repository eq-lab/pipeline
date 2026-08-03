//! Trustee Audit Log endpoint (`GET /v1/audit-log`).
//!
//! Read-only, paginated, reverse-chronological feed backing Surface 17 ("Audit Log") of
//! the Trustee dashboard. Sourced entirely from `contract_logs` — the indexed on-chain
//! event store — matching the sourcing of the other Trustee reads (`loan_book`,
//! `withdrawal_queue`, `ccr_history`). Conventions match `routes::withdrawal_queue`:
//! Axum handler, utoipa schema, `chain_id?` defaulting to `DEFAULT_CHAIN_ID`.
//!
//! **On-chain only (v1).** The full protocol audit log (see
//! `docs/product-specs/audit-logging.md`) also records off-chain relayer/operator actions
//! — fiat wire confirmations, MPC co-signatures, USDC↔USYC swaps — which are not persisted
//! in a queryable store today. Those rows do not appear here yet; serving them is a
//! follow-up. See `docs/exec-plans/active/issue-1000-audit-log-endpoint.md`.
//!
//! Each item carries a server-rendered human-readable `action`, the raw `event_name`, a
//! curated `details` object (the same scalars the action string is built from), the
//! resolved `scope`, an ISO-8601 `timestamp`, and the on-chain `tx_hash` `reference`.
//!
//! The feed is returned in full (newest first) — it is not paginated.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use serde::Serialize;
use serde_json::{json, Value};
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::AuditLogRow;

use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::AppState;

/// On-chain events surfaced in the Trustee audit feed (loan lifecycle + yield). LP-facing
/// events (deposits, withdrawals, staking, raw transfers) are deliberately excluded as
/// low-signal for the Trustee. This allow-list also gates the action formatter — an
/// `event_name` outside it never reaches `format_action`.
const AUDIT_EVENT_NAMES: &[&str] = &[
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
];

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// What a log entry pertains to: a specific loan, or the protocol at large.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditScope {
    /// On-chain loan id (`uint256`, decimal string) for loan-scoped events; `null` for
    /// protocol-scoped events (e.g. `YieldMinted`). The frontend maps this to its own
    /// friendly loan name; `label` is a server-side fallback.
    pub loan_id: Option<String>,
    /// Human-readable scope label, e.g. `"Loan #4492"` or `"Protocol"`.
    pub label: String,
}

/// One row of the Audit Log table.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditLogItem {
    /// Event time, ISO-8601 UTC (from the on-chain block timestamp).
    pub timestamp: String,
    /// Server-rendered, human-readable description of the action.
    pub action: String,
    /// What the action pertains to.
    pub scope: AuditScope,
    /// On-chain reference — the transaction hash.
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
    /// All log entries, newest first.
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
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "The full audit log feed, newest first", body = AuditLogResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "AuditLog"
)]
async fn get_audit_log(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<AuditLogResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);

    let rows = state
        .contract_logs_repo
        .list_audit_log(&state.pool, chain_id, AUDIT_EVENT_NAMES)
        .await?;

    Ok(Json(build_response(rows)))
}

// ── Compute (pure — unit-tested without DB/HTTP) ──────────────────────────────

/// Map a fetched slab of rows (already newest-first) into the response.
///
/// Public so `packages/api/tests/audit_log.rs` can exercise the mapping without a DB.
pub fn build_response(rows: Vec<AuditLogRow>) -> AuditLogResponse {
    let items = rows.into_iter().map(map_item).collect();
    AuditLogResponse { items }
}

/// Map one raw row to an API item, rendering the action string and scope.
fn map_item(row: AuditLogRow) -> AuditLogItem {
    let (action, details) = format_action(&row.event_name, &row.params);
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
    AuditLogItem {
        timestamp: iso_utc_from_unix(row.block_timestamp),
        action,
        scope,
        reference: row.tx_hash,
        event_name: row.event_name,
        details,
    }
}

/// Read a `params` field as a plain string, accepting either a JSON string or a JSON
/// number (the indexer stores `uint256`s as strings but smaller ints as numbers).
fn param_str(params: &Value, key: &str) -> Option<String> {
    match params.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

/// Format a base-6 integer amount string (on-chain USDC base units) as decimal dollars.
/// Returns `None` when the value is missing or unparseable.
fn param_amount(params: &Value, key: &str) -> Option<String> {
    let raw = param_str(params, key)?;
    BigDecimal::from_str(&raw)
        .ok()
        .map(|bd| base6_to_decimal_string(&bd))
}

/// Map an `(event_name, params)` pair to a human-readable action string plus a curated
/// `details` object (amounts already in decimal dollars). Pure and total: any event
/// outside [`AUDIT_EVENT_NAMES`] falls back to the raw event name with empty details.
///
/// Public so `packages/api/tests/audit_log.rs` can exercise every branch without a DB.
pub fn format_action(event_name: &str, params: &Value) -> (String, Value) {
    match event_name {
        "LoanDrawn" => ("Loan approved & minted".to_owned(), json!({})),

        "PaymentRecorded" => {
            let interest = param_amount(params, "senior_interest");
            let principal = param_amount(params, "senior_principal_repaid");
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

        "YieldMinted" => {
            let vault = param_amount(params, "s_plusd_amount");
            let treasury = param_amount(params, "treasury_amount");
            let action = match (&vault, &treasury) {
                (Some(v), Some(t)) => format!("Coupon minted — ${v} vault + ${t} treasury"),
                _ => "Coupon minted".to_owned(),
            };
            (action, json!({ "vault": vault, "treasury": treasury }))
        }

        // CCR scale on-chain is ambiguous between the 1e6 (`CCR_ONE`) and bps conventions,
        // so we do NOT render a possibly-wrong percentage here — the raw value is passed
        // through for the client (which knows the scale) to render.
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

        "LoanDefaulted" => (
            "Loan defaulted".to_owned(),
            json!({ "ccr_bps": params.get("ccr_bps") }),
        ),

        "LoanRolledOver" => (
            "Loan rolled over".to_owned(),
            json!({
                "new_rate": params.get("new_rate"),
                "new_maturity_timestamp": params.get("new_maturity_timestamp"),
            }),
        ),

        "EconomicsAmended" => (
            "Economics amended".to_owned(),
            json!({
                "new_rate": params.get("new_rate"),
                "new_maturity_timestamp": params.get("new_maturity_timestamp"),
            }),
        ),

        "LoanLocationUpdated" => ("Collateral location updated".to_owned(), json!({})),

        // Unreachable in practice — the SQL allow-list filters these out before they get
        // here — but keep it total rather than panicking on an unexpected event.
        other => (other.to_owned(), json!({})),
    }
}
