use anyhow::{Context, Result};

use super::config::BitgoSettings;
use super::models::{
    Recipient, RecipientAddress, RecipientAmount, TxIntent, TxRequestPayload, TxRequestResponse,
};

pub struct BitgoClient {
    http: reqwest::Client,
    settings: BitgoSettings,
}

impl BitgoClient {
    pub fn new(settings: BitgoSettings) -> Self {
        Self {
            http: reqwest::Client::new(),
            settings,
        }
    }

    /// Send an arbitrary contract call (or native transfer) via the BitGo
    /// tx-request endpoint.
    ///
    /// * `to`     – destination contract / recipient address
    /// * `value`  – amount in smallest unit (e.g. wei, micro-USDC)
    /// * `symbol` – coin symbol recognised by BitGo (e.g. `"hteth"`, `"eth"`)
    /// * `data`   – optional hex-encoded calldata (e.g. `"0xd0e30db0"`)
    pub async fn send_transaction(
        &self,
        to: &str,
        value: &str,
        symbol: &str,
        data: Option<&str>,
    ) -> Result<TxRequestResponse> {
        let url = format!(
            "{}/api/v2/wallet/{}/txrequests",
            self.settings.base_url, self.settings.wallet_id,
        );

        let payload = TxRequestPayload {
            intent: TxIntent {
                intent_type: "payment".to_owned(),
                recipients: vec![Recipient {
                    address: RecipientAddress {
                        address: to.to_owned(),
                    },
                    amount: RecipientAmount {
                        value: value.to_owned(),
                        symbol: symbol.to_owned(),
                    },
                    data: data.map(String::from),
                }],
            },
        };

        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.settings.access_token)
            .json(&payload)
            .send()
            .await
            .context("BitGo txrequests call failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("BitGo txrequests returned {status}: {text}");
        }

        response
            .json::<TxRequestResponse>()
            .await
            .context("Failed to parse BitGo txrequests response")
    }
}
