use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Signal name → proportion (0.0–1.0).
pub type RiskSignals = HashMap<String, f64>;

/// Request body for `POST /risk-check`.
#[derive(Debug, Serialize)]
pub struct RiskCheckRequest {
    #[serde(rename = "type")]
    pub check_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blockchain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
}

/// Top-level wrapper for Crystal API responses.
#[derive(Debug, Deserialize)]
pub struct CrystalResponse {
    pub data: Option<RiskCheckData>,
    pub meta: CrystalMeta,
}

/// Response `data` from `POST /risk-check`.
///
/// For address checks: `counterparty` contains the risk data.
/// For transaction checks: `counterparty` plus top-level `signals` (unidirectional).
#[derive(Debug, Deserialize)]
pub struct RiskCheckData {
    pub counterparty: Counterparty,
    /// Unidirectional signals for transaction checks (source or destination
    /// depending on deposit vs withdrawal).
    pub signals: Option<RiskSignals>,
    pub amount: Option<f64>,
    pub fiat: Option<i64>,
    pub time: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct Counterparty {
    pub address: Option<String>,
    pub riskscore: Option<f64>,
    pub signals: Option<DirectionalSignals>,
    #[serde(default)]
    pub blocklist: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(rename = "type")]
    pub counterparty_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DirectionalSignals {
    #[serde(default)]
    pub received: RiskSignals,
    #[serde(default)]
    pub sent: RiskSignals,
}

#[derive(Debug, Deserialize)]
pub struct CrystalMeta {
    pub calls_left: Option<i64>,
    pub calls_used: Option<i64>,
    pub error_code: i32,
    #[serde(default)]
    pub error_message: String,
}
