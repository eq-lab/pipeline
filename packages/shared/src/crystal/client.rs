use anyhow::{Context, Result};
use async_trait::async_trait;

use super::config::CrystalSettings;
use super::models::{CrystalResponse, RiskCheckRequest};
use crate::kyt::{KytProvider, KytVerdict};

pub struct CrystalClient {
    http: reqwest::Client,
    settings: CrystalSettings,
}

impl CrystalClient {
    pub fn new(settings: CrystalSettings) -> Self {
        Self {
            http: crate::http_client::http_client(),
            settings,
        }
    }

    pub fn settings(&self) -> &CrystalSettings {
        &self.settings
    }

    /// Screen an address via `POST /risk-check` with `type: "address"`.
    pub async fn screen_address(&self, address: &str) -> Result<CrystalResponse> {
        let body = RiskCheckRequest {
            check_type: "address".to_owned(),
            address: Some(address.to_owned()),
            tx: None,
            blockchain: self.settings.blockchain.clone(),
            token_id: None,
        };

        self.risk_check(&body)
            .await
            .context("Crystal address screening failed")
    }

    /// Screen a transaction via `POST /risk-check` with `type: "deposit"` or `"withdrawal"`.
    ///
    /// - `direction`: `"deposit"` or `"withdrawal"`
    /// - `tx_hash`: the transaction hash
    /// - `address`: the deposit address (for deposits) or the customer withdrawal address
    pub async fn screen_transaction(
        &self,
        direction: &str,
        tx_hash: &str,
        address: &str,
    ) -> Result<CrystalResponse> {
        let blockchain = self.settings.blockchain.clone().ok_or_else(|| {
            anyhow::anyhow!("CRYSTAL_BLOCKCHAIN must be set for transaction checks")
        })?;

        let body = RiskCheckRequest {
            check_type: direction.to_owned(),
            address: Some(address.to_owned()),
            tx: Some(tx_hash.to_owned()),
            blockchain: Some(blockchain),
            token_id: Some(self.settings.token_id.clone()),
        };

        self.risk_check(&body)
            .await
            .with_context(|| format!("Crystal {direction} screening failed"))
    }

    async fn risk_check(&self, body: &RiskCheckRequest) -> Result<CrystalResponse> {
        let url = format!("{}/risk-check", self.settings.base_url);

        let response = self
            .http
            .post(&url)
            .header("X-Auth-Apikey", &self.settings.api_key)
            .json(body)
            .send()
            .await
            .context("Crystal risk-check call failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Crystal risk-check returned {status}: {text}");
        }

        let resp = response
            .json::<CrystalResponse>()
            .await
            .context("Failed to parse Crystal risk-check response")?;

        if resp.meta.error_code != 0 {
            anyhow::bail!(
                "Crystal risk-check error {}: {}",
                resp.meta.error_code,
                resp.meta.error_message
            );
        }

        if let Some(left) = resp.meta.calls_left {
            tracing::debug!(calls_left = left, "Crystal API rate limit");
        }

        Ok(resp)
    }
}

fn verdict<S: serde::Serialize>(
    riskscore: f64,
    signals: Option<&S>,
    risky: bool,
) -> Result<KytVerdict> {
    Ok((riskscore as f32, serde_json::to_value(signals)?, risky))
}

#[async_trait]
impl KytProvider for CrystalClient {
    fn name(&self) -> &'static str {
        "Crystal"
    }

    async fn address_verdict(&self, address: &str) -> Result<KytVerdict> {
        let resp = self.screen_address(address).await?;
        if resp.data.is_none() {
            tracing::info!(
                wallet = address,
                "Crystal returned no data (address has no on-chain history), treating as clean"
            );
        }
        let (riskscore, signals) = match resp.data.as_ref() {
            Some(data) => (
                data.counterparty.riskscore.unwrap_or(0.0),
                data.counterparty.signals.as_ref(),
            ),
            None => (0.0, None),
        };
        verdict(
            riskscore,
            signals,
            self.settings.is_risky_address(riskscore, signals),
        )
    }

    async fn deposit_verdict(&self, tx_hash: &str, sender: &str) -> Result<KytVerdict> {
        let resp = self.screen_transaction("deposit", tx_hash, sender).await?;
        let (riskscore, signals) = match resp.data.as_ref() {
            Some(data) => (
                data.counterparty.riskscore.unwrap_or(0.0),
                data.signals.as_ref(),
            ),
            None => (0.0, None),
        };
        verdict(
            riskscore,
            signals,
            self.settings.is_risky_tx(riskscore, signals),
        )
    }

    // lp_profiles stores EVM addresses lowercased; the raw event field may not be.
    fn profile_address(&self, sender: &str) -> String {
        sender.to_lowercase()
    }
}
