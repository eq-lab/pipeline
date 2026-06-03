use serde::{Deserialize, Serialize};

/// Structured error type returned by `BitgoClient` operations.
///
/// This replaces generic `anyhow` errors so callers can pattern-match on
/// whether a failure is definitive (4xx client error) or transient (5xx /
/// network).
#[derive(Debug, thiserror::Error)]
pub enum BitgoError {
    #[error("BitGo network/transport error: {0}")]
    Transport(#[from] reqwest::Error),

    #[error("BitGo returned 4xx status {status}: {body}")]
    ClientError {
        status: reqwest::StatusCode,
        body: String,
    },

    #[error("BitGo returned 5xx status {status}: {body}")]
    ServerError {
        status: reqwest::StatusCode,
        body: String,
    },

    #[error("BitGo returned unexpected status {status}: {body}")]
    UnexpectedStatus {
        status: reqwest::StatusCode,
        body: String,
    },

    #[error("Failed to parse BitGo response: {0}")]
    Parse(String),
}

impl BitgoError {
    /// True for failures that won't resolve by retrying. Used by Phase 4 to
    /// classify definitive vs. transient errors.
    ///
    /// - `ClientError` (4xx): a misconfigured request. Retrying replays the
    ///   same bad payload.
    /// - `Parse`: BitGo returned a 200 response with a body our deserializer
    ///   can't handle. Cause is either a BitGo API change or a bug in our
    ///   `TxRequestResponse` struct; retrying won't help.
    /// - `UnexpectedStatus` (3xx or other non-success / non-error): retrying
    ///   is unlikely to yield a different result on a tx-submit POST.
    ///
    /// `Transport` (network) and `ServerError` (5xx) are transient.
    pub fn is_definitive(&self) -> bool {
        matches!(
            self,
            BitgoError::ClientError { .. }
                | BitgoError::Parse(_)
                | BitgoError::UnexpectedStatus { .. }
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TxRequestPayload {
    pub intent: TxIntent,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TxIntent {
    pub intent_type: String,
    pub recipients: Vec<Recipient>,
}

#[derive(Debug, Serialize)]
pub struct Recipient {
    pub address: RecipientAddress,
    pub amount: RecipientAmount,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RecipientAddress {
    pub address: String,
}

#[derive(Debug, Serialize)]
pub struct RecipientAmount {
    pub value: String,
    pub symbol: String,
}

/// The lifecycle state of a BitGo tx request.
///
/// BitGo can return additional states in future — the `Unknown` catch-all
/// ensures forward-compatibility without breaking deserialization.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TxRequestState {
    /// Freshly created; not yet through policy checks.
    Initialized,
    /// Awaiting multi-party approval.
    PendingApproval,
    /// Approved; waiting to be broadcast.
    PendingDelivery,
    /// Awaiting a user signature share (TSS).
    PendingUserSignature,
    /// Awaiting a user commitment share (TSS).
    PendingUserCommitment,
    /// Awaiting a user R share (TSS).
    PendingUserRShare,
    /// Awaiting a user G share (TSS).
    PendingUserGShare,
    /// All shares collected; ready for BitGo to broadcast.
    ReadyToSend,
    /// Signed but not yet broadcast.
    Signed,
    /// BitGo has broadcast the transaction and it was included in a block.
    /// `tx_hash` is populated, but inclusion does **not** imply success — the
    /// EVM may still have reverted. Callers must verify execution status via
    /// `eth_getTransactionReceipt` before treating the row as confirmed.
    Delivered,
    /// Rejected by an approver.
    Rejected,
    /// Canceled by the requester or an operator.
    Canceled,
    /// BitGo marked the request as failed.
    Failed,
    /// Catch-all for any state strings not listed above (forward-compat).
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxRequestResponse {
    pub tx_request_id: Option<String>,
    pub status: Option<String>,
    /// BitGo lifecycle state (see `TxRequestState`).
    pub state: TxRequestState,
    /// On-chain transaction hash — populated once `state == Delivered`.
    #[serde(rename = "txHash")]
    pub tx_hash: Option<String>,
}

/// A single transaction record inside `TxRequestEntry.transactions`. BitGo
/// places the on-chain hash here (not at the top level) once the request
/// reaches `delivered`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxRequestTransaction {
    #[serde(rename = "txHash")]
    pub tx_hash: Option<String>,
}

/// One row of a BitGo tx-request response.
///
/// Used both for `POST /txrequests` (single object) and for each element of
/// the array returned by `GET /txrequests?txRequestIds=…`. BitGo stores
/// tx-request state transitions append-only: each version is its own object,
/// and exactly one row in a GET response has `latest: true`. `get_tx_request`
/// selects that row and flattens it into a `TxRequestResponse`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxRequestEntry {
    pub tx_request_id: Option<String>,
    pub state: TxRequestState,
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub latest: bool,
    /// Per-transaction records. For EVM coins BitGo emits one element here;
    /// `txHash` is populated on `delivered` and absent earlier.
    #[serde(default)]
    pub transactions: Vec<TxRequestTransaction>,
}

impl From<TxRequestEntry> for TxRequestResponse {
    fn from(entry: TxRequestEntry) -> Self {
        let tx_hash = entry.transactions.into_iter().find_map(|t| t.tx_hash);
        TxRequestResponse {
            tx_request_id: entry.tx_request_id,
            status: None,
            state: entry.state,
            tx_hash,
        }
    }
}

/// Wrapper for `GET /api/v2/wallet/{walletId}/txrequests?txRequestIds=…`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxRequestListResponse {
    pub tx_requests: Vec<TxRequestEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tx_request_state_decodes_all_variants() {
        let cases: &[(&str, TxRequestState)] = &[
            (r#""initialized""#, TxRequestState::Initialized),
            (r#""pendingApproval""#, TxRequestState::PendingApproval),
            (r#""pendingDelivery""#, TxRequestState::PendingDelivery),
            (
                r#""pendingUserSignature""#,
                TxRequestState::PendingUserSignature,
            ),
            (
                r#""pendingUserCommitment""#,
                TxRequestState::PendingUserCommitment,
            ),
            (r#""pendingUserRShare""#, TxRequestState::PendingUserRShare),
            (r#""pendingUserGShare""#, TxRequestState::PendingUserGShare),
            (r#""readyToSend""#, TxRequestState::ReadyToSend),
            (r#""signed""#, TxRequestState::Signed),
            (r#""delivered""#, TxRequestState::Delivered),
            (r#""rejected""#, TxRequestState::Rejected),
            (r#""canceled""#, TxRequestState::Canceled),
            (r#""failed""#, TxRequestState::Failed),
            (r#""someFutureState""#, TxRequestState::Unknown),
        ];

        for (json, expected) in cases {
            let decoded: TxRequestState = serde_json::from_str(json).expect("should deserialize");
            assert_eq!(
                decoded, *expected,
                "state {json} should decode to {expected:?}"
            );
        }
    }

    /// Real-shape sample taken from a BitGo GET response. `txHash` is nested
    /// inside `transactions[*]`, not at the top level — the `From` impl must
    /// surface it on `TxRequestResponse.tx_hash`.
    #[test]
    fn delivered_entry_extracts_nested_tx_hash() {
        let json = r#"{
            "txRequestId": "3aba16d7-c262-4d23-93ef-5f272171daf6",
            "version": 13,
            "state": "delivered",
            "latest": true,
            "transactions": [
                {
                    "state": "delivered",
                    "txHash": "0x08bece5a30ebf52ee0245b621cc94e9bda9894fad71574465283763d44cd987e"
                }
            ]
        }"#;

        let entry: TxRequestEntry = serde_json::from_str(json).expect("entry should decode");
        assert_eq!(entry.state, TxRequestState::Delivered);
        assert!(entry.latest);
        assert_eq!(entry.version, 13);

        let response: TxRequestResponse = entry.into();
        assert_eq!(
            response.tx_hash.as_deref(),
            Some("0x08bece5a30ebf52ee0245b621cc94e9bda9894fad71574465283763d44cd987e")
        );
    }

    /// `GET /txrequests?txRequestIds=…` returns one entry per version. Verify
    /// the wrapper deserializes and we can pick the latest row.
    #[test]
    fn list_response_decodes_multi_version_array() {
        let json = r#"{
            "txRequests": [
                {"txRequestId": "id-1", "state": "initialized", "version": 1, "latest": false, "transactions": []},
                {"txRequestId": "id-1", "state": "delivered", "version": 2, "latest": true,
                 "transactions": [{"state": "delivered", "txHash": "0xabc"}]}
            ]
        }"#;

        let list: TxRequestListResponse = serde_json::from_str(json).expect("list should decode");
        assert_eq!(list.tx_requests.len(), 2);

        let latest = list
            .tx_requests
            .into_iter()
            .find(|e| e.latest)
            .expect("one row should be latest");
        let response: TxRequestResponse = latest.into();
        assert_eq!(response.state, TxRequestState::Delivered);
        assert_eq!(response.tx_hash.as_deref(), Some("0xabc"));
    }
}
