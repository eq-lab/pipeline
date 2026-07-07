use anyhow::{Context, Result};
use std::env;

use super::models::EllipticResponse;

/// Default risk-score cutoff on Elliptic's 0–1 scale. Clean addresses (exchange /
/// coin-swap exposure only) score ~0.005 in practice; 0.5 flags substantial risk
/// while `triggered_rules` catches configured hard hits regardless of score.
/// COMPLIANCE NOTE: tune `ELLIPTIC_RISK_THRESHOLD` to your risk appetite.
const DEFAULT_RISK_THRESHOLD: f64 = 0.5;

#[derive(Clone)]
pub struct EllipticSettings {
    pub api_key: String,
    pub api_secret: String,
    pub base_url: String,
    pub asset: String,
    pub blockchain: String,
    pub risk_threshold: f64,
}

impl EllipticSettings {
    pub fn from_env() -> Result<Self> {
        let api_key =
            env::var("ELLIPTIC_API_KEY").context("required env var ELLIPTIC_API_KEY is not set")?;
        let api_secret = env::var("ELLIPTIC_API_SECRET")
            .context("required env var ELLIPTIC_API_SECRET is not set")?;
        let base_url =
            env::var("ELLIPTIC_BASE_URL").unwrap_or_else(|_| "https://aml-api.elliptic.co".into());
        let asset = env::var("ELLIPTIC_ASSET").unwrap_or_else(|_| "holistic".into());
        let blockchain = env::var("ELLIPTIC_BLOCKCHAIN").unwrap_or_else(|_| "holistic".into());
        let risk_threshold = match env::var("ELLIPTIC_RISK_THRESHOLD") {
            Ok(v) => v
                .parse::<f64>()
                .context("ELLIPTIC_RISK_THRESHOLD must be a valid number")?,
            Err(_) => DEFAULT_RISK_THRESHOLD,
        };

        Ok(Self {
            api_key,
            api_secret,
            base_url,
            asset,
            blockchain,
            risk_threshold,
        })
    }

    /// Risky if any customer-configured Elliptic rule fired, or the overall
    /// risk score meets/exceeds the threshold.
    pub fn is_risky(&self, resp: &EllipticResponse) -> bool {
        if !resp.triggered_rules.is_empty() {
            return true;
        }
        matches!(resp.risk_score, Some(score) if score >= self.risk_threshold)
    }
}
