// spec: docs/product-specs/loan-security-state.md#mark-suggestions
use std::collections::HashMap;
use std::str::FromStr;

use bigdecimal::num_bigint::BigInt;
use bigdecimal::{BigDecimal, RoundingMode};
use chrono::{DateTime, TimeZone, Utc};
use shared::collateral_valuation::nsr_per_dmt;
use shared::collateral_valuation_repo::{
    AssayMetalJson, AssayRow, DeleteriousJson, OfftakeTermsRow, PayableTermJson, PenaltyTierJson,
    RefiningChargeJson,
};
use shared::security_marks::{
    bounded_dec, bounded_dec_str, concentrate_vpu_raw, effective_max_age, mark_due, mark_pairs,
    move_bps, moved, normalize_commodity, plain, quote_factor, report_hash, standard_vpu_raw,
    suggest, CommodityMap, MarkPolicy, MarkSettings, PriceMap, QuoteUnit, SuggestCtx,
    SuggestionStatus, TONNE_LB, TONNE_TROY_OZ,
};
use shared::security_state::format_7dp_i128;
use sqlx::types::Json;

const MAP_JSON: &str = r#"[
 {"commodity":"gold","mode":"StandardGoods","asset":"XAU","price_provider":"metal_price","quote_unit":"TroyOz","benchmark":"XAU"},
 {"commodity":"copper cathode","mode":"StandardGoods","asset":"XCU","price_provider":"metal_price","quote_unit":"TroyOz"},
 {"commodity":"copper wire","mode":"StandardGoods","asset":"XCU","price_provider":"metal_price","quote_unit":"Lb"},
 {"commodity":"zinc","mode":"StandardGoods","asset":"XZN","price_provider":"metal_price","quote_unit":"Mt"},
 {"commodity":"brent","mode":"StandardGoods","asset":"BRENT","price_provider":"metal_price","quote_unit":"Bbl"},
 {"commodity":"gold pyrite concentrate","mode":"MetalConcentrate","asset":"XAU","price_provider":"metal_price","benchmark":"XAU_NSR"}
]"#;

const REGISTRY: &str = "CDTUMAT6QBBPUZQFTZWMPHXHVQSLPUWRPDHKVQEMEF2YKCV4QTSCSQVN";
const PRICE_TS: i64 = 1_762_300_000;

fn bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

fn at(ts: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(ts, 0).unwrap()
}

fn map() -> CommodityMap {
    MarkSettings::parse(Some(MAP_JSON), None, None).unwrap().map
}

fn prices(pairs: &[(&str, &str)]) -> PriceMap {
    pairs
        .iter()
        .map(|(a, p)| {
            (
                ((*a).to_owned(), "metal_price".to_owned()),
                (bd(p), at(PRICE_TS)),
            )
        })
        .collect()
}

fn ctx<'a>(
    map: &'a CommodityMap,
    prices: &'a PriceMap,
    concentrate: Option<(&'a AssayRow, &'a OfftakeTermsRow)>,
) -> SuggestCtx<'a> {
    SuggestCtx {
        chain_id: 99_000_001,
        security_registry: REGISTRY,
        record_id: 3,
        map,
        prices,
        concentrate,
    }
}

fn standard(commodity: &str, unit: &str, px: &[(&str, &str)]) -> Result<i128, SuggestionStatus> {
    let m = map();
    let p = prices(px);
    suggest(&ctx(&m, &p, None), commodity, unit).map(|s| s.value_per_unit)
}

fn assay() -> AssayRow {
    AssayRow {
        id: 11,
        chain_id: 99_000_001,
        loan_id: BigDecimal::from(7),
        assay_status: "Final".to_owned(),
        moisture_pct: None,
        assays: Json(vec![AssayMetalJson {
            metal: "gold".to_owned(),
            grade_g_per_t: "50".to_owned(),
        }]),
        deleterious: Json(vec![DeleteriousJson {
            element: "As".to_owned(),
            level: "2.0".to_owned(),
            unit: "Pct".to_owned(),
        }]),
        certificate_uri: None,
        effective_at: at(PRICE_TS),
        recorded_by: "test".to_owned(),
        created_at: at(PRICE_TS),
    }
}

fn offtake() -> OfftakeTermsRow {
    OfftakeTermsRow {
        id: 12,
        chain_id: 99_000_001,
        loan_id: BigDecimal::from(7),
        payable_terms: Json(vec![PayableTermJson {
            metal: "gold".to_owned(),
            payable_pct: "0.80".to_owned(),
            min_deduction_g_per_t: "1".to_owned(),
        }]),
        treatment_charge_per_dmt: bd("220"),
        refining_charges: Json(vec![RefiningChargeJson {
            metal: "gold".to_owned(),
            rc_per_oz: "6".to_owned(),
        }]),
        penalty_schedule: Json(vec![PenaltyTierJson {
            element: "As".to_owned(),
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
        effective_at: at(PRICE_TS),
        recorded_by: "test".to_owned(),
        created_at: at(PRICE_TS),
    }
}

fn gold_silver_offtake() -> OfftakeTermsRow {
    let mut o = offtake();
    o.payable_terms.0.insert(
        0,
        PayableTermJson {
            metal: "silver".to_owned(),
            payable_pct: "0.90".to_owned(),
            min_deduction_g_per_t: "5".to_owned(),
        },
    );
    o.refining_charges.0.push(RefiningChargeJson {
        metal: "silver".to_owned(),
        rc_per_oz: "0.5".to_owned(),
    });
    o
}

fn gold_silver_assay() -> AssayRow {
    let mut a = assay();
    a.assays.0.push(AssayMetalJson {
        metal: "silver".to_owned(),
        grade_g_per_t: "200".to_owned(),
    });
    a
}

fn concentrate(
    a: &AssayRow,
    o: &OfftakeTermsRow,
    px: &[(&str, &str)],
    unit: &str,
) -> Result<i128, SuggestionStatus> {
    let m = map();
    let p = prices(px);
    suggest(&ctx(&m, &p, Some((a, o))), "Gold-Pyrite  Concentrate", unit).map(|s| s.value_per_unit)
}

fn asset_prices(px: &[(&str, &str)]) -> HashMap<String, BigDecimal> {
    px.iter().map(|(a, p)| ((*a).to_owned(), bd(p))).collect()
}

fn floor_raw(nsr: &BigDecimal) -> i128 {
    let scaled = (nsr * BigDecimal::from(10_000_000)).with_scale_round(0, RoundingMode::Down);
    i128::try_from(scaled.as_bigint_and_exponent().0).unwrap()
}

#[test]
fn gold_per_tonne_in_troy_ounces_is_exact() {
    let want = 4_000i128 * 10i128.pow(17) / 311_035;
    assert_eq!(standard("gold", "Mt", &[("XAU", "4000")]), Ok(want));
    assert_eq!(standard("gold", "Dmt", &[("XAU", "4000")]), Ok(want));
}

#[test]
fn tonne_troy_factor_matches_the_valuation_constant() {
    let (num, den) = TONNE_TROY_OZ;
    assert_eq!(
        BigDecimal::from(num) / BigDecimal::from(den),
        BigDecimal::from(1_000_000) / bd("31.1035")
    );
}

#[test]
fn tonne_pound_factor_is_exact() {
    let (num, den) = TONNE_LB;
    assert_eq!(
        BigDecimal::from(num) / BigDecimal::from(den),
        BigDecimal::from(1000) / bd("0.45359237")
    );
}

#[test]
fn metric_ton_quote_is_identity() {
    assert_eq!(standard("zinc", "Mt", &[("XZN", "100")]), Ok(1_000_000_000));
    assert_eq!(
        standard("zinc", "Dmt", &[("XZN", "100")]),
        Ok(1_000_000_000)
    );
    assert_eq!(
        format_7dp_i128(standard("zinc", "Mt", &[("XZN", "100")]).unwrap()),
        "100.0000000"
    );
}

#[test]
fn pound_quote_converts_tonnes() {
    let want = 2i128 * 10i128.pow(18) / 45_359_237;
    assert_eq!(standard("copper wire", "Mt", &[("XCU", "2")]), Ok(want));
}

#[test]
fn barrel_quote_is_identity_for_barrels() {
    assert_eq!(
        standard("brent", "Bbl", &[("BRENT", "80")]),
        Ok(800_000_000)
    );
}

#[test]
fn mismatched_units_are_unsupported() {
    assert_eq!(
        standard("brent", "Mt", &[("BRENT", "80")]),
        Err(SuggestionStatus::UnsupportedUnit)
    );
    assert_eq!(
        standard("gold", "Bbl", &[("XAU", "4000")]),
        Err(SuggestionStatus::UnsupportedUnit)
    );
    assert_eq!(
        standard("gold", "Usd", &[("XAU", "4000")]),
        Err(SuggestionStatus::UnsupportedUnit)
    );
    assert_eq!(quote_factor("Bbl", QuoteUnit::TroyOz), None);
    assert_eq!(quote_factor("Mt", QuoteUnit::Bbl), None);
}

#[test]
fn prices_beyond_seven_decimals_floor() {
    assert_eq!(
        standard("zinc", "Mt", &[("XZN", "1.23456789")]),
        Ok(12_345_678)
    );
}

#[test]
fn sqlx_negative_scale_prices_are_accepted() {
    let negative_scale = BigDecimal::new(BigInt::from(125), -8);
    assert_eq!(
        standard_vpu_raw(&negative_scale, (1, 1)),
        Some(125i128 * 10i128.pow(8) * 10i128.pow(7))
    );
    let m = map();
    let p: PriceMap = HashMap::from([(
        ("XZN".to_owned(), "metal_price".to_owned()),
        (negative_scale, at(PRICE_TS)),
    )]);
    let s = suggest(&ctx(&m, &p, None), "zinc", "Mt").unwrap();
    assert_eq!(s.value_per_unit, 125i128 * 10i128.pow(15));
    assert_eq!(s.source_price, "12500000000");
}

#[test]
fn a_zero_scale_exponent_form_is_accepted() {
    let price = BigDecimal::new(BigInt::from(5), -3);
    assert_eq!(
        standard_vpu_raw(&price, (1, 1)),
        Some(5i128 * 10i128.pow(10))
    );
}

#[test]
fn negative_prices_clamp_to_zero() {
    assert_eq!(standard("zinc", "Mt", &[("XZN", "-5")]), Ok(0));
}

#[test]
fn results_beyond_i128_are_unreadable() {
    let huge = BigDecimal::new(BigInt::from(1), -40);
    assert_eq!(standard_vpu_raw(&huge, (1, 1)), None);
    let m = map();
    let p: PriceMap = HashMap::from([(
        ("XZN".to_owned(), "metal_price".to_owned()),
        (huge, at(PRICE_TS)),
    )]);
    assert_eq!(
        suggest(&ctx(&m, &p, None), "zinc", "Mt").unwrap_err(),
        SuggestionStatus::Unreadable
    );
}

#[test]
fn out_of_bounds_prices_are_unreadable() {
    for raw in [
        BigDecimal::new(BigInt::from(1), -41),
        BigDecimal::new(BigInt::from(1), 100_000),
        BigDecimal::new(BigInt::from(1), -999_999_999),
    ] {
        let m = map();
        let p: PriceMap = HashMap::from([(
            ("XZN".to_owned(), "metal_price".to_owned()),
            (raw, at(PRICE_TS)),
        )]);
        assert_eq!(
            suggest(&ctx(&m, &p, None), "zinc", "Mt").unwrap_err(),
            SuggestionStatus::Unreadable
        );
    }
}

#[test]
fn unmapped_commodities_never_look_up_prices() {
    let m = map();
    let empty_prices = PriceMap::new();
    let c = ctx(&m, &empty_prices, None);
    assert_eq!(
        suggest(&c, "wheat", "Mt").unwrap_err(),
        SuggestionStatus::Unmapped
    );
    let none = CommodityMap::default();
    let c = ctx(&none, &empty_prices, None);
    assert_eq!(
        suggest(&c, "gold", "Mt").unwrap_err(),
        SuggestionStatus::Unmapped
    );
}

#[test]
fn a_mapped_commodity_without_a_price_is_no_price() {
    assert_eq!(standard("gold", "Mt", &[]), Err(SuggestionStatus::NoPrice));
}

#[test]
fn normalization_collapses_case_and_separators() {
    for raw in [
        "gold pyrite concentrate",
        "Gold-Pyrite  Concentrate",
        "gold_pyrite_concentrate",
        "  GOLD\tPYRITE - concentrate ",
    ] {
        assert_eq!(
            normalize_commodity(raw).as_deref(),
            Some("gold_pyrite_concentrate"),
            "{raw}"
        );
    }
}

#[test]
fn normalization_rejects_unmatchable_keys() {
    assert_eq!(normalize_commodity(""), None);
    assert_eq!(normalize_commodity("   "), None);
    assert_eq!(normalize_commodity("gõld"), None);
    assert_eq!(normalize_commodity("go\u{0}ld"), None);
    assert_eq!(normalize_commodity(&"a".repeat(65)), None);
    assert!(normalize_commodity(&"a".repeat(64)).is_some());
    let m = map();
    assert!(m.get("").is_none());
    assert!(m.get(&"gold".repeat(40)).is_none());
}

#[test]
fn matching_is_exact_on_the_normalized_key() {
    let m = map();
    assert!(m.get("Gold").is_some());
    assert!(m.get("gold bars").is_none());
    assert!(m.get("gol").is_none());
}

#[test]
fn concentrate_equals_the_floored_nsr_per_dry_tonne() {
    let (a, o) = (assay(), offtake());
    let nsr = nsr_per_dmt(&a, &o, &asset_prices(&[("XAU", "4000")]))
        .unwrap()
        .unwrap();
    let got = concentrate(&a, &o, &[("XAU", "4000")], "Dmt").unwrap();
    assert_eq!(got, floor_raw(&nsr));
    assert!(got > 46_900_000_000 && got < 47_000_000_000, "{got}");
}

#[test]
fn a_concentrate_record_in_tonnes_is_unsupported() {
    assert_eq!(
        concentrate(&assay(), &offtake(), &[("XAU", "4000")], "Mt"),
        Err(SuggestionStatus::UnsupportedUnit)
    );
}

#[test]
fn concentrates_need_assay_and_offtake() {
    let m = map();
    let p = prices(&[("XAU", "4000")]);
    assert_eq!(
        suggest(&ctx(&m, &p, None), "gold pyrite concentrate", "Dmt").unwrap_err(),
        SuggestionStatus::InputsMissing
    );
}

#[test]
fn an_unknown_payable_metal_is_inputs_missing() {
    let mut o = offtake();
    o.payable_terms.0[0].metal = "copper".to_owned();
    assert_eq!(
        concentrate(&assay(), &o, &[("XAU", "4000")], "Dmt"),
        Err(SuggestionStatus::InputsMissing)
    );
}

#[test]
fn empty_payable_terms_are_inputs_missing() {
    let mut o = offtake();
    o.payable_terms.0.clear();
    assert_eq!(
        concentrate(&assay(), &o, &[("XAU", "4000")], "Dmt"),
        Err(SuggestionStatus::InputsMissing)
    );
}

#[test]
fn an_unpriced_payable_metal_is_no_price() {
    assert_eq!(
        concentrate(
            &gold_silver_assay(),
            &gold_silver_offtake(),
            &[("XAU", "4000")],
            "Dmt"
        ),
        Err(SuggestionStatus::NoPrice)
    );
    assert_eq!(
        concentrate(&assay(), &offtake(), &[("XAG", "50")], "Dmt"),
        Err(SuggestionStatus::NoPrice)
    );
}

#[test]
fn a_negative_nsr_is_zero() {
    let mut o = offtake();
    o.treatment_charge_per_dmt = bd("1000000");
    assert_eq!(concentrate(&assay(), &o, &[("XAU", "4000")], "Dmt"), Ok(0));
}

#[test]
fn hostile_assay_decimals_are_unreadable() {
    let prices = asset_prices(&[("XAU", "4000")]);
    for bad in ["1e999999999", "1e-999999999", "1e41", &"9".repeat(61)] {
        let mut a = assay();
        a.assays.0[0].grade_g_per_t = bad.to_owned();
        assert_eq!(
            concentrate_vpu_raw(&a, &offtake(), &prices),
            Err(SuggestionStatus::Unreadable),
            "{bad}"
        );
    }
}

#[test]
fn hostile_offtake_decimals_are_unreadable() {
    let prices = asset_prices(&[("XAU", "4000")]);
    let mutations: Vec<OfftakeMutation> = vec![
        Box::new(|o| o.payable_terms.0[0].payable_pct = "1e999999999".to_owned()),
        Box::new(|o| o.payable_terms.0[0].min_deduction_g_per_t = "1e50".to_owned()),
        Box::new(|o| o.refining_charges.0[0].rc_per_oz = "1".repeat(65)),
        Box::new(|o| o.penalty_schedule.0[0].threshold = "1e-999".to_owned()),
        Box::new(|o| o.penalty_schedule.0[0].step = "0".to_owned()),
        Box::new(|o| o.penalty_schedule.0[0].rate_per_dmt = "NaN".to_owned()),
        Box::new(|o| o.treatment_charge_per_dmt = BigDecimal::new(BigInt::from(1), -999_999_999)),
    ];
    for mutate in mutations {
        let mut o = offtake();
        mutate(&mut o);
        assert_eq!(
            concentrate_vpu_raw(&assay(), &o, &prices),
            Err(SuggestionStatus::Unreadable)
        );
    }
}

#[test]
fn a_zero_ppm_step_is_unreadable() {
    let mut o = offtake();
    o.penalty_schedule.0[0].unit = "Ppm".to_owned();
    o.penalty_schedule.0[0].step = "0".to_owned();
    assert_eq!(
        concentrate_vpu_raw(&assay(), &o, &asset_prices(&[("XAU", "4000")])),
        Err(SuggestionStatus::Unreadable)
    );
}

#[test]
fn oversized_stored_arrays_are_unreadable() {
    let mut o = offtake();
    for _ in 0..70 {
        o.refining_charges.0.push(RefiningChargeJson {
            metal: "gold".to_owned(),
            rc_per_oz: "1".to_owned(),
        });
    }
    assert_eq!(
        concentrate_vpu_raw(&assay(), &o, &asset_prices(&[("XAU", "4000")])),
        Err(SuggestionStatus::Unreadable)
    );
}

#[test]
fn negative_scale_metal_prices_are_accepted_by_the_concentrate_path() {
    let mut prices = asset_prices(&[]);
    prices.insert("XAU".to_owned(), BigDecimal::new(BigInt::from(4), -3));
    let via_neg = concentrate_vpu_raw(&assay(), &offtake(), &prices).unwrap();
    let via_plain =
        concentrate_vpu_raw(&assay(), &offtake(), &asset_prices(&[("XAU", "4000")])).unwrap();
    assert_eq!(via_neg, via_plain);
}

#[test]
fn bounded_parsing_rejects_hostile_strings() {
    for bad in [
        "1e999999999",
        "1e-999999999",
        "1e41",
        "",
        "abc",
        "NaN",
        "inf",
        &"1".repeat(61),
        &format!("0.{}", "0".repeat(70)),
    ] {
        assert!(bounded_dec_str(bad).is_none(), "{bad}");
    }
}

#[test]
fn bounded_parsing_accepts_the_edges() {
    assert!(bounded_dec_str("1e40").is_some());
    assert!(bounded_dec_str("1e-40").is_some());
    assert!(bounded_dec_str("1e-41").is_some());
    assert!(bounded_dec_str(&"1".repeat(60)).is_some());
    assert!(bounded_dec(&BigDecimal::new(BigInt::from(1), 40)).is_some());
    assert!(bounded_dec(&BigDecimal::new(BigInt::from(1), -40)).is_some());
    assert!(bounded_dec(&BigDecimal::new(BigInt::from(1), -41)).is_none());
}

#[test]
fn bounded_values_have_a_non_negative_scale() {
    let d = bounded_dec(&BigDecimal::new(BigInt::from(125), -8)).unwrap();
    assert_eq!(d.as_bigint_and_exponent().1, 0);
    assert_eq!(plain(&d), "12500000000");
    assert_eq!(plain(&bd("4000.50")), "4000.5");
    assert_eq!(plain(&bd("4000")), "4000");
}

#[test]
fn the_report_is_golden() {
    let m = map();
    let p = prices(&[("XAU", "4000")]);
    let s = suggest(&ctx(&m, &p, None), "Gold", "Mt").unwrap();
    let raw = 4_000i128 * 10i128.pow(17) / 311_035;
    let expected = format!(
        "pipeline-mark/v1\nchain_id=99000001\nsecurity_registry={REGISTRY}\nrecord_id=3\ncommodity=gold\nunit=Mt\nmode=StandardGoods\nasset=XAU\nprice_provider=metal_price\nprice=4000\nprice_at=1762300000\nquote_unit=TroyOz\nvalue_per_unit={}\nbenchmark=XAU",
        format_7dp_i128(raw)
    );
    assert_eq!(s.report, expected);
    assert_eq!(s.report_hash, report_hash(&expected));
    assert_eq!(s.report_hash.len(), 64);
    assert!(s
        .report_hash
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    assert_eq!(s.source_price, "4000");
    assert_eq!(s.source_at, PRICE_TS);
    assert_eq!(s.quote_unit.as_deref(), Some("TroyOz"));
    assert_eq!(s.benchmark, "XAU");
    assert!(s.assay_id.is_none() && s.offtake_id.is_none());
}

#[test]
fn the_hash_matches_a_known_sha256_vector() {
    assert_eq!(
        report_hash("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn any_changed_field_changes_the_hash() {
    let m = map();
    let p = prices(&[("XAU", "4000")]);
    let base = suggest(&ctx(&m, &p, None), "gold", "Mt")
        .unwrap()
        .report_hash;
    let mut seen = vec![base.clone()];
    let mut push = |h: String| {
        assert!(!seen.contains(&h));
        seen.push(h);
    };
    push(
        suggest(&ctx(&m, &prices(&[("XAU", "4001")]), None), "gold", "Mt")
            .unwrap()
            .report_hash,
    );
    push(
        suggest(&ctx(&m, &p, None), "gold", "Dmt")
            .unwrap()
            .report_hash,
    );
    let mut other_record = ctx(&m, &p, None);
    other_record.record_id = 4;
    push(suggest(&other_record, "gold", "Mt").unwrap().report_hash);
    let mut other_chain = ctx(&m, &p, None);
    other_chain.chain_id = 99_000_002;
    push(suggest(&other_chain, "gold", "Mt").unwrap().report_hash);
    let mut other_registry = ctx(&m, &p, None);
    other_registry.security_registry = "CB";
    push(suggest(&other_registry, "gold", "Mt").unwrap().report_hash);
    let later: PriceMap = HashMap::from([(
        ("XAU".to_owned(), "metal_price".to_owned()),
        (bd("4000"), at(PRICE_TS + 1)),
    )]);
    push(
        suggest(&ctx(&m, &later, None), "gold", "Mt")
            .unwrap()
            .report_hash,
    );
}

#[test]
fn concentrate_reports_carry_sorted_metal_lines_and_input_ids() {
    let (a, o) = (gold_silver_assay(), gold_silver_offtake());
    let m = map();
    let px = prices(&[("XAU", "4000"), ("XAG", "50")]);
    let sg = suggest(
        &ctx(&m, &px, Some((&a, &o))),
        "gold pyrite concentrate",
        "Dmt",
    )
    .unwrap();
    let tail: Vec<&str> = sg.report.lines().rev().take(4).collect();
    assert_eq!(
        tail,
        vec![
            "metal.XAU=4000@1762300000",
            "metal.XAG=50@1762300000",
            "offtake_id=12",
            "assay_id=11"
        ]
    );
    assert!(sg.report.contains("\nquote_unit=-\n"));
    assert!(sg.report.contains("\nbenchmark=XAU_NSR"));
    assert_eq!(sg.assay_id.as_deref(), Some("11"));
    assert_eq!(sg.offtake_id.as_deref(), Some("12"));
    assert_eq!(sg.quote_unit, None);
    assert_eq!(sg.mode.as_str(), "MetalConcentrate");
    assert!(!sg.report.ends_with('\n'));
}

#[test]
fn the_concentrate_source_time_is_the_oldest_price() {
    let (assay_row, offtake_row) = (gold_silver_assay(), gold_silver_offtake());
    let map = map();
    let mut px = prices(&[("XAU", "4000")]);
    px.insert(
        ("XAG".to_owned(), "metal_price".to_owned()),
        (bd("50"), at(PRICE_TS - 500)),
    );
    let sg = suggest(
        &ctx(&map, &px, Some((&assay_row, &offtake_row))),
        "gold pyrite concentrate",
        "Dmt",
    )
    .unwrap();
    assert_eq!(sg.source_at, PRICE_TS - 500);
}

fn policy(max_age: u64, move_bps: u32) -> MarkPolicy {
    MarkPolicy { max_age, move_bps }
}

type OfftakeMutation = Box<dyn Fn(&mut OfftakeTermsRow)>;

const MARK: i128 = 1_000_000_000;
const MARK_AT: u64 = 1_000_000;

#[test]
fn a_missing_mark_is_due() {
    let d = mark_due(MARK_AT, None, Some(MARK), 0, &policy(86_400, 200));
    assert!(d.due);
    assert_eq!(d.reasons, vec!["missing"]);
    assert_eq!(d.due_at, None);
}

#[test]
fn the_age_edge_is_strict() {
    let p = policy(86_400, 0);
    let mark = Some((MARK, MARK_AT));
    let not_due = mark_due(MARK_AT + 86_400, mark, None, 0, &p);
    assert!(!not_due.due && not_due.reasons.is_empty());
    assert_eq!(not_due.due_at, Some(MARK_AT + 86_400));
    let due = mark_due(MARK_AT + 86_401, mark, None, 0, &p);
    assert!(due.due);
    assert_eq!(due.reasons, vec!["age"]);
    assert_eq!(due.due_at, Some(MARK_AT + 86_400));
}

#[test]
fn a_shorter_price_stale_after_wins() {
    let p = policy(86_400, 0);
    let mark = Some((MARK, MARK_AT));
    assert!(!mark_due(MARK_AT + 3_600, mark, None, 3_600, &p).due);
    let due = mark_due(MARK_AT + 3_601, mark, None, 3_600, &p);
    assert_eq!(due.reasons, vec!["age"]);
    assert_eq!(due.due_at, Some(MARK_AT + 3_600));
}

#[test]
fn a_longer_price_stale_after_does_not_extend_the_policy() {
    let p = policy(86_400, 0);
    let mark = Some((MARK, MARK_AT));
    assert!(mark_due(MARK_AT + 86_401, mark, None, 172_800, &p).due);
    assert_eq!(effective_max_age(86_400, 172_800), 86_400);
    assert_eq!(effective_max_age(0, 172_800), 172_800);
    assert_eq!(effective_max_age(86_400, 0), 86_400);
    assert_eq!(effective_max_age(0, 0), 0);
}

#[test]
fn with_both_ages_off_nothing_ages() {
    let d = mark_due(u64::MAX, Some((MARK, MARK_AT)), None, 0, &policy(0, 0));
    assert!(!d.due);
    assert_eq!(d.due_at, None);
}

#[test]
fn a_future_mark_time_never_ages() {
    let d = mark_due(10, Some((MARK, 1_000)), None, 0, &policy(86_400, 0));
    assert!(!d.due);
}

#[test]
fn an_overflowing_due_time_is_null() {
    let d = mark_due(0, Some((MARK, u64::MAX)), None, 0, &policy(86_400, 0));
    assert_eq!(d.due_at, None);
}

#[test]
fn the_move_edge_is_strict() {
    assert!(!moved(MARK, 1_020_000_000, 200));
    assert_eq!(move_bps(MARK, 1_020_000_000), Some(200));
    assert!(moved(MARK, 1_020_000_001, 200));
    assert!(moved(MARK, 979_999_999, 200));
    assert_eq!(move_bps(MARK, 979_999_999), Some(-200));
    assert!(!moved(MARK, 980_000_000, 200));
    assert_eq!(move_bps(MARK, 980_000_000), Some(-200));
}

#[test]
fn a_zero_mark_is_moved_by_any_positive_suggestion() {
    assert_eq!(move_bps(0, 0), Some(0));
    assert!(!moved(0, 0, 200));
    assert_eq!(move_bps(0, 5), None);
    assert!(moved(0, 5, 200));
}

#[test]
fn a_disabled_move_policy_never_moves() {
    assert!(!moved(MARK, MARK * 100, 0));
    assert!(!moved(0, 5, 0));
    let d = mark_due(
        MARK_AT,
        Some((MARK, MARK_AT)),
        Some(MARK * 100),
        0,
        &policy(86_400, 0),
    );
    assert!(!d.due);
}

#[test]
fn huge_values_do_not_overflow() {
    assert!(moved(i128::MAX, 0, 200));
    assert_eq!(move_bps(1, i128::MAX), Some(i32::MAX));
    assert_eq!(move_bps(i128::MAX, 0), Some(-10_000));
    assert_eq!(move_bps(-1, 5), None);
    assert!(!moved(-1, 5, 200));
}

#[test]
fn reasons_come_in_a_stable_order() {
    let d = mark_due(
        MARK_AT + 86_401,
        Some((MARK, MARK_AT)),
        Some(MARK * 2),
        0,
        &policy(86_400, 200),
    );
    assert_eq!(d.reasons, vec!["age", "moved"]);
    assert!(d.due);
}

#[test]
fn without_a_suggestion_only_missing_and_age_apply() {
    let d = mark_due(
        MARK_AT,
        Some((MARK, MARK_AT)),
        None,
        0,
        &policy(86_400, 200),
    );
    assert!(!d.due);
}

#[test]
fn unset_settings_are_empty_with_defaults() {
    let s = MarkSettings::parse(None, None, None).unwrap();
    assert!(s.map.is_empty());
    assert_eq!(s.policy, policy(86_400, 200));
    assert_eq!(s, MarkSettings::default());
    assert_eq!(
        MarkSettings::parse(Some("  "), Some(" "), Some("")).unwrap(),
        s
    );
}

#[test]
fn a_valid_map_parses_with_defaults_applied() {
    let m = map();
    assert_eq!(m.len(), 6);
    let copper = m.get("Copper-Cathode").unwrap();
    assert_eq!(copper.benchmark, "XCU");
    assert_eq!(copper.commodity, "copper_cathode");
    assert_eq!(copper.quote_unit, Some(QuoteUnit::TroyOz));
    let conc = m.get("gold pyrite concentrate").unwrap();
    assert_eq!(conc.benchmark, "XAU_NSR");
    assert_eq!(conc.quote_unit, None);
    assert_eq!(m.providers(), vec!["metal_price".to_owned()]);
}

fn parse_err(json: &str) -> String {
    format!(
        "{:#}",
        MarkSettings::parse(Some(json), None, None).unwrap_err()
    )
}

fn entry(extra: &str) -> String {
    format!(
        r#"[{{"commodity":"gold","mode":"StandardGoods","asset":"XAU","price_provider":"metal_price","quote_unit":"TroyOz"{extra}}}]"#
    )
}

#[test]
fn malformed_maps_fail_naming_the_key() {
    let cases: Vec<(String, &str)> = vec![
        ("not json".to_owned(), "not a valid mapping array"),
        (
            r#"[{"commodity":"gold","mode":"StandardGoods","asset":"XAU","price_provider":"metal_price","quote_unit":"TroyOz"},{"commodity":"GOLD","mode":"StandardGoods","asset":"XAU","price_provider":"metal_price","quote_unit":"Mt"}]"#.to_owned(),
            "duplicate commodity `gold`",
        ),
        (
            entry("").replace("metal_price", "nope"),
            "not a known provider",
        ),
        (entry("").replace("XAU", "xau"), "`asset` must match"),
        (entry("").replace("XAU", &"X".repeat(17)), "`asset` must match"),
        (
            entry(&format!(r#","benchmark":"{}""#, "B".repeat(33))),
            "`benchmark` must match",
        ),
        (entry(r#","benchmark":"A-B""#), "`benchmark` must match"),
        (
            entry("").replace(r#","quote_unit":"TroyOz""#, ""),
            "`quote_unit` is required for StandardGoods",
        ),
        (
            r#"[{"commodity":"x","mode":"MetalConcentrate","asset":"XAU","price_provider":"metal_price","quote_unit":"Mt"}]"#.to_owned(),
            "must be absent or TroyOz",
        ),
        (entry(r#","extra":1"#), "unknown field"),
        (
            entry("").replace("gold", "g\u{f6}ld"),
            "`commodity` must be 1-64 ASCII bytes",
        ),
        (entry("").replace("\"gold\"", "\"\""), "`commodity` must be 1-64"),
        (entry("").replace("\"gold\"", &format!("\"{}\"", "g".repeat(65))), "`commodity` must be 1-64"),
        (entry("").replace("StandardGoods", "Other"), "not a valid mapping array"),
    ];
    for (json, needle) in cases {
        let msg = parse_err(&json);
        assert!(msg.contains("SECURITY_MARK_COMMODITIES"), "{msg}");
        assert!(msg.contains(needle), "{needle} not in {msg}");
    }
}

#[test]
fn too_many_entries_or_bytes_fail() {
    let one = r#"{"commodity":"c0","mode":"StandardGoods","asset":"XAU","price_provider":"metal_price","quote_unit":"TroyOz"}"#;
    let many: Vec<String> = (0..65)
        .map(|i| one.replace("c0", &format!("c{i}")))
        .collect();
    let msg = parse_err(&format!("[{}]", many.join(",")));
    assert!(msg.contains("more than 64 entries"), "{msg}");
    let ok: Vec<String> = (0..64)
        .map(|i| one.replace("c0", &format!("c{i}")))
        .collect();
    assert!(MarkSettings::parse(Some(&format!("[{}]", ok.join(","))), None, None).is_ok());
    let big = format!("[{}]", " ".repeat(16 * 1024));
    let msg = parse_err(&big);
    assert!(
        msg.contains("SECURITY_MARK_COMMODITIES exceeds 16384 bytes"),
        "{msg}"
    );
}

#[test]
fn policy_values_parse_or_fail_naming_the_key() {
    let s = MarkSettings::parse(None, Some("0"), Some("0")).unwrap();
    assert_eq!(s.policy, policy(0, 0));
    let s = MarkSettings::parse(None, Some(" 3600 "), Some("50")).unwrap();
    assert_eq!(s.policy, policy(3600, 50));
    let s = MarkSettings::parse(None, Some(""), Some("  ")).unwrap();
    assert_eq!(s.policy, policy(86_400, 200));
    let e = MarkSettings::parse(None, Some("abc"), None).unwrap_err();
    assert!(e.to_string().contains("SECURITY_MARK_MAX_AGE_SECS"));
    let e = MarkSettings::parse(None, None, Some("-1")).unwrap_err();
    assert!(e.to_string().contains("SECURITY_MARK_MOVE_BPS"));
    let e = MarkSettings::parse(None, None, Some("1.5")).unwrap_err();
    assert!(e.to_string().contains("SECURITY_MARK_MOVE_BPS"));
}

fn pair(asset: &str) -> (String, String) {
    (asset.to_owned(), "metal_price".to_owned())
}

#[test]
fn mark_pairs_dedupe_and_expand_concentrate_metals() {
    let m = map();
    let items = vec![
        (m.get("gold").unwrap(), vec![]),
        (m.get("copper cathode").unwrap(), vec!["gold"]),
        (
            m.get("gold pyrite concentrate").unwrap(),
            vec!["gold", "silver", "unobtainium"],
        ),
    ];
    assert_eq!(
        mark_pairs(items),
        vec![pair("XAU"), pair("XCU"), pair("XAG")]
    );
}

#[test]
fn mark_pairs_cap_the_metal_list() {
    let m = map();
    let mut metals = vec!["gold"; shared::security_marks::MAX_PAYABLE_TERMS];
    metals.push("silver");
    let items = vec![(m.get("gold pyrite concentrate").unwrap(), metals)];
    assert_eq!(mark_pairs(items), vec![pair("XAU")]);
}

fn one_hundred_digit_price() -> BigDecimal {
    BigDecimal::from_str(&format!("0.{}", "6".repeat(99))).unwrap()
}

#[test]
fn a_long_scale_price_is_truncated_not_rejected() {
    let price = one_hundred_digit_price();
    assert_eq!(price.as_bigint_and_exponent().1, 99);
    let got = bounded_dec(&price).unwrap();
    assert_eq!(got.as_bigint_and_exponent().1, 18);
    assert_eq!(plain(&got), "0.666666666666666666");
    assert_eq!(standard_vpu_raw(&price, (1, 1)), Some(6_666_666));
    let m = map();
    let p: PriceMap = HashMap::from([(
        ("XZN".to_owned(), "metal_price".to_owned()),
        (price, at(PRICE_TS)),
    )]);
    let s = suggest(&ctx(&m, &p, None), "zinc", "Mt").unwrap();
    assert_eq!(s.value_per_unit, 6_666_666);
}

#[test]
fn a_long_scale_negative_scale_mix_still_computes() {
    let price = BigDecimal::new(BigInt::from(125), -8);
    assert_eq!(
        standard_vpu_raw(&price, (1, 1)),
        Some(125i128 * 10i128.pow(15))
    );
}

#[test]
fn a_long_scale_metal_price_feeds_the_concentrate() {
    let mut px = asset_prices(&[]);
    px.insert(
        "XAU".to_owned(),
        BigDecimal::from_str(&format!("4000.{}", "1".repeat(95))).unwrap(),
    );
    let via_long = concentrate_vpu_raw(&assay(), &offtake(), &px).unwrap();
    let via_plain = concentrate_vpu_raw(
        &assay(),
        &offtake(),
        &asset_prices(&[("XAU", "4000.111111111111111111")]),
    )
    .unwrap();
    assert_eq!(via_long, via_plain);
}

#[test]
fn an_unreadable_metal_price_is_unreadable_not_no_price() {
    let m = map();
    let mut p = prices(&[("XAU", "4000")]);
    p.insert(
        ("XAG".to_owned(), "metal_price".to_owned()),
        (BigDecimal::new(BigInt::from(1), -999_999_999), at(PRICE_TS)),
    );
    let (a, o) = (gold_silver_assay(), gold_silver_offtake());
    assert_eq!(
        suggest(
            &ctx(&m, &p, Some((&a, &o))),
            "gold pyrite concentrate",
            "Dmt"
        )
        .unwrap_err(),
        SuggestionStatus::Unreadable
    );
}

#[test]
fn the_commodity_map_parses_without_the_policy_keys() {
    assert!(CommodityMap::parse_optional(None).unwrap().is_empty());
    assert!(CommodityMap::parse_optional(Some("  ")).unwrap().is_empty());
    assert_eq!(
        CommodityMap::parse_optional(Some(MAP_JSON)).unwrap().len(),
        6
    );
    let err = CommodityMap::parse_optional(Some("nope")).unwrap_err();
    assert!(err.to_string().contains("SECURITY_MARK_COMMODITIES"));
    assert!(MarkSettings::parse(Some(MAP_JSON), Some("abc"), None).is_err());
}
