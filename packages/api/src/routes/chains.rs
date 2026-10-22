// spec: docs/user-stories/epic-1521/1608-chains-endpoint.md

use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use shared::chains::ChainKind;
use utoipa::{OpenApi, ToSchema};

use crate::config::ConfiguredChain;
use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/chains", get(get_chains))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_chains),
    components(schemas(ChainsResponse, ChainItem, ChainKind)),
    tags((name = "Chains", description = "Chains this API serves"))
)]
pub struct ChainsDoc;

#[derive(Debug, Serialize, ToSchema)]
pub struct ChainItem {
    pub chain_id: i64,
    pub kind: ChainKind,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ChainsResponse {
    pub chains: Vec<ChainItem>,
}

pub fn chains_response(chains: &[ConfiguredChain]) -> ChainsResponse {
    ChainsResponse {
        chains: chains
            .iter()
            .map(|c| ChainItem {
                chain_id: c.chain_id,
                kind: c.kind,
            })
            .collect(),
    }
}

#[utoipa::path(
    get,
    path = "/v1/chains",
    responses(
        (status = 200, description = "Every chain in `CHAINS`, in `CHAINS` order, with its kind. Public; a `chain_id` absent from this list is not served by the API", body = ChainsResponse),
    ),
    tag = "Chains"
)]
async fn get_chains(State(state): State<Arc<AppState>>) -> Json<ChainsResponse> {
    Json(chains_response(&state.chains))
}
