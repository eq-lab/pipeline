use anyhow::{Context, Result};

use super::config::CrystalSettings;
use super::models::{AddressData, CrystalResponse, TxData};

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

    /// Screen an address via `GET /explorer/address/{address}`.
    pub async fn screen_address(&self, address: &str) -> Result<CrystalResponse<AddressData>> {
        let url = format!("{}/explorer/address/{}", self.settings.base_url, address);

        let response = self
            .http
            .get(&url)
            .header("X-Auth-Apikey", &self.settings.api_key)
            .send()
            .await
            .context("Crystal address screening call failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Crystal address screening returned {status}: {text}");
        }

        let resp = response
            .json::<CrystalResponse<AddressData>>()
            .await
            .context("Failed to parse Crystal address screening response")?;

        if let Some(left) = resp.meta.calls_left {
            tracing::debug!(calls_left = left, "Crystal API rate limit");
        }

        Ok(resp)
    }

    /// Screen a transaction via `GET /explorer/tx/{tx_hash}`.
    pub async fn screen_transaction(&self, tx_hash: &str) -> Result<CrystalResponse<TxData>> {
        let url = format!("{}/explorer/tx/{}", self.settings.base_url, tx_hash);

        let response = self
            .http
            .get(&url)
            .header("X-Auth-Apikey", &self.settings.api_key)
            .send()
            .await
            .context("Crystal transaction screening call failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Crystal transaction screening returned {status}: {text}");
        }

        let resp = response
            .json::<CrystalResponse<TxData>>()
            .await
            .context("Failed to parse Crystal transaction screening response")?;

        if let Some(left) = resp.meta.calls_left {
            tracing::debug!(calls_left = left, "Crystal API rate limit");
        }

        Ok(resp)
    }
}
