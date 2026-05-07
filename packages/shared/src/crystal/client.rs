use anyhow::{Context, Result};

use super::config::CrystalSettings;
use super::models::{CrystalResponse, RiskCheckRequest};

pub struct CrystalClient {
    http: reqwest::Client,
    settings: CrystalSettings,
}

impl CrystalClient {
    pub fn new(settings: CrystalSettings) -> Self {
        Self {
            http: reqwest::Client::new(),
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

        if let Some(left) = resp.meta.calls_left {
            tracing::debug!(calls_left = left, "Crystal API rate limit");
        }

        Ok(resp)
    }
}
