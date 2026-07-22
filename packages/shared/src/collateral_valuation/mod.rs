//! Commodity collateral valuation — the off-chain math behind a loan's collateral
//! value and CCR, per [`docs/product-specs/collateral-valuation.md`].
//!
//! Lives in `shared` because both sides need it without crossing the layering
//! boundary: the worker (relayer) recomputes on every price tick for monitoring,
//! and the API recomputes on read for the dashboard (there is no cached state
//! table — see the collateral-valuation exec plan).
//!
//! Two valuation modes produce a `collateral_value`, from which CCR is derived:
//!
//! - **Standard goods** (refined metal, grain, exchange-deliverable material):
//!   `collateral_value = reference_price * quantity * (1 - haircut)`.
//! - **Metal concentrate** (e.g. gold-pyrite): the Net Smelter Return waterfall —
//!   payable metal, less treatment/refining charges and penalties, less
//!   realisation costs, then the haircut.
//!
//! This module is **pure** (no I/O, no DB): it takes typed inputs and returns
//! numbers, so it is unit-testable against the spec's worked example. Loading the
//! inputs from the valuation tables and persisting/serving the results are the
//! callers' concern.
//!
//! All monetary/quantity inputs are [`BigDecimal`] to match the rest of the
//! codebase's fixed-point money math and avoid binary-float drift.

use std::str::FromStr;

use bigdecimal::{BigDecimal, RoundingMode, ToPrimitive, Zero};

use crate::collateral_valuation_repo::{AssayRow, CollateralValuationRow, OfftakeTermsRow, ValuationMode};

/// Grams per troy ounce — converts a grade in g/t over a tonnage into troy ounces
/// (`grade_g_per_t * tonnes / 31.1035`). Precious-metal prices are quoted per troy oz.
fn grams_per_troy_oz() -> BigDecimal {
    BigDecimal::from_str("31.1035").expect("31.1035 is a valid decimal literal")
}

// ── Inputs ─────────────────────────────────────────────────────────────────────

/// One payable metal line in a concentrate (e.g. gold, silver). Grades come from
/// the assay; payable terms and the refining charge from the signed offtake; the
/// price from the feed.
#[derive(Debug, Clone)]
pub struct PayableMetal {
    /// Assay grade in grams per tonne.
    pub grade_g_per_t: BigDecimal,
    /// Payable fraction from the offtake, e.g. `0.80` for 80 %.
    pub payable_pct: BigDecimal,
    /// Minimum deduction in g/t applied before the payable fraction pays out.
    pub min_deduction_g_per_t: BigDecimal,
    /// Headline reference price in US$ per troy ounce.
    pub reference_price: BigDecimal,
    /// Refining charge in US$ per payable troy ounce.
    pub rc_per_oz: BigDecimal,
}

/// A penalty schedule tier for a deleterious element (e.g. arsenic). Charged per
/// dry tonne for each `step_pct` the assayed `level_pct` exceeds `threshold_pct`.
#[derive(Debug, Clone)]
pub struct PenaltyTier {
    /// Assayed level of the element, in percent.
    pub level_pct: BigDecimal,
    /// Offtake threshold below which no penalty applies, in percent.
    pub threshold_pct: BigDecimal,
    /// Increment of excess that triggers one unit of `rate_per_dmt`, in percent.
    pub step_pct: BigDecimal,
    /// US$ per dry tonne charged for each `step_pct` of excess.
    pub rate_per_dmt: BigDecimal,
}

/// Inputs for the metal-concentrate (NSR) valuation mode.
#[derive(Debug, Clone)]
pub struct ConcentrateInputs {
    /// Current collateral quantity in dry metric tonnes (original less delivered).
    pub quantity_dmt: BigDecimal,
    /// Payable metals in the concentrate.
    pub metals: Vec<PayableMetal>,
    /// Treatment charge in US$ per dry tonne.
    pub treatment_charge_per_dmt: BigDecimal,
    /// Penalty tiers for deleterious elements.
    pub penalties: Vec<PenaltyTier>,
    /// Seller's realisation costs (freight, insurance, superintendence, marketing).
    pub realisation_costs: BigDecimal,
    /// Commodity haircut from the credit framework, e.g. `0.40` for 40 %.
    pub haircut: BigDecimal,
}

/// Inputs for the standard-goods valuation mode.
#[derive(Debug, Clone)]
pub struct StandardGoodsInputs {
    /// Headline reference price per unit of quantity.
    pub reference_price: BigDecimal,
    /// Current collateral quantity in the price's unit.
    pub quantity: BigDecimal,
    /// Commodity haircut from the credit framework, e.g. `0.10` for 10 %.
    pub haircut: BigDecimal,
}

// ── Outputs ──────────────────────────────────────────────────────────────────

/// The concentrate waterfall, broken out so callers can persist and display each
/// line (matching the spec's worked-example table).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConcentrateValuation {
    /// Σ over metals of `payable_oz * reference_price`.
    pub gross_value: BigDecimal,
    /// Σ over metals of `payable_oz * rc_per_oz`.
    pub refining_charge: BigDecimal,
    /// `treatment_charge_per_dmt * quantity_dmt`.
    pub treatment_charge: BigDecimal,
    /// Σ over tiers of the per-dmt penalty times quantity.
    pub penalties: BigDecimal,
    /// Net Smelter Return: gross less treatment, refining, and penalties.
    pub nsr: BigDecimal,
    /// NSR less the seller's realisation costs.
    pub mine_gate_value: BigDecimal,
    /// Mine-gate value after the haircut — the value used for CCR.
    pub collateral_value: BigDecimal,
}

// ── Valuation ────────────────────────────────────────────────────────────────

impl StandardGoodsInputs {
    /// Standard-goods collateral value: `reference_price * quantity * (1 - haircut)`.
    pub fn collateral_value(&self) -> BigDecimal {
        let one_minus_haircut = BigDecimal::from(1) - &self.haircut;
        &self.reference_price * &self.quantity * one_minus_haircut
    }
}

impl ConcentrateInputs {
    /// Metal-concentrate valuation: the Net Smelter Return waterfall.
    ///
    /// Per metal: `payable_oz = (grade * payable_pct - min_deduction) * quantity / 31.1035`.
    /// Gross value and refining charge sum across metals; treatment charge and penalties
    /// are cargo-level fixed dollars; then realisation costs and the haircut apply.
    pub fn valuate(&self) -> ConcentrateValuation {
        let g_per_oz = grams_per_troy_oz();

        let mut gross_value = BigDecimal::zero();
        let mut refining_charge = BigDecimal::zero();
        for m in &self.metals {
            let payable_grade = &m.grade_g_per_t * &m.payable_pct - &m.min_deduction_g_per_t;
            let payable_mass = &payable_grade * &self.quantity_dmt;
            let payable_oz = payable_mass / &g_per_oz;
            gross_value += &payable_oz * &m.reference_price;
            refining_charge += &payable_oz * &m.rc_per_oz;
        }

        let treatment_charge = &self.treatment_charge_per_dmt * &self.quantity_dmt;

        let mut penalties = BigDecimal::zero();
        for p in &self.penalties {
            let excess = &p.level_pct - &p.threshold_pct;
            let steps = (excess / &p.step_pct).max(BigDecimal::zero());
            penalties += steps * &p.rate_per_dmt * &self.quantity_dmt;
        }

        let nsr = &gross_value - &treatment_charge - &refining_charge - &penalties;
        let mine_gate_value = &nsr - &self.realisation_costs;
        let one_minus_haircut = BigDecimal::from(1) - &self.haircut;
        let collateral_value = &mine_gate_value * one_minus_haircut;

        ConcentrateValuation {
            gross_value,
            refining_charge,
            treatment_charge,
            penalties,
            nsr,
            mine_gate_value,
            collateral_value,
        }
    }
}

impl ConcentrateValuation {
    /// CCR in basis points for this valuation against its outstanding senior
    /// principal. Convenience wrapper over [`ccr_bps`].
    pub fn ccr_bps(&self, outstanding_senior_principal: &BigDecimal) -> u32 {
        ccr_bps(&self.collateral_value, outstanding_senior_principal)
    }
}

/// CCR in basis points: `collateral_value / outstanding_senior_principal`, where
/// `14000` means 140 %. Mode-agnostic primitive — both valuation modes feed it, so
/// it stays a free function rather than a method on either input type. Returns `0`
/// when the principal is non-positive or the collateral value is non-positive (an
/// underwater loan has no meaningful CCR).
///
/// Both amounts must be in the **same unit** before calling: collateral value comes
/// out in plain USD, so a base-6 USDC senior principal must be scaled to USD first.
pub fn ccr_bps(collateral_value: &BigDecimal, outstanding_senior_principal: &BigDecimal) -> u32 {
    let zero = BigDecimal::zero();
    if outstanding_senior_principal <= &zero || collateral_value <= &zero {
        return 0;
    }
    let bps = (collateral_value / outstanding_senior_principal) * BigDecimal::from(10_000);
    bps.with_scale_round(0, RoundingMode::HalfUp)
        .to_u32()
        .unwrap_or(u32::MAX)
}

// ── Assembly from stored valuation-record rows ─────────────────────────────────

/// The result of valuing a loan from its stored record. `concentrate` carries the
/// full waterfall for `MetalConcentrate` loans (`None` for standard goods).
#[derive(Debug, Clone)]
pub struct CollateralComputation {
    /// Collateral value in USD.
    pub collateral_value: BigDecimal,
    /// The NSR waterfall, present only for concentrate loans.
    pub concentrate: Option<ConcentrateValuation>,
}

/// Value a loan's collateral from its stored record rows and the latest reference
/// price, dispatching on the anchor's valuation mode. Quantity is read straight off
/// the anchor (`anchor.quantity_dmt`) — it is authored once at submission time
/// alongside the rest of the anchor, unlike assay/offtake which are append-only and
/// may not have arrived yet.
///
/// Returns `Ok(None)` when a required input for the mode is missing (concentrate
/// needs assay + offtake + price; standard goods needs price only), so callers can
/// surface "unpriced" without an error. `Err` only for malformed stored numbers (a
/// data-integrity problem).
///
/// The single reference price is applied to every payable metal — correct for a
/// single-metal concentrate; multi-metal per-metal feeds are a follow-up.
pub fn compute_collateral(
    anchor: &CollateralValuationRow,
    assay: Option<&AssayRow>,
    offtake: Option<&OfftakeTermsRow>,
    reference_price: Option<&BigDecimal>,
) -> anyhow::Result<Option<CollateralComputation>> {
    match anchor.valuation_mode {
        ValuationMode::MetalConcentrate => {
            let (Some(assay), Some(offtake), Some(price)) = (assay, offtake, reference_price)
            else {
                return Ok(None);
            };
            let valuation = ConcentrateInputs {
                quantity_dmt: anchor.quantity_dmt.clone(),
                metals: assemble_metals(assay, offtake, price)?,
                treatment_charge_per_dmt: offtake.treatment_charge_per_dmt.clone(),
                penalties: assemble_penalties(assay, offtake)?,
                realisation_costs: offtake.realisation_costs.clone(),
                haircut: anchor.haircut_pct.clone(),
            }
            .valuate();
            Ok(Some(CollateralComputation {
                collateral_value: valuation.collateral_value.clone(),
                concentrate: Some(valuation),
            }))
        }
        ValuationMode::StandardGoods => {
            let Some(price) = reference_price else {
                return Ok(None);
            };
            let collateral_value = StandardGoodsInputs {
                reference_price: price.clone(),
                quantity: anchor.quantity_dmt.clone(),
                haircut: anchor.haircut_pct.clone(),
            }
            .collateral_value();
            Ok(Some(CollateralComputation {
                collateral_value,
                concentrate: None,
            }))
        }
    }
}

/// Parse a stored JSON decimal string, tagging the field on failure.
fn dec(field: &str, value: &str) -> anyhow::Result<BigDecimal> {
    BigDecimal::from_str(value)
        .map_err(|e| anyhow::anyhow!("collateral valuation field `{field}` = `{value}`: {e}"))
}

/// Join offtake payable terms with assay grades and refining charges. A metal
/// absent from the assay/refining list defaults to grade/charge 0.
fn assemble_metals(
    assay: &AssayRow,
    offtake: &OfftakeTermsRow,
    reference_price: &BigDecimal,
) -> anyhow::Result<Vec<PayableMetal>> {
    offtake
        .payable_terms
        .0
        .iter()
        .map(|term| {
            let grade = assay
                .assays
                .0
                .iter()
                .find(|m| m.metal == term.metal)
                .map_or("0", |m| m.grade_g_per_t.as_str());
            let rc = offtake
                .refining_charges
                .0
                .iter()
                .find(|r| r.metal == term.metal)
                .map_or("0", |r| r.rc_per_oz.as_str());
            Ok(PayableMetal {
                grade_g_per_t: dec("grade_g_per_t", grade)?,
                payable_pct: dec("payable_pct", &term.payable_pct)?,
                min_deduction_g_per_t: dec("min_deduction_g_per_t", &term.min_deduction_g_per_t)?,
                reference_price: reference_price.clone(),
                rc_per_oz: dec("rc_per_oz", rc)?,
            })
        })
        .collect()
}

/// Join the offtake penalty schedule with assayed deleterious levels. A tier whose
/// element is not in the assay gets level 0 (no penalty); `Ppm` levels convert to
/// percent to match the pct-based schedule.
fn assemble_penalties(
    assay: &AssayRow,
    offtake: &OfftakeTermsRow,
) -> anyhow::Result<Vec<PenaltyTier>> {
    offtake
        .penalty_schedule
        .0
        .iter()
        .map(|tier| {
            let level_pct = match assay
                .deleterious
                .0
                .iter()
                .find(|d| d.element == tier.element)
            {
                Some(d) => {
                    let level = dec("deleterious.level", &d.level)?;
                    if d.unit == "Ppm" {
                        level / BigDecimal::from(10_000)
                    } else {
                        level
                    }
                }
                None => BigDecimal::zero(),
            };
            Ok(PenaltyTier {
                level_pct,
                threshold_pct: dec("penalty.threshold", &tier.threshold)?,
                step_pct: dec("penalty.step", &tier.step)?,
                rate_per_dmt: dec("penalty.rate_per_dmt", &tier.rate_per_dmt)?,
            })
        })
        .collect()
}
