//! Read access to the per-loan collateral valuation record
//! (docs/product-specs/collateral-valuation.md).
//!
//! One aggregate spread over four tables, all keyed by `(chain_id, loan_id)`:
//!
//! - `loan_collateral_valuations`         — the anchor (mode, commodity, asset, provider, haircut)
//! - `loan_assays`             — append-only lab assays; the latest by `effective_at`
//! - `loan_offtake_terms`      — append-only offtake terms; the latest by `effective_at`
//! - `loan_quantity_reports`   — append-only trustee feed; the latest by `reported_at`
//!
//! This repo is **read-only**: it fetches the current inputs so a caller (the API
//! read, or the worker recompute) can assemble [`crate::collateral_valuation`] inputs and
//! recompute collateral value / CCR on demand. Writes arrive later with the
//! operator-input endpoints.
//!
//! JSONB array columns are decoded into typed rows whose numeric fields are
//! **decimal strings** — the codebase convention for JSON-encoded numbers (see
//! [`crate::json_numeric`]). Callers parse them into `BigDecimal` at assembly time,
//! where a malformed value gets field-tagged error context.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::types::Json;
use sqlx::PgPool;
use utoipa::ToSchema;

// ── Valuation mode ─────────────────────────────────────────────────────────────

/// Which valuation formula a loan uses. Stored as TEXT in
/// `loan_collateral_valuations.valuation_mode` (CHECK-constrained to these two
/// values); serializes to the same strings on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum ValuationMode {
    /// `collateral = reference_price * quantity * (1 - haircut)`.
    StandardGoods,
    /// Net Smelter Return waterfall (e.g. gold-pyrite concentrate).
    MetalConcentrate,
}

impl ValuationMode {
    /// The exact string stored in the DB and emitted on the wire.
    pub fn as_str(self) -> &'static str {
        match self {
            ValuationMode::StandardGoods => "StandardGoods",
            ValuationMode::MetalConcentrate => "MetalConcentrate",
        }
    }
}

/// Error decoding an unrecognised `valuation_mode` string from the DB.
#[derive(Debug, thiserror::Error)]
#[error("unknown valuation_mode `{0}` (expected StandardGoods or MetalConcentrate)")]
pub struct UnknownValuationMode(pub String);

impl TryFrom<String> for ValuationMode {
    type Error = UnknownValuationMode;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        match s.as_str() {
            "StandardGoods" => Ok(ValuationMode::StandardGoods),
            "MetalConcentrate" => Ok(ValuationMode::MetalConcentrate),
            _ => Err(UnknownValuationMode(s)),
        }
    }
}

// ── JSON element shapes (storage form: decimals as strings) ────────────────────

/// One payable-metal grade from the assay's `assays` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssayMetalJson {
    pub metal: String,
    pub grade_g_per_t: String,
}

/// One deleterious-element level from the assay's `deleterious` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteriousJson {
    pub element: String,
    pub level: String,
    /// `Pct` or `Ppm`.
    pub unit: String,
}

/// One metal's payable terms from the offtake's `payable_terms` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayableTermJson {
    pub metal: String,
    pub payable_pct: String,
    pub min_deduction_g_per_t: String,
}

/// One metal's refining charge from the offtake's `refining_charges` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefiningChargeJson {
    pub metal: String,
    pub rc_per_oz: String,
}

/// One tier from the offtake's `penalty_schedule` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PenaltyTierJson {
    pub element: String,
    pub threshold: String,
    pub step: String,
    pub rate_per_dmt: String,
    #[serde(default)]
    pub escalating: bool,
}

// ── Row structs ────────────────────────────────────────────────────────────────

/// One row of `loan_collateral_valuations` (the anchor).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CollateralValuationRow {
    pub chain_id: i64,
    pub loan_id: BigDecimal,
    pub commodity: String,
    /// Decoded from the TEXT column into the typed enum.
    #[sqlx(try_from = "String")]
    pub valuation_mode: ValuationMode,
    pub asset: String,
    pub price_provider: String,
    pub haircut_pct: BigDecimal,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// The latest row of `loan_assays` for a loan.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AssayRow {
    pub id: i64,
    pub chain_id: i64,
    pub loan_id: BigDecimal,
    /// `Provisional`, `Final`, or `UmpirePending`.
    pub assay_status: String,
    pub moisture_pct: Option<BigDecimal>,
    pub assays: Json<Vec<AssayMetalJson>>,
    pub deleterious: Json<Vec<DeleteriousJson>>,
    pub certificate_uri: Option<String>,
    pub effective_at: DateTime<Utc>,
    pub recorded_by: String,
    pub created_at: DateTime<Utc>,
}

/// The latest row of `loan_offtake_terms` for a loan.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OfftakeTermsRow {
    pub id: i64,
    pub chain_id: i64,
    pub loan_id: BigDecimal,
    pub payable_terms: Json<Vec<PayableTermJson>>,
    pub treatment_charge_per_dmt: BigDecimal,
    pub refining_charges: Json<Vec<RefiningChargeJson>>,
    pub penalty_schedule: Json<Vec<PenaltyTierJson>>,
    pub realisation_costs: BigDecimal,
    pub quotational_period: Option<String>,
    pub pricing_reference: Option<String>,
    pub incoterm: Option<String>,
    pub effective_at: DateTime<Utc>,
    pub recorded_by: String,
    pub created_at: DateTime<Utc>,
}

/// The latest row of `loan_quantity_reports` for a loan.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuantityReportRow {
    pub id: i64,
    pub chain_id: i64,
    pub loan_id: BigDecimal,
    pub quantity_dmt: BigDecimal,
    pub location: Option<Value>,
    pub reported_at: DateTime<Utc>,
    pub recorded_by: String,
    pub created_at: DateTime<Utc>,
}

// ── Repo ───────────────────────────────────────────────────────────────────────

pub struct CollateralValuationRepo {
    pub pool: PgPool,
}

impl CollateralValuationRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// The valuation anchor for a loan, or `None` if the loan has no anchor yet.
    pub async fn get_anchor(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<Option<CollateralValuationRow>, sqlx::Error> {
        sqlx::query_as::<_, CollateralValuationRow>(
            "SELECT chain_id, loan_id, commodity, valuation_mode, asset, price_provider, \
                    haircut_pct, created_at, updated_at \
             FROM loan_collateral_valuations WHERE chain_id = $1 AND loan_id = $2",
        )
        .bind(chain_id)
        .bind(loan_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// The most recent assay for a loan (by `effective_at`), or `None`.
    pub async fn latest_assay(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<Option<AssayRow>, sqlx::Error> {
        sqlx::query_as::<_, AssayRow>(
            "SELECT id, chain_id, loan_id, assay_status, moisture_pct, assays, deleterious, \
                    certificate_uri, effective_at, recorded_by, created_at \
             FROM loan_assays WHERE chain_id = $1 AND loan_id = $2 \
             ORDER BY effective_at DESC LIMIT 1",
        )
        .bind(chain_id)
        .bind(loan_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// The most recent offtake terms for a loan (by `effective_at`), or `None`.
    pub async fn latest_offtake(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<Option<OfftakeTermsRow>, sqlx::Error> {
        sqlx::query_as::<_, OfftakeTermsRow>(
            "SELECT id, chain_id, loan_id, payable_terms, treatment_charge_per_dmt, \
                    refining_charges, penalty_schedule, realisation_costs, quotational_period, \
                    pricing_reference, incoterm, effective_at, recorded_by, created_at \
             FROM loan_offtake_terms WHERE chain_id = $1 AND loan_id = $2 \
             ORDER BY effective_at DESC LIMIT 1",
        )
        .bind(chain_id)
        .bind(loan_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// The most recent quantity report for a loan (by `reported_at`), or `None`.
    pub async fn latest_quantity(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<Option<QuantityReportRow>, sqlx::Error> {
        sqlx::query_as::<_, QuantityReportRow>(
            "SELECT id, chain_id, loan_id, quantity_dmt, location, reported_at, recorded_by, \
                    created_at \
             FROM loan_quantity_reports WHERE chain_id = $1 AND loan_id = $2 \
             ORDER BY reported_at DESC LIMIT 1",
        )
        .bind(chain_id)
        .bind(loan_id)
        .fetch_optional(&self.pool)
        .await
    }

    // ── Bulk loaders (chain-scoped) — for valuing every loan in the loan book ──

    /// Every valuation anchor on a chain.
    pub async fn all_anchors(
        &self,
        chain_id: i64,
    ) -> Result<Vec<CollateralValuationRow>, sqlx::Error> {
        sqlx::query_as::<_, CollateralValuationRow>(
            "SELECT chain_id, loan_id, commodity, valuation_mode, asset, price_provider, \
                    haircut_pct, created_at, updated_at \
             FROM loan_collateral_valuations WHERE chain_id = $1",
        )
        .bind(chain_id)
        .fetch_all(&self.pool)
        .await
    }

    /// The latest assay per loan on a chain (one row per `loan_id`).
    pub async fn latest_assays(&self, chain_id: i64) -> Result<Vec<AssayRow>, sqlx::Error> {
        sqlx::query_as::<_, AssayRow>(
            "SELECT DISTINCT ON (loan_id) \
                    id, chain_id, loan_id, assay_status, moisture_pct, assays, deleterious, \
                    certificate_uri, effective_at, recorded_by, created_at \
             FROM loan_assays WHERE chain_id = $1 \
             ORDER BY loan_id, effective_at DESC",
        )
        .bind(chain_id)
        .fetch_all(&self.pool)
        .await
    }

    /// The latest offtake terms per loan on a chain (one row per `loan_id`).
    pub async fn latest_offtakes(&self, chain_id: i64) -> Result<Vec<OfftakeTermsRow>, sqlx::Error> {
        sqlx::query_as::<_, OfftakeTermsRow>(
            "SELECT DISTINCT ON (loan_id) \
                    id, chain_id, loan_id, payable_terms, treatment_charge_per_dmt, \
                    refining_charges, penalty_schedule, realisation_costs, quotational_period, \
                    pricing_reference, incoterm, effective_at, recorded_by, created_at \
             FROM loan_offtake_terms WHERE chain_id = $1 \
             ORDER BY loan_id, effective_at DESC",
        )
        .bind(chain_id)
        .fetch_all(&self.pool)
        .await
    }

    /// The latest quantity report per loan on a chain (one row per `loan_id`).
    pub async fn latest_quantities(
        &self,
        chain_id: i64,
    ) -> Result<Vec<QuantityReportRow>, sqlx::Error> {
        sqlx::query_as::<_, QuantityReportRow>(
            "SELECT DISTINCT ON (loan_id) \
                    id, chain_id, loan_id, quantity_dmt, location, reported_at, recorded_by, \
                    created_at \
             FROM loan_quantity_reports WHERE chain_id = $1 \
             ORDER BY loan_id, reported_at DESC",
        )
        .bind(chain_id)
        .fetch_all(&self.pool)
        .await
    }
}
