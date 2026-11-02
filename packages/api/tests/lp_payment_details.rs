// spec: docs/product-specs/deposits.md#lp-funding-details

use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use async_trait::async_trait;
use pipeline_api::error::ApiError;
use pipeline_api::routes::lp_bank_deposits::{
    issue_payment_details, payment_details_access, payment_details_from, payment_details_reply,
    request_payment_details, LpBankDepositsDoc, PaymentDetailsResponse, MAX_ISSUE_ATTEMPTS,
};
use shared::lp_repo::KybStatus;
use shared::lp_requested_bank_details_repo::{InsertOutcome, PaymentDetailsStore};
use shared::system_configuration_repo::{BankDetailsSource, SystemBankDetails};

const ADDR: &str = "GABC";
const CROCKFORD: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PATH: &str = "/v1/lps/me/payment-details";

// ── Fakes ────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct FakeStore {
    rows: Mutex<Vec<(i64, String)>>,
    fail_with_pool_timeout: bool,
}

impl FakeStore {
    fn seeded(rows: &[(i64, &str)]) -> Self {
        Self {
            rows: Mutex::new(rows.iter().map(|(l, v)| (*l, (*v).to_owned())).collect()),
            fail_with_pool_timeout: false,
        }
    }

    fn rows(&self) -> Vec<(i64, String)> {
        self.rows.lock().unwrap().clone()
    }

    fn count_for(&self, lp_id: i64) -> usize {
        self.rows().iter().filter(|(l, _)| *l == lp_id).count()
    }
}

#[async_trait]
impl PaymentDetailsStore for FakeStore {
    async fn insert(
        &self,
        lp_id: i64,
        payment_details: &str,
    ) -> Result<InsertOutcome, sqlx::Error> {
        if self.fail_with_pool_timeout {
            return Err(sqlx::Error::PoolTimedOut);
        }
        let mut rows = self.rows.lock().unwrap();
        if rows.iter().any(|(_, v)| v == payment_details) {
            return Ok(InsertOutcome::ReferenceTaken);
        }
        rows.push((lp_id, payment_details.to_owned()));
        Ok(InsertOutcome::Inserted)
    }
}

enum BankMode {
    Present(SystemBankDetails),
    Missing,
    Broken,
}

struct FakeBankDetails {
    mode: BankMode,
    reads: AtomicUsize,
}

impl FakeBankDetails {
    fn new(mode: BankMode) -> Self {
        Self {
            mode,
            reads: AtomicUsize::new(0),
        }
    }

    fn reads(&self) -> usize {
        self.reads.load(Ordering::SeqCst)
    }
}

#[async_trait]
impl BankDetailsSource for FakeBankDetails {
    async fn bank_details(&self) -> anyhow::Result<Option<SystemBankDetails>> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        match &self.mode {
            BankMode::Present(d) => Ok(Some(d.clone())),
            BankMode::Missing => Ok(None),
            BankMode::Broken => Err(anyhow::anyhow!("malformed")),
        }
    }
}

fn empty_details() -> SystemBankDetails {
    SystemBankDetails {
        company_name: String::new(),
        bank_name: String::new(),
        bank_address: String::new(),
        account_number: String::new(),
        iban: String::new(),
        swift_bic_code: String::new(),
    }
}

fn filled_details() -> SystemBankDetails {
    SystemBankDetails {
        company_name: "Pipeline Trust".to_owned(),
        bank_name: "Bank".to_owned(),
        bank_address: String::new(),
        account_number: "123".to_owned(),
        iban: "DE00".to_owned(),
        swift_bic_code: "ABCDEF22".to_owned(),
    }
}

struct Scripted {
    values: Vec<String>,
    calls: usize,
}

impl Scripted {
    fn new(values: &[&str]) -> Self {
        Self {
            values: values.iter().map(|v| (*v).to_owned()).collect(),
            calls: 0,
        }
    }

    fn next(&mut self) -> String {
        let v = self.values[self.calls.min(self.values.len() - 1)].clone();
        self.calls += 1;
        v
    }
}

fn counter() -> impl FnMut() -> String {
    let mut n = 0u64;
    move || {
        n += 1;
        payment_details_from(n)
    }
}

// ── Access gate ──────────────────────────────────────────────────────────────

#[test]
fn passed_with_an_address_is_allowed() {
    assert!(payment_details_access(KybStatus::Passed, Some(ADDR)).is_ok());
}

#[test]
fn passed_without_an_address_names_the_settlement_address() {
    let err = payment_details_access(KybStatus::Passed, None).unwrap_err();
    assert!(err.contains("settlement address"), "{err}");
}

#[test]
fn every_other_status_is_refused_naming_the_status_and_passed() {
    for status in KybStatus::ALL
        .into_iter()
        .filter(|s| *s != KybStatus::Passed)
    {
        let err = payment_details_access(status, Some(ADDR)).unwrap_err();
        assert!(err.contains(&status.to_string()), "{err}");
        assert!(err.contains("Passed"), "{err}");
    }
}

#[test]
fn not_started_without_an_address_names_both_preconditions() {
    let err = payment_details_access(KybStatus::NotStarted, None).unwrap_err();
    assert!(err.contains("settlement address"), "{err}");
    assert!(err.contains("Passed"), "{err}");
}

// ── Generator ────────────────────────────────────────────────────────────────

#[test]
fn generator_matches_fixed_vectors() {
    assert_eq!(payment_details_from(0), "PL-0000-0000-0000");
    assert_eq!(payment_details_from(1), "PL-0000-0000-0001");
    assert_eq!(payment_details_from(32), "PL-0000-0000-0010");
    assert_eq!(payment_details_from((1 << 60) - 1), "PL-ZZZZ-ZZZZ-ZZZZ");
}

#[test]
fn generator_ignores_the_high_four_bits() {
    assert_eq!(payment_details_from(0xF << 60), payment_details_from(0));
}

fn sweep() -> Vec<u64> {
    let mut inputs = vec![u64::MAX, 0, 0xAAAA_AAAA_AAAA_AAAA, 0x5555_5555_5555_5555];
    let mut x: u64 = 0x1234_5678_9ABC_DEF0;
    for _ in 0..1000 {
        x = x
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        inputs.push(x);
    }
    inputs
}

#[test]
fn generator_output_is_well_formed_over_a_sweep() {
    for input in sweep() {
        let value = payment_details_from(input);
        assert_eq!(value.len(), 17, "{value}");
        let groups: Vec<&str> = value.split('-').collect();
        assert_eq!(groups.len(), 4, "{value}");
        assert_eq!(groups[0], "PL");
        for group in &groups[1..] {
            assert_eq!(group.len(), 4, "{value}");
            assert!(group.chars().all(|c| CROCKFORD.contains(c)), "{value}");
        }
        assert!(
            !value[3..]
                .chars()
                .any(|c| matches!(c, 'I' | 'L' | 'O' | 'U')),
            "{value}"
        );
        assert!(
            value
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-'),
            "{value}"
        );
    }
}

#[test]
fn generator_is_injective_over_the_sweep() {
    let mask = (1u64 << 60) - 1;
    let inputs: HashSet<u64> = sweep().into_iter().map(|i| i & mask).collect();
    let outputs: HashSet<String> = inputs.iter().map(|i| payment_details_from(*i)).collect();
    assert_eq!(inputs.len(), outputs.len());
}

// ── Issuance ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn every_call_returns_a_new_value() {
    let store = FakeStore::default();
    let mut calls = 0;
    let mut next = counter();
    let mut generator = || {
        calls += 1;
        next()
    };
    let mut values = Vec::new();
    for _ in 0..3 {
        values.push(
            issue_payment_details(&store, 1, &mut generator)
                .await
                .unwrap(),
        );
    }
    let distinct: HashSet<&String> = values.iter().collect();
    assert_eq!(distinct.len(), 3);
    assert_eq!(calls, 3);
    let rows = store.rows();
    assert_eq!(rows.len(), 3);
    for (row, value) in rows.iter().zip(&values) {
        assert_eq!(row, &(1, value.clone()));
    }
}

#[tokio::test]
async fn rows_accumulate_per_lp_and_never_share_a_value() {
    let store = FakeStore::default();
    let mut next = counter();
    for lp in [1, 2, 1] {
        issue_payment_details(&store, lp, &mut next).await.unwrap();
    }
    assert_eq!(store.count_for(1), 2);
    assert_eq!(store.count_for(2), 1);
    let rows = store.rows();
    let distinct: HashSet<&String> = rows.iter().map(|(_, v)| v).collect();
    assert_eq!(distinct.len(), 3);
}

#[tokio::test]
async fn a_collision_is_redrawn() {
    let store = FakeStore::seeded(&[(2, "PL-AAAA-AAAA-AAAA")]);
    let mut script = Scripted::new(&["PL-AAAA-AAAA-AAAA", "PL-BBBB-BBBB-BBBB"]);
    let value = issue_payment_details(&store, 1, || script.next())
        .await
        .unwrap();
    assert_eq!(value, "PL-BBBB-BBBB-BBBB");
    assert_eq!(store.rows().len(), 2);
    assert_eq!(store.count_for(1), 1);
}

#[tokio::test]
async fn exhausting_every_attempt_is_internal_and_adds_no_row() {
    let store = FakeStore::seeded(&[(2, "PL-AAAA-AAAA-AAAA")]);
    let mut script = Scripted::new(&["PL-AAAA-AAAA-AAAA"]);
    let err = issue_payment_details(&store, 1, || script.next())
        .await
        .unwrap_err();
    assert!(matches!(err, ApiError::Internal(_)), "{err:?}");
    assert_eq!(script.calls, MAX_ISSUE_ATTEMPTS);
    assert_eq!(store.rows().len(), 1);
}

#[tokio::test]
async fn another_store_error_propagates_without_a_retry() {
    let store = FakeStore {
        fail_with_pool_timeout: true,
        ..FakeStore::default()
    };
    let mut script = Scripted::new(&["PL-AAAA-AAAA-AAAA"]);
    let err = issue_payment_details(&store, 1, || script.next())
        .await
        .unwrap_err();
    assert!(matches!(err, ApiError::Internal(_)), "{err:?}");
    assert_eq!(script.calls, 1);
}

// ── Orchestration ────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_refused_caller_creates_no_row_and_reads_nothing() {
    for (status, address) in [
        (KybStatus::UnderReview, Some(ADDR)),
        (KybStatus::Passed, None),
    ] {
        let bank = FakeBankDetails::new(BankMode::Present(filled_details()));
        let store = FakeStore::default();
        let mut script = Scripted::new(&["PL-AAAA-AAAA-AAAA"]);
        let err = request_payment_details(&bank, &store, 1, status, address, || script.next())
            .await
            .unwrap_err();
        assert!(matches!(err, ApiError::Conflict(_)), "{err:?}");
        assert!(store.rows().is_empty());
        assert_eq!(script.calls, 0);
        assert_eq!(bank.reads(), 0);
    }
}

#[tokio::test]
async fn a_misconfigured_system_creates_no_row() {
    for mode in [BankMode::Missing, BankMode::Broken] {
        let bank = FakeBankDetails::new(mode);
        let store = FakeStore::default();
        let mut script = Scripted::new(&["PL-AAAA-AAAA-AAAA"]);
        let err = request_payment_details(&bank, &store, 1, KybStatus::Passed, Some(ADDR), || {
            script.next()
        })
        .await
        .unwrap_err();
        assert!(matches!(err, ApiError::Internal(_)), "{err:?}");
        assert!(store.rows().is_empty());
        assert_eq!(script.calls, 0);
    }
}

#[tokio::test]
async fn the_happy_path_serves_the_bank_fields_and_the_stored_reference() {
    let bank = FakeBankDetails::new(BankMode::Present(filled_details()));
    let store = FakeStore::default();
    let response =
        request_payment_details(&bank, &store, 7, KybStatus::Passed, Some(ADDR), counter())
            .await
            .unwrap();
    assert_eq!(response.company_name, "Pipeline Trust");
    assert_eq!(response.bank_address, "");
    assert_eq!(response.swift_bic_code, "ABCDEF22");
    assert_eq!(store.rows(), vec![(7, response.payment_details.clone())]);
}

#[tokio::test]
async fn two_requests_give_two_references_and_the_same_bank_fields() {
    let bank = FakeBankDetails::new(BankMode::Present(filled_details()));
    let store = FakeStore::default();
    let mut next = counter();
    let first = request_payment_details(&bank, &store, 7, KybStatus::Passed, Some(ADDR), &mut next)
        .await
        .unwrap();
    let second =
        request_payment_details(&bank, &store, 7, KybStatus::Passed, Some(ADDR), &mut next)
            .await
            .unwrap();
    assert_ne!(first.payment_details, second.payment_details);
    assert_eq!(first.iban, second.iban);
    assert_eq!(first.account_number, second.account_number);
    assert_eq!(store.count_for(7), 2);
}

// ── Response shape and reply ─────────────────────────────────────────────────

const SEVEN_KEYS: [&str; 7] = [
    "company_name",
    "bank_name",
    "bank_address",
    "account_number",
    "iban",
    "swift_bic_code",
    "payment_details",
];

#[test]
fn the_response_has_exactly_seven_string_keys_and_keeps_empty_strings() {
    let value = serde_json::to_value(PaymentDetailsResponse::new(
        empty_details(),
        "PL-AAAA-AAAA-AAAA".to_owned(),
    ))
    .unwrap();
    let object = value.as_object().unwrap();
    assert_eq!(object.len(), 7);
    for key in SEVEN_KEYS {
        assert!(object.contains_key(key), "missing {key}");
    }
    assert_eq!(object["iban"], "");
    assert!(!object.contains_key("swift_bic"));
}

#[tokio::test]
async fn the_reply_is_ok_and_never_cacheable() {
    let response = payment_details_reply(PaymentDetailsResponse::new(
        empty_details(),
        "PL-AAAA-AAAA-AAAA".to_owned(),
    ));
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(axum::http::header::CACHE_CONTROL)
            .unwrap(),
        "no-store"
    );
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["payment_details"], "PL-AAAA-AAAA-AAAA");
    assert_eq!(body.as_object().unwrap().len(), 7);
}

// ── OpenAPI document ─────────────────────────────────────────────────────────

fn openapi_json() -> serde_json::Value {
    serde_json::to_value(<LpBankDepositsDoc as utoipa::OpenApi>::openapi())
        .expect("a serializable document")
}

#[test]
fn the_path_is_a_bodyless_get_tagged_lp_bank_deposits() {
    let doc = openapi_json();
    let path = &doc["paths"][PATH];
    let get = &path["get"];
    assert!(get.is_object(), "GET {PATH} missing");
    assert_eq!(get["tags"][0], "LpBankDeposits");
    assert!(path.get("post").is_none());
    assert!(get.get("requestBody").is_none());
    assert!(get
        .get("parameters")
        .is_none_or(|p| p.as_array().is_some_and(Vec::is_empty)));
}

#[test]
fn the_documented_responses_are_200_401_404_409() {
    let doc = openapi_json();
    let responses = doc["paths"][PATH]["get"]["responses"].as_object().unwrap();
    for status in ["200", "401", "404", "409"] {
        assert!(responses.contains_key(status), "missing {status}");
    }
    assert!(!responses.contains_key("201"));
}

#[test]
fn the_schema_lists_seven_required_string_properties() {
    let doc = openapi_json();
    let schema = &doc["components"]["schemas"]["PaymentDetailsResponse"];
    let required: HashSet<&str> = schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    for key in SEVEN_KEYS {
        assert_eq!(schema["properties"][key]["type"], "string", "{key}");
        assert!(required.contains(key), "{key} not required");
    }
    assert_eq!(schema["properties"].as_object().unwrap().len(), 7);
}
