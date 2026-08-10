//! Per-loan capital-transfers endpoints
//! (`GET`/`POST /v1/loan-book/{loan_id}/transfers`, #1027).
//!
//! Trustee-only record of what has actually moved on the cash rails for a drawn
//! loan; backs the reworked `GET /v1/capital-allocation` buckets — see
//! `routes::capital_allocation` and `shared::loan_capital_transfers_repo` for the
//! bucket math. Conventions match the other trustee-gated loan-book write
//! (`routes::loan_book::complete_disbursement`): Axum handler, utoipa schema,
//! `chain_id?` defaulting to `DEFAULT_CHAIN_ID`, 404 when the loan has no indexed
//! events on the chain.
//!
//! `POST` is a **full upsert** (decision 3 on #1027): the body always carries all
//! five values and create-or-replaces the loan's record. Amounts are **plain
//! dollar figures** (decision 4) — no base-6/on-chain scaling on entry; stored
//! verbatim. `GET` serves defaults (flag false,
//! all amounts `"0"`) when nothing has been recorded yet — absence-as-default
//! mirrors `loan_disbursement`.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::loan_capital_transfers_repo::{LoanCapitalTransfersRow, LoanCapitalTransfersValues};

use crate::auth::{AuthClaims, SecurityAddon};
use crate::error::ApiError;
use crate::formatting::iso_utc;
use crate::routes::common::{trustee_indexed_loan_guard, ChainQuery};
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Request body for `POST /v1/loan-book/{loan_id}/transfers`. Full upsert — all
/// five values are required and replace the loan's record entirely.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct UpsertLoanTransfersRequest {
    /// Whether the loan's capital is actually deployed. Gates the loan's senior
    /// tranche into capital-allocation's `deployed` (together with the
    /// active-window check).
    pub is_loan_deployed: bool,
    /// Confirmed on-ramp amount, a non-negative plain dollar decimal string
    /// (e.g. `"50000"` or `"50000.00"`) — no base-6/on-chain scaling.
    pub on_ramp_transferred: String,
    /// Confirmed off-ramp amount, same format.
    pub off_ramp_transferred: String,
    /// What hit the trust account for this loan, same format.
    pub trust_account_deposit: String,
    /// What left the trust account for this loan, same format.
    pub trust_account_withdrawal: String,
}

/// Response for both `GET` and `POST /v1/loan-book/{loan_id}/transfers`. Amounts
/// are plain dollar decimal strings, exactly as stored. `recorded_by`/`updated_at`
/// are `null` when nothing has been recorded for the loan yet (GET only).
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanTransfersResponse {
    pub loan_id: String,
    pub is_loan_deployed: bool,
    pub on_ramp_transferred: String,
    pub off_ramp_transferred: String,
    pub trust_account_deposit: String,
    pub trust_account_withdrawal: String,
    /// The Trustee (JWT `sub`) who last wrote the record; `null` when no record.
    pub recorded_by: Option<String>,
    /// ISO-8601 UTC timestamp of the last write; `null` when no record.
    pub updated_at: Option<String>,
}

impl LoanTransfersResponse {
    fn from_row(row: LoanCapitalTransfersRow) -> Self {
        Self {
            loan_id: row.loan_id.to_plain_string(),
            is_loan_deployed: row.is_loan_deployed,
            on_ramp_transferred: row.on_ramp_transferred.to_plain_string(),
            off_ramp_transferred: row.off_ramp_transferred.to_plain_string(),
            trust_account_deposit: row.trust_account_deposit.to_plain_string(),
            trust_account_withdrawal: row.trust_account_withdrawal.to_plain_string(),
            recorded_by: Some(row.recorded_by),
            updated_at: Some(iso_utc(&row.updated_at)),
        }
    }

    /// The defaults served when nothing has been recorded for the loan yet:
    /// not deployed, all amounts zero (absence-as-default, mirrors
    /// `loan_disbursement`).
    fn defaults(loan_id: &BigDecimal) -> Self {
        Self {
            loan_id: loan_id.to_plain_string(),
            is_loan_deployed: false,
            on_ramp_transferred: "0".to_owned(),
            off_ramp_transferred: "0".to_owned(),
            trust_account_deposit: "0".to_owned(),
            trust_account_withdrawal: "0".to_owned(),
            recorded_by: None,
            updated_at: None,
        }
    }
}

/// OpenAPI doc bundle for the loan-transfers routes. Tagged `CapitalAllocation`
/// because these records back the capital-allocation buckets, not the loan-book
/// aggregation.
#[derive(OpenApi)]
#[openapi(
    paths(get_loan_transfers, upsert_loan_transfers),
    components(schemas(UpsertLoanTransfersRequest, LoanTransfersResponse)),
    modifiers(&SecurityAddon)
)]
pub struct LoanTransfersDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/loan-book/{loan_id}/transfers",
        get(get_loan_transfers).post(upsert_loan_transfers),
    )
}

// ── Handlers ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/loan-book/{loan_id}/transfers",
    params(
        ("loan_id" = String, Path, description = "On-chain loan id"),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "The loan's capital-transfers record (defaults when nothing recorded yet)", body = LoanTransfersResponse),
        (status = 400, description = "Malformed loan id"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "Loan not indexed on this chain"),
    ),
    security(("bearer_auth" = [])),
    tag = "CapitalAllocation"
)]
async fn get_loan_transfers(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<LoanTransfersResponse>, ApiError> {
    let (chain_id, loan_id) = trustee_indexed_loan_guard(&claims, &state, &loan_id, &query).await?;

    let row = state
        .loan_capital_transfers_repo
        .get(chain_id, &loan_id)
        .await?;

    Ok(Json(match row {
        Some(row) => LoanTransfersResponse::from_row(row),
        None => LoanTransfersResponse::defaults(&loan_id),
    }))
}

#[utoipa::path(
    post,
    path = "/v1/loan-book/{loan_id}/transfers",
    params(
        ("loan_id" = String, Path, description = "On-chain loan id"),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    request_body = UpsertLoanTransfersRequest,
    responses(
        (status = 200, description = "Record created or replaced; the stored record", body = LoanTransfersResponse),
        (status = 400, description = "Malformed loan id or payload failed validation"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "Loan not indexed on this chain"),
    ),
    security(("bearer_auth" = [])),
    tag = "CapitalAllocation"
)]
async fn upsert_loan_transfers(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    Query(query): Query<ChainQuery>,
    Json(payload): Json<UpsertLoanTransfersRequest>,
) -> Result<Json<LoanTransfersResponse>, ApiError> {
    let (chain_id, loan_id) = trustee_indexed_loan_guard(&claims, &state, &loan_id, &query).await?;

    let values = validate_loan_transfers(&payload).map_err(ApiError::BadRequest)?;

    let row = state
        .loan_capital_transfers_repo
        .upsert(chain_id, &loan_id, &values, &claims.sub)
        .await?;

    Ok(Json(LoanTransfersResponse::from_row(row)))
}

// ── Validation (pure) ────────────────────────────────────────────────────────

/// Upper bound for a single entered amount: one quadrillion dollars. Far above
/// any real cash-rail movement, but safely inside Postgres `NUMERIC` limits and
/// float-parseable by the Trustee frontend — an out-of-range entry is rejected
/// as a 400 instead of surfacing as an INSERT-time 500 or an absurd stored value.
const MAX_AMOUNT_DOLLARS: i64 = 1_000_000_000_000_000;

/// Maximum decimal places for an entered amount. Cash-rail figures are dollars
/// and cents; 6 leaves headroom while keeping pathological scales (e.g.
/// `1e-131000`, which would overflow `NUMERIC`'s scale limit at INSERT time) out.
const MAX_AMOUNT_SCALE: i64 = 6;

/// Pure validation for [`UpsertLoanTransfersRequest`] — no I/O, unit-tested
/// directly (`packages/api/tests/loan_transfers.rs`). Each amount must parse as
/// a non-negative decimal no greater than [`MAX_AMOUNT_DOLLARS`] with at most
/// [`MAX_AMOUNT_SCALE`] decimal places; sign is implied entirely by the field
/// name (derived bucket values may go negative, individual entries may not).
pub fn validate_loan_transfers(
    req: &UpsertLoanTransfersRequest,
) -> Result<LoanCapitalTransfersValues, String> {
    let parse = |label: &str, s: &str| -> Result<BigDecimal, String> {
        let amount = BigDecimal::from_str(s)
            .map_err(|_| format!("`{label}` is not a valid decimal: {s}"))?;
        if amount < 0 {
            return Err(format!("`{label}` must be >= 0; got {amount}"));
        }
        if amount > MAX_AMOUNT_DOLLARS {
            return Err(format!(
                "`{label}` must be <= {MAX_AMOUNT_DOLLARS}; got {amount}"
            ));
        }
        // `normalized()` drops trailing zeros so "1.50" (scale 2) and "1.500000"
        // (scale 6) both pass; the exponent of the normalized value is its
        // effective decimal-place count.
        let (_, scale) = amount.normalized().as_bigint_and_exponent();
        if scale > MAX_AMOUNT_SCALE {
            return Err(format!(
                "`{label}` must have at most {MAX_AMOUNT_SCALE} decimal places; got {amount}"
            ));
        }
        Ok(amount)
    };

    Ok(LoanCapitalTransfersValues {
        is_loan_deployed: req.is_loan_deployed,
        on_ramp_transferred: parse("on_ramp_transferred", &req.on_ramp_transferred)?,
        off_ramp_transferred: parse("off_ramp_transferred", &req.off_ramp_transferred)?,
        trust_account_deposit: parse("trust_account_deposit", &req.trust_account_deposit)?,
        trust_account_withdrawal: parse("trust_account_withdrawal", &req.trust_account_withdrawal)?,
    })
}
