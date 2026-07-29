//! Compute-layer tests for the per-loan CCR history API: exercise the pure grid /
//! as-of walk and `build_response` directly against fixture rows — no HTTP/DB layer.
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests — no
//! `DATABASE_URL` / Postgres connection.

use std::collections::HashMap;

use bigdecimal::BigDecimal;
use chrono::Utc;

use pipeline_api::routes::ccr_history::{
    build_response, merge_price_grids, required_assets, resolve_grid, validate_window,
    CcrHistoryDoc,
};
use shared::collateral_valuation_repo::{
    CollateralValuationRow, OfftakeTermsRow, PayableTermJson, ValuationMode,
};
use sqlx::types::Json;
use utoipa::OpenApi;

// ── Fixtures ───────────────────────────────────────────────────────────────────

fn dec(s: &str) -> BigDecimal {
    s.parse().unwrap()
}

/// A one-asset price map for a grid point (the standard-goods anchor prices on `KC`).
fn price_map(pairs: &[(&str, &str)]) -> HashMap<String, BigDecimal> {
    pairs
        .iter()
        .map(|(a, p)| ((*a).to_owned(), dec(p)))
        .collect()
}

/// A StandardGoods anchor: `collateral = price * quantity * (1 - haircut)`.
fn anchor(haircut: &str, quantity_dmt: &str) -> CollateralValuationRow {
    CollateralValuationRow {
        chain_id: 1,
        loan_id: BigDecimal::from(42),
        submitted_loan_id: 1,
        commodity: "Coffee".to_owned(),
        valuation_mode: ValuationMode::StandardGoods,
        asset: "KC".to_owned(),
        price_provider: "ICE".to_owned(),
        haircut_pct: dec(haircut),
        quantity_dmt: dec(quantity_dmt),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

// ── resolve_grid: the as-of walk ─────────────────────────────────────────────

#[test]
fn grid_seeds_early_points_and_steps_forward() {
    // step 10 over [0, 30]; a seed at t=-5 (=100) and a sample at t=15 (=200).
    let seed = Some((-5, dec("100")));
    let window = vec![(15, dec("200"))];
    let grid = resolve_grid(0, 30, 10, seed, &window);

    let got: Vec<(i64, Option<String>)> = grid
        .into_iter()
        .map(|(t, p)| (t, p.map(|v| v.to_plain_string())))
        .collect();

    assert_eq!(
        got,
        vec![
            (0, Some("100".to_owned())),  // seed
            (10, Some("100".to_owned())), // still seed (sample at 15 not yet reached)
            (20, Some("200".to_owned())), // sample at 15 now applies
            (30, Some("200".to_owned())),
        ]
    );
}

#[test]
fn grid_points_before_first_price_are_none() {
    // No seed; first sample only at t=25.
    let grid = resolve_grid(0, 30, 10, None, &[(25, dec("50"))]);
    let got: Vec<Option<String>> = grid
        .into_iter()
        .map(|(_, p)| p.map(|v| v.to_plain_string()))
        .collect();
    assert_eq!(
        got,
        vec![None, None, None, Some("50".to_owned())] // 0,10,20 unknown; 30 sees the 25 sample
    );
}

// ── OpenAPI param requiredness (regression: Swagger marked optionals required) ──

#[test]
fn openapi_marks_from_required_and_step_to_chain_optional() {
    let spec = serde_json::to_value(CcrHistoryDoc::openapi()).unwrap();
    let params = spec["paths"]["/v1/loan-book/{loan_id}/ccr-history"]["get"]["parameters"]
        .as_array()
        .expect("parameters array");

    let required_of = |name: &str| -> bool {
        params
            .iter()
            .find(|p| p["name"] == name)
            .unwrap_or_else(|| panic!("param {name} missing from spec"))["required"]
            .as_bool()
            .unwrap_or(false)
    };

    assert!(required_of("from"), "from must be required");
    assert!(
        !required_of("step"),
        "step must be optional (defaults to one day)"
    );
    assert!(!required_of("to"), "to must be optional");
    assert!(!required_of("chain_id"), "chain_id must be optional");
}

// ── validate_window ──────────────────────────────────────────────────────────

#[test]
fn validate_window_rejects_bad_input() {
    assert!(validate_window(0, 0, 100).is_err()); // step < 1
    assert!(validate_window(100, 10, 0).is_err()); // from > to
    assert!(validate_window(-1, 10, 100).is_err()); // negative from
    assert!(validate_window(0, 10, -1).is_err()); // negative to
    assert!(validate_window(i64::MIN, 10, 100).is_err()); // extreme from (no overflow panic)
    assert!(validate_window(0, 1, 1_000_000).is_err()); // too many points
    assert!(validate_window(0, 60, 3600).is_ok()); // 61 points — fine
}

// ── build_response ────────────────────────────────────────────────────────────

#[test]
fn build_response_computes_ccr_series_for_standard_goods() {
    // haircut 0.20, quantity 1000. senior = 500_000 USD.
    // collateral(price) = price * 1000 * 0.80 = 800 * price.
    // ccr_bps = collateral / senior * 10_000.
    //   price 1000 -> collateral 800_000 -> 800_000/500_000 = 1.6 -> 16_000 bps
    //   price  750 -> collateral 600_000 -> 1.2                 -> 12_000 bps
    let anchor = anchor("0.20", "1000");
    let senior = dec("500000");
    let grid = vec![
        (0i64, price_map(&[("KC", "1000")])),
        (3600, price_map(&[("KC", "750")])),
    ];

    let resp = build_response(
        &BigDecimal::from(42),
        1,
        0,
        3600,
        3600,
        &anchor,
        None,
        None,
        Some(&senior),
        &grid,
    )
    .ok()
    .expect("build_response should succeed");

    assert_eq!(resp.loan_id, "42");
    assert_eq!(resp.points.len(), 2);
    assert_eq!(resp.points[0].ccr_bps, 16_000);
    assert_eq!(resp.points[1].ccr_bps, 12_000);
}

#[test]
fn build_response_skips_points_without_a_price() {
    let anchor = anchor("0.00", "1000");
    let senior = dec("1000000");
    // First point has no price yet (empty map); second does.
    let grid = vec![(0i64, HashMap::new()), (10, price_map(&[("KC", "1000")]))];

    let resp = build_response(
        &BigDecimal::from(42),
        1,
        0,
        10,
        10,
        &anchor,
        None,
        None,
        Some(&senior),
        &grid,
    )
    .ok()
    .expect("build_response should succeed");

    // Only the priced point is emitted.
    assert_eq!(resp.points.len(), 1);
    assert_eq!(resp.points[0].ccr_bps, 10_000); // 1000*1000 / 1_000_000 = 1.0
}

#[test]
fn build_response_empty_when_structural_inputs_missing() {
    let anchor = anchor("0.20", "1000");
    let grid = vec![(0i64, price_map(&[("KC", "1000")]))];

    // Senior absent → no denominator, so no CCR is computable.
    let resp = build_response(
        &BigDecimal::from(42),
        1,
        0,
        0,
        1,
        &anchor,
        None,
        None,
        None, // senior_usd
        &grid,
    )
    .ok()
    .expect("build_response should succeed");

    assert!(resp.points.is_empty());
}

// ── required_assets / merge_price_grids (per-metal, issue #964) ─────────────────

fn concentrate_anchor() -> CollateralValuationRow {
    let mut a = anchor("0.40", "100");
    a.valuation_mode = ValuationMode::MetalConcentrate;
    "XAU".clone_into(&mut a.asset);
    a
}

fn gold_silver_offtake() -> OfftakeTermsRow {
    OfftakeTermsRow {
        id: 1,
        chain_id: 1,
        loan_id: BigDecimal::from(42),
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
        treatment_charge_per_dmt: dec("220"),
        refining_charges: Json(vec![]),
        penalty_schedule: Json(vec![]),
        realisation_costs: dec("0"),
        quotational_period: None,
        pricing_reference: None,
        incoterm: None,
        effective_at: Utc::now(),
        recorded_by: "test".to_owned(),
        created_at: Utc::now(),
    }
}

#[test]
fn required_assets_are_per_metal_for_concentrate_and_headline_for_standard() {
    // Standard goods → the anchor's headline asset only.
    assert_eq!(required_assets(&anchor("0.20", "1000"), None), vec!["KC"]);

    // Concentrate → each payable metal's own asset, sorted + deduped.
    let offtake = gold_silver_offtake();
    assert_eq!(
        required_assets(&concentrate_anchor(), Some(&offtake)),
        vec!["XAG".to_owned(), "XAU".to_owned()]
    );

    // Concentrate with no offtake yet → nothing to price.
    assert!(required_assets(&concentrate_anchor(), None).is_empty());
}

#[test]
fn merge_price_grids_yields_full_map_only_when_every_asset_is_priced() {
    // Two assets on the same [0, 20]/step-10 axis. XAU is known from t=0; XAG only from t=10.
    let per_asset = vec![
        (
            "XAU".to_owned(),
            vec![
                (0, Some(dec("4000"))),
                (10, Some(dec("4000"))),
                (20, Some(dec("4200"))),
            ],
        ),
        (
            "XAG".to_owned(),
            vec![(0, None), (10, Some(dec("50"))), (20, Some(dec("55")))],
        ),
    ];
    let merged = merge_price_grids(0, 20, 10, &per_asset);

    assert_eq!(merged.len(), 3);
    // t=0: XAG not yet priced ⇒ map has only XAU (incomplete → the loan reads unpriced).
    assert_eq!(merged[0].0, 0);
    assert_eq!(merged[0].1.get("XAU"), Some(&dec("4000")));
    assert!(!merged[0].1.contains_key("XAG"));
    // t=10 and t=20: both assets present.
    assert_eq!(merged[1].1.get("XAG"), Some(&dec("50")));
    assert_eq!(merged[2].1.get("XAU"), Some(&dec("4200")));
    assert_eq!(merged[2].1.get("XAG"), Some(&dec("55")));
}
