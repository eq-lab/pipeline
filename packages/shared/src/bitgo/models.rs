use serde::{Deserialize, Serialize};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxRequestResponse {
    pub tx_request_id: Option<String>,
    pub status: Option<String>,
}
