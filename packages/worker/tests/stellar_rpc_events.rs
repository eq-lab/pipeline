use mockito::{Matcher, Server};
use pipeline_worker::indexer::stellar::rpc::{parse_get_events_page, EventFilter, StellarRpc};
use serde_json::{json, Value};
use stellar_xdr::curr::{Limits, ScSymbol, ScVal, WriteXdr};

fn symbol_b64(name: &str) -> String {
    ScVal::Symbol(ScSymbol(name.try_into().expect("symbol")))
        .to_xdr_base64(Limits::none())
        .expect("xdr")
}

fn event(ledger: u64, n: u64) -> Value {
    json!({
        "id": format!("{ledger:010}-{n:010}-0000000000"),
        "ledger": ledger,
        "ledgerClosedAt": "2026-01-01T00:00:00Z",
        "contractId": "CAAAA",
        "txHash": "ab",
        "topic": [symbol_b64("deposit")],
        "value": "AAAA",
    })
}

fn page(latest: u64, events: &[Value], cursor: Option<&str>) -> String {
    let mut result = json!({
        "latestLedger": latest,
        "oldestLedger": 1,
        "events": events,
    });
    if let Some(c) = cursor {
        result["cursor"] = json!(c);
    }
    json!({ "jsonrpc": "2.0", "id": 1, "result": result }).to_string()
}

fn ids(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("C{i:0>55}")).collect()
}

#[test]
fn page_parses_latest_oldest_cursor_and_size() {
    let resp = serde_json::from_str::<Value>(&page(200, &[event(150, 0)], Some("c1")))
        .expect("json")["result"]
        .clone();
    let p = parse_get_events_page(&resp, 100, 180).expect("page");
    assert_eq!(p.latest_ledger, 200);
    assert_eq!(p.oldest_ledger, Some(1));
    assert_eq!(p.cursor.as_deref(), Some("c1"));
    assert_eq!(p.page_size, 1);
    assert_eq!(p.events.len(), 1);
}

#[test]
fn page_without_latest_ledger_is_an_error() {
    let resp = json!({ "events": [] });
    assert!(parse_get_events_page(&resp, 100, 180).is_err());
}

#[test]
fn page_drops_events_outside_requested_range() {
    let resp = json!({
        "latestLedger": 300,
        "events": [event(99, 0), event(100, 0), event(180, 0), event(181, 0)],
    });
    let p = parse_get_events_page(&resp, 100, 180).expect("page");
    let ledgers: Vec<u32> = p.events.iter().map(|e| e.ledger).collect();
    assert_eq!(ledgers, vec![100, 180]);
    assert_eq!(p.page_size, 4);
}

#[tokio::test]
async fn pages_report_the_minimum_latest_ledger() {
    let mut server = Server::new_async().await;
    let full: Vec<Value> = (0..10_000).map(|i| event(150, i)).collect();
    let first = server
        .mock("POST", "/")
        .match_body(Matcher::PartialJson(
            json!({ "method": "getEvents", "params": { "startLedger": 100 } }),
        ))
        .with_body(page(200, &full, Some("next")))
        .create_async()
        .await;
    let second = server
        .mock("POST", "/")
        .match_body(Matcher::PartialJson(
            json!({ "method": "getEvents", "params": { "pagination": { "cursor": "next" } } }),
        ))
        .with_body(page(198, &[event(160, 0)], None))
        .create_async()
        .await;
    let rpc = StellarRpc::new(&server.url());
    let filter = EventFilter {
        contract_ids: ids(1),
    };
    let (events, latest) = rpc.get_events(100, 190, &filter).await.expect("events");
    assert_eq!(latest, 198);
    assert_eq!(events.len(), 10_001);
    first.assert_async().await;
    second.assert_async().await;
}

#[tokio::test]
async fn contract_chunks_report_the_minimum_latest_ledger() {
    let mut server = Server::new_async().await;
    let all = ids(26);
    let first_chunk = server
        .mock("POST", "/")
        .match_body(Matcher::PartialJson(
            json!({ "method": "getEvents", "params": { "filters": [{ "contractIds": [all[0]] }] } }),
        ))
        .with_body(page(200, &[], None))
        .create_async()
        .await;
    let second_chunk = server
        .mock("POST", "/")
        .match_body(Matcher::PartialJson(
            json!({ "method": "getEvents", "params": { "filters": [{ "contractIds": [all[25]] }] } }),
        ))
        .with_body(page(197, &[], None))
        .create_async()
        .await;
    let rpc = StellarRpc::new(&server.url());
    let filter = EventFilter { contract_ids: all };
    let (_, latest) = rpc.get_events(100, 190, &filter).await.expect("events");
    assert_eq!(latest, 197);
    first_chunk.assert_async().await;
    second_chunk.assert_async().await;
}

#[tokio::test]
async fn json_rpc_error_body_is_an_error() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock("POST", "/")
        .with_body(
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "error": { "code": -32602, "message": "startLedger must be within the ledger range" }
            })
            .to_string(),
        )
        .create_async()
        .await;
    let rpc = StellarRpc::new(&server.url());
    let filter = EventFilter {
        contract_ids: ids(1),
    };
    assert!(rpc.get_events(100, 190, &filter).await.is_err());
}
