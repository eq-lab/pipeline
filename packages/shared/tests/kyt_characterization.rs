// Characterization of today's KYT behavior (#2257), pinned before the provider refactor.
// spec: docs/design-docs/multi-chain-kyc-sharding.md
use serde_json::json;
use shared::crystal::config::CrystalSettings;
use shared::crystal::models::RiskSignals;
use shared::elliptic::config::EllipticSettings;
use shared::elliptic::models::EllipticResponse;
use shared::kyc_repo::{
    evm_allow_candidates_sql, next_kyt_status, stellar_allow_candidates_sql, KytTransferResult,
    KYT_ADDRESS_RISK_SQL, KYT_CLEAR, KYT_FAILED, KYT_FAILED_DISALLOW_CANDIDATES_SQL,
    PROFILE_KYT_CLEAR_SQL, PROFILE_KYT_FAILED_SQL, TRANSFER_KYT_RESULT_SQL,
    UNSCREENED_PROFILES_SQL, UNVERIFIED_TRANSFERS_FOR_CHAIN_SQL,
};

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

const COMBOS: [(bool, bool); 4] = [(false, false), (true, false), (false, true), (true, true)];
const SUMSUB: &str =
    " AND p.sumsub_kyc_status = 2 AND p.sumsub_review_status = 2 AND p.sumsub_aml_status = 2";

fn crystal(hard_fail: &[&str]) -> CrystalSettings {
    CrystalSettings {
        api_key: "k".into(),
        base_url: "http://localhost".into(),
        blockchain: Some("eth".into()),
        token_id: "0".into(),
        risk_score_threshold: 0.7,
        hard_fail_signals: hard_fail.iter().map(|s| (*s).to_owned()).collect(),
    }
}

fn signals(pairs: &[(&str, f64)]) -> RiskSignals {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect()
}

#[test]
fn defaults_crystal_threshold_0_7_all_signals_hard_fail_and_elliptic_threshold_0_5() {
    unsafe {
        std::env::set_var("CRYSTAL_API_KEY", "k");
        std::env::remove_var("CRYSTAL_RISK_SCORE_THRESHOLD");
        std::env::remove_var("CRYSTAL_HARD_FAIL_SIGNALS");
        std::env::remove_var("CRYSTAL_TOKEN_ID");
        std::env::set_var("ELLIPTIC_API_KEY", "k");
        std::env::set_var("ELLIPTIC_API_SECRET", "cw==");
        std::env::remove_var("ELLIPTIC_RISK_THRESHOLD");
    }
    let c = CrystalSettings::from_env().unwrap();
    assert!((c.risk_score_threshold - 0.7).abs() < f64::EPSILON);
    assert_eq!(c.token_id, "0");
    assert_eq!(c.hard_fail_signals.len(), 25);
    for s in ["sanctions", "exchange_licensed", "wallet", "atm", "payment"] {
        assert!(c.hard_fail_signals.iter().any(|h| h == s), "{s}");
    }
    let e = EllipticSettings::from_env().unwrap();
    assert!((e.risk_threshold - 0.5).abs() < f64::EPSILON);
}

#[test]
fn crystal_tx_verdict_is_score_strictly_above_threshold_or_any_hard_fail_signal_above_zero() {
    let s = crystal(&["sanctions"]);
    assert!(!s.is_risky_tx(0.7, None));
    assert!(s.is_risky_tx(0.700_001, None));
    assert!(!s.is_risky_tx(0.0, Some(&signals(&[("sanctions", 0.0)]))));
    assert!(s.is_risky_tx(0.0, Some(&signals(&[("sanctions", 0.000_1)]))));
    assert!(!s.is_risky_tx(0.0, Some(&signals(&[("mixer", 1.0)]))));
}

#[test]
fn crystal_without_data_scores_zero_and_no_signals_which_is_clear() {
    let s = crystal(&["sanctions"]);
    assert!(!s.is_risky_address(0.0, None));
    assert!(!s.is_risky_tx(0.0, None));
}

#[test]
fn elliptic_verdict_is_triggered_rules_nonempty_or_score_at_or_above_threshold() {
    let s = EllipticSettings {
        api_key: "k".into(),
        api_secret: "cw==".into(),
        base_url: "http://localhost".into(),
        asset: "holistic".into(),
        blockchain: "holistic".into(),
        risk_threshold: 0.5,
    };
    let risky =
        |v: serde_json::Value| s.is_risky(&serde_json::from_value::<EllipticResponse>(v).unwrap());
    assert!(!risky(json!({"risk_score": 0.499_999})));
    assert!(risky(json!({"risk_score": 0.5})));
    assert!(!risky(json!({"risk_score": null})));
    assert!(!risky(json!({})));
    assert!(risky(json!({"risk_score": null, "triggered_rules": [{}]})));
    assert!(!risky(json!({"risk_score": 0.1, "triggered_rules": []})));
}

#[test]
fn deposit_result_lands_on_tx_fields_and_withdrawal_result_on_sender_fields() {
    let sig = json!({"sanctions": 0.0});
    let dep = KytTransferResult::screened(true, false, 0.25, sig.clone());
    assert_eq!(dep.kyt_status, KYT_CLEAR);
    assert_eq!(dep.tx_risk, Some(0.25));
    assert_eq!(dep.tx_signals, Some(sig.clone()));
    assert_eq!(dep.sender_risk, None);
    assert_eq!(dep.sender_signals, None);

    let wd = KytTransferResult::screened(false, true, 0.9, sig.clone());
    assert_eq!(wd.kyt_status, KYT_FAILED);
    assert_eq!(wd.tx_risk, None);
    assert_eq!(wd.tx_signals, None);
    assert_eq!(wd.sender_risk, Some(0.9));
    assert_eq!(wd.sender_signals, Some(sig));
}

#[test]
fn set_transfer_kyt_result_writes_status_both_risk_pairs_and_screened_at_by_log_id() {
    assert_eq!(
        flat(TRANSFER_KYT_RESULT_SQL),
        "UPDATE contract_logs SET kyt_status = $2, kyt_tx_risk = $3, kyt_tx_signals = $4, \
         kyt_sender_risk = $5, kyt_sender_signals = $6, kyt_screened_at = $7 WHERE id = $1"
    );
}

#[test]
fn profile_failed_write_is_unguarded_and_clear_write_never_downgrades_status_2() {
    assert_eq!(
        flat(PROFILE_KYT_FAILED_SQL),
        "UPDATE lp_profiles SET kyt_status = 2, updated_at = NOW() WHERE chain_id = $1 AND wallet_address = $2"
    );
    assert_eq!(
        flat(PROFILE_KYT_CLEAR_SQL),
        "UPDATE lp_profiles SET kyt_status = 1, updated_at = NOW() WHERE chain_id = $1 AND wallet_address = $2 AND kyt_status IS DISTINCT FROM 2"
    );
    assert_eq!(next_kyt_status(Some(KYT_CLEAR), KYT_FAILED), KYT_FAILED);
    assert_eq!(next_kyt_status(Some(KYT_FAILED), KYT_CLEAR), KYT_FAILED);
}

#[test]
fn address_risk_write_marks_profile_screened_without_touching_kyt_status() {
    assert_eq!(
        flat(KYT_ADDRESS_RISK_SQL),
        "UPDATE lp_profiles SET kyt_address_risk = $3, kyt_address_signals = $4, kyt_screened_at = $5, \
         updated_at = NOW() WHERE chain_id = $1 AND wallet_address = $2"
    );
}

#[test]
fn unscreened_profiles_are_those_without_kyt_screened_at_so_provider_errors_retry_next_tick() {
    assert_eq!(
        flat(UNSCREENED_PROFILES_SQL),
        "SELECT wallet_address FROM lp_profiles WHERE chain_id = $1 AND kyt_screened_at IS NULL ORDER BY created_at LIMIT $2"
    );
}

#[test]
fn unverified_transfers_are_requests_with_null_kyt_status_so_provider_errors_retry_next_tick() {
    let select = "SELECT id, event_name, COALESCE(params->>'user', params->>'withdrawer') AS sender, \
                  params->>'receiver' AS receiver, (params->>'amount')::numeric AS amount, tx_hash, chain_id \
                  FROM contract_logs WHERE";
    assert_eq!(
        flat(UNVERIFIED_TRANSFERS_FOR_CHAIN_SQL),
        format!("{select} chain_id = $1 AND event_name IN ('DepositRequested', 'WithdrawalRequested') AND kyt_status IS NULL ORDER BY id LIMIT $2")
    );
}

#[test]
fn kyt_disallow_candidates_are_every_failed_profile_whatever_its_db_flag() {
    assert_eq!(
        flat(KYT_FAILED_DISALLOW_CANDIDATES_SQL),
        "SELECT wallet_address FROM lp_profiles WHERE chain_id = $1 AND kyt_status = 2"
    );
}

#[test]
fn evm_allow_gate_requires_clear_profile_and_clear_deposit_only_when_crystal_enabled() {
    for (sumsub, crystal_on) in COMBOS {
        let kyc = if sumsub { SUMSUB } else { "" };
        let (profile_kyt, deposit_kyt) = if crystal_on {
            (" AND p.kyt_status = 1", " AND c.kyt_status = 1")
        } else {
            ("", "")
        };
        assert_eq!(
            flat(evm_allow_candidates_sql(sumsub, crystal_on)),
            format!(
                "SELECT p.wallet_address FROM lp_profiles p WHERE p.chain_id = $1 AND p.on_chain_allowed = FALSE\
                 {kyc}{profile_kyt} AND EXISTS ( SELECT 1 FROM contract_logs c WHERE c.chain_id = $1 \
                 AND c.event_name = 'DepositRequested' AND LOWER(c.params->>'user') = p.wallet_address{deposit_kyt} )"
            ),
            "sumsub={sumsub} crystal={crystal_on}"
        );
    }
}

#[test]
fn stellar_allow_gate_exact_text_for_every_sumsub_elliptic_combination() {
    for (sumsub, elliptic) in COMBOS {
        let kyc = if sumsub { SUMSUB } else { "" };
        let (profile_kyt, deposit_kyt) = if elliptic {
            (" AND p.kyt_status = 1", " AND c.kyt_status = 1")
        } else {
            ("", "")
        };
        assert_eq!(
            flat(&stellar_allow_candidates_sql(sumsub, elliptic)),
            format!(
                "SELECT p.wallet_address FROM lp_profiles p WHERE p.chain_id = $1 AND p.on_chain_allowed = FALSE\
                 {profile_kyt} AND ( (EXISTS ( SELECT 1 FROM contract_logs c WHERE c.chain_id = $1 \
                 AND c.event_name = 'DepositRequested' AND c.params->>'user' = p.wallet_address{deposit_kyt} ){kyc}) \
                 OR EXISTS ( SELECT 1 FROM lps l WHERE l.stellar_address = p.wallet_address \
                 AND l.kyb_status = 'Passed' AND l.address_linked_at IS NOT NULL ) )"
            ),
            "sumsub={sumsub} elliptic={elliptic}"
        );
    }
}
