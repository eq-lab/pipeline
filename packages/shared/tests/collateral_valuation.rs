//! Tests for the collateral valuation math, anchored on the gold-pyrite worked
//! example in `docs/product-specs/collateral-valuation.md`.

use std::str::FromStr;

use bigdecimal::{BigDecimal, ToPrimitive};
use shared::collateral_valuation::{
    ccr_bps, ConcentrateInputs, PayableMetal, PenaltyTier, StandardGoodsInputs,
};

fn bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).expect("valid decimal literal")
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
