use async_trait::async_trait;

use super::config::BitgoSettings;
use super::models::{
    BitgoError, Recipient, RecipientAddress, RecipientAmount, TxIntent, TxRequestEntry,
    TxRequestListResponse, TxRequestPayload, TxRequestResponse,
};

/// Trait abstracting the BitGo tx-request operations used by Phase 4.
///
/// Implementations include `BitgoClient` (real HTTP) and test mocks.
#[async_trait]
pub trait BitgoTxClient: Send + Sync {
    /// Send an arbitrary contract call (or native transfer) via the BitGo
    /// tx-request endpoint.
    ///
    /// * `to`     – destination contract / recipient address
    /// * `value`  – amount in smallest unit (e.g. wei, micro-USDC)
    /// * `symbol` – coin symbol recognised by BitGo (e.g. `"hteth"`, `"eth"`)
    /// * `data`   – optional hex-encoded calldata (e.g. `"0xd0e30db0"`)
    async fn send_transaction(
        &self,
        to: &str,
        value: &str,
        symbol: &str,
        data: Option<&str>,
    ) -> Result<TxRequestResponse, BitgoError>;

    /// Fetch the current state of an existing BitGo tx request.
    async fn get_tx_request(&self, tx_request_id: &str) -> Result<TxRequestResponse, BitgoError>;
}

pub struct BitgoClient {
    pub(crate) http: reqwest::Client,
    pub(crate) settings: BitgoSettings,
}

impl BitgoClient {
    pub fn new(settings: BitgoSettings) -> Self {
        Self {
            http: reqwest::Client::new(),
            settings,
        }
    }
}

#[async_trait]
impl BitgoTxClient for BitgoClient {
    async fn send_transaction(
        &self,
        to: &str,
        value: &str,
        symbol: &str,
        data: Option<&str>,
    ) -> Result<TxRequestResponse, BitgoError> {
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
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(if status.is_client_error() {
                BitgoError::ClientError { status, body }
            } else if status.is_server_error() {
                BitgoError::ServerError { status, body }
            } else {
                BitgoError::UnexpectedStatus { status, body }
            });
        }

        let entry = response
            .json::<TxRequestEntry>()
            .await
            .map_err(|e| BitgoError::Parse(e.to_string()))?;
        Ok(entry.into())
    }

    async fn get_tx_request(&self, tx_request_id: &str) -> Result<TxRequestResponse, BitgoError> {
        let url = format!(
            "{}/api/v2/wallet/{}/txrequests",
            self.settings.base_url, self.settings.wallet_id,
        );

        let response = self
            .http
            .get(&url)
            .query(&[("txRequestIds", tx_request_id)])
            .bearer_auth(&self.settings.access_token)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(if status.is_client_error() {
                BitgoError::ClientError { status, body }
            } else if status.is_server_error() {
                BitgoError::ServerError { status, body }
            } else {
                BitgoError::UnexpectedStatus { status, body }
            });
        }

        let list = response
            .json::<TxRequestListResponse>()
            .await
            .map_err(|e| BitgoError::Parse(e.to_string()))?;

        let mut entries = list.tx_requests;
        if entries.is_empty() {
            return Err(BitgoError::Parse(format!(
                "BitGo returned empty txRequests array for {tx_request_id}"
            )));
        }

        // BitGo returns one row per version; the row with `latest: true` is
        // the current state. Fall back to the highest `version` if no row is
        // flagged `latest` (defensive — shouldn't happen in practice).
        let idx = entries
            .iter()
            .position(|e| e.latest)
            .or_else(|| {
                entries
                    .iter()
                    .enumerate()
                    .max_by_key(|(_, e)| e.version)
                    .map(|(i, _)| i)
            })
            .unwrap_or(0);
        Ok(entries.swap_remove(idx).into())
    }
}
