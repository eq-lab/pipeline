// spec: docs/product-specs/loan-security-state.md#api-contract
use std::collections::HashMap;
use std::hash::BuildHasher;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use shared::access_manager_repo::AccessManagerRepo;
use shared::collateral_valuation_repo::{AssayRow, OfftakeTermsRow};
use shared::security_registry::security_params;
use shared::security_registry_repo::{LoanSecurityRows, SecurityRegistryRepo};
use utoipa::OpenApi;

use crate::config::ConfiguredChain;
use crate::error::ApiError;
use crate::pending_operations::{
    pending_for_loan, PendingOperation, PendingOperationState, PendingTargetKind, TargetScope,
};
use crate::routes::common::{loan_registry_address, RequiredChain};
use crate::security_state::{
    build_security_response, mark_price_pairs, needs_concentrate_inputs, ConsentDto,
    DefaultBreachDto, DefaultBreachEventDto, InspectionDto, LastPriceStaleDto,
    LoanSecurityResponse, LotDto, MarginCallDto, MarginEventDto, MarkInputs, PricesDto,
    RecordDocDto, RecordMarkDto, RecordValuationDto, SaleRepaymentDto, SecurityRecordDto,
    SecurityTermsDto, SecurityValuationDto, SuggestedMarkDto, ValuationAsOfDto,
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
        DefaultBreachDto,
        DefaultBreachEventDto,
        LastPriceStaleDto,
        PricesDto,
        ConsentDto,
        SecurityRecordDto,
        RecordDocDto,
        RecordMarkDto,
        SuggestedMarkDto,
        LotDto,
        RecordValuationDto,
        InspectionDto,
        SaleRepaymentDto,
        PendingOperation,
        PendingOperationState,
        PendingTargetKind
    )),
    tags((
        name = "LoanBook",
        description = "SecurityRegistry state of a loan (Stellar and EVM), read from the indexed projection"
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

pub fn security_log_contracts<S: BuildHasher>(
    chain: ConfiguredChain,
    contract: &str,
    nfts: &HashMap<i64, String, S>,
) -> Vec<String> {
    let mut out = vec![contract.to_owned()];
    out.extend(nfts.get(&chain.chain_id).cloned());
    out
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
        (status = 200, description = "Terms, valuation, margin-call state, prices and every record of the loan, with a suggested mark per open goods record, and the loan's pending SecurityRegistry operations scheduled on the AccessManager; an unknown loan id returns empty state (`terms: null`, `records: []`)", body = LoanSecurityResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id, or malformed loan_id"),
        (status = 404, description = "The chain has no SecurityRegistry configured (`security_registry_not_configured`): the Stellar key, or both EVM keys (SecurityRegistry and RecordNft)"),
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
    let log_contracts =
        security_log_contracts(chain, contract, &state.security_record_nft_addresses);
    let rows = SecurityRegistryRepo::new(state.pool.clone())
        .load_loan_security(chain.chain_id, contract, &log_contracts, id, registry)
        .await?;
    let marks = load_mark_inputs(&state, chain.chain_id, id, &rows).await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let mut response = build_security_response(
        chain.chain_id,
        security_params(chain.kind),
        contract,
        &id.to_string(),
        &rows,
        now,
        &marks,
    );
    let scope = TargetScope {
        security_registry: Some(contract),
        ..TargetScope::default()
    };
    let pending = AccessManagerRepo::new(state.pool.clone())
        .list_pending_loan_ops(
            chain.chain_id,
            &scope.targets(),
            Some(contract),
            Some(i64::from(id)),
        )
        .await?;
    response.pending_operations = pending_for_loan(&pending, &scope, now as i64);
    Ok(Json(response))
}

async fn load_mark_inputs<'a>(
    state: &'a AppState,
    chain_id: i64,
    loan_id: u32,
    rows: &LoanSecurityRows,
) -> MarkInputs<'a> {
    let settings = &state.security_marks;
    if settings.map.is_empty() {
        return MarkInputs {
            settings,
            ..MarkInputs::default()
        };
    }
    let concentrate = if needs_concentrate_inputs(rows, &settings.map) {
        read_concentrate(state, chain_id, loan_id).await
    } else {
        None
    };
    let pairs = mark_price_pairs(
        rows,
        &settings.map,
        concentrate.as_ref().map(|(_, offtake)| offtake),
    );
    let prices = match state.loan_asset_price_repo.latest_prices_for(&pairs).await {
        Ok(found) => found
            .into_iter()
            .map(|(asset, provider, price, at)| ((asset, provider), (price, at)))
            .collect(),
        Err(e) => {
            tracing::warn!(error = ?e, loan_id, "mark source prices unreadable; suggestions degrade");
            HashMap::new()
        }
    };
    MarkInputs {
        settings,
        prices,
        concentrate,
    }
}

async fn read_concentrate(
    state: &AppState,
    chain_id: i64,
    loan_id: u32,
) -> Option<(AssayRow, OfftakeTermsRow)> {
    let key = BigDecimal::from(loan_id);
    let repo = &state.collateral_valuation_repo;
    let (assay, offtake) = tokio::join!(
        repo.latest_assay(chain_id, &key),
        repo.latest_offtake(chain_id, &key)
    );
    match (assay, offtake) {
        (Ok(Some(a)), Ok(Some(o))) => Some((a, o)),
        (Err(e), _) | (_, Err(e)) => {
            tracing::warn!(error = ?e, loan_id, "assay or offtake unreadable; concentrate marks degrade");
            None
        }
        _ => None,
    }
}
