//! Unit tests for the assay/offtake submission validators
//! (`validate_assay`, `validate_offtake`). Pure — no HTTP/DB layer (matches the
//! project-wide convention: all tests in `tests/`, no live Postgres).

use std::collections::HashMap;

use bigdecimal::BigDecimal;
use chrono::Utc;
use pipeline_api::routes::collateral_valuation::build_response;
use pipeline_api::routes::collateral_valuation::{
    validate_assay, validate_offtake, AssayMetalInput, DeleteriousInput, PayableTermInput,
    PenaltyTierInput, RefiningChargeInput, SubmitAssayRequest, SubmitOfftakeRequest,
};
use shared::collateral_valuation_repo::{CollateralValuationRow, ValuationMode};

fn valid_assay() -> SubmitAssayRequest {
    SubmitAssayRequest {
        assay_status: "Final".to_owned(),
        moisture_pct: Some("8.5".to_owned()),
        assays: vec![AssayMetalInput {
            metal: "gold".to_owned(),
            grade_g_per_t: "50".to_owned(),
        }],
        deleterious: vec![DeleteriousInput {
            element: "arsenic".to_owned(),
            level: "2.0".to_owned(),
            unit: "Pct".to_owned(),
        }],
        certificate_uri: Some("ipfs://Qm_cert".to_owned()),
        effective_at: 1_700_000_000,
    }
}

fn valid_offtake() -> SubmitOfftakeRequest {
    SubmitOfftakeRequest {
        payable_terms: vec![PayableTermInput {
            metal: "gold".to_owned(),
            payable_pct: "0.80".to_owned(),
            min_deduction_g_per_t: "1".to_owned(),
        }],
        treatment_charge_per_dmt: "220".to_owned(),
        refining_charges: vec![RefiningChargeInput {
            metal: "gold".to_owned(),
            rc_per_oz: "6".to_owned(),
        }],
        penalty_schedule: vec![PenaltyTierInput {
            element: "arsenic".to_owned(),
            threshold: "0.2".to_owned(),
            step: "0.1".to_owned(),
            unit: "Pct".to_owned(),
            rate_per_dmt: "5".to_owned(),
            escalating: false,
        }],
        realisation_costs: "12000".to_owned(),
        quotational_period: Some("2 MAMA".to_owned()),
        pricing_reference: Some("LBMA Gold PM".to_owned()),
        incoterm: Some("FOB".to_owned()),
        effective_at: 1_700_000_000,
    }
}

// ── validate_assay ───────────────────────────────────────────────────────────

#[test]
fn valid_assay_passes() {
    assert!(validate_assay(&valid_assay()).is_ok());
}

#[test]
fn unknown_assay_status_is_rejected() {
    let mut r = valid_assay();
    r.assay_status = "Draft".to_owned();
    let err = validate_assay(&r).unwrap_err();
    assert!(err.contains("assay_status"), "unexpected error: {err}");
}

#[test]
fn empty_assays_is_rejected() {
    let mut r = valid_assay();
    r.assays = Vec::new();
    let err = validate_assay(&r).unwrap_err();
    assert!(err.contains("assays"), "unexpected error: {err}");
}

#[test]
fn negative_grade_is_rejected() {
    let mut r = valid_assay();
    r.assays[0].grade_g_per_t = "-1".to_owned();
    let err = validate_assay(&r).unwrap_err();
    assert!(err.contains("grade_g_per_t"), "unexpected error: {err}");
}

#[test]
fn unknown_deleterious_unit_is_rejected() {
    let mut r = valid_assay();
    r.deleterious[0].unit = "mg/kg".to_owned();
    let err = validate_assay(&r).unwrap_err();
    assert!(err.contains("unit"), "unexpected error: {err}");
}

#[test]
fn negative_deleterious_level_is_rejected() {
    let mut r = valid_assay();
    r.deleterious[0].level = "-0.1".to_owned();
    let err = validate_assay(&r).unwrap_err();
    assert!(err.contains("level"), "unexpected error: {err}");
}

#[test]
fn moisture_pct_above_100_is_rejected() {
    let mut r = valid_assay();
    r.moisture_pct = Some("100.1".to_owned());
    let err = validate_assay(&r).unwrap_err();
    assert!(err.contains("moisture_pct"), "unexpected error: {err}");
}

#[test]
fn moisture_pct_below_zero_is_rejected() {
    let mut r = valid_assay();
    r.moisture_pct = Some("-0.1".to_owned());
    let err = validate_assay(&r).unwrap_err();
    assert!(err.contains("moisture_pct"), "unexpected error: {err}");
}

#[test]
fn moisture_pct_bounds_are_allowed() {
    let mut r = valid_assay();
    r.moisture_pct = Some("0".to_owned());
    assert!(validate_assay(&r).is_ok());
    r.moisture_pct = Some("100".to_owned());
    assert!(validate_assay(&r).is_ok());
}

#[test]
fn missing_moisture_pct_is_allowed() {
    let mut r = valid_assay();
    r.moisture_pct = None;
    assert!(validate_assay(&r).is_ok());
}

#[test]
fn non_decimal_grade_is_rejected() {
    let mut r = valid_assay();
    r.assays[0].grade_g_per_t = "not-a-number".to_owned();
    assert!(validate_assay(&r).is_err());
}

// ── validate_offtake ─────────────────────────────────────────────────────────

#[test]
fn valid_offtake_passes() {
    assert!(validate_offtake(&valid_offtake()).is_ok());
}

#[test]
fn empty_payable_terms_is_rejected() {
    let mut r = valid_offtake();
    r.payable_terms = Vec::new();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("payable_terms"), "unexpected error: {err}");
}

#[test]
fn payable_pct_above_one_is_rejected() {
    let mut r = valid_offtake();
    r.payable_terms[0].payable_pct = "1.01".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("payable_pct"), "unexpected error: {err}");
}

#[test]
fn payable_pct_below_zero_is_rejected() {
    let mut r = valid_offtake();
    r.payable_terms[0].payable_pct = "-0.01".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("payable_pct"), "unexpected error: {err}");
}

#[test]
fn payable_pct_bounds_are_allowed() {
    let mut r = valid_offtake();
    r.payable_terms[0].payable_pct = "0".to_owned();
    assert!(validate_offtake(&r).is_ok());
    r.payable_terms[0].payable_pct = "1".to_owned();
    assert!(validate_offtake(&r).is_ok());
}

#[test]
fn negative_min_deduction_is_rejected() {
    let mut r = valid_offtake();
    r.payable_terms[0].min_deduction_g_per_t = "-1".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(
        err.contains("min_deduction_g_per_t"),
        "unexpected error: {err}"
    );
}

#[test]
fn negative_treatment_charge_is_rejected() {
    let mut r = valid_offtake();
    r.treatment_charge_per_dmt = "-1".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(
        err.contains("treatment_charge_per_dmt"),
        "unexpected error: {err}"
    );
}

#[test]
fn negative_realisation_costs_is_rejected() {
    let mut r = valid_offtake();
    r.realisation_costs = "-1".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("realisation_costs"), "unexpected error: {err}");
}

#[test]
fn negative_refining_charge_is_rejected() {
    let mut r = valid_offtake();
    r.refining_charges[0].rc_per_oz = "-1".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("rc_per_oz"), "unexpected error: {err}");
}

#[test]
fn empty_refining_charges_and_penalty_schedule_are_allowed() {
    let mut r = valid_offtake();
    r.refining_charges = Vec::new();
    r.penalty_schedule = Vec::new();
    assert!(validate_offtake(&r).is_ok());
}

/// Regression guard: `shared::collateral_valuation::ConcentrateInputs::valuate`
/// divides the assayed excess by each penalty tier's `step_pct`
/// (`packages/shared/src/collateral_valuation/mod.rs:154`) with no zero-guard of
/// its own. A `step` of `0` must be rejected here — the only place such a value
/// can enter the system — or it becomes a division-by-zero the next time this
/// loan's valuation is computed.
#[test]
fn penalty_step_zero_is_rejected() {
    let mut r = valid_offtake();
    r.penalty_schedule[0].step = "0".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("step"), "unexpected error: {err}");
}

#[test]
fn penalty_step_negative_is_rejected() {
    let mut r = valid_offtake();
    r.penalty_schedule[0].step = "-0.1".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("step"), "unexpected error: {err}");
}

#[test]
fn negative_penalty_threshold_is_rejected() {
    let mut r = valid_offtake();
    r.penalty_schedule[0].threshold = "-1".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("threshold"), "unexpected error: {err}");
}

#[test]
fn negative_penalty_rate_is_rejected() {
    let mut r = valid_offtake();
    r.penalty_schedule[0].rate_per_dmt = "-1".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("rate_per_dmt"), "unexpected error: {err}");
}

#[test]
fn unknown_incoterm_is_rejected() {
    let mut r = valid_offtake();
    r.incoterm = Some("DDP".to_owned());
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("incoterm"), "unexpected error: {err}");
}

#[test]
fn missing_incoterm_is_allowed() {
    let mut r = valid_offtake();
    r.incoterm = None;
    assert!(validate_offtake(&r).is_ok());
}

#[test]
fn non_decimal_treatment_charge_is_rejected() {
    let mut r = valid_offtake();
    r.treatment_charge_per_dmt = "not-a-number".to_owned();
    assert!(validate_offtake(&r).is_err());
}

// ── Penalty threshold/step units (issue #966) ──────────────────────────────────

#[test]
fn penalty_unit_ppm_is_allowed() {
    // A ppm-authored schedule (the natural reading) is valid — the trap this issue
    // fixes was that it silently scored zero, not that it was rejected.
    let mut r = valid_offtake();
    r.penalty_schedule[0].unit = "Ppm".to_owned();
    r.penalty_schedule[0].threshold = "10".to_owned();
    r.penalty_schedule[0].step = "5".to_owned();
    assert!(validate_offtake(&r).is_ok());
}

#[test]
fn unknown_penalty_unit_is_rejected() {
    let mut r = valid_offtake();
    r.penalty_schedule[0].unit = "mg/kg".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    assert!(err.contains("unit"), "unexpected error: {err}");
}

#[test]
fn pct_penalty_threshold_over_100_is_rejected() {
    // Order-of-magnitude guard: a ppm figure left under the default Pct unit.
    let mut r = valid_offtake();
    r.penalty_schedule[0].unit = "Pct".to_owned();
    r.penalty_schedule[0].threshold = "500".to_owned();
    let err = validate_offtake(&r).unwrap_err();
    // Assert on the >100-guard message specifically — "Ppm" alone would also match the
    // unknown-unit error, so it wouldn't prove we hit the order-of-magnitude branch.
    assert!(err.contains("exceed 100"), "unexpected error: {err}");
}

#[test]
fn penalty_unit_defaults_to_pct_when_omitted() {
    // Backward compatibility: a client that omits `unit` deserializes to "Pct", so
    // existing (percent) schedules keep their meaning.
    let body = r#"{
        "payable_terms": [{"metal":"gold","payable_pct":"0.80","min_deduction_g_per_t":"1"}],
        "treatment_charge_per_dmt": "220",
        "penalty_schedule": [{"element":"arsenic","threshold":"0.2","step":"0.1","rate_per_dmt":"5"}],
        "realisation_costs": "12000",
        "effective_at": 1700000000
    }"#;
    let req: SubmitOfftakeRequest = serde_json::from_str(body).expect("valid offtake body");
    assert_eq!(req.penalty_schedule[0].unit, "Pct");
    assert!(validate_offtake(&req).is_ok());
}

// ── outstanding_senior_usd ──────────────────────────────────────────────────────

mod outstanding_usd {
    use bigdecimal::BigDecimal;
    use pipeline_api::routes::collateral_valuation::outstanding_senior_usd;

    fn micro(v: &str) -> BigDecimal {
        v.parse().unwrap()
    }

    #[test]
    fn zero_outstanding_means_no_ccr() {
        assert_eq!(outstanding_senior_usd(micro("0")), None);
    }

    #[test]
    fn positive_outstanding_is_scaled_to_usd() {
        assert_eq!(outstanding_senior_usd(micro("4000000")), Some(micro("4")));
    }
}

// ── build_response: loan_snapshot missing input ─────────────────────────────────

fn standard_goods_anchor() -> CollateralValuationRow {
    CollateralValuationRow {
        chain_id: 1,
        loan_id: BigDecimal::from(42),
        submitted_loan_id: 1,
        commodity: "Coffee".to_owned(),
        valuation_mode: ValuationMode::StandardGoods,
        asset: "KC".to_owned(),
        price_provider: "ICE".to_owned(),
        haircut_pct: "0.20".parse().unwrap(),
        quantity_dmt: "1000".parse().unwrap(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn kc_prices() -> HashMap<String, BigDecimal> {
    HashMap::from([("KC".to_owned(), "1000".parse().unwrap())])
}

#[test]
fn no_snapshot_reports_loan_snapshot_missing() {
    let resp = build_response(
        &standard_goods_anchor(),
        None,
        None,
        &kc_prices(),
        None,
        false,
    )
    .unwrap();
    assert!(resp.collateral_value.is_some());
    assert!(resp.ccr.is_none());
    assert!(resp.missing_inputs.contains(&"loan_snapshot".to_owned()));
}

#[test]
fn zero_outstanding_with_snapshot_does_not_report_loan_snapshot_missing() {
    let resp = build_response(
        &standard_goods_anchor(),
        None,
        None,
        &kc_prices(),
        None,
        true,
    )
    .unwrap();
    assert!(resp.collateral_value.is_some());
    assert!(resp.ccr.is_none());
    assert!(!resp.missing_inputs.contains(&"loan_snapshot".to_owned()));
}

#[test]
fn positive_outstanding_computes_ccr_without_missing_inputs() {
    let senior: BigDecimal = "500000".parse().unwrap();
    let resp = build_response(
        &standard_goods_anchor(),
        None,
        None,
        &kc_prices(),
        Some(&senior),
        true,
    )
    .unwrap();
    assert_eq!(resp.ccr.unwrap().ccr_bps, 16_000);
    assert!(resp.missing_inputs.is_empty());
}
