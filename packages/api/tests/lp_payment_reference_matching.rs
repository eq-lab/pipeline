// spec: docs/product-specs/deposits.md#wire-matching-by-payment-reference

use std::sync::atomic::{AtomicUsize, Ordering};

use async_trait::async_trait;
use chrono::Utc;

use pipeline_api::error::ApiError;
use pipeline_api::routes::lp_bank_deposits::{
    canonical_payment_details, lp_id_for_payment_details, payment_details_from,
    resolve_payment_details, RecordBankDepositValues,
};
use shared::lp_requested_bank_details_repo::{IssuedReferenceLookup, IssuedReferenceRow};

const ISSUED: &str = "PL-7K3M-Q9TX-H2CD";

struct Fake {
    row: Option<IssuedReferenceRow>,
    fail: bool,
    calls: AtomicUsize,
}

impl Fake {
    fn issued_to(lp_id: i64) -> Self {
        Self::with_chain(lp_id, Some(99_000_001))
    }
    fn with_chain(lp_id: i64, chain_id: Option<i64>) -> Self {
        Self {
            row: Some(IssuedReferenceRow {
                id: 5,
                lp_id,
                payment_details: ISSUED.to_owned(),
                chain_id,
                receiver_address: chain_id.map(|_| "GABC".to_owned()),
                created_at: Utc::now(),
            }),
            fail: false,
            calls: AtomicUsize::new(0),
        }
    }
    fn empty() -> Self {
        Self {
            row: None,
            fail: false,
            calls: AtomicUsize::new(0),
        }
    }
    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

#[async_trait]
impl IssuedReferenceLookup for Fake {
    async fn find_by_payment_details(
        &self,
        canonical: &str,
    ) -> Result<Option<IssuedReferenceRow>, sqlx::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            return Err(sqlx::Error::PoolClosed);
        }
        Ok(self.row.clone().filter(|r| r.payment_details == canonical))
    }
}

fn values(payment_details: Option<&str>, payment_reference: &str) -> RecordBankDepositValues {
    RecordBankDepositValues {
        amount: "1".parse().unwrap(),
        payment_reference: payment_reference.to_owned(),
        payment_details: payment_details.map(str::to_owned),
        ref_hash: [1; 32],
        occurred_at: Utc::now(),
    }
}

// ── canonical_payment_details ────────────────────────────────────────────────

#[test]
fn the_canonical_form_maps_to_itself() {
    assert_eq!(canonical_payment_details(ISSUED).unwrap(), ISSUED);
}

#[test]
fn case_hyphens_and_whitespace_are_ignored() {
    for raw in [
        "pl-7k3m-q9tx-h2cd",
        "PL7K3MQ9TXH2CD",
        "  PL-7K3M-Q9TX-H2CD  ",
        "PL 7K3M Q9TX H2CD",
        "PL-7K3M Q9TX-H2CD",
        "P L7K3M\tQ9TX\nH2CD",
    ] {
        assert_eq!(canonical_payment_details(raw).unwrap(), ISSUED, "{raw:?}");
    }
}

#[test]
fn crockford_aliases_apply_to_the_symbols_only() {
    assert_eq!(
        canonical_payment_details("PL-OOII-LL00-0000").unwrap(),
        "PL-0011-1100-0000"
    );
    assert_eq!(
        canonical_payment_details("pl-oo00-0000-0000").unwrap(),
        "PL-0000-0000-0000"
    );
}

#[test]
fn malformed_references_are_refused() {
    let too_long = format!("{ISSUED}{}", " ".repeat(130));
    for raw in [
        "",
        "   ",
        "XX-7K3M-Q9TX-H2CD",
        "PL-7K3M-Q9TX-H2C",
        "PL-7K3M-Q9TX-H2CDE",
        "PL-7K3M-Q9TX-H2CU",
        "PL-7K3M-Q9TX-H2C!",
        "PL-7K3M-Q9TX-H2C_",
        "PL-7K3M-Q9TX-H2Cé",
        "PL-7K3M-Q9TX-H2Cı",
        "PL-7K3M-Q9TX-H2Cſ",
        "PL-7K3M-Q9TX-H2Cß",
        "ſ-7K3M-Q9TX-H2CD",
        too_long.as_str(),
    ] {
        assert!(canonical_payment_details(raw).is_err(), "{raw:?}");
    }
}

#[test]
fn the_canonicaliser_round_trips_the_generator() {
    for r in [
        0u64,
        1,
        u64::MAX,
        0x0123_4567_89ab_cdef,
        0xfedc_ba98_7654_3210,
        1 << 59,
        (1 << 60) - 1,
    ] {
        let issued = payment_details_from(r);
        assert_eq!(canonical_payment_details(&issued).unwrap(), issued);
    }
}

// ── resolve_payment_details ──────────────────────────────────────────────────

#[tokio::test]
async fn omitted_payment_details_with_a_plain_reference_looks_nothing_up() {
    let fake = Fake::issued_to(7);
    let got = resolve_payment_details(&fake, 7, &values(None, "WIRE-1")).await;
    assert!(matches!(got, Ok(None)));
    assert_eq!(fake.calls(), 0);
}

#[tokio::test]
async fn a_reference_issued_to_this_lp_is_returned() {
    let fake = Fake::issued_to(7);
    let row = resolve_payment_details(&fake, 7, &values(Some(ISSUED), "WIRE-1"))
        .await
        .unwrap()
        .expect("a row");
    assert_eq!(row.id, 5);
}

#[tokio::test]
async fn an_unissued_reference_is_a_422_naming_it() {
    let fake = Fake::empty();
    let got = resolve_payment_details(&fake, 7, &values(Some(ISSUED), "WIRE-1")).await;
    match got {
        Err(ApiError::UnprocessableEntity(msg)) => assert!(msg.contains(ISSUED), "{msg}"),
        other => panic!("expected 422, got {other:?}"),
    }
}

#[tokio::test]
async fn a_reference_issued_to_another_lp_is_a_422_naming_both() {
    let fake = Fake::issued_to(12);
    let got = resolve_payment_details(&fake, 7, &values(Some(ISSUED), "WIRE-1")).await;
    match got {
        Err(ApiError::UnprocessableEntity(msg)) => {
            assert!(msg.contains("LP 12") && msg.contains("LP 7"), "{msg}");
        }
        other => panic!("expected 422, got {other:?}"),
    }
}

#[tokio::test]
async fn a_legacy_row_without_a_chain_passes_through() {
    let fake = Fake::with_chain(7, None);
    let row = resolve_payment_details(&fake, 7, &values(Some(ISSUED), "WIRE-1"))
        .await
        .unwrap()
        .expect("a row");
    assert!(row.chain_id.is_none() && row.receiver_address.is_none());
}

#[tokio::test]
async fn a_lookup_failure_is_internal() {
    let mut fake = Fake::issued_to(7);
    fake.fail = true;
    let got = resolve_payment_details(&fake, 7, &values(Some(ISSUED), "WIRE-1")).await;
    assert!(matches!(got, Err(ApiError::Internal(_))), "{got:?}");
}

#[tokio::test]
async fn a_bank_reference_that_is_an_issued_reference_is_refused() {
    let fake = Fake::issued_to(7);
    for reference in [ISSUED, "pl7k3mq9txh2cd"] {
        let got = resolve_payment_details(&fake, 7, &values(Some(ISSUED), reference)).await;
        match got {
            Err(ApiError::UnprocessableEntity(msg)) => {
                assert!(msg.contains("payment_reference"), "{msg}");
            }
            other => panic!("expected 422, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn a_format_shaped_but_unissued_bank_reference_is_accepted() {
    let fake = Fake::issued_to(7);
    let got = resolve_payment_details(&fake, 7, &values(None, "PL-AAAA-BBBB-CCCC")).await;
    assert!(matches!(got, Ok(None)));
    assert_eq!(fake.calls(), 1);
}

// ── lp_id_for_payment_details (the GET /v1/lps filter) ───────────────────────

#[tokio::test]
async fn the_filter_refuses_a_malformed_reference() {
    let got = lp_id_for_payment_details(&Fake::empty(), "nope").await;
    assert!(matches!(got, Err(ApiError::BadRequest(_))), "{got:?}");
}

#[tokio::test]
async fn the_filter_is_none_for_an_unknown_reference() {
    let got = lp_id_for_payment_details(&Fake::empty(), ISSUED).await;
    assert!(matches!(got, Ok(None)));
}

#[tokio::test]
async fn the_filter_finds_the_owner_from_a_sloppy_reference() {
    let got = lp_id_for_payment_details(&Fake::issued_to(7), "pl7k3mq9txh2cd").await;
    assert!(matches!(got, Ok(Some(7))));
}
