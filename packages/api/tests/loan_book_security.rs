// spec: docs/product-specs/loan-security-state.md#loan-book-fields
use std::collections::HashMap;
use std::str::FromStr;

use bigdecimal::num_bigint::BigInt;
use bigdecimal::BigDecimal;
use pipeline_api::routes::loan_book::{
    attach_security, compute_loan_book, loan_ref, LoanBookDoc, LoanRef,
};
use pipeline_api::security_state::{
    build_security_response, loan_book_security_fields, LoanBookSecurityFields, MarkInputs,
};
use serde_json::{json, Value};
use shared::contract_logs_repo::LoanSnapshotRow;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};
use shared::security_registry::{TermsRow, ValuationRow};
use shared::security_registry_repo::{LoanBookSecurityRow, LoanSecurityRows};
use utoipa::OpenApi;

const DAY: i64 = 86_400;
const STELLAR: i64 = 99_000_001;
const EVM: i64 = 560_048;
const REGISTRY: &str = "CDTUMAT6QBBPUZQFTZWMPHXHVQSLPUWRPDHKVQEMEF2YKCV4QTSCSQVN";
const LOAN_REGISTRY: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";

fn dec(n: i64) -> BigDecimal {
    BigDecimal::from(n)
}

fn row(
    margin_call_at: Option<BigDecimal>,
    ltv_bps: Option<i64>,
    price_stale: Option<bool>,
) -> LoanBookSecurityRow {
    LoanBookSecurityRow {
        loan_id: 7,
        margin_call_at,
        ltv_bps,
        price_stale,
    }
}

#[test]
fn terms_and_valuation_are_read_verbatim() {
    let open = loan_book_security_fields(&row(Some(dec(1_762_400_000)), Some(6400), Some(true)));
    assert_eq!(
        open,
        LoanBookSecurityFields {
            ltv_bps: Some(6400),
            margin_call_open: Some(true),
            price_stale: Some(true),
        }
    );
    let closed = loan_book_security_fields(&row(Some(dec(0)), Some(0), Some(false)));
    assert_eq!(closed.margin_call_open, Some(false));
    assert_eq!(closed.ltv_bps, Some(0));
    assert_eq!(closed.price_stale, Some(false));
}

#[test]
fn ltv_sentinel_passes_through_and_out_of_range_clamps() {
    let sentinel = loan_book_security_fields(&row(None, Some(4_294_967_295), None));
    assert_eq!(sentinel.ltv_bps, Some(u32::MAX));
    let above = loan_book_security_fields(&row(None, Some(4_294_967_296), None));
    assert_eq!(above.ltv_bps, Some(u32::MAX));
    let below = loan_book_security_fields(&row(None, Some(-5), None));
    assert_eq!(below.ltv_bps, Some(0));
}

#[test]
fn terms_without_a_valuation_leave_the_valuation_fields_null() {
    let f = loan_book_security_fields(&row(Some(dec(0)), None, None));
    assert_eq!(f.ltv_bps, None);
    assert_eq!(f.price_stale, None);
    assert_eq!(f.margin_call_open, Some(false));
}

#[test]
fn a_valuation_without_terms_leaves_margin_call_open_null() {
    let f = loan_book_security_fields(&row(None, Some(6400), Some(false)));
    assert_eq!(f.margin_call_open, None);
    assert_eq!(f.ltv_bps, Some(6400));
}

#[test]
fn an_undecodable_margin_call_at_is_null() {
    for bad in [
        BigDecimal::from_str("1e999999999").unwrap(),
        dec(-1),
        BigDecimal::from_str("1e30").unwrap(),
    ] {
        let f = loan_book_security_fields(&row(Some(bad), Some(6400), Some(false)));
        assert_eq!(f.margin_call_open, None);
    }
}

fn terms(margin_call_at: BigDecimal) -> TermsRow {
    TermsRow {
        loan_id: 7,
        advance_ratio_bps: 8000,
        margin_call_ratio_bps: 8500,
        cure_period: dec(604_800),
        price_stale_after: dec(86_400),
        payment_term: "Lc".to_owned(),
        grace_period: dec(0),
        default_rate: 0,
        attestation_interval: dec(0),
        inspection_interval: dec(0),
        tolerance_bps: 200,
        grade_tolerance_bps: 100,
        margin_call_at,
        set_ledger: Some(123),
        complete: true,
    }
}

fn valuation(ltv_bps: i64, price_stale: bool) -> ValuationRow {
    ValuationRow {
        loan_id: 7,
        value: dec(125_000_000_000),
        stale_value: dec(0),
        flagged_value: dec(0),
        debt: dec(80_000_000_000),
        coverage_bps: 15_625,
        ltv_bps,
        margin_call_at: dec(0),
        cure_by: dec(0),
        price_stale,
        counted_records: json!([]),
        detail_ledger: 500,
        loan_registry: LOAN_REGISTRY.to_owned(),
        outstanding: dec(79_000_000_000),
        accrued_interest: dec(1_000_000_000),
        money_ledger: 501,
        source_log_id: 40,
    }
}

fn security_json(terms: &TermsRow, valuation: &ValuationRow) -> Value {
    let rows = LoanSecurityRows {
        terms: Some(terms.clone()),
        valuation: Some((
            valuation.clone(),
            chrono::DateTime::<chrono::Utc>::from_timestamp(1_762_400_000, 0).unwrap(),
        )),
        ..LoanSecurityRows::default()
    };
    serde_json::to_value(build_security_response(
        STELLAR,
        REGISTRY,
        "7",
        &rows,
        1_762_400_000,
        &MarkInputs::default(),
    ))
    .unwrap()
}

#[test]
fn the_list_fields_equal_the_security_endpoint_values() {
    for (mc, ltv, stale) in [
        (dec(0), 6400_i64, false),
        (dec(1_762_000_000), 9100, true),
        (dec(0), 4_294_967_295, false),
        (dec(0), 9_999_999_999, true),
    ] {
        let sec = security_json(&terms(mc.clone()), &valuation(ltv, stale));
        let f = loan_book_security_fields(&row(Some(mc), Some(ltv), Some(stale)));
        assert_eq!(json!(f.ltv_bps), sec["valuation"]["ltv_bps"]);
        assert_eq!(json!(f.margin_call_open), sec["margin_call"]["open"]);
        assert_eq!(json!(f.price_stale), sec["valuation"]["price_stale"]);
    }
}

fn make_loan(chain_id: i64, loan_id: i64) -> LoanSnapshotRow {
    let zero = || dec(0);
    LoanSnapshotRow {
        chain_id,
        loan_id: dec(loan_id),
        block_number: 0,
        log_index: 0,
        event_name: "LoanDrawn".to_owned(),
        block_timestamp: 0,
        snapshot: LoanSnapshot {
            originator: "Open Mineral".to_owned(),
            borrower_id: format!("borrower-{loan_id}"),
            commodity: "Copper".to_owned(),
            corridor: "cr".to_owned(),
            governing_law: "EN".to_owned(),
            protection: String::new(),
            metadata_uri: None,
            documents: Vec::new(),
            original_facility_size: dec(100_000_000_000),
            original_senior_tranche: dec(80_000_000_000),
            original_equity_tranche: dec(20_000_000_000),
            original_offtaker_price: zero(),
            senior_interest_rate_bps: 1200,
            origination_date: 0,
            original_maturity_date: 180 * DAY,
            next_economics_epochs_id: dec(1),
            next_repayment_id: zero(),
            status: "Performing".to_owned(),
            current_maturity_timestamp: 180 * DAY,
            current_rate: 1200,
            closure_reason: "None".to_owned(),
            carved_out: false,
            disbursed: dec(80_000_000_000),
            repaid: zero(),
            written_down: zero(),
            interest_adjustment: zero(),
            metadata_uri_onchain: String::new(),
            repayment: RepaymentSnapshot {
                offtaker_received: zero(),
                senior_principal_repaid: zero(),
                senior_interest: zero(),
                equity_distributed: zero(),
                mgmt_fee: zero(),
                perf_fee: zero(),
                oet_alloc: zero(),
            },
        },
    }
}

fn book(loans: &[LoanSnapshotRow]) -> pipeline_api::routes::loan_book::LoanBookResponse {
    compute_loan_book(
        loans,
        &[],
        10 * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
    )
}

fn fields(ltv: u32, open: bool, stale: bool) -> LoanBookSecurityFields {
    LoanBookSecurityFields {
        ltv_bps: Some(ltv),
        margin_call_open: Some(open),
        price_stale: Some(stale),
    }
}

fn entry<'a>(json: &'a Value, chain_id: i64, loan_id: &str) -> &'a Value {
    json["loans"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["chain_id"] == chain_id && e["loan_id"] == loan_id)
        .unwrap()
}

#[test]
fn attach_security_fills_only_the_matching_chain_and_loan() {
    let mut resp = book(&[
        make_loan(STELLAR, 1),
        make_loan(STELLAR, 2),
        make_loan(EVM, 1),
    ]);
    let mut by_loan: HashMap<LoanRef, LoanBookSecurityFields> = HashMap::new();
    by_loan.insert(loan_ref(STELLAR, &dec(1)), fields(6400, true, false));
    attach_security(&mut resp, &by_loan);
    let json = serde_json::to_value(&resp).unwrap();

    let hit = entry(&json, STELLAR, "1");
    assert_eq!(hit["ltv_bps"], 6400);
    assert_eq!(hit["margin_call_open"], true);
    assert_eq!(hit["price_stale"], false);

    for miss in [entry(&json, STELLAR, "2"), entry(&json, EVM, "1")] {
        for key in ["ltv_bps", "margin_call_open", "price_stale"] {
            assert!(miss.get(key).is_some(), "{key} key must be present");
            assert!(miss[key].is_null());
        }
    }
}

#[test]
fn overlapping_loan_ids_on_two_chains_each_get_their_own_values() {
    let other = STELLAR + 1;
    let mut resp = book(&[make_loan(STELLAR, 1), make_loan(other, 1)]);
    let mut by_loan: HashMap<LoanRef, LoanBookSecurityFields> = HashMap::new();
    by_loan.insert(loan_ref(STELLAR, &dec(1)), fields(6400, false, false));
    by_loan.insert(loan_ref(other, &dec(1)), fields(9100, true, true));
    attach_security(&mut resp, &by_loan);
    let json = serde_json::to_value(&resp).unwrap();
    assert_eq!(entry(&json, STELLAR, "1")["ltv_bps"], 6400);
    assert_eq!(entry(&json, other, "1")["ltv_bps"], 9100);
    assert_eq!(entry(&json, other, "1")["margin_call_open"], true);
}

#[test]
fn an_unattached_entry_serializes_the_keys_as_null() {
    let resp = book(&[make_loan(EVM, 1)]);
    let text = serde_json::to_string(&resp).unwrap();
    assert!(text.contains(
        "\"pocket\":null,\"ltv_bps\":null,\"margin_call_open\":null,\"price_stale\":null}"
    ));
}

#[test]
fn the_openapi_lists_the_fields_as_nullable_and_optional() {
    let doc = serde_json::to_value(LoanBookDoc::openapi()).unwrap();
    let schema = &doc["components"]["schemas"]["LoanBookEntry"];
    for key in ["ltv_bps", "margin_call_open", "price_stale"] {
        let prop = &schema["properties"][key];
        assert!(!prop.is_null(), "{key} missing from the schema");
        let nullable = prop["type"]
            .as_array()
            .is_some_and(|t| t.iter().any(|v| v == "null"));
        assert!(nullable, "{key} must be nullable: {prop}");
        let required = schema["required"].as_array().cloned().unwrap_or_default();
        assert!(
            !required.iter().any(|r| r == key),
            "{key} must not be required"
        );
    }
}

#[test]
fn sqlx_decimals_with_a_scale_decode_when_integral() {
    let scaled = BigDecimal::new(BigInt::from(1_762_400_000_000_i64), 3);
    let f = loan_book_security_fields(&row(Some(scaled), None, None));
    assert_eq!(f.margin_call_open, Some(true));
}
