//! Read access to the per-loan collateral valuation record
//! (docs/product-specs/collateral-valuation.md).
//!
//! One aggregate spread over three tables, all keyed by `(chain_id, loan_id)`:
//!
//! - `loan_collateral_valuations`         — the anchor (mode, commodity, asset, provider,
//!   haircut, quantity), authored once at loan-submission time
//! - `loan_assays`             — append-only lab assays; the latest by `effective_at`
//! - `loan_offtake_terms`      — append-only offtake terms; the latest by `effective_at`
//!
//! This repo is mostly **read-only**: besides `insert_pending` (called from the
//! submission endpoint's transaction), it fetches the current inputs so a caller (the
//! API read, or the worker recompute) can assemble [`crate::collateral_valuation`]
//! inputs and recompute collateral value / CCR on demand.
//!
//! JSONB array columns are decoded into typed rows whose numeric fields are
//! **decimal strings** — the codebase convention for JSON-encoded numbers (see
//! [`crate::json_numeric`]). Callers parse them into `BigDecimal` at assembly time,
//! where a malformed value gets field-tagged error context.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use sqlx::{PgConnection, PgPool};
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

/// One row of `loan_collateral_valuations` (the anchor), joined against its
/// `submitted_loans` parent.
///
/// The table itself is keyed by `submitted_loan_id` only — `chain_id`/`loan_id` are
/// not physical columns here, they live on `submitted_loans` (set once by
/// `link_drawn` when the loan is drawn on-chain). `get_anchor`/`all_anchors` join
/// through that pointer and bind a concrete `chain_id`, so the rows they return are
/// always on-chain-linked; a submission-authored anchor whose loan hasn't been
/// linked yet simply isn't visible through this lookup until it is.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CollateralValuationRow {
    pub chain_id: i64,
    pub loan_id: BigDecimal,
    /// The originating `submitted_loans` row.
    pub submitted_loan_id: i64,
    pub commodity: String,
    /// Decoded from the TEXT column into the typed enum.
    #[sqlx(try_from = "String")]
    pub valuation_mode: ValuationMode,
    pub asset: String,
    pub price_provider: String,
    pub haircut_pct: BigDecimal,
    /// Current collateral quantity in dry metric tonnes (original less delivered),
    /// authored once at submission time alongside the rest of the anchor.
    pub quantity_dmt: BigDecimal,
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

/// A distinct `(asset, price_provider)` pairing across all valuation anchors.
///
/// Consumed by the worker `asset_price_collector`, which collects a price series per
/// pair. An asset configured with more than one provider yields multiple rows (one per
/// provider); the collector detects that conflict and skips the asset rather than
/// guessing which provider to trust.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct AssetProvider {
    pub asset: String,
    pub price_provider: String,
}

// ── Repo ───────────────────────────────────────────────────────────────────────

pub struct CollateralValuationRepo {
    pub pool: PgPool,
}

impl CollateralValuationRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert a valuation anchor authored by a loan-book submission, keyed by
    /// `submitted_loan_id`. Reachable via `get_anchor`/`all_anchors` only once the
    /// loan is drawn on-chain and `submitted_loans.chain_id`/`loan_id` are set by
    /// `SubmittedLoanRepo::link_drawn`.
    ///
    /// Takes a caller-supplied connection so it runs inside the submission endpoint's
    /// transaction, atomically with the `submitted_loans` insert.
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_pending(
        conn: &mut PgConnection,
        submitted_loan_id: i64,
        commodity: &str,
        valuation_mode: ValuationMode,
        asset: &str,
        price_provider: &str,
        haircut_pct: &BigDecimal,
        quantity_dmt: &BigDecimal,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO loan_collateral_valuations \
                (submitted_loan_id, commodity, valuation_mode, asset, price_provider, \
                 haircut_pct, quantity_dmt) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(submitted_loan_id)
        .bind(commodity)
        .bind(valuation_mode.as_str())
        .bind(asset)
        .bind(price_provider)
        .bind(haircut_pct)
        .bind(quantity_dmt)
        .execute(conn)
        .await?;
        Ok(())
    }

    /// The valuation anchor for a loan, or `None` if the loan has no anchor yet.
    pub async fn get_anchor(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<Option<CollateralValuationRow>, sqlx::Error> {
        sqlx::query_as::<_, CollateralValuationRow>(
            "SELECT sl.chain_id, sl.loan_id, lcv.submitted_loan_id, lcv.commodity, \
                    lcv.valuation_mode, lcv.asset, lcv.price_provider, lcv.haircut_pct, \
                    lcv.quantity_dmt, lcv.created_at, lcv.updated_at \
             FROM loan_collateral_valuations lcv \
             JOIN submitted_loans sl ON sl.id = lcv.submitted_loan_id \
             WHERE sl.chain_id = $1 AND sl.loan_id = $2",
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

    // ── Bulk loaders (chain-scoped) — for valuing every loan in the loan book ──

    /// Every valuation anchor on a chain.
    pub async fn all_anchors(
        &self,
        chain_id: i64,
    ) -> Result<Vec<CollateralValuationRow>, sqlx::Error> {
        sqlx::query_as::<_, CollateralValuationRow>(
            "SELECT sl.chain_id, sl.loan_id, lcv.submitted_loan_id, lcv.commodity, \
                    lcv.valuation_mode, lcv.asset, lcv.price_provider, lcv.haircut_pct, \
                    lcv.quantity_dmt, lcv.created_at, lcv.updated_at \
             FROM loan_collateral_valuations lcv \
             JOIN submitted_loans sl ON sl.id = lcv.submitted_loan_id \
             WHERE sl.chain_id = $1",
        )
        .bind(chain_id)
        .fetch_all(&self.pool)
        .await
    }

    /// The distinct set of `(asset, price_provider)` pairs across **all** valuation
    /// anchors, on every chain. Not chain-scoped: the worker `asset_price_collector`
    /// collects one price series per pair regardless of which chain's loans reference
    /// it, so an asset priced on two chains is still collected once.
    pub async fn distinct_asset_providers(&self) -> Result<Vec<AssetProvider>, sqlx::Error> {
        sqlx::query_as::<_, AssetProvider>(
            "SELECT DISTINCT asset, price_provider FROM loan_collateral_valuations \
             ORDER BY asset, price_provider",
        )
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
    pub async fn latest_offtakes(
        &self,
        chain_id: i64,
    ) -> Result<Vec<OfftakeTermsRow>, sqlx::Error> {
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

}
