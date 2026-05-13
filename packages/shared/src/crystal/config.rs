use anyhow::{Context, Result};
use std::env;

use super::models::{DirectionalSignals, RiskSignals};

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
    pub blockchain: Option<String>,
    pub token_id: String,
    pub risk_score_threshold: f64,
    pub hard_fail_signals: Vec<String>,
}

impl CrystalSettings {
    pub fn from_env() -> Result<Self> {
        let api_key =
            env::var("CRYSTAL_API_KEY").context("required env var CRYSTAL_API_KEY is not set")?;

        let base_url = env::var("CRYSTAL_BASE_URL")
            .unwrap_or_else(|_| "https://apiexpert.crystalblockchain.com".to_owned());

        let blockchain = env::var("CRYSTAL_BLOCKCHAIN").ok();

        let token_id = env::var("CRYSTAL_TOKEN_ID").unwrap_or_else(|_| "0".to_owned());

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
            blockchain,
            token_id,
            risk_score_threshold,
            hard_fail_signals,
        })
    }

    /// Returns `true` if the risk score exceeds the threshold or any hard-fail
    /// signal has a non-zero value in either direction (received or sent).
    /// Use for address checks.
    pub fn is_risky_address(&self, riskscore: f64, signals: Option<&DirectionalSignals>) -> bool {
        if riskscore > self.risk_score_threshold {
            return true;
        }

        if let Some(sig) = signals {
            if self.has_hard_fail_signal(&sig.received) || self.has_hard_fail_signal(&sig.sent) {
                return true;
            }
        }

        false
    }

    /// Returns `true` if the risk score exceeds the threshold or any hard-fail
    /// signal has a non-zero value. Use for transaction checks (unidirectional signals).
    pub fn is_risky_tx(&self, riskscore: f64, signals: Option<&RiskSignals>) -> bool {
        if riskscore > self.risk_score_threshold {
            return true;
        }

        if let Some(sig) = signals {
            if self.has_hard_fail_signal(sig) {
                return true;
            }
        }

        false
    }

    fn has_hard_fail_signal(&self, signals: &RiskSignals) -> bool {
        for signal_name in &self.hard_fail_signals {
            if let Some(&val) = signals.get(signal_name.as_str()) {
                if val > 0.0 {
                    return true;
                }
            }
        }
        false
    }
}
