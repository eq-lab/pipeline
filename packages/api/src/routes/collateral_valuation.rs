//! Per-loan collateral valuation endpoint
//! (`GET /v1/loan-book/{loan_id}/valuations`).
//!
//! Read-only. Loads the loan's valuation record (anchor, which carries quantity, plus
//! the latest assay / offtake), the latest reference price, and the loan snapshot (for
//! the CCR denominator), then recomputes collateral value and CCR on demand via
//! `shared::valuation`. There is no cached state — the numbers are always derived
//! from the current inputs (see docs/product-specs/collateral-valuation.md).
//!
//! When a required input is missing the loan is still returned, with the computed
//! sections `null` and `missing_inputs` naming what is absent — mirroring how
//! `routes::loan_book` serializes `collateral: null` for unpriced loans.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::collateral_valuation::{ccr_bps, compute_collateral, ConcentrateValuation};
use shared::collateral_valuation_repo::{
    AssayMetalJson, AssayRow, CollateralValuationRow, DeleteriousJson, OfftakeTermsRow,
    PayableTermJson, PenaltyTierJson, RefiningChargeJson, ValuationMode,
};

use crate::auth::{AuthClaims, SecurityAddon};
use crate::error::ApiError;
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::AppState;

/// On-chain USDC fixed-point scale (`1e6`). Loan tranches are stored base-6, but
/// collateral value is computed in plain USD, so the senior principal is divided
/// by this before the CCR ratio.
const USDC_SCALE: i64 = 1_000_000;

/// Role required to submit an assay or offtake-terms record. The spec (see
/// `docs/product-specs/collateral-valuation.md` §"Per-loan valuation record") says
/// "the Team and Trustee enter... the human inputs" — but this codebase has no
/// separate `team`/`operations` role yet (only `originator` and `trustee`, defined
/// in `routes::loan_book`), so both endpoints are trustee-only for now.
const TRUSTEE_ROLE: &str = "trustee";

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
    /// Current collateral quantity in dry metric tonnes — always known, since it is
    /// authored on the anchor at submission time.
    pub quantity_dmt: String,
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

// ── Submission DTOs (assay / offtake) ───────────────────────────────────────────

/// Request body for `POST /v1/loan-book/{loan_id}/assay`.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct SubmitAssayRequest {
    /// One of `Provisional`, `Final`, `UmpirePending`.
    pub assay_status: String,
    /// Wet-to-dry conversion, percent. Decimal string in `[0, 100]`.
    pub moisture_pct: Option<String>,
    /// Payable-metal grades, e.g. `[{"metal":"gold","grade_g_per_t":"50"}]`.
    pub assays: Vec<AssayMetalInput>,
    /// Penalty elements and their assayed levels.
    #[serde(default)]
    pub deleterious: Vec<DeleteriousInput>,
    /// IPFS pointer or hash of the Certificate of Analysis.
    pub certificate_uri: Option<String>,
    /// The certificate's own effective date (Unix seconds) — not necessarily "now".
    /// `latest_assay` orders by this field, so an accurate value matters.
    pub effective_at: u64,
}

/// One payable-metal grade line.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct AssayMetalInput {
    pub metal: String,
    /// Decimal string, `>= 0`.
    pub grade_g_per_t: String,
}

/// One deleterious-element level line.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct DeleteriousInput {
    pub element: String,
    /// Decimal string, `>= 0`.
    pub level: String,
    /// `Pct` or `Ppm`.
    pub unit: String,
}

/// Response for `POST /v1/loan-book/{loan_id}/assay`.
#[derive(Debug, Serialize, ToSchema)]
pub struct SubmitAssayResponse {
    pub id: i64,
}

/// Request body for `POST /v1/loan-book/{loan_id}/offtake`.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct SubmitOfftakeRequest {
    /// Per-metal payable percentage and minimum deduction. Must not be empty.
    pub payable_terms: Vec<PayableTermInput>,
    /// US$ per dry tonne. Decimal string, `>= 0`.
    pub treatment_charge_per_dmt: String,
    /// Per-metal refining charge. Empty when no metal has one.
    #[serde(default)]
    pub refining_charges: Vec<RefiningChargeInput>,
    /// Per-element penalty tiers. Empty when the deal has none.
    #[serde(default)]
    pub penalty_schedule: Vec<PenaltyTierInput>,
    /// Freight, insurance, superintendence, marketing. Decimal string, `>= 0`.
    pub realisation_costs: String,
    /// E.g. `"2 MAMA"`.
    pub quotational_period: Option<String>,
    /// E.g. `"LBMA Gold PM over the QP"`.
    pub pricing_reference: Option<String>,
    /// One of `FOB`, `CFR`, `CIF`.
    pub incoterm: Option<String>,
    /// The offtake contract's own effective date (Unix seconds) — not necessarily
    /// "now". `latest_offtake` orders by this field, so an accurate value matters.
    pub effective_at: u64,
}

/// One metal's payable terms.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct PayableTermInput {
    pub metal: String,
    /// Decimal fraction string in `[0, 1]`, e.g. `"0.80"` for 80%.
    pub payable_pct: String,
    /// Decimal string, `>= 0`.
    pub min_deduction_g_per_t: String,
}

/// One metal's refining charge.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct RefiningChargeInput {
    pub metal: String,
    /// US$ per payable ounce. Decimal string, `>= 0`.
    pub rc_per_oz: String,
}

/// One penalty-schedule tier.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct PenaltyTierInput {
    pub element: String,
    /// Decimal string, `>= 0`.
    pub threshold: String,
    /// Decimal string, **must be `> 0`** — `shared::collateral_valuation` divides
    /// the assayed excess by this value (`excess / step_pct`); a `0` would produce
    /// a division by zero the next time this loan's valuation is computed.
    pub step: String,
    /// Decimal string, `>= 0`.
    pub rate_per_dmt: String,
    #[serde(default)]
    pub escalating: bool,
}

/// Response for `POST /v1/loan-book/{loan_id}/offtake`.
#[derive(Debug, Serialize, ToSchema)]
pub struct SubmitOfftakeResponse {
    pub id: i64,
}

/// OpenAPI doc bundle for the valuation route.
#[derive(OpenApi)]
#[openapi(
    paths(get_collateral_valuation, submit_assay, submit_offtake),
    components(schemas(
        CollateralValuationResponse,
        CollateralValuationInputs,
        ValuationMode,
        MetalInput,
        PenaltyInput,
        Waterfall,
        Ccr,
        SubmitAssayRequest,
        AssayMetalInput,
        DeleteriousInput,
        SubmitAssayResponse,
        SubmitOfftakeRequest,
        PayableTermInput,
        RefiningChargeInput,
        PenaltyTierInput,
        SubmitOfftakeResponse,
    )),
    modifiers(&SecurityAddon)
)]
pub struct CollateralValuationDoc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/loan-book/{loan_id}/valuations",
            get(get_collateral_valuation),
        )
        .route("/loan-book/{loan_id}/assay", post(submit_assay))
        .route("/loan-book/{loan_id}/offtake", post(submit_offtake))
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

// ── Submission handlers (assay / offtake) ───────────────────────────────────────

/// Submit a new assay record for a loan. Trustee-only. The loan must already have a
/// `MetalConcentrate` valuation anchor (`POST /v1/loan-book/loan`) — assay data is
/// meaningless for standard-goods loans or loans that haven't been drawn on-chain yet.
/// Append-only: this always inserts a new row (never updates one), so the audit
/// trail is a growing history rather than an edit log — a new certificate is a new
/// row, and `GET /v1/loan-book/{loan_id}/valuations` picks up the newest by
/// `effective_at`.
#[utoipa::path(
    post,
    path = "/v1/loan-book/{loan_id}/assay",
    params(
        ("loan_id" = String, Path, description = "On-chain loan id"),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    request_body = SubmitAssayRequest,
    responses(
        (status = 201, description = "Assay recorded", body = SubmitAssayResponse),
        (status = 400, description = "Payload failed validation, or the loan's valuation_mode is not MetalConcentrate"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No valuation anchor for this loan"),
    ),
    security(("bearer_auth" = [])),
    tag = "LoanBook"
)]
async fn submit_assay(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    Query(query): Query<ChainQuery>,
    Json(payload): Json<SubmitAssayRequest>,
) -> Result<(StatusCode, Json<SubmitAssayResponse>), ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

    let chain_id = resolve_chain(&state, query.chain_id);
    let loan_id = BigDecimal::from_str(loan_id.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid loan_id: {loan_id}")))?;

    validate_assay(&payload).map_err(ApiError::BadRequest)?;

    let repo = &state.collateral_valuation_repo;
    let anchor = repo.get_anchor(chain_id, &loan_id).await?.ok_or_else(|| {
        ApiError::NotFound(format!(
            "no valuation for loan {loan_id} on chain {chain_id}"
        ))
    })?;
    if anchor.valuation_mode != ValuationMode::MetalConcentrate {
        return Err(ApiError::BadRequest(
            "assay inputs only apply to MetalConcentrate-mode loans".to_owned(),
        ));
    }

    let moisture_pct = payload
        .moisture_pct
        .as_deref()
        .map(|s| parse_dec("moisture_pct", s))
        .transpose()
        .map_err(ApiError::BadRequest)?;
    let assays: Vec<AssayMetalJson> = payload
        .assays
        .iter()
        .map(|m| AssayMetalJson {
            metal: m.metal.clone(),
            grade_g_per_t: m.grade_g_per_t.clone(),
        })
        .collect();
    let deleterious: Vec<DeleteriousJson> = payload
        .deleterious
        .iter()
        .map(|d| DeleteriousJson {
            element: d.element.clone(),
            level: d.level.clone(),
            unit: d.unit.clone(),
        })
        .collect();
    let effective_at = unix_to_datetime(payload.effective_at)?;

    let id = repo
        .insert_assay(
            chain_id,
            &loan_id,
            &payload.assay_status,
            moisture_pct.as_ref(),
            &assays,
            &deleterious,
            payload.certificate_uri.as_deref(),
            effective_at,
            &claims.sub,
        )
        .await?;

    Ok((StatusCode::CREATED, Json(SubmitAssayResponse { id })))
}

/// Submit a new offtake-terms record for a loan. Trustee-only. Same
/// `MetalConcentrate`-only, append-only semantics as [`submit_assay`] — an amended
/// offtake is a new row, and `GET /v1/loan-book/{loan_id}/valuations` picks up the
/// newest by `effective_at`.
#[utoipa::path(
    post,
    path = "/v1/loan-book/{loan_id}/offtake",
    params(
        ("loan_id" = String, Path, description = "On-chain loan id"),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    request_body = SubmitOfftakeRequest,
    responses(
        (status = 201, description = "Offtake terms recorded", body = SubmitOfftakeResponse),
        (status = 400, description = "Payload failed validation, or the loan's valuation_mode is not MetalConcentrate"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No valuation anchor for this loan"),
    ),
    security(("bearer_auth" = [])),
    tag = "LoanBook"
)]
async fn submit_offtake(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    Query(query): Query<ChainQuery>,
    Json(payload): Json<SubmitOfftakeRequest>,
) -> Result<(StatusCode, Json<SubmitOfftakeResponse>), ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

    let chain_id = resolve_chain(&state, query.chain_id);
    let loan_id = BigDecimal::from_str(loan_id.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid loan_id: {loan_id}")))?;

    validate_offtake(&payload).map_err(ApiError::BadRequest)?;

    let repo = &state.collateral_valuation_repo;
    let anchor = repo.get_anchor(chain_id, &loan_id).await?.ok_or_else(|| {
        ApiError::NotFound(format!(
            "no valuation for loan {loan_id} on chain {chain_id}"
        ))
    })?;
    if anchor.valuation_mode != ValuationMode::MetalConcentrate {
        return Err(ApiError::BadRequest(
            "offtake inputs only apply to MetalConcentrate-mode loans".to_owned(),
        ));
    }

    let treatment_charge_per_dmt = parse_dec(
        "treatment_charge_per_dmt",
        &payload.treatment_charge_per_dmt,
    )
    .map_err(ApiError::BadRequest)?;
    let realisation_costs =
        parse_dec("realisation_costs", &payload.realisation_costs).map_err(ApiError::BadRequest)?;
    let payable_terms: Vec<PayableTermJson> = payload
        .payable_terms
        .iter()
        .map(|t| PayableTermJson {
            metal: t.metal.clone(),
            payable_pct: t.payable_pct.clone(),
            min_deduction_g_per_t: t.min_deduction_g_per_t.clone(),
        })
        .collect();
    let refining_charges: Vec<RefiningChargeJson> = payload
        .refining_charges
        .iter()
        .map(|r| RefiningChargeJson {
            metal: r.metal.clone(),
            rc_per_oz: r.rc_per_oz.clone(),
        })
        .collect();
    let penalty_schedule: Vec<PenaltyTierJson> = payload
        .penalty_schedule
        .iter()
        .map(|p| PenaltyTierJson {
            element: p.element.clone(),
            threshold: p.threshold.clone(),
            step: p.step.clone(),
            rate_per_dmt: p.rate_per_dmt.clone(),
            escalating: p.escalating,
        })
        .collect();
    let effective_at = unix_to_datetime(payload.effective_at)?;

    let id = repo
        .insert_offtake(
            chain_id,
            &loan_id,
            &payable_terms,
            &treatment_charge_per_dmt,
            &refining_charges,
            &penalty_schedule,
            &realisation_costs,
            payload.quotational_period.as_deref(),
            payload.pricing_reference.as_deref(),
            payload.incoterm.as_deref(),
            effective_at,
            &claims.sub,
        )
        .await?;

    Ok((StatusCode::CREATED, Json(SubmitOfftakeResponse { id })))
}

/// Unix seconds → `DateTime<Utc>`. `400` on the (practically unreachable, since
/// every valid `u64` fits) construction failure, for a total function.
fn unix_to_datetime(unix_secs: u64) -> Result<DateTime<Utc>, ApiError> {
    DateTime::from_timestamp(unix_secs as i64, 0)
        .ok_or_else(|| ApiError::BadRequest(format!("invalid effective_at: {unix_secs}")))
}

fn parse_dec(label: &str, s: &str) -> Result<BigDecimal, String> {
    BigDecimal::from_str(s).map_err(|_| format!("`{label}` is not a valid decimal: {s}"))
}

/// Pure validation for [`SubmitAssayRequest`] — no I/O, unit-tested directly.
pub fn validate_assay(req: &SubmitAssayRequest) -> Result<(), String> {
    match req.assay_status.as_str() {
        "Provisional" | "Final" | "UmpirePending" => {}
        other => {
            return Err(format!(
                "unknown assay_status `{other}` (expected Provisional, Final, or UmpirePending)"
            ))
        }
    }
    if req.assays.is_empty() {
        return Err("`assays` must not be empty".to_owned());
    }
    for m in &req.assays {
        let grade = parse_dec("grade_g_per_t", &m.grade_g_per_t)?;
        if grade < 0 {
            return Err(format!(
                "grade_g_per_t must be >= 0 for metal `{}`; got {grade}",
                m.metal
            ));
        }
    }
    for d in &req.deleterious {
        let level = parse_dec("level", &d.level)?;
        if level < 0 {
            return Err(format!(
                "level must be >= 0 for element `{}`; got {level}",
                d.element
            ));
        }
        match d.unit.as_str() {
            "Pct" | "Ppm" => {}
            other => {
                return Err(format!(
                    "unknown unit `{other}` for element `{}` (expected Pct or Ppm)",
                    d.element
                ))
            }
        }
    }
    if let Some(moisture) = &req.moisture_pct {
        let moisture = parse_dec("moisture_pct", moisture)?;
        #[allow(clippy::manual_range_contains)]
        let out_of_range = moisture < 0 || moisture > 100;
        if out_of_range {
            return Err(format!(
                "moisture_pct must be between 0 and 100; got {moisture}"
            ));
        }
    }
    Ok(())
}

/// Pure validation for [`SubmitOfftakeRequest`] — no I/O, unit-tested directly.
pub fn validate_offtake(req: &SubmitOfftakeRequest) -> Result<(), String> {
    if req.payable_terms.is_empty() {
        return Err("`payable_terms` must not be empty".to_owned());
    }
    for t in &req.payable_terms {
        let payable_pct = parse_dec("payable_pct", &t.payable_pct)?;
        #[allow(clippy::manual_range_contains)]
        let out_of_range = payable_pct < 0 || payable_pct > 1;
        if out_of_range {
            return Err(format!(
                "payable_pct must be between 0 and 1 for metal `{}`; got {payable_pct}",
                t.metal
            ));
        }
        let min_deduction = parse_dec("min_deduction_g_per_t", &t.min_deduction_g_per_t)?;
        if min_deduction < 0 {
            return Err(format!(
                "min_deduction_g_per_t must be >= 0 for metal `{}`; got {min_deduction}",
                t.metal
            ));
        }
    }
    let treatment_charge = parse_dec("treatment_charge_per_dmt", &req.treatment_charge_per_dmt)?;
    if treatment_charge < 0 {
        return Err(format!(
            "treatment_charge_per_dmt must be >= 0; got {treatment_charge}"
        ));
    }
    let realisation_costs = parse_dec("realisation_costs", &req.realisation_costs)?;
    if realisation_costs < 0 {
        return Err(format!(
            "realisation_costs must be >= 0; got {realisation_costs}"
        ));
    }
    for r in &req.refining_charges {
        let rc = parse_dec("rc_per_oz", &r.rc_per_oz)?;
        if rc < 0 {
            return Err(format!(
                "rc_per_oz must be >= 0 for metal `{}`; got {rc}",
                r.metal
            ));
        }
    }
    for p in &req.penalty_schedule {
        let threshold = parse_dec("threshold", &p.threshold)?;
        if threshold < 0 {
            return Err(format!(
                "threshold must be >= 0 for element `{}`; got {threshold}",
                p.element
            ));
        }
        // Guards the `excess / step_pct` division in
        // `shared::collateral_valuation::ConcentrateInputs::valuate` — a `0` step
        // would divide by zero the next time this loan's valuation is computed.
        let step = parse_dec("step", &p.step)?;
        if step <= 0 {
            return Err(format!(
                "step must be > 0 for element `{}`; got {step}",
                p.element
            ));
        }
        let rate = parse_dec("rate_per_dmt", &p.rate_per_dmt)?;
        if rate < 0 {
            return Err(format!(
                "rate_per_dmt must be >= 0 for element `{}`; got {rate}",
                p.element
            ));
        }
    }
    if let Some(incoterm) = &req.incoterm {
        match incoterm.as_str() {
            "FOB" | "CFR" | "CIF" => {}
            other => {
                return Err(format!(
                    "unknown incoterm `{other}` (expected FOB, CFR, or CIF)"
                ))
            }
        }
    }
    Ok(())
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
    reference_price: Option<&BigDecimal>,
    outstanding_senior: Option<&BigDecimal>,
) -> Result<CollateralValuationResponse, ApiError> {
    let mut missing = Vec::new();
    if reference_price.is_none() {
        missing.push("reference_price".to_owned());
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
        quantity_dmt: anchor.quantity_dmt.to_plain_string(),
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
    let computation =
        compute_collateral(anchor, assay, offtake, reference_price).map_err(ApiError::Internal)?;
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
