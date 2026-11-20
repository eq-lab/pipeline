// spec: docs/references/backend.md#stellar-pocket-indexing
use bigdecimal::BigDecimal;
use pipeline_api::routes::analytics::{pocket_claim_items, RequestsResponse};
use shared::pocket_repo::PocketClaimRow;

#[test]
fn rows_map_to_items() {
    let rows = vec![
        PocketClaimRow {
            loan_id: BigDecimal::from(7),
            paid: BigDecimal::from(1_500_000_000_i64),
            tx_hash: "abc".to_owned(),
            block_timestamp: 1_700_000_000,
        },
        PocketClaimRow {
            loan_id: BigDecimal::from(8),
            paid: BigDecimal::from(10),
            tx_hash: "def".to_owned(),
            block_timestamp: 1_700_000_100,
        },
    ];
    let items = pocket_claim_items(99_000_001, rows);
    assert_eq!(items.len(), 2);
    let json = serde_json::to_value(&items).unwrap();
    assert_eq!(
        json[0],
        serde_json::json!({
            "chain_id": 99_000_001,
            "loan_id": "7",
            "amount": "1500000000",
            "tx_hash": "abc",
            "created_at": "2023-11-14T22:13:20Z",
        })
    );
    assert_eq!(json[1]["loan_id"], "8");
}

#[test]
fn empty_claims_serialise_as_an_empty_list() {
    let resp = RequestsResponse {
        requests: Vec::new(),
        pocket_claims: Vec::new(),
        wire_outs: None,
        wire_ins: None,
    };
    let json = serde_json::to_value(&resp).unwrap();
    assert_eq!(json["pocket_claims"], serde_json::json!([]));
    assert_eq!(json["requests"], serde_json::json!([]));
}

#[test]
fn pending_status_never_includes_pocket_claims() {
    use pipeline_api::routes::analytics::includes_pocket_claims;
    assert!(!includes_pocket_claims(Some("pending")));
    assert!(includes_pocket_claims(Some("all")));
    assert!(includes_pocket_claims(None));
}
