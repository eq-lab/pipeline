// spec: docs/product-specs/trustee-attention-counts.md#api-contract
use std::collections::{HashMap, HashSet};
use std::hash::BuildHasher;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::Uri;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use shared::contract_logs_repo::{LifecycleRow, LoanSnapshotRow, MinterEventRow};
use shared::loan_status::{LoanStatus, LoanTimeline};
use shared::security_registry_repo::SecurityRegistryRepo;
use shared::submitted_loan_repo::SubmissionCountsRow;
use utoipa::{OpenApi, ToSchema};

use crate::auth::{AuthClaims, Claims, SecurityAddon};
use crate::config::ConfiguredChain;
use crate::error::ApiError;
use crate::minter_cash_book::{
    build_ramps, build_wire_ins, build_wire_outs, RampStatus, WireInStatus, WireOutStatus,
};
use crate::routes::common::{
    loan_registry_address, parse_chain_scope, require_trustee, ChainScope, LenientChainFilter,
};
use crate::routes::loan_book::{display_status, loan_key, STATUS_DISBURSING, STATUS_PAST_DUE};
use crate::routes::ramp::{filter_pending_ramp_events, RampEvent};
use crate::AppState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct OriginationCounts {
    pub count: i64,
    pub in_review: i64,
    pub changes_requested: i64,
    pub approved_undrawn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct LoanCounts {
    pub count: i64,
    pub watch_list: i64,
    pub past_due: i64,
    pub margin_call_open: Option<i64>,
    pub disbursing: i64,
    pub defaulted: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct CashManagementCounts {
    pub count: i64,
    pub escrowed_wire_ins: Option<i64>,
    pub pending_wire_outs: Option<i64>,
    pub open_ramps: Option<i64>,
    pub pending_ramp_events: Option<i64>,
    pub pending_bank_deposits: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ChainAttentionCounts {
    pub chain_id: i64,
    pub origination: OriginationCounts,
    pub loans: LoanCounts,
    pub cash_management: CashManagementCounts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AttentionCountsResponse {
    pub origination: OriginationCounts,
    pub loans: LoanCounts,
    pub cash_management: CashManagementCounts,
    pub chains: Vec<ChainAttentionCounts>,
}

#[derive(OpenApi)]
#[openapi(
    paths(get_attention_counts),
    components(schemas(
        AttentionCountsResponse,
        ChainAttentionCounts,
        OriginationCounts,
        LoanCounts,
        CashManagementCounts
    )),
    modifiers(&SecurityAddon),
    tags((
        name = "AttentionCounts",
        description = "Per-section pending counts for the Trustee sidebar badges"
    ))
)]
pub struct AttentionCountsDoc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/attention-counts", get(get_attention_counts))
}

#[utoipa::path(
    get,
    path = "/v1/attention-counts",
    params(LenientChainFilter),
    responses(
        (status = 200, description = "Origination, Loans and Cash Management pending counts over the in-scope chains, with a per-chain breakdown", body = AttentionCountsResponse),
        (status = 400, description = "Malformed or repeated chain_id"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 500, description = "Internal error"),
    ),
    security(("bearer_auth" = [])),
    tag = "AttentionCounts"
)]
async fn get_attention_counts(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    uri: Uri,
) -> Result<Json<AttentionCountsResponse>, ApiError> {
    let filter = LenientChainFilter(authorize(&claims, &uri, &state.chains)?);
    let chains: Vec<ConfiguredChain> = filter.configured(&state.chains).to_vec();
    if chains.is_empty() {
        return Ok(Json(build_response(Vec::new())));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let ids: Vec<i64> = chains.iter().map(|c| c.chain_id).collect();
    let (submissions, pending_bank_deposits) = tokio::try_join!(
        state.submitted_loan_repo.count_undrawn_by_chain(&ids),
        state.lp_bank_deposit_repo.count_pending(),
    )?;
    let out = futures::future::try_join_all(
        chains
            .into_iter()
            .map(|chain| chain_counts(&state, chain, now, &submissions, pending_bank_deposits)),
    )
    .await?;
    Ok(Json(build_response(out)))
}

async fn chain_counts(
    state: &AppState,
    chain: ConfiguredChain,
    now: i64,
    submissions: &[SubmissionCountsRow],
    pending_bank_deposits: i64,
) -> Result<ChainAttentionCounts, ApiError> {
    let id = chain.chain_id;
    let registry = loan_registry_address(state, id)?;
    let (snapshots, lifecycle, disbursements, margin_calls, minter_rows, transfers) = tokio::try_join!(
        async {
            state
                .contract_logs_repo
                .list_latest_loan_snapshots(&state.pool, id, registry, now)
                .await
                .map_err(ApiError::from)
        },
        async {
            state
                .contract_logs_repo
                .list_loan_lifecycle_events_for_registry(&state.pool, id, registry, now)
                .await
                .map_err(ApiError::from)
        },
        async {
            state
                .loan_disbursement_repo
                .list_for_chain(id)
                .await
                .map_err(ApiError::from)
        },
        async {
            match state.security_registry_addresses.get(&id) {
                Some(contract) => SecurityRegistryRepo::new(state.pool.clone())
                    .list_open_margin_call_loans(id, contract)
                    .await
                    .map(Some)
                    .map_err(ApiError::from),
                None => Ok(None),
            }
        },
        async {
            match state.minter_addresses.get(&id) {
                Some(minter) => state
                    .contract_logs_repo
                    .list_minter_events(id, minter)
                    .await
                    .map(|rows| Some((rows, minter.as_str())))
                    .map_err(ApiError::from),
                None => Ok(None),
            }
        },
        async {
            match state
                .transfer_addresses
                .get(&id)
                .filter(|_| !state.minter_addresses.contains_key(&id))
            {
                Some(addr) => state
                    .contract_logs_repo
                    .list_asset_transfers(&state.pool, id, now)
                    .await
                    .map(|t| Some(filter_pending_ramp_events(&t, addr)))
                    .map_err(ApiError::from),
                None => Ok(None),
            }
        },
    )?;
    let disbursed: HashMap<String, bool> = disbursements
        .iter()
        .map(|(loan_id, complete)| (loan_key(loan_id), *complete))
        .collect();
    let open_margin_calls: Option<HashSet<String>> =
        margin_calls.map(|ids| ids.iter().map(i64::to_string).collect());
    Ok(ChainAttentionCounts {
        chain_id: id,
        origination: origination_counts(id, submissions),
        loans: loan_counts(
            &snapshots,
            &lifecycle,
            &disbursed,
            open_margin_calls.as_ref(),
            now,
        ),
        cash_management: cash_management_counts(
            minter_rows.as_ref().map(|(rows, m)| (rows.as_slice(), *m)),
            transfers.as_deref(),
            pending_bank_deposits,
        ),
    })
}

pub fn authorize(
    claims: &Claims,
    uri: &Uri,
    chains: &[ConfiguredChain],
) -> Result<ChainScope, ApiError> {
    require_trustee(claims)?;
    parse_chain_scope(uri, chains)
}

pub fn origination_counts(chain_id: i64, rows: &[SubmissionCountsRow]) -> OriginationCounts {
    let (in_review, changes_requested, approved_undrawn) = rows
        .iter()
        .find(|r| r.target_chain_id == chain_id)
        .map_or((0, 0, 0), |r| {
            (r.in_review, r.changes_requested, r.approved_undrawn)
        });
    OriginationCounts {
        count: in_review + approved_undrawn,
        in_review,
        changes_requested,
        approved_undrawn,
    }
}

pub fn loan_counts<S: BuildHasher, T: BuildHasher>(
    snapshots: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    disbursed: &HashMap<String, bool, S>,
    open_margin_calls: Option<&HashSet<String, T>>,
    now: i64,
) -> LoanCounts {
    let mut counts = LoanCounts {
        count: 0,
        watch_list: 0,
        past_due: 0,
        margin_call_open: open_margin_calls.map(|_| 0),
        disbursing: 0,
        defaulted: 0,
    };
    for s in snapshots {
        let timeline = LoanTimeline::for_loan(s, events);
        let effective = timeline.status_at(now);
        if timeline.origination() > now || effective == LoanStatus::Closed {
            continue;
        }
        let key = loan_key(&s.loan_id);
        let margin_open = open_margin_calls.is_some_and(|m| m.contains(&key));
        if margin_open {
            counts.margin_call_open = counts.margin_call_open.map(|n| n + 1);
        }
        if effective == LoanStatus::Default {
            counts.defaulted += 1;
            continue;
        }
        let complete = disbursed.get(&key).copied().unwrap_or(false);
        let display = display_status(
            &s.snapshot.status,
            complete,
            now,
            s.snapshot.current_maturity_timestamp,
        );
        let attention = match display.as_str() {
            STATUS_PAST_DUE => {
                counts.past_due += 1;
                true
            }
            STATUS_DISBURSING => {
                counts.disbursing += 1;
                true
            }
            other if LoanStatus::parse(other) == Some(LoanStatus::WatchList) => {
                counts.watch_list += 1;
                true
            }
            _ => false,
        };
        if attention || margin_open {
            counts.count += 1;
        }
    }
    counts
}

pub fn cash_management_counts(
    minter: Option<(&[MinterEventRow], &str)>,
    pending_ramp_events: Option<&[RampEvent]>,
    pending_bank_deposits: i64,
) -> CashManagementCounts {
    let (escrowed_wire_ins, pending_wire_outs, open_ramps) = match minter {
        Some((rows, minter_address)) => (
            Some(
                build_wire_ins(rows, minter_address)
                    .iter()
                    .filter(|w| w.status == WireInStatus::Escrowed)
                    .count() as i64,
            ),
            Some(
                build_wire_outs(rows)
                    .iter()
                    .filter(|w| w.status == WireOutStatus::Pending)
                    .count() as i64,
            ),
            Some(
                build_ramps(rows)
                    .iter()
                    .filter(|r| r.status == RampStatus::Open)
                    .count() as i64,
            ),
        ),
        None => (None, None, None),
    };
    let pending_events = match minter {
        Some(_) => None,
        None => pending_ramp_events.map(|e| e.len() as i64),
    };
    CashManagementCounts {
        count: escrowed_wire_ins.unwrap_or(0)
            + pending_wire_outs.unwrap_or(0)
            + open_ramps.unwrap_or(0)
            + pending_events.unwrap_or(0)
            + pending_bank_deposits,
        escrowed_wire_ins,
        pending_wire_outs,
        open_ramps,
        pending_ramp_events: pending_events,
        pending_bank_deposits,
    }
}

fn sum_nullable(values: impl Iterator<Item = Option<i64>>) -> Option<i64> {
    values.fold(None, |acc, v| match (acc, v) {
        (None, v) => v,
        (acc, None) => acc,
        (Some(a), Some(b)) => Some(a + b),
    })
}

pub fn build_response(chains: Vec<ChainAttentionCounts>) -> AttentionCountsResponse {
    let sum = |f: fn(&ChainAttentionCounts) -> i64| chains.iter().map(f).sum::<i64>();
    let nullable = |f: fn(&ChainAttentionCounts) -> Option<i64>| sum_nullable(chains.iter().map(f));
    let pending_bank_deposits = chains
        .first()
        .map_or(0, |c| c.cash_management.pending_bank_deposits);
    let cash_count = sum(|c| c.cash_management.count - c.cash_management.pending_bank_deposits)
        + pending_bank_deposits;
    AttentionCountsResponse {
        origination: OriginationCounts {
            count: sum(|c| c.origination.count),
            in_review: sum(|c| c.origination.in_review),
            changes_requested: sum(|c| c.origination.changes_requested),
            approved_undrawn: sum(|c| c.origination.approved_undrawn),
        },
        loans: LoanCounts {
            count: sum(|c| c.loans.count),
            watch_list: sum(|c| c.loans.watch_list),
            past_due: sum(|c| c.loans.past_due),
            margin_call_open: nullable(|c| c.loans.margin_call_open),
            disbursing: sum(|c| c.loans.disbursing),
            defaulted: sum(|c| c.loans.defaulted),
        },
        cash_management: CashManagementCounts {
            count: cash_count,
            escrowed_wire_ins: nullable(|c| c.cash_management.escrowed_wire_ins),
            pending_wire_outs: nullable(|c| c.cash_management.pending_wire_outs),
            open_ramps: nullable(|c| c.cash_management.open_ramps),
            pending_ramp_events: nullable(|c| c.cash_management.pending_ramp_events),
            pending_bank_deposits,
        },
        chains,
    }
}
