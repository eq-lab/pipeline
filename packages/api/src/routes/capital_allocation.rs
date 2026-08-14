//! Capital Allocation endpoint (`GET /v1/capital-allocation`).
//!
//! Backs the "Capital Allocation" money bar on the Trustee Overview page — a
//! breakdown of protocol capital into named buckets. Conventions match
//! `routes::financial_position` / `routes::loan_book`: Axum handler, utoipa schema,
//! base-6 decimal strings for amounts, `chain_id?` defaulting to `DEFAULT_CHAIN_ID`.
//!
//! ## Bucket sources (#1027)
//!
//! Three buckets are driven by the Trustee-entered per-loan capital-transfers
//! record (`loan_capital_transfers`, written via
//! `POST /v1/loan-book/{loan_id}/transfers` — see `routes::loan_transfers`); the
//! rest are served as `null` with a TODO pointing at their eventual source:
//!
//! - **`deployed`** — Σ `original_senior_tranche` over loans that are **both**
//!   inside the active window (`origination_date ≤ now < effective_end`, mirroring
//!   `routes::financial_position` / `routes::loan_book`) **and** flagged
//!   `is_loan_deployed` by a Trustee. Senior-only — this differs from
//!   `financial-position.secured_loans_outstanding`, which is senior + equity.
//! - **`in_transit`** — gross approved ramp flow minus what Trustees have confirmed
//!   as transferred per loan:
//!   `Σ(approved custody↔ramp legs, both directions, absolute) −
//!   Σ(on_ramp_transferred + off_ramp_transferred)`. Sourced only when both custody
//!   and ramp address sets are configured
//!   (`CHAIN_<id>_API_STELLAR_{CUSTODY,RAMP}_ADDRESSES`); otherwise `null`. A leg
//!   only counts once a Trustee has reviewed the event and Approved it via
//!   `POST /v1/ramp/events/{id}/review` (#936) — a pending or Rejected transfer
//!   does not move `in_transit` at all. **Not clamped** (#1027): a negative value
//!   means Trustees recorded more per-loan confirmed transfers than the indexer
//!   observed as approved ramp flow — a real bookkeeping gap that should be
//!   visible, not hidden.
//! - **`trust_account`** — `Σ(trust_account_deposit) − Σ(trust_account_withdrawal)`
//!   over the chain's `loan_capital_transfers` rows. Chain-scoped (#1027 decision 6).
//!   Not clamped: a negative value means recorded
//!   withdrawals exceed recorded deposits, a real bookkeeping error that should be
//!   visible rather than hidden. Stored/returned as a **plain dollar figure** (no
//!   base-6 scaling — a cash-rail movement has no on-chain native scale); this
//!   endpoint scales it to base-6 units only when folding it into `total` alongside
//!   `deployed`/`in_transit`.
//! - **`withdrawal_queue`** — the Withdrawal Queue Wallet's current USDC balance
//!   (Issue #933), read from the running `params.wallet_balance_after` the indexer
//!   computes on each tracked `AssetTransfer` (`ContractLogsRepo::get_wallet_balance_as_of`).
//!   Sourced only when `CHAIN_<id>_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID` is
//!   configured; otherwise `null`. Not clamped at zero — like `trust_account`, a
//!   negative reading is a real tracking gap that should be visible, not hidden
//!   (e.g. the indexer started tracking after the wallet already held a balance).
//! - **`capital_wallet`** — `null`. TODO: index the Capital-Wallet USDC balance.
//! - **`tbills`** — `null`. TODO: index the USYC / T-Bills holding.

use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode};
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::{AssetTransferRow, LifecycleRow, LoanSnapshotRow};
use shared::loan_capital_transfers_repo::LoanCapitalTransfersRow;

use crate::config::{TransferAddressSets, CANONICAL_AMOUNT_DECIMALS};
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
    /// Funds in transit on the on/off-ramp legs — gross approved custody↔ramp flow
    /// (both directions, absolute) minus the Trustee-confirmed per-loan transfers
    /// (`Σ(on_ramp_transferred + off_ramp_transferred)`). `null` when custody/ramp
    /// address sets are not configured for the chain. Not clamped — may go
    /// negative (see module docs).
    pub in_transit: Option<String>,
    /// The Withdrawal Queue Wallet's current USDC balance (Issue #933). `null`
    /// when no wallet is configured for the chain. Not clamped at zero (see
    /// module docs).
    pub withdrawal_queue: Option<String>,
    /// USD residuals held in the trust account:
    /// `Σ(trust_account_deposit) − Σ(trust_account_withdrawal)` over the chain's
    /// Trustee-entered `loan_capital_transfers` rows. Chain-scoped, not clamped
    /// (see module docs).
    pub trust_account: Option<String>,
    /// Σ senior tranche over active loans flagged `is_loan_deployed`, USDC
    /// (6-decimal string). Senior-only — distinct from
    /// `financial-position.secured_loans_outstanding` (senior + equity).
    pub deployed: Option<String>,
    /// USYC / T-Bills holding valued at issuer NAV. `null` — not indexed.
    /// TODO: index the USYC / T-Bills holding and populate this.
    pub tbills: Option<String>,
}

/// Response for `GET /v1/capital-allocation`.
#[derive(Debug, Serialize, ToSchema)]
pub struct CapitalAllocationResponse {
    /// Σ of the available buckets (`deployed`, `in_transit` when present,
    /// `withdrawal_queue` when present, and `trust_account`; the rest are `null`
    /// until sourced). Unclamped buckets may reduce it.
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

    // The five reads are independent of each other — run them concurrently
    // rather than as a serial chain of round-trips (this endpoint is polled by
    // the Trustee Overview card).
    let (loans, events, transfers, withdrawal_queue_balance, capital_transfers) = tokio::try_join!(
        async {
            state
                .contract_logs_repo
                .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, to)
                .await
                .map_err(ApiError::from)
        },
        async {
            state
                .contract_logs_repo
                .list_loan_lifecycle_events(&state.pool, chain_id, to)
                .await
                .map_err(ApiError::from)
        },
        async {
            state
                .contract_logs_repo
                .list_asset_transfers(&state.pool, chain_id, to)
                .await
                .map_err(ApiError::from)
        },
        async {
            match state.withdrawal_queue_wallets.get(&chain_id) {
                Some(wallet) => state
                    .contract_logs_repo
                    .get_wallet_balance_as_of(&state.pool, chain_id, wallet, to)
                    .await
                    .map_err(ApiError::from),
                None => Ok(None),
            }
        },
        async {
            state
                .loan_capital_transfers_repo
                .list_for_chain(chain_id)
                .await
                .map_err(ApiError::from)
        },
    )?;
    let addr = state.transfer_addresses.get(&chain_id);
    let asset_decimals = state.asset_decimals.get(&chain_id).copied().unwrap_or(7);

    Ok(Json(compute_capital_allocation(
        &loans,
        &events,
        to,
        &transfers,
        addr,
        asset_decimals,
        withdrawal_queue_balance.as_ref(),
        &capital_transfers,
    )))
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

/// Normalize a raw on-chain amount from `asset_decimals` scale to the endpoint's
/// canonical 6-decimal base units. A 7-decimal USDC SAC amount is divided by 10;
/// a 6-decimal amount is returned unchanged. Config bounds `asset_decimals ≤ 18`,
/// so the exponent stays small and the `10i128.pow` cannot overflow.
///
/// `pub(crate)` so `routes::ramp` (#936) can present `AssetTransferRow.amount` in
/// the same canonical scale this endpoint uses, rather than duplicating the logic.
pub(crate) fn normalize_to_canonical(raw: BigDecimal, asset_decimals: u32) -> BigDecimal {
    use std::cmp::Ordering;

    use crate::config::CANONICAL_AMOUNT_DECIMALS as CANON;
    match asset_decimals.cmp(&CANON) {
        Ordering::Equal => raw,
        // Truncating (floor) division: every raw on-chain amount is a whole integer
        // at its native scale, so the canonical result must be a whole base unit too.
        // Plain `BigDecimal` division does not floor (123456789 / 10 = 12345678.9), so
        // round down to scale 0 — mirroring `shared::chains::normalize_usdc_amount`
        // (BUG-10 / #1070).
        Ordering::Greater => (raw / BigDecimal::from(10i128.pow(asset_decimals - CANON)))
            .with_scale_round(0, RoundingMode::Down),
        Ordering::Less => raw * BigDecimal::from(10i128.pow(CANON - asset_decimals)),
    }
}

/// Scale a plain dollar figure to the endpoint's canonical base-6 units — the one
/// conversion needed to combine Trustee-entered cash-rail amounts with the
/// on-chain buckets (`in_transit` subtraction, `total` fold-in).
fn dollars_to_base6(dollars: &BigDecimal) -> BigDecimal {
    dollars * BigDecimal::from(10i128.pow(CANONICAL_AMOUNT_DECIMALS))
}

/// Pure computation: no DB calls. Builds the capital allocation from pre-fetched
/// loan snapshots, lifecycle events, asset transfers, the Withdrawal Queue
/// Wallet's raw balance, and the chain's Trustee-entered `loan_capital_transfers`
/// rows, as-of `to`.
///
/// "Active" = `origination_date ≤ to < effective_end`, matching `routes::loan_book`.
/// `deployed` = Σ senior tranche over active loans flagged `is_loan_deployed`
/// (#1027 — the flag ANDs with the window, so a closed/matured loan drops out even
/// if its flag was left set). `in_transit` = gross approved custody↔ramp flow
/// (both legs, absolute — only Trustee-Approved events count, #936) minus
/// `Σ(on_ramp_transferred + off_ramp_transferred)` scaled to base-6; **not
/// clamped** — sourced only when `addr` is `Some`. `trust_account` =
/// `Σ(trust_account_deposit) − Σ(trust_account_withdrawal)` over
/// `capital_transfers`, a **plain dollar figure** (not clamped) — displayed as-is,
/// and scaled to base-6 units only when folded into `total`. `withdrawal_queue` =
/// `withdrawal_queue_balance` normalized to canonical scale, **not** clamped —
/// sourced only when `withdrawal_queue_balance` is `Some`. `asset_decimals` is the
/// tracked asset's on-chain decimal scale, shared by `in_transit` and
/// `withdrawal_queue` for normalization. Remaining buckets are `null`.
///
/// Public so the compute-layer test in `packages/api/tests/capital_allocation.rs` can
/// exercise it without the HTTP/DB layers.
#[allow(clippy::too_many_arguments)]
pub fn compute_capital_allocation(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    to: i64,
    transfers: &[AssetTransferRow],
    addr: Option<&TransferAddressSets>,
    asset_decimals: u32,
    withdrawal_queue_balance: Option<&BigDecimal>,
    capital_transfers: &[LoanCapitalTransfersRow],
) -> CapitalAllocationResponse {
    // deployed = Σ senior tranche over loans that are active AND Trustee-flagged
    // as deployed. A loan with no capital-transfers row is not deployed.
    let deployed_ids: HashSet<&BigDecimal> = capital_transfers
        .iter()
        .filter(|r| r.is_loan_deployed)
        .map(|r| &r.loan_id)
        .collect();

    let mut deployed = BigDecimal::from(0);
    for loan in loans {
        let s = &loan.snapshot;
        if s.origination_date <= to
            && to < effective_end(loan, events)
            && deployed_ids.contains(&loan.loan_id)
        {
            deployed += &s.original_senior_tranche;
        }
    }

    // in_transit = gross approved ramp flow minus Trustee-confirmed per-loan
    // transfers (only when both address sets are configured). On-chain amounts are
    // in the tracked asset's scale (`asset_decimals`) and are normalized to the
    // canonical 6-decimal base units; the per-loan confirmed amounts are plain
    // dollars and are scaled up to the same units for the subtraction.
    let in_transit = addr.map(|sets| {
        let mut gross = BigDecimal::from(0);
        for t in transfers {
            // Both legs count toward the gross flow, as absolute amounts — but
            // only once a Trustee has reviewed the event and Approved it (#936);
            // a pending or Rejected transfer, on either leg, does not move
            // in_transit. custody↔custody / ramp↔ramp shuffles are ignored.
            let out = sets.custody.contains(&t.from_addr) && sets.ramp.contains(&t.to_addr);
            let back = sets.ramp.contains(&t.from_addr) && sets.custody.contains(&t.to_addr);
            if (out || back) && t.is_approved() {
                gross += &t.amount;
            }
        }
        let gross = normalize_to_canonical(gross, asset_decimals);

        let confirmed = capital_transfers
            .iter()
            .fold(BigDecimal::from(0), |acc, r| {
                acc + &r.on_ramp_transferred + &r.off_ramp_transferred
            });

        // Deliberately NOT clamped (#1027): negative means Trustees confirmed more
        // per-loan transfers than the indexer observed as approved ramp flow.
        gross - dollars_to_base6(&confirmed)
    });

    // trust_account = Σ deposits − Σ withdrawals over the chain's Trustee-entered
    // rows, a plain dollar figure. Deliberately NOT clamped — a negative value is
    // a real bookkeeping error that should surface.
    let trust_account = capital_transfers
        .iter()
        .fold(BigDecimal::from(0), |acc, r| {
            acc + &r.trust_account_deposit - &r.trust_account_withdrawal
        });

    // withdrawal_queue = the Withdrawal Queue Wallet's raw running balance,
    // normalized to canonical scale. Deliberately NOT clamped at zero — this is a
    // literal tracked balance; a negative reading means tracking started after the
    // wallet already held funds, and that gap should be visible (mirrors
    // `trust_account`'s no-clamp rationale).
    let withdrawal_queue =
        withdrawal_queue_balance.map(|b| normalize_to_canonical(b.clone(), asset_decimals));

    // Total = Σ of the sourced buckets (deployed + in_transit when present +
    // withdrawal_queue when present + trust_account). trust_account is a plain
    // dollar figure (see module docs) — scale to base-6 units here, the one
    // place it needs to combine with the other (already base-6) buckets.
    let mut total = deployed.clone();
    if let Some(it) = &in_transit {
        total += it;
    }
    if let Some(wq) = &withdrawal_queue {
        total += wq;
    }
    total += dollars_to_base6(&trust_account);

    CapitalAllocationResponse {
        total: Some(base6_to_decimal_string(&total)),
        buckets: CapitalBuckets {
            capital_wallet: None,
            in_transit: in_transit.as_ref().map(base6_to_decimal_string),
            withdrawal_queue: withdrawal_queue.as_ref().map(base6_to_decimal_string),
            trust_account: Some(
                trust_account
                    .with_scale_round(6, RoundingMode::Down)
                    .to_plain_string(),
            ),
            deployed: Some(base6_to_decimal_string(&deployed)),
            tbills: None,
        },
    }
}
