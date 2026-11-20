// spec: docs/product-specs/collateral-valuation.md#per-loan-valuation-record

use std::collections::HashMap;
use std::str::FromStr;

use bigdecimal::{BigDecimal, Zero};
use chrono::Utc;
use shared::collateral_valuation::{
    asset_for_metal, compute_collateral, nsr_per_dmt, same_name, ConcentrateValuation,
};
use shared::collateral_valuation_repo::{
    AssayMetalJson, AssayRow, CollateralValuationRow, DeleteriousJson, OfftakeTermsRow,
    PayableTermJson, PenaltyTierJson, RefiningChargeJson, ValuationMode,
};
use sqlx::types::Json;

fn bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).expect("valid decimal literal")
}

fn prices() -> HashMap<String, BigDecimal> {
    HashMap::from([("XAU".to_owned(), bd("4200")), ("XAG".to_owned(), bd("50"))])
}

fn anchor() -> CollateralValuationRow {
    CollateralValuationRow {
        chain_id: 1,
        loan_id: BigDecimal::from(1),
        submitted_loan_id: 1,
        commodity: "gold_pyrite_concentrate".to_owned(),
        valuation_mode: ValuationMode::MetalConcentrate,
        asset: "XAU".to_owned(),
        price_provider: "metalpriceapi".to_owned(),
        haircut_pct: bd("0.40"),
        quantity_dmt: bd("100"),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn assay(gold: &str, silver: &str, arsenic: &str) -> AssayRow {
    AssayRow {
        id: 1,
        chain_id: 1,
        loan_id: BigDecimal::from(1),
        assay_status: "Final".to_owned(),
        moisture_pct: None,
        assays: Json(vec![
            AssayMetalJson {
                metal: gold.to_owned(),
                grade_g_per_t: "50".to_owned(),
            },
            AssayMetalJson {
                metal: silver.to_owned(),
                grade_g_per_t: "200".to_owned(),
            },
        ]),
        deleterious: Json(vec![DeleteriousJson {
            element: arsenic.to_owned(),
            level: "2.0".to_owned(),
            unit: "Pct".to_owned(),
        }]),
        certificate_uri: None,
        effective_at: Utc::now(),
        recorded_by: "test".to_owned(),
        created_at: Utc::now(),
    }
}

fn offtake(gold: &str, silver: &str, rc_gold: &str, arsenic: &str) -> OfftakeTermsRow {
    OfftakeTermsRow {
        id: 1,
        chain_id: 1,
        loan_id: BigDecimal::from(1),
        payable_terms: Json(vec![
            PayableTermJson {
                metal: gold.to_owned(),
                payable_pct: "0.80".to_owned(),
                min_deduction_g_per_t: "1".to_owned(),
            },
            PayableTermJson {
                metal: silver.to_owned(),
                payable_pct: "0.90".to_owned(),
                min_deduction_g_per_t: "5".to_owned(),
            },
        ]),
        treatment_charge_per_dmt: bd("220"),
        refining_charges: Json(vec![RefiningChargeJson {
            metal: rc_gold.to_owned(),
            rc_per_oz: "6".to_owned(),
        }]),
        penalty_schedule: Json(vec![PenaltyTierJson {
            element: arsenic.to_owned(),
            threshold: "0.2".to_owned(),
            step: "0.1".to_owned(),
            unit: "Pct".to_owned(),
            rate_per_dmt: "5".to_owned(),
            escalating: false,
        }]),
        realisation_costs: bd("12000"),
        quotational_period: None,
        pricing_reference: None,
        incoterm: None,
        effective_at: Utc::now(),
        recorded_by: "test".to_owned(),
        created_at: Utc::now(),
    }
}

fn waterfall(assay: &AssayRow, offtake: &OfftakeTermsRow) -> ConcentrateValuation {
    compute_collateral(&anchor(), Some(assay), Some(offtake), &prices())
        .expect("valuation should not error")
        .expect("metals priced")
        .concentrate
        .expect("concentrate waterfall present")
}

fn lower() -> (AssayRow, OfftakeTermsRow) {
    (
        assay("gold", "silver", "arsenic"),
        offtake("gold", "silver", "gold", "arsenic"),
    )
}

fn mixed() -> (AssayRow, OfftakeTermsRow) {
    (
        assay("gold", "silver", "arsenic"),
        offtake("Gold", "SILVER", " gold ", "Arsenic"),
    )
}

#[test]
fn same_name_ignores_case_and_surrounding_whitespace() {
    assert!(same_name("Gold", "gold"));
    assert!(same_name(" gold ", "GOLD"));
    assert!(same_name("Arsenic", "arsenic"));
    assert!(!same_name("gold", "silver"));
    assert!(!same_name("gold", "golden"));
}

#[test]
fn asset_for_metal_trims_before_matching() {
    assert_eq!(asset_for_metal(" Gold "), Some("XAU"));
    assert_eq!(asset_for_metal("\tSILVER\n"), Some("XAG"));
    assert_eq!(asset_for_metal("copper"), None);
}

#[test]
fn mixed_case_names_value_the_same_as_lowercase() {
    let (la, lo) = lower();
    let (ma, mo) = mixed();
    let base = waterfall(&la, &lo);
    let got = waterfall(&ma, &mo);
    assert!(!got.refining_charge.is_zero());
    assert_eq!(got.gross_value, base.gross_value);
    assert_eq!(got.refining_charge, base.refining_charge);
    assert_eq!(got.collateral_value, base.collateral_value);
}

#[test]
fn mixed_case_penalty_element_matches_the_assayed_level() {
    let (la, lo) = lower();
    let (ma, mo) = mixed();
    let base = waterfall(&la, &lo).penalties;
    assert!(!base.is_zero());
    assert_eq!(waterfall(&ma, &mo).penalties, base);
}

#[test]
fn assay_side_case_differences_also_match() {
    let (la, lo) = lower();
    let a = assay(" GOLD", "Silver", "ARSENIC ");
    let base = waterfall(&la, &lo);
    let got = waterfall(&a, &lo);
    assert_eq!(got.gross_value, base.gross_value);
    assert_eq!(got.penalties, base.penalties);
}

#[test]
fn nsr_per_dmt_matches_across_spellings() {
    let (la, lo) = lower();
    let (ma, mo) = mixed();
    let base = nsr_per_dmt(&la, &lo, &prices()).unwrap().unwrap();
    let got = nsr_per_dmt(&ma, &mo, &prices()).unwrap().unwrap();
    assert_eq!(got, base);
}

#[test]
fn metal_absent_from_the_assay_still_gets_grade_zero() {
    let (la, mut lo) = lower();
    lo.payable_terms.0.push(PayableTermJson {
        metal: "platinum".to_owned(),
        payable_pct: "0.80".to_owned(),
        min_deduction_g_per_t: "0".to_owned(),
    });
    let mut p = prices();
    p.insert("XPT".to_owned(), bd("1000"));
    let with_platinum = compute_collateral(&anchor(), Some(&la), Some(&lo), &p)
        .unwrap()
        .unwrap()
        .concentrate
        .unwrap();
    let base = waterfall(&la, &offtake("gold", "silver", "gold", "arsenic"));
    assert_eq!(with_platinum.gross_value, base.gross_value);
}

#[test]
fn case_duplicate_payable_terms_value_like_the_first_occurrence() {
    let (la, mut lo) = lower();
    let base = waterfall(&la, &lo);
    let dup = lo.payable_terms.0[0].clone();
    lo.payable_terms.0.insert(
        1,
        PayableTermJson {
            metal: "Gold".to_owned(),
            ..dup
        },
    );
    let got = waterfall(&la, &lo);
    assert_eq!(got.gross_value, base.gross_value);
    assert_eq!(got.refining_charge, base.refining_charge);
    assert_eq!(got.collateral_value, base.collateral_value);
}
