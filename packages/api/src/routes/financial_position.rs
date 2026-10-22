//! Statement of Financial Position endpoint (`GET /v1/financial-position`).
//!
//! Protocol-level (aggregate) read backing Panel A of the Protocol Dashboard — a
//! balance-sheet view: assets (liquid plus deployed) against liabilities (senior
//! claims plus subordinated capital). Conventions match `routes::loan_book` and
//! `routes::withdrawal_queue` — Axum handler, utoipa schema, base-6 decimal strings
//! for amounts, `chain_id?` — omitted = the union over all configured chains, a
//! well-formed unconfigured id = an all-zero statement.
//!
//! ## Data availability (v1)
//!
//! Only figures sourceable from the indexer (`contract_logs`) are computed; the rest
//! are served as `null`.
//!
//! - **Deployed assets** — from the latest `LoanSnapshot` per active loan:
//!   - `secured_loans_outstanding` = Σ (`original_senior_tranche` + `original_equity_tranche`).
//!   - `accrued_interest_receivable` = Σ `repayment.senior_interest`. NOTE: on-chain this
//!     is *cumulative senior interest already distributed* (via `PaymentRecorded`), not
//!     interest accrued-but-uncollected; there is no true "receivable" figure on-chain.
//!     Kept under this name pending a trustee-feed or day-count accrual source.
//! - **Subordinated capital** — `junior_tranche` = Σ `original_equity_tranche`, i.e. the
//!   total Originator first-loss margin (equity tranche) across active loans. On-chain
//!   original value; the authoritative trustee-attested commitment is not indexed.
//! - **Liquid assets** (`cash_stablecoins`, `tokenized_tbills`, `off_chain_usd`) — the
//!   Capital-Wallet USDC / USYC / in-transit balances are not indexed, so all `null`
//!   (the same gap that forces `liquid_cover: null` in `routes::withdrawal_queue`).
//! - **`plusd_outstanding`** — PLUSD `totalSupply` has no reliable indexed source (no
//!   `Transfer`/mint/burn events), so `null` rather than a stitched approximation.
//!
//! The active-loan set is `shared::loan_status` (originated and Approved / Performing /
//! WatchList at `now`), the one rule every loan-money endpoint uses. Like
//! `routes::loan_book`, each chain is read through its configured LoanRegistry address,
//! and status events only apply to loans on their own chain.

use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::{LifecycleRow, LoanSnapshotRow};
use shared::loan_status::is_active_at;

use crate::error::ApiError;
use crate::formatting::base6_to_decimal_string;
use crate::routes::common::LenientChainFilter;
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Liquid assets — cash-like holdings. All `null` in v1 (not indexed).
#[derive(Debug, Serialize, ToSchema)]
pub struct LiquidAssets {
    /// Σ of the available liquid leaves; `null` while none are sourced.
    pub total: Option<String>,
    /// Capital-Wallet USDC + stablecoin balance. `null` — not indexed.
    pub cash_stablecoins: Option<String>,
    /// USYC holding valued at issuer NAV. `null` — not indexed.
    pub tokenized_tbills: Option<String>,
    /// Off-chain / in-transit USD. `null` — not indexed.
    pub off_chain_usd: Option<String>,
}

/// Deployed assets — capital out on active loans.
#[derive(Debug, Serialize, ToSchema)]
pub struct DeployedAssets {
    /// `secured_loans_outstanding` + `accrued_interest_receivable`.
    pub total: Option<String>,
    /// Σ (senior + equity tranche) over active loans, USDC (6-decimal string).
    pub secured_loans_outstanding: Option<String>,
    /// Σ cumulative senior interest received over active loans, USDC (6-decimal string).
    pub accrued_interest_receivable: Option<String>,
}

/// Asset side of the balance sheet.
#[derive(Debug, Serialize, ToSchema)]
pub struct Assets {
    /// Σ of all available asset leaves (deployed only, while liquid is `null`).
    pub total: Option<String>,
    pub liquid: LiquidAssets,
    pub deployed: DeployedAssets,
}

/// Senior claims on the protocol.
#[derive(Debug, Serialize, ToSchema)]
pub struct SeniorClaims {
    /// Total PLUSD outstanding. `null` in v1 — no reliable supply source.
    pub plusd_outstanding: Option<String>,
}

/// Subordinated (junior / equity) capital.
#[derive(Debug, Serialize, ToSchema)]
pub struct SubordinatedCapital {
    /// Total Originator first-loss margin: Σ equity tranche over active loans, USDC
    /// (6-decimal string).
    pub junior_tranche: Option<String>,
}

/// Liability side of the balance sheet.
#[derive(Debug, Serialize, ToSchema)]
pub struct Liabilities {
    /// Σ of all available liability leaves (junior tranche only, while PLUSD is `null`).
    pub total: Option<String>,
    pub senior_claims: SeniorClaims,
    pub subordinated_capital: SubordinatedCapital,
}

/// Response for `GET /v1/financial-position`.
#[derive(Debug, Serialize, ToSchema)]
pub struct FinancialPositionResponse {
    pub assets: Assets,
    pub liabilities: Liabilities,
}

/// OpenAPI doc bundle for the financial-position route.
#[derive(OpenApi)]
#[openapi(
    paths(get_financial_position),
    components(schemas(
        FinancialPositionResponse,
        Assets,
        LiquidAssets,
        DeployedAssets,
        Liabilities,
        SeniorClaims,
        SubordinatedCapital,
    )),
    tags((name = "FinancialPosition", description = "Protocol statement of financial position"))
)]
pub struct FinancialPositionDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/financial-position", get(get_financial_position))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/financial-position",
    params(LenientChainFilter),
    responses(
        (status = 200, description = "Statement of financial position for the selected chain, or for all configured chains when `chain_id` is omitted", body = FinancialPositionResponse),
        (status = 400, description = "Malformed or repeated chain_id"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "FinancialPosition"
)]
async fn get_financial_position(
    State(state): State<Arc<AppState>>,
    chain: LenientChainFilter,
) -> Result<Json<FinancialPositionResponse>, ApiError> {
    // As-of "now" — matches the window-ends-at-now semantics of the other read endpoints.
    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let mut loans = Vec::new();
    let mut events = Vec::new();
    for c in chain.configured(&state.chains) {
        let Some(registry) = state.loan_registry_addresses.get(&c.chain_id) else {
            continue;
        };
        let chain_loans = state
            .contract_logs_repo
            .list_latest_loan_snapshots(&state.pool, c.chain_id, registry, to)
            .await?;
        if chain_loans.is_empty() {
            continue;
        }
        events.extend(
            state
                .contract_logs_repo
                .list_loan_lifecycle_events_for_registry(&state.pool, c.chain_id, registry, to)
                .await?,
        );
        loans.extend(chain_loans);
    }

    Ok(Json(compute_financial_position(&loans, &events, to)))
}

// ── Compute ──────────────────────────────────────────────────────────────────

/// Pure computation: no DB calls. Builds the statement of financial position from
/// pre-fetched loan snapshots and lifecycle events as-of `to`.
///
/// "Active" = `shared::loan_status::is_active_at(to)`, matching `routes::loan_book`.
/// Deployed assets and subordinated capital are summed over the active set; liquid
/// assets and `plusd_outstanding` are `null` (no source).
///
/// Public so the compute-layer test in `packages/api/tests/financial_position.rs` can
/// exercise it without the HTTP/DB layers.
pub fn compute_financial_position(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    to: i64,
) -> FinancialPositionResponse {
    let mut secured_loans = BigDecimal::from(0);
    let mut accrued_interest = BigDecimal::from(0);
    let mut junior_tranche = BigDecimal::from(0);

    for loan in loans {
        let s = &loan.snapshot;
        if is_active_at(loan, events, to) {
            secured_loans += &s.original_senior_tranche + &s.original_equity_tranche;
            accrued_interest += &s.repayment.senior_interest;
            junior_tranche += &s.original_equity_tranche;
        }
    }

    let deployed_total = &secured_loans + &accrued_interest;

    FinancialPositionResponse {
        assets: Assets {
            // Only deployed contributes while the liquid block is null.
            total: Some(base6_to_decimal_string(&deployed_total)),
            liquid: LiquidAssets {
                total: None,
                cash_stablecoins: None,
                tokenized_tbills: None,
                off_chain_usd: None,
            },
            deployed: DeployedAssets {
                total: Some(base6_to_decimal_string(&deployed_total)),
                secured_loans_outstanding: Some(base6_to_decimal_string(&secured_loans)),
                accrued_interest_receivable: Some(base6_to_decimal_string(&accrued_interest)),
            },
        },
        liabilities: Liabilities {
            // Only the junior tranche contributes while PLUSD supply is null.
            total: Some(base6_to_decimal_string(&junior_tranche)),
            senior_claims: SeniorClaims {
                plusd_outstanding: None,
            },
            subordinated_capital: SubordinatedCapital {
                junior_tranche: Some(base6_to_decimal_string(&junior_tranche)),
            },
        },
    }
}
