use serde::Deserialize;
use utoipa::ToSchema;

use crate::AppState;

/// Optional `chain_id` query parameter. Falls back to `state.default_chain_id` when absent.
#[derive(Deserialize, ToSchema, Default)]
pub struct ChainQuery {
    /// Chain ID (optional — defaults to the server's `DEFAULT_CHAIN_ID`).
    pub chain_id: Option<i64>,
}

/// Resolve the effective chain_id from an optional query param.
/// Returns `q.chain_id` when present, otherwise `state.default_chain_id`.
pub fn resolve_chain(state: &AppState, chain_id: Option<i64>) -> i64 {
    chain_id.unwrap_or(state.default_chain_id)
}
