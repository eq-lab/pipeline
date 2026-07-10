//! Loan Book endpoint (`GET /v1/loan-book`).
//!
//! Read-only aggregation backing the Loan Book section of the Protocol Dashboard:
//! portfolio-level summary cards plus the active-loan table. Conventions match
//! `routes::stats` / `routes::portfolio` — Axum handler, utoipa schema, base-6
//! decimal strings for USDC amounts, decimal-fraction strings for rates, and
//! `chain_id?` defaulting to `DEFAULT_CHAIN_ID`.

use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode, ToPrimitive};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, OpenApi, ToSchema};

use shared::collateral_valuation::{ccr_bps, compute_collateral};
use shared::collateral_valuation_repo::{
    AssayRow, CollateralValuationRow, OfftakeTermsRow, QuantityReportRow,
};
use shared::contract_logs_repo::{LifecycleRow, LoanSnapshotRow};
use shared::submitted_loan_repo::{SubmissionStatus, SubmittedLoanRow};

use crate::auth::{AuthClaims, SecurityAddon};
use crate::error::ApiError;
use crate::formatting::base6_to_decimal_string;
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::AppState;

/// Role required to submit loan data via `POST /v1/loan-book/loan`.
const ORIGINATOR_ROLE: &str = "originator";
/// Role required to list and review submissions (trustee-only endpoints).
const TRUSTEE_ROLE: &str = "trustee";
/// Fixed-point scale for CCR / monetary amounts on-chain (`ONE = 1e6`). The
/// initial CCR must be at least 100 % (`>= ONE`), mirroring `draw_loan`.
const CCR_ONE: u32 = 1_000_000;

// ── Constants ────────────────────────────────────────────────────────────────

/// Seconds per day. Matches `routes::portfolio::SECS_PER_DAY`; duplicated here to
/// keep this module self-contained.
const SECS_PER_DAY: i64 = 86_400;
/// Basis-points denominator (10_000 bps = 100 %).
const BPS_DENOM: i64 = 10_000;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Portfolio-level aggregates for the Loan Book header cards. Computed over the
/// *active* loan set (`origination_date <= now < effective_end`), the same
/// definition used by `routes::portfolio::compute_series`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanBookSummary {
    /// Total capital deployed = Σ (senior + equity tranche) over active loans,
    /// USDC (6-decimal string).
    pub total_deployed: String,
    /// Total collateral value = Σ per-loan collateral over active loans, USDC
    /// (6-decimal string). Each loan's collateral is `latest price_usd × discount`
    /// (`loan_parameters` + newest `loan_asset_prices` row for its asset).
    ///
    /// `null` when no active loan has a configured asset with a stored price.
    pub total_collateral: Option<String>,
    /// Senior debt coverage = `total_collateral / Σ senior_tranche`, 2-decimal
    /// string (e.g. `"1.50"`). The denominator is Σ senior tranche over **all**
    /// active loans (not just priced ones), so unpriced loans make coverage more
    /// conservative.
    ///
    /// `null` when `total_collateral` is unavailable or Σ senior tranche is zero.
    pub senior_debt_coverage: Option<String>,
    /// Principal-weighted senior interest rate as a decimal fraction (e.g.
    /// `"0.112000"` = 11.2 %), 6-decimal string. Weighted by per-loan principal
    /// (senior + equity). `null` when no loans are active.
    ///
    /// Also backs the Trustee "Loans" page **Weighted rate** tile (principal-weighted
    /// interest over the active set).
    pub avg_yield: Option<String>,
    /// Principal-weighted loan term in days, rounded. `null` when no loans are active.
    ///
    /// Also backs the Trustee "Loans" page **Weighted tenor** tile (same
    /// principal-weighted definition over the active set).
    pub avg_duration_days: Option<i64>,
    /// Σ **outstanding** senior (original senior − senior principal repaid) over active
    /// loans, USDC (6-decimal string). Distinct from `total_deployed` (senior + equity,
    /// original). Backs the Trustee "Loans" page **Deployed senior** tile; shares the
    /// outstanding-senior basis with the Senior-outst. column and the at-risk/concentration figures.
    pub deployed_senior: String,
    /// Principal-weighted senior interest rate as a decimal fraction (6-decimal
    /// string), over active loans. Backs the **Weighted rate** tile. Same value and
    /// method as `avg_yield` (kept as a dedicated field for the Trustee contract);
    /// `null` when no loans are active.
    pub weighted_rate: Option<String>,
    /// Principal-weighted loan term in days, rounded, over active loans. Backs the
    /// **Weighted tenor** tile. Same value as `avg_duration_days`; `null` when no
    /// loans are active.
    pub weighted_tenor_days: Option<i64>,
    /// Σ outstanding senior (`original_senior_tranche − senior_principal_repaid`) of
    /// at-risk loans — status `WatchList` or `Default`, over all open (originated,
    /// non-closed) loans, **including defaulted loans excluded from the active set**.
    /// USDC 6-decimal string; `"0.000000"` when none. Backs the **At-risk (WL +
    /// Default)** tile (absolute sub-figure).
    pub at_risk_wl_and_default_senior: String,
    /// At-risk senior over whole-book NAV (active-loan collateral + at-risk-default
    /// collateral), 4-decimal fraction string (e.g. `"0.0430"`), clamped to ≤ `"1.0000"`.
    /// Backs the **At-risk (WL + Default)** tile headline %. `null` when no collateral
    /// is available for the relevant book.
    pub at_risk_wl_and_default_pct: Option<String>,
    /// Largest single-commodity exposure by **outstanding**-senior share over active
    /// loans. Backs the **Top concentration** tile. `null` when Σ outstanding senior is zero.
    pub top_concentration: Option<TopConcentration>,
}

/// Per-loan spot-price inputs, keyed by `loan_key`. Assembled by the handler from
/// the loan's collateral-valuation anchor (asset + provider) and the price series,
/// then passed into [`compute_loan_book`] so the pure computation stays DB-free.
#[derive(Debug, Clone, Default)]
pub struct LoanSpot {
    /// Latest spot price of the underlying asset (USD, decimal string).
    pub price: Option<String>,
    /// Trailing 7-day change as a decimal fraction string (e.g. `"0.0080"`).
    pub change_7d: Option<String>,
}

/// Largest single-commodity (underlying) exposure in the active loan book —
/// several loans of the same commodity are summed. Backs the Trustee "Loans"
/// page **Top concentration** tile (the policy limit is frontend-owned).
#[derive(Debug, Serialize, ToSchema)]
pub struct TopConcentration {
    /// Underlying commodity with the largest senior exposure.
    pub commodity: String,
    /// That commodity's share of Σ outstanding senior, 4-decimal fraction (e.g. `"0.0720"`).
    pub share: String,
}

/// One row in the Loan Book table.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanBookEntry {
    /// Originating party (e.g. `"Open Mineral"`).
    pub originator: String,
    /// Borrower identifier from the loan snapshot.
    pub borrower: String,
    /// Underlying commodity (e.g. `"Copper Concentrate"`).
    pub commodity: String,
    /// Principal = senior tranche + equity tranche, USDC (6-decimal string).
    pub principal: String,
    /// Outstanding senior = `original_senior_tranche − senior_principal_repaid`, USDC
    /// (6-decimal string). Backs the Trustee Loans table **Senior outst.** column
    /// (distinct from `principal`, which is the original senior + equity).
    pub senior_outstanding: String,
    /// Rollover-aware maturity (`current_maturity_timestamp`, Unix seconds). Backs the
    /// **Maturity** column; reflects rollovers, unlike the origination-fixed term
    /// behind `duration_days`.
    pub maturity: i64,
    /// Timestamp the current CCR was last reported on-chain (`last_reported_ccr_timestamp`,
    /// Unix seconds) — backs the CCR staleness/age chip. `0` when never reported.
    pub ccr_reported_at: i64,
    /// Latest spot price of the loan's underlying asset (USD, decimal string), from the
    /// loan's configured price provider. `null` when the loan has no priced asset.
    pub spot_price: Option<String>,
    /// Trailing 7-day change of the underlying spot price, decimal fraction string
    /// (e.g. `"0.0080"` = +0.8 %, `"-0.0120"` = −1.2 %). `null` when a 7-day-prior
    /// price is unavailable or zero.
    pub spot_change_7d: Option<String>,
    /// Collateral value = `latest price_usd × discount`, USDC (6-decimal string).
    /// The price is the newest `loan_asset_prices` row for the loan's asset; the
    /// asset and discount come from `loan_parameters` (keyed by `loan_id`).
    ///
    /// `null` when the loan has no `loan_parameters` row or its asset has no price.
    pub collateral: Option<String>,
    /// Loan-to-value = `principal / collateral`, 4-decimal string (e.g. `"0.8511"`).
    ///
    /// `null` when `collateral` is unavailable or zero.
    pub ltv: Option<String>,
    /// Collateral Coverage Ratio in basis points (`14000` = 140 %) =
    /// `collateral / outstanding senior principal`. `null` when collateral is
    /// unavailable or the senior principal is fully repaid.
    pub ccr_bps: Option<u32>,
    /// Original loan term in days (`maturity − origination`).
    pub duration_days: i64,
    /// Senior interest rate as a decimal fraction, 6-decimal string (e.g. `"0.112000"`
    /// = 11.2 %). Matches the `apy` / `avg_yield` format used across the API.
    pub rate: String,
    /// Trade-finance protection instrument (e.g. "LC at sight", "Doc. coll.").
    ///
    /// Sourced from the loan metadata (`LoanSnapshot.protection`); `null` when the
    /// loan has no protection recorded (empty string in the snapshot).
    pub protection: Option<String>,
    /// Loan status from the latest snapshot (`Performing`, `WatchList`, …).
    pub status: String,
    /// Documents referenced in the loan metadata (Agreement, License, T&Cs, …).
    /// Empty when the loan's metadata records none.
    pub documents: Vec<LoanDocumentDto>,
}

/// A single document reference (name + URI) from the loan metadata document.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct LoanDocumentDto {
    pub name: String,
    pub uri: String,
}

/// Response for `GET /v1/loan-book`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanBookResponse {
    pub summary: LoanBookSummary,
    /// Active loans, sorted by `principal` descending.
    pub loans: Vec<LoanBookEntry>,
}

// ── Submission DTOs ────────────────────────────────────────────────────────

/// Loan economics fixed at origination — mirrors the contract's
/// `ImmutableLoanData`. USDC amounts are base-6 decimal strings (matching the
/// loan-book read conventions); the validator parses and checks the same
/// invariants `draw_loan` enforces on-chain.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct EconomicsInput {
    /// Total facility size, USDC (6-decimal string). Must equal senior + equity.
    pub original_facility_size: String,
    /// Senior tranche, USDC (6-decimal string).
    pub original_senior_tranche: String,
    /// Equity tranche, USDC (6-decimal string).
    pub original_equity_tranche: String,
    /// Offtaker price, USDC (6-decimal string). Must be `>= original_facility_size`.
    pub original_offtaker_price: String,
    /// Senior interest rate in basis points.
    pub senior_interest_rate_bps: u32,
    /// Origination timestamp (Unix seconds).
    pub origination_date: u64,
    /// Original maturity timestamp (Unix seconds). Must be after `origination_date`.
    pub original_maturity_date: u64,
}

/// Initial collateral location — mirrors the contract's `LocationUpdate`.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct LocationInput {
    /// One of `Vessel`, `Warehouse`, `TankFarm`, `Other`.
    pub location_type: String,
    pub location_identifier: String,
    pub tracking_url: String,
    /// Report timestamp (Unix seconds).
    pub updated_at: u64,
}

/// Request body for `POST /v1/loan-book/loan` — every input required by the
/// on-chain `draw_loan`, persisted verbatim for trustee review.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct SubmitLoanRequest {
    /// Address the soulbound loan token is minted to (`draw_loan`'s `to`).
    pub to: String,
    /// On-chain metadata URI pointer (`draw_loan`'s `metadata_uri`).
    pub metadata_uri: String,
    // ── Off-chain metadata document fields (the `LoanMetadataJson` shape) ──
    pub originator: String,
    pub borrower_id: String,
    pub commodity: String,
    pub corridor: String,
    pub governing_law: String,
    /// Trade-finance protection instrument (e.g. "LC at sight").
    #[serde(default)]
    pub protection: String,
    /// Optional secondary URI inside the metadata document.
    #[serde(default)]
    pub secondary_metadata_uri: Option<String>,
    /// Documents referenced in the metadata document (Agreement, License, T&Cs, …).
    #[serde(default)]
    pub documents: Vec<LoanDocumentDto>,
    /// Loan economics fixed at origination.
    pub economics: EconomicsInput,
    /// Initial collateral-coverage ratio (1e6-scaled; must be `>= 1_000_000`).
    pub initial_ccr: u32,
    /// Initial collateral location.
    pub initial_location: LocationInput,
}

/// Response for `POST /v1/loan-book/loan`.
#[derive(Debug, Serialize, ToSchema)]
pub struct SubmitLoanResponse {
    /// Identifier of the newly created submission (the `submitted_loans` PK — not
    /// the on-chain `loan_id`, which does not exist until the loan is drawn).
    pub id: i64,
}

/// Query params for `GET /v1/loan-book/submissions`.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SubmissionsQuery {
    /// Filter by lifecycle status (`InReview`, `Approved`, `Rejected`). Omit for all.
    pub status: Option<String>,
}

/// One submission as returned to a trustee.
#[derive(Debug, Serialize, ToSchema)]
pub struct SubmissionView {
    pub id: i64,
    /// `InReview` | `Approved` | `Rejected`.
    pub status: String,
    /// Rejection reason; present iff `status = Rejected`.
    pub reason: Option<String>,
    /// The submitter (authenticated address).
    pub originator: String,
    /// Submission timestamp (RFC 3339).
    pub created_at: String,
    /// Last update timestamp (RFC 3339).
    pub updated_at: String,
    /// Documents referenced in the submitted metadata (Agreement, License, T&Cs, …),
    /// lifted from `loan_data.documents` for direct consumption. Empty for legacy
    /// submissions that predate the field (`loan_data` still carries it verbatim).
    pub documents: Vec<LoanDocumentDto>,
    /// The full submitted payload (all `draw_loan` inputs), passed through verbatim.
    pub loan_data: serde_json::Value,
}

/// Lift the `documents` array out of a stored submission payload. Missing or
/// malformed `documents` yields an empty vec (legacy submissions predate the field).
pub fn extract_documents(loan_data: &serde_json::Value) -> Vec<LoanDocumentDto> {
    loan_data
        .get("documents")
        .and_then(|v| serde_json::from_value::<Vec<LoanDocumentDto>>(v.clone()).ok())
        .unwrap_or_default()
}

impl From<SubmittedLoanRow> for SubmissionView {
    fn from(r: SubmittedLoanRow) -> Self {
        SubmissionView {
            id: r.id,
            status: r.status,
            reason: r.reason,
            originator: r.originator,
            created_at: r.created_at.to_rfc3339(),
            updated_at: r.updated_at.to_rfc3339(),
            documents: extract_documents(&r.loan_data),
            loan_data: r.loan_data,
        }
    }
}

/// The trustee decision in `POST /v1/loan-book/submissions/{id}/review`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
pub enum ReviewDecision {
    Approved,
    Rejected,
}

/// Request body for `POST /v1/loan-book/submissions/{id}/review`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReviewRequest {
    /// `Approved` or `Rejected`.
    pub decision: ReviewDecision,
    /// Required when `decision = Rejected`; must be omitted/empty otherwise.
    #[serde(default)]
    pub reason: Option<String>,
}

/// OpenAPI doc bundle for the loan-book route.
#[derive(OpenApi)]
#[openapi(
    paths(get_loan_book, submit_loan, list_submissions, review_submission),
    components(schemas(
        LoanBookResponse,
        LoanBookSummary,
        TopConcentration,
        LoanBookEntry,
        LoanDocumentDto,
        SubmitLoanRequest,
        SubmitLoanResponse,
        EconomicsInput,
        LocationInput,
        SubmissionView,
        ReviewRequest,
        ReviewDecision,
    )),
    modifiers(&SecurityAddon),
    tags((name = "LoanBook", description = "Protocol loan book aggregation"))
)]
pub struct LoanBookDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/loan-book", get(get_loan_book))
        .route("/loan-book/loan", post(submit_loan))
        .route("/loan-book/submissions", get(list_submissions))
        .route(
            "/loan-book/submissions/{id}/review",
            post(review_submission),
        )
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/loan-book",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Loan book aggregates and active-loan table", body = LoanBookResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "LoanBook"
)]
async fn get_loan_book(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<LoanBookResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    handle_loan_book(&state, chain_id).await.map(Json)
}

/// Submit loan data. Restricted to callers holding the `originator` role
/// (authenticate via `POST /v1/auth/verify`, then send the JWT as
/// `Authorization: Bearer <token>`).
///
/// Validates the payload against the same invariants `draw_loan` enforces, then
/// persists it as an `InReview` submission for trustee review. The submitter's
/// authenticated address (JWT `sub`) is recorded as the originator.
#[utoipa::path(
    post,
    path = "/v1/loan-book/loan",
    request_body = SubmitLoanRequest,
    responses(
        (status = 201, description = "Submission accepted; awaiting trustee review", body = SubmitLoanResponse),
        (status = 400, description = "Payload failed validation"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `originator` role"),
    ),
    security(("bearer_auth" = [])),
    tag = "LoanBook"
)]
async fn submit_loan(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SubmitLoanRequest>,
) -> Result<(StatusCode, Json<SubmitLoanResponse>), ApiError> {
    if !claims.has_role(ORIGINATOR_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{ORIGINATOR_ROLE}` role"
        )));
    }

    validate_submission(&payload).map_err(ApiError::BadRequest)?;

    // Persist the payload verbatim; serialization of an owned struct cannot fail.
    let loan_data = serde_json::to_value(&payload)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to serialize payload: {e}")))?;

    let id = state
        .submitted_loan_repo
        .insert(&loan_data, &claims.sub)
        .await?;

    Ok((StatusCode::CREATED, Json(SubmitLoanResponse { id })))
}

/// List loan submissions. Public — no authentication required. Optionally filter
/// by `status`; omit the query param to return all submissions, newest first.
#[utoipa::path(
    get,
    path = "/v1/loan-book/submissions",
    params(SubmissionsQuery),
    responses(
        (status = 200, description = "Submissions (filtered by status if provided)", body = [SubmissionView]),
        (status = 400, description = "Unknown `status` filter value"),
    ),
    tag = "LoanBook"
)]
async fn list_submissions(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SubmissionsQuery>,
) -> Result<Json<Vec<SubmissionView>>, ApiError> {
    let status = match query.status.as_deref() {
        None | Some("") => None,
        Some(s) => Some(SubmissionStatus::from_str(s).map_err(ApiError::BadRequest)?),
    };

    let rows = state.submitted_loan_repo.list(status).await?;
    Ok(Json(rows.into_iter().map(SubmissionView::from).collect()))
}

/// Approve or reject a submission. Trustee-only. A rejection must carry a
/// non-empty `reason`; an approval must not. Only `InReview` submissions can be
/// reviewed — reviewing an already-decided submission returns `409 Conflict`.
#[utoipa::path(
    post,
    path = "/v1/loan-book/submissions/{id}/review",
    params(("id" = i64, Path, description = "Submission id")),
    request_body = ReviewRequest,
    responses(
        (status = 200, description = "Decision applied"),
        (status = 400, description = "Reject without a reason, or approve with one"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No submission with that id"),
        (status = 409, description = "Submission has already been decided"),
    ),
    security(("bearer_auth" = [])),
    tag = "LoanBook"
)]
async fn review_submission(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<ReviewRequest>,
) -> Result<StatusCode, ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

    let (new_status, reason) = resolve_review(&req).map_err(ApiError::BadRequest)?;

    // Distinguish "not found" (404) from "already decided" (409): the conditional
    // UPDATE only touches `InReview` rows, so a `false` result means either.
    if state.submitted_loan_repo.find(id).await?.is_none() {
        return Err(ApiError::NotFound(format!("no submission with id {id}")));
    }
    let updated = state
        .submitted_loan_repo
        .review(id, new_status, reason)
        .await?;
    if !updated {
        return Err(ApiError::Conflict(format!(
            "submission {id} has already been decided"
        )));
    }

    Ok(StatusCode::OK)
}

/// Validate a review request and map it to the `(status, reason)` the repo expects.
/// Pure (no I/O) so it is unit-testable. Reject ⇒ a non-empty `reason` is required;
/// Approve ⇒ no reason may be supplied.
///
/// Public so the unit test in `packages/api/tests/loan_submission.rs` can exercise
/// it without the HTTP/DB layers.
pub fn resolve_review(req: &ReviewRequest) -> Result<(SubmissionStatus, Option<&str>), String> {
    match req.decision {
        ReviewDecision::Rejected => {
            let reason = req
                .reason
                .as_deref()
                .map(str::trim)
                .filter(|r| !r.is_empty())
                .ok_or_else(|| {
                    "a non-empty `reason` is required to reject a submission".to_owned()
                })?;
            Ok((SubmissionStatus::Rejected, Some(reason)))
        }
        ReviewDecision::Approved => {
            if req.reason.as_deref().is_some_and(|r| !r.trim().is_empty()) {
                return Err("`reason` must not be set when approving a submission".to_owned());
            }
            Ok((SubmissionStatus::Approved, None))
        }
    }
}

/// Validate a loan submission against the same invariants `draw_loan` enforces.
/// Pure (no I/O) so it is unit-testable without the HTTP/DB layers.
///
/// Public so the unit test in `packages/api/tests/loan_submission.rs` can exercise
/// it without the HTTP/DB layers.
pub fn validate_submission(req: &SubmitLoanRequest) -> Result<(), String> {
    if req.to.trim().is_empty() {
        return Err("`to` must not be empty".to_owned());
    }
    if req.metadata_uri.trim().is_empty() {
        return Err("`metadata_uri` must not be empty".to_owned());
    }

    let parse = |label: &str, s: &str| -> Result<BigDecimal, String> {
        BigDecimal::from_str(s).map_err(|_| format!("`{label}` is not a valid decimal: {s}"))
    };
    let facility = parse(
        "original_facility_size",
        &req.economics.original_facility_size,
    )?;
    let senior = parse(
        "original_senior_tranche",
        &req.economics.original_senior_tranche,
    )?;
    let equity = parse(
        "original_equity_tranche",
        &req.economics.original_equity_tranche,
    )?;
    let offtaker = parse(
        "original_offtaker_price",
        &req.economics.original_offtaker_price,
    )?;

    if &senior + &equity != facility {
        return Err("senior + equity tranche must equal facility size".to_owned());
    }
    if offtaker < facility {
        return Err("original_offtaker_price must be >= original_facility_size".to_owned());
    }
    if req.economics.original_maturity_date <= req.economics.origination_date {
        return Err("original_maturity_date must be after origination_date".to_owned());
    }
    if req.initial_ccr < CCR_ONE {
        return Err(format!(
            "initial_ccr must be >= {CCR_ONE} (100%); got {}",
            req.initial_ccr
        ));
    }
    match req.initial_location.location_type.as_str() {
        "Vessel" | "Warehouse" | "TankFarm" | "Other" => {}
        other => {
            return Err(format!(
                "unknown location_type `{other}` (expected Vessel, Warehouse, TankFarm, or Other)"
            ))
        }
    }

    Ok(())
}

async fn handle_loan_book(state: &AppState, chain_id: i64) -> Result<LoanBookResponse, ApiError> {
    // As-of "now" — this endpoint reports the current loan book, matching the
    // window-ends-at-now semantics of the other read endpoints.
    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let loans = state
        .contract_logs_repo
        .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, to)
        .await?;

    if loans.is_empty() {
        return Ok(empty_response());
    }

    let events = state
        .contract_logs_repo
        .list_loan_lifecycle_events(&state.pool, chain_id, to)
        .await?;

    // Fetch the shared inputs ONCE and pass into both builders (they both key off the
    // valuation anchors + the latest price series).
    let anchors = state
        .collateral_valuation_repo
        .all_anchors(chain_id)
        .await?;
    let latest_prices: HashMap<(String, String), BigDecimal> = state
        .loan_asset_price_repo
        .latest_prices()
        .await?
        .into_iter()
        .map(|(asset, provider, price)| ((asset, provider), price))
        .collect();

    let collateral_by_loan = collateral_by_loan(state, chain_id, &anchors, &latest_prices).await?;
    let spot_by_loan = spot_by_loan(state, to, &anchors, &latest_prices).await?;

    Ok(compute_loan_book(
        &loans,
        &events,
        to,
        &collateral_by_loan,
        &spot_by_loan,
    ))
}

/// Build the per-loan spot map: `loan_id → { latest price, trailing 7-day change }`,
/// for the underlying asset each loan's collateral-valuation anchor names (asset +
/// price provider). `latest` is the pre-fetched latest price per (asset, provider);
/// the 7-day change compares it against the newest price in the window
/// `(to − 14d, to − 7d]` (`prices_as_of`) so a stale price can't masquerade as the
/// 7-day-prior value. Loans without an anchor, or an asset/provider with no stored
/// price, are absent (→ `null` fields).
async fn spot_by_loan(
    state: &AppState,
    to: i64,
    anchors: &[CollateralValuationRow],
    latest: &HashMap<(String, String), BigDecimal>,
) -> Result<HashMap<String, LoanSpot>, ApiError> {
    if anchors.is_empty() {
        return Ok(HashMap::new());
    }

    // Newest price in the trailing window (to−14d, to−7d], per (asset, provider):
    // the "~7 days ago" reference, floored so an ancient price isn't used.
    let cutoff = DateTime::<Utc>::from_timestamp(to - 7 * SECS_PER_DAY, 0)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("invalid `to` timestamp: {to}")))?;
    let not_before = DateTime::<Utc>::from_timestamp(to - 14 * SECS_PER_DAY, 0)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("invalid `to` timestamp: {to}")))?;
    let prior: HashMap<(String, String), BigDecimal> = state
        .loan_asset_price_repo
        .prices_as_of(cutoff, not_before)
        .await?
        .into_iter()
        .map(|(asset, provider, price)| ((asset, provider), price))
        .collect();

    let zero = BigDecimal::from(0);
    let mut map = HashMap::new();
    for anchor in anchors {
        let pair = (anchor.asset.clone(), anchor.price_provider.clone());
        let Some(spot) = latest.get(&pair) else {
            continue;
        };
        // 7-day change as a decimal fraction; null when no in-window prior price (or zero).
        let change_7d = prior.get(&pair).filter(|p| *p > &zero).map(|p| {
            ((spot - p) / p)
                .with_scale_round(4, RoundingMode::HalfUp)
                .to_plain_string()
        });
        map.insert(
            loan_key(&anchor.loan_id),
            LoanSpot {
                // Full precision — the change above is derived from this same value,
                // and sub-dollar assets must not be truncated to 2 decimals.
                price: Some(spot.to_plain_string()),
                change_7d,
            },
        );
    }
    Ok(map)
}

/// Build the per-loan collateral map: `loan_id → collateral in micro-USDC`, valued
/// from the collateral-valuation record (anchor + latest assay / offtake / quantity)
/// and the latest reference price via [`compute_collateral`]. Collateral comes out
/// in USD; the `×1e6` scales it to the base-6 units of the on-chain tranche amounts
/// so `compute_loan_book` can format and ratio it against principal.
///
/// `anchors` and `latest_prices` are pre-fetched by the handler (shared with
/// `spot_by_loan`). Loans whose record is incomplete (missing assay/offtake/quantity/
/// price for their mode) are simply absent from the map (→ `null`).
async fn collateral_by_loan(
    state: &AppState,
    chain_id: i64,
    anchors: &[CollateralValuationRow],
    latest_prices: &HashMap<(String, String), BigDecimal>,
) -> Result<HashMap<String, BigDecimal>, ApiError> {
    if anchors.is_empty() {
        return Ok(HashMap::new());
    }
    let repo = &state.collateral_valuation_repo;

    let assays: HashMap<String, AssayRow> = repo
        .latest_assays(chain_id)
        .await?
        .into_iter()
        .map(|r| (loan_key(&r.loan_id), r))
        .collect();
    let offtakes: HashMap<String, OfftakeTermsRow> = repo
        .latest_offtakes(chain_id)
        .await?
        .into_iter()
        .map(|r| (loan_key(&r.loan_id), r))
        .collect();
    let quantities: HashMap<String, QuantityReportRow> = repo
        .latest_quantities(chain_id)
        .await?
        .into_iter()
        .map(|r| (loan_key(&r.loan_id), r))
        .collect();
    let scale = BigDecimal::from(1_000_000);
    let mut map = HashMap::new();
    for anchor in anchors {
        let key = loan_key(&anchor.loan_id);
        let price = latest_prices.get(&(anchor.asset.clone(), anchor.price_provider.clone()));
        let computed = compute_collateral(
            anchor,
            assays.get(&key),
            offtakes.get(&key),
            quantities.get(&key),
            price,
        )
        .map_err(ApiError::Internal)?;
        if let Some(c) = computed {
            map.insert(key, c.collateral_value * &scale);
        }
    }
    Ok(map)
}

/// Canonical map key for a loan id: the `NUMERIC(78,0)` rendered at scale 0, so the
/// `loan_parameters.loan_id` and the snapshot `loan_id` agree regardless of the
/// scale each `BigDecimal` happens to carry.
pub fn loan_key(loan_id: &BigDecimal) -> String {
    loan_id
        .with_scale_round(0, RoundingMode::Down)
        .to_plain_string()
}

// ── Compute ──────────────────────────────────────────────────────────────────

/// Per-loan principal = senior tranche + equity tranche.
fn principal_of(loan: &LoanSnapshotRow) -> BigDecimal {
    &loan.snapshot.original_senior_tranche + &loan.snapshot.original_equity_tranche
}

/// Effective end of a loan: `min(original_maturity_date, earliest LoanClosed /
/// LoanDefaulted timestamp)`. Mirrors `routes::portfolio`'s end-resolution so the
/// "active" set is identical across endpoints.
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

/// Pure computation: no DB calls. Builds the Loan Book summary + active-loan table
/// from pre-fetched loan snapshots and lifecycle events as-of `to`.
///
/// "Active" = `origination_date <= to < effective_end`, matching
/// `routes::portfolio::compute_series`. Matured, closed, and defaulted loans are
/// excluded (a defaulted loan's `LoanDefaulted` event sets its `effective_end`).
///
/// `collateral_by_loan` maps `loan_key(loan_id)` → collateral value in micro-USDC
/// (`latest price_usd × discount × 1e6`); loans absent from the map have no priced
/// collateral and serialize `collateral` / `ltv` as `null`. `total_collateral` /
/// `senior_debt_coverage` are `null` when no active loan has a value.
///
/// Public so the compute-layer test in `packages/api/tests/loan_book.rs` can
/// exercise it without the HTTP/DB layers.
pub fn compute_loan_book<S: std::hash::BuildHasher>(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    to: i64,
    collateral_by_loan: &HashMap<String, BigDecimal, S>,
    spot_by_loan: &HashMap<String, LoanSpot, S>,
) -> LoanBookResponse {
    // Active loan set, sorted by principal (senior + equity) descending.
    let mut active: Vec<&LoanSnapshotRow> = loans
        .iter()
        .filter(|loan| loan.snapshot.origination_date <= to && to < effective_end(loan, events))
        .collect();
    active.sort_by_key(|loan| std::cmp::Reverse(principal_of(loan)));

    if active.is_empty() {
        return empty_response();
    }

    let mut entries = Vec::with_capacity(active.len());
    let mut total_deployed = BigDecimal::from(0);
    // Principal-weighted numerators; denominator is total_deployed.
    let mut weighted_rate_bps = BigDecimal::from(0);
    let mut weighted_duration = BigDecimal::from(0);
    // Collateral aggregation (micro-USDC). `any_collateral` tracks whether at least
    // one active loan had a priced value, so a book with none reports `null`.
    let mut total_collateral = BigDecimal::from(0);
    // total_senior = Σ ORIGINAL senior (used by senior_debt_coverage);
    // total_outstanding_senior = Σ OUTSTANDING senior (net of repaid), used by
    // deployed_senior + top_concentration so all "senior exposure" figures share a basis.
    let mut total_senior = BigDecimal::from(0);
    let mut total_outstanding_senior = BigDecimal::from(0);
    // Outstanding senior per commodity, for the top-concentration tile.
    let mut senior_by_commodity: HashMap<&str, BigDecimal> = HashMap::new();
    let mut any_collateral = false;
    let zero = BigDecimal::from(0);

    for loan in &active {
        let s = &loan.snapshot;
        let principal = principal_of(loan);
        let duration_days = ((s.original_maturity_date - s.origination_date) / SECS_PER_DAY).max(0);
        // bps → decimal fraction: 1120 bps → "0.112000" (matches the API's apy format).
        let rate = (BigDecimal::from(i64::from(s.senior_interest_rate_bps))
            / BigDecimal::from(BPS_DENOM))
        .with_scale_round(6, RoundingMode::HalfUp)
        .to_plain_string();

        total_deployed += &principal;
        weighted_rate_bps += &principal * BigDecimal::from(i64::from(s.senior_interest_rate_bps));
        weighted_duration += &principal * BigDecimal::from(duration_days);
        total_senior += &s.original_senior_tranche;

        // Outstanding senior = original senior tranche − senior principal repaid,
        // floored at zero. Drives the "Senior outst." column, the CCR denominator,
        // deployed_senior, and the top-concentration tile.
        let outstanding_senior =
            (&s.original_senior_tranche - &s.repayment.senior_principal_repaid).max(zero.clone());
        total_outstanding_senior += &outstanding_senior;
        *senior_by_commodity
            .entry(s.commodity.as_str())
            .or_insert_with(|| BigDecimal::from(0)) += &outstanding_senior;

        // Collateral value (micro-USDC) from the valuation record, keyed by loan_id.
        // Absent → null; present-but-zero → value 0 with null LTV/CCR (no division).
        // CCR = collateral / outstanding senior principal (both micro-USDC, so the
        // ratio is unit-free).
        let (collateral, ltv, ccr) = match collateral_by_loan.get(&loan_key(&loan.loan_id)) {
            Some(c) => {
                any_collateral = true;
                total_collateral += c;
                let ltv = (c > &zero).then(|| {
                    (&principal / c)
                        .with_scale_round(4, RoundingMode::HalfUp)
                        .to_plain_string()
                });
                let ccr = (c > &zero && outstanding_senior > zero)
                    .then(|| ccr_bps(c, &outstanding_senior));
                (Some(base6_to_decimal_string(c)), ltv, ccr)
            }
            None => (None, None, None),
        };

        let spot = spot_by_loan.get(&loan_key(&loan.loan_id));

        entries.push(LoanBookEntry {
            originator: s.originator.clone(),
            borrower: s.borrower_id.clone(),
            commodity: s.commodity.clone(),
            principal: base6_to_decimal_string(&principal),
            senior_outstanding: base6_to_decimal_string(&outstanding_senior),
            maturity: s.current_maturity_timestamp,
            ccr_reported_at: s.last_reported_ccr_timestamp,
            spot_price: spot.and_then(|sp| sp.price.clone()),
            spot_change_7d: spot.and_then(|sp| sp.change_7d.clone()),
            collateral,
            ltv,
            ccr_bps: ccr,
            duration_days,
            rate,
            // Protection instrument from the loan metadata; empty string ⇒ null.
            protection: (!s.protection.is_empty()).then(|| s.protection.clone()),
            status: s.status.clone(),
            documents: s
                .documents
                .iter()
                .map(|d| LoanDocumentDto {
                    name: d.name.clone(),
                    uri: d.uri.clone(),
                })
                .collect(),
        });
    }

    // avg_yield = (Σ principal·rate_bps / Σ principal) / 10_000, as a decimal fraction.
    let avg_yield = (&weighted_rate_bps / &total_deployed / BigDecimal::from(BPS_DENOM))
        .with_scale_round(6, RoundingMode::HalfUp)
        .to_plain_string();

    // avg_duration_days = Σ principal·duration / Σ principal, rounded to nearest day.
    let avg_duration_days = (&weighted_duration / &total_deployed)
        .with_scale_round(0, RoundingMode::HalfUp)
        .to_i64();

    // total_collateral = Σ per-loan collateral (only loans that had a value);
    // null when none did. Coverage = total_collateral / Σ senior, 2 decimals.
    let total_collateral_str = any_collateral.then(|| base6_to_decimal_string(&total_collateral));
    let senior_debt_coverage = (any_collateral && total_senior > zero).then(|| {
        (&total_collateral / &total_senior)
            .with_scale_round(2, RoundingMode::HalfUp)
            .to_plain_string()
    });

    // ── Trustee "Loans" page metrics ──────────────────────────────────────────
    // At-risk = Σ outstanding senior of at-risk loans, computed over the FULL `loans`
    // slice. WatchList counts only while the loan is still active (`to < effective_end`,
    // i.e. not past maturity/close); Default counts until the loan is explicitly closed
    // (`LoanClosed`), even though defaults drop out of the `active` set. This bounds the
    // population so a matured-but-never-closed loan isn't counted indefinitely.
    let active_keys: HashSet<String> = active.iter().map(|l| loan_key(&l.loan_id)).collect();
    let mut at_risk_wl_and_default_senior = BigDecimal::from(0);
    // NAV denominator spans the same book the numerator draws from: active-loan
    // collateral (total_collateral) plus the collateral of at-risk loans that fell out
    // of the active set (defaults), so the ratio reflects whole-book NAV.
    let mut at_risk_extra_collateral = BigDecimal::from(0);
    let mut any_extra_collateral = false;
    for loan in loans {
        let s = &loan.snapshot;
        let at_risk = s.origination_date <= to
            && !is_closed(loan, events, to)
            && match s.status.as_str() {
                "Default" => true,
                "WatchList" => to < effective_end(loan, events),
                _ => false,
            };
        if !at_risk {
            continue;
        }
        // Floor at zero so an over-repaid / anomalous snapshot can't subtract.
        at_risk_wl_and_default_senior +=
            (&s.original_senior_tranche - &s.repayment.senior_principal_repaid).max(zero.clone());
        // Add collateral of at-risk loans not already summed into total_collateral.
        let key = loan_key(&loan.loan_id);
        if !active_keys.contains(&key) {
            if let Some(c) = collateral_by_loan.get(&key) {
                at_risk_extra_collateral += c;
                any_extra_collateral = true;
            }
        }
    }
    // Share over whole-book NAV, clamped to ≤ 100%. Null when no collateral is
    // available for the relevant book.
    let nav_denom = &total_collateral + &at_risk_extra_collateral;
    let at_risk_wl_and_default_pct = ((any_collateral || any_extra_collateral) && nav_denom > zero)
        .then(|| {
            let ratio = &at_risk_wl_and_default_senior / &nav_denom;
            let one = BigDecimal::from(1);
            let capped = if ratio > one { one } else { ratio };
            capped
                .with_scale_round(4, RoundingMode::HalfUp)
                .to_plain_string()
        });

    // Top concentration = largest single-commodity OUTSTANDING-senior exposure over
    // active loans, as a share of total outstanding senior (consistent with the
    // Senior-outst. column and the at-risk figure). `senior_by_commodity` was
    // accumulated in the entry loop.
    let top_concentration = (total_outstanding_senior > zero)
        .then(|| {
            // Max by exposure; ties broken by commodity name for determinism.
            senior_by_commodity
                .into_iter()
                .max_by(|(a_name, a_sen), (b_name, b_sen)| {
                    a_sen.cmp(b_sen).then_with(|| b_name.cmp(a_name))
                })
                .map(|(commodity, sen)| TopConcentration {
                    commodity: commodity.to_owned(),
                    share: (&sen / &total_outstanding_senior)
                        .with_scale_round(4, RoundingMode::HalfUp)
                        .to_plain_string(),
                })
        })
        .flatten();

    LoanBookResponse {
        summary: LoanBookSummary {
            total_deployed: base6_to_decimal_string(&total_deployed),
            total_collateral: total_collateral_str,
            senior_debt_coverage,
            avg_yield: Some(avg_yield.clone()),
            avg_duration_days,
            deployed_senior: base6_to_decimal_string(&total_outstanding_senior),
            // Weighted rate/tenor: same principal-weighted definition as the two
            // fields above, exposed under Trustee-facing names.
            weighted_rate: Some(avg_yield),
            weighted_tenor_days: avg_duration_days,
            at_risk_wl_and_default_senior: base6_to_decimal_string(&at_risk_wl_and_default_senior),
            at_risk_wl_and_default_pct,
            top_concentration,
        },
        loans: entries,
    }
}

/// True when `loan` has a `LoanClosed` lifecycle event at or before `to`. A
/// `LoanDefaulted` event does NOT count as closed — a defaulted loan is still an
/// open, at-risk position until it is explicitly closed.
fn is_closed(loan: &LoanSnapshotRow, events: &[LifecycleRow], to: i64) -> bool {
    events.iter().any(|e| {
        e.loan_id == loan.loan_id && e.event_name == "LoanClosed" && e.block_timestamp <= to
    })
}

/// Empty loan book: zeroed deployed, null optionals, no rows. Returned when the
/// chain has no loans (or none active).
fn empty_response() -> LoanBookResponse {
    LoanBookResponse {
        summary: LoanBookSummary {
            total_deployed: base6_to_decimal_string(&BigDecimal::from(0)),
            total_collateral: None,
            senior_debt_coverage: None,
            avg_yield: None,
            avg_duration_days: None,
            deployed_senior: base6_to_decimal_string(&BigDecimal::from(0)),
            weighted_rate: None,
            weighted_tenor_days: None,
            at_risk_wl_and_default_senior: base6_to_decimal_string(&BigDecimal::from(0)),
            at_risk_wl_and_default_pct: None,
            top_concentration: None,
        },
        loans: vec![],
    }
}
