//! Per-loan collateral valuation endpoint
//! (`GET /v1/loan-book/{loan_id}/valuations`).
//!
//! Read-only. Loads the loan's valuation record (anchor + latest assay / offtake /
//! quantity), the latest reference price, and the loan snapshot (for the CCR
//! denominator), then recomputes collateral value and CCR on demand via
//! `shared::valuation`. There is no cached state — the numbers are always derived
//! from the current inputs (see docs/product-specs/collateral-valuation.md).
//!
//! When a required input is missing the loan is still returned, with the computed
//! sections `null` and `missing_inputs` naming what is absent — mirroring how
//! `routes::loan_book` serializes `collateral: null` for unpriced loans.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode};
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

use shared::collateral_valuation::{ccr_bps, compute_collateral, ConcentrateValuation};
use shared::collateral_valuation_repo::{
    AssayRow, CollateralValuationRow, OfftakeTermsRow, QuantityReportRow, ValuationMode,
};

use crate::auth::SecurityAddon;
use crate::error::ApiError;
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::AppState;

/// On-chain USDC fixed-point scale (`1e6`). Loan tranches are stored base-6, but
/// collateral value is computed in plain USD, so the senior principal is divided
/// by this before the CCR ratio.
const USDC_SCALE: i64 = 1_000_000;

// ── Response DTOs ──────────────────────────────────────────────────────────────

/// Response for `GET /v1/loan-book/{loan_id}/valuations`.
#[derive(Debug, Serialize, ToSchema)]
pub struct CollateralValuationResponse {
    pub chain_id: i64,
    pub loan_id: String,
    pub commodity: String,
    /// `StandardGoods` or `MetalConcentrate`.
    pub valuation_mode: ValuationMode,
    /// The inputs that fed (or would feed) the computation — echoed for display.
    pub inputs: CollateralValuationInputs,
    /// The NSR waterfall, line by line. `null` for standard-goods loans and when a
    /// required concentrate input is missing.
    pub waterfall: Option<Waterfall>,
    /// Collateral value in USD (2-decimal string). `null` when an input is missing.
    pub collateral_value: Option<String>,
    /// CCR block. `null` when collateral is unavailable or the loan snapshot
    /// (senior-principal denominator) could not be found.
    pub ccr: Option<Ccr>,
    /// Names of absent inputs, e.g. `["assay","quantity","loan_snapshot"]`. Empty
    /// when the valuation is complete.
    pub missing_inputs: Vec<String>,
}

/// Echo of the valuation inputs (left column of the design).
#[derive(Debug, Serialize, ToSchema)]
pub struct CollateralValuationInputs {
    pub haircut_pct: String,
    pub reference_price_asset: String,
    pub price_provider: String,
    /// Latest reference price (USD), or `null` when no price is on record.
    pub reference_price: Option<String>,
    pub quantity_dmt: Option<String>,
    pub moisture_pct: Option<String>,
    /// Payable metals (concentrate mode); empty for standard goods.
    pub metals: Vec<MetalInput>,
    /// Penalty tiers with the assayed level filled in (concentrate mode).
    pub penalties: Vec<PenaltyInput>,
    pub treatment_charge_per_dmt: Option<String>,
    pub realisation_costs: Option<String>,
    pub quotational_period: Option<String>,
    pub pricing_reference: Option<String>,
    pub incoterm: Option<String>,
    pub assay_status: Option<String>,
    pub assay_certificate_uri: Option<String>,
}

/// One payable-metal input line.
#[derive(Debug, Serialize, ToSchema)]
pub struct MetalInput {
    pub metal: String,
    pub grade_g_per_t: String,
    pub payable_pct: String,
    pub min_deduction_g_per_t: String,
    pub reference_price: String,
    pub rc_per_oz: String,
}

/// One penalty-tier input line (offtake schedule joined with the assayed level).
#[derive(Debug, Serialize, ToSchema)]
pub struct PenaltyInput {
    pub element: String,
    pub level_pct: String,
    pub threshold_pct: String,
    pub step_pct: String,
    pub rate_per_dmt: String,
}

/// The concentrate NSR waterfall (right column of the design). All USD strings.
#[derive(Debug, Serialize, ToSchema)]
pub struct Waterfall {
    pub gross_value: String,
    pub treatment_charge: String,
    pub refining_charge: String,
    pub penalties: String,
    pub nsr: String,
    pub realisation_costs: String,
    pub mine_gate_value: String,
    pub collateral_value: String,
}

/// CCR block.
#[derive(Debug, Serialize, ToSchema)]
pub struct Ccr {
    pub collateral_value: String,
    pub outstanding_senior_principal: String,
    pub ccr_bps: u32,
    /// CCR as a percentage string, e.g. `"178.00"`.
    pub ccr_pct: String,
}

/// OpenAPI doc bundle for the valuation route.
#[derive(OpenApi)]
#[openapi(
    paths(get_collateral_valuation),
    components(schemas(
        CollateralValuationResponse,
        CollateralValuationInputs,
        ValuationMode,
        MetalInput,
        PenaltyInput,
        Waterfall,
        Ccr,
    )),
    modifiers(&SecurityAddon)
)]
pub struct CollateralValuationDoc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/loan-book/{loan_id}/valuations",
        get(get_collateral_valuation),
    )
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/loan-book/{loan_id}/valuations",
    params(
        ("loan_id" = String, Path, description = "On-chain loan id"),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Loan collateral valuation and CCR", body = CollateralValuationResponse),
        (status = 400, description = "Malformed loan id"),
        (status = 404, description = "No valuation anchor for this loan"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "LoanBook"
)]
async fn get_collateral_valuation(
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<CollateralValuationResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let loan_id = BigDecimal::from_str(loan_id.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid loan_id: {loan_id}")))?;

    let repo = &state.collateral_valuation_repo;
    let anchor = repo.get_anchor(chain_id, &loan_id).await?.ok_or_else(|| {
        ApiError::NotFound(format!(
            "no valuation for loan {loan_id} on chain {chain_id}"
        ))
    })?;

    let assay = repo.latest_assay(chain_id, &loan_id).await?;
    let offtake = repo.latest_offtake(chain_id, &loan_id).await?;
    let quantity = repo.latest_quantity(chain_id, &loan_id).await?;

    // Latest reference price for this loan's (asset, provider) pair.
    let reference_price = state
        .loan_asset_price_repo
        .latest_prices()
        .await?
        .into_iter()
        .find(|(asset, provider, _)| *asset == anchor.asset && *provider == anchor.price_provider)
        .map(|(_, _, price)| price);

    // Outstanding senior principal (USD) from the loan snapshot, for the CCR
    // denominator. `None` when the loan has not been indexed.
    let outstanding_senior = loan_snapshot_senior_usd(&state, chain_id, &loan_id).await?;

    build_response(
        &anchor,
        assay.as_ref(),
        offtake.as_ref(),
        quantity.as_ref(),
        reference_price.as_ref(),
        outstanding_senior.as_ref(),
    )
    .map(Json)
}

/// Outstanding senior principal in USD = `(original_senior_tranche -
/// senior_principal_repaid) / 1e6`, read from the latest loan snapshot. `None`
/// when the loan has no snapshot (never indexed).
async fn loan_snapshot_senior_usd(
    state: &AppState,
    chain_id: i64,
    loan_id: &BigDecimal,
) -> Result<Option<BigDecimal>, ApiError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let snapshots = state
        .contract_logs_repo
        .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, now)
        .await?;

    let Some(row) = snapshots.into_iter().find(|r| &r.loan_id == loan_id) else {
        return Ok(None);
    };

    let outstanding_micro =
        &row.snapshot.original_senior_tranche - &row.snapshot.repayment.senior_principal_repaid;
    Ok(Some(outstanding_micro / BigDecimal::from(USDC_SCALE)))
}

// ── Assembly (pure) ────────────────────────────────────────────────────────────

/// USD amount → 2-decimal string.
fn usd(v: &BigDecimal) -> String {
    v.with_scale_round(2, RoundingMode::HalfUp)
        .to_plain_string()
}

fn build_response(
    anchor: &CollateralValuationRow,
    assay: Option<&AssayRow>,
    offtake: Option<&OfftakeTermsRow>,
    quantity: Option<&QuantityReportRow>,
    reference_price: Option<&BigDecimal>,
    outstanding_senior: Option<&BigDecimal>,
) -> Result<CollateralValuationResponse, ApiError> {
    let mut missing = Vec::new();
    if reference_price.is_none() {
        missing.push("reference_price".to_owned());
    }
    if quantity.is_none() {
        missing.push("quantity".to_owned());
    }
    let is_concentrate = anchor.valuation_mode == ValuationMode::MetalConcentrate;
    if is_concentrate {
        if assay.is_none() {
            missing.push("assay".to_owned());
        }
        if offtake.is_none() {
            missing.push("offtake".to_owned());
        }
    }

    let inputs = CollateralValuationInputs {
        haircut_pct: anchor.haircut_pct.to_plain_string(),
        reference_price_asset: anchor.asset.clone(),
        price_provider: anchor.price_provider.clone(),
        reference_price: reference_price.map(BigDecimal::to_plain_string),
        quantity_dmt: quantity.map(|q| q.quantity_dmt.to_plain_string()),
        moisture_pct: assay
            .and_then(|a| a.moisture_pct.as_ref())
            .map(BigDecimal::to_plain_string),
        metals: build_metals(assay, offtake, reference_price, is_concentrate),
        penalties: build_penalties(assay, offtake, is_concentrate),
        treatment_charge_per_dmt: offtake.map(|o| o.treatment_charge_per_dmt.to_plain_string()),
        realisation_costs: offtake.map(|o| o.realisation_costs.to_plain_string()),
        quotational_period: offtake.and_then(|o| o.quotational_period.clone()),
        pricing_reference: offtake.and_then(|o| o.pricing_reference.clone()),
        incoterm: offtake.and_then(|o| o.incoterm.clone()),
        assay_status: assay.map(|a| a.assay_status.clone()),
        assay_certificate_uri: assay.and_then(|a| a.certificate_uri.clone()),
    };

    // Collateral value + waterfall come from the shared valuation (same code the
    // loan-book list uses). `None` when a required input for the mode is missing.
    let computation = compute_collateral(anchor, assay, offtake, quantity, reference_price)
        .map_err(ApiError::Internal)?;
    let collateral_value = computation.as_ref().map(|c| c.collateral_value.clone());
    let waterfall = computation
        .as_ref()
        .and_then(|c| c.concentrate.as_ref())
        .map(waterfall_dto);

    // CCR needs both a collateral value and the senior-principal denominator.
    let ccr = if let (Some(cv), Some(senior)) = (&collateral_value, outstanding_senior) {
        let bps = ccr_bps(cv, senior);
        Some(Ccr {
            collateral_value: usd(cv),
            outstanding_senior_principal: usd(senior),
            ccr_bps: bps,
            ccr_pct: (BigDecimal::from(bps) / BigDecimal::from(100))
                .with_scale_round(2, RoundingMode::HalfUp)
                .to_plain_string(),
        })
    } else {
        // Collateral computed but no snapshot ⇒ CCR unavailable; flag the reason.
        if collateral_value.is_some() && outstanding_senior.is_none() {
            missing.push("loan_snapshot".to_owned());
        }
        None
    };

    Ok(CollateralValuationResponse {
        chain_id: anchor.chain_id,
        loan_id: anchor.loan_id.to_plain_string(),
        commodity: anchor.commodity.clone(),
        valuation_mode: anchor.valuation_mode,
        inputs,
        waterfall,
        collateral_value: collateral_value.as_ref().map(usd),
        ccr,
        missing_inputs: missing,
    })
}

/// Echo of the per-metal inputs for display (concentrate only). The numeric math
/// runs in `shared::collateral_valuation::compute_collateral`; this only formats the
/// stored values for the response. Empty for standard goods or when inputs absent.
fn build_metals(
    assay: Option<&AssayRow>,
    offtake: Option<&OfftakeTermsRow>,
    reference_price: Option<&BigDecimal>,
    is_concentrate: bool,
) -> Vec<MetalInput> {
    if !is_concentrate {
        return Vec::new();
    }
    let (Some(offtake), Some(assay)) = (offtake, assay) else {
        return Vec::new();
    };
    let price = reference_price.map_or_else(|| "0".to_owned(), BigDecimal::to_plain_string);

    offtake
        .payable_terms
        .0
        .iter()
        .map(|term| MetalInput {
            metal: term.metal.clone(),
            grade_g_per_t: assay
                .assays
                .0
                .iter()
                .find(|m| m.metal == term.metal)
                .map_or_else(|| "0".to_owned(), |m| m.grade_g_per_t.clone()),
            payable_pct: term.payable_pct.clone(),
            min_deduction_g_per_t: term.min_deduction_g_per_t.clone(),
            reference_price: price.clone(),
            rc_per_oz: offtake
                .refining_charges
                .0
                .iter()
                .find(|r| r.metal == term.metal)
                .map_or_else(|| "0".to_owned(), |r| r.rc_per_oz.clone()),
        })
        .collect()
}

/// Echo of the penalty-tier inputs for display, with the assayed level filled in
/// (raw, as recorded). Empty for standard goods or when offtake is absent.
fn build_penalties(
    assay: Option<&AssayRow>,
    offtake: Option<&OfftakeTermsRow>,
    is_concentrate: bool,
) -> Vec<PenaltyInput> {
    if !is_concentrate {
        return Vec::new();
    }
    let Some(offtake) = offtake else {
        return Vec::new();
    };

    offtake
        .penalty_schedule
        .0
        .iter()
        .map(|tier| PenaltyInput {
            element: tier.element.clone(),
            level_pct: assay
                .and_then(|a| a.deleterious.0.iter().find(|d| d.element == tier.element))
                .map_or_else(|| "0".to_owned(), |d| d.level.clone()),
            threshold_pct: tier.threshold.clone(),
            step_pct: tier.step.clone(),
            rate_per_dmt: tier.rate_per_dmt.clone(),
        })
        .collect()
}

/// Format the concentrate waterfall for the response. Realisation costs are the gap
/// between NSR and mine-gate value (`nsr - mine_gate_value`).
fn waterfall_dto(cv: &ConcentrateValuation) -> Waterfall {
    Waterfall {
        gross_value: usd(&cv.gross_value),
        treatment_charge: usd(&cv.treatment_charge),
        refining_charge: usd(&cv.refining_charge),
        penalties: usd(&cv.penalties),
        nsr: usd(&cv.nsr),
        realisation_costs: usd(&(&cv.nsr - &cv.mine_gate_value)),
        mine_gate_value: usd(&cv.mine_gate_value),
        collateral_value: usd(&cv.collateral_value),
    }
}
