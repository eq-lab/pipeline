use pipeline_api::routes::loan_book::{
    borrower_ref_hex, draw_loan_args, draw_loan_for, usdc_to_base_units, SubmissionView,
    STELLAR_LOAN_MONEY_DECIMALS,
};
use serde_json::{json, Value};
use shared::chains::ChainKind;
use shared::submitted_loan_repo::SubmittedLoanRow;

const DR_0001: &str = "aeaa7d34d7793d5e132013aa6ef9bdc6623cc3c0ece3a723edd4887316b7d5d7";

fn complete() -> Value {
    json!({
        "metadata_uri": "ipfs://Qm_doc",
        "data_room_id": "DR-0001",
        "economics": {
            "original_facility_size": "100000.000000",
            "original_senior_tranche": "80000.000000",
            "original_equity_tranche": "20000.000000",
            "original_offtaker_price": "105000.000000",
            "senior_interest_rate_bps": 1200,
            "origination_date": 1_700_000_000_u64,
            "original_maturity_date": 1_715_000_000_u64
        }
    })
}

fn row(loan_data: Value) -> SubmittedLoanRow {
    SubmittedLoanRow {
        id: 1,
        loan_data,
        status: "InReview".to_owned(),
        reason: None,
        originator: "GORIGINATOR".to_owned(),
        target_chain_id: 7,
        chain_id: None,
        loan_id: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

#[test]
fn borrower_ref_known_vector() {
    assert_eq!(borrower_ref_hex("DR-0001").as_deref(), Some(DR_0001));
}

#[test]
fn borrower_ref_trims_whitespace() {
    assert_eq!(borrower_ref_hex("  DR-0001\t\n").as_deref(), Some(DR_0001));
}

#[test]
fn borrower_ref_hashes_utf8_bytes() {
    assert_eq!(
        borrower_ref_hex("Data-Room-\u{00dc}n\u{00ef}").as_deref(),
        Some("ef1fb63e931b9e2743158911a490fcc9e15619eb3f33671edb7f94c786776ee1")
    );
}

#[test]
fn borrower_ref_empty_is_none() {
    assert_eq!(borrower_ref_hex(""), None);
    assert_eq!(borrower_ref_hex("  "), None);
}

#[test]
fn borrower_ref_is_64_lowercase_hex_without_prefix() {
    let h = borrower_ref_hex("anything").unwrap();
    assert_eq!(h.len(), 64);
    assert!(h
        .chars()
        .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
}

#[test]
fn served_economics_has_exactly_immutable_loan_data_fields() {
    let v = serde_json::to_value(draw_loan_args(&complete()).economics).unwrap();
    let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut want = vec![
        "borrower_ref",
        "original_facility_size",
        "original_senior_tranche",
        "original_equity_tranche",
        "original_offtaker_price",
        "senior_interest_rate",
        "origination_date",
        "original_maturity_date",
    ];
    want.sort_unstable();
    assert_eq!(keys, want);
    let empty = serde_json::to_value(draw_loan_args(&json!({})).economics).unwrap();
    assert_eq!(empty.as_object().unwrap().len(), 8);
}

#[test]
fn stellar_units_match_contract() {
    let a = draw_loan_args(&complete());
    let e = &a.economics;
    assert_eq!(a.metadata_uri.as_deref(), Some("ipfs://Qm_doc"));
    assert_eq!(e.borrower_ref.as_deref(), Some(DR_0001));
    assert_eq!(e.original_facility_size.as_deref(), Some("1000000000000"));
    assert_eq!(e.original_senior_tranche.as_deref(), Some("800000000000"));
    assert_eq!(e.original_equity_tranche.as_deref(), Some("200000000000"));
    assert_eq!(e.original_offtaker_price.as_deref(), Some("1050000000000"));
    assert_eq!(e.senior_interest_rate, Some(120_000));
    assert_eq!(e.origination_date, Some(1_700_000_000));
    assert_eq!(e.original_maturity_date, Some(1_715_000_000));
    let p = |s: &Option<String>| s.as_ref().unwrap().parse::<u128>().unwrap();
    assert_eq!(
        p(&e.original_senior_tranche) + p(&e.original_equity_tranche),
        p(&e.original_facility_size)
    );
}

#[test]
fn evm_row_gets_null_draw_loan() {
    assert!(draw_loan_for(Some(ChainKind::Evm), &complete()).is_none());
    let evm = serde_json::to_value(SubmissionView::from_row(
        row(complete()),
        Some(ChainKind::Evm),
    ))
    .unwrap();
    let stellar = serde_json::to_value(SubmissionView::from_row(
        row(complete()),
        Some(ChainKind::Stellar),
    ))
    .unwrap();
    assert!(evm["draw_loan"].is_null());
    assert!(!stellar["draw_loan"].is_null());
    for k in [
        "status",
        "target_chain_id",
        "chain_id",
        "loan_id",
        "documents",
        "loan_data",
    ] {
        assert_eq!(evm[k], stellar[k], "{k} must not depend on chain kind");
    }
}

#[test]
fn stellar_row_gets_draw_loan() {
    assert!(draw_loan_for(Some(ChainKind::Stellar), &complete()).is_some());
}

#[test]
fn unconfigured_chain_gets_null_draw_loan() {
    assert!(draw_loan_for(None, &complete()).is_none());
}

#[test]
fn missing_data_room_id_yields_null_borrower_ref_and_missing_input() {
    let mut d = complete();
    d.as_object_mut().unwrap().remove("data_room_id");
    let a = draw_loan_args(&d);
    assert!(a.economics.borrower_ref.is_none());
    assert!(a.economics.original_facility_size.is_some());
    assert_eq!(a.missing_inputs, vec!["data_room_id"]);
}

#[test]
fn legacy_row_with_old_keys_serves_contract_shape() {
    let mut d = complete();
    let o = d.as_object_mut().unwrap();
    o.remove("data_room_id");
    o.insert("to".into(), "GADDR".into());
    o.insert("initial_ccr".into(), 1_500_000.into());
    o.insert(
        "initial_location".into(),
        json!({"location_type": "Vessel"}),
    );
    let a = draw_loan_args(&d);
    assert!(a.economics.borrower_ref.is_none());
    assert_eq!(
        a.economics.original_facility_size.as_deref(),
        Some("1000000000000")
    );
    let v = serde_json::to_value(&a).unwrap();
    assert!(v.get("to").is_none() && v["economics"].get("initial_ccr").is_none());
}

#[test]
fn complete_submission_has_no_missing_inputs() {
    assert!(draw_loan_args(&complete()).missing_inputs.is_empty());
}

#[test]
fn non_representable_amount_is_reported() {
    let too_big = "34028236692093846346337460743176821146";
    for bad in ["1.12345678", "-1", "abc", too_big] {
        let mut d = complete();
        d["economics"]["original_facility_size"] = json!(bad);
        let a = draw_loan_args(&d);
        assert!(a.economics.original_facility_size.is_none(), "{bad}");
        assert_eq!(
            a.missing_inputs,
            vec!["economics.original_facility_size"],
            "{bad}"
        );
    }
    let mut d = complete();
    d["economics"]["original_facility_size"] = json!("1.1234567");
    assert_eq!(
        draw_loan_args(&d)
            .economics
            .original_facility_size
            .as_deref(),
        Some("11234567")
    );
}

#[test]
fn rate_overflow_is_reported() {
    let mut d = complete();
    d["economics"]["senior_interest_rate_bps"] = json!(50_000_000);
    let a = draw_loan_args(&d);
    assert!(a.economics.senior_interest_rate.is_none());
    assert_eq!(a.missing_inputs, vec!["economics.senior_interest_rate_bps"]);
}

#[test]
fn missing_inputs_order_is_stable() {
    assert_eq!(
        draw_loan_args(&json!({})).missing_inputs,
        vec![
            "metadata_uri",
            "data_room_id",
            "economics.original_facility_size",
            "economics.original_senior_tranche",
            "economics.original_equity_tranche",
            "economics.original_offtaker_price",
            "economics.senior_interest_rate_bps",
            "economics.origination_date",
            "economics.original_maturity_date",
        ]
    );
}

#[test]
fn usdc_to_base_units_edge_cases() {
    let d = STELLAR_LOAN_MONEY_DECIMALS;
    assert_eq!(usdc_to_base_units("0", d).as_deref(), Some("0"));
    assert_eq!(usdc_to_base_units("1", d).as_deref(), Some("10000000"));
    assert_eq!(usdc_to_base_units("1.", d), None);
    assert_eq!(
        usdc_to_base_units("1.0000000", d).as_deref(),
        Some("10000000")
    );
    assert_eq!(usdc_to_base_units("1.000000000", d), None);
}

#[test]
fn large_values_are_plain_integer_strings() {
    let v = usdc_to_base_units("34028236692093846346337460743176821145", 7);
    assert_eq!(v, None);
    let ok = usdc_to_base_units("1000000000000000000000000", 7).unwrap();
    assert_eq!(ok, "10000000000000000000000000000000");
    assert!(!ok.contains('e') && !ok.contains('E'));
}

#[test]
fn malformed_or_extreme_strings_are_none() {
    for bad in [
        "1e9223372036854775800",
        "0e9223372036854775800",
        "1e9223372036854775807",
        "1e-9223372036854775808",
        "1_000",
        "+1",
        "-1",
        "1e3",
        ".5",
        "1.",
        " 1",
        "1 ",
        "",
        "0x10",
        "1.5.5",
    ] {
        assert_eq!(usdc_to_base_units(bad, 7), None, "{bad:?}");
    }
}

#[test]
fn u128_boundary() {
    let max = u128::MAX.to_string();
    let (int, frac) = max.split_at(max.len() - 7);
    let at_max = format!("{int}.{frac}");
    assert_eq!(
        usdc_to_base_units(&at_max, 7).as_deref(),
        Some(max.as_str())
    );
    let over = format!("{int}.{}", "9".repeat(7));
    assert_eq!(usdc_to_base_units(&over, 7), None);
    assert_eq!(usdc_to_base_units(&"9".repeat(40), 7), None);
}

#[test]
fn oversized_decimals_do_not_overflow() {
    assert_eq!(usdc_to_base_units("1", 40), None);
    assert_eq!(usdc_to_base_units("1", 0).as_deref(), Some("1"));
}

#[test]
fn drawn_or_rejected_rows_get_null_draw_loan() {
    let mut drawn = row(complete());
    drawn.loan_id = Some("3".parse().unwrap());
    drawn.chain_id = Some(7);
    let v =
        serde_json::to_value(SubmissionView::from_row(drawn, Some(ChainKind::Stellar))).unwrap();
    assert!(v["draw_loan"].is_null());
    let mut rejected = row(complete());
    rejected.status = "Rejected".to_owned();
    rejected.reason = Some("no".to_owned());
    let v =
        serde_json::to_value(SubmissionView::from_row(rejected, Some(ChainKind::Stellar))).unwrap();
    assert!(v["draw_loan"].is_null());
    for status in ["InReview", "Approved", "ChangesRequested"] {
        let mut r = row(complete());
        r.status = status.to_owned();
        let v =
            serde_json::to_value(SubmissionView::from_row(r, Some(ChainKind::Stellar))).unwrap();
        assert!(!v["draw_loan"].is_null(), "{status}");
    }
}
