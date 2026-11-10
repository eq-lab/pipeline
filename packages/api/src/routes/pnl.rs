use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::error::ApiError;
use crate::formatting::iso_utc;
use crate::intervals::{Interval, MAX_SAMPLES};
use crate::minter_cash_book::{build_wire_outs, wire_out_escrow_steps, wire_out_raw_steps};
use crate::routes::common::{RequiredChain, SeriesStat};
use crate::routes::vouchers::normalise_wallet;
use crate::total_balance::{
    build_composite_history, composite_window_start, fold_term, plain_bounded, plusd_holder_key,
    plusd_term_from, term_outcomes, CompositeInputs, CompositeSeries, PlusdTerm, SeedInputs,
    WireTerm,
};
use crate::AppState;
use shared::chains::ChainKind;
use shared::db::EventRepo;
use shared::plusd_seed_repo::PlusdSeedRepo;
use shared::pocket_repo::PocketRepo;
use shared::position_repo::{BalanceEventRow, PositionHistoryBucket};
use shared::time_weighted_return::{time_weighted_apy, VaultHolding};

/// Serves two path prefixes: `/pnl` (point-in-time profit and loss, including
/// unrealized) and `/positions` (historical balances and cost basis). They share
/// this module because both read `PositionRepo` through the same wallet
/// normalisation and chain resolution — but they are deliberately named apart,
/// because the history series carries no unrealized PnL.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/pnl", get(get_pnl))
        .route("/positions/history", get(get_position_history))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_pnl, get_position_history),
    components(schemas(
        PnlQuery,
        PnlResponse,
        VaultPnl,
        PositionHistoryQuery,
        Interval,
        PositionHistoryResponse,
        PositionHistoryItem,
        SeriesStat
    )),
    tags(
        (name = "PnL", description = "Staking profit and loss"),
        (name = "Positions", description = "Historical share balances and cost basis")
    )
)]
pub struct PnlDoc;

#[derive(Deserialize, ToSchema)]
pub struct PnlQuery {
    pub wallet: String,
}

#[derive(Serialize, ToSchema)]
pub struct VaultPnl {
    pub vault_address: String,
    pub shares_balance: String,
    pub avg_cost_basis: String,
    pub current_share_price: String,
    pub unrealized_pnl: String,
    pub realized_pnl: String,
    pub total_pnl: String,
}

#[derive(Serialize, ToSchema)]
pub struct PnlResponse {
    pub wallet: String,
    pub positions: Vec<VaultPnl>,
    pub total_unrealized_pnl: String,
    pub total_realized_pnl: String,
    pub total_pnl: String,
    pub pocket_recovered: Option<String>,
    /// Time-weighted annualised share-price return over the wallet's holding intervals
    /// (`shares_balance > 0`): `Π(price_end / price_start)` annualised (365 d) over total held
    /// time, independent of buy timing. Null with under 1 day held or no price at a boundary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_apy: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/pnl",
    params(
        ("wallet" = String, Query, description = "Wallet address"),
        RequiredChain,
    ),
    responses(
        (status = 200, description = "Staking PnL for the wallet", body = PnlResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id; or invalid wallet"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "PnL"
)]
async fn get_pnl(
    State(state): State<Arc<AppState>>,
    RequiredChain(chain): RequiredChain,
    Query(query): Query<PnlQuery>,
) -> impl IntoResponse {
    let chain_id = chain.chain_id;
    let chain_kind = chain.kind;

    let wallet = match normalise_wallet(chain_kind, &query.wallet) {
        Ok(w) => w,
        Err((status, msg)) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
    };

    match compute_pnl(&state, &wallet, chain_id, chain_kind).await {
        Ok(response) => Json(response).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to compute PnL");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

pub fn pnl_totals(
    unrealized: &BigDecimal,
    realized: &BigDecimal,
    pocket_recovered: Option<&BigDecimal>,
) -> (String, String, Option<String>) {
    let realized = match pocket_recovered {
        Some(recovered) => realized + recovered,
        None => realized.clone(),
    };
    let total = unrealized + &realized;
    (
        realized.to_plain_string(),
        total.to_plain_string(),
        pocket_recovered.map(BigDecimal::to_plain_string),
    )
}

async fn pocket_recovered(
    state: &AppState,
    wallet: &str,
    chain_id: i64,
    kind: ChainKind,
) -> anyhow::Result<Option<BigDecimal>> {
    if kind != ChainKind::Stellar {
        return Ok(None);
    }
    let Some(pocket) = state.pocket_addresses.get(&chain_id) else {
        return Ok(None);
    };
    let claims = PocketRepo::new(state.pool.clone())
        .list_holder_claims(chain_id, pocket, wallet)
        .await?;
    Ok(Some(claims.iter().map(|c| c.paid.clone()).sum()))
}

async fn compute_pnl(
    state: &AppState,
    wallet: &str,
    chain_id: i64,
    kind: ChainKind,
) -> anyhow::Result<PnlResponse> {
    let summaries = state
        .position_repo
        .get_position_summaries(chain_id, wallet)
        .await?;

    let zero = BigDecimal::from(0);
    let mut total_unrealized = zero.clone();
    let mut total_realized = zero.clone();
    let mut positions = Vec::with_capacity(summaries.len());

    for s in summaries {
        let current_price = state
            .position_repo
            .get_latest_share_price(chain_id, &s.vault_address)
            .await?
            .map_or_else(|| s.avg_buy_share_price.clone(), |s| s.price);

        let unrealized = &s.shares_balance * (&current_price - &s.avg_buy_share_price);
        let realized = &s.total_realized_pnl;
        let total = &unrealized + realized;

        total_unrealized = &total_unrealized + &unrealized;
        total_realized = &total_realized + realized;

        positions.push(VaultPnl {
            vault_address: s.vault_address,
            shares_balance: s.shares_balance.to_string(),
            avg_cost_basis: s.avg_buy_share_price.to_string(),
            current_share_price: current_price.to_string(),
            unrealized_pnl: unrealized.to_string(),
            realized_pnl: realized.to_string(),
            total_pnl: total.to_string(),
        });
    }

    let recovered = pocket_recovered(state, wallet, chain_id, kind).await?;
    let (total_realized_pnl, total_pnl, pocket_recovered) =
        pnl_totals(&total_unrealized, &total_realized, recovered.as_ref());

    let avg_apy = compute_avg_apy(state, wallet, chain_id).await?;

    Ok(PnlResponse {
        wallet: wallet.to_owned(),
        positions,
        total_unrealized_pnl: total_unrealized.to_string(),
        total_realized_pnl,
        total_pnl,
        pocket_recovered,
        avg_apy: avg_apy.map(|v| format!("{v:.6}")),
    })
}

async fn compute_avg_apy(
    state: &AppState,
    wallet: &str,
    chain_id: i64,
) -> anyhow::Result<Option<f64>> {
    let events = state
        .position_repo
        .get_balance_events(chain_id, wallet)
        .await?;
    let mut by_vault: Vec<(String, Vec<BalanceEventRow>)> = Vec::new();
    for e in events {
        match by_vault.last_mut() {
            Some((addr, evs)) if *addr == e.vault_address => evs.push(e),
            _ => by_vault.push((e.vault_address.clone(), vec![e])),
        }
    }
    let mut holdings = Vec::with_capacity(by_vault.len());
    for (vault, events) in by_vault {
        let first_event = events.iter().map(|e| e.block_timestamp).min().unwrap_or(0);
        let since = DateTime::<Utc>::from_timestamp(first_event, 0).unwrap_or_default();
        let prices = state
            .position_repo
            .get_share_price_series(chain_id, &vault, since)
            .await?;
        holdings.push(VaultHolding { events, prices });
    }
    Ok(time_weighted_apy(&holdings, Utc::now().timestamp()))
}

// ── Position history ─────────────────────────────────────────────────────────

#[derive(Deserialize, ToSchema)]
pub struct PositionHistoryQuery {
    pub wallet: String,
    /// Number of days to look back (optional — omit for all history).
    pub days: Option<u32>,
    /// Time grouping: "hourly", "daily" (default), or "weekly".
    #[serde(default)]
    pub interval: Interval,
}

#[derive(Serialize, ToSchema)]
pub struct PositionHistoryItem {
    /// ISO-8601 timestamp for the start of the bucket.
    pub timestamp: String,
    /// Share balance at the **close** of the bucket.
    pub shares_balance: String,
    /// Average buy share price at the close of the bucket.
    pub avg_cost_basis: String,
    /// Realized PnL accumulated over the wallet's full history up to and
    /// including this bucket — not just within the requested window.
    pub cumulative_realized_pnl: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub splusd_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wire_out_escrow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plusd_balance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_balance: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct PositionHistoryResponse {
    pub wallet: String,
    /// The vault the series belongs to. `null` only when the wallet has no
    /// indexed history on this chain, in which case `history` is empty too.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault_address: Option<String>,
    pub interval: String,
    pub history: Vec<PositionHistoryItem>,
    /// Max/min/time-weighted-average share balance over the window (same
    /// carried-forward series as `history`, so it agrees with what the chart
    /// renders regardless of `interval`).
    pub shares_balance: SeriesStat,
    /// Max/min/time-weighted-average cumulative realized PnL over the window.
    pub cumulative_realized_pnl: SeriesStat,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub splusd_value: Option<SeriesStat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_balance: Option<SeriesStat>,
}

/// Position history for a wallet, bucketed like `/v1/stats/prices`.
///
/// Scoped by `chain_id`, which identifies the sPLUSD vault — the only vault the
/// protocol runs — so there is no `vault` parameter. If the vault has been
/// redeployed, the series covers the current address only; positions on a
/// superseded one are dropped, since after a redeploy they no longer matter.
///
/// Each entry is the **closing** position for its bucket. The series is dense:
/// one entry per interval step from the window start to now, with quiet
/// buckets carrying the previous closing values and leading buckets zero-filled.
///
/// Covers every balance-moving event: staking mint/burn plus peer-to-peer
/// `ShareTransfer`, so a wallet that only ever received shares still has a
/// history.
///
/// This is a **balance and cost-basis** series, deliberately not named a PnL
/// series: it carries realized PnL but no unrealized PnL. Use `/v1/pnl` for
/// point-in-time unrealized and total PnL. The composite balance terms
/// (`splusd_value`, `wire_out_escrow`, `total_balance`) are specified in
/// `docs/product-specs/lp-total-balance.md`.
#[utoipa::path(
    get,
    path = "/v1/positions/history",
    params(
        ("wallet" = String, Query, description = "Wallet address"),
        ("days" = Option<u32>, Query, description = "Number of days to look back (omit for all history)"),
        ("interval" = Option<String>, Query, description = "Time grouping: \"hourly\", \"daily\" (default), or \"weekly\""),
        RequiredChain,
    ),
    responses(
        (status = 200, description = "Position history grouped by interval", body = PositionHistoryResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id; invalid wallet; or invalid query parameters"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Positions"
)]
async fn get_position_history(
    State(state): State<Arc<AppState>>,
    RequiredChain(chain): RequiredChain,
    Query(query): Query<PositionHistoryQuery>,
) -> Result<Json<PositionHistoryResponse>, ApiError> {
    let chain_id = chain.chain_id;
    let wallet = normalise_wallet(chain.kind, &query.wallet)
        .map_err(|(_, msg)| ApiError::BadRequest(msg))?;
    let now = Utc::now();
    let interval = query.interval;
    let wire_out = || wire_out_term(&state, chain.kind, chain_id, &wallet, interval);
    let plusd = || plusd_term(&state, chain.kind, chain_id, &wallet, interval);
    let vaults = state.position_repo.get_vaults(chain_id);

    let (vault, since, prefetched) = if let Some(d) = query.days {
        (
            vaults.await?.into_iter().next(),
            Some(now - Duration::days(i64::from(d))),
            None,
        )
    } else {
        let (vaults, first_position, wire, plusd) = tokio::join!(
            vaults,
            state
                .position_repo
                .get_first_position_timestamp(chain_id, &wallet),
            wire_out(),
            plusd(),
        );
        let first_position = first_position?;
        let (wire, plusd) = term_outcomes(first_position.is_some(), wire, plusd)?;
        let first_escrow = wire
            .as_ref()
            .and_then(|t| t.escrow.first().map(|step| step.0.timestamp()));
        let first_plusd = plusd
            .as_ref()
            .and_then(|t| t.folded.first().map(|step| step.0.timestamp()));
        (
            vaults?.into_iter().next(),
            composite_window_start(&[first_position, first_escrow, first_plusd]),
            Some((wire, plusd)),
        )
    };

    if let Some(start) = since {
        let est_samples = (now - start).num_seconds().max(0) / interval.step_secs() + 1;
        if est_samples > MAX_SAMPLES {
            return Err(ApiError::BadRequest(format!(
                "request could produce up to {est_samples} samples (max {MAX_SAMPLES}); reduce `days` or use a coarser `interval`"
            )));
        }
    }

    let (Some(start), Some(vault)) = (since, vault) else {
        return Ok(Json(history_response(
            wallet,
            interval,
            None,
            empty_series(interval, now),
        )));
    };

    let fetch = async {
        tokio::try_join!(
            state.position_repo.get_position_history(
                chain_id,
                &wallet,
                interval.as_pg_trunc(),
                Some(start)
            ),
            state.position_repo.get_share_price_closings(
                chain_id,
                interval.as_pg_trunc(),
                interval.truncate(start)
            ),
        )
    };
    let (rows, closings, (wire, plusd)) = if let Some(terms) = prefetched {
        let (rows, closings) = fetch.await?;
        (rows, closings, terms)
    } else {
        let (history, wire, plusd) = tokio::join!(fetch, wire_out(), plusd());
        let (rows, closings) = history?;
        let terms = term_outcomes(!rows.is_empty(), wire, plusd)?;
        (rows, closings, terms)
    };

    let composite = build_composite_history(
        &CompositeInputs {
            positions: &rows,
            prices: &closings,
            escrow: wire.as_ref().map(|t| t.escrow.as_slice()),
            escrow_raw: wire.as_ref().and_then(|t| t.raw.as_deref()),
            plusd: plusd.as_ref().map(|t| t.folded.as_slice()),
            plusd_from: plusd.as_ref().and_then(|t| t.from),
            blank_total_before: plusd.as_ref().is_some_and(|t| t.blank_total_before),
            share_decimals: u32::try_from(vault.share_decimals).unwrap_or(u32::MAX),
            asset_decimals: u32::try_from(vault.asset_decimals).unwrap_or(u32::MAX),
        },
        interval,
        start,
        now,
    );
    let vault_address = (!composite.items.is_empty()).then(|| match chain.kind {
        ChainKind::Evm => vault.address.to_lowercase(),
        ChainKind::Stellar => vault.address.clone(),
    });
    Ok(Json(history_response(
        wallet,
        interval,
        vault_address,
        composite,
    )))
}

fn empty_series(interval: Interval, now: DateTime<Utc>) -> CompositeSeries {
    build_composite_history(
        &CompositeInputs {
            positions: &[],
            prices: &[],
            escrow: None,
            escrow_raw: None,
            plusd: None,
            plusd_from: None,
            blank_total_before: false,
            share_decimals: 0,
            asset_decimals: 0,
        },
        interval,
        now,
        now,
    )
}

fn history_response(
    wallet: String,
    interval: Interval,
    vault_address: Option<String>,
    composite: CompositeSeries,
) -> PositionHistoryResponse {
    PositionHistoryResponse {
        wallet,
        vault_address,
        interval: interval.as_str().to_owned(),
        history: composite.items,
        shares_balance: composite.shares_balance,
        cumulative_realized_pnl: composite.cumulative_realized_pnl,
        splusd_value: composite.splusd_value,
        total_balance: composite.total_balance,
    }
}

async fn wire_out_term(
    state: &AppState,
    kind: ChainKind,
    chain_id: i64,
    wallet: &str,
    interval: Interval,
) -> anyhow::Result<Option<WireTerm>> {
    let rows = match kind {
        ChainKind::Stellar => {
            let Some(minter) = state.minter_addresses.get(&chain_id) else {
                return Ok(None);
            };
            let lp = wallet.to_uppercase();
            state
                .contract_logs_repo
                .list_lp_wire_out_events(chain_id, minter, &lp)
                .await?
        }
        ChainKind::Evm => {
            let Some(lp) = state
                .plusd_addresses
                .contains_key(&chain_id)
                .then(|| plusd_holder_key(kind, wallet))
                .flatten()
            else {
                return Ok(None);
            };
            state
                .contract_logs_repo
                .list_lp_wire_out_events_inferred_minter(chain_id, &lp)
                .await?
        }
    };
    let wire_outs = build_wire_outs(&rows);
    let Some(escrow) = fold_term(
        wire_out_escrow_steps(&wire_outs, kind),
        interval,
        chain_id,
        "wire_out_escrow",
    ) else {
        return Ok(None);
    };
    let raw = fold_term(
        wire_out_raw_steps(&wire_outs),
        interval,
        chain_id,
        "wire_out_escrow_raw",
    );
    Ok(Some(WireTerm { escrow, raw }))
}

async fn plusd_term(
    state: &AppState,
    kind: ChainKind,
    chain_id: i64,
    wallet: &str,
    interval: Interval,
) -> anyhow::Result<Option<PlusdTerm>> {
    let (Some(plusd), Some(holder)) = (
        state.plusd_addresses.get(&chain_id),
        plusd_holder_key(kind, wallet),
    ) else {
        return Ok(None);
    };
    let steps = state
        .contract_logs_repo
        .list_plusd_holder_steps(chain_id, plusd, &holder);
    let (rows, seed, coverage, cursor) = match kind {
        ChainKind::Evm => (steps.await?, None, None, 0),
        ChainKind::Stellar => {
            let seeds = PlusdSeedRepo::new(state.pool.clone());
            let events = EventRepo::new(state.pool.clone());
            tokio::try_join!(
                steps,
                seeds.latest(chain_id, plusd, &holder),
                state
                    .contract_logs_repo
                    .plusd_coverage_start(chain_id, plusd),
                events.get_cursor(chain_id),
            )?
        }
    };
    Ok(plusd_term_from(
        kind,
        &SeedInputs {
            seed: seed.as_ref(),
            coverage,
            cursor,
            holder: &holder,
        },
        &rows,
        interval,
        chain_id,
    ))
}

pub fn history_item(
    bucket: DateTime<Utc>,
    carried: Option<&PositionHistoryBucket>,
) -> PositionHistoryItem {
    PositionHistoryItem {
        timestamp: iso_utc(&bucket),
        shares_balance: carried
            .map_or_else(|| "0".to_owned(), |r| plain_bounded(&r.shares_balance)),
        avg_cost_basis: carried
            .map_or_else(|| "0".to_owned(), |r| plain_bounded(&r.avg_buy_share_price)),
        cumulative_realized_pnl: carried.map_or_else(
            || "0".to_owned(),
            |r| plain_bounded(&r.cumulative_realized_pnl),
        ),
        splusd_value: None,
        wire_out_escrow: None,
        plusd_balance: None,
        total_balance: None,
    }
}
