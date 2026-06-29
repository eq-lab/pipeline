//! Loan Book endpoint (`GET /v1/loan-book`).
//!
//! Read-only aggregation backing the Loan Book section of the Protocol Dashboard:
//! portfolio-level summary cards plus the active-loan table. Conventions match
//! `routes::stats` / `routes::portfolio` — Axum handler, utoipa schema, base-6
//! decimal strings for USDC amounts, decimal-fraction strings for rates, and
//! `chain_id?` defaulting to `DEFAULT_CHAIN_ID`.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode, ToPrimitive};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, OpenApi, ToSchema};

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
    /// Total collateral value = Σ (loan-registry collateral × current price).
    ///
    /// `null`: TODO #706 — no commodity price feed or collateral-quantity source
    /// is indexed yet, so live collateral valuation is not computable. Wire this
    /// once a price source exists.
    pub total_collateral: Option<String>,
    /// Senior debt coverage = `total_collateral / Σ senior_tranche`, 2-decimal
    /// string (e.g. `"1.50"`).
    ///
    /// `null` while `total_collateral` is unavailable (TODO #706).
    pub senior_debt_coverage: Option<String>,
    /// Principal-weighted senior interest rate as a decimal fraction (e.g.
    /// `"0.112000"` = 11.2 %), 6-decimal string. Weighted by per-loan principal
    /// (senior + equity). `null` when no loans are active.
    pub avg_yield: Option<String>,
    /// Principal-weighted loan term in days, rounded. `null` when no loans are active.
    pub avg_duration_days: Option<i64>,
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
    /// Collateral value = collateral quantity × current price, USDC (6-decimal string).
    ///
    /// `null`: TODO #706 — no price feed / collateral-quantity source indexed yet.
    pub collateral: Option<String>,
    /// Loan-to-value = `principal / collateral`, 4-decimal string (e.g. `"0.8511"`).
    ///
    /// `null` while `collateral` is unavailable (TODO #706).
    pub ltv: Option<String>,
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
    /// The full submitted payload (all `draw_loan` inputs), passed through verbatim.
    pub loan_data: serde_json::Value,
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
        LoanBookEntry,
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

/// List loan submissions. Trustee-only. Optionally filter by `status`; omit the
/// query param to return all submissions, newest first.
#[utoipa::path(
    get,
    path = "/v1/loan-book/submissions",
    params(SubmissionsQuery),
    responses(
        (status = 200, description = "Submissions (filtered by status if provided)", body = [SubmissionView]),
        (status = 400, description = "Unknown `status` filter value"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
    ),
    security(("bearer_auth" = [])),
    tag = "LoanBook"
)]
async fn list_submissions(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Query(query): Query<SubmissionsQuery>,
) -> Result<Json<Vec<SubmissionView>>, ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

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

    Ok(compute_loan_book(&loans, &events, to))
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
/// `total_collateral`, `senior_debt_coverage`, and per-loan `collateral` / `ltv`
/// are always `null` for now — see the DTO docs (TODO #706: no price source).
///
/// Public so the compute-layer test in `packages/api/tests/loan_book.rs` can
/// exercise it without the HTTP/DB layers.
pub fn compute_loan_book(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    to: i64,
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

        entries.push(LoanBookEntry {
            originator: s.originator.clone(),
            borrower: s.borrower_id.clone(),
            commodity: s.commodity.clone(),
            principal: base6_to_decimal_string(&principal),
            // TODO #706: collateral value (qty × current price) — no source yet.
            collateral: None,
            // TODO #706: ltv = principal / collateral — null while collateral null.
            ltv: None,
            duration_days,
            rate,
            // Protection instrument from the loan metadata; empty string ⇒ null.
            protection: (!s.protection.is_empty()).then(|| s.protection.clone()),
            status: s.status.clone(),
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

    LoanBookResponse {
        summary: LoanBookSummary {
            total_deployed: base6_to_decimal_string(&total_deployed),
            // TODO #706: total_collateral = Σ (collateral qty × current price) — no source yet.
            total_collateral: None,
            // TODO #706: senior_debt_coverage = total_collateral / Σ senior_tranche.
            senior_debt_coverage: None,
            avg_yield: Some(avg_yield),
            avg_duration_days,
        },
        loans: entries,
    }
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
        },
        loans: vec![],
    }
}
