use serde::Deserialize;

/// Response from `POST /v2/wallet/synchronous` (wallet_exposure) and
/// `POST /v2/analyses/synchronous` (source_of_funds).
///
/// `triggered_rules` and `evaluation_detail` are kept as raw JSON: their inner
/// shape differs by endpoint (`evaluation_detail` is an object `{source,destination}`
/// for wallet screening but an array for transaction analysis), so a typed model
/// would need two variants. We only need `risk_score` and whether any rule fired.
#[derive(Debug, Deserialize)]
pub struct EllipticResponse {
    /// Overall risk score on a 0–1 scale; `null` when Elliptic has no data.
    #[serde(default)]
    pub risk_score: Option<f64>,
    /// Customer-configured risk rules that fired. Present (often empty) on wallet
    /// responses, absent on transaction responses → default to empty. Non-empty ⇒ risky.
    #[serde(default)]
    pub triggered_rules: Vec<serde_json::Value>,
    /// Per-rule exposure breakdown; shape varies by endpoint. Stored as the audit
    /// "signals" JSON, not used for the risk decision. Defaults to JSON null if absent.
    #[serde(default)]
    pub evaluation_detail: serde_json::Value,
    /// Processing status reported by Elliptic. Synchronous endpoints return `"complete"`
    /// when the analysis finished successfully. Absent from some endpoints → treated as complete.
    #[serde(default)]
    pub process_status: Option<String>,
    /// Error payload from Elliptic. Non-null indicates a failed analysis.
    #[serde(default)]
    pub error: Option<serde_json::Value>,
}

impl EllipticResponse {
    /// True when Elliptic finished the analysis without error. A response that is
    /// not complete (or carries an error) must NOT be treated as a clear result.
    pub fn is_complete(&self) -> bool {
        self.error.is_none()
            && self
                .process_status
                .as_deref()
                .is_none_or(|s| s == "complete")
    }
}
