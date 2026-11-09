// spec: docs/product-specs/loan-security-state.md#api-contract
use std::collections::HashMap;
use std::hash::BuildHasher;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use shared::security_registry_repo::SecurityRegistryRepo;
use utoipa::OpenApi;

use crate::config::ConfiguredChain;
use crate::error::ApiError;
use crate::routes::common::{loan_registry_address, RequiredChain};
use crate::security_state::{
    build_security_response, ConsentDto, InspectionDto, LastPriceStaleDto, LoanSecurityResponse,
    LotDto, MarginCallDto, MarginEventDto, PricesDto, RecordDocDto, RecordMarkDto,
    RecordValuationDto, SaleRepaymentDto, SecurityRecordDto, SecurityTermsDto,
    SecurityValuationDto, ValuationAsOfDto,
};
use crate::AppState;

#[derive(OpenApi)]
#[openapi(
    paths(get_loan_security),
    components(schemas(
        LoanSecurityResponse,
        SecurityTermsDto,
        SecurityValuationDto,
        ValuationAsOfDto,
        MarginCallDto,
        MarginEventDto,
        LastPriceStaleDto,
        PricesDto,
        ConsentDto,
        SecurityRecordDto,
        RecordDocDto,
        RecordMarkDto,
        LotDto,
        RecordValuationDto,
        InspectionDto,
        SaleRepaymentDto
    )),
    tags((
        name = "LoanBook",
        description = "Stellar SecurityRegistry state of a loan, read from the indexed projection"
    ))
)]
pub struct LoanSecurityDoc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/loan-book/{loan_id}/security", get(get_loan_security))
}

pub fn resolve_security_registry<S: BuildHasher>(
    chain: ConfiguredChain,
    security_registry_addresses: &HashMap<i64, String, S>,
) -> Result<&str, ApiError> {
    security_registry_addresses
        .get(&chain.chain_id)
        .map(String::as_str)
        .ok_or_else(|| ApiError::NotFound("security_registry_not_configured".to_owned()))
}

pub fn parse_loan_id(raw: &str) -> Result<u32, ApiError> {
    raw.trim().parse::<u32>().map_err(|_| {
        ApiError::BadRequest(format!(
            "invalid loan_id: {}",
            raw.chars().take(32).collect::<String>()
        ))
    })
}

#[utoipa::path(
    get,
    path = "/v1/loan-book/{loan_id}/security",
    params(
        ("loan_id" = String, Path, description = "On-chain loan id (u32)"),
        RequiredChain
    ),
    responses(
        (status = 200, description = "Terms, valuation, margin-call state, prices and every record of the loan; an unknown loan id returns empty state (`terms: null`, `records: []`)", body = LoanSecurityResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id, or malformed loan_id"),
        (status = 404, description = "The chain has no SecurityRegistry configured (`security_registry_not_configured`)"),
        (status = 500, description = "Internal error"),
    ),
    tag = "LoanBook"
)]
async fn get_loan_security(
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    RequiredChain(chain): RequiredChain,
) -> Result<Json<LoanSecurityResponse>, ApiError> {
    let contract = resolve_security_registry(chain, &state.security_registry_addresses)?;
    let id = parse_loan_id(&loan_id)?;
    let registry = loan_registry_address(&state, chain.chain_id)?;
    let rows = SecurityRegistryRepo::new(state.pool.clone())
        .load_loan_security(chain.chain_id, contract, id, registry)
        .await?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    Ok(Json(build_security_response(
        chain.chain_id,
        contract,
        &id.to_string(),
        &rows,
        now,
    )))
}
