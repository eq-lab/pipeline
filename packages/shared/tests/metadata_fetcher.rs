use std::time::Duration;

use mockito::{Matcher, Server};
use reqwest::Client;
use serde::Deserialize;

use shared::metadata_fetcher::MetadataFetcher;

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct Fixture {
    name: String,
    qty: i32,
}

fn fast_fetcher(gateway: String) -> MetadataFetcher {
    MetadataFetcher::new(Client::new(), gateway).with_backoffs(vec![
        Duration::from_millis(1),
        Duration::from_millis(1),
        Duration::from_millis(1),
    ])
}

#[tokio::test]
async fn fetches_https_success() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("GET", "/payload.json")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"name":"jet-fuel","qty":42}"#)
        .create_async()
        .await;

    let fetcher = fast_fetcher("https://ipfs.example/ipfs/".to_owned());
    let url = format!("{}/payload.json", server.url());
    let got: Fixture = fetcher
        .fetch_json(&url)
        .await
        .expect("fetch should succeed");

    assert_eq!(
        got,
        Fixture {
            name: "jet-fuel".to_owned(),
            qty: 42
        }
    );
    m.assert_async().await;
}

#[tokio::test]
async fn routes_ipfs_to_gateway() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("GET", "/ipfs/QmTestCid/inner.json")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"name":"corridor","qty":7}"#)
        .create_async()
        .await;

    // Gateway has no trailing slash on purpose — the fetcher must add one.
    let gateway = format!("{}/ipfs", server.url());
    let fetcher = fast_fetcher(gateway);

    let got: Fixture = fetcher
        .fetch_json("ipfs://QmTestCid/inner.json")
        .await
        .expect("ipfs fetch should succeed");
    assert_eq!(
        got,
        Fixture {
            name: "corridor".to_owned(),
            qty: 7
        }
    );
    m.assert_async().await;
}

#[tokio::test]
async fn retries_on_5xx_then_succeeds() {
    let mut server = Server::new_async().await;
    // First two requests fail with 500, third returns 200.
    let fail1 = server
        .mock("GET", "/x.json")
        .with_status(500)
        .expect(2)
        .create_async()
        .await;
    let ok = server
        .mock("GET", "/x.json")
        .with_status(200)
        .with_body(r#"{"name":"ok","qty":1}"#)
        .expect(1)
        .create_async()
        .await;

    let fetcher = fast_fetcher("https://ipfs.example/ipfs/".to_owned());
    let url = format!("{}/x.json", server.url());
    let got: Fixture = fetcher
        .fetch_json(&url)
        .await
        .expect("third attempt should succeed");
    assert_eq!(got.name, "ok");

    fail1.assert_async().await;
    ok.assert_async().await;
}

#[tokio::test]
async fn retries_exhaust_after_max_attempts_5xx() {
    // With `with_backoffs([d0, d1, d2])` (3 entries) we get max_attempts = 4.
    // Server always 500 → we attempt exactly 4 times, then return Err with the last
    // retriable error. Documents the `attempts = backoffs.len() + 1` convention so that
    // a future refactor can't silently change it.
    let mut server = Server::new_async().await;
    let m = server
        .mock("GET", "/y.json")
        .with_status(500)
        .expect(4)
        .create_async()
        .await;

    let fetcher = fast_fetcher("https://ipfs.example/ipfs/".to_owned());
    let url = format!("{}/y.json", server.url());
    let err = fetcher
        .fetch_json::<Fixture>(&url)
        .await
        .expect_err("should give up after max attempts");
    assert!(format!("{err}").contains("500"));
    m.assert_async().await;
}

#[tokio::test]
async fn terminal_on_4xx() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("GET", "/missing.json")
        .with_status(404)
        .expect(1) // only ONE attempt — 4xx is terminal
        .create_async()
        .await;

    let fetcher = fast_fetcher("https://ipfs.example/ipfs/".to_owned());
    let url = format!("{}/missing.json", server.url());
    let err = fetcher
        .fetch_json::<Fixture>(&url)
        .await
        .expect_err("404 should error");
    assert!(format!("{err}").contains("404"));
    m.assert_async().await;
}

#[tokio::test]
async fn terminal_on_malformed_json() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("GET", "/bad.json")
        .with_status(200)
        .with_body("not json")
        .expect(1)
        .create_async()
        .await;

    let fetcher = fast_fetcher("https://ipfs.example/ipfs/".to_owned());
    let url = format!("{}/bad.json", server.url());
    let err = fetcher
        .fetch_json::<Fixture>(&url)
        .await
        .expect_err("malformed JSON should error terminally");
    assert!(format!("{err}").contains("parse JSON"));
    m.assert_async().await;
}

#[tokio::test]
async fn terminal_on_missing_fields() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("GET", "/short.json")
        .match_query(Matcher::Any)
        .with_status(200)
        // missing `qty`
        .with_body(r#"{"name":"oops"}"#)
        .expect(1)
        .create_async()
        .await;

    let fetcher = fast_fetcher("https://ipfs.example/ipfs/".to_owned());
    let url = format!("{}/short.json", server.url());
    let err = fetcher
        .fetch_json::<Fixture>(&url)
        .await
        .expect_err("missing field should error terminally");
    assert!(format!("{err}").contains("parse JSON"));
    m.assert_async().await;
}

#[tokio::test]
async fn terminal_on_unknown_scheme() {
    let fetcher = fast_fetcher("https://ipfs.example/ipfs/".to_owned());
    let err = fetcher
        .fetch_json::<Fixture>("ftp://example.com/x")
        .await
        .expect_err("ftp:// must be rejected without HTTP attempt");
    assert!(format!("{err}").contains("unsupported URI scheme"));
}
