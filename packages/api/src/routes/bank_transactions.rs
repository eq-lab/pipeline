//! Bank-transaction ledger submission endpoint (`POST /v1/bank-transactions`).
//!
//! Originally backed `trust_account` on `GET /v1/capital-allocation` (#924).
//! **Decoupled by #1027** — capital-allocation now sources `trust_account` from
//! the per-loan `loan_capital_transfers` table (`routes::loan_transfers`), so this
//! ledger has no remaining consumer; its removal is tracked in #1029. Gated on
//! `bank_operator` — a narrower financial-operations role distinct from `trustee`.
//! Append-only — a bookkeeping correction is a new offsetting entry, never an edit
//! (same audit rationale as the assay/offtake submission endpoints in
//! `routes::collateral_valuation`, #914).
//!
//! `amount` is stored as a **plain dollar figure**, not base-6/on-chain-scaled — a
//! bank transaction has no on-chain native scale to normalize against.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::bank_transaction_repo::BankTransactionType;

use crate::auth::{AuthClaims, SecurityAddon, BANK_OPERATOR_ROLE};
use crate::error::ApiError;
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Request body for `POST /v1/bank-transactions`.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct SubmitBankTransactionRequest {
    /// One of `Deposit`, `Withdrawal`, `Fee`.
    pub transaction_type: String,
    /// Always non-negative; sign is implied entirely by `transaction_type`. A plain
    /// dollar decimal string (e.g. `"50000"` or `"50000.00"`) — stored verbatim, no
    /// base-6/on-chain scaling. A bank transaction has no on-chain native scale to
    /// stay consistent with.
    pub amount: String,
    /// E.g. a wire reference number. Optional, but must not be blank if present.
    pub payment_reference: Option<String>,
    /// The transaction's own date (Unix seconds) — not necessarily "now". Distinct
    /// from the row's own insert-time `created_at`.
    pub occurred_at: u64,
}

/// Response for `POST /v1/bank-transactions`.
#[derive(Debug, Serialize, ToSchema)]
pub struct SubmitBankTransactionResponse {
    pub id: i64,
}

/// OpenAPI doc bundle for the bank-transactions route.
#[derive(OpenApi)]
#[openapi(
    paths(submit_bank_transaction),
    components(schemas(SubmitBankTransactionRequest, SubmitBankTransactionResponse)),
    modifiers(&SecurityAddon)
)]
pub struct BankTransactionsDoc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/bank-transactions", post(submit_bank_transaction))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/v1/bank-transactions",
    request_body = SubmitBankTransactionRequest,
    responses(
        (status = 201, description = "Bank transaction recorded", body = SubmitBankTransactionResponse),
        (status = 400, description = "Payload failed validation"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `bank_operator` role"),
    ),
    security(("bearer_auth" = [])),
    tag = "CapitalAllocation"
)]
async fn submit_bank_transaction(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SubmitBankTransactionRequest>,
) -> Result<(StatusCode, Json<SubmitBankTransactionResponse>), ApiError> {
    if !claims.has_role(BANK_OPERATOR_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{BANK_OPERATOR_ROLE}` role"
        )));
    }

    validate_bank_transaction(&payload).map_err(ApiError::BadRequest)?;

    let transaction_type = BankTransactionType::try_from(payload.transaction_type.clone())
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let amount = BigDecimal::from_str(&payload.amount).map_err(|_| {
        ApiError::BadRequest(format!("amount is not a valid decimal: {}", payload.amount))
    })?;
    let occurred_at = unix_to_datetime(payload.occurred_at)?;

    let id = state
        .bank_transaction_repo
        .insert(
            transaction_type,
            &amount,
            payload.payment_reference.as_deref(),
            occurred_at,
            &claims.sub,
        )
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(SubmitBankTransactionResponse { id }),
    ))
}

/// Unix seconds → `DateTime<Utc>`. Uses `i64::try_from` (not `as i64`) so an
/// out-of-range `u64` is rejected explicitly instead of silently wrapping — the
/// exact cast bug #914's code review flagged in `routes::collateral_valuation`.
fn unix_to_datetime(unix_secs: u64) -> Result<DateTime<Utc>, ApiError> {
    let secs = i64::try_from(unix_secs)
        .map_err(|_| ApiError::BadRequest(format!("invalid occurred_at: {unix_secs}")))?;
    DateTime::from_timestamp(secs, 0)
        .ok_or_else(|| ApiError::BadRequest(format!("invalid occurred_at: {unix_secs}")))
}

// ── Validation (pure) ────────────────────────────────────────────────────────

/// Pure validation for [`SubmitBankTransactionRequest`] — no I/O, unit-tested
/// directly.
pub fn validate_bank_transaction(req: &SubmitBankTransactionRequest) -> Result<(), String> {
    match req.transaction_type.as_str() {
        "Deposit" | "Withdrawal" | "Fee" => {}
        other => {
            return Err(format!(
                "unknown transaction_type `{other}` (expected Deposit, Withdrawal, or Fee)"
            ))
        }
    }

    let amount = BigDecimal::from_str(&req.amount)
        .map_err(|_| format!("amount is not a valid decimal: {}", req.amount))?;
    if amount < 0 {
        return Err(format!("amount must be >= 0; got {amount}"));
    }

    if let Some(reference) = &req.payment_reference {
        if reference.trim().is_empty() {
            return Err("payment_reference must not be blank when present".to_owned());
        }
    }

    Ok(())
}
