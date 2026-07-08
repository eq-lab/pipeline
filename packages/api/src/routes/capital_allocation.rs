//! Capital Allocation endpoint (`GET /v1/capital-allocation`).
//!
//! Backs the "Capital Allocation" money bar on the Trustee Overview page — a
//! breakdown of protocol capital into named buckets. Conventions match
//! `routes::financial_position` / `routes::loan_book`: Axum handler, utoipa schema,
//! base-6 decimal strings for amounts, `chain_id?` defaulting to `DEFAULT_CHAIN_ID`.
//!
//! ## Data availability (v1)
//!
//! Only `deployed` is sourceable from the indexer today; the other buckets are
//! served as `null` with a TODO pointing at their eventual source:
//!
//! - **`deployed`** — Σ `original_senior_tranche` over active loans (senior-only;
//!   this differs from `financial-position.secured_loans_outstanding`, which is
//!   senior + equity). The active-loan set (`origination_date ≤ now < effective_end`)
//!   mirrors `routes::financial_position` / `routes::loan_book`.
//! - **`capital_wallet`** — `null`. TODO: index the Capital-Wallet USDC balance.
//! - **`in_transit`** — `null`. TODO: index converting / in-transit balances.
//! - **`trust_account`** — `null`. TODO: fetch from the bank API.
//! - **`tbills`** — `null`. TODO: index the USYC / T-Bills holding.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::{LifecycleRow, LoanSnapshotRow};

use crate::error::ApiError;
use crate::formatting::base6_to_decimal_string;
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// The Capital Allocation buckets. Amounts are base-6 USDC decimal strings;
/// `null` means the bucket has no indexed source yet (see module docs).
#[derive(Debug, Serialize, ToSchema)]
pub struct CapitalBuckets {
    /// Capital-Wallet USDC, idle. `null` — not indexed.
    /// TODO: index the Capital-Wallet USDC balance and populate this.
    pub capital_wallet: Option<String>,
    /// Funds converting at providers (on/off-ramp). `null` — not indexed.
    /// TODO: index converting / in-transit balances and populate this.
    pub in_transit: Option<String>,
    /// USD residuals held in the trust account. `null` — not indexed.
    /// TODO: fetch from the bank API and populate this.
    pub trust_account: Option<String>,
    /// Σ senior tranche over active loans, USDC (6-decimal string). Senior-only —
    /// distinct from `financial-position.secured_loans_outstanding` (senior + equity).
    pub deployed: Option<String>,
    /// USYC / T-Bills holding valued at issuer NAV. `null` — not indexed.
    /// TODO: index the USYC / T-Bills holding and populate this.
    pub tbills: Option<String>,
}

/// Response for `GET /v1/capital-allocation`.
#[derive(Debug, Serialize, ToSchema)]
pub struct CapitalAllocationResponse {
    /// Σ of the available buckets (`deployed` only, while the rest are `null`).
    pub total: Option<String>,
    pub buckets: CapitalBuckets,
}

/// OpenAPI doc bundle for the capital-allocation route.
#[derive(OpenApi)]
#[openapi(
    paths(get_capital_allocation),
    components(schemas(CapitalAllocationResponse, CapitalBuckets)),
    tags((name = "CapitalAllocation", description = "Trustee Overview capital allocation"))
)]
pub struct CapitalAllocationDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/capital-allocation", get(get_capital_allocation))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/capital-allocation",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Capital allocation buckets", body = CapitalAllocationResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "CapitalAllocation"
)]
async fn get_capital_allocation(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<CapitalAllocationResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);

    // As-of "now" — matches the window-ends-at-now semantics of the other read endpoints.
    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let loans = state
        .contract_logs_repo
        .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, to)
        .await?;
    let events = state
        .contract_logs_repo
        .list_loan_lifecycle_events(&state.pool, chain_id, to)
        .await?;

    Ok(Json(compute_capital_allocation(&loans, &events, to)))
}

// ── Compute ──────────────────────────────────────────────────────────────────

/// Effective end of a loan: `min(original_maturity_date, earliest LoanClosed /
/// LoanDefaulted timestamp)`. Mirrors `routes::financial_position` / `routes::loan_book`
/// so the active-loan set is identical across endpoints.
fn effective_end(loan: &LoanSnapshotRow, events: &[LifecycleRow]) -> i64 {
    let lifecycle_end = events
        .iter()
        .filter(|e| {
            (e.event_name == "LoanClosed" || e.event_name == "LoanDefaulted")
                && e.loan_id == loan.loan_id
        })
        .map(|e| e.block_timestamp)
        .min();

    match lifecycle_end {
        Some(lc) => loan.snapshot.original_maturity_date.min(lc),
        None => loan.snapshot.original_maturity_date,
    }
}

/// Pure computation: no DB calls. Builds the capital allocation from pre-fetched
/// loan snapshots and lifecycle events as-of `to`.
///
/// "Active" = `origination_date ≤ to < effective_end`, matching `routes::loan_book`.
/// Only `deployed` (Σ senior tranche over the active set) is sourced; the remaining
/// buckets are `null` (no source yet — see module docs).
///
/// Public so the compute-layer test in `packages/api/tests/capital_allocation.rs` can
/// exercise it without the HTTP/DB layers.
pub fn compute_capital_allocation(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    to: i64,
) -> CapitalAllocationResponse {
    let mut deployed = BigDecimal::from(0);

    for loan in loans {
        let s = &loan.snapshot;
        if s.origination_date <= to && to < effective_end(loan, events) {
            deployed += &s.original_senior_tranche;
        }
    }

    let deployed_str = base6_to_decimal_string(&deployed);

    CapitalAllocationResponse {
        // Only `deployed` contributes while the other buckets are null.
        total: Some(deployed_str.clone()),
        buckets: CapitalBuckets {
            capital_wallet: None,
            in_transit: None,
            trust_account: None,
            deployed: Some(deployed_str),
            tbills: None,
        },
    }
}
