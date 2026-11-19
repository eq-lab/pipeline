use mockito::{Matcher, Server};
use pipeline_worker::indexer::stellar::retention::{retention_gap, CursorBelowRetention};
use pipeline_worker::indexer::stellar::rpc::{parse_health, RpcHealth, StellarRpc};
use serde_json::json;

#[test]
fn cursor_below_oldest_is_a_gap_with_missing_count() {
    let gap = retention_gap(7, 100, 160).expect("gap");
    assert_eq!(
        gap,
        CursorBelowRetention {
            chain_id: 7,
            cursor: 100,
            oldest_ledger: 160,
            missing_ledgers: 60,
        }
    );
}

#[test]
fn cursor_at_or_above_oldest_is_not_a_gap() {
    assert_eq!(retention_gap(7, 160, 160), None);
    assert_eq!(retention_gap(7, 161, 160), None);
}

#[test]
fn display_names_chain_cursor_and_oldest_ledger() {
    let msg = retention_gap(7, 100, 160).expect("gap").to_string();
    assert!(msg.contains("chain 7"), "{msg}");
    assert!(msg.contains("100"), "{msg}");
    assert!(msg.contains("160"), "{msg}");
}

#[test]
fn parse_health_reads_ledgers_and_window() {
    let body = json!({
        "status": "healthy",
        "latestLedger": 500,
        "oldestLedger": 380,
        "ledgerRetentionWindow": 120
    });
    assert_eq!(
        parse_health(&body).expect("health"),
        RpcHealth {
            latest_ledger: 500,
            oldest_ledger: 380,
            retention_window: Some(120),
        }
    );
}

#[test]
fn parse_health_without_window_is_none() {
    let body = json!({ "status": "healthy", "latestLedger": 500, "oldestLedger": 380 });
    assert_eq!(parse_health(&body).expect("health").retention_window, None);
}

#[test]
fn parse_health_requires_oldest_ledger() {
    assert!(parse_health(&json!({ "latestLedger": 500 })).is_err());
}

#[tokio::test]
async fn get_health_calls_rpc() {
    let mut server = Server::new_async().await;
    let mock = server
        .mock("POST", "/")
        .match_body(Matcher::PartialJson(json!({ "method": "getHealth" })))
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "status": "healthy",
                    "latestLedger": 900,
                    "oldestLedger": 780,
                    "ledgerRetentionWindow": 120
                }
            })
            .to_string(),
        )
        .create_async()
        .await;
    let rpc = StellarRpc::new(&server.url());
    let health = rpc.get_health().await.expect("health");
    assert_eq!(health.oldest_ledger, 780);
    assert_eq!(health.latest_ledger, 900);
    mock.assert_async().await;
}
