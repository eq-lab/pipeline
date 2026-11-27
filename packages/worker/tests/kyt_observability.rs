// KYT backlog age and provider error classes (#2262).
// spec: docs/RELIABILITY.md#kyt-screening-alerts
use mockito::Server;
use pipeline_worker::relayer::kyt_check::{backlog_age_secs, error_class, screen_profile};
use shared::crystal::client::CrystalClient;
use shared::crystal::config::CrystalSettings;

fn crystal(url: String) -> CrystalClient {
    CrystalClient::new(CrystalSettings {
        api_key: "k".into(),
        base_url: url,
        blockchain: Some("eth".into()),
        token_id: "0".into(),
        risk_score_threshold: 0.7,
        hard_fail_signals: vec![],
    })
}

#[test]
fn backlog_age_is_zero_when_empty_and_never_negative() {
    assert_eq!(backlog_age_secs(None, 1_000), 0);
    assert_eq!(backlog_age_secs(Some(400), 1_000), 600);
    assert_eq!(backlog_age_secs(Some(1_100), 1_000), 0);
}

#[tokio::test]
async fn provider_errors_are_classified() {
    let mut server = Server::new_async().await;
    let c = crystal(server.url());
    let status = server
        .mock("POST", "/risk-check")
        .with_status(401)
        .create_async()
        .await;
    let e = screen_profile(&c, "0x1").await.unwrap_err();
    assert_eq!(error_class(&e), "provider");
    status.remove_async().await;
    server
        .mock("POST", "/risk-check")
        .with_body("not json")
        .create_async()
        .await;
    let e = screen_profile(&c, "0x1").await.unwrap_err();
    assert_eq!(error_class(&e), "decode");
    let e = screen_profile(&crystal("http://127.0.0.1:1".into()), "0x1")
        .await
        .unwrap_err();
    assert_eq!(error_class(&e), "connect");
    let db = anyhow::Error::from(sqlx::Error::PoolTimedOut).context("store");
    assert_eq!(error_class(&db), "db");
}
