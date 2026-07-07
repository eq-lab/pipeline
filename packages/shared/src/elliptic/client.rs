use anyhow::{Context, Result};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

use super::config::EllipticSettings;
use super::models::EllipticResponse;
use super::signing::sign_request;

pub struct EllipticClient {
    http: reqwest::Client,
    settings: EllipticSettings,
}

impl EllipticClient {
    pub fn new(settings: EllipticSettings) -> Self {
        Self {
            http: reqwest::Client::new(),
            settings,
        }
    }

    pub fn settings(&self) -> &EllipticSettings {
        &self.settings
    }

    /// Wallet exposure screening: `POST /v2/wallet/synchronous`.
    pub async fn screen_wallet(&self, address: &str) -> Result<EllipticResponse> {
        let body = json!({
            "subject": {
                "asset": self.settings.asset,
                "blockchain": self.settings.blockchain,
                "type": "address",
                "hash": address,
            },
            "type": "wallet_exposure",
        });
        self.post("/v2/wallet/synchronous", &body)
            .await
            .context("Elliptic wallet screening failed")
    }

    /// Source-of-funds transaction analysis: `POST /v2/analyses/synchronous`.
    pub async fn screen_transaction(
        &self,
        tx_hash: &str,
        output_address: &str,
        customer_reference: &str,
    ) -> Result<EllipticResponse> {
        let body = json!({
            "subject": {
                "output_type": "address",
                "asset": self.settings.asset,
                "blockchain": self.settings.blockchain,
                "type": "transaction",
                "hash": tx_hash,
                "output_address": output_address,
            },
            "type": "source_of_funds",
            "customer_reference": customer_reference,
        });
        self.post("/v2/analyses/synchronous", &body)
            .await
            .context("Elliptic transaction screening failed")
    }

    async fn post(&self, path: &str, body: &serde_json::Value) -> Result<EllipticResponse> {
        // Compact, no-space JSON — the exact bytes must match what is signed.
        let payload = serde_json::to_string(body).context("failed to serialize Elliptic body")?;
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock error")?
            .as_millis() as u64;
        let signature = sign_request(
            &self.settings.api_secret,
            timestamp_ms,
            "POST",
            path,
            &payload,
        )?;

        let url = format!("{}{}", self.settings.base_url, path);
        let response = self
            .http
            .post(&url)
            .header("x-access-key", &self.settings.api_key)
            .header("x-access-sign", signature)
            .header("x-access-timestamp", timestamp_ms.to_string())
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .body(payload)
            .send()
            .await
            .context("Elliptic request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Elliptic {path} returned {status}: {text}");
        }

        let resp = response
            .json::<EllipticResponse>()
            .await
            .context("failed to parse Elliptic response")?;
        if !resp.is_complete() {
            anyhow::bail!(
                "Elliptic {path} not complete: process_status={:?} error={:?}",
                resp.process_status,
                resp.error
            );
        }
        Ok(resp)
    }
}
