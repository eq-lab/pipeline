use std::str::FromStr;

use bigdecimal::BigDecimal;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::auth::{Claims, TRUSTEE_ROLE};
use crate::error::ApiError;
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

/// Shared guard for trustee-only per-loan writes/reads on `/v1/loan-book/{loan_id}/…`:
/// trustee role → 403, malformed loan id → 400, loan with no indexed events on the
/// resolved chain → 404 (via the latest-status lookup). Returns the resolved
/// `(chain_id, loan_id)`. Used by `routes::loan_book::complete_disbursement` and
/// both `routes::loan_transfers` handlers so the 400/403/404 semantics cannot
/// drift between them.
pub(crate) async fn trustee_indexed_loan_guard(
    claims: &Claims,
    state: &AppState,
    loan_id: &str,
    query: &ChainQuery,
) -> Result<(i64, BigDecimal), ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

    let chain_id = resolve_chain(state, query.chain_id);
    let loan_id = BigDecimal::from_str(loan_id.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid loan_id: {loan_id}")))?;

    // 404 when the loan isn't indexed on this chain (no on-chain snapshot). Reuses
    // the latest-status lookup: an empty result means the loan has no indexed events.
    let indexed = state
        .contract_logs_repo
        .latest_status_by_loans(&state.pool, chain_id, std::slice::from_ref(&loan_id))
        .await?;
    if indexed.is_empty() {
        return Err(ApiError::NotFound(format!(
            "loan {loan_id} not indexed on chain {chain_id}"
        )));
    }

    Ok((chain_id, loan_id))
}
