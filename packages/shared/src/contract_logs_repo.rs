use bigdecimal::BigDecimal;
use sqlx::PgPool;

use crate::loan_snapshot::LoanSnapshot;

/// A loan-end event row fetched from `contract_logs`.
///
/// Used by the portfolio yield endpoint to determine each loan's `effective_end`:
/// `min(scheduled_maturity, earliest LoanClosed / LoanDefaulted block_timestamp)`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LifecycleRow {
    pub event_name: String,
    pub block_timestamp: i64,
    pub loan_id: BigDecimal,
}

/// One `WithdrawalRequested` event joined to its latest `RequestClaimed` (if any),
/// used by the protocol Withdrawal Queue endpoint (`GET /v1/withdrawal-queue`).
///
/// `amount` is this request's withdrawal amount — the value owed to the withdrawer and
/// the per-request queue contribution. (The event's `queued` field is a global,
/// monotonically-increasing all-time cumulative counter — `queued(n) = queued(n-1) +
/// amount(n)`, matching on-chain `queueMetadata().queued` — so it is **not** a
/// per-request magnitude and is deliberately not selected here.) `claimed_at` is `None`
/// while the request is still outstanding. The claim match is **contract-scoped**:
/// `RequestClaimed` is emitted by both the DepositManager and the WithdrawalQueue and
/// `request_id` is not unique across them, so the join is keyed on
/// `(request_id, contract_address)`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WithdrawalQueueRow {
    pub request_id: String,
    /// The withdrawing account (`params->>'withdrawer'`).
    pub withdrawer: String,
    /// This request's withdrawal amount (`params->>'amount'`).
    pub amount: BigDecimal,
    /// `WithdrawalRequested` block timestamp (unix seconds) — enqueue time.
    pub requested_at: i64,
    /// Latest matching `RequestClaimed` block timestamp (unix seconds); `None` while
    /// the request is still outstanding (queued).
    pub claimed_at: Option<i64>,
}

/// The most recent loan-event snapshot per `(chain_id, loan_id)`.
/// Used by the Portfolio API to assemble the active-loan set for yield computation.
#[derive(Debug, Clone)]
pub struct LoanSnapshotRow {
    pub chain_id: i64,
    pub loan_id: BigDecimal,
    pub block_number: i64,
    pub log_index: i64,
    pub event_name: String,
    pub block_timestamp: i64,
    pub snapshot: LoanSnapshot,
}

/// One `DepositRequested` or `WithdrawalRequested` event row.
///
/// Used by the Dashboard API to compute TVL (running net flow) as a pure function.
/// `kind` is `"deposit"` (add) or `"withdrawal"` (subtract); callers apply the sign
/// themselves when aggregating.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FlowEventRow {
    /// Block timestamp in Unix seconds.
    pub block_timestamp: i64,
    /// `"deposit"` or `"withdrawal"`.
    pub kind: String,
    /// Amount in USDC base units (6-decimal).
    pub amount: BigDecimal,
}

/// One `YieldMinted` event row.
///
/// Used by the Dashboard API to compute cumulative yield minted to sPLUSD as a
/// pure function. `s_plusd_amount` is the net PLUSD minted per event.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct YieldMintRow {
    /// Block timestamp in Unix seconds.
    pub block_timestamp: i64,
    /// PLUSD minted to the sPLUSD vault in this event (6-decimal base units).
    pub s_plusd_amount: BigDecimal,
}

/// One indexed Stellar `AssetTransfer` event row.
///
/// Emitted by the worker's Stellar indexer for transfers of the tracked asset
/// where **both** endpoints are custody/ramp addresses (see the worker's
/// `transfer_between_tracked`). Used by the Capital Allocation API to compute the
/// `in_transit` bucket as net custody→ramp flow. `amount` is in USDC base units
/// (6-decimal), matching the other `contract_logs` amounts.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AssetTransferRow {
    /// Sender Strkey (`params->>'from'`).
    pub from_addr: String,
    /// Recipient Strkey (`params->>'to'`).
    pub to_addr: String,
    /// Transfer amount in base units (`params->>'amount'`).
    pub amount: BigDecimal,
}

pub struct ContractLogsRepo {
    pub pool: PgPool,
}

impl ContractLogsRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Return all `LoanClosed` and `LoanDefaulted` events for a given `chain_id` with
    /// `block_timestamp <= to_unix`, ordered by `(block_timestamp, log_index)`.
    ///
    /// Generic over `Executor` so callers can run this inside a transaction alongside
    /// other reads for a consistent snapshot.
    pub async fn list_loan_lifecycle_events<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        to_unix: i64,
    ) -> anyhow::Result<Vec<LifecycleRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let event_names = vec!["LoanClosed", "LoanDefaulted"];
        let rows = sqlx::query_as::<_, LifecycleRow>(
            "SELECT
                 event_name,
                 block_timestamp,
                 (params->>'loan_id')::numeric AS loan_id
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name = ANY($2)
               AND block_timestamp <= $3
             ORDER BY block_timestamp, log_index",
        )
        .bind(chain_id)
        .bind(&event_names)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;
        Ok(rows)
    }

    /// The most recent loan-event snapshot per `(chain_id, loan_id)` whose
    /// `block_timestamp <= to_unix`. Used by Portfolio to assemble the active-loan set
    /// for a given sample point in the yield time series.
    ///
    /// Uses `DISTINCT ON` with `(params->>'loan_id')::numeric` ordering to pick the
    /// latest row per loan. Generic over `Executor` so callers can run inside a
    /// transaction for a consistent snapshot.
    pub async fn list_latest_loan_snapshots<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        contract_address: &str,
        to_unix: i64,
    ) -> anyhow::Result<Vec<LoanSnapshotRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        // Fetch as raw rows so we can decode the JSONB snapshot manually.
        let rows = sqlx::query(
            "SELECT DISTINCT ON ((params->>'loan_id')::numeric)
                 chain_id,
                 (params->>'loan_id')::numeric AS loan_id,
                 block_number,
                 log_index::bigint AS log_index,
                 event_name,
                 block_timestamp,
                 params->'snapshot' AS snapshot
             FROM contract_logs
             WHERE chain_id = $1
               AND contract_address = $2
               AND event_name IN (
                   'LoanDrawn',
                   'LoanStatusUpdated',
                   'LoanCCRUpdated',
                   'LoanLocationUpdated',
                   'LoanDefaulted',
                   'LoanClosed',
                   'PaymentRecorded',
                   'LoanRolledOver',
                   'EconomicsAmended'
               )
               AND block_timestamp <= $3
             ORDER BY (params->>'loan_id')::numeric, block_number DESC, log_index DESC",
        )
        .bind(chain_id)
        .bind(contract_address)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;

        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            use sqlx::Row;
            let snapshot_json: serde_json::Value = row.try_get("snapshot")?;
            let snapshot: LoanSnapshot = serde_json::from_value(snapshot_json)
                .map_err(|e| anyhow::anyhow!("failed to deserialize LoanSnapshot: {e}"))?;
            let loan_id_decimal: bigdecimal::BigDecimal = row.try_get("loan_id")?;
            result.push(LoanSnapshotRow {
                chain_id: row.try_get("chain_id")?,
                loan_id: loan_id_decimal,
                block_number: row.try_get("block_number")?,
                log_index: row.try_get("log_index")?,
                event_name: row.try_get("event_name")?,
                block_timestamp: row.try_get("block_timestamp")?,
                snapshot,
            });
        }
        Ok(result)
    }

    /// Like `list_latest_loan_snapshots` but filters only by `chain_id` (no
    /// contract_address). Used by the Portfolio API which is chain-scoped.
    ///
    /// Replaces the old `LoanHistoryRepo::list_loans_for_window`.
    pub async fn list_latest_loan_snapshots_for_chain<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        to_unix: i64,
    ) -> anyhow::Result<Vec<LoanSnapshotRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows = sqlx::query(
            "SELECT DISTINCT ON ((params->>'loan_id')::numeric)
                 chain_id,
                 (params->>'loan_id')::numeric AS loan_id,
                 block_number,
                 log_index::bigint AS log_index,
                 event_name,
                 block_timestamp,
                 params->'snapshot' AS snapshot
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name IN (
                   'LoanDrawn',
                   'LoanStatusUpdated',
                   'LoanCCRUpdated',
                   'LoanLocationUpdated',
                   'LoanDefaulted',
                   'LoanClosed',
                   'PaymentRecorded',
                   'LoanRolledOver',
                   'EconomicsAmended'
               )
               AND block_timestamp <= $2
             ORDER BY (params->>'loan_id')::numeric, block_number DESC, log_index DESC",
        )
        .bind(chain_id)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;

        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            use sqlx::Row;
            let snapshot_json: serde_json::Value = row.try_get("snapshot")?;
            let snapshot: LoanSnapshot = serde_json::from_value(snapshot_json)
                .map_err(|e| anyhow::anyhow!("failed to deserialize LoanSnapshot: {e}"))?;
            let loan_id_decimal: bigdecimal::BigDecimal = row.try_get("loan_id")?;
            result.push(LoanSnapshotRow {
                chain_id: row.try_get("chain_id")?,
                loan_id: loan_id_decimal,
                block_number: row.try_get("block_number")?,
                log_index: row.try_get("log_index")?,
                event_name: row.try_get("event_name")?,
                block_timestamp: row.try_get("block_timestamp")?,
                snapshot,
            });
        }
        Ok(result)
    }

    /// Latest on-chain `status` for each of `loan_ids` on `chain_id`, as
    /// `(loan_id, status)` pairs. The "latest" snapshot per loan wins (same ordering as
    /// `list_latest_loan_snapshots_for_chain`). Loans with no indexed events are simply
    /// absent from the result. Used to derive a linked submission's live status at read
    /// time (the weak-bridge model keeps on-chain state in `contract_logs`, not on the
    /// submission row).
    pub async fn latest_status_by_loans<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        loan_ids: &[bigdecimal::BigDecimal],
    ) -> anyhow::Result<Vec<(bigdecimal::BigDecimal, String)>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        if loan_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as::<_, (bigdecimal::BigDecimal, String)>(
            "SELECT DISTINCT ON ((params->>'loan_id')::numeric)
                 (params->>'loan_id')::numeric        AS loan_id,
                 params->'snapshot'->>'status'        AS status
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name IN (
                   'LoanDrawn',
                   'LoanStatusUpdated',
                   'LoanCCRUpdated',
                   'LoanLocationUpdated',
                   'LoanDefaulted',
                   'LoanClosed',
                   'PaymentRecorded',
                   'LoanRolledOver',
                   'EconomicsAmended'
               )
               AND (params->>'loan_id')::numeric = ANY($2)
             ORDER BY (params->>'loan_id')::numeric, block_number DESC, log_index DESC",
        )
        .bind(chain_id)
        .bind(loan_ids)
        .fetch_all(executor)
        .await?;
        Ok(rows)
    }

    /// Earliest `origination_date` (from `params->'snapshot'->>'origination_date'`)
    /// across all loans on a chain. Used by the API to default the "full history"
    /// lookback window. Returns `None` if no loan events have been indexed yet.
    pub async fn get_earliest_origination_date<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
    ) -> anyhow::Result<Option<i64>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let row: Option<(Option<i64>,)> = sqlx::query_as(
            "SELECT MIN((params->'snapshot'->>'origination_date')::bigint)
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name = 'LoanDrawn'",
        )
        .bind(chain_id)
        .fetch_optional(executor)
        .await?;
        Ok(row.and_then(|(v,)| v))
    }

    /// All `WithdrawalRequested` events for a chain with `block_timestamp <= to_unix`,
    /// each left-joined to its latest matching `RequestClaimed` (scoped to the same
    /// `contract_address`, since `request_id` is not unique across contracts).
    ///
    /// Returns raw rows; aggregation into queue depth / counts / item table is done by
    /// the pure `compute_withdrawal_queue` in the API layer. Generic over
    /// `Executor` so callers can run inside a transaction for a consistent snapshot.
    pub async fn list_withdrawal_queue_rows<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        to_unix: i64,
    ) -> anyhow::Result<Vec<WithdrawalQueueRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows = sqlx::query_as::<_, WithdrawalQueueRow>(
            "SELECT r.params->>'request_id'        AS request_id,
                    r.params->>'withdrawer'        AS withdrawer,
                    (r.params->>'amount')::numeric AS amount,
                    r.block_timestamp              AS requested_at,
                    claim.claimed_at
             FROM contract_logs r
             LEFT JOIN LATERAL (
                 SELECT c.block_timestamp AS claimed_at
                 FROM contract_logs c
                 WHERE c.event_name = 'RequestClaimed'
                   AND c.params->>'request_id' = r.params->>'request_id'
                   AND c.contract_address = r.contract_address
                 ORDER BY c.block_timestamp DESC, c.log_index DESC
                 LIMIT 1
             ) claim ON TRUE
             WHERE r.chain_id = $1
               AND r.event_name = 'WithdrawalRequested'
               AND r.block_timestamp <= $2",
        )
        .bind(chain_id)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;
        Ok(rows)
    }

    /// All `DepositRequested` and `WithdrawalRequested` events for a chain with
    /// `block_timestamp <= to_unix`, ordered by `block_timestamp`.
    ///
    /// Used by the Dashboard TVL endpoint to reconstruct the running net flow:
    /// TVL(t) = Σ DepositRequested.amount − Σ WithdrawalRequested.amount (up to t).
    /// Both event types carry `amount` in USDC 6-decimal base units.
    ///
    /// Returns `kind = "deposit"` for `DepositRequested` rows and
    /// `kind = "withdrawal"` for `WithdrawalRequested` rows.
    pub async fn list_flow_events<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        to_unix: i64,
    ) -> anyhow::Result<Vec<FlowEventRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows = sqlx::query_as::<_, FlowEventRow>(
            "SELECT
                 block_timestamp,
                 CASE event_name
                     WHEN 'DepositRequested'    THEN 'deposit'
                     WHEN 'WithdrawalRequested' THEN 'withdrawal'
                 END AS kind,
                 -- COALESCE guards a malformed/legacy row missing the `amount`
                 -- key: without it a single NULL would fail-decode the whole
                 -- query (non-Option BigDecimal) and 500 every dashboard endpoint.
                 COALESCE((params->>'amount')::numeric, 0) AS amount
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name IN ('DepositRequested', 'WithdrawalRequested')
               AND block_timestamp <= $2
             ORDER BY block_timestamp",
        )
        .bind(chain_id)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;
        Ok(rows)
    }

    /// All `YieldMinted` events for a chain with `block_timestamp <= to_unix`,
    /// ordered by `block_timestamp`.
    ///
    /// Used by the Dashboard yield-history and summary endpoints to compute the
    /// cumulative net PLUSD minted to the sPLUSD vault. `s_plusd_amount` is
    /// sourced from `params->>'s_plusd_amount'`.
    pub async fn list_yield_mints<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        to_unix: i64,
    ) -> anyhow::Result<Vec<YieldMintRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows = sqlx::query_as::<_, YieldMintRow>(
            "SELECT
                 block_timestamp,
                 -- COALESCE guards a malformed row missing `s_plusd_amount`:
                 -- a NULL would otherwise fail-decode the whole query and 500
                 -- the summary + yield-history endpoints.
                 COALESCE((params->>'s_plusd_amount')::numeric, 0) AS s_plusd_amount
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name = 'YieldMinted'
               AND block_timestamp <= $2
             ORDER BY block_timestamp",
        )
        .bind(chain_id)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;
        Ok(rows)
    }

    /// Sum of `YieldMinted.s_plusd_amount` attributable to a single loan, in USDC
    /// base units (6-decimal).
    ///
    /// Per-loan attribution goes through `yield_mint_outbox`: each confirmed mint
    /// job carries the `tx_hash` of the mint transaction, and on Soroban a mint tx
    /// corresponds to exactly one `(loan_id, repayment_id)` repayment. We therefore
    /// sum the `YieldMinted` events whose `tx_hash` matches one of this loan's
    /// `confirmed` outbox rows. `DISTINCT` guards a batch tx that would otherwise be
    /// double-counted if several outbox rows shared a `tx_hash`.
    ///
    /// Returns `0` when the loan has no confirmed mints. Chain-scoped; the
    /// yield-minter address is not needed because `(chain_id, loan_id)` already
    /// pins the outbox rows.
    pub async fn minted_yield_for_loan<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> anyhow::Result<BigDecimal>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let minted: BigDecimal = sqlx::query_scalar(
            "SELECT COALESCE(SUM((cl.params->>'s_plusd_amount')::numeric), 0)
             FROM contract_logs cl
             WHERE cl.chain_id = $1
               AND cl.event_name = 'YieldMinted'
               AND cl.tx_hash IN (
                   SELECT DISTINCT o.tx_hash
                   FROM yield_mint_outbox o
                   WHERE o.chain_id = $1
                     AND o.loan_id = $2
                     AND o.status = 'confirmed'
                     AND o.tx_hash IS NOT NULL
               )",
        )
        .bind(chain_id)
        .bind(loan_id)
        .fetch_one(executor)
        .await?;
        Ok(minted)
    }

    /// All `AssetTransfer` events for a chain with `block_timestamp <= to_unix`.
    ///
    /// Used by the Capital Allocation API to compute the `in_transit` bucket as the
    /// net custody→ramp flow. Only transfers between tracked (custody ∪ ramp)
    /// accounts are indexed, so callers classify `from`/`to` against the configured
    /// address sets.
    pub async fn list_asset_transfers<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        to_unix: i64,
    ) -> anyhow::Result<Vec<AssetTransferRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows = sqlx::query_as::<_, AssetTransferRow>(
            "SELECT
                 params->>'from' AS from_addr,
                 params->>'to'   AS to_addr,
                 -- COALESCE guards a malformed row missing `amount`: a NULL would
                 -- otherwise fail-decode the whole query (non-Option BigDecimal).
                 COALESCE((params->>'amount')::numeric, 0) AS amount
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name = 'AssetTransfer'
               AND block_timestamp <= $2",
        )
        .bind(chain_id)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;
        Ok(rows)
    }

    /// Connection-scoped fetch of the latest snapshot for a given loan, for use
    /// by the indexer's carry-forward path. Returns `None` when no prior `LoanDrawn`
    /// has been processed (i.e. the loan was never indexed — indexer bug guard).
    pub async fn get_latest_loan_snapshot(
        &self,
        conn: &mut sqlx::PgConnection,
        chain_id: i64,
        contract_address: &str,
        loan_id: &BigDecimal,
    ) -> anyhow::Result<Option<LoanSnapshot>> {
        let row = sqlx::query(
            "SELECT params->'snapshot' AS snapshot
             FROM contract_logs
             WHERE chain_id = $1
               AND contract_address = $2
               AND event_name IN (
                   'LoanDrawn',
                   'LoanStatusUpdated',
                   'LoanCCRUpdated',
                   'LoanLocationUpdated',
                   'LoanDefaulted',
                   'LoanClosed',
                   'PaymentRecorded',
                   'LoanRolledOver',
                   'EconomicsAmended'
               )
               AND (params->>'loan_id')::numeric = $3
             ORDER BY block_number DESC, log_index DESC
             LIMIT 1",
        )
        .bind(chain_id)
        .bind(contract_address)
        .bind(loan_id)
        .fetch_optional(conn)
        .await?;

        match row {
            None => Ok(None),
            Some(r) => {
                use sqlx::Row;
                let snapshot_json: serde_json::Value = r.try_get("snapshot")?;
                let snapshot: LoanSnapshot = serde_json::from_value(snapshot_json)
                    .map_err(|e| anyhow::anyhow!("failed to deserialize LoanSnapshot: {e}"))?;
                Ok(Some(snapshot))
            }
        }
    }
}
