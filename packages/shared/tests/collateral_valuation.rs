//! Tests for the collateral valuation math, anchored on the gold-pyrite worked
//! example in `docs/product-specs/collateral-valuation.md`.

use std::collections::HashMap;
use std::str::FromStr;

use bigdecimal::{BigDecimal, ToPrimitive};
use chrono::Utc;
use shared::collateral_valuation::{
    asset_for_metal, ccr_bps, compute_collateral, ConcentrateInputs, PayableMetal, PenaltyTier,
    StandardGoodsInputs,
};
use shared::collateral_valuation_repo::{
    AssayMetalJson, AssayRow, CollateralValuationRow, OfftakeTermsRow, PayableTermJson,
    RefiningChargeJson, ValuationMode,
};
use sqlx::types::Json;

fn bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).expect("valid decimal literal")
}

fn prices(pairs: &[(&str, &str)]) -> HashMap<String, BigDecimal> {
    pairs
        .iter()
        .map(|(a, p)| ((*a).to_owned(), bd(p)))
        .collect()
}

/// Assert `value` is within `tol` dollars of `expected`.
fn approx(value: &BigDecimal, expected: f64, tol: f64) {
    let got = value.to_f64().expect("value fits in f64");
    assert!(
        (got - expected).abs() < tol,
        "expected ~{expected}, got {got} (tol {tol})"
    );
}

/// The spec's worked example: 100 dmt @ 50 g/t gold, 2% arsenic, gold $4,000/oz.
/// Offtake: payable 80%, min deduction 1 g/t, TC $220/dmt, RC $6/payable oz,
/// arsenic penalty $5/dmt per 0.1% above 0.2%; realisation $12,000; haircut 40%.
fn gold_pyrite_example() -> ConcentrateInputs {
    ConcentrateInputs {
        quantity_dmt: bd("100"),
        metals: vec![PayableMetal {
            grade_g_per_t: bd("50"),
            payable_pct: bd("0.80"),
            min_deduction_g_per_t: bd("1"),
            reference_price: bd("4000"),
            rc_per_oz: bd("6"),
        }],
        treatment_charge_per_dmt: bd("220"),
        penalties: vec![PenaltyTier {
            level_pct: bd("2.0"),
            threshold_pct: bd("0.2"),
            step_pct: bd("0.1"),
            rate_per_dmt: bd("5"),
        }],
        realisation_costs: bd("12000"),
        haircut: bd("0.40"),
    }
}

#[test]
fn concentrate_matches_spec_worked_example() {
    let v = gold_pyrite_example().valuate();

    // Spec table lines. The spec rounds intermediate ounces to 125.4 oz; this
    // module keeps full precision (payable ≈ 125.3859 oz), so the figures land a
    // few tens of dollars below the spec's rounded table — well within $100.
    approx(&v.treatment_charge, 22_000.0, 0.01);
    approx(&v.penalties, 9_000.0, 0.01);
    approx(&v.refining_charge, 752.0, 1.0);
    approx(&v.nsr, 469_848.0, 100.0);
    approx(&v.mine_gate_value, 457_848.0, 100.0);
    approx(&v.collateral_value, 274_709.0, 100.0);
}

#[test]
fn concentrate_ccr_is_137_percent() {
    let v = gold_pyrite_example().valuate();
    let bps = v.ccr_bps(&bd("200000"));
    // Spec: 274,709 / 200,000 = 137%. Full-precision collateral gives the same 137%.
    assert_eq!(bps / 100, 137, "CCR should read 137% (got {bps} bps)");
}

#[test]
fn fixed_charges_make_collateral_fall_faster_than_price() {
    // Halving the gold price more than halves collateral value, because the
    // treatment/refining/penalty/realisation dollars are fixed.
    let base = gold_pyrite_example().valuate();

    let mut cheaper = gold_pyrite_example();
    cheaper.metals[0].reference_price = bd("2000");
    let low = cheaper.valuate();

    let base_cv = base.collateral_value.to_f64().unwrap();
    let low_cv = low.collateral_value.to_f64().unwrap();
    assert!(
        low_cv < base_cv / 2.0,
        "collateral at half price ({low_cv}) should be below half of base ({base_cv})"
    );
}

#[test]
fn standard_goods_applies_price_quantity_haircut() {
    // 4000/oz * 160.75 oz * (1 - 0.10) = 578,700.
    let inputs = StandardGoodsInputs {
        reference_price: bd("4000"),
        quantity: bd("160.75"),
        haircut: bd("0.10"),
    };
    approx(&inputs.collateral_value(), 578_700.0, 0.01);
}

#[test]
fn ccr_guards_non_positive_inputs() {
    assert_eq!(ccr_bps(&bd("100000"), &bd("0")), 0);
    assert_eq!(ccr_bps(&bd("-5"), &bd("100000")), 0);
    assert_eq!(ccr_bps(&bd("0"), &bd("100000")), 0);
}

// ── Per-metal reference prices (issue #964) ────────────────────────────────────

#[test]
fn asset_for_metal_maps_known_metals_case_insensitively() {
    assert_eq!(asset_for_metal("gold"), Some("XAU"));
    assert_eq!(asset_for_metal("GOLD"), Some("XAU"));
    assert_eq!(asset_for_metal("Silver"), Some("XAG"));
    assert_eq!(asset_for_metal("platinum"), Some("XPT"));
    assert_eq!(asset_for_metal("palladium"), Some("XPD"));
    assert_eq!(asset_for_metal("unobtanium"), None);
}

/// A gold-pyrite concentrate anchor with a payable silver credit, mirroring the issue's
/// first deal. `haircut` and `quantity_dmt` are parameters so callers can vary them.
fn concentrate_anchor() -> CollateralValuationRow {
    CollateralValuationRow {
        chain_id: 1,
        loan_id: BigDecimal::from(1),
        submitted_loan_id: 1,
        commodity: "gold_pyrite_concentrate".to_owned(),
        valuation_mode: ValuationMode::MetalConcentrate,
        // Headline asset is gold; silver is priced by its own asset (XAG).
        asset: "XAU".to_owned(),
        price_provider: "metalpriceapi".to_owned(),
        haircut_pct: bd("0.40"),
        quantity_dmt: bd("100"),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn assay_gold_silver() -> AssayRow {
    AssayRow {
        id: 1,
        chain_id: 1,
        loan_id: BigDecimal::from(1),
        assay_status: "Final".to_owned(),
        moisture_pct: None,
        assays: Json(vec![
            AssayMetalJson {
                metal: "gold".to_owned(),
                grade_g_per_t: "50".to_owned(),
            },
            AssayMetalJson {
                metal: "silver".to_owned(),
                grade_g_per_t: "200".to_owned(),
            },
        ]),
        deleterious: Json(vec![]),
        certificate_uri: None,
        effective_at: Utc::now(),
        recorded_by: "test".to_owned(),
        created_at: Utc::now(),
    }
}

fn offtake_gold_silver() -> OfftakeTermsRow {
    OfftakeTermsRow {
        id: 1,
        chain_id: 1,
        loan_id: BigDecimal::from(1),
        payable_terms: Json(vec![
            PayableTermJson {
                metal: "gold".to_owned(),
                payable_pct: "0.80".to_owned(),
                min_deduction_g_per_t: "1".to_owned(),
            },
            PayableTermJson {
                metal: "silver".to_owned(),
                payable_pct: "0.90".to_owned(),
                min_deduction_g_per_t: "5".to_owned(),
            },
        ]),
        treatment_charge_per_dmt: bd("220"),
        refining_charges: Json(vec![
            RefiningChargeJson {
                metal: "gold".to_owned(),
                rc_per_oz: "6".to_owned(),
            },
            RefiningChargeJson {
                metal: "silver".to_owned(),
                rc_per_oz: "0.5".to_owned(),
            },
        ]),
        penalty_schedule: Json(vec![]),
        realisation_costs: bd("12000"),
        quotational_period: None,
        pricing_reference: None,
        incoterm: None,
        effective_at: Utc::now(),
        recorded_by: "test".to_owned(),
        created_at: Utc::now(),
    }
}

#[test]
fn compute_collateral_prices_each_metal_by_its_own_asset() {
    // The core regression (issue #964): silver must be priced at XAG (50), not the gold
    // (XAU) price. gross = payable_oz_gold*4200 + payable_oz_silver*50.
    //   payable gold oz   = (50*0.80 - 1) * 100 / 31.1035 = 39*100/31.1035 ≈ 125.386
    //   payable silver oz = (200*0.90 - 5) * 100 / 31.1035 = 175*100/31.1035 ≈ 562.638
    //   gross ≈ 125.386*4200 + 562.638*50 ≈ 526_621 + 28_132 = 554_753
    let anchor = concentrate_anchor();
    let assay = assay_gold_silver();
    let offtake = offtake_gold_silver();

    let per_metal = compute_collateral(
        &anchor,
        Some(&assay),
        Some(&offtake),
        &prices(&[("XAU", "4200"), ("XAG", "50")]),
    )
    .expect("valuation should not error")
    .expect("all metals priced ⇒ Some");
    let waterfall = per_metal
        .concentrate
        .expect("concentrate waterfall present");
    approx(&waterfall.gross_value, 554_753.0, 50.0);

    // If silver were (wrongly) priced at the gold price, gross would balloon — the exact
    // bug the issue describes. Prove the correct result is strictly and materially lower.
    let buggy = compute_collateral(
        &anchor,
        Some(&assay),
        Some(&offtake),
        &prices(&[("XAU", "4200"), ("XAG", "4200")]),
    )
    .unwrap()
    .unwrap()
    .concentrate
    .unwrap();
    assert!(
        waterfall.gross_value < buggy.gross_value,
        "per-metal gross ({}) must be below the single-price (silver-at-gold) gross ({})",
        waterfall.gross_value,
        buggy.gross_value
    );
    // The silver term alone accounts for the gap: (4200-50) * ~562.6 oz ≈ 2.33M.
    approx(
        &(&buggy.gross_value - &waterfall.gross_value),
        2_334_948.0,
        500.0,
    );
}

#[test]
fn compute_collateral_unpriced_when_a_metal_price_is_missing() {
    // XAG absent ⇒ silver has no price ⇒ the whole loan reads unpriced (Ok(None)),
    // never silently mispriced.
    let out = compute_collateral(
        &concentrate_anchor(),
        Some(&assay_gold_silver()),
        Some(&offtake_gold_silver()),
        &prices(&[("XAU", "4200")]),
    )
    .expect("valuation should not error");
    assert!(out.is_none(), "missing XAG price ⇒ unpriced");
}

#[test]
fn compute_collateral_standard_goods_uses_anchor_asset() {
    let mut anchor = concentrate_anchor();
    anchor.valuation_mode = ValuationMode::StandardGoods;
    anchor.asset = "XAU".to_owned();
    anchor.haircut_pct = bd("0.10");
    anchor.quantity_dmt = bd("160.75");

    // 4000 * 160.75 * 0.90 = 578_700.
    let priced = compute_collateral(&anchor, None, None, &prices(&[("XAU", "4000")]))
        .unwrap()
        .expect("headline asset priced ⇒ Some");
    approx(&priced.collateral_value, 578_700.0, 0.01);
    assert!(priced.concentrate.is_none());

    // No price for the anchor's asset ⇒ unpriced.
    let unpriced = compute_collateral(&anchor, None, None, &prices(&[("XAG", "50")])).unwrap();
    assert!(unpriced.is_none());
}
