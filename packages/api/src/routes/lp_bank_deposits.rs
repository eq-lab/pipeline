// spec: Issue #1413, epic #1269

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use sha2::{Digest, Sha256};
use shared::lp_bank_deposit_repo::{LpBankDepositRepo, LpBankDepositRow};
use shared::lp_ledger_repo::LpLedgerRepo;

use crate::auth::{AuthClaims, Claims, SecurityAddon, TRUSTEE_ROLE};
use crate::error::{is_unique_violation, ApiError};
use crate::formatting::iso_utc;
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct RecordBankDepositRequest {
    /// Plain dollar decimal string, > 0, at most 2 decimal places (e.g.
    /// `"50000.00"`) — matches `lp_bank_deposits.amount`'s `NUMERIC(20,2)`.
    pub amount: String,
    /// The bank's reference for this wire. Required, and unique across every
    /// deposit — it is what identifies the wire, and what `ref_hash` is taken
    /// over. Stored trimmed.
    pub payment_reference: String,
    /// When the wire actually landed, ISO-8601 with an offset (e.g.
    /// `"2026-10-05T15:41:00Z"`). Stored, and reported back, as UTC.
    pub occurred_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BankDepositResponse {
    pub id: i64,
    pub lp_id: i64,
    /// Plain dollar decimal string, exactly as stored.
    pub amount: String,
    pub payment_reference: String,
    /// `sha256(payment_reference)`, lowercase hex — the 32 bytes the Stellar
    /// minter takes as `ref_hash` when the PLUSD leg is minted.
    pub ref_hash: String,
    /// ISO-8601 UTC.
    pub occurred_at: String,
    /// Whether the PLUSD leg has been minted on Stellar. Always `false` for now
    /// — the mint call is a later issue (#11).
    pub is_minted: bool,
    /// The authenticated Trustee (JWT `sub`) who recorded the deposit.
    pub recorded_by: String,
    /// ISO-8601 UTC — when the row was written (`now()` at insert).
    pub created_at: String,
}

impl From<LpBankDepositRow> for BankDepositResponse {
    fn from(row: LpBankDepositRow) -> Self {
        Self {
            id: row.id,
            lp_id: row.lp_id,
            amount: row.amount.to_plain_string(),
            payment_reference: row.payment_reference,
            ref_hash: hex::encode(row.ref_hash),
            occurred_at: iso_utc(&row.occurred_at),
            is_minted: row.is_minted,
            recorded_by: row.recorded_by,
            created_at: iso_utc(&row.created_at),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BankDepositsResponse {
    pub deposits: Vec<BankDepositResponse>,
}

#[derive(OpenApi)]
#[openapi(
    paths(list_bank_deposits, record_bank_deposit),
    components(schemas(
        RecordBankDepositRequest,
        BankDepositResponse,
        BankDepositsResponse
    )),
    modifiers(&SecurityAddon),
    tags((
        name = "LpBankDeposits",
        description = "Per-LP record of wires received from that LP"
    ))
)]
pub struct LpBankDepositsDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/lps/{id}/bank-deposits",
        get(list_bank_deposits).post(record_bank_deposit),
    )
}

// ── Handlers ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/lps/{id}/bank-deposits",
    params(("id" = i64, Path, description = "LP id")),
    responses(
        (status = 200, description = "The LP's recorded bank deposits, newest first", body = BankDepositsResponse),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No LP with this id"),
    ),
    security(("bearer_auth" = [])),
    tag = "LpBankDeposits"
)]
async fn list_bank_deposits(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<BankDepositsResponse>, ApiError> {
    require_trustee(&claims)?;
    known_lp(&state, id).await?;

    let rows = state.lp_bank_deposit_repo.list_for_lp(id).await?;
    Ok(Json(BankDepositsResponse {
        deposits: rows.into_iter().map(BankDepositResponse::from).collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/v1/lps/{id}/bank-deposits",
    params(("id" = i64, Path, description = "LP id")),
    request_body = RecordBankDepositRequest,
    responses(
        (status = 201, description = "Deposit recorded", body = BankDepositResponse),
        (status = 400, description = "Malformed payload"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No LP with this id"),
        (status = 409, description = "This `payment_reference` is already recorded"),
    ),
    security(("bearer_auth" = [])),
    tag = "LpBankDeposits"
)]
async fn record_bank_deposit(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(payload): Json<RecordBankDepositRequest>,
) -> Result<(StatusCode, Json<BankDepositResponse>), ApiError> {
    require_trustee(&claims)?;
    let values = validate_record_bank_deposit(&payload).map_err(ApiError::BadRequest)?;
    known_lp(&state, id).await?;

    let mut tx = state.pool.begin().await?;

    let deposit = LpBankDepositRepo::insert(
        &mut tx,
        id,
        &values.amount,
        &values.payment_reference,
        &values.ref_hash,
        values.occurred_at,
        &claims.sub,
    )
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            ApiError::Conflict(format!(
                "a deposit with payment reference `{}` is already recorded",
                values.payment_reference
            ))
        } else {
            ApiError::from(e)
        }
    })?;

    LpLedgerRepo::insert_deposit(
        &mut tx,
        id,
        &values.amount,
        deposit.id,
        values.occurred_at,
        &claims.sub,
    )
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(BankDepositResponse::from(deposit)),
    ))
}

fn require_trustee(claims: &Claims) -> Result<(), ApiError> {
    if claims.has_role(TRUSTEE_ROLE) {
        return Ok(());
    }
    Err(ApiError::Forbidden(format!(
        "this endpoint requires the `{TRUSTEE_ROLE}` role"
    )))
}

async fn known_lp(state: &AppState, id: i64) -> Result<(), ApiError> {
    state
        .lp_repo
        .find(id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("no LP with id {id}")))?;
    Ok(())
}

// ── Validation (pure) ────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct RecordBankDepositValues {
    pub amount: BigDecimal,
    pub payment_reference: String,
    pub ref_hash: [u8; 32],
    pub occurred_at: DateTime<Utc>,
}

const MAX_AMOUNT_DOLLARS: i64 = 1_000_000_000_000_000;

const MAX_AMOUNT_SCALE: i64 = 2;

pub fn validate_record_bank_deposit(
    req: &RecordBankDepositRequest,
) -> Result<RecordBankDepositValues, String> {
    let amount = BigDecimal::from_str(req.amount.trim())
        .map_err(|_| format!("`amount` is not a valid decimal: {}", req.amount))?;
    if amount <= 0 {
        return Err(format!("`amount` must be > 0; got {amount}"));
    }
    if amount > MAX_AMOUNT_DOLLARS {
        return Err(format!(
            "`amount` must be <= {MAX_AMOUNT_DOLLARS}; got {amount}"
        ));
    }
    let (_, scale) = amount.normalized().as_bigint_and_exponent();
    if scale > MAX_AMOUNT_SCALE {
        return Err(format!(
            "`amount` must have at most {MAX_AMOUNT_SCALE} decimal places; got {amount}"
        ));
    }

    let payment_reference = req.payment_reference.trim();
    if payment_reference.is_empty() {
        return Err("`payment_reference` must not be blank".to_owned());
    }

    let occurred_at = parse_iso8601("occurred_at", &req.occurred_at)?;

    Ok(RecordBankDepositValues {
        amount,
        ref_hash: reference_hash(payment_reference),
        payment_reference: payment_reference.to_owned(),
        occurred_at,
    })
}

/// The minter's `ref_hash`: `sha256` over the stored reference's UTF-8 bytes.
/// Never the zero hash the contract refuses, since the reference is non-empty.
pub fn reference_hash(payment_reference: &str) -> [u8; 32] {
    Sha256::digest(payment_reference.as_bytes()).into()
}

fn parse_iso8601(label: &str, raw: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(raw.trim())
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| {
            format!("`{label}` is not an ISO-8601 timestamp with an offset (e.g. `2026-10-05T15:41:00Z`): {raw}")
        })
}
