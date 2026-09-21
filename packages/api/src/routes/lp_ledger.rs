//! LP ledger endpoints (`/v1/lp-ledger/*`). Trustee-only.
//!
//! `GET /v1/lp-ledger?lp_id=…` returns committed/repaid/balance per LP, summed
//! straight from `lp_ledger` — see `shared::lp_ledger_repo::LpLedgerRepo::summaries`
//! for the exact definitions. Omit `lp_id` to list every LP with ledger activity.
//!
//! `POST /v1/lp-ledger/deposits` is presently the only way a wire enters the
//! system: the caller supplies the raw wire details, already matched to an LP
//! (there is no separate unidentified-wire queue yet), and the handler inserts
//! both the `bank_transactions` row and its paired `lp_ledger` Deposit row in
//! one transaction. `idempotency_key` must be unique per wire; a repeat is
//! rejected with `409` rather than silently creating a second deposit
//! (double-click protection).

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use shared::bank_transaction_repo::BankTransactionRepo;
use shared::lp_ledger_repo::{LpLedgerRepo, LpLedgerSummaryRow};

use crate::auth::{AuthClaims, SecurityAddon, TRUSTEE_ROLE};
use crate::error::ApiError;
use crate::formatting::iso_utc;
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Query params for `GET /v1/lp-ledger`.
#[derive(Debug, Deserialize, ToSchema, Default)]
pub struct LpLedgerQuery {
    /// Restrict to one LP. Omit to list every LP with ledger activity.
    #[serde(default)]
    pub lp_id: Option<i64>,
}

/// One LP's committed/repaid/balance summary.
#[derive(Debug, Serialize, ToSchema)]
pub struct LpLedgerSummaryResponse {
    pub lp_id: i64,
    /// Plain dollar decimal string. Sum of `Deposit` deltas.
    pub committed: String,
    /// Plain dollar decimal string. Sum of the magnitude of `Redemption` deltas.
    pub repaid: String,
    /// Plain dollar decimal string. Net running balance — sum of every delta.
    pub balance: String,
}

impl From<LpLedgerSummaryRow> for LpLedgerSummaryResponse {
    fn from(row: LpLedgerSummaryRow) -> Self {
        Self {
            lp_id: row.lp_id,
            committed: row.committed.to_plain_string(),
            repaid: row.repaid.to_plain_string(),
            balance: row.balance.to_plain_string(),
        }
    }
}

/// Response for `GET /v1/lp-ledger`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LpLedgerSummariesResponse {
    pub summaries: Vec<LpLedgerSummaryResponse>,
}

/// Request body for `POST /v1/lp-ledger/deposits`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct RecordDepositRequest {
    pub lp_id: i64,
    /// Non-negative plain dollar decimal string, at most 2 decimal places
    /// (e.g. `"50000.00"`) — matches `lp_ledger.delta`'s `NUMERIC(20,2)`.
    pub amount: String,
    #[serde(default)]
    pub payment_reference: Option<String>,
    /// When the wire actually landed (Unix seconds).
    pub occurred_at: u64,
    /// The date this deposit is priced at (Unix seconds) — may differ from
    /// `occurred_at` when entered late.
    pub dealing_date: u64,
    /// Caller-generated key; a repeat submission with the same key is
    /// rejected with `409` instead of creating a second deposit.
    pub idempotency_key: String,
}

/// Response for `POST /v1/lp-ledger/deposits`.
#[derive(Debug, Serialize, ToSchema)]
pub struct RecordDepositResponse {
    pub bank_transaction_id: i64,
    pub lp_ledger_id: i64,
    pub lp_id: i64,
    pub amount: String,
    pub payment_reference: Option<String>,
    /// ISO-8601 UTC.
    pub occurred_at: String,
    /// ISO-8601 UTC.
    pub dealing_date: String,
    /// The authenticated Trustee (JWT `sub`) who recorded the deposit.
    pub recorded_by: String,
    /// ISO-8601 UTC.
    pub created_at: String,
}

/// OpenAPI doc bundle for the LP-ledger routes.
#[derive(OpenApi)]
#[openapi(
    paths(get_lp_ledger, record_deposit),
    components(schemas(
        LpLedgerSummaryResponse,
        LpLedgerSummariesResponse,
        RecordDepositRequest,
        RecordDepositResponse
    )),
    modifiers(&SecurityAddon),
    tags((name = "LpLedger", description = "Per-LP claim ledger and wire-deposit entry"))
)]
pub struct LpLedgerDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/lp-ledger", get(get_lp_ledger))
        .route("/lp-ledger/deposits", post(record_deposit))
}

// ── Handlers ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/lp-ledger",
    params(("lp_id" = Option<i64>, Query, description = "Restrict to one LP (optional)")),
    responses(
        (status = 200, description = "Committed/repaid/balance per LP", body = LpLedgerSummariesResponse),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "lp_id given but no such LP"),
    ),
    security(("bearer_auth" = [])),
    tag = "LpLedger"
)]
async fn get_lp_ledger(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Query(query): Query<LpLedgerQuery>,
) -> Result<Json<LpLedgerSummariesResponse>, ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

    if let Some(lp_id) = query.lp_id {
        state
            .lp_repo
            .find(lp_id)
            .await?
            .ok_or_else(|| ApiError::NotFound(format!("no LP with id {lp_id}")))?;
    }

    let summaries = state.lp_ledger_repo.summaries(query.lp_id).await?;
    Ok(Json(LpLedgerSummariesResponse {
        summaries: summaries
            .into_iter()
            .map(LpLedgerSummaryResponse::from)
            .collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/v1/lp-ledger/deposits",
    request_body = RecordDepositRequest,
    responses(
        (status = 201, description = "Deposit recorded", body = RecordDepositResponse),
        (status = 400, description = "Malformed payload"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No LP with this id"),
        (status = 409, description = "idempotency_key was already used"),
    ),
    security(("bearer_auth" = [])),
    tag = "LpLedger"
)]
async fn record_deposit(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RecordDepositRequest>,
) -> Result<(StatusCode, Json<RecordDepositResponse>), ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

    let values = validate_record_deposit(&payload).map_err(ApiError::BadRequest)?;

    state
        .lp_repo
        .find(values.lp_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("no LP with id {}", values.lp_id)))?;

    let mut tx = state.pool.begin().await?;

    let bank_row = BankTransactionRepo::insert_deposit(
        &mut tx,
        values.lp_id,
        &values.amount,
        values.payment_reference.as_deref(),
        values.occurred_at,
        &claims.sub,
        values.idempotency_key,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.code().as_deref() == Some("23505") => {
            ApiError::Conflict(format!(
                "idempotency_key `{}` was already used",
                values.idempotency_key
            ))
        }
        other => ApiError::from(other),
    })?;

    let ledger_row = LpLedgerRepo::insert_deposit(
        &mut tx,
        values.lp_id,
        &values.amount,
        bank_row.id,
        values.dealing_date,
        &claims.sub,
    )
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(RecordDepositResponse {
            bank_transaction_id: bank_row.id,
            lp_ledger_id: ledger_row.id,
            lp_id: ledger_row.lp_id,
            amount: ledger_row.delta.to_plain_string(),
            payment_reference: bank_row.payment_reference,
            occurred_at: iso_utc(&bank_row.occurred_at),
            dealing_date: iso_utc(&ledger_row.dealing_date),
            recorded_by: ledger_row.recorded_by,
            created_at: iso_utc(&ledger_row.created_at),
        }),
    ))
}

// ── Validation (pure) ────────────────────────────────────────────────────────

/// The parsed, validated values of a [`RecordDepositRequest`].
#[derive(Debug, Clone, PartialEq)]
pub struct RecordDepositValues {
    pub lp_id: i64,
    pub amount: BigDecimal,
    pub payment_reference: Option<String>,
    pub occurred_at: DateTime<Utc>,
    pub dealing_date: DateTime<Utc>,
    pub idempotency_key: Uuid,
}

/// Upper bound for a single entered amount: one quadrillion dollars. Mirrors
/// `routes::loan_transfers::MAX_AMOUNT_DOLLARS` — far above any real wire,
/// comfortably inside Postgres `NUMERIC` limits.
const MAX_AMOUNT_DOLLARS: i64 = 1_000_000_000_000_000;

/// `lp_ledger.delta` is `NUMERIC(20,2)` — cash-rail figures are dollars and
/// cents. An entry with more precision than that would silently round
/// differently in `bank_transactions.amount` (unscaled `NUMERIC`) vs
/// `lp_ledger.delta`; reject it instead of letting the two tables drift.
const MAX_AMOUNT_SCALE: i64 = 2;

/// Pure validation for [`RecordDepositRequest`] — no I/O, unit-tested directly
/// (`packages/api/tests/lp_ledger.rs`).
pub fn validate_record_deposit(req: &RecordDepositRequest) -> Result<RecordDepositValues, String> {
    let amount = BigDecimal::from_str(&req.amount)
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

    let payment_reference = req
        .payment_reference
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);

    let occurred_at = unix_to_datetime("occurred_at", req.occurred_at)?;
    let dealing_date = unix_to_datetime("dealing_date", req.dealing_date)?;

    let idempotency_key = Uuid::from_str(req.idempotency_key.trim()).map_err(|_| {
        format!(
            "`idempotency_key` is not a valid UUID: {}",
            req.idempotency_key
        )
    })?;

    Ok(RecordDepositValues {
        lp_id: req.lp_id,
        amount,
        payment_reference,
        occurred_at,
        dealing_date,
        idempotency_key,
    })
}

/// Unix seconds → `DateTime<Utc>`. `400` (surfaced as an `Err(String)` here)
/// on the (practically unreachable, since `u64` can't go negative) out-of-range
/// case. Mirrors `routes::collateral_valuation::unix_to_datetime`.
fn unix_to_datetime(label: &str, unix_secs: u64) -> Result<DateTime<Utc>, String> {
    DateTime::from_timestamp(unix_secs as i64, 0)
        .ok_or_else(|| format!("`{label}` is not a valid unix timestamp: {unix_secs}"))
}
