use std::str::FromStr;

use std::sync::Arc;

use axum::extract::{FromRequestParts, Query};
use axum::http::request::Parts;
use axum::http::Uri;
use bigdecimal::BigDecimal;
use serde::{Deserialize, Serialize};
use utoipa::openapi::path::{Parameter, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::{KnownFormat, ObjectBuilder, SchemaFormat, SchemaType, Type};
use utoipa::openapi::Required;
use utoipa::{IntoParams, ToSchema};

use crate::auth::{Claims, TRUSTEE_ROLE};
use crate::config::ConfiguredChain;
use crate::error::ApiError;
use crate::AppState;

/// Optional `chain_id` query parameter. Falls back to `state.default_chain_id` when absent.
#[derive(Deserialize, ToSchema, Default)]
pub struct ChainQuery {
    /// Chain ID (optional — defaults to the server's `DEFAULT_CHAIN_ID`).
    pub chain_id: Option<i64>,
}

/// Max/min/time-weighted-average summary for a time series, over the series'
/// queried window. `average` is the integral of the series over time, divided
/// by the window length — not a plain mean of the emitted samples, so it is
/// stable under `interval` changes.
///
/// Shared by `/v1/dashboard/tvl-history`, `/v1/dashboard/yield-history`, and
/// `/v1/positions/history` so the three time-series endpoints agree on shape.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SeriesStat {
    pub max: String,
    pub min: String,
    pub average: String,
}

/// Resolve the effective chain_id from an optional query param.
/// Returns `q.chain_id` when present, otherwise `state.default_chain_id`.
pub fn resolve_chain(state: &AppState, chain_id: Option<i64>) -> i64 {
    chain_id.unwrap_or(state.default_chain_id)
}

/// LoanRegistry address the LoanBook readers are scoped to on `chain_id`.
/// Startup guarantees every configured chain has one, so the error is reachable only
/// for a chain that is not configured.
pub fn loan_registry_address(state: &AppState, chain_id: i64) -> Result<&str, ApiError> {
    state
        .loan_registry_addresses
        .get(&chain_id)
        .map(String::as_str)
        .ok_or_else(|| ApiError::BadRequest(format!("unknown chain_id: {chain_id}")))
}

/// Pure pre-checks of the trustee per-loan guard (no I/O): trustee role → 403, malformed
/// loan id → 400, then the LoanRegistry address scoped to `chain_id`. Returns the parsed
/// loan id and the registry address.
pub fn trustee_loan_precheck<'a>(
    claims: &Claims,
    state: &'a AppState,
    chain_id: i64,
    loan_id: &str,
) -> Result<(BigDecimal, &'a str), ApiError> {
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

    let parsed = BigDecimal::from_str(loan_id.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid loan_id: {loan_id}")))?;

    let registry = loan_registry_address(state, chain_id)?;
    Ok((parsed, registry))
}

/// Shared guard for trustee-only per-loan writes/reads on `/v1/loan-book/{loan_id}/…`.
/// The chain is already resolved by `RequiredChain` before the guard runs. Checks, in
/// order: trustee role → 403, malformed loan id → 400, loan with no indexed events on
/// `chain_id` → 404 (via the latest-status lookup). Returns the parsed loan id. Used by
/// `routes::loan_book::complete_disbursement` and both `routes::loan_transfers` handlers
/// so the 400/403/404 semantics cannot drift between them.
pub(crate) async fn trustee_indexed_loan_guard(
    claims: &Claims,
    state: &AppState,
    chain_id: i64,
    loan_id: &str,
) -> Result<BigDecimal, ApiError> {
    let (loan_id, registry) = trustee_loan_precheck(claims, state, chain_id, loan_id)?;

    // 404 when the loan isn't indexed on this chain (no on-chain snapshot). Reuses
    // the latest-status lookup: an empty result means the loan has no indexed events.
    let indexed = state
        .contract_logs_repo
        .latest_status_by_loans(
            &state.pool,
            chain_id,
            registry,
            std::slice::from_ref(&loan_id),
        )
        .await?;
    if indexed.is_empty() {
        return Err(ApiError::NotFound(format!(
            "loan {loan_id} not indexed on chain {chain_id}"
        )));
    }

    Ok(loan_id)
}

#[derive(Deserialize)]
struct RawChainParam {
    chain_id: Option<String>,
}

fn parse_chain_id_param(uri: &Uri) -> Result<Option<i64>, ApiError> {
    let Query(raw) = Query::<RawChainParam>::try_from_uri(uri).map_err(|e| {
        let detail = if e.body_text().contains("duplicate field") {
            "must appear at most once"
        } else {
            "malformed query string"
        };
        ApiError::BadRequest(format!("invalid chain_id: {detail}"))
    })?;
    let Some(raw) = raw.chain_id else {
        return Ok(None);
    };
    i64::from_str(raw.trim()).map(Some).map_err(|_| {
        let shown: String = raw.trim().chars().take(32).collect();
        ApiError::BadRequest(format!("invalid chain_id: {shown}"))
    })
}

/// Optional `chain_id` query parameter parsed from the URI; `None` means all configured chains.
pub fn parse_chain_filter(
    uri: &Uri,
    chains: &[ConfiguredChain],
) -> Result<Option<ConfiguredChain>, ApiError> {
    let Some(id) = parse_chain_id_param(uri)? else {
        return Ok(None);
    };
    lookup_chain(chains, id).map(Some)
}

/// The configured chain with `id`, or the `unknown chain_id` 400 naming the configured ids.
pub fn lookup_chain(chains: &[ConfiguredChain], id: i64) -> Result<ConfiguredChain, ApiError> {
    chains
        .iter()
        .find(|c| c.chain_id == id)
        .copied()
        .ok_or_else(|| {
            let configured = chains
                .iter()
                .map(|c| c.chain_id.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            ApiError::BadRequest(format!("unknown chain_id: {id} (configured: {configured})"))
        })
}

/// Required `chain_id` from a request body: `None` → `chain_id is required`, else `lookup_chain`.
pub fn require_chain_id(
    chains: &[ConfiguredChain],
    id: Option<i64>,
) -> Result<ConfiguredChain, ApiError> {
    let id = id.ok_or_else(|| ApiError::BadRequest("chain_id is required".into()))?;
    lookup_chain(chains, id)
}

/// Chain selection for endpoints that answer an empty result for a well-formed id outside `CHAINS`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainScope {
    All,
    One(ConfiguredChain),
    Unconfigured(i64),
}

/// Like `parse_chain_filter`, but a well-formed id outside `CHAINS` is `Unconfigured`, not a 400.
pub fn parse_chain_scope(uri: &Uri, chains: &[ConfiguredChain]) -> Result<ChainScope, ApiError> {
    Ok(match parse_chain_id_param(uri)? {
        None => ChainScope::All,
        Some(id) => match chains.iter().find(|c| c.chain_id == id) {
            Some(c) => ChainScope::One(*c),
            None => ChainScope::Unconfigured(id),
        },
    })
}

/// Required `chain_id` query parameter parsed from the URI.
pub fn parse_required_chain(
    uri: &Uri,
    chains: &[ConfiguredChain],
) -> Result<ConfiguredChain, ApiError> {
    parse_chain_filter(uri, chains)?
        .ok_or_else(|| ApiError::BadRequest("chain_id is required".into()))
}

/// Optional `chain_id` filter validated against `CHAINS`; `None` means all configured chains.
pub struct ChainFilter(pub Option<ConfiguredChain>);

/// Required `chain_id` validated against `CHAINS`.
pub struct RequiredChain(pub ConfiguredChain);

/// Optional `chain_id` that tolerates an id outside `CHAINS` (see `ChainScope`).
pub struct LenientChainFilter(pub ChainScope);

impl LenientChainFilter {
    pub fn chain_ids(&self, all: &[ConfiguredChain]) -> Vec<i64> {
        match self.0 {
            ChainScope::All => all.iter().map(|c| c.chain_id).collect(),
            ChainScope::One(c) => vec![c.chain_id],
            ChainScope::Unconfigured(id) => vec![id],
        }
    }
}

impl ChainFilter {
    pub fn chain_id(&self) -> Option<i64> {
        self.0.map(|c| c.chain_id)
    }

    pub fn resolve<'a>(&'a self, all: &'a [ConfiguredChain]) -> &'a [ConfiguredChain] {
        match &self.0 {
            Some(c) => std::slice::from_ref(c),
            None => all,
        }
    }
}

impl FromRequestParts<Arc<AppState>> for ChainFilter {
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> impl std::future::Future<Output = Result<Self, ApiError>> + Send {
        std::future::ready(parse_chain_filter(&parts.uri, &state.chains).map(Self))
    }
}

impl FromRequestParts<Arc<AppState>> for LenientChainFilter {
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> impl std::future::Future<Output = Result<Self, ApiError>> + Send {
        std::future::ready(parse_chain_scope(&parts.uri, &state.chains).map(Self))
    }
}

impl FromRequestParts<Arc<AppState>> for RequiredChain {
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> impl std::future::Future<Output = Result<Self, ApiError>> + Send {
        std::future::ready(parse_required_chain(&parts.uri, &state.chains).map(Self))
    }
}

fn chain_id_param(required: Required, description: &str) -> Vec<Parameter> {
    vec![ParameterBuilder::new()
        .name("chain_id")
        .parameter_in(ParameterIn::Query)
        .required(required)
        .description(Some(description))
        .schema(Some(
            ObjectBuilder::new()
                .schema_type(SchemaType::Type(Type::Integer))
                .format(Some(SchemaFormat::KnownFormat(KnownFormat::Int64))),
        ))
        .build()]
}

impl IntoParams for ChainFilter {
    fn into_params(_: impl Fn() -> Option<ParameterIn>) -> Vec<Parameter> {
        chain_id_param(
            Required::False,
            "Chain ID to filter by. Optional — omit for all configured chains (CHAINS). An id not in CHAINS → 400.",
        )
    }
}

impl IntoParams for LenientChainFilter {
    fn into_params(_: impl Fn() -> Option<ParameterIn>) -> Vec<Parameter> {
        chain_id_param(
            Required::False,
            "Chain ID to filter by. Optional — omit for all configured chains (CHAINS). An id not in CHAINS returns an empty result; a malformed or repeated value → 400.",
        )
    }
}

impl IntoParams for RequiredChain {
    fn into_params(_: impl Fn() -> Option<ParameterIn>) -> Vec<Parameter> {
        chain_id_param(
            Required::True,
            "Chain ID the request targets. Required. Missing, malformed, or not in CHAINS → 400.",
        )
    }
}
