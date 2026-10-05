//! LP ledger endpoints (`/v1/lp-ledger/*`). Trustee-only.
//!
//! `GET /v1/lp-ledger?lp_id=…` returns committed/repaid/balance per LP, summed
//! straight from `lp_ledger` — see `shared::lp_ledger_repo::LpLedgerRepo::summaries`
//! for the exact definitions. Omit `lp_id` to list every LP with ledger activity.
//!
//! Wires enter through `POST /v1/lps/{id}/bank-deposits`
//! (`routes::lp_bank_deposits`, #1413), which appends the paired `lp_ledger`
//! Deposit row these sums read. This group is read-only.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::lp_ledger_repo::LpLedgerSummaryRow;

use crate::auth::{AuthClaims, SecurityAddon, TRUSTEE_ROLE};
use crate::error::ApiError;
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

/// OpenAPI doc bundle for the LP-ledger routes.
#[derive(OpenApi)]
#[openapi(
    paths(get_lp_ledger),
    components(schemas(LpLedgerSummaryResponse, LpLedgerSummariesResponse)),
    modifiers(&SecurityAddon),
    tags((name = "LpLedger", description = "Per-LP claim ledger summaries"))
)]
pub struct LpLedgerDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/lp-ledger", get(get_lp_ledger))
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
