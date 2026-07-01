//! Withdrawal Queue endpoint (`GET /v1/withdrawal-queue`).
//!
//! Protocol-level (aggregate, not per-wallet) read backing Panel C of the Protocol
//! Dashboard. Sourced entirely from `contract_logs` (`WithdrawalRequested` joined to
//! its latest `RequestClaimed`). Conventions match `routes::loan_book` — Axum handler,
//! utoipa schema, base-6 decimal strings for amounts, `chain_id?` defaulting to
//! `DEFAULT_CHAIN_ID`.
//!
//! A request is **Queued** while it has no matching `RequestClaimed`; once claimed it is
//! **Completed**. `in_queue_usd` sums each queued request's `amount` (the value owed to
//! the withdrawer); `requests_count` counts them. `estimated_wait_days` is the mean
//! historical time-in-queue over completed requests. `liquid_cover` needs available
//! Capital-Wallet USDC, which is not yet in `contract_logs`, so it is served as `null`
//! until the Panel A reserves endpoint exists.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode};
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::WithdrawalQueueRow;

use crate::error::ApiError;
use crate::formatting::base6_to_decimal_string;
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::AppState;

/// Seconds per day, for `estimated_wait_days`.
const SECS_PER_DAY: i64 = 86_400;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Aggregate header metrics for the Withdrawal Queue panel.
#[derive(Debug, Serialize, ToSchema)]
pub struct WithdrawalQueueSummary {
    /// Total amount currently in the queue = Σ each queued request's `amount`, USDC
    /// (6-decimal string).
    pub in_queue_usd: String,
    /// Number of requests currently queued (no matching `RequestClaimed` yet).
    pub requests_count: i64,
    /// Mean historical time-in-queue over completed requests, in days (1-decimal
    /// string, e.g. `"3.2"`). `null` when no request has completed yet.
    pub estimated_wait_days: Option<String>,
    /// Available Capital-Wallet USDC ÷ in-queue amount ("liquid cover", e.g. `"5.6"`).
    /// Always `null` for now — the USDC-available source is not yet in the API (pending
    /// the Panel A reserves endpoint).
    pub liquid_cover: Option<String>,
}

/// One row of the Withdrawal Queue table.
#[derive(Debug, Serialize, ToSchema)]
pub struct WithdrawalQueueItem {
    /// The withdrawing account address.
    pub account: String,
    /// Withdrawal amount requested, USDC (6-decimal string).
    pub amount: String,
    /// `"Queued"` (in the queue, not yet claimed) or `"Completed"` (claimed/filled).
    pub status: String,
}

/// Response for `GET /v1/withdrawal-queue`.
#[derive(Debug, Serialize, ToSchema)]
pub struct WithdrawalQueueResponse {
    pub summary: WithdrawalQueueSummary,
    /// All withdrawal requests, ordered by request timestamp descending (newest first).
    pub items: Vec<WithdrawalQueueItem>,
}

/// OpenAPI doc bundle for the withdrawal-queue route.
#[derive(OpenApi)]
#[openapi(
    paths(get_withdrawal_queue),
    components(schemas(WithdrawalQueueResponse, WithdrawalQueueSummary, WithdrawalQueueItem)),
    tags((name = "WithdrawalQueue", description = "Protocol withdrawal queue aggregation"))
)]
pub struct WithdrawalQueueDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/withdrawal-queue", get(get_withdrawal_queue))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/withdrawal-queue",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Withdrawal queue summary and item table", body = WithdrawalQueueResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "WithdrawalQueue"
)]
async fn get_withdrawal_queue(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<WithdrawalQueueResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);

    // As-of "now" — matches the window-ends-at-now semantics of the other read endpoints.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let rows = state
        .contract_logs_repo
        .list_withdrawal_queue_rows(&state.pool, chain_id, now)
        .await?;

    Ok(Json(compute_withdrawal_queue(&rows)))
}

// ── Compute ──────────────────────────────────────────────────────────────────

/// Is a row currently in the queue? — no matching claim yet.
fn is_queued(row: &WithdrawalQueueRow) -> bool {
    row.claimed_at.is_none()
}

/// Pure computation: no DB calls. Builds the queue summary + item table from pre-fetched
/// rows.
///
/// A row is **Queued** iff it has no matching claim (see [`is_queued`]), otherwise
/// **Completed**. `in_queue_usd` sums each queued row's `amount`; `requests_count` counts
/// queued rows. `estimated_wait_days` is the mean `claimed_at − requested_at` over
/// completed rows that carry a claim timestamp, in days. `liquid_cover` is `null` pending
/// a USDC source. Items are ordered by `requested_at` descending (newest first).
///
/// Public so the compute-layer test in `packages/api/tests/withdrawal_queue.rs` can
/// exercise it without the HTTP/DB layers.
pub fn compute_withdrawal_queue(rows: &[WithdrawalQueueRow]) -> WithdrawalQueueResponse {
    let mut in_queue = BigDecimal::from(0);
    let mut requests_count = 0_i64;

    // Mean historical wait over rows that actually completed via a claim.
    let mut wait_sum = 0_i64;
    let mut wait_n = 0_i64;

    for row in rows {
        if is_queued(row) {
            // Queue depth = value owed to still-unclaimed withdrawers.
            in_queue += &row.amount;
            requests_count += 1;
        } else if let Some(claimed_at) = row.claimed_at {
            wait_sum += (claimed_at - row.requested_at).max(0);
            wait_n += 1;
        }
    }

    let estimated_wait_days = (wait_n > 0).then(|| {
        (BigDecimal::from(wait_sum) / BigDecimal::from(wait_n) / BigDecimal::from(SECS_PER_DAY))
            .with_scale_round(1, RoundingMode::HalfUp)
            .to_plain_string()
    });

    // Items: every request, newest first, labelled Queued vs Completed.
    let mut items: Vec<&WithdrawalQueueRow> = rows.iter().collect();
    items.sort_by_key(|r| std::cmp::Reverse(r.requested_at));
    let items = items
        .into_iter()
        .map(|r| WithdrawalQueueItem {
            account: r.withdrawer.clone(),
            amount: base6_to_decimal_string(&r.amount),
            status: if is_queued(r) { "Queued" } else { "Completed" }.to_owned(),
        })
        .collect();

    WithdrawalQueueResponse {
        summary: WithdrawalQueueSummary {
            in_queue_usd: base6_to_decimal_string(&in_queue),
            requests_count,
            estimated_wait_days,
            liquid_cover: None,
        },
        items,
    }
}
