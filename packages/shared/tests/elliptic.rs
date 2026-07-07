// Risk-score assertions compare against exact floats captured from the live Elliptic
// API, so the long literals are intentional and must not be reformatted.
#![allow(clippy::unreadable_literal)]

use shared::elliptic::config::EllipticSettings;
use shared::elliptic::models::EllipticResponse;
use shared::elliptic::signing::sign_request;

#[test]
fn signature_matches_reference_vector() {
    let payload = r#"{"subject":{"asset":"holistic","blockchain":"holistic","type":"address","hash":"GTEST"},"type":"wallet_exposure"}"#;
    let sig = sign_request(
        "dGVzdHNlY3JldA==",
        1_700_000_000_000,
        "POST",
        "/v2/wallet/synchronous",
        payload,
    )
    .unwrap();
    assert_eq!(sig, "Z7zOFn8lMKUPgplLTW4rrJznJdwE7NNETxp4WEKTGjg=");
}

#[test]
fn path_is_lowercased_before_signing() {
    // Mixed-case path must produce the same signature as its lowercase form.
    let upper = sign_request(
        "dGVzdHNlY3JldA==",
        1,
        "POST",
        "/V2/Wallet/Synchronous",
        "{}",
    )
    .unwrap();
    let lower = sign_request(
        "dGVzdHNlY3JldA==",
        1,
        "POST",
        "/v2/wallet/synchronous",
        "{}",
    )
    .unwrap();
    assert_eq!(upper, lower);
}

const WALLET_CLEAN: &str = include_str!("fixtures/elliptic_wallet_clean.json");
const TX_CLEAN: &str = include_str!("fixtures/elliptic_transaction_clean.json");
const WALLET_RISKY: &str = include_str!("fixtures/elliptic_wallet_risky.json");

fn settings(threshold: f64) -> EllipticSettings {
    EllipticSettings {
        api_key: "k".into(),
        api_secret: "cw==".into(),
        base_url: "https://aml-api.elliptic.co".into(),
        asset: "holistic".into(),
        blockchain: "holistic".into(),
        risk_threshold: threshold,
    }
}

#[test]
fn parses_real_wallet_response_object_evaluation_detail() {
    // wallet_exposure: evaluation_detail is an OBJECT {source,destination}; triggered_rules present+empty.
    let resp: EllipticResponse = serde_json::from_str(WALLET_CLEAN).unwrap();
    assert_eq!(resp.risk_score, Some(0.005328906366491394));
    assert!(resp.triggered_rules.is_empty());
    assert!(resp.evaluation_detail.is_object());
}

#[test]
fn parses_real_transaction_response_array_evaluation_detail() {
    // source_of_funds: evaluation_detail is an ARRAY; triggered_rules key absent (serde default → empty).
    let resp: EllipticResponse = serde_json::from_str(TX_CLEAN).unwrap();
    assert_eq!(resp.risk_score, Some(0.0015073405736889924));
    assert!(resp.triggered_rules.is_empty());
    assert!(resp.evaluation_detail.is_array());
}

#[test]
fn parses_null_risk_score() {
    let resp: EllipticResponse = serde_json::from_str(r#"{"risk_score":null}"#).unwrap();
    assert_eq!(resp.risk_score, None);
    assert!(resp.triggered_rules.is_empty());
}

#[test]
fn real_clean_responses_are_not_risky_below_threshold() {
    // Real clean scores (~0.005, ~0.0015) are well under a 0.5 threshold and have no triggered rules.
    let wallet: EllipticResponse = serde_json::from_str(WALLET_CLEAN).unwrap();
    let tx: EllipticResponse = serde_json::from_str(TX_CLEAN).unwrap();
    assert!(!settings(0.5).is_risky(&wallet));
    assert!(!settings(0.5).is_risky(&tx));
}

#[test]
fn score_at_or_above_threshold_is_risky() {
    let resp: EllipticResponse = serde_json::from_str(r#"{"risk_score":0.5}"#).unwrap();
    assert!(settings(0.5).is_risky(&resp));
}

#[test]
fn nonempty_triggered_rules_is_risky_regardless_of_score() {
    // Even a low score is risky when a configured Elliptic rule fired.
    let resp: EllipticResponse = serde_json::from_str(
        r#"{"risk_score":0.001,"triggered_rules":[{"rule_name":"Sanctions"}]}"#,
    )
    .unwrap();
    assert!(settings(0.5).is_risky(&resp));
}

#[test]
fn synthetic_risky_fixture_is_risky() {
    let resp: EllipticResponse = serde_json::from_str(WALLET_RISKY).unwrap();
    assert!(settings(0.5).is_risky(&resp));
}

#[test]
fn real_fixtures_are_complete() {
    // wallet_clean has process_status="complete"; tx_clean has process_status="complete" and error=null.
    let wallet: EllipticResponse = serde_json::from_str(WALLET_CLEAN).unwrap();
    let tx: EllipticResponse = serde_json::from_str(TX_CLEAN).unwrap();
    assert!(wallet.is_complete());
    assert!(tx.is_complete());
}

#[test]
fn incomplete_status_is_not_complete() {
    let resp: EllipticResponse =
        serde_json::from_str(r#"{"process_status":"running","risk_score":null}"#).unwrap();
    assert!(!resp.is_complete());
}

#[test]
fn nonnull_error_is_not_complete() {
    let resp: EllipticResponse =
        serde_json::from_str(r#"{"error":{"code":1,"message":"x"},"risk_score":0.0}"#).unwrap();
    assert!(!resp.is_complete());
}
