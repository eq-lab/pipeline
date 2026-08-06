//! Ramp API group (`/v1/ramp/*`, #936).
//!
//! Backs the Stellar on/off-ramp workflow: the indexer (#789) records every
//! `AssetTransfer` touching a configured custody or ramp address; this module
//! surfaces the configured ramp addresses, lists **pending** ramp-boundary events
//! (on-ramp `ramp→custody` AND off-ramp `custody→ramp`) awaiting Trustee review,
//! and lets a Trustee approve or reject one by id (mirrors `routes::loan_book`'s
//! `POST /v1/loan-book/submissions/{id}/review`). Every ramp-boundary transfer
//! needs Trustee review — not just inflows.
//!
//! Once reviewed, an event is recorded in `ramp_reviews` (keyed by
//! `contract_logs.id`) and — only if the decision was Approved —
//! `routes::capital_allocation`'s `in_transit` bucket starts counting it toward
//! the gross ramp flow (both legs add, as absolute amounts — #1027). A Rejected
//! event simply drops off the pending list and never counts.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::AssetTransferRow;

use crate::auth::{AuthClaims, SecurityAddon, TRUSTEE_ROLE};
use crate::config::TransferAddressSets;
use crate::error::ApiError;
use crate::formatting::base6_to_decimal_string;
use crate::routes::capital_allocation::normalize_to_canonical;
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Response for `GET /v1/ramp/addresses`.
#[derive(Debug, Serialize, ToSchema)]
pub struct RampAddressesResponse {
    /// The chain's configured ramp addresses (`CHAIN_<id>_API_STELLAR_RAMP_ADDRESSES`).
    /// Empty when the chain has no custody+ramp address sets configured.
    pub ramp_addresses: Vec<String>,
}

/// Which leg of the custody/ramp boundary a `RampEvent` crossed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub enum RampEventType {
    /// `ramp → custody`: external funds moving into custody.
    OnRamp,
    /// `custody → ramp`: custody funds moving out to the ramp.
    OffRamp,
}

/// One pending ramp-boundary `AssetTransfer` event awaiting Trustee review.
#[derive(Debug, Serialize, ToSchema)]
pub struct RampEvent {
    /// `contract_logs.id` — pass this to `POST /v1/ramp/events/{id}/review`.
    pub id: i64,
    /// `OnRamp` (ramp→custody) or `OffRamp` (custody→ramp).
    #[serde(rename = "type")]
    pub event_type: RampEventType,
    /// Recipient Strkey.
    pub to: String,
    /// Sender Strkey.
    pub from: String,
    /// Transfer amount, normalized to the canonical 6-decimal USDC base units
    /// (matches `routes::capital_allocation`'s amount convention).
    pub amount: String,
    /// Unix seconds the transfer was recorded on-chain.
    pub created_at: i64,
}

/// Response for `GET /v1/ramp/events`.
#[derive(Debug, Serialize, ToSchema)]
pub struct RampEventsResponse {
    /// Pending events only (both on-ramp and off-ramp) — a reviewed (approved or
    /// rejected) event drops off this list.
    pub events: Vec<RampEvent>,
}

/// The trustee decision in `POST /v1/ramp/events/{id}/review`. Mirrors
/// `routes::loan_book::ReviewDecision`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
pub enum RampReviewDecision {
    Approved,
    Rejected,
}

/// Request body for `POST /v1/ramp/events/{id}/review`. Mirrors
/// `routes::loan_book::ReviewRequest`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RampReviewRequest {
    /// `Approved` or `Rejected`.
    pub decision: RampReviewDecision,
    /// Required when `decision = Rejected`; must be omitted/empty otherwise.
    #[serde(default)]
    pub reason: Option<String>,
}

/// OpenAPI doc bundle for the ramp routes.
#[derive(OpenApi)]
#[openapi(
    paths(get_ramp_addresses, list_ramp_events, review_ramp_event),
    components(schemas(
        RampAddressesResponse,
        RampEvent,
        RampEventType,
        RampEventsResponse,
        RampReviewRequest,
        RampReviewDecision
    )),
    modifiers(&SecurityAddon),
    tags((name = "Ramp", description = "Stellar on/off-ramp addresses and ramp-event review"))
)]
pub struct RampDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ramp/addresses", get(get_ramp_addresses))
        .route("/ramp/events", get(list_ramp_events))
        .route("/ramp/events/{id}/review", post(review_ramp_event))
}

// ── Handlers ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/ramp/addresses",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Configured ramp addresses", body = RampAddressesResponse),
    ),
    tag = "Ramp"
)]
async fn get_ramp_addresses(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChainQuery>,
) -> Json<RampAddressesResponse> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let mut ramp_addresses: Vec<String> = state
        .transfer_addresses
        .get(&chain_id)
        .map(|sets| sets.ramp.iter().cloned().collect())
        .unwrap_or_default();
    ramp_addresses.sort();
    Json(RampAddressesResponse { ramp_addresses })
}

#[utoipa::path(
    get,
    path = "/v1/ramp/events",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Pending on-ramp and off-ramp events", body = RampEventsResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Ramp"
)]
async fn list_ramp_events(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<RampEventsResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let Some(addr) = state.transfer_addresses.get(&chain_id) else {
        // Not configured for this chain — no ramp/custody sets to classify against.
        return Ok(Json(RampEventsResponse { events: Vec::new() }));
    };

    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let transfers = state
        .contract_logs_repo
        .list_asset_transfers(&state.pool, chain_id, to)
        .await?;

    Ok(Json(RampEventsResponse {
        events: filter_pending_ramp_events(&transfers, addr),
    }))
}

/// Approve or reject a ramp-boundary event (on-ramp or off-ramp). Trustee-only. A
/// rejection must carry a non-empty `reason`; an approval must not. Only a pending
/// (unreviewed) event can be reviewed — reviewing an already-decided event returns
/// `409 Conflict`. Mirrors `routes::loan_book::review_submission`.
#[utoipa::path(
    post,
    path = "/v1/ramp/events/{id}/review",
    params(
        ("id" = i64, Path, description = "The ramp event's contract_logs.id"),
    ),
    request_body = RampReviewRequest,
    responses(
        (status = 200, description = "Decision recorded"),
        (status = 400, description = "Reject without a reason, approve with one, or the id is not a ramp-boundary (on-ramp/off-ramp) transfer"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No AssetTransfer event with this id"),
        (status = 409, description = "This event has already been reviewed"),
    ),
    security(("bearer_auth" = [])),
    tag = "Ramp"
)]
async fn review_ramp_event(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<RampReviewRequest>,
) -> Result<StatusCode, ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

    let (decision, reason) = resolve_ramp_review(&req).map_err(ApiError::BadRequest)?;

    let transfer = state
        .contract_logs_repo
        .get_asset_transfer_by_id(&state.pool, id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("no AssetTransfer event with id {id}")))?;

    let addr = state
        .transfer_addresses
        .get(&transfer.chain_id)
        .ok_or_else(|| ApiError::BadRequest("ramp/custody addresses not configured".to_owned()))?;
    if ramp_event_type(&transfer, addr).is_none() {
        return Err(ApiError::BadRequest(format!(
            "event {id} is not a ramp-boundary (on-ramp/off-ramp) transfer"
        )));
    }

    match state
        .contract_logs_repo
        .review_ramp_transfer(&state.pool, id, decision, reason, &claims.sub)
        .await
    {
        Ok(_) => Ok(StatusCode::OK),
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505") => Err(
            ApiError::Conflict(format!("event {id} has already been reviewed")),
        ),
        Err(e) => Err(e.into()),
    }
}

// ── Compute (pure) ───────────────────────────────────────────────────────────

/// Classify `t` against the configured address sets: `Some(OnRamp)` for
/// `ramp→custody`, `Some(OffRamp)` for `custody→ramp`, `None` for anything else
/// (custody↔custody / ramp↔ramp shuffles, or an untracked counterparty).
fn ramp_event_type(t: &AssetTransferRow, addr: &TransferAddressSets) -> Option<RampEventType> {
    if addr.ramp.contains(&t.from_addr) && addr.custody.contains(&t.to_addr) {
        Some(RampEventType::OnRamp)
    } else if addr.custody.contains(&t.from_addr) && addr.ramp.contains(&t.to_addr) {
        Some(RampEventType::OffRamp)
    } else {
        None
    }
}

/// Filter `transfers` down to pending (not yet reviewed) on-ramp and off-ramp
/// events, mapped to the API response shape. Pure — no I/O — so it's exercised
/// directly in `packages/api/tests/ramp.rs` without a DB. Public so that test crate
/// can reach it.
pub fn filter_pending_ramp_events(
    transfers: &[AssetTransferRow],
    addr: &TransferAddressSets,
) -> Vec<RampEvent> {
    transfers
        .iter()
        .filter(|t| t.is_pending_review())
        .filter_map(|t| {
            let event_type = ramp_event_type(t, addr)?;
            Some(RampEvent {
                id: t.id,
                event_type,
                to: t.to_addr.clone(),
                from: t.from_addr.clone(),
                amount: base6_to_decimal_string(&normalize_to_canonical(
                    t.amount.clone(),
                    addr.asset_decimals,
                )),
                created_at: t.block_timestamp,
            })
        })
        .collect()
}

/// Validate a review request and map it to the `(decision, reason)` the repo
/// expects. Pure (no I/O) so it is unit-testable. Reject ⇒ a non-empty `reason` is
/// required; Approve ⇒ no reason may be supplied. Mirrors
/// `routes::loan_book::resolve_review`.
///
/// Public so the unit test in `packages/api/tests/ramp.rs` can exercise it without
/// the HTTP/DB layers.
pub fn resolve_ramp_review(
    req: &RampReviewRequest,
) -> Result<(&'static str, Option<&str>), String> {
    match req.decision {
        RampReviewDecision::Rejected => {
            let reason = req
                .reason
                .as_deref()
                .map(str::trim)
                .filter(|r| !r.is_empty())
                .ok_or_else(|| {
                    "a non-empty `reason` is required to reject a ramp event".to_owned()
                })?;
            Ok(("Rejected", Some(reason)))
        }
        RampReviewDecision::Approved => {
            if req.reason.as_deref().is_some_and(|r| !r.trim().is_empty()) {
                return Err("`reason` must not be set when approving a ramp event".to_owned());
            }
            Ok(("Approved", None))
        }
    }
}
