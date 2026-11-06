//! Trustee Audit Log endpoint (`GET /v1/audit-log`).
//!
//! Read-only, paginated, reverse-chronological feed backing Surface 17 ("Audit Log") of
//! the Trustee dashboard. Sourced entirely from `contract_logs` — the indexed on-chain
//! event store — matching the sourcing of the other Trustee reads (`loan_book`,
//! `withdrawal_queue`, `ccr_history`). Conventions match `routes::financial_position`:
//! Axum handler, utoipa schema, `chain_id?` — omitted = every configured chain merged
//! newest-first (`block_timestamp`, then block / log order), a configured id = that chain,
//! a well-formed unconfigured id = `{"items":[]}` with no DB call, malformed or repeated = 400.
//! Each item carries its `chain_id`, and amounts are rendered with that row's chain kind.
//!
//! **On-chain only (v1).** The full protocol audit log (see
//! `docs/product-specs/audit-logging.md`) also records off-chain relayer/operator actions
//! — fiat wire confirmations, MPC co-signatures, USDC↔USYC swaps — which are not persisted
//! in a queryable store today. Those rows do not appear here yet; serving them is a
//! follow-up. See `docs/exec-plans/completed/issue-1000-audit-log-endpoint.md`.
//!
//! Each item carries a server-rendered human-readable `action`, the raw `event_name`, a
//! curated `details` object (the same scalars the action string is built from), the
//! resolved `scope` (`Loan #<id>` / `Protocol`), an ISO-8601 `timestamp`, and `reference`
//! — the friendly loan name (`"<originator> — <commodity>"`, sourced from the loan
//! snapshot), empty string for protocol-scoped events, for loans missing either field, and
//! for Minter / CollateralRegistry / SecurityRegistry / DealTokenFactory / Pocket rows (no snapshot).
//!
//! Besides the loan lifecycle, the feed carries the Minter cash events, the
//! CollateralRegistry lot events, the DealTokenFactory events (#1478), the Pocket events (#1789) and the
//! SecurityRegistry events (#1781); Stellar CollateralRegistry rows are marked legacy in `action`. Per-transfer
//! `DealTokenTransfer` rows are deliberately left out. Historical `YieldMinted`,
//! `LoanCCRUpdated` and `LoanLocationUpdated` rows are no longer indexed but keep rendering.
//! The WithdrawalQueue's one-time `WithdrawalRateSet` recovery rate (#1791) is also listed.
//!
//! The feed is returned in full (newest first) — it is not paginated.

use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode};
use serde::Serialize;
use serde_json::{json, Value};
use utoipa::{OpenApi, ToSchema};

use shared::chains::ChainKind;
use shared::contract_logs_repo::AuditLogRow;
use shared::loan_economics::economics_rate_to_bps;

use crate::config::ConfiguredChain;
use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::routes::common::LenientChainFilter;
use crate::AppState;

/// On-chain events surfaced in the Trustee audit feed: loan lifecycle, Minter cash,
/// CollateralRegistry, SecurityRegistry and DealTokenFactory events, plus the historical `YieldMinted` /
/// `LoanCCRUpdated` / `LoanLocationUpdated` rows. LP-facing events (deposits, withdrawals,
/// staking, raw transfers) and `DealTokenTransfer` are deliberately excluded as low-signal.
/// This allow-list also gates the action formatter — an `event_name` outside it never
/// reaches `format_action`.
pub const AUDIT_EVENT_NAMES: &[&str] = &[
    "LoanDrawn",
    "PaymentRecorded",
    "YieldMinted",
    "LoanCCRUpdated",
    "LoanStatusUpdated",
    "LoanClosed",
    "LoanDefaulted",
    "LoanRolledOver",
    "EconomicsAmended",
    "LoanLocationUpdated",
    "Disbursed",
    "Undisbursed",
    "PaymentUnrecorded",
    "LoanWrittenDown",
    "InterestAdjusted",
    "CashDisbursed",
    "CashDisbursementReversed",
    "CashRepaid",
    "CashRepaymentReversed",
    "WireInReturned",
    "WireOutRequested",
    "WireOutSettled",
    "WireOutCancelled",
    "RampOpened",
    "RampClosed",
    "CashRecorded",
    "CashCorrected",
    "MintCorrected",
    "LossAbsorbed",
    "Pledged",
    "HaircutSet",
    "FloorSet",
    "Revalued",
    "StageUpdated",
    "ControlUpdated",
    "DocAdded",
    "QuantityAdjusted",
    "Released",
    "Liquidated",
    "MarginCall",
    "DealRegistered",
    "DebtSynced",
    "CargoSynced",
    "WithdrawalRateSet",
    "PocketOpened",
    "PocketReleased",
    "PocketUnreleased",
    "PocketBurned",
    "PocketClaimed",
    "SecurityRecordRegistered",
    "SecurityRecordPerfected",
    "SecurityRecordHandedOver",
    "SecurityRecordAttested",
    "SecurityDocAdded",
    "SecurityRecordReleased",
    "SecurityMandateBreach",
    "SecurityEnforcementStarted",
    "SecurityRecordEnforced",
    "SecurityTermsSet",
    "SecurityRevalued",
    "SecurityMarginCall",
    "SecurityPriceStale",
    "SecurityMarginCallCured",
    "SecurityInspectionRecorded",
    "SecurityInspectionApproved",
    "SecurityFlagResolved",
    "SecurityExtensionConsent",
    "SecurityInspectorsSet",
    "SecurityRegistryPaused",
    "SecurityRegistryUnpaused",
];

const LEGACY_COLLATERAL_REGISTRY_NAMES: [&str; 11] = [
    "Pledged",
    "HaircutSet",
    "FloorSet",
    "Revalued",
    "StageUpdated",
    "ControlUpdated",
    "DocAdded",
    "QuantityAdjusted",
    "Released",
    "Liquidated",
    "MarginCall",
];

const LEGACY_COLLATERAL_REGISTRY_SUFFIX: &str = " (legacy collateral registry)";
const UNBOUNDED_LTV_BPS: i64 = u32::MAX as i64;

struct Proceeds {
    repayment_ids: Vec<String>,
    cash_raw: i128,
}

type ProceedsKey = (i64, String, String);

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// What a log entry pertains to: a specific loan, or the protocol at large.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditScope {
    /// On-chain loan id (`uint256`, decimal string) for loan-scoped events; `null` for
    /// protocol-scoped events (e.g. `WireOutRequested`).
    pub loan_id: Option<String>,
    /// Human-readable scope label, e.g. `"Loan #4492"` or `"Protocol"`. This is the
    /// loan **number** — see `AuditLogItem::reference` for the loan **name**.
    pub label: String,
}

/// One row of the Audit Log table.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditLogItem {
    /// Chain the event was indexed on.
    pub chain_id: i64,
    /// Event time, ISO-8601 UTC (from the on-chain block timestamp).
    pub timestamp: String,
    /// Server-rendered, human-readable description of the action.
    pub action: String,
    /// What the action pertains to.
    pub scope: AuditScope,
    /// Friendly loan name, `"<originator> — <commodity>"` (e.g. `"Open Mineral — Copper
    /// Concentrate"`), sourced from the loan's on-chain snapshot. Empty string for
    /// rows without a snapshot (protocol-scoped, Minter, CollateralRegistry, SecurityRegistry,
    /// DealTokenFactory) and for any
    /// loan-scoped row missing either the originator or the commodity. This is
    /// deliberately distinct from `scope.label` (`"Loan #<id>"` / `"Protocol"`), which
    /// is the loan number, not the loan name.
    pub reference: String,
    /// Raw on-chain event name (e.g. `"PaymentRecorded"`), for clients that prefer to
    /// format their own action string.
    pub event_name: String,
    /// Curated scalar fields backing `action` (amounts already in decimal dollar units),
    /// so clients can re-render without re-parsing raw params. Shape varies by event.
    /// `DealRegistered.cargo` is `null` when the deal has no CARGO token (Stellar, from contracts #38).
    pub details: Value,
}

/// Response for `GET /v1/audit-log`.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditLogResponse {
    /// All log entries, newest first (all configured chains merged when `chain_id` is omitted).
    pub items: Vec<AuditLogItem>,
}

/// OpenAPI doc bundle for the audit-log route.
#[derive(OpenApi)]
#[openapi(
    paths(get_audit_log),
    components(schemas(AuditLogResponse, AuditLogItem, AuditScope)),
    tags((name = "AuditLog", description = "Trustee audit log feed (on-chain events)"))
)]
pub struct AuditLogDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/audit-log", get(get_audit_log))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/audit-log",
    params(LenientChainFilter),
    responses(
        (status = 200, description = "The full audit log feed, newest first, for the selected chain or merged over all configured chains when `chain_id` is omitted; a well-formed but unconfigured `chain_id` yields an empty list", body = AuditLogResponse),
        (status = 400, description = "Malformed or repeated chain_id"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "AuditLog"
)]
async fn get_audit_log(
    State(state): State<Arc<AppState>>,
    chain: LenientChainFilter,
) -> Result<Json<AuditLogResponse>, ApiError> {
    let chains = chain.configured(&state.chains);
    let mut rows = Vec::new();
    for c in chains {
        rows.extend(
            state
                .contract_logs_repo
                .list_audit_log(&state.pool, c.chain_id, AUDIT_EVENT_NAMES)
                .await?,
        );
    }

    Ok(Json(build_response(rows, chains)))
}

// ── Compute (pure — unit-tested without DB/HTTP) ──────────────────────────────

/// Order `rows` newest-first (`block_timestamp`, then `block_number`, then `log_index`,
/// then `chain_id`) and map them into the response. Each row's amount scale comes from
/// its own chain's kind in `chains` (Stellar's Soroban contracts store monetary fields at
/// 7 decimals vs. EVM's 6, #901); a row whose chain is not in `chains` is dropped.
///
/// Public so `packages/api/tests/audit_log.rs` can exercise the mapping without a DB.
pub fn build_response(mut rows: Vec<AuditLogRow>, chains: &[ConfiguredChain]) -> AuditLogResponse {
    rows.sort_by(|a, b| {
        (b.block_timestamp, b.block_number, b.log_index, b.chain_id).cmp(&(
            a.block_timestamp,
            a.block_number,
            a.log_index,
            a.chain_id,
        ))
    });
    let proceeds = enforcement_proceeds(&rows, chains);
    let items = rows
        .into_iter()
        .filter(|row| !is_noop_sync(&row.event_name, &row.params))
        .filter_map(|row| {
            let kind = chains.iter().find(|c| c.chain_id == row.chain_id)?.kind;
            Some(map_item(row, kind, &proceeds))
        })
        .collect();
    AuditLogResponse { items }
}

fn enforcement_proceeds(
    rows: &[AuditLogRow],
    chains: &[ConfiguredChain],
) -> HashMap<ProceedsKey, Proceeds> {
    let configured = |row: &AuditLogRow| chains.iter().any(|c| c.chain_id == row.chain_id);
    let loan_of = |row: &AuditLogRow| row.loan_id.clone().filter(|id| !id.is_empty());
    let enforced: HashSet<ProceedsKey> = rows
        .iter()
        .filter(|row| row.event_name == "SecurityRecordEnforced" && configured(row))
        .filter_map(|row| {
            Some((
                row.chain_id,
                loan_of(row)?,
                param_str(&row.params, "record_id")?,
            ))
        })
        .collect();
    let mut linked: HashMap<ProceedsKey, Proceeds> = HashMap::new();
    if enforced.is_empty() {
        return linked;
    }
    let loans: HashSet<(i64, String)> = enforced
        .iter()
        .map(|(chain, loan, _)| (*chain, loan.clone()))
        .collect();
    let reversed: HashSet<ProceedsKey> = rows
        .iter()
        .filter(|row| row.event_name == "CashRepaymentReversed")
        .filter_map(|row| {
            let loan = loan_of(row)?;
            loans
                .contains(&(row.chain_id, loan.clone()))
                .then_some(())?;
            Some((row.chain_id, loan, param_str(&row.params, "repayment_id")?))
        })
        .collect();
    for row in rows
        .iter()
        .filter(|row| row.event_name == "CashRepaid" && configured(row))
    {
        let (Some(loan), Some(sale), Some(repayment), Some(cash)) = (
            loan_of(row),
            param_str(&row.params, "sale_id"),
            param_str(&row.params, "repayment_id"),
            param_str(&row.params, "cash").and_then(|c| parse_raw_amount(&c)),
        ) else {
            continue;
        };
        let key = (row.chain_id, loan.clone(), sale);
        if !enforced.contains(&key) || reversed.contains(&(row.chain_id, loan, repayment.clone())) {
            continue;
        }
        let entry = linked.entry(key).or_insert_with(|| Proceeds {
            repayment_ids: Vec::new(),
            cash_raw: 0,
        });
        let Some(total) = entry.cash_raw.checked_add(cash) else {
            continue;
        };
        entry.cash_raw = total;
        entry.repayment_ids.push(repayment);
    }
    for entry in linked.values_mut() {
        entry
            .repayment_ids
            .sort_by(|a, b| (a.len(), a).cmp(&(b.len(), b)));
    }
    linked
}

/// A permissionless `DebtSynced` (`minted` and `clawed`) / `CargoSynced` (`minted` and
/// `burned`) that moved nothing: both raw amounts are present and zero. A missing or
/// unparseable amount keeps the row.
fn is_noop_sync(event_name: &str, params: &Value) -> bool {
    let keys: [&str; 2] = match event_name {
        "DebtSynced" => ["minted", "clawed"],
        "CargoSynced" => ["minted", "burned"],
        _ => return false,
    };
    keys.iter().all(|k| {
        param_str(params, k)
            .and_then(|raw| parse_raw_amount(&raw))
            .is_some_and(|v| v == 0)
    })
}

/// Map one raw row to an API item, rendering the action string, scope, and friendly
/// loan name.
fn map_item(
    row: AuditLogRow,
    chain_kind: ChainKind,
    proceeds: &HashMap<ProceedsKey, Proceeds>,
) -> AuditLogItem {
    let link = row
        .loan_id
        .clone()
        .zip(param_str(&row.params, "record_id"))
        .and_then(|(loan, record)| proceeds.get(&(row.chain_id, loan, record)));
    let (action, details) = format_linked(&row.event_name, &row.params, chain_kind, link);
    let scope = match row.loan_id.as_deref() {
        Some(id) if !id.is_empty() => AuditScope {
            loan_id: Some(id.to_owned()),
            label: format!("Loan #{id}"),
        },
        _ => AuditScope {
            loan_id: None,
            label: "Protocol".to_owned(),
        },
    };
    let reference = build_reference_name(row.originator.as_deref(), row.commodity.as_deref())
        .unwrap_or_default();
    AuditLogItem {
        chain_id: row.chain_id,
        timestamp: iso_utc_from_unix(row.block_timestamp),
        action,
        scope,
        reference,
        event_name: row.event_name,
        details,
    }
}

/// Build the friendly loan name `"<originator> — <commodity>"` from the loan snapshot's
/// two name fields. `None` unless **both** are present and non-empty — a partial
/// snapshot (or a protocol-scoped event with no snapshot at all, e.g. `YieldMinted`)
/// must not render a dangling `" — "` or a lone half of the name.
fn build_reference_name(originator: Option<&str>, commodity: Option<&str>) -> Option<String> {
    match (originator, commodity) {
        (Some(o), Some(c)) if !o.is_empty() && !c.is_empty() => Some(format!("{o} — {c}")),
        _ => None,
    }
}

/// Read a `params` field as a plain string, accepting either a JSON string or a JSON
/// number (the indexer stores `uint256`s as strings but smaller ints as numbers).
///
/// Looks at the top level first, then under `params.event`: the two indexer mappers
/// store different shapes. `ContractLogMapper` writes parser fields flat, while
/// `LoanEventMapper` rewraps them as `{loan_id, event: {...}, snapshot: {...}}`
/// (`worker/src/indexer/loan_mapper.rs`), which is why `LEGACY_YIELD_MINTED_SQL` (`shared::contract_logs_repo`) reads
/// `params->'event'->>'repayment_id'`. Reading only the top level made every
/// loan-registry `details` field null in production — issue #1096.
fn param_str(params: &Value, key: &str) -> Option<String> {
    let value = params
        .get(key)
        .or_else(|| params.get("event").and_then(|event| event.get(key)))?;
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn param_value<'a>(params: &'a Value, key: &str) -> Option<&'a Value> {
    params
        .get(key)
        .or_else(|| params.get("event").and_then(|event| event.get(key)))
}

fn param_i64(params: &Value, key: &str) -> Option<i64> {
    match param_value(params, key)? {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// Format an on-chain integer amount string as decimal dollars. `chain_kind` selects
/// the native scale — EVM's `uint256` monetary fields are already 6-decimal
/// (`normalize_usdc_amount` is a no-op); Stellar's Soroban contracts store them at
/// 7 decimals (#901), so the value is normalized to 6 decimals before formatting.
/// Returns `None` when the value is missing or unparseable.
fn param_amount(params: &Value, key: &str, chain_kind: ChainKind) -> Option<String> {
    let raw = parse_raw_amount(&param_str(params, key)?)?;
    Some(amount_from_raw(raw, chain_kind))
}

fn parse_raw_amount(raw: &str) -> Option<i128> {
    let digits = raw.strip_prefix('-').unwrap_or(raw);
    if digits.is_empty() || digits.len() > 39 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    raw.parse().ok()
}

fn amount_from_raw(raw: i128, chain_kind: ChainKind) -> String {
    let native = match chain_kind {
        ChainKind::Evm => raw,
        ChainKind::Stellar => raw / 10,
    };
    base6_to_decimal_string(&BigDecimal::from(native))
}

fn pct_from_bps(bps: i64) -> String {
    (BigDecimal::from(bps) / BigDecimal::from(100))
        .with_scale_round(2, RoundingMode::Down)
        .to_plain_string()
}

fn bps_pct(params: &Value, key: &str) -> Option<String> {
    param_i64(params, key).map(pct_from_bps)
}

fn ltv_pct(params: &Value) -> Option<String> {
    param_i64(params, "ltv_bps")
        .filter(|bps| *bps != UNBOUNDED_LTV_BPS)
        .map(pct_from_bps)
}

fn ltv_label(params: &Value) -> Option<String> {
    match param_i64(params, "ltv_bps")? {
        UNBOUNDED_LTV_BPS => Some("unbounded".to_owned()),
        bps => Some(format!("{}%", pct_from_bps(bps))),
    }
}

fn signed_bps_pct(params: &Value, key: &str) -> Option<String> {
    let bps = param_i64(params, key)?;
    let pct = pct_from_bps(bps);
    Some(if bps > 0 { format!("+{pct}") } else { pct })
}

fn duration_label(secs: u64) -> String {
    match secs {
        0 => "0s".to_owned(),
        s if s % 86_400 == 0 => format!("{}d", s / 86_400),
        s if s % 3_600 == 0 => format!("{}h", s / 3_600),
        s if s % 60 == 0 => format!("{}m", s / 60),
        s => format!("{s}s"),
    }
}

fn duration_param(params: &Value, key: &str) -> Option<String> {
    param_str(params, key)?.parse().ok().map(duration_label)
}

fn iso_param(params: &Value, key: &str) -> Option<String> {
    let secs = i64::try_from(param_str(params, key)?.parse::<u64>().ok()?).ok()?;
    chrono::DateTime::from_timestamp(secs, 0)?;
    Some(iso_utc_from_unix(secs))
}

fn default_rate_pct(params: &Value) -> Option<String> {
    let rate = u32::try_from(param_i64(params, "default_rate")?).ok()?;
    Some(pct_from_bps(i64::from(economics_rate_to_bps(i64::from(
        rate,
    )))))
}

/// Map an `(event_name, params)` pair to a human-readable action string plus a curated
/// `details` object (amounts already in decimal dollars, normalized for `chain_kind`).
/// Pure and total: any event outside [`AUDIT_EVENT_NAMES`] falls back to the raw event
/// name with empty details.
///
/// Public so `packages/api/tests/audit_log.rs` can exercise every branch without a DB.
pub fn format_action(event_name: &str, params: &Value, chain_kind: ChainKind) -> (String, Value) {
    format_linked(event_name, params, chain_kind, None)
}

fn format_linked(
    event_name: &str,
    params: &Value,
    chain_kind: ChainKind,
    link: Option<&Proceeds>,
) -> (String, Value) {
    let (mut action, details) = render(event_name, params, chain_kind, link);
    if matches!(chain_kind, ChainKind::Stellar)
        && LEGACY_COLLATERAL_REGISTRY_NAMES.contains(&event_name)
    {
        action.push_str(LEGACY_COLLATERAL_REGISTRY_SUFFIX);
    }
    (action, details)
}

fn render(
    event_name: &str,
    params: &Value,
    chain_kind: ChainKind,
    link: Option<&Proceeds>,
) -> (String, Value) {
    match event_name {
        "LoanDrawn" => ("Loan approved & minted".to_owned(), json!({})),

        "PaymentRecorded" => {
            let interest = param_amount(params, "senior_interest", chain_kind);
            let principal = param_amount(params, "senior_principal_repaid", chain_kind);
            // Principal untouched ⇒ interest-only coupon; otherwise a principal repayment.
            let interest_only = principal.as_deref() == Some("0.000000");
            let action = if interest_only {
                "Coupon recorded — interest only, principal unchanged".to_owned()
            } else {
                "Repayment recorded — principal + interest".to_owned()
            };
            (
                action,
                json!({ "senior_interest": interest, "senior_principal_repaid": principal }),
            )
        }

        // Historical rows only (no longer indexed); yield now arrives as `CashRepaid`.
        "YieldMinted" => {
            let vault = param_amount(params, "s_plusd_amount", chain_kind);
            let treasury = param_amount(params, "treasury_amount", chain_kind);
            let action = match (&vault, &treasury) {
                (Some(v), Some(t)) => format!("Coupon minted — ${v} vault + ${t} treasury"),
                _ => "Coupon minted".to_owned(),
            };
            (action, json!({ "vault": vault, "treasury": treasury }))
        }

        // Historical rows only (no longer indexed). CCR scale is ambiguous between the 1e6
        // (`CCR_ONE`) and bps conventions, so the raw value is passed through unrendered.
        "LoanCCRUpdated" => (
            "CCR written on-chain".to_owned(),
            json!({ "new_ccr": params.get("new_ccr") }),
        ),

        "LoanStatusUpdated" => {
            let status = param_str(params, "status");
            let action = match &status {
                Some(s) => format!("Status updated → {s}"),
                None => "Status updated".to_owned(),
            };
            (action, json!({ "status": status }))
        }

        "LoanClosed" => {
            let reason = param_str(params, "closure_reason");
            let action = match &reason {
                Some(r) => format!("Loan closed — {r}"),
                None => "Loan closed".to_owned(),
            };
            (action, json!({ "closure_reason": reason }))
        }

        // Shape-tolerant (#1433 D4): post-rework rows carry `outstanding`/`moved` with
        // no CCR; legacy rows (pre-rework parser) still carry `ccr_bps`. Project
        // whichever keys the row actually has rather than a fixed three-key shape
        // with nulls, so legacy rows keep rendering their original fields.
        "LoanDefaulted" => {
            let mut details = json!({});
            if let Some(outstanding) = param_amount(params, "outstanding", chain_kind) {
                details["outstanding"] = json!(outstanding);
            }
            if let Some(moved) = param_amount(params, "moved", chain_kind) {
                details["moved"] = json!(moved);
            }
            if let Some(ccr_bps) = params.get("ccr_bps") {
                details["ccr_bps"] = ccr_bps.clone();
            }
            ("Loan defaulted".to_owned(), details)
        }

        "LoanRolledOver" => ("Loan rolled over".to_owned(), economics_details(params)),

        "EconomicsAmended" => ("Economics amended".to_owned(), economics_details(params)),

        // Historical rows only (no longer indexed).
        "LoanLocationUpdated" => ("Collateral location updated".to_owned(), json!({})),

        "Disbursed" => {
            let amount = param_amount(params, "amount", chain_kind);
            let action = match &amount {
                Some(a) => format!("Disbursed — ${a}"),
                None => "Disbursed".to_owned(),
            };
            (action, json!({ "amount": amount }))
        }

        "Undisbursed" => {
            let amount = param_amount(params, "amount", chain_kind);
            let action = match &amount {
                Some(a) => format!("Disbursement reversed — ${a}"),
                None => "Disbursement reversed".to_owned(),
            };
            (action, json!({ "amount": amount }))
        }

        // Shape-tolerant (#1434 D6) — same treatment as `LoanDefaulted` above.
        "PaymentUnrecorded" => {
            let mut details = json!({});
            if let Some(principal) = param_amount(params, "senior_principal_repaid", chain_kind) {
                details["senior_principal_repaid"] = json!(principal);
            }
            if let Some(interest) = param_amount(params, "senior_interest", chain_kind) {
                details["senior_interest"] = json!(interest);
            }
            if let Some(outstanding) = param_amount(params, "outstanding", chain_kind) {
                details["outstanding"] = json!(outstanding);
            }
            ("Payment reversed".to_owned(), details)
        }

        "LoanWrittenDown" => {
            let amount = param_amount(params, "amount", chain_kind);
            let action = match &amount {
                Some(a) => format!("Loan written down — ${a}"),
                None => "Loan written down".to_owned(),
            };
            (action, json!({ "amount": amount }))
        }

        "InterestAdjusted" => {
            let delta = param_amount(params, "delta", chain_kind);
            ("Interest adjusted".to_owned(), json!({ "delta": delta }))
        }

        "CashDisbursed" => with_amount(
            "Cash disbursed",
            params,
            chain_kind,
            "amount",
            &["entry_id", "value_date"],
        ),

        "CashDisbursementReversed" => with_amount(
            "Cash disbursement reversed",
            params,
            chain_kind,
            "amount",
            &["entry_id", "original_id"],
        ),

        "CashRepaid" => {
            let interest = param_amount(params, "interest_minted", chain_kind);
            let (action, mut details) = with_amount(
                "Cash repaid",
                params,
                chain_kind,
                "cash",
                &["repayment_id", "sale_id", "value_date", "fee_shares"],
            );
            details["interest_minted"] = json!(interest);
            (action, details)
        }

        "CashRepaymentReversed" => with_amount(
            "Cash repayment reversed",
            params,
            chain_kind,
            "cash",
            &["repayment_id"],
        ),

        "WireInReturned" => with_amount("Wire-in returned", params, chain_kind, "amount", &["id"]),

        "WireOutRequested" => with_amount(
            "Wire-out requested",
            params,
            chain_kind,
            "amount",
            &["id", "lp"],
        ),

        "WireOutSettled" => with_amount(
            "Wire-out settled",
            params,
            chain_kind,
            "amount",
            &["id", "value_date"],
        ),

        "WireOutCancelled" => ("Wire-out cancelled".to_owned(), pass(params, &["id"])),

        "RampOpened" => {
            let direction = param_str(params, "direction");
            let amount = param_amount(params, "amount", chain_kind);
            let action = match (&direction, &amount) {
                (Some(d), Some(a)) => format!("Ramp opened — {d} ${a}"),
                _ => "Ramp opened".to_owned(),
            };
            (
                action,
                json!({ "id": param_str(params, "id"), "direction": direction, "amount": amount }),
            )
        }

        "RampClosed" => {
            let received = param_amount(params, "received", chain_kind);
            let loss = param_amount(params, "loss", chain_kind);
            let action = match (&received, &loss) {
                (Some(r), Some(l)) => format!("Ramp closed — received ${r}, loss ${l}"),
                _ => "Ramp closed".to_owned(),
            };
            (
                action,
                json!({ "id": param_str(params, "id"), "received": received, "loss": loss }),
            )
        }

        "CashRecorded" => {
            let reason = param_str(params, "reason");
            let delta = param_amount(params, "delta", chain_kind);
            let action = match (&reason, &delta) {
                (Some(r), Some(d)) => format!("Cash recorded — {r} {}", dollars(d)),
                _ => "Cash recorded".to_owned(),
            };
            (
                action,
                json!({
                    "reason": reason,
                    "delta": delta,
                    "entry_id": param_str(params, "entry_id"),
                    "value_date": param_str(params, "value_date"),
                }),
            )
        }

        "CashCorrected" => with_amount(
            "Cash corrected",
            params,
            chain_kind,
            "delta",
            &["entry_id", "original_id"],
        ),

        "MintCorrected" => with_amount("Mint corrected", params, chain_kind, "amount", &[]),

        "LossAbsorbed" => {
            let requested = param_amount(params, "requested", chain_kind);
            let pulled = param_amount(params, "pulled", chain_kind);
            let action = match (&requested, &pulled) {
                (Some(r), Some(p)) => format!("Loss absorbed — ${p} of ${r} requested"),
                _ => "Loss absorbed".to_owned(),
            };
            (action, json!({ "requested": requested, "pulled": pulled }))
        }

        "Pledged" => ("Collateral pledged".to_owned(), pass(params, &["lot_id"])),

        "HaircutSet" => {
            let bps = param_str(params, "bps");
            let action = match &bps {
                Some(b) => format!("Haircut set — {b} bps"),
                None => "Haircut set".to_owned(),
            };
            (action, pass(params, &["lot_id", "bps"]))
        }

        "FloorSet" => {
            let bps = param_str(params, "bps");
            let action = match &bps {
                Some(b) => format!("Coverage floor set — {b} bps"),
                None => "Coverage floor set".to_owned(),
            };
            (action, pass(params, &["bps"]))
        }

        "Revalued" => {
            let value = param_amount(params, "value_per_unit", chain_kind);
            let benchmark = param_str(params, "benchmark");
            let action = match (&value, &benchmark) {
                (Some(v), Some(b)) => format!("Collateral revalued — ${v}/unit ({b})"),
                (Some(v), None) => format!("Collateral revalued — ${v}/unit"),
                _ => "Collateral revalued".to_owned(),
            };
            (
                action,
                json!({
                    "lot_id": param_str(params, "lot_id"),
                    "value_per_unit": value,
                    "benchmark": benchmark,
                    "report_hash": param_str(params, "report_hash"),
                }),
            )
        }

        "StageUpdated" => {
            let stage = param_str(params, "stage");
            let action = match &stage {
                Some(s) => format!("Lot stage updated → {s}"),
                None => "Lot stage updated".to_owned(),
            };
            (
                action,
                json!({
                    "lot_id": param_str(params, "lot_id"),
                    "stage": stage,
                    "location": param_value(params, "location"),
                }),
            )
        }

        "ControlUpdated" => {
            let control = param_value(params, "control");
            let kind = control
                .and_then(|c| c.get("kind"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            let action = match &kind {
                Some(k) => format!("Lot control updated → {k}"),
                None => "Lot control updated".to_owned(),
            };
            (
                action,
                json!({ "lot_id": param_str(params, "lot_id"), "control": control }),
            )
        }

        "DocAdded" => {
            let kind = param_str(params, "kind");
            let action = match &kind {
                Some(k) => format!("Document added — {k}"),
                None => "Document added".to_owned(),
            };
            (action, pass(params, &["lot_id", "kind", "hash"]))
        }

        "QuantityAdjusted" => {
            let old = param_amount(params, "old_quantity", chain_kind);
            let new = param_amount(params, "new_quantity", chain_kind);
            let action = match (&old, &new) {
                (Some(o), Some(n)) => format!("Quantity adjusted — {o} → {n}"),
                _ => "Quantity adjusted".to_owned(),
            };
            (
                action,
                json!({
                    "lot_id": param_str(params, "lot_id"),
                    "old_quantity": old,
                    "new_quantity": new,
                    "reason": param_str(params, "reason"),
                    "hash": param_str(params, "hash"),
                }),
            )
        }

        "Released" => {
            let reason = param_str(params, "reason");
            let action = match &reason {
                Some(r) => format!("Collateral released — {r}"),
                None => "Collateral released".to_owned(),
            };
            (
                action,
                json!({
                    "lot_id": param_str(params, "lot_id"),
                    "quantity": param_amount(params, "quantity", chain_kind),
                    "reason": reason,
                    "ref_hash": param_str(params, "ref_hash"),
                }),
            )
        }

        "PocketOpened" => {
            let amount = param_amount(params, "amount", chain_kind);
            let action = match &amount {
                Some(a) => format!("Pocket opened — {a}"),
                None => "Pocket opened".to_owned(),
            };
            (
                action,
                json!({
                    "amount": amount,
                    "snapshot_ledger": param_str(params, "snapshot_ledger"),
                    "supply_at_snapshot": param_str(params, "supply_at_snapshot"),
                }),
            )
        }

        "PocketReleased" => {
            let released = param_amount(params, "released", chain_kind);
            let interest = param_amount(params, "interest", chain_kind);
            let action = match (&released, &interest) {
                (Some(r), Some(i)) => {
                    format!("Pocket recovery released — {r} principal, {i} interest")
                }
                _ => "Pocket recovery released".to_owned(),
            };
            (
                action,
                json!({
                    "principal": param_amount(params, "principal", chain_kind),
                    "released": released,
                    "interest": interest,
                }),
            )
        }

        "PocketUnreleased" => {
            let principal = param_amount(params, "principal", chain_kind);
            let interest = param_amount(params, "interest", chain_kind);
            let action = match (&principal, &interest) {
                (Some(p), Some(i)) => {
                    format!("Pocket release reversed — {p} principal, {i} interest burned")
                }
                _ => "Pocket release reversed".to_owned(),
            };
            (
                action,
                json!({ "principal": principal, "interest": interest }),
            )
        }

        "PocketBurned" => {
            let amount = param_amount(params, "amount", chain_kind);
            let burned = param_amount(params, "burned", chain_kind);
            let action = match (&burned, &amount) {
                (Some(b), Some(a)) => format!("Pocket write-down — {b} burned of {a}"),
                _ => "Pocket write-down".to_owned(),
            };
            (action, json!({ "amount": amount, "burned": burned }))
        }

        "PocketClaimed" => {
            let paid = param_amount(params, "paid", chain_kind);
            let paid_zero = param_value(params, "paid_zero")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let action = match (&paid, paid_zero) {
                (_, true) => "Pocket claim — nothing claimable".to_owned(),
                (Some(p), false) => format!("Pocket claim — {p}"),
                (None, false) => "Pocket claim".to_owned(),
            };
            (
                action,
                json!({
                    "holder": param_str(params, "holder"),
                    "paid": paid,
                    "paid_zero": paid_zero,
                }),
            )
        }

        "Liquidated" => (
            "Collateral liquidated".to_owned(),
            json!({
                "lot_id": param_str(params, "lot_id"),
                "sale_id": param_str(params, "sale_id"),
                "quantity": param_amount(params, "quantity", chain_kind),
            }),
        ),

        "MarginCall" => {
            let coverage = param_str(params, "coverage_bps");
            let floor = param_str(params, "floor_bps");
            let action = match (&coverage, &floor) {
                (Some(c), Some(f)) => format!("Margin call — coverage {c} bps vs floor {f} bps"),
                _ => "Margin call".to_owned(),
            };
            (action, pass(params, &["coverage_bps", "floor_bps"]))
        }

        "DealRegistered" => (
            "Deal tokens registered".to_owned(),
            pass(params, &["debt", "cargo"]),
        ),

        "DebtSynced" => {
            let minted = param_amount(params, "minted", chain_kind);
            let clawed = param_amount(params, "clawed", chain_kind);
            let action = match (&minted, &clawed) {
                (Some(m), Some(c)) => format!("Debt token synced — minted {m}, clawed back {c}"),
                _ => "Debt token synced".to_owned(),
            };
            (
                action,
                json!({
                    "target": param_amount(params, "target", chain_kind),
                    "previous": param_amount(params, "previous", chain_kind),
                    "minted": minted,
                    "clawed": clawed,
                }),
            )
        }

        "CargoSynced" => {
            let minted = param_amount(params, "minted", chain_kind);
            let burned = param_amount(params, "burned", chain_kind);
            let action = match (&minted, &burned) {
                (Some(m), Some(b)) => format!("Cargo token synced — minted {m}, burned {b}"),
                _ => "Cargo token synced".to_owned(),
            };
            (
                action,
                json!({
                    "target": param_amount(params, "target", chain_kind),
                    "previous": param_amount(params, "previous", chain_kind),
                    "minted": minted,
                    "burned": burned,
                }),
            )
        }

        "WithdrawalRateSet" => {
            let ratio = param_str(params, "new_rate")
                .and_then(|r| BigDecimal::from_str(&r).ok())
                .map(|r| {
                    (r / shared::withdrawal_rate::rate_one())
                        .with_scale_round(6, RoundingMode::Down)
                        .to_plain_string()
                });
            let action = match ratio {
                Some(r) => format!("Withdrawal recovery rate set — {r}"),
                None => "Withdrawal recovery rate set".to_owned(),
            };
            (action, pass(params, &["new_rate"]))
        }

        name if name.starts_with("Security") => render_security(name, params, chain_kind, link),

        // Unreachable in practice — the SQL allow-list filters these out before they get
        // here — but keep it total rather than panicking on an unexpected event.
        other => (other.to_owned(), json!({})),
    }
}

fn render_enforced(
    params: &Value,
    chain_kind: ChainKind,
    link: Option<&Proceeds>,
) -> (String, Value) {
    let record = param_str(params, "record_id");
    let proceeds = link.map(|l| amount_from_raw(l.cash_raw, chain_kind));
    let ids = link.map_or_else(Vec::new, |l| l.repayment_ids.clone());
    let action = match (&record, &proceeds) {
        (Some(r), Some(p)) => {
            let listed = ids
                .iter()
                .map(|id| format!("#{id}"))
                .collect::<Vec<_>>()
                .join(", ");
            let noun = if ids.len() == 1 {
                "repayment"
            } else {
                "repayments"
            };
            format!(
                "Security record #{r} enforced — proceeds {} repaid ({noun} {listed})",
                dollars(p)
            )
        }
        (Some(r), None) => format!("Security record #{r} enforced"),
        _ => "Security record enforced".to_owned(),
    };
    let mut details = pass(params, &["record_id", "proceeds_hash"]);
    details["repayment_ids"] = json!(ids);
    details["proceeds"] = json!(proceeds);
    (action, details)
}

fn render_security(
    event_name: &str,
    params: &Value,
    chain_kind: ChainKind,
    link: Option<&Proceeds>,
) -> (String, Value) {
    let record = param_str(params, "record_id");
    let inspection = param_str(params, "inspection_id");
    let kind = param_str(params, "kind");
    match event_name {
        "SecurityRecordRegistered" => {
            let lot = param_str(params, "lot_id");
            let protection = param_str(params, "protection");
            let action = match (&record, &protection, &lot) {
                (Some(r), Some(p), Some(l)) => {
                    format!("Security record #{r} registered — {p}, lot #{l}")
                }
                _ => "Security record registered".to_owned(),
            };
            (action, pass(params, &["record_id", "lot_id", "protection"]))
        }

        "SecurityRecordPerfected" => {
            let action = match &record {
                Some(r) => format!("Security record #{r} perfected"),
                None => "Security record perfected".to_owned(),
            };
            (action, pass(params, &["record_id", "evidence_hash"]))
        }

        "SecurityRecordHandedOver" => {
            let from = param_str(params, "from_record_id");
            let to = param_str(params, "to_record_id");
            let action = match (&from, &to) {
                (Some(f), Some(t)) => format!("Security handed over — record #{f} → #{t}"),
                _ => "Security handed over".to_owned(),
            };
            (
                action,
                pass(params, &["from_record_id", "to_record_id", "evidence_hash"]),
            )
        }

        "SecurityRecordAttested" => {
            let action = match &record {
                Some(r) => format!("Security record #{r} attested"),
                None => "Security record attested".to_owned(),
            };
            (action, pass(params, &["record_id", "attested_by"]))
        }

        "SecurityDocAdded" => {
            let action = match (&kind, &record) {
                (Some(k), Some(r)) => format!("Security document added — {k}, record #{r}"),
                _ => "Security document added".to_owned(),
            };
            (action, pass(params, &["record_id", "kind", "sha256"]))
        }

        "SecurityRecordReleased" => {
            let by_consent = param_value(params, "by_consent").and_then(Value::as_bool);
            let action = match (&record, by_consent) {
                (Some(r), Some(true)) => {
                    format!("Security record #{r} released with Risk Council consent")
                }
                (Some(r), _) => format!("Security record #{r} released"),
                (None, _) => "Security record released".to_owned(),
            };
            let mut details = pass(params, &["record_id", "reason_hash"]);
            details["by_consent"] = json!(by_consent);
            (action, details)
        }

        "SecurityMandateBreach" => (
            "Mandate breach reported".to_owned(),
            pass(params, &["evidence_hash"]),
        ),

        "SecurityEnforcementStarted" => {
            let action = match &record {
                Some(r) => format!("Enforcement started — security record #{r}"),
                None => "Enforcement started".to_owned(),
            };
            (action, pass(params, &["record_id"]))
        }

        "SecurityRecordEnforced" => render_enforced(params, chain_kind, link),

        "SecurityTermsSet" => {
            let advance = bps_pct(params, "advance_ratio_bps");
            let margin = bps_pct(params, "margin_call_ratio_bps");
            let cure = duration_param(params, "cure_period");
            let action = match (&advance, &margin, &cure) {
                (Some(a), Some(m), Some(c)) => format!(
                    "Security terms set — advance ratio {a}%, margin call ratio {m}%, cure period {c}"
                ),
                _ => "Security terms set".to_owned(),
            };
            let mut details = pass(
                params,
                &[
                    "cure_period",
                    "price_stale_after",
                    "payment_term",
                    "grace_period",
                    "attestation_interval",
                    "inspection_interval",
                ],
            );
            details["advance_ratio_pct"] = json!(advance);
            details["margin_call_ratio_pct"] = json!(margin);
            details["default_rate_pct"] = json!(default_rate_pct(params));
            details["tolerance_pct"] = json!(bps_pct(params, "tolerance_bps"));
            details["grade_tolerance_pct"] = json!(bps_pct(params, "grade_tolerance_bps"));
            (action, details)
        }

        "SecurityRevalued" => {
            let value = param_amount(params, "value_per_unit", chain_kind);
            let benchmark = param_str(params, "benchmark");
            let action = match (&record, &value, &benchmark) {
                (Some(r), Some(v), Some(b)) => {
                    format!("Security record #{r} revalued — {}/unit ({b})", dollars(v))
                }
                (Some(r), Some(v), None) => {
                    format!("Security record #{r} revalued — {}/unit", dollars(v))
                }
                _ => "Security record revalued".to_owned(),
            };
            let mut details = pass(params, &["record_id", "benchmark", "report_hash"]);
            details["value_per_unit"] = json!(value);
            (action, details)
        }

        "SecurityMarginCall" => {
            let ratio = bps_pct(params, "margin_call_ratio_bps");
            let cure_raw = param_str(params, "cure_by");
            let clause = match (&cure_raw, iso_param(params, "cure_by")) {
                (Some(_), Some(c)) => Some(format!(", cure by {c}")),
                (Some(_), None) => Some(String::new()),
                (None, _) => None,
            };
            let action = match (ltv_label(params), &ratio, clause) {
                (Some(l), Some(m), Some(c)) => {
                    format!("Margin call — LTV {l}, margin call ratio {m}%{c}")
                }
                _ => "Margin call".to_owned(),
            };
            let mut details = pass(params, &["cure_by"]);
            details["ltv_pct"] = json!(ltv_pct(params));
            details["margin_call_ratio_pct"] = json!(ratio);
            (action, details)
        }

        "SecurityPriceStale" => {
            let ratio = bps_pct(params, "margin_call_ratio_bps");
            let action = match (ltv_label(params), &ratio) {
                (Some(l), Some(m)) => format!(
                    "Price stale — LTV {l} above {m}% margin call ratio, no margin call until revalued"
                ),
                _ => "Price stale".to_owned(),
            };
            (
                action,
                json!({ "ltv_pct": ltv_pct(params), "margin_call_ratio_pct": ratio }),
            )
        }

        "SecurityMarginCallCured" => {
            let action = match ltv_label(params) {
                Some(l) => format!("Margin call cured — LTV {l}"),
                None => "Margin call cured".to_owned(),
            };
            (action, json!({ "ltv_pct": ltv_pct(params) }))
        }

        "SecurityInspectionRecorded" => {
            let action = match (&inspection, &kind, &record) {
                (Some(i), Some(k), Some(r)) => {
                    format!("Inspection #{i} recorded — {k}, security record #{r}")
                }
                _ => "Inspection recorded".to_owned(),
            };
            (
                action,
                pass(
                    params,
                    &["inspection_id", "record_id", "lot_id", "kind", "inspector"],
                ),
            )
        }

        "SecurityInspectionApproved" => {
            let flagged = param_value(params, "flagged").and_then(Value::as_bool);
            let action = match (
                &inspection,
                signed_bps_pct(params, "variance_reference_bps"),
                signed_bps_pct(params, "variance_previous_bps"),
                signed_bps_pct(params, "variance_grade_bps"),
            ) {
                (Some(i), Some(r), Some(p), Some(g)) => format!(
                    "Inspection #{i} approved — variance vs reference {r}%, vs previous {p}%, grade {g}%{}",
                    if flagged == Some(true) { ", flagged" } else { "" },
                ),
                _ => "Inspection approved".to_owned(),
            };
            let mut details = pass(params, &["inspection_id", "record_id", "approved_by"]);
            details["variance_reference_pct"] = json!(bps_pct(params, "variance_reference_bps"));
            details["variance_previous_pct"] = json!(bps_pct(params, "variance_previous_bps"));
            details["variance_grade_pct"] = json!(bps_pct(params, "variance_grade_bps"));
            details["flagged"] = json!(flagged);
            (action, details)
        }

        "SecurityFlagResolved" => {
            let outcome = param_str(params, "outcome");
            let action = match (&outcome, &record, &inspection) {
                (Some(o), Some(r), Some(i)) => {
                    format!(
                        "Inspection flag resolved — {o}, security record #{r} (inspection #{i})"
                    )
                }
                _ => "Inspection flag resolved".to_owned(),
            };
            (
                action,
                pass(
                    params,
                    &["record_id", "inspection_id", "outcome", "reason_hash"],
                ),
            )
        }

        "SecurityExtensionConsent" => {
            let action = match iso_param(params, "new_maturity") {
                Some(m) => format!("Buyer extension consent — new maturity {m}"),
                None => "Buyer extension consent".to_owned(),
            };
            (action, pass(params, &["new_maturity", "consent_hash"]))
        }

        "SecurityInspectorsSet" => {
            let inspectors = param_value(params, "inspectors")
                .filter(|v| v.is_array())
                .cloned();
            let action = match inspectors.as_ref().and_then(Value::as_array) {
                Some(list) if list.len() == 1 => "Inspector panel set — 1 inspector".to_owned(),
                Some(list) => format!("Inspector panel set — {} inspectors", list.len()),
                None => "Inspector panel set".to_owned(),
            };
            (action, json!({ "inspectors": inspectors }))
        }

        "SecurityRegistryPaused" => ("SecurityRegistry paused".to_owned(), json!({})),

        "SecurityRegistryUnpaused" => ("SecurityRegistry unpaused".to_owned(), json!({})),

        other => (other.to_owned(), json!({})),
    }
}

/// `$12.34`, or `-$12.34` for a negative decimal string.
fn dollars(amount: &str) -> String {
    match amount.strip_prefix('-') {
        Some(abs) => format!("-${abs}"),
        None => format!("${amount}"),
    }
}

/// `{key: string}` for each of `keys` (numbers stringified), `null` when absent.
fn pass(params: &Value, keys: &[&str]) -> Value {
    let mut details = serde_json::Map::new();
    for key in keys {
        details.insert((*key).to_owned(), json!(param_str(params, key)));
    }
    Value::Object(details)
}

/// `"<label> — $<amount>"` (just `<label>` when the amount is missing) plus details with
/// the normalised `amount_key` and the pass-through `extra` keys.
fn with_amount(
    label: &str,
    params: &Value,
    chain_kind: ChainKind,
    amount_key: &str,
    extra: &[&str],
) -> (String, Value) {
    let amount = param_amount(params, amount_key, chain_kind);
    let action = match &amount {
        Some(a) => format!("{label} — {}", dollars(a)),
        None => label.to_owned(),
    };
    let mut details = pass(params, extra);
    details[amount_key] = json!(amount);
    (action, details)
}

/// Rollover / amendment details: `new_rate_bps` (the event's 1e6-scaled rate converted to
/// bps) and `new_maturity_timestamp`, read from the top level or the nested `event`.
fn economics_details(params: &Value) -> Value {
    json!({
        "new_rate_bps": param_i64(params, "new_rate").map(economics_rate_to_bps),
        "new_maturity_timestamp": param_i64(params, "new_maturity_timestamp"),
    })
}
