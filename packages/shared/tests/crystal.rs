use shared::crystal::config::CrystalSettings;
use shared::crystal::models::{CrystalResponse, DirectionalSignals, RiskSignals};

fn empty_signals() -> RiskSignals {
    RiskSignals::new()
}

fn empty_directional() -> DirectionalSignals {
    DirectionalSignals {
        received: empty_signals(),
        sent: empty_signals(),
    }
}

fn settings(threshold: f64, signals: Vec<&str>) -> CrystalSettings {
    CrystalSettings {
        api_key: "test".to_owned(),
        base_url: "http://localhost".to_owned(),
        blockchain: Some("eth".to_owned()),
        token_id: "0".to_owned(),
        risk_score_threshold: threshold,
        hard_fail_signals: signals.into_iter().map(|s| s.to_owned()).collect(),
    }
}

// ── Response parsing ──────────────────────────────────────────

#[test]
fn parse_address_check_response() {
    let json = r#"{"data":{"blockchains":["matic","eth","bsc"],"counterparty":{"address":"0x11e4857bb9993a50c685a79afad4e6f65d518dda","blocklist":false,"received":2016933.0521978003,"sent":1798448.953064,"riskscore":0.12,"signals":{"received":{"atm":0,"exchange_licensed":0.989,"payment":1},"sent":{"exchange_licensed":0.93,"exchange_unlicensed":0.042,"sanctions":0.003}},"tags":[],"type":"address"}},"meta":{"error_code":0,"error_message":"","riskscore_profile":{"id":0,"name":"Default - equal influence"},"server_time":1731061941}}"#;

    let resp: CrystalResponse = serde_json::from_str(json).unwrap();
    let data = resp.data.as_ref().unwrap();
    let cp = &data.counterparty;

    assert_eq!(cp.riskscore, Some(0.12));

    let signals = cp.signals.as_ref().unwrap();
    assert_eq!(signals.sent.get("exchange_licensed"), Some(&0.93));
    assert_eq!(signals.sent.get("exchange_unlicensed"), Some(&0.042));
    assert_eq!(signals.sent.get("sanctions"), Some(&0.003));
    assert_eq!(signals.received.get("exchange_licensed"), Some(&0.989));
    assert_eq!(signals.received.get("payment"), Some(&1.0));
}

#[test]
fn parse_no_data_response() {
    let json = r#"{"meta":{"calls_left":476,"calls_used":24,"error_code":0,"error_message":"","riskscore_profile":{"id":0,"name":"Default - equal influence"},"server_time":1778164823}}"#;

    let resp: CrystalResponse = serde_json::from_str(json).unwrap();
    assert!(resp.data.is_none());
    assert_eq!(resp.meta.error_code, 0);
}

// ── Risk scoring ──────────────────────────────────────────────

#[test]
fn low_score_no_signals_is_safe() {
    let s = settings(0.7, vec!["sanctions", "terrorism_financing"]);
    let sig = empty_directional();
    assert!(!s.is_risky_address(0.3, Some(&sig)));
}

#[test]
fn high_score_is_risky() {
    let s = settings(0.7, vec![]);
    assert!(s.is_risky_address(0.8, None));
}

#[test]
fn exact_threshold_is_not_risky() {
    let s = settings(0.7, vec![]);
    assert!(!s.is_risky_address(0.7, None));
}

#[test]
fn hard_fail_signal_in_sent_triggers() {
    let s = settings(0.7, vec!["sanctions"]);
    let mut sig = empty_directional();
    sig.sent.insert("sanctions".to_owned(), 0.001);
    assert!(s.is_risky_address(0.1, Some(&sig)));
}

#[test]
fn hard_fail_signal_in_received_triggers() {
    let s = settings(0.7, vec!["sanctions"]);
    let mut sig = empty_directional();
    sig.received.insert("sanctions".to_owned(), 0.001);
    assert!(s.is_risky_address(0.1, Some(&sig)));
}

#[test]
fn non_configured_signal_is_ignored() {
    let s = settings(0.7, vec!["sanctions"]);
    let mut sig = empty_directional();
    sig.sent.insert("mixer".to_owned(), 0.5);
    assert!(!s.is_risky_address(0.1, Some(&sig)));
}

#[test]
fn all_signals_mode_catches_any_nonzero() {
    let s = settings(
        0.7,
        vec![
            "sanctions",
            "terrorism_financing",
            "stolen_coins",
            "dark_market",
            "dark_service",
            "scam",
            "ransom",
            "child_exploitation",
            "mixer",
            "enforcement_action",
            "exchange_fraudulent",
            "exchange_licensed",
            "exchange_unlicensed",
            "gambling",
            "illegal_service",
            "liquidity_pools",
            "marketplace",
            "miner",
            "other",
            "p2p_exchange_licensed",
            "p2p_exchange_unlicensed",
            "payment",
            "seized_assets",
            "atm",
            "wallet",
        ],
    );
    let mut sig = empty_directional();
    sig.received.insert("gambling".to_owned(), 0.01);
    assert!(s.is_risky_address(0.1, Some(&sig)));
}
