//! Ramp API group (`/v1/ramp/*`, #936).
//!
//! Backs the Stellar on/off-ramp workflow: the indexer (#789) records every
//! `AssetTransfer` touching a configured custody or ramp address; this module
//! surfaces the configured ramp addresses, lists **pending** on-ramp (ramp→custody)
//! events awaiting Trustee review, and lets a Trustee approve one by id. Off-ramp
//! (custody→ramp) transfers need no approval and never appear here.
//!
//! Once approved, an event is recorded in `on_ramp_approvals` (keyed by
//! `contract_logs.id`) and `routes::capital_allocation`'s `in_transit` bucket starts
//! counting it against the custody-side total.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
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

/// One pending on-ramp (ramp→custody) `AssetTransfer` event awaiting Trustee approval.
#[derive(Debug, Serialize, ToSchema)]
pub struct OnRampEvent {
    /// `contract_logs.id` — pass this to `POST /v1/ramp/on-ramp/{id}/approve`.
    pub id: i64,
    /// Recipient Strkey (a configured custody address).
    pub to: String,
    /// Sender Strkey (a configured ramp address).
    pub from: String,
    /// Transfer amount, normalized to the canonical 6-decimal USDC base units
    /// (matches `routes::capital_allocation`'s amount convention).
    pub amount: String,
    /// Unix seconds the transfer was recorded on-chain.
    pub created_at: i64,
}

/// Response for `GET /v1/ramp/on-ramp`.
#[derive(Debug, Serialize, ToSchema)]
pub struct OnRampEventsResponse {
    /// Pending events only — an approved event drops off this list.
    pub events: Vec<OnRampEvent>,
}

/// Response for `POST /v1/ramp/on-ramp/{id}/approve`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ApproveOnRampEventResponse {
    pub contract_log_id: i64,
    /// Unix seconds the approval was recorded.
    pub approved_at: i64,
}

/// OpenAPI doc bundle for the ramp routes.
#[derive(OpenApi)]
#[openapi(
    paths(get_ramp_addresses, list_on_ramp_events, approve_on_ramp_event),
    components(schemas(
        RampAddressesResponse,
        OnRampEvent,
        OnRampEventsResponse,
        ApproveOnRampEventResponse
    )),
    modifiers(&SecurityAddon),
    tags((name = "Ramp", description = "Stellar on/off-ramp addresses and on-ramp approval"))
)]
pub struct RampDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ramp/addresses", get(get_ramp_addresses))
        .route("/ramp/on-ramp", get(list_on_ramp_events))
        .route("/ramp/on-ramp/{id}/approve", post(approve_on_ramp_event))
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
    path = "/v1/ramp/on-ramp",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Pending on-ramp events", body = OnRampEventsResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Ramp"
)]
async fn list_on_ramp_events(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<OnRampEventsResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let Some(addr) = state.transfer_addresses.get(&chain_id) else {
        // Not configured for this chain — no ramp/custody sets to classify against.
        return Ok(Json(OnRampEventsResponse { events: Vec::new() }));
    };

    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let transfers = state
        .contract_logs_repo
        .list_asset_transfers(&state.pool, chain_id, to)
        .await?;

    Ok(Json(OnRampEventsResponse {
        events: filter_pending_on_ramp_events(&transfers, addr),
    }))
}

#[utoipa::path(
    post,
    path = "/v1/ramp/on-ramp/{id}/approve",
    params(
        ("id" = i64, Path, description = "The on-ramp event's contract_logs.id"),
    ),
    responses(
        (status = 200, description = "Approval recorded", body = ApproveOnRampEventResponse),
        (status = 400, description = "The id is not an on-ramp (ramp→custody) transfer"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No AssetTransfer event with this id"),
        (status = 409, description = "This event has already been approved"),
    ),
    security(("bearer_auth" = [])),
    tag = "Ramp"
)]
async fn approve_on_ramp_event(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<ApproveOnRampEventResponse>, ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

    let transfer = state
        .contract_logs_repo
        .get_asset_transfer_by_id(&state.pool, id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("no AssetTransfer event with id {id}")))?;

    let addr = state
        .transfer_addresses
        .get(&transfer.chain_id)
        .ok_or_else(|| ApiError::BadRequest("ramp/custody addresses not configured".to_owned()))?;
    if !is_on_ramp(&transfer, addr) {
        return Err(ApiError::BadRequest(format!(
            "event {id} is not an on-ramp (ramp→custody) transfer"
        )));
    }

    let approved_at = match state
        .contract_logs_repo
        .approve_on_ramp_transfer(&state.pool, id, &claims.sub)
        .await
    {
        Ok(approved_at) => approved_at,
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505") => {
            return Err(ApiError::Conflict(format!(
                "event {id} has already been approved"
            )));
        }
        Err(e) => return Err(e.into()),
    };

    Ok(Json(ApproveOnRampEventResponse {
        contract_log_id: id,
        approved_at: approved_at.timestamp(),
    }))
}

// ── Compute (pure) ───────────────────────────────────────────────────────────

/// Whether `t` is an on-ramp transfer for the given address sets: sender is a
/// configured ramp address, recipient is a configured custody address.
fn is_on_ramp(t: &AssetTransferRow, addr: &TransferAddressSets) -> bool {
    addr.ramp.contains(&t.from_addr) && addr.custody.contains(&t.to_addr)
}

/// Filter `transfers` down to pending (not yet approved) on-ramp events, mapped to
/// the API response shape. Pure — no I/O — so it's exercised directly in
/// `packages/api/tests/ramp.rs` without a DB. Public so that test crate can reach it.
pub fn filter_pending_on_ramp_events(
    transfers: &[AssetTransferRow],
    addr: &TransferAddressSets,
) -> Vec<OnRampEvent> {
    transfers
        .iter()
        .filter(|t| is_on_ramp(t, addr) && t.approved_at.is_none())
        .map(|t| OnRampEvent {
            id: t.id,
            to: t.to_addr.clone(),
            from: t.from_addr.clone(),
            amount: base6_to_decimal_string(&normalize_to_canonical(
                t.amount.clone(),
                addr.asset_decimals,
            )),
            created_at: t.block_timestamp,
        })
        .collect()
}
