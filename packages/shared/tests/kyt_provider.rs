// KytProvider profile-address keys (#2259): the relayer marks the risky sender's lp_profiles row by this key.
// spec: docs/superpowers/specs/2026-07-06-elliptic-stellar-kyt-design.md
use shared::crystal::client::CrystalClient;
use shared::crystal::config::CrystalSettings;
use shared::elliptic::client::EllipticClient;
use shared::elliptic::config::EllipticSettings;
use shared::kyt::KytProvider;

const EVM_SENDER: &str = "0xAbC0000000000000000000000000000000000001";
const STELLAR_SENDER: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";

fn crystal() -> CrystalClient {
    CrystalClient::new(CrystalSettings {
        api_key: "k".into(),
        base_url: "http://localhost".into(),
        blockchain: Some("eth".into()),
        token_id: "0".into(),
        risk_score_threshold: 0.7,
        hard_fail_signals: vec![],
    })
}

fn elliptic() -> EllipticClient {
    EllipticClient::new(EllipticSettings {
        api_key: "k".into(),
        api_secret: "cw==".into(),
        base_url: "http://localhost".into(),
        asset: "holistic".into(),
        blockchain: "holistic".into(),
        risk_threshold: 0.5,
    })
}

#[test]
fn crystal_marks_the_lowercased_evm_profile() {
    assert_eq!(
        crystal().profile_address(EVM_SENDER),
        "0xabc0000000000000000000000000000000000001"
    );
}

#[test]
fn elliptic_marks_the_stellar_profile_with_strkey_case_kept() {
    assert_eq!(elliptic().profile_address(STELLAR_SENDER), STELLAR_SENDER);
}
