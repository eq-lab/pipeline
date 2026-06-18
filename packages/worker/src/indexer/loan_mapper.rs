use std::marker::PhantomData;
use std::str::FromStr;
use std::sync::Arc;

use anyhow::Context;
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use sqlx::PgConnection;

use shared::{
    contract_logs_repo::ContractLogsRepo,
    db::EventRepo,
    events::EventRow,
    json_numeric::u256_to_bigdecimal,
    loan_snapshot::{LoanSnapshot, LocationUpdateSnapshot, RepaymentSnapshot},
    log_mapper::LogMapper,
};

use super::loan_metadata::{
    BlockHint, ImmutableDataResolver, ImmutableLoanDataView, LoanAddress, LoanId,
    LoanMetadataFetcher, LoanMetadataJson, MutableDataResolver, MutableLoanDataView,
    RepaymentDataView,
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

pub fn loan_status_name(ordinal: u8) -> &'static str {
    match ordinal {
        0 => "Performing",
        1 => "WatchList",
        2 => "Default",
        3 => "Closed",
        _ => "Unknown",
    }
}

pub fn closure_reason_name(ordinal: u8) -> &'static str {
    match ordinal {
        0 => "None",
        1 => "ScheduledMaturity",
        2 => "EarlyRepayment",
        3 => "Default",
        4 => "OtherWriteDown",
        _ => "Unknown",
    }
}

fn extract_loan_id<A: LoanAddress>(event: &LoanEvent<A>) -> anyhow::Result<BigDecimal> {
    event
        .params
        .get("loan_id")
        .and_then(|v| v.as_str())
        .and_then(|s| BigDecimal::from_str(s).ok())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "{}: missing or unparseable loan_id in params",
                event.event_name
            )
        })
}

// ---------------------------------------------------------------------------
// Worker-local alloy-free event type
// ---------------------------------------------------------------------------

/// A worker-local alloy-free version of `ContractLog` that is generic over the
/// contract address type.
///
/// EVM parsers convert `ContractLog → LoanEvent<Address>` at the `evm_parsers.rs`
/// boundary; Stellar parsers build `LoanEvent<StellarAddress>` directly from
/// `StellarLog`. This avoids genericising the shared `ContractLog` struct (which
/// would ripple across every parser + mapper in the workspace).
pub struct LoanEvent<A: LoanAddress> {
    pub contract_address: A,
    pub event_name: String,
    pub block_number: u64,
    /// Hex with `0x` prefix for EVM; transaction hash string for Stellar.
    pub tx_hash: String,
    pub log_index: u64,
    pub block_timestamp: u64,
    pub params: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Pure composer functions — zero I/O, synchronous, fully unit-testable
// ---------------------------------------------------------------------------

/// Build a `LoanSnapshot` from all four data sources at `LoanDrawn` time.
/// All I/O (eth_calls + IPFS fetch) has already completed; this function
/// only assembles the resulting struct.
pub fn compose_drawn_snapshot(
    json: LoanMetadataJson,
    immutable: &ImmutableLoanDataView,
    mutable: MutableLoanDataView,
    cumulative: &RepaymentDataView,
    metadata_uri_onchain: String,
) -> LoanSnapshot {
    LoanSnapshot {
        // IPFS fields
        originator: json.originator,
        borrower_id: json.borrower_id,
        commodity: json.commodity,
        corridor: json.corridor,
        governing_law: json.governing_law,
        metadata_uri: json.metadata_uri,
        // immutableLoanData
        original_facility_size: u256_to_bigdecimal(immutable.original_facility_size),
        original_senior_tranche: u256_to_bigdecimal(immutable.original_senior_tranche),
        original_equity_tranche: u256_to_bigdecimal(immutable.original_equity_tranche),
        original_offtaker_price: u256_to_bigdecimal(immutable.original_offtaker_price),
        senior_interest_rate_bps: immutable.senior_interest_rate_bps,
        origination_date: immutable.origination_date as i64,
        original_maturity_date: immutable.original_maturity_date as i64,
        // mutableLoanData
        next_economics_epochs_id: u256_to_bigdecimal(mutable.next_economics_epochs_id),
        next_repayment_id: u256_to_bigdecimal(mutable.next_repayment_id),
        status: loan_status_name(mutable.status).to_owned(),
        ccr_bps: mutable.ccr_bps,
        last_reported_ccr_timestamp: mutable.last_reported_ccr_timestamp as i64,
        current_maturity_timestamp: mutable.current_maturity_timestamp as i64,
        closure_reason: closure_reason_name(mutable.closure_reason).to_owned(),
        current_location: LocationUpdateSnapshot {
            location_type: mutable.current_location.location_type.as_str().to_owned(),
            location_identifier: mutable.current_location.location_identifier,
            tracking_url: mutable.current_location.tracking_url,
            updated_at: mutable.current_location.updated_at as i64,
        },
        metadata_uri_onchain,
        // cumulativeRepaymentData
        repayment: RepaymentSnapshot {
            offtaker_received: u256_to_bigdecimal(cumulative.offtaker_received),
            senior_principal_repaid: u256_to_bigdecimal(cumulative.senior_principal_repaid),
            senior_interest: u256_to_bigdecimal(cumulative.senior_interest),
            equity_distributed: u256_to_bigdecimal(cumulative.equity_distributed),
            mgmt_fee: u256_to_bigdecimal(cumulative.mgmt_fee),
            perf_fee: u256_to_bigdecimal(cumulative.perf_fee),
            oet_alloc: u256_to_bigdecimal(cumulative.oet_alloc),
        },
    }
}

/// Build a `LoanSnapshot` for a lifecycle event by carrying forward IPFS +
/// immutable fields from `prior` and applying fresh mutable/cumulative data.
///
/// - When `refreshed_json` is `Some(json)` (on-chain `metadataURI` changed since
///   the last event), IPFS fields come from `json`.
/// - When `refreshed_json` is `None` (URI unchanged), IPFS fields carry forward
///   from `prior`.
/// - Immutable on-chain fields always carry forward from `prior`.
/// - Mutable fields come from `mutable` and `cumulative`.
/// - `metadata_uri_onchain` is always `mutable.metadata_uri` (the current on-chain value).
pub fn compose_lifecycle_snapshot(
    prior: LoanSnapshot,
    mutable: MutableLoanDataView,
    cumulative: &RepaymentDataView,
    refreshed_json: Option<LoanMetadataJson>,
) -> LoanSnapshot {
    let (originator, borrower_id, commodity, corridor, governing_law, metadata_uri) =
        match refreshed_json {
            Some(json) => (
                json.originator,
                json.borrower_id,
                json.commodity,
                json.corridor,
                json.governing_law,
                json.metadata_uri,
            ),
            None => (
                prior.originator,
                prior.borrower_id,
                prior.commodity,
                prior.corridor,
                prior.governing_law,
                prior.metadata_uri,
            ),
        };

    LoanSnapshot {
        // IPFS fields (carry-forward or re-fetched)
        originator,
        borrower_id,
        commodity,
        corridor,
        governing_law,
        metadata_uri,
        // immutable fields — always carry-forward (immutable by construction)
        original_facility_size: prior.original_facility_size,
        original_senior_tranche: prior.original_senior_tranche,
        original_equity_tranche: prior.original_equity_tranche,
        original_offtaker_price: prior.original_offtaker_price,
        senior_interest_rate_bps: prior.senior_interest_rate_bps,
        origination_date: prior.origination_date,
        original_maturity_date: prior.original_maturity_date,
        // fresh mutable fields
        next_economics_epochs_id: u256_to_bigdecimal(mutable.next_economics_epochs_id),
        next_repayment_id: u256_to_bigdecimal(mutable.next_repayment_id),
        status: loan_status_name(mutable.status).to_owned(),
        ccr_bps: mutable.ccr_bps,
        last_reported_ccr_timestamp: mutable.last_reported_ccr_timestamp as i64,
        current_maturity_timestamp: mutable.current_maturity_timestamp as i64,
        closure_reason: closure_reason_name(mutable.closure_reason).to_owned(),
        current_location: LocationUpdateSnapshot {
            location_type: mutable.current_location.location_type.as_str().to_owned(),
            location_identifier: mutable.current_location.location_identifier,
            tracking_url: mutable.current_location.tracking_url,
            updated_at: mutable.current_location.updated_at as i64,
        },
        metadata_uri_onchain: mutable.metadata_uri,
        repayment: RepaymentSnapshot {
            offtaker_received: u256_to_bigdecimal(cumulative.offtaker_received),
            senior_principal_repaid: u256_to_bigdecimal(cumulative.senior_principal_repaid),
            senior_interest: u256_to_bigdecimal(cumulative.senior_interest),
            equity_distributed: u256_to_bigdecimal(cumulative.equity_distributed),
            mgmt_fee: u256_to_bigdecimal(cumulative.mgmt_fee),
            perf_fee: u256_to_bigdecimal(cumulative.perf_fee),
            oet_alloc: u256_to_bigdecimal(cumulative.oet_alloc),
        },
    }
}

// ---------------------------------------------------------------------------
// URI-refetch dispatch helper
// ---------------------------------------------------------------------------

/// Compare the prior and current on-chain metadata URIs. If they differ, fetch
/// the IPFS document at `current_onchain_uri` and return `Some(json)`. If the
/// URIs are equal, return `None` (no re-fetch needed).
///
/// Extracted as a free function so it can be unit-tested without a database or
/// live RPC connection.
pub async fn maybe_fetch_refreshed_json(
    fetcher: &dyn LoanMetadataFetcher,
    prior_onchain_uri: &str,
    current_onchain_uri: &str,
) -> anyhow::Result<Option<LoanMetadataJson>> {
    if prior_onchain_uri == current_onchain_uri {
        Ok(None)
    } else {
        let json = fetcher
            .fetch_metadata(current_onchain_uri)
            .await
            .with_context(|| {
                format!("IPFS re-fetch failed after URI change (uri={current_onchain_uri})")
            })?;
        Ok(Some(json))
    }
}

// ---------------------------------------------------------------------------
// LoanEventMapper — single mapper for all 9 emitted loan event types
// Generic over <A: LoanAddress, Id: LoanId> so the same struct handles both
// EVM (Address, U256) and Stellar (StellarAddress, u32).
// ---------------------------------------------------------------------------

/// Unified mapper for all loan-registry events:
/// - `LoanDrawn`: three reads (immutableLoanData + mutableLoanData@block +
///   cumulativeRepaymentData@block) + IPFS fetch, then one `contract_logs` insert with
///   a fully populated `{loan_id, event, snapshot}` params JSONB.
/// - Lifecycle events (`PaymentRecorded`, `LoanDefaulted`, `LoanClosed`,
///   `LoanStatusUpdated`, `LoanCCRUpdated`, `LoanLocationUpdated`,
///   `LoanRolledOver`, `EconomicsAmended`): fetch the most recent prior snapshot from
///   `contract_logs`, carry forward IPFS + immutable fields, overwrite mutable fields
///   from block-pinned calls, then insert.
///
/// All reads/writes occur inside the indexer's outer transaction.
///
/// Soroban note: `simulateTransaction` is current-ledger-only — `BlockHint` is accepted
/// but ignored on the Stellar path. See TD-19 for the ledger-pinned follow-up.
pub struct LoanEventMapper<A: LoanAddress, Id: LoanId> {
    pub event: LoanEvent<A>,
    chain_id: i64,
    event_repo: Arc<EventRepo>,
    contract_logs_repo: Arc<ContractLogsRepo>,
    fetcher: Arc<dyn LoanMetadataFetcher>,
    immutable_resolver: Arc<dyn ImmutableDataResolver<A, Id>>,
    mutable_resolver: Arc<dyn MutableDataResolver<A, Id>>,
    _id: PhantomData<Id>,
}

impl<A: LoanAddress, Id: LoanId> LoanEventMapper<A, Id> {
    pub fn new(
        event: LoanEvent<A>,
        chain_id: i64,
        event_repo: Arc<EventRepo>,
        contract_logs_repo: Arc<ContractLogsRepo>,
        fetcher: Arc<dyn LoanMetadataFetcher>,
        immutable_resolver: Arc<dyn ImmutableDataResolver<A, Id>>,
        mutable_resolver: Arc<dyn MutableDataResolver<A, Id>>,
    ) -> Self {
        Self {
            event,
            chain_id,
            event_repo,
            contract_logs_repo,
            fetcher,
            immutable_resolver,
            mutable_resolver,
            _id: PhantomData,
        }
    }

    /// Resolve the full `LoanSnapshot` for a `LoanDrawn` event.
    async fn snapshot_for_drawn(&self, loan_id: &BigDecimal) -> anyhow::Result<LoanSnapshot> {
        let loan_id_native = Id::from_bigdecimal(loan_id)?;
        let addr = &self.event.contract_address;
        let block = BlockHint::from_event(self.event.block_number);

        // 1. Read on-chain immutable struct (block: latest; immutable by construction)
        let immutable = self
            .immutable_resolver
            .immutable_loan_data(addr, loan_id_native.clone())
            .await
            .with_context(|| format!("LoanDrawn: immutableLoanData(loan_id={loan_id}) failed"))?;

        // 2. Read on-chain mutable struct pinned to event block
        let mutable = self
            .mutable_resolver
            .mutable_loan_data(addr, loan_id_native.clone(), block)
            .await
            .with_context(|| {
                format!("LoanDrawn: mutableLoanData(loan_id={loan_id}) at block {block:?} failed")
            })?;

        // 3. Read cumulative repayment data (authoritative source for repayment fields)
        let cumulative = self
            .mutable_resolver
            .cumulative_repayment_data(addr, loan_id_native, block)
            .await
            .with_context(|| {
                format!(
                    "LoanDrawn: cumulativeRepaymentData(loan_id={loan_id}) at block {block:?} failed"
                )
            })?;

        // URI is from the mutable read (metadataURI lives in MutableLoanData)
        let uri = mutable.metadata_uri.clone();

        // 4. Fetch off-chain IPFS JSON
        let json = self
            .fetcher
            .fetch_metadata(&uri)
            .await
            .with_context(|| format!("LoanDrawn: metadata fetch failed (uri={uri})"))?;

        Ok(compose_drawn_snapshot(
            json,
            &immutable,
            mutable,
            &cumulative,
            uri,
        ))
    }

    /// Resolve the `LoanSnapshot` for a lifecycle event by carrying forward IPFS +
    /// immutable fields from the most recent prior snapshot and reading fresh mutable
    /// fields via block-pinned calls.
    ///
    /// IPFS re-fetch semantics: on each lifecycle event we compare
    /// `mutable.metadata_uri` against `prior.metadata_uri_onchain`. If they differ,
    /// re-fetch IPFS and update the IPFS-sourced fields. If the same, carry forward.
    async fn snapshot_for_lifecycle(
        &self,
        conn: &mut PgConnection,
        loan_id: &BigDecimal,
    ) -> anyhow::Result<LoanSnapshot> {
        let contract_address = self.event.contract_address.as_db_string();

        // Fetch the most recent prior snapshot — must exist (LoanDrawn must precede
        // any lifecycle event). Missing snapshot is an indexer bug.
        let prior = self
            .contract_logs_repo
            .get_latest_loan_snapshot(conn, self.chain_id, &contract_address, loan_id)
            .await?
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "{}: no prior snapshot for loan_id={loan_id} on chain {}; \
                     LoanDrawn event was not indexed (indexer bug)",
                    self.event.event_name,
                    self.chain_id
                )
            })?;

        let loan_id_native = Id::from_bigdecimal(loan_id)?;
        let addr = &self.event.contract_address;
        let block = BlockHint::from_event(self.event.block_number);

        // Read fresh mutable state pinned to event block
        let mutable = self
            .mutable_resolver
            .mutable_loan_data(addr, loan_id_native.clone(), block)
            .await
            .with_context(|| {
                format!(
                    "{}: mutableLoanData(loan_id={loan_id}) at block {block:?} failed",
                    self.event.event_name
                )
            })?;

        // Read cumulative repayment data pinned to event block
        let cumulative = self
            .mutable_resolver
            .cumulative_repayment_data(addr, loan_id_native, block)
            .await
            .with_context(|| {
                format!(
                    "{}: cumulativeRepaymentData(loan_id={loan_id}) at block {block:?} failed",
                    self.event.event_name
                )
            })?;

        // IPFS re-fetch: if metadataURI changed on-chain, re-fetch and update IPFS fields.
        let refreshed_json = maybe_fetch_refreshed_json(
            &*self.fetcher,
            &prior.metadata_uri_onchain,
            &mutable.metadata_uri,
        )
        .await
        .with_context(|| {
            format!(
                "{}: IPFS re-fetch failed after URI change (loan_id={loan_id})",
                self.event.event_name
            )
        })?;

        Ok(compose_lifecycle_snapshot(
            prior,
            mutable,
            &cumulative,
            refreshed_json,
        ))
    }

    /// Perform the actual insert: resolve the snapshot, restructure params JSONB
    /// into `{loan_id, event, snapshot}`, and write to `contract_logs`.
    async fn do_insert(&self, conn: &mut PgConnection) -> anyhow::Result<()> {
        let loan_id = extract_loan_id(&self.event)?;

        // Resolve snapshot based on event type
        let snapshot = if self.event.event_name == "LoanDrawn" {
            self.snapshot_for_drawn(&loan_id).await?
        } else {
            self.snapshot_for_lifecycle(conn, &loan_id).await?
        };

        // Collect the parser-emitted event-specific fields (everything except loan_id)
        // and move them under the "event" key.
        let event_fields: serde_json::Map<String, serde_json::Value> = self
            .event
            .params
            .as_object()
            .map(|m| {
                m.iter()
                    .filter(|(k, _)| k.as_str() != "loan_id")
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            })
            .unwrap_or_default();

        // Build the enriched params: {loan_id, event: {...}, snapshot: {...}}
        let enriched_params = serde_json::json!({
            "loan_id": loan_id.to_string(),
            "event": event_fields,
            "snapshot": snapshot,
        });

        // Write to contract_logs via the alloy-free EventRow path.
        let row = EventRow {
            contract_address: self.event.contract_address.as_db_string(),
            event_name: self.event.event_name.clone(),
            block_number: self.event.block_number,
            tx_hash: self.event.tx_hash.clone(),
            log_index: self.event.log_index,
            block_timestamp: self.event.block_timestamp,
            params: enriched_params,
        };

        self.event_repo.insert_row(conn, &row, self.chain_id).await
    }
}

#[async_trait]
impl<A: LoanAddress, Id: LoanId> LogMapper for LoanEventMapper<A, Id> {
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool> {
        self.event_repo
            .is_duplicate(
                conn,
                self.chain_id,
                &self.event.contract_address.as_db_string(),
                self.event.block_number,
                self.event.log_index,
            )
            .await
    }

    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()> {
        self.do_insert(conn).await
    }

    fn block_number(&self) -> u64 {
        self.event.block_number
    }

    fn set_block_timestamp(&mut self, ts: u64) {
        self.event.block_timestamp = ts;
    }
}
