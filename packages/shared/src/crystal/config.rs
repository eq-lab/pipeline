use anyhow::{Context, Result};
use std::env;

use super::models::RiskScore;

const ALL_SIGNALS: &[&str] = &[
    "sanctions",               // OFAC/EU/UN sanctioned entities
    "terrorism_financing",     // Funding linked to terrorist organizations
    "stolen_coins",            // Assets originating from known thefts/hacks
    "dark_market",             // Darknet marketplaces (e.g. Silk Road, Hydra)
    "dark_service",            // Other darknet services (forums, hosting)
    "scam",                    // Known scam operations (ponzi, phishing, rug pulls)
    "ransom",                  // Ransomware payment addresses
    "child_exploitation",      // Child sexual abuse material (CSAM) services
    "mixer",                   // Coin mixing / tumbling services
    "enforcement_action",      // Addresses seized or flagged by law enforcement
    "exchange_fraudulent",     // Exchanges known to be fraudulent
    "exchange_licensed",       // Regulated, licensed exchanges
    "exchange_unlicensed",     // Unregulated exchanges without proper licensing
    "gambling",                // Online gambling platforms
    "illegal_service",         // Other illegal services not covered above
    "liquidity_pools",         // DeFi liquidity pools and AMMs
    "marketplace",             // Legal online marketplaces
    "miner",                   // Mining pools and miner addresses
    "other",                   // Uncategorized or miscellaneous entities
    "p2p_exchange_licensed",   // Licensed peer-to-peer exchange platforms
    "p2p_exchange_unlicensed", // Unlicensed peer-to-peer exchange platforms
    "payment",                 // Payment processors and merchant services
    "seized_assets",           // Assets confiscated by authorities
    "atm",                     // Crypto ATM operators
    "wallet",                  // Personal wallet services (non-custodial)
];

#[derive(Clone)]
pub struct CrystalSettings {
    pub api_key: String,
    pub base_url: String,
    pub risk_score_threshold: f64,
    pub hard_fail_signals: Vec<String>,
}

impl CrystalSettings {
    pub fn from_env() -> Result<Self> {
        let api_key =
            env::var("CRYSTAL_API_KEY").context("required env var CRYSTAL_API_KEY is not set")?;

        let base_url = env::var("CRYSTAL_BASE_URL")
            .unwrap_or_else(|_| "https://apieth.crystalblockchain.com".to_owned());

        let risk_score_threshold = match env::var("CRYSTAL_RISK_SCORE_THRESHOLD") {
            Ok(v) => v
                .parse::<f64>()
                .context("CRYSTAL_RISK_SCORE_THRESHOLD must be a valid number")?,
            Err(_) => 0.7,
        };

        let hard_fail_signals = match env::var("CRYSTAL_HARD_FAIL_SIGNALS") {
            Ok(v) => v.split(',').map(|s| s.trim().to_owned()).collect(),
            Err(_) => ALL_SIGNALS.iter().map(|s| (*s).to_owned()).collect(),
        };

        Ok(Self {
            api_key,
            base_url,
            risk_score_threshold,
            hard_fail_signals,
        })
    }

    /// Returns `true` if the risk score exceeds the threshold or any hard-fail
    /// signal has a non-zero value.
    pub fn is_risky(&self, riskscore: &RiskScore) -> bool {
        if riskscore.value > self.risk_score_threshold {
            return true;
        }

        for signal_name in &self.hard_fail_signals {
            if let Some(val) = riskscore.signals.get(signal_name) {
                if val > 0.0 {
                    return true;
                }
            }
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crystal::models::{RiskScore, RiskSignals};

    fn zero_signals() -> RiskSignals {
        RiskSignals {
            sanctions: 0.0,
            terrorism_financing: 0.0,
            stolen_coins: 0.0,
            dark_market: 0.0,
            dark_service: 0.0,
            scam: 0.0,
            ransom: 0.0,
            child_exploitation: 0.0,
            mixer: 0.0,
            enforcement_action: 0.0,
            exchange_fraudulent: 0.0,
            exchange_licensed: 0.0,
            exchange_unlicensed: 0.0,
            gambling: 0.0,
            illegal_service: 0.0,
            liquidity_pools: 0.0,
            marketplace: 0.0,
            miner: 0.0,
            other: 0.0,
            p2p_exchange_licensed: 0.0,
            p2p_exchange_unlicensed: 0.0,
            payment: 0.0,
            seized_assets: 0.0,
            atm: 0.0,
            wallet: 0.0,
        }
    }

    fn settings(threshold: f64, signals: Vec<&str>) -> CrystalSettings {
        CrystalSettings {
            api_key: "test".to_owned(),
            base_url: "http://localhost".to_owned(),
            risk_score_threshold: threshold,
            hard_fail_signals: signals.into_iter().map(|s| s.to_owned()).collect(),
        }
    }

    #[test]
    fn low_score_no_signals_is_safe() {
        let s = settings(0.7, vec!["sanctions", "terrorism_financing"]);
        let rs = RiskScore {
            value: 0.3,
            signals: zero_signals(),
        };
        assert!(!s.is_risky(&rs));
    }

    #[test]
    fn high_score_is_risky() {
        let s = settings(0.7, vec![]);
        let rs = RiskScore {
            value: 0.8,
            signals: zero_signals(),
        };
        assert!(s.is_risky(&rs));
    }

    #[test]
    fn exact_threshold_is_not_risky() {
        let s = settings(0.7, vec![]);
        let rs = RiskScore {
            value: 0.7,
            signals: zero_signals(),
        };
        assert!(!s.is_risky(&rs));
    }

    #[test]
    fn hard_fail_signal_triggers_regardless_of_score() {
        let s = settings(0.7, vec!["sanctions"]);
        let mut signals = zero_signals();
        signals.sanctions = 0.001;
        let rs = RiskScore {
            value: 0.1,
            signals,
        };
        assert!(s.is_risky(&rs));
    }

    #[test]
    fn non_configured_signal_is_ignored() {
        let s = settings(0.7, vec!["sanctions"]);
        let mut signals = zero_signals();
        signals.mixer = 0.5;
        let rs = RiskScore {
            value: 0.1,
            signals,
        };
        assert!(!s.is_risky(&rs));
    }

    #[test]
    fn all_signals_mode_catches_any_nonzero() {
        let s = settings(
            0.7,
            ALL_SIGNALS
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
                .iter()
                .map(|s| s.as_str())
                .collect(),
        );
        let mut signals = zero_signals();
        signals.gambling = 0.01;
        let rs = RiskScore {
            value: 0.1,
            signals,
        };
        assert!(s.is_risky(&rs));
    }
}
