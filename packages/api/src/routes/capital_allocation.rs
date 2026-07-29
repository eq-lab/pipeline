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
//! - **`in_transit`** — net custody→ramp flow of the tracked asset:
//!   `Σ(approved custody→ramp) − Σ(approved ramp→custody)` over indexed
//!   `AssetTransfer` events (clamped at 0). Sourced only when both custody and ramp
//!   address sets are configured (`CHAIN_<id>_API_STELLAR_{CUSTODY,RAMP}_ADDRESSES`);
//!   otherwise `null`. **Both legs** only net once a Trustee has reviewed the event
//!   and Approved it via `POST /v1/ramp/events/{id}/review` (#936) — a pending or
//!   Rejected transfer, on either leg, does not move `in_transit` at all. NOTE: an
//!   approximation — disbursed funds that leave the ramp to borrowers off-chain are
//!   not observed, so this can over-state true in-transit.
//! - **`withdrawal_queue`** — the Withdrawal Queue Wallet's current USDC balance
//!   (Issue #933), read from the running `params.wallet_balance_after` the indexer
//!   computes on each tracked `AssetTransfer` (`ContractLogsRepo::get_wallet_balance_as_of`).
//!   Sourced only when `CHAIN_<id>_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID` is
//!   configured; otherwise `null`. Not clamped at zero — like `trust_account`, a
//!   negative reading is a real tracking gap that should be visible, not hidden
//!   (e.g. the indexer started tracking after the wallet already held a balance).
//! - **`capital_wallet`** — `null`. TODO: index the Capital-Wallet USDC balance.
//! - **`trust_account`** — `sum(deposits) - sum(withdrawals) - sum(fees)` over the
//!   manually-entered `bank_transactions` ledger (`POST /v1/bank-transactions`, #924).
//!   Global (not chain-scoped) — the trust account is one real-world bank account
//!   for the whole protocol. Not clamped at zero: a negative value means recorded
//!   withdrawals/fees exceed recorded deposits, a real bookkeeping error that should
//!   be visible rather than hidden. Stored/returned by the ledger as a **plain
//!   dollar figure** (no base-6 scaling — a bank transaction has no on-chain native
//!   scale); this endpoint scales it to base-6 units only when folding it into
//!   `total` alongside `deployed`/`in_transit`.
//! - **`tbills`** — `null`. TODO: index the USYC / T-Bills holding.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode};
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::{AssetTransferRow, LifecycleRow, LoanSnapshotRow};

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
    /// Funds in transit on the on/off-ramp leg — net custody→ramp flow of the
    /// tracked asset (`Σ(approved custody→ramp) − Σ(approved ramp→custody)`,
    /// clamped at 0). `null` when custody/ramp address sets are not configured for
    /// the chain.
    pub in_transit: Option<String>,
    /// The Withdrawal Queue Wallet's current USDC balance (Issue #933). `null`
    /// when no wallet is configured for the chain. Not clamped at zero (see
    /// module docs).
    pub withdrawal_queue: Option<String>,
    /// USD residuals held in the trust account: `sum(deposits) - sum(withdrawals) -
    /// sum(fees)` over the manually-entered bank-transaction ledger. Not clamped at
    /// zero (see module docs).
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
    /// Σ of the available buckets (`deployed`, `in_transit` when present,
    /// `withdrawal_queue` when present, and `trust_account`; the rest are `null`
    /// until sourced).
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
    let transfers = state
        .contract_logs_repo
        .list_asset_transfers(&state.pool, chain_id, to)
        .await?;
    let addr = state.transfer_addresses.get(&chain_id);
    let asset_decimals = state.asset_decimals.get(&chain_id).copied().unwrap_or(7);
    let withdrawal_queue_balance = match state.withdrawal_queue_wallets.get(&chain_id) {
        Some(wallet) => {
            state
                .contract_logs_repo
                .get_wallet_balance_as_of(&state.pool, chain_id, wallet, to)
                .await?
        }
        None => None,
    };
    let trust_account = state.bank_transaction_repo.trust_account_balance().await?;

    Ok(Json(compute_capital_allocation(
        &loans,
        &events,
        to,
        &transfers,
        addr,
        asset_decimals,
        withdrawal_queue_balance.as_ref(),
        &trust_account,
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
        Ordering::Greater => raw / BigDecimal::from(10i128.pow(asset_decimals - CANON)),
        Ordering::Less => raw * BigDecimal::from(10i128.pow(CANON - asset_decimals)),
    }
}

/// Pure computation: no DB calls. Builds the capital allocation from pre-fetched
/// loan snapshots, lifecycle events, asset transfers, the Withdrawal Queue
/// Wallet's raw balance, and the bank-transaction-ledger balance, as-of `to`.
///
/// "Active" = `origination_date ≤ to < effective_end`, matching `routes::loan_book`.
/// `deployed` = Σ senior tranche over the active set. `in_transit` = net custody→ramp
/// flow of the tracked asset (`Σ(approved custody→ramp) − Σ(approved ramp→custody)`,
/// clamped at 0), sourced only when `addr` is `Some` — both legs only net once a
/// Trustee has Approved the event (#936). `withdrawal_queue` = `withdrawal_queue_balance`
/// normalized to canonical scale, **not** clamped (see module docs) — sourced only
/// when `withdrawal_queue_balance` is `Some`. `trust_account` = `trust_account_balance`,
/// a **plain dollar figure** (not clamped — see module docs) — displayed as-is, and
/// scaled to base-6 units only when folded into `total`. `asset_decimals` is the
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
    trust_account_balance: &BigDecimal,
) -> CapitalAllocationResponse {
    let mut deployed = BigDecimal::from(0);

    for loan in loans {
        let s = &loan.snapshot;
        if s.origination_date <= to && to < effective_end(loan, events) {
            deployed += &s.original_senior_tranche;
        }
    }

    // in_transit = net custody→ramp flow (only when both address sets configured).
    // Amounts are in the tracked asset's on-chain scale (`asset_decimals`); they
    // are normalized to the canonical 6-decimal base units so they can be summed
    // with `deployed` and formatted with `base6_to_decimal_string`.
    let in_transit = addr.map(|sets| {
        let mut net = BigDecimal::from(0);
        for t in transfers {
            // Both legs only net once a Trustee has reviewed the event and
            // Approved it (#936) — a pending or Rejected transfer, on either leg,
            // does not move in_transit.
            let out = sets.custody.contains(&t.from_addr)
                && sets.ramp.contains(&t.to_addr)
                && t.is_approved();
            let back = sets.ramp.contains(&t.from_addr)
                && sets.custody.contains(&t.to_addr)
                && t.is_approved();
            if out {
                net += &t.amount;
            } else if back {
                net -= &t.amount;
            }
            // custody↔custody / ramp↔ramp shuffles net to zero — ignored.
        }
        let net = normalize_to_canonical(net, asset_decimals);
        // A displayed in-transit balance shouldn't be negative.
        net.max(BigDecimal::from(0))
    });

    // withdrawal_queue = the Withdrawal Queue Wallet's raw running balance,
    // normalized to canonical scale. Deliberately NOT clamped at zero — unlike
    // in_transit's approximation, this is a literal tracked balance; a negative
    // reading means tracking started after the wallet already held funds, and
    // that gap should be visible (mirrors `trust_account`'s no-clamp rationale).
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
    total += trust_account_balance * BigDecimal::from(10i128.pow(CANONICAL_AMOUNT_DECIMALS));

    CapitalAllocationResponse {
        total: Some(base6_to_decimal_string(&total)),
        buckets: CapitalBuckets {
            capital_wallet: None,
            in_transit: in_transit.as_ref().map(base6_to_decimal_string),
            withdrawal_queue: withdrawal_queue.as_ref().map(base6_to_decimal_string),
            trust_account: Some(
                trust_account_balance
                    .with_scale_round(6, RoundingMode::Down)
                    .to_plain_string(),
            ),
            deployed: Some(base6_to_decimal_string(&deployed)),
            tbills: None,
        },
    }
}
