// spec: docs/product-specs/minter-cash-book.md#api-contract
use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::State;
use axum::http::Uri;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use shared::contract_logs_repo::MinterEventRow;
use shared::db::EventRepo;
use shared::lp_repo::StellarAddressHolder;
use utoipa::{OpenApi, ToSchema};

use crate::auth::{AuthClaims, Claims, SecurityAddon};
use crate::config::ConfiguredChain;
use crate::error::ApiError;
use crate::formatting::iso_utc_from_unix;
use crate::minter_cash_book::{
    build_ramps, build_wire_ins, build_wire_outs, fold_cash, to_base6_string, CashBookFold,
    CashBookWireOut,
};
use crate::routes::common::{parse_required_chain, require_trustee, RequiredChain};
use crate::AppState;

#[derive(Debug, Serialize, ToSchema)]
pub struct CashBookSummary {
    pub bank_cash: String,
    pub in_flight: String,
    pub complete: bool,
    pub checkpoint_ledger: Option<i64>,
    pub as_of_ledger: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CashBookWireInItem {
    pub id: i64,
    pub status: String,
    pub receiver: String,
    pub amount: String,
    pub value_date: String,
    pub ref_hash: String,
    pub recorded_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub returned_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_ref_hash: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CashBookWireOutItem {
    pub id: i64,
    pub status: String,
    pub lp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lp_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lp_legal_name: Option<String>,
    pub amount: String,
    pub requested_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settled_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CashBookRampItem {
    pub id: i64,
    pub status: String,
    pub direction: String,
    pub amount: String,
    pub opened_at: String,
    pub open_ref_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close_ref_hash: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CashBookResponse {
    pub chain_id: i64,
    pub minter: String,
    pub summary: CashBookSummary,
    pub wire_ins: Vec<CashBookWireInItem>,
    pub wire_outs: Vec<CashBookWireOutItem>,
    pub ramps: Vec<CashBookRampItem>,
}

#[derive(OpenApi)]
#[openapi(
    paths(get_cash_book),
    components(schemas(
        CashBookResponse,
        CashBookSummary,
        CashBookWireInItem,
        CashBookWireOutItem,
        CashBookRampItem
    )),
    modifiers(&SecurityAddon),
    tags((
        name = "CashBook",
        description = "Stellar minter cash book folded from indexed minter events"
    ))
)]
pub struct CashBookDoc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/cash-book", get(get_cash_book))
}

#[utoipa::path(
    get,
    path = "/v1/cash-book",
    params(RequiredChain),
    responses(
        (status = 200, description = "Cash-book summary, wire-ins, wire-outs and ramps of the chain's minter", body = CashBookResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "The chain has no minter configured (`minter_not_configured`)"),
        (status = 500, description = "Internal error"),
    ),
    security(("bearer_auth" = [])),
    tag = "CashBook"
)]
async fn get_cash_book(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    uri: Uri,
) -> Result<Json<CashBookResponse>, ApiError> {
    let (chain, minter) = authorize(&claims, &uri, &state.chains, &state.minter_addresses)?;
    let cursor = EventRepo::new(state.pool.clone())
        .get_cursor(chain.chain_id)
        .await?;
    let (rows, fold_rows) = tokio::try_join!(
        state
            .contract_logs_repo
            .list_minter_events(chain.chain_id, minter),
        state
            .contract_logs_repo
            .list_minter_fold_events(chain.chain_id, minter),
    )?;
    let wire_outs = build_wire_outs(&rows);
    let links = distinct_wire_out_links(&wire_outs);
    let holders = state
        .lp_repo
        .holders_of_stellar_addresses(chain.chain_id, &links)
        .await?;
    Ok(Json(build_response(
        chain.chain_id,
        minter,
        as_of_ledger(cursor),
        &fold_cash(&fold_rows),
        &rows,
        wire_outs,
        &holders,
    )))
}

pub fn as_of_ledger(cursor: u64) -> i64 {
    cursor.saturating_sub(1) as i64
}

pub fn authorize<'a, S: std::hash::BuildHasher>(
    claims: &Claims,
    uri: &Uri,
    chains: &[ConfiguredChain],
    minter_addresses: &'a HashMap<i64, String, S>,
) -> Result<(ConfiguredChain, &'a str), ApiError> {
    require_trustee(claims)?;
    let chain = parse_required_chain(uri, chains)?;
    let minter = resolve_minter(chain, minter_addresses)?;
    Ok((chain, minter))
}

pub fn resolve_minter<S: std::hash::BuildHasher>(
    chain: ConfiguredChain,
    minter_addresses: &HashMap<i64, String, S>,
) -> Result<&str, ApiError> {
    minter_addresses
        .get(&chain.chain_id)
        .map(String::as_str)
        .ok_or_else(|| ApiError::NotFound("minter_not_configured".to_owned()))
}

fn distinct_wire_out_links(wire_outs: &[CashBookWireOut]) -> Vec<(String, i64)> {
    let mut links: Vec<(String, i64)> = wire_outs
        .iter()
        .map(|w| (w.lp.clone(), w.requested_at))
        .collect();
    links.sort();
    links.dedup();
    links
}

pub fn build_response(
    chain_id: i64,
    minter: &str,
    as_of_ledger: i64,
    fold: &CashBookFold,
    rows: &[MinterEventRow],
    wire_outs: Vec<CashBookWireOut>,
    holders: &[StellarAddressHolder],
) -> CashBookResponse {
    let by_link: HashMap<(&str, i64), &StellarAddressHolder> = holders
        .iter()
        .map(|h| ((h.address.as_str(), h.requested_at), h))
        .collect();

    let wire_ins = build_wire_ins(rows, minter)
        .into_iter()
        .map(|w| CashBookWireInItem {
            id: w.id,
            status: w.status.as_str().to_owned(),
            receiver: w.receiver,
            amount: to_base6_string(w.amount),
            value_date: iso_utc_from_unix(w.value_date),
            ref_hash: w.ref_hash,
            recorded_at: iso_utc_from_unix(w.recorded_at),
            assigned_at: w.assigned_at.map(iso_utc_from_unix),
            returned_at: w.returned_at.map(iso_utc_from_unix),
            return_ref_hash: w.return_ref_hash,
        })
        .collect();

    let wire_outs = wire_outs
        .into_iter()
        .map(|w| {
            let holder = by_link.get(&(w.lp.as_str(), w.requested_at));
            CashBookWireOutItem {
                id: w.id,
                status: w.status.as_str().to_owned(),
                lp_id: holder.map(|h| h.lp_id),
                lp_legal_name: holder.map(|h| h.legal_name.clone()),
                lp: w.lp,
                amount: to_base6_string(w.amount),
                requested_at: iso_utc_from_unix(w.requested_at),
                settled_at: w.settled_at.map(iso_utc_from_unix),
                value_date: w.value_date.map(iso_utc_from_unix),
                ref_hash: w.ref_hash,
                cancelled_at: w.cancelled_at.map(iso_utc_from_unix),
            }
        })
        .collect();

    let ramps = build_ramps(rows)
        .into_iter()
        .map(|r| CashBookRampItem {
            id: r.id,
            status: r.status.as_str().to_owned(),
            direction: r.direction,
            amount: to_base6_string(r.amount),
            opened_at: iso_utc_from_unix(r.opened_at),
            open_ref_hash: r.open_ref_hash,
            received: r.received.map(to_base6_string),
            loss: r.loss.map(to_base6_string),
            closed_at: r.closed_at.map(iso_utc_from_unix),
            close_ref_hash: r.close_ref_hash,
        })
        .collect();

    CashBookResponse {
        chain_id,
        minter: minter.to_owned(),
        summary: CashBookSummary {
            bank_cash: to_base6_string(fold.bank_cash),
            in_flight: to_base6_string(fold.in_flight),
            complete: fold.complete,
            checkpoint_ledger: fold.checkpoint_ledger,
            as_of_ledger,
        },
        wire_ins,
        wire_outs,
        ramps,
    }
}
