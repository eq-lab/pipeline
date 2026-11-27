// Characterization of relayer KYT steps 2a/2b (#2257), pinned before the provider refactor.
// spec: docs/design-docs/multi-chain-kyc-sharding.md
use mockito::{Matcher, Server};
use pipeline_worker::relayer::{crystal_check, elliptic_check};
use serde_json::json;
use shared::crystal::client::CrystalClient;
use shared::crystal::config::CrystalSettings;
use shared::elliptic::client::EllipticClient;
use shared::elliptic::config::EllipticSettings;
use shared::kyc_repo::{UnverifiedTransfer, KYT_CLEAR, KYT_FAILED};

const EVM_SENDER: &str = "0xAbC0000000000000000000000000000000000001";
const STELLAR_SENDER: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const TX: &str = "0xfeed";
const META: &str = r#""meta":{"error_code":0,"error_message":""}"#;

fn crystal(url: String) -> CrystalClient {
    CrystalClient::new(CrystalSettings {
        api_key: "k".into(),
        base_url: url,
        blockchain: Some("eth".into()),
        token_id: "0".into(),
        risk_score_threshold: 0.7,
        hard_fail_signals: vec!["sanctions".into()],
    })
}

fn elliptic(url: String) -> EllipticClient {
    EllipticClient::new(EllipticSettings {
        api_key: "k".into(),
        api_secret: "cw==".into(),
        base_url: url,
        asset: "holistic".into(),
        blockchain: "holistic".into(),
        risk_threshold: 0.5,
    })
}

fn transfer(event: &str, sender: Option<&str>) -> UnverifiedTransfer {
    UnverifiedTransfer {
        id: 7,
        event_name: event.into(),
        sender: sender.map(Into::into),
        receiver: None,
        amount: None,
        tx_hash: TX.into(),
        chain_id: 1,
    }
}

#[tokio::test]
async fn crystal_deposit_screens_the_transaction_and_scores_tx_signals_onto_tx_fields() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/risk-check")
        .match_header("X-Auth-Apikey", "k")
        .match_body(Matcher::Json(json!({
            "type": "deposit", "address": EVM_SENDER, "tx": TX, "blockchain": "eth", "token_id": "0"
        })))
        .with_body(format!(
            r#"{{"data":{{"counterparty":{{"riskscore":0.2,"signals":{{"sent":{{"sanctions":1.0}}}}}},"signals":{{"sanctions":0.0}}}},{META}}}"#
        ))
        .create_async()
        .await;
    let r = crystal_check::screen_transfer(
        &crystal(server.url()),
        &transfer("DepositRequested", Some(EVM_SENDER)),
    )
    .await
    .unwrap();
    m.assert_async().await;
    assert_eq!(r.kyt_status, KYT_CLEAR);
    assert_eq!(r.tx_risk, Some(0.2));
    assert_eq!(r.tx_signals, Some(json!({"sanctions": 0.0})));
    assert_eq!((r.sender_risk, r.sender_signals), (None, None));
}

#[tokio::test]
async fn crystal_deposit_fails_on_a_hard_fail_tx_signal() {
    let mut server = Server::new_async().await;
    server
        .mock("POST", "/risk-check")
        .with_body(format!(
            r#"{{"data":{{"counterparty":{{"riskscore":0.1}},"signals":{{"sanctions":0.01}}}},{META}}}"#
        ))
        .create_async()
        .await;
    let r = crystal_check::screen_transfer(
        &crystal(server.url()),
        &transfer("DepositRequested", Some(EVM_SENDER)),
    )
    .await
    .unwrap();
    assert_eq!(r.kyt_status, KYT_FAILED);
}

#[tokio::test]
async fn crystal_withdrawal_screens_the_sender_address_onto_sender_fields() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/risk-check")
        .match_body(Matcher::Json(json!({"type": "address", "address": EVM_SENDER, "blockchain": "eth"})))
        .with_body(format!(
            r#"{{"data":{{"counterparty":{{"riskscore":0.71,"signals":{{"received":{{"atm":1.0}}}}}}}},{META}}}"#
        ))
        .create_async()
        .await;
    let r = crystal_check::screen_transfer(
        &crystal(server.url()),
        &transfer("WithdrawalRequested", Some(EVM_SENDER)),
    )
    .await
    .unwrap();
    m.assert_async().await;
    assert_eq!(r.kyt_status, KYT_FAILED);
    assert_eq!((r.tx_risk, r.tx_signals), (None, None));
    assert_eq!(r.sender_risk, Some(0.71));
    assert_eq!(
        r.sender_signals,
        Some(json!({"received": {"atm": 1.0}, "sent": {}}))
    );
}

#[tokio::test]
async fn crystal_no_data_is_clear_with_zero_risk_and_null_signals() {
    let mut server = Server::new_async().await;
    server
        .mock("POST", "/risk-check")
        .with_body(format!("{{{META}}}"))
        .create_async()
        .await;
    let c = crystal(server.url());
    for event in ["DepositRequested", "WithdrawalRequested"] {
        let r = crystal_check::screen_transfer(&c, &transfer(event, Some(EVM_SENDER)))
            .await
            .unwrap();
        assert_eq!(r.kyt_status, KYT_CLEAR, "{event}");
        assert_eq!(r.tx_risk.or(r.sender_risk), Some(0.0), "{event}");
        assert_eq!(
            r.tx_signals.or(r.sender_signals),
            Some(serde_json::Value::Null),
            "{event}"
        );
    }
    assert_eq!(
        crystal_check::screen_profile(&c, EVM_SENDER).await.unwrap(),
        (0.0, serde_json::Value::Null, false)
    );
}

#[tokio::test]
async fn crystal_profile_screening_is_address_screening_with_strict_threshold_and_bidirectional_signals(
) {
    let mut server = Server::new_async().await;
    let c = crystal(server.url());
    let at_threshold = server
        .mock("POST", "/risk-check")
        .match_body(Matcher::PartialJson(
            json!({"type": "address", "address": EVM_SENDER}),
        ))
        .with_body(format!(
            r#"{{"data":{{"counterparty":{{"riskscore":0.7}}}},{META}}}"#
        ))
        .create_async()
        .await;
    assert_eq!(
        crystal_check::screen_profile(&c, EVM_SENDER).await.unwrap(),
        (0.7, serde_json::Value::Null, false)
    );
    at_threshold.remove_async().await;
    server
        .mock("POST", "/risk-check")
        .with_body(format!(
            r#"{{"data":{{"counterparty":{{"riskscore":0.0,"signals":{{"received":{{"sanctions":0.5}}}}}}}},{META}}}"#
        ))
        .create_async()
        .await;
    assert!(
        crystal_check::screen_profile(&c, EVM_SENDER)
            .await
            .unwrap()
            .2
    );
}

#[tokio::test]
async fn crystal_provider_errors_return_err_so_nothing_is_written() {
    let mut server = Server::new_async().await;
    let c = crystal(server.url());
    let http_500 = server
        .mock("POST", "/risk-check")
        .with_status(500)
        .expect(3)
        .create_async()
        .await;
    assert!(crystal_check::screen_profile(&c, EVM_SENDER).await.is_err());
    for event in ["DepositRequested", "WithdrawalRequested"] {
        assert!(
            crystal_check::screen_transfer(&c, &transfer(event, Some(EVM_SENDER)))
                .await
                .is_err()
        );
    }
    http_500.assert_async().await;
    http_500.remove_async().await;
    server
        .mock("POST", "/risk-check")
        .with_body(r#"{"meta":{"error_code":42,"error_message":"quota"}}"#)
        .create_async()
        .await;
    assert!(crystal_check::screen_profile(&c, EVM_SENDER).await.is_err());
}

#[tokio::test]
async fn crystal_transfer_without_sender_errors_before_calling_the_provider() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", Matcher::Any)
        .expect(0)
        .create_async()
        .await;
    let err =
        crystal_check::screen_transfer(&crystal(server.url()), &transfer("DepositRequested", None))
            .await
            .unwrap_err();
    assert!(err.to_string().contains("has no sender address"), "{err}");
    m.assert_async().await;
}

#[tokio::test]
async fn elliptic_deposit_runs_source_of_funds_with_sender_as_output_address_onto_tx_fields() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/v2/analyses/synchronous")
        .match_header("x-access-key", "k")
        .match_body(Matcher::Json(json!({
            "subject": {
                "output_type": "address", "asset": "holistic", "blockchain": "holistic",
                "type": "transaction", "hash": TX, "output_address": STELLAR_SENDER
            },
            "type": "source_of_funds",
            "customer_reference": STELLAR_SENDER
        })))
        .with_body(
            r#"{"risk_score":0.1,"evaluation_detail":[{"rule":"x"}],"process_status":"complete"}"#,
        )
        .create_async()
        .await;
    let r = elliptic_check::screen_transfer(
        &elliptic(server.url()),
        &transfer("DepositRequested", Some(STELLAR_SENDER)),
    )
    .await
    .unwrap();
    m.assert_async().await;
    assert_eq!(r.kyt_status, KYT_CLEAR);
    assert_eq!(r.tx_risk, Some(0.1));
    assert_eq!(r.tx_signals, Some(json!([{"rule": "x"}])));
    assert_eq!((r.sender_risk, r.sender_signals), (None, None));
}

#[tokio::test]
async fn elliptic_withdrawal_runs_wallet_exposure_on_the_sender_onto_sender_fields() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/v2/wallet/synchronous")
        .match_body(Matcher::Json(json!({
            "subject": {"asset": "holistic", "blockchain": "holistic", "type": "address", "hash": STELLAR_SENDER},
            "type": "wallet_exposure"
        })))
        .with_body(r#"{"risk_score":0.5,"evaluation_detail":{"source":[]}}"#)
        .create_async()
        .await;
    let r = elliptic_check::screen_transfer(
        &elliptic(server.url()),
        &transfer("WithdrawalRequested", Some(STELLAR_SENDER)),
    )
    .await
    .unwrap();
    m.assert_async().await;
    assert_eq!(r.kyt_status, KYT_FAILED);
    assert_eq!((r.tx_risk, r.tx_signals), (None, None));
    assert_eq!(r.sender_risk, Some(0.5));
    assert_eq!(r.sender_signals, Some(json!({"source": []})));
}

#[tokio::test]
async fn elliptic_profile_screening_fails_on_triggered_rules_and_null_score_is_zero_and_clear() {
    let mut server = Server::new_async().await;
    let e = elliptic(server.url());
    let rules = server
        .mock("POST", "/v2/wallet/synchronous")
        .with_body(r#"{"risk_score":0.0,"triggered_rules":[{"rule_name":"Sanctions"}]}"#)
        .create_async()
        .await;
    assert_eq!(
        elliptic_check::screen_profile(&e, STELLAR_SENDER)
            .await
            .unwrap(),
        (0.0, serde_json::Value::Null, true)
    );
    rules.remove_async().await;
    server
        .mock("POST", "/v2/wallet/synchronous")
        .with_body(r#"{"risk_score":null}"#)
        .create_async()
        .await;
    assert_eq!(
        elliptic_check::screen_profile(&e, STELLAR_SENDER)
            .await
            .unwrap(),
        (0.0, serde_json::Value::Null, false)
    );
}

#[tokio::test]
async fn elliptic_provider_errors_and_incomplete_analyses_return_err_so_nothing_is_written() {
    let mut server = Server::new_async().await;
    let e = elliptic(server.url());
    let wallet_500 = server
        .mock("POST", "/v2/wallet/synchronous")
        .with_status(500)
        .expect(2)
        .create_async()
        .await;
    let tx_running = server
        .mock("POST", "/v2/analyses/synchronous")
        .with_body(r#"{"risk_score":0.0,"process_status":"running"}"#)
        .create_async()
        .await;
    assert!(elliptic_check::screen_profile(&e, STELLAR_SENDER)
        .await
        .is_err());
    for event in ["DepositRequested", "WithdrawalRequested"] {
        assert!(
            elliptic_check::screen_transfer(&e, &transfer(event, Some(STELLAR_SENDER)))
                .await
                .is_err()
        );
    }
    wallet_500.assert_async().await;
    tx_running.assert_async().await;
}

#[tokio::test]
async fn elliptic_transfer_without_sender_errors_before_calling_the_provider() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", Matcher::Any)
        .expect(0)
        .create_async()
        .await;
    let err = elliptic_check::screen_transfer(
        &elliptic(server.url()),
        &transfer("WithdrawalRequested", None),
    )
    .await
    .unwrap_err();
    assert!(err.to_string().contains("has no address"), "{err}");
    m.assert_async().await;
}
