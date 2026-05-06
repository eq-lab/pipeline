use serde::{Deserialize, Serialize};

/// Top-level wrapper for Crystal API responses.
#[derive(Debug, Deserialize)]
pub struct CrystalResponse<T> {
    pub data: T,
    pub meta: CrystalMeta,
}

/// Address screening response from `GET /explorer/address/{address}`.
#[derive(Debug, Deserialize)]
pub struct AddressData {
    pub address: String,
    pub riskscore: RiskScore,
    pub balance: Option<f64>,
    pub status: Option<String>,
    pub first_activity: Option<i64>,
    pub last_activity: Option<i64>,
    pub n_tx: Option<i64>,
}

/// Transaction screening response from `GET /explorer/tx/{hash}`.
#[derive(Debug, Deserialize)]
pub struct TxData {
    pub hash: String,
    pub riskscore: RiskScore,
    pub input: TxParty,
    pub output: TxParty,
    pub amount: Option<f64>,
    #[serde(rename = "type")]
    pub tx_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TxParty {
    pub address: String,
    pub riskscore: Option<f64>,
    #[serde(rename = "type")]
    pub party_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RiskScore {
    pub value: f64,
    pub signals: RiskSignals,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RiskSignals {
    #[serde(default)]
    pub sanctions: f64,
    #[serde(default)]
    pub terrorism_financing: f64,
    #[serde(default)]
    pub stolen_coins: f64,
    #[serde(default)]
    pub dark_market: f64,
    #[serde(default)]
    pub dark_service: f64,
    #[serde(default)]
    pub scam: f64,
    #[serde(default)]
    pub ransom: f64,
    #[serde(default)]
    pub child_exploitation: f64,
    #[serde(default)]
    pub mixer: f64,
    #[serde(default)]
    pub enforcement_action: f64,
    #[serde(default)]
    pub exchange_fraudulent: f64,
    #[serde(default)]
    pub exchange_licensed: f64,
    #[serde(default)]
    pub exchange_unlicensed: f64,
    #[serde(default)]
    pub gambling: f64,
    #[serde(default)]
    pub illegal_service: f64,
    #[serde(default)]
    pub liquidity_pools: f64,
    #[serde(default)]
    pub marketplace: f64,
    #[serde(default)]
    pub miner: f64,
    #[serde(default)]
    pub other: f64,
    #[serde(default)]
    pub p2p_exchange_licensed: f64,
    #[serde(default)]
    pub p2p_exchange_unlicensed: f64,
    #[serde(default)]
    pub payment: f64,
    #[serde(default)]
    pub seized_assets: f64,
    #[serde(default)]
    pub atm: f64,
    #[serde(default)]
    pub wallet: f64,
}

impl RiskSignals {
    /// Get the value of a signal by name. Returns `None` for unknown signal names.
    pub fn get(&self, name: &str) -> Option<f64> {
        match name {
            "sanctions" => Some(self.sanctions),
            "terrorism_financing" => Some(self.terrorism_financing),
            "stolen_coins" => Some(self.stolen_coins),
            "dark_market" => Some(self.dark_market),
            "dark_service" => Some(self.dark_service),
            "scam" => Some(self.scam),
            "ransom" => Some(self.ransom),
            "child_exploitation" => Some(self.child_exploitation),
            "mixer" => Some(self.mixer),
            "enforcement_action" => Some(self.enforcement_action),
            "exchange_fraudulent" => Some(self.exchange_fraudulent),
            "exchange_licensed" => Some(self.exchange_licensed),
            "exchange_unlicensed" => Some(self.exchange_unlicensed),
            "gambling" => Some(self.gambling),
            "illegal_service" => Some(self.illegal_service),
            "liquidity_pools" => Some(self.liquidity_pools),
            "marketplace" => Some(self.marketplace),
            "miner" => Some(self.miner),
            "other" => Some(self.other),
            "p2p_exchange_licensed" => Some(self.p2p_exchange_licensed),
            "p2p_exchange_unlicensed" => Some(self.p2p_exchange_unlicensed),
            "payment" => Some(self.payment),
            "seized_assets" => Some(self.seized_assets),
            "atm" => Some(self.atm),
            "wallet" => Some(self.wallet),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CrystalMeta {
    pub calls_left: Option<i64>,
    pub calls_used: Option<i64>,
    pub error_code: i32,
    #[serde(default)]
    pub error_message: String,
}
