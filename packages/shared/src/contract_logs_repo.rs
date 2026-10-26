use std::str::FromStr;

use bigdecimal::BigDecimal;
use sqlx::PgPool;

use crate::chains::{normalize_usdc_amount, parse_chain_type, ChainKind};
use crate::loan_event_params::json_i64;
use crate::loan_snapshot::LoanSnapshot;

/// Every `event_name` that carries a `LoanSnapshot` (`params->'snapshot'`), shared by
/// the "latest snapshot per loan" queries below (`list_latest_loan_snapshots`,
/// `list_latest_loan_snapshots_for_chain`, `get_loan_snapshot_as_of`,
/// `latest_status_by_loans`, `get_latest_loan_snapshot`). A name missing from this list has its snapshot
/// written but never read back as "latest" — see issue #1433 finding F3. All of these
/// queries must stay derived from this single list rather than hand-copied.
pub const LOAN_LIFECYCLE_EVENT_NAMES: &[&str] = &[
    "LoanDrawn",
    "LoanStatusUpdated",
    "LoanCCRUpdated",
    "LoanLocationUpdated",
    "LoanDefaulted",
    "LoanClosed",
    "PaymentRecorded",
    "PaymentUnrecorded",
    "LoanRolledOver",
    "EconomicsAmended",
    "Disbursed",
    "Undisbursed",
    "LoanWrittenDown",
    "InterestAdjusted",
];

pub const LOAN_STATUS_EVENT_NAMES: &[&str] = &["LoanStatusUpdated", "LoanDefaulted", "LoanClosed"];

pub const LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL: &str = "SELECT
         chain_id,
         event_name,
         block_timestamp,
         (params->>'loan_id')::numeric AS loan_id,
         params->'event'->>'status' AS status
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $4
       AND event_name = ANY($2)
       AND block_timestamp <= $3
     ORDER BY block_number, log_index";

pub const LOAN_RATE_EVENTS_SQL: &str = "SELECT
         (params->>'loan_id')::numeric AS loan_id,
         event_name,
         block_timestamp,
         (params->'event'->>'outstanding')::numeric AS outstanding,
         (params->'event'->>'new_rate')::bigint AS new_rate
     FROM contract_logs
     WHERE chain_id = $1
       AND event_name = ANY($2)
       AND block_timestamp <= $3
     ORDER BY block_number, log_index";

pub const LOAN_RATE_EVENTS_FOR_LOAN_SQL: &str = "SELECT
         (params->>'loan_id')::numeric AS loan_id,
         event_name,
         block_timestamp,
         (params->'event'->>'outstanding')::numeric AS outstanding,
         (params->'event'->>'new_rate')::bigint AS new_rate
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $4
       AND event_name = ANY($2)
       AND (params->>'loan_id')::numeric = $5
       AND block_timestamp <= $3
     ORDER BY block_number, log_index";

pub const LIST_LATEST_LOAN_SNAPSHOTS_SQL: &str =
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
       AND event_name = ANY($4)
       AND block_timestamp <= $3
     ORDER BY (params->>'loan_id')::numeric, block_number DESC, log_index DESC";

pub const LOAN_SNAPSHOT_AS_OF_SQL: &str = "SELECT chain_id,
         (params->>'loan_id')::numeric AS loan_id,
         block_number,
         log_index::bigint AS log_index,
         event_name,
         block_timestamp,
         params->'snapshot' AS snapshot
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $5
       AND (params->>'loan_id')::numeric = $2
       AND event_name = ANY($4)
       AND (block_timestamp <= $3 OR event_name = 'LoanDrawn')
     ORDER BY block_number DESC, log_index DESC
     LIMIT 1";

pub const LATEST_STATUS_BY_LOANS_SQL: &str = "SELECT DISTINCT ON ((params->>'loan_id')::numeric)
         (params->>'loan_id')::numeric        AS loan_id,
         params->'snapshot'->>'status'        AS status
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $4
       AND event_name = ANY($3)
       AND (params->>'loan_id')::numeric = ANY($2)
     ORDER BY (params->>'loan_id')::numeric, block_number DESC, log_index DESC";

pub const LATEST_WATCHLIST_ENTRY_SQL: &str = "SELECT DISTINCT ON ((params->>'loan_id')::numeric)
         (params->>'loan_id')::numeric AS loan_id,
         block_timestamp
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $3
       AND event_name = 'LoanStatusUpdated'
       AND params->'event'->>'status' = 'WatchList'
       AND block_timestamp <= $2
     ORDER BY (params->>'loan_id')::numeric, block_timestamp DESC, log_index DESC";

pub const LOAN_ECONOMICS_EVENTS_SQL: &str = "SELECT
         event_name,
         params->'event' AS event,
         block_timestamp
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $4
       AND event_name IN ('LoanRolledOver', 'EconomicsAmended')
       AND (params->>'loan_id')::numeric = $2
       AND block_timestamp <= $3
     ORDER BY block_number, log_index";

pub const LEGACY_YIELD_MINTED_SQL: &str = "SELECT COALESCE(SUM(
                COALESCE((cl.params->>'s_plusd_amount')::numeric, 0)
              + COALESCE((cl.params->>'treasury_amount')::numeric, 0)
            ), 0)
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
             AND EXISTS (
                 SELECT 1
                 FROM contract_logs p
                 WHERE p.chain_id = o.chain_id
                   AND p.contract_address = $3
                   AND p.event_name = 'PaymentRecorded'
                   AND (p.params->>'loan_id')::numeric = o.loan_id
                   AND (p.params->'event'->>'repayment_id')::numeric = o.repayment_id
             )
       )";

pub const LIST_REPAYMENT_MINTS_SQL: &str = "SELECT (r.params->>'loan_id')::numeric AS loan_id,
            (r.params->>'repayment_id')::numeric AS repayment_id,
            r.block_timestamp,
            COALESCE((r.params->>'interest_minted')::numeric, 0) AS interest_minted,
            pr.fee_amount,
            rv.reversed_at,
            EXISTS (
                SELECT 1
                FROM contract_logs d
                WHERE d.chain_id = r.chain_id
                  AND d.contract_address = $4
                  AND d.event_name = 'LoanDefaulted'
                  AND (d.params->>'loan_id')::numeric = (r.params->>'loan_id')::numeric
                  AND (d.block_number, d.log_index) < (r.block_number, r.log_index)
            ) AS carved_out
     FROM contract_logs r
     JOIN LATERAL (
         SELECT (p.params->'event'->>'mgmt_fee')::numeric
              + (p.params->'event'->>'perf_fee')::numeric
              + (p.params->'event'->>'oet_alloc')::numeric AS fee_amount
         FROM contract_logs p
         WHERE p.chain_id = r.chain_id
           AND p.contract_address = $4
           AND p.tx_hash = r.tx_hash
           AND p.event_name = 'PaymentRecorded'
           AND (p.params->>'loan_id')::numeric = (r.params->>'loan_id')::numeric
           AND (p.params->'event'->>'repayment_id')::numeric = (r.params->>'repayment_id')::numeric
         ORDER BY p.log_index DESC
         LIMIT 1
     ) pr ON true
     LEFT JOIN LATERAL (
         SELECT MIN(v.block_timestamp) AS reversed_at
         FROM contract_logs v
         WHERE v.chain_id = r.chain_id
           AND v.contract_address = r.contract_address
           AND v.event_name = 'CashRepaymentReversed'
           AND (v.params->>'loan_id')::numeric = (r.params->>'loan_id')::numeric
           AND (v.params->>'repayment_id')::numeric = (r.params->>'repayment_id')::numeric
           AND v.block_timestamp <= $3
     ) rv ON true
     WHERE r.chain_id = $1
       AND r.event_name = 'CashRepaid'
       AND ($2::numeric IS NULL OR (r.params->>'loan_id')::numeric = $2)
       AND r.block_timestamp <= $3
     ORDER BY r.block_number, r.log_index";

pub const LIST_WITHDRAWAL_QUEUE_ROWS_SQL: &str = "SELECT r.chain_id,
            r.params->>'request_id'        AS request_id,
            r.params->>'withdrawer'        AS withdrawer,
            (r.params->>'amount')::numeric AS amount,
            r.block_timestamp              AS requested_at,
            claim.claimed_at
     FROM contract_logs r
     LEFT JOIN LATERAL (
         SELECT c.block_timestamp AS claimed_at
         FROM contract_logs c
         WHERE c.chain_id = r.chain_id
           AND c.contract_address = r.contract_address
           AND c.event_name = 'RequestClaimed'
           AND c.params->>'request_id' = r.params->>'request_id'
         ORDER BY c.block_timestamp DESC, c.log_index DESC
         LIMIT 1
     ) claim ON TRUE
     WHERE r.chain_id = $1
       AND r.event_name = 'WithdrawalRequested'
       AND r.block_timestamp <= $2";

/// Signed raw (on-chain scale) PLUSD supply steps of one chain: `$1` chain id, `$2` `to_unix`,
/// `$3` the chain's LoanRegistry address. See `docs/product-specs/dashboards-tvl-ledger.md`.
pub const PLUSD_LEDGER_SQL: &str = "WITH repayment_fees AS (
         SELECT DISTINCT ON (p.chain_id, p.tx_hash,
                             (p.params->>'loan_id')::numeric,
                             (p.params->'event'->>'repayment_id')::numeric)
                p.chain_id, p.tx_hash,
                (p.params->>'loan_id')::numeric AS loan_id,
                (p.params->'event'->>'repayment_id')::numeric AS repayment_id,
                COALESCE((p.params->'event'->>'mgmt_fee')::numeric, 0)
              + COALESCE((p.params->'event'->>'perf_fee')::numeric, 0)
              + COALESCE((p.params->'event'->>'oet_alloc')::numeric, 0) AS fee_amount
         FROM contract_logs p
         WHERE p.chain_id = $1
           AND p.contract_address = $3
           AND p.event_name = 'PaymentRecorded'
         ORDER BY p.chain_id, p.tx_hash,
                  (p.params->>'loan_id')::numeric,
                  (p.params->'event'->>'repayment_id')::numeric,
                  p.log_index DESC
     )
     SELECT block_timestamp, block_number, log_index, delta
     FROM (
         SELECT block_timestamp, block_number, log_index,
                CASE event_name
                    WHEN 'DepositRequested' THEN COALESCE((params->>'amount')::numeric, 0)
                    WHEN 'WireIn'           THEN COALESCE((params->>'amount')::numeric, 0)
                    WHEN 'WireInReturned'   THEN -COALESCE((params->>'amount')::numeric, 0)
                    WHEN 'WireOutSettled'   THEN -COALESCE((params->>'amount')::numeric, 0)
                    WHEN 'LossAbsorbed'     THEN -COALESCE((params->>'pulled')::numeric, 0)
                    WHEN 'YieldMinted'      THEN COALESCE((params->>'s_plusd_amount')::numeric, 0)
                                               + COALESCE((params->>'treasury_amount')::numeric, 0)
                    WHEN 'CashRecorded'     THEN COALESCE((params->>'delta')::numeric, 0)
                END AS delta
         FROM contract_logs
         WHERE chain_id = $1
           AND block_timestamp <= $2
           AND (event_name IN ('DepositRequested', 'WireIn', 'WireInReturned', 'WireOutSettled',
                               'LossAbsorbed', 'YieldMinted')
                OR (event_name = 'CashRecorded' AND params->>'reason' = 'Income'))
         UNION ALL
         SELECT c.block_timestamp, c.block_number, c.log_index,
                -COALESCE((c.params->>'amount')::numeric, 0)
         FROM contract_logs c
         WHERE c.chain_id = $1
           AND c.block_timestamp <= $2
           AND c.event_name = 'RequestClaimed'
           AND EXISTS (
               SELECT 1
               FROM contract_logs q
               WHERE q.chain_id = c.chain_id
                 AND q.contract_address = c.contract_address
                 AND q.event_name = 'WithdrawalRequested'
                 AND q.params->>'request_id' = c.params->>'request_id'
           )
         UNION ALL
         SELECT block_timestamp, block_number, log_index,
                -COALESCE((params->'event'->>'burned')::numeric, 0)
         FROM contract_logs
         WHERE chain_id = $1
           AND block_timestamp <= $2
           AND contract_address = $3
           AND event_name = 'LoanWrittenDown'
         UNION ALL
         SELECT r.block_timestamp, r.block_number, r.log_index,
                COALESCE((r.params->>'interest_minted')::numeric, 0) + COALESCE(pr.fee_amount, 0)
         FROM contract_logs r
         LEFT JOIN repayment_fees pr
                ON pr.chain_id = r.chain_id
               AND pr.tx_hash = r.tx_hash
               AND pr.loan_id = (r.params->>'loan_id')::numeric
               AND pr.repayment_id = (r.params->>'repayment_id')::numeric
         WHERE r.chain_id = $1
           AND r.block_timestamp <= $2
           AND r.event_name = 'CashRepaid'
         UNION ALL
         SELECT v.block_timestamp, v.block_number, v.log_index,
                -(COALESCE((
                       SELECT SUM(COALESCE((w.params->>'assets')::numeric, 0))
                       FROM contract_logs w
                       WHERE w.chain_id = v.chain_id
                         AND w.tx_hash = v.tx_hash
                         AND w.event_name = 'StakingWithdrawal'
                         AND LOWER(w.params->>'sender') = LOWER(v.contract_address)
                         AND w.log_index < v.log_index
                         AND w.log_index > COALESCE((
                             SELECT MAX(v2.log_index)
                             FROM contract_logs v2
                             WHERE v2.chain_id = v.chain_id
                               AND v2.tx_hash = v.tx_hash
                               AND v2.event_name = 'CashRepaymentReversed'
                               AND v2.log_index < v.log_index
                         ), -1)
                   ), 0)
                 + COALESCE(orig.carved_interest, 0))
         FROM contract_logs v
         LEFT JOIN LATERAL (
             SELECT CASE WHEN EXISTS (
                        SELECT 1
                        FROM contract_logs d
                        WHERE d.chain_id = r.chain_id
                          AND d.contract_address = $3
                          AND d.event_name = 'LoanDefaulted'
                          AND (d.params->>'loan_id')::numeric = (r.params->>'loan_id')::numeric
                          AND (d.block_number, d.log_index) < (r.block_number, r.log_index)
                    ) THEN COALESCE((r.params->>'interest_minted')::numeric, 0) ELSE 0 END
                    AS carved_interest
             FROM contract_logs r
             WHERE r.chain_id = v.chain_id
               AND r.contract_address = v.contract_address
               AND r.event_name = 'CashRepaid'
               AND (r.params->>'loan_id')::numeric = (v.params->>'loan_id')::numeric
               AND (r.params->>'repayment_id')::numeric = (v.params->>'repayment_id')::numeric
             ORDER BY r.block_number DESC, r.log_index DESC
             LIMIT 1
         ) orig ON TRUE
         WHERE v.chain_id = $1
           AND v.block_timestamp <= $2
           AND v.event_name = 'CashRepaymentReversed'
     ) ledger
     WHERE delta IS NOT NULL AND delta <> 0
     ORDER BY block_number, log_index";

fn decode_snapshot_rows(
    chain_id: i64,
    rows: Vec<sqlx::postgres::PgRow>,
) -> anyhow::Result<Vec<LoanSnapshotRow>> {
    // `contract_logs` stores the raw on-chain value; normalize to the canonical
    // 6-decimal scale here (read time only — see #901), never at indexer write time.
    let chain_kind = parse_chain_type(chain_id)?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        use sqlx::Row;
        let snapshot_json: serde_json::Value = row.try_get("snapshot")?;
        let mut snapshot: LoanSnapshot = serde_json::from_value(snapshot_json)
            .map_err(|e| anyhow::anyhow!("failed to deserialize LoanSnapshot: {e}"))?;
        snapshot.normalize_usdc_for_display(chain_kind);
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

/// One outstanding-changing or rate-changing loan event (`Disbursed`, `Undisbursed`,
/// `PaymentRecorded`, `PaymentUnrecorded`, `LoanDefaulted`, `LoanWrittenDown`,
/// `EconomicsAmended`, `LoanRolledOver`). `outstanding` is `params.event.outstanding`
/// (raw token units, `None` for the rate events); `new_rate` is `params.event.new_rate`
/// (contract `ONE = 1_000_000` scale, `None` for the outstanding events).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LoanRateEventRow {
    pub loan_id: BigDecimal,
    pub event_name: String,
    pub block_timestamp: i64,
    pub outstanding: Option<BigDecimal>,
    pub new_rate: Option<i64>,
}

/// A loan status event row (`LoanStatusUpdated`, `LoanDefaulted`, `LoanClosed`) fetched
/// from `contract_logs`; `status` is `params.event.status`, set only on `LoanStatusUpdated`.
/// Input of `shared::loan_status::LoanTimeline`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LifecycleRow {
    pub chain_id: i64,
    pub event_name: String,
    pub block_timestamp: i64,
    pub loan_id: BigDecimal,
    pub status: Option<String>,
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
/// `(chain_id, contract_address, request_id)` — the same contract address can exist
/// on two chains.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WithdrawalQueueRow {
    pub chain_id: i64,
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

/// One signed PLUSD supply step of the TVL ledger (see `PLUSD_LEDGER_SQL`).
///
/// `delta` is positive for a mint or a pending deposit and negative for a burn. Rows from
/// [`ContractLogsRepo::list_plusd_ledger`] are base-6 USDC, ordered by `(block_number, log_index)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlusdDeltaRow {
    pub block_timestamp: i64,
    pub block_number: i64,
    pub log_index: i64,
    pub delta: BigDecimal,
}

/// Normalises raw per-chain ledger deltas to base-6 by normalising the running total and
/// emitting its change, so a Stellar chain truncates once per prefix, not once per event.
/// `rows` must already be ordered by `(block_number, log_index)`.
pub fn normalise_plusd_ledger(kind: ChainKind, rows: Vec<PlusdDeltaRow>) -> Vec<PlusdDeltaRow> {
    let mut raw_total = BigDecimal::from(0);
    let mut emitted = BigDecimal::from(0);
    let mut out = Vec::with_capacity(rows.len());
    for mut row in rows {
        raw_total += &row.delta;
        let normalised = normalize_usdc_amount(kind, &raw_total);
        row.delta = &normalised - &emitted;
        emitted = normalised;
        out.push(row);
    }
    out
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

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RepaymentMintRow {
    pub loan_id: BigDecimal,
    pub repayment_id: BigDecimal,
    pub block_timestamp: i64,
    pub interest_minted: BigDecimal,
    pub fee_amount: Option<BigDecimal>,
    pub reversed_at: Option<i64>,
    pub carved_out: bool,
}

/// One indexed Stellar `AssetTransfer` event row.
///
/// Emitted by the worker's Stellar indexer for transfers of the tracked asset
/// where **both** endpoints are custody/ramp addresses (see the worker's
/// `transfer_between_tracked`). Used by the Capital Allocation API to compute the
/// `in_transit` bucket's gross approved ramp flow (both legs, absolute — #1027),
/// and by the `/v1/ramp` endpoints (#936) to list and review (approve/reject)
/// on-ramp **and** off-ramp events — every ramp-boundary transfer needs Trustee
/// review, not just inflows. `amount` is in USDC base units (6-decimal), matching
/// the other `contract_logs` amounts.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AssetTransferRow {
    /// `contract_logs.id` — the primary key of the underlying log row, and the key
    /// the `ramp_reviews` table (#936) references.
    pub id: i64,
    /// The chain this transfer was indexed on. Needed by `get_asset_transfer_by_id`
    /// (#936) so the review handler can look up the *correct* chain's custody/ramp
    /// address sets to validate direction — the id alone doesn't imply a chain.
    pub chain_id: i64,
    /// Sender Strkey (`params->>'from'`).
    pub from_addr: String,
    /// Recipient Strkey (`params->>'to'`).
    pub to_addr: String,
    /// Transfer amount in base units (`params->>'amount'`).
    pub amount: BigDecimal,
    /// Unix seconds the transfer was recorded on-chain.
    pub block_timestamp: i64,
    /// `"Approved"` or `"Rejected"` once a Trustee has reviewed this ramp-boundary
    /// event (#936), in either direction; `None` while pending. Always `None` for
    /// transfers that don't cross the custody/ramp boundary at all (custody↔custody
    /// or ramp↔ramp shuffles) — `ramp_reviews` only ever gains rows for on-ramp or
    /// off-ramp events.
    pub review_decision: Option<String>,
    /// Rejection reason; `Some` iff `review_decision == Some("Rejected")`.
    pub review_reason: Option<String>,
    /// When the review was recorded. `Some` iff `review_decision.is_some()`.
    pub reviewed_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl AssetTransferRow {
    /// Whether this event has been reviewed and Approved — the only decision that
    /// counts toward `capital_allocation`'s `in_transit` bucket, on either leg (#936).
    pub fn is_approved(&self) -> bool {
        self.review_decision.as_deref() == Some("Approved")
    }

    /// Whether this event is still awaiting Trustee review (neither Approved nor
    /// Rejected) — the definition `routes::ramp`'s pending-events list uses (#936).
    pub fn is_pending_review(&self) -> bool {
        self.review_decision.is_none()
    }
}

/// One `LoanRolledOver` or `EconomicsAmended` event for a single loan, decoded from
/// `params.event` (`new_rate`, `new_maturity_timestamp`) of the mapper's
/// `{loan_id, event, snapshot}` row shape.
///
/// Used to reconstruct the loan's economics-epoch timeline: epoch 1 is seeded from
/// the loan's origination data, then these events are folded on in chronological
/// order — a `LoanRolledOver` opens a new epoch (its start = the prior epoch's
/// maturity), while an `EconomicsAmended` amends the current epoch in place.
///
/// `new_rate` is the contract's fixed-point rate (scaled by `ONE = 1_000_000`, so
/// `150_000` = 15%) — note this differs from the snapshot's `senior_interest_rate_bps`
/// bps scale. `new_maturity_timestamp` is Unix seconds. The EVM (JSON number) and
/// Stellar (JSON string) encodings decode identically via `json_i64`; a missing or
/// unparseable field decodes to `0`.
#[derive(Debug, Clone)]
pub struct EconomicsEventRow {
    /// `"LoanRolledOver"` or `"EconomicsAmended"`.
    pub event_name: String,
    /// New senior interest rate, scaled by the contract's `ONE = 1_000_000`.
    pub new_rate: i64,
    /// New maturity timestamp (Unix seconds).
    pub new_maturity_timestamp: i64,
    /// The event's own on-chain block timestamp (Unix seconds).
    pub block_timestamp: i64,
}

impl EconomicsEventRow {
    pub fn from_event_json(
        event_name: String,
        event: Option<&serde_json::Value>,
        block_timestamp: i64,
    ) -> Self {
        let field = |key: &str| {
            event
                .and_then(|e| e.get(key))
                .and_then(json_i64)
                .unwrap_or(0)
        };
        Self {
            event_name,
            new_rate: field("new_rate"),
            new_maturity_timestamp: field("new_maturity_timestamp"),
            block_timestamp,
        }
    }
}

/// One `contract_logs` row projected for the Trustee **Audit Log** feed
/// (`GET /v1/audit-log`). Deliberately raw: the human-readable "Action" string, the
/// friendly loan name, and the scope label are derived in the API layer
/// (`routes::audit_log`) from `event_name` + `params` (+ the two snapshot-derived
/// fields below), keeping this repo free of presentation concerns.
///
/// `id` is the table's `BIGSERIAL` primary key — a monotonic insertion order used as the
/// stable keyset cursor and tiebreak for the reverse-chronological page (rather than
/// `block_timestamp`, which is not unique across events in the same block).
#[derive(Debug, Clone)]
pub struct AuditLogRow {
    pub id: i64,
    pub chain_id: i64,
    pub event_name: String,
    pub block_timestamp: i64,
    pub block_number: i64,
    pub log_index: i64,
    pub tx_hash: String,
    /// `params->>'loan_id'` — `None` for protocol-scoped events (e.g. `WireOutRequested`).
    pub loan_id: Option<String>,
    /// `params->'snapshot'->>'originator'` — `None` for protocol-scoped events (no
    /// snapshot, e.g. `YieldMinted`). Used by the API layer to build the friendly
    /// loan name that populates `AuditLogItem::reference` (`"<originator> — <commodity>"`).
    pub originator: Option<String>,
    /// `params->'snapshot'->>'commodity'` — `None` for protocol-scoped events (no
    /// snapshot, e.g. `YieldMinted`). See `originator`.
    pub commodity: Option<String>,
    /// The full event `params` JSONB, passed to the action formatter.
    pub params: serde_json::Value,
}

/// One indexed `PaymentRecorded` row's flattened `RepaymentData` (#1434 D3).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RecordedPaymentRow {
    pub repayment_id: String,
    pub offtaker_received: BigDecimal,
    pub senior_principal_repaid: BigDecimal,
    pub senior_interest: BigDecimal,
    pub equity_distributed: BigDecimal,
    pub mgmt_fee: BigDecimal,
    pub perf_fee: BigDecimal,
    pub oet_alloc: BigDecimal,
}

#[derive(Clone, Debug, PartialEq, Eq, sqlx::FromRow)]
pub struct DealRegistrationRow {
    pub loan_id: String,
    pub debt: String,
    pub cargo: String,
}

pub struct ContractLogsRepo {
    pub pool: PgPool,
}

impl ContractLogsRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Return all `LoanStatusUpdated`, `LoanDefaulted` and `LoanClosed` events for a given `chain_id` with
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
        let event_names = LOAN_STATUS_EVENT_NAMES.to_vec();
        let rows = sqlx::query_as::<_, LifecycleRow>(
            "SELECT
                 chain_id,
                 event_name,
                 block_timestamp,
                 (params->>'loan_id')::numeric AS loan_id,
                 params->'event'->>'status' AS status
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name = ANY($2)
               AND block_timestamp <= $3
             ORDER BY block_number, log_index",
        )
        .bind(chain_id)
        .bind(&event_names)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;
        Ok(rows)
    }

    /// Like `list_loan_lifecycle_events` but only rows emitted by `contract_address`
    /// (the configured LoanRegistry), so a registry redeploy cannot mix loan ids.
    pub async fn list_loan_lifecycle_events_for_registry<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        contract_address: &str,
        to_unix: i64,
    ) -> anyhow::Result<Vec<LifecycleRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let event_names = LOAN_STATUS_EVENT_NAMES.to_vec();
        let rows = sqlx::query_as::<_, LifecycleRow>(LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL)
            .bind(chain_id)
            .bind(&event_names)
            .bind(to_unix)
            .bind(contract_address)
            .fetch_all(executor)
            .await?;
        Ok(rows)
    }

    /// Outstanding- and rate-changing loan events for a chain with `block_timestamp <=
    /// to_unix`, ordered by `(block_timestamp, log_index)`. Backs the `/v1/stats/yield`
    /// `apy` weighting (see `shared::book_weighting`).
    pub async fn list_loan_rate_events<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        to_unix: i64,
    ) -> anyhow::Result<Vec<LoanRateEventRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows = sqlx::query_as::<_, LoanRateEventRow>(LOAN_RATE_EVENTS_SQL)
            .bind(chain_id)
            .bind(crate::book_weighting::RATE_WEIGHT_EVENT_NAMES.to_vec())
            .bind(to_unix)
            .fetch_all(executor)
            .await?;
        Ok(rows)
    }

    /// One loan's outstanding- and rate-changing events emitted by `contract_address`
    /// with `block_timestamp <= to_unix`, in chain order. Raw on-chain units (not normalised).
    pub async fn list_loan_rate_events_for_loan<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        contract_address: &str,
        loan_id: &BigDecimal,
        to_unix: i64,
    ) -> anyhow::Result<Vec<LoanRateEventRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows = sqlx::query_as::<_, LoanRateEventRow>(LOAN_RATE_EVENTS_FOR_LOAN_SQL)
            .bind(chain_id)
            .bind(crate::book_weighting::RATE_WEIGHT_EVENT_NAMES.to_vec())
            .bind(to_unix)
            .bind(contract_address)
            .bind(loan_id)
            .fetch_all(executor)
            .await?;
        Ok(rows)
    }

    /// The most recent loan-event snapshot per `(chain_id, loan_id)` emitted by
    /// `contract_address` (the configured LoanRegistry) whose `block_timestamp <=
    /// to_unix`. Backs the LoanBook readers.
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
        let rows = sqlx::query(LIST_LATEST_LOAN_SNAPSHOTS_SQL)
            .bind(chain_id)
            .bind(contract_address)
            .bind(to_unix)
            .bind(LOAN_LIFECYCLE_EVENT_NAMES)
            .fetch_all(executor)
            .await?;
        decode_snapshot_rows(chain_id, rows)
    }

    /// Like `list_latest_loan_snapshots` but filters only by `chain_id` (no
    /// contract_address). Used by the chain-scoped non-LoanBook API groups until #1538.
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
               AND event_name = ANY($3)
               AND block_timestamp <= $2
             ORDER BY (params->>'loan_id')::numeric, block_number DESC, log_index DESC",
        )
        .bind(chain_id)
        .bind(to_unix)
        .bind(LOAN_LIFECYCLE_EVENT_NAMES)
        .fetch_all(executor)
        .await?;

        decode_snapshot_rows(chain_id, rows)
    }

    /// The loan's snapshot as of `as_of`, scoped to a single `loan_id`.
    ///
    /// Unlike `list_latest_loan_snapshots`, this also matches the genesis
    /// `LoanDrawn` row when no event has `block_timestamp <= as_of` yet. The immutable
    /// `origination_date` field written at `LoanDrawn` is supplied by whoever built the
    /// draw payload and can predate the draw transaction's actual `block_timestamp` (e.g.
    /// it reflects when the trade-finance facility commercially started). Without this
    /// fallback, an `as_of` in `[origination_date, block_timestamp)` finds no row at all —
    /// even though the loan's state at that instant is well-defined (nothing on-chain has
    /// happened yet, so it's exactly the genesis state). Callers still need to check
    /// `as_of >= origination_date` themselves for the case where `as_of` truly precedes
    /// origination.
    ///
    /// **Not USDC-normalized** — unlike this repo's other `LoanSnapshot`-returning
    /// methods. Sole caller is `routes::waterfall`, whose own doc comment states its
    /// output is deliberately raw on-chain base units (7-decimal on Soroban) meant to be
    /// handed straight to `recordPayment`; normalizing here would corrupt that on-chain
    /// call argument, not just a display figure. See #901.
    pub async fn get_loan_snapshot_as_of<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        contract_address: &str,
        loan_id: &BigDecimal,
        as_of: i64,
    ) -> anyhow::Result<Option<LoanSnapshotRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let row = sqlx::query(LOAN_SNAPSHOT_AS_OF_SQL)
            .bind(chain_id)
            .bind(loan_id)
            .bind(as_of)
            .bind(LOAN_LIFECYCLE_EVENT_NAMES)
            .bind(contract_address)
            .fetch_optional(executor)
            .await?;

        match row {
            None => Ok(None),
            Some(row) => {
                use sqlx::Row;
                let snapshot_json: serde_json::Value = row.try_get("snapshot")?;
                let snapshot: LoanSnapshot = serde_json::from_value(snapshot_json)
                    .map_err(|e| anyhow::anyhow!("failed to deserialize LoanSnapshot: {e}"))?;
                let loan_id_decimal: bigdecimal::BigDecimal = row.try_get("loan_id")?;
                Ok(Some(LoanSnapshotRow {
                    chain_id: row.try_get("chain_id")?,
                    loan_id: loan_id_decimal,
                    block_number: row.try_get("block_number")?,
                    log_index: row.try_get("log_index")?,
                    event_name: row.try_get("event_name")?,
                    block_timestamp: row.try_get("block_timestamp")?,
                    snapshot,
                }))
            }
        }
    }

    /// Latest on-chain `status` for each of `loan_ids` on `chain_id`, as
    /// `(loan_id, status)` pairs, restricted to rows emitted by `contract_address`. The
    /// "latest" snapshot per loan wins (same ordering as `list_latest_loan_snapshots`). Loans with no indexed events are simply
    /// absent from the result. Used to derive a linked submission's live status at read
    /// time (the weak-bridge model keeps on-chain state in `contract_logs`, not on the
    /// submission row).
    pub async fn latest_status_by_loans<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        contract_address: &str,
        loan_ids: &[bigdecimal::BigDecimal],
    ) -> anyhow::Result<Vec<(bigdecimal::BigDecimal, String)>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        if loan_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows =
            sqlx::query_as::<_, (bigdecimal::BigDecimal, String)>(LATEST_STATUS_BY_LOANS_SQL)
                .bind(chain_id)
                .bind(loan_ids)
                .bind(LOAN_LIFECYCLE_EVENT_NAMES)
                .bind(contract_address)
                .fetch_all(executor)
                .await?;
        Ok(rows)
    }

    /// Per-loan timestamp of the most recent `LoanStatusUpdated` transition into
    /// `WatchList`, at or before `to_unix`. Absent for a loan with no such transition.
    /// Backs the Loan Book `days_on_watchlist` field. The status is the one the event
    /// carried, `params->'event'->>'status'`, not the snapshot's status (see
    /// `latest_status_by_loans`).
    pub async fn latest_watchlist_entry_by_chain<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        contract_address: &str,
        to_unix: i64,
    ) -> anyhow::Result<Vec<(bigdecimal::BigDecimal, i64)>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows = sqlx::query_as::<_, (bigdecimal::BigDecimal, i64)>(LATEST_WATCHLIST_ENTRY_SQL)
            .bind(chain_id)
            .bind(to_unix)
            .bind(contract_address)
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
    /// `chain_id` and `contract_address`, since `request_id` is not unique across contracts).
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
        let rows = sqlx::query_as::<_, WithdrawalQueueRow>(LIST_WITHDRAWAL_QUEUE_ROWS_SQL)
            .bind(chain_id)
            .bind(to_unix)
            .fetch_all(executor)
            .await?;
        // `contract_logs` stores the raw on-chain value; normalize to the canonical
        // 6-decimal scale here (read time only — see #901).
        let chain_kind = parse_chain_type(chain_id)?;
        let rows = rows
            .into_iter()
            .map(|mut r| {
                r.amount = normalize_usdc_amount(chain_kind, &r.amount);
                r
            })
            .collect();
        Ok(rows)
    }

    /// The PLUSD supply ledger of one chain with `block_timestamp <= to_unix`: signed steps,
    /// oldest first by `(block_number, log_index)`, normalised to base-6 USDC.
    ///
    /// TVL(t) is the running sum: pending deposits (`DepositRequested`), wire-ins, repayment
    /// interest and fees, income and the legacy `YieldMinted` legs add; `WireInReturned`,
    /// `WireOutSettled`, withdrawal-queue claims, `LossAbsorbed.pulled`, write-down burns and
    /// repayment-reversal burns subtract. `loan_registry_address` scopes the registry-sourced
    /// events. See `docs/product-specs/dashboards-tvl-ledger.md`.
    pub async fn list_plusd_ledger<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        to_unix: i64,
        loan_registry_address: &str,
    ) -> anyhow::Result<Vec<PlusdDeltaRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows: Vec<(i64, i64, i64, BigDecimal)> = sqlx::query_as(PLUSD_LEDGER_SQL)
            .bind(chain_id)
            .bind(to_unix)
            .bind(loan_registry_address)
            .fetch_all(executor)
            .await?;
        let rows = rows
            .into_iter()
            .map(
                |(block_timestamp, block_number, log_index, delta)| PlusdDeltaRow {
                    block_timestamp,
                    block_number,
                    log_index,
                    delta,
                },
            )
            .collect();
        Ok(normalise_plusd_ledger(parse_chain_type(chain_id)?, rows))
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
        // `contract_logs` stores the raw on-chain value; normalize to the canonical
        // 6-decimal scale here (read time only — see #901).
        let chain_kind = parse_chain_type(chain_id)?;
        let rows = rows
            .into_iter()
            .map(|mut r| {
                r.s_plusd_amount = normalize_usdc_amount(chain_kind, &r.s_plusd_amount);
                r
            })
            .collect();
        Ok(rows)
    }

    /// Raw sum of the legacy `YieldMinted` `s_plusd_amount + treasury_amount`
    /// (vault leg plus fee leg; missing keys count as 0) attributable to a single
    /// loan, in on-chain base units (not normalised; see `shared::minted_yield`).
    ///
    /// Per-loan attribution goes through `yield_mint_outbox`: each confirmed mint
    /// job carries the `tx_hash` of the mint transaction, and on Soroban a mint tx
    /// corresponds to exactly one `(loan_id, repayment_id)` repayment. We therefore
    /// sum the `YieldMinted` events whose `tx_hash` matches one of this loan's
    /// `confirmed` outbox rows. `DISTINCT` guards a batch tx that would otherwise be
    /// double-counted if several outbox rows shared a `tx_hash`.
    ///
    /// The outbox row only counts when the same `(chain_id, loan_id, repayment_id)`
    /// has a `PaymentRecorded` row on `loan_registry_address`, so a redeployed
    /// registry that reuses loan ids does not inherit the old registry's mints.
    ///
    /// Returns `0` when the loan has no confirmed mints.
    pub async fn legacy_yield_minted_raw_for_loan<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        loan_id: &BigDecimal,
        loan_registry_address: &str,
    ) -> anyhow::Result<BigDecimal>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let minted: BigDecimal = sqlx::query_scalar(LEGACY_YIELD_MINTED_SQL)
            .bind(chain_id)
            .bind(loan_id)
            .bind(loan_registry_address)
            .fetch_one(executor)
            .await?;
        Ok(minted)
    }

    /// Minter `CashRepaid` rows (optionally for one loan) up to `to_unix`, each
    /// carrying the fee leg (`mgmt_fee + perf_fee + oet_alloc`) of the matching
    /// `PaymentRecorded` row, the earliest matching `CashRepaymentReversed`
    /// timestamp and the loan's earliest registry `LoanDefaulted` timestamp
    /// (`carved_out`: a registry `LoanDefaulted` strictly earlier by `(block_number, log_index)`). Raw on-chain scale.
    /// Chain-scoped; the `PaymentRecorded` match (same `tx_hash`, `loan_id`,
    /// `repayment_id`) is required and must come from `loan_registry_address`, so a
    /// `CashRepaid` row with no such record is excluded entirely. A reversal must
    /// come from the same Minter address as its `CashRepaid` row. See
    /// `shared::minted_yield` for the netting arithmetic.
    pub async fn list_repayment_mints<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        loan_id: Option<&BigDecimal>,
        to_unix: i64,
        loan_registry_address: &str,
    ) -> anyhow::Result<Vec<RepaymentMintRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let rows = sqlx::query_as::<_, RepaymentMintRow>(LIST_REPAYMENT_MINTS_SQL)
            .bind(chain_id)
            .bind(loan_id)
            .bind(to_unix)
            .bind(loan_registry_address)
            .fetch_all(executor)
            .await?;
        Ok(rows)
    }

    /// The `LoanRolledOver` and `EconomicsAmended` events for a single loan,
    /// ordered chronologically by `(block_number, log_index)`.
    ///
    /// Callers fold these onto the loan's origination data to rebuild the
    /// economics-epoch timeline (see [`EconomicsEventRow`]). `new_rate` /
    /// `new_maturity_timestamp` are read from `params.event`, the nested shape the
    /// mapper writes; the row mapping lives in [`EconomicsEventRow::from_event_json`].
    /// `to_unix` bounds the events to `block_timestamp <= to_unix` so a caller
    /// reconstructing the epoch timeline as of a past instant (e.g. a backdated
    /// waterfall repayment) doesn't see a rollover/amendment that happened later.
    pub async fn list_loan_economics_events<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        contract_address: &str,
        loan_id: &BigDecimal,
        to_unix: i64,
    ) -> anyhow::Result<Vec<EconomicsEventRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        use sqlx::Row;
        let rows = sqlx::query(LOAN_ECONOMICS_EVENTS_SQL)
            .bind(chain_id)
            .bind(loan_id)
            .bind(to_unix)
            .bind(contract_address)
            .fetch_all(executor)
            .await?;
        rows.iter()
            .map(|row| {
                let event: Option<serde_json::Value> = row.try_get("event")?;
                Ok(EconomicsEventRow::from_event_json(
                    row.try_get("event_name")?,
                    event.as_ref(),
                    row.try_get("block_timestamp")?,
                ))
            })
            .collect()
    }

    /// All `AssetTransfer` events for a chain with `block_timestamp <= to_unix`.
    ///
    /// Used by the Capital Allocation API to compute the `in_transit` bucket's
    /// gross approved ramp flow (both legs, absolute — #1027), and by the
    /// `/v1/ramp` endpoints (#936) to list on-ramp
    /// and off-ramp events. Only transfers between tracked (custody ∪ ramp) accounts
    /// are indexed, so callers classify `from`/`to` against the configured address
    /// sets. `review_decision`/`review_reason`/`reviewed_at` are populated via a
    /// `LEFT JOIN` against `ramp_reviews` (#936) — all `NULL` for any event that
    /// hasn't been reviewed yet.
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
                 contract_logs.id,
                 contract_logs.chain_id,
                 contract_logs.params->>'from' AS from_addr,
                 contract_logs.params->>'to'   AS to_addr,
                 -- COALESCE guards a malformed row missing `amount`: a NULL would
                 -- otherwise fail-decode the whole query (non-Option BigDecimal).
                 COALESCE((contract_logs.params->>'amount')::numeric, 0) AS amount,
                 contract_logs.block_timestamp,
                 ramp_reviews.decision AS review_decision,
                 ramp_reviews.reason AS review_reason,
                 ramp_reviews.reviewed_at
             FROM contract_logs
             LEFT JOIN ramp_reviews
                 ON ramp_reviews.contract_log_id = contract_logs.id
             WHERE contract_logs.chain_id = $1
               AND contract_logs.event_name = 'AssetTransfer'
               AND contract_logs.block_timestamp <= $2",
        )
        .bind(chain_id)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;
        Ok(rows)
    }

    /// The Withdrawal Queue Wallet's running USDC balance as of `as_of` (unix
    /// seconds) — the `wallet_balance_after` field the indexer computes on each
    /// `AssetTransfer` that touches `wallet` (see
    /// `packages/worker/src/indexer/stellar/mappers.rs::compute_wallet_balance_field`,
    /// Issue #933). Returns `None` when no transfer touching `wallet` has been
    /// indexed yet on or before `as_of` — callers should treat that as "unknown",
    /// not zero. Pass `as_of = now` for the current balance.
    ///
    /// No `contract_address` filter — matches `list_asset_transfers`'s existing
    /// assumption that only one asset is tracked per chain (`event_name =
    /// 'AssetTransfer'` plus `chain_id` is already unambiguous today).
    pub async fn get_wallet_balance_as_of<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        wallet: &str,
        as_of: i64,
    ) -> anyhow::Result<Option<BigDecimal>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let balance: Option<String> = sqlx::query_scalar(
            "SELECT params->>'wallet_balance_after'
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name = 'AssetTransfer'
               AND (params->>'from' = $2 OR params->>'to' = $2)
               AND params ? 'wallet_balance_after'
               AND block_timestamp <= $3
             ORDER BY block_number DESC, log_index DESC
             LIMIT 1",
        )
        .bind(chain_id)
        .bind(wallet)
        .bind(as_of)
        .fetch_optional(executor)
        .await?;

        Ok(match balance {
            Some(s) => Some(
                BigDecimal::from_str(&s)
                    .map_err(|e| anyhow::anyhow!("malformed wallet_balance_after {s}: {e}"))?,
            ),
            None => None,
        })
    }

    /// Fetch a single `AssetTransfer` event by its `contract_logs.id`, joined against
    /// `ramp_reviews` the same way `list_asset_transfers` is. Used by the
    /// `/v1/ramp/events/{id}/review` handler (#936) to validate the target id
    /// before recording a review decision. `None` when `id` doesn't exist or isn't
    /// an `AssetTransfer` event.
    pub async fn get_asset_transfer_by_id<'e, E>(
        &self,
        executor: E,
        id: i64,
    ) -> anyhow::Result<Option<AssetTransferRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let row = sqlx::query_as::<_, AssetTransferRow>(
            "SELECT
                 contract_logs.id,
                 contract_logs.chain_id,
                 contract_logs.params->>'from' AS from_addr,
                 contract_logs.params->>'to'   AS to_addr,
                 COALESCE((contract_logs.params->>'amount')::numeric, 0) AS amount,
                 contract_logs.block_timestamp,
                 ramp_reviews.decision AS review_decision,
                 ramp_reviews.reason AS review_reason,
                 ramp_reviews.reviewed_at
             FROM contract_logs
             LEFT JOIN ramp_reviews
                 ON ramp_reviews.contract_log_id = contract_logs.id
             WHERE contract_logs.id = $1
               AND contract_logs.event_name = 'AssetTransfer'",
        )
        .bind(id)
        .fetch_optional(executor)
        .await?;
        Ok(row)
    }

    /// Record a Trustee's Approve/Reject decision for one ramp-boundary
    /// `AssetTransfer` event (#936, either on-ramp or off-ramp). Inserts a row into
    /// `ramp_reviews` keyed by `contract_log_id`
    /// and returns the row's `reviewed_at`. `decision` is `"Approved"` or
    /// `"Rejected"`; `reason` must be `Some` iff `decision == "Rejected"` — the DB
    /// CHECK constraint enforces the same, matching `SubmittedLoanRepo::review`'s
    /// convention. The table's primary key means reviewing the same id twice returns
    /// `sqlx::Error::Database` with Postgres SQLSTATE `23505` (unique violation) —
    /// callers map that to `409 Conflict` ("already reviewed") rather than treating
    /// it as an unexpected failure.
    pub async fn review_ramp_transfer<'e, E>(
        &self,
        executor: E,
        contract_log_id: i64,
        decision: &str,
        reason: Option<&str>,
        reviewed_by: &str,
    ) -> Result<chrono::DateTime<chrono::Utc>, sqlx::Error>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let (reviewed_at,): (chrono::DateTime<chrono::Utc>,) = sqlx::query_as(
            "INSERT INTO ramp_reviews (contract_log_id, decision, reason, reviewed_by)
             VALUES ($1, $2, $3, $4)
             RETURNING reviewed_at",
        )
        .bind(contract_log_id)
        .bind(decision)
        .bind(reason)
        .bind(reviewed_by)
        .fetch_one(executor)
        .await?;
        Ok(reviewed_at)
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
               AND event_name = ANY($4)
               AND (params->>'loan_id')::numeric = $3
             ORDER BY block_number DESC, log_index DESC
             LIMIT 1",
        )
        .bind(chain_id)
        .bind(contract_address)
        .bind(loan_id)
        .bind(LOAN_LIFECYCLE_EVENT_NAMES)
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

    /// The full Trustee Audit Log feed for a chain, filtered to `event_names` and ordered
    /// newest-first (`block_timestamp`, `block_number`, `log_index`, then `id`, all
    /// descending — the same key the API uses to merge chains). Returns every matching
    /// row; the feed is not paginated.
    pub async fn list_audit_log<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        event_names: &[&str],
    ) -> anyhow::Result<Vec<AuditLogRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT
                 id,
                 chain_id,
                 event_name,
                 block_timestamp,
                 block_number,
                 log_index::bigint AS log_index,
                 tx_hash,
                 params->>'loan_id' AS loan_id,
                 params->'snapshot'->>'originator' AS originator,
                 params->'snapshot'->>'commodity' AS commodity,
                 params
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name = ANY($2)
             ORDER BY block_timestamp DESC, block_number DESC, log_index DESC, id DESC",
        )
        .bind(chain_id)
        .bind(event_names)
        .fetch_all(executor)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(AuditLogRow {
                    id: row.try_get("id")?,
                    chain_id: row.try_get("chain_id")?,
                    event_name: row.try_get("event_name")?,
                    block_timestamp: row.try_get("block_timestamp")?,
                    block_number: row.try_get("block_number")?,
                    log_index: row.try_get("log_index")?,
                    tx_hash: row.try_get("tx_hash")?,
                    loan_id: row.try_get("loan_id")?,
                    originator: row.try_get("originator")?,
                    commodity: row.try_get("commodity")?,
                    params: row.try_get("params")?,
                })
            })
            .collect()
    }

    /// Backs the EVM arm's off-chain cumulative-repayment reconstruction (#1434 D3).
    ///
    /// Ordered `block_number ASC, log_index ASC` because `accumulate_repayments` folds
    /// rows with `BTreeMap::insert`, so the last row for a `repayment_id` wins and must
    /// be the chain-latest one. Reads tolerate both `params` shapes — `LoanEventMapper`
    /// nests under `event`, `ContractLogMapper` writes flat — and skip rows carrying
    /// any of the eight keys, so shape drift drops a row instead of wedging the loan's
    /// indexing with an `UnexpectedNull` (every column is non-`Option`). The guard covers
    /// all eight rather than `repayment_id` alone: one missing amount is enough to produce
    /// the `NULL` that stops the loan indexing permanently.
    pub async fn list_recorded_payments(
        &self,
        conn: &mut sqlx::PgConnection,
        chain_id: i64,
        contract_address: &str,
        loan_id: &BigDecimal,
        max_block: i64,
    ) -> anyhow::Result<Vec<RecordedPaymentRow>> {
        let rows = sqlx::query_as::<_, RecordedPaymentRow>(
            "SELECT
                 COALESCE(params->'event'->>'repayment_id', params->>'repayment_id') AS repayment_id,
                 (COALESCE(params->'event'->>'offtaker_received', params->>'offtaker_received'))::numeric AS offtaker_received,
                 (COALESCE(params->'event'->>'senior_principal_repaid', params->>'senior_principal_repaid'))::numeric AS senior_principal_repaid,
                 (COALESCE(params->'event'->>'senior_interest', params->>'senior_interest'))::numeric AS senior_interest,
                 (COALESCE(params->'event'->>'equity_distributed', params->>'equity_distributed'))::numeric AS equity_distributed,
                 (COALESCE(params->'event'->>'mgmt_fee', params->>'mgmt_fee'))::numeric AS mgmt_fee,
                 (COALESCE(params->'event'->>'perf_fee', params->>'perf_fee'))::numeric AS perf_fee,
                 (COALESCE(params->'event'->>'oet_alloc', params->>'oet_alloc'))::numeric AS oet_alloc
             FROM contract_logs
             WHERE chain_id = $1
               AND contract_address = $2
               AND event_name = 'PaymentRecorded'
               AND (params->>'loan_id')::numeric = $3
               AND block_number <= $4
               AND COALESCE(params->'event'->>'repayment_id', params->>'repayment_id') IS NOT NULL
               AND COALESCE(params->'event'->>'offtaker_received', params->>'offtaker_received') IS NOT NULL
               AND COALESCE(params->'event'->>'senior_principal_repaid', params->>'senior_principal_repaid') IS NOT NULL
               AND COALESCE(params->'event'->>'senior_interest', params->>'senior_interest') IS NOT NULL
               AND COALESCE(params->'event'->>'equity_distributed', params->>'equity_distributed') IS NOT NULL
               AND COALESCE(params->'event'->>'mgmt_fee', params->>'mgmt_fee') IS NOT NULL
               AND COALESCE(params->'event'->>'perf_fee', params->>'perf_fee') IS NOT NULL
               AND COALESCE(params->'event'->>'oet_alloc', params->>'oet_alloc') IS NOT NULL
             ORDER BY block_number ASC, log_index ASC",
        )
        .bind(chain_id)
        .bind(contract_address)
        .bind(loan_id)
        .bind(max_block)
        .fetch_all(conn)
        .await?;
        Ok(rows)
    }

    /// Paired with `list_recorded_payments` to drop reversed repayments (#1434 D3).
    pub async fn list_unrecorded_repayment_ids(
        &self,
        conn: &mut sqlx::PgConnection,
        chain_id: i64,
        contract_address: &str,
        loan_id: &BigDecimal,
        max_block: i64,
    ) -> anyhow::Result<Vec<String>> {
        let ids = sqlx::query_scalar::<_, String>(
            "SELECT COALESCE(params->'event'->>'repayment_id', params->>'repayment_id')
             FROM contract_logs
             WHERE chain_id = $1
               AND contract_address = $2
               AND event_name = 'PaymentUnrecorded'
               AND (params->>'loan_id')::numeric = $3
               AND block_number <= $4
               AND COALESCE(params->'event'->>'repayment_id', params->>'repayment_id') IS NOT NULL",
        )
        .bind(chain_id)
        .bind(contract_address)
        .bind(loan_id)
        .bind(max_block)
        .fetch_all(conn)
        .await?;
        Ok(ids)
    }

    pub async fn list_deal_registrations(
        &self,
        chain_id: i64,
    ) -> anyhow::Result<Vec<DealRegistrationRow>> {
        let rows = sqlx::query_as::<_, DealRegistrationRow>(
            "SELECT params->>'loan_id' AS loan_id, params->>'debt' AS debt, params->>'cargo' AS cargo
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name = 'DealRegistered'
               AND params->>'loan_id' IS NOT NULL
               AND params->>'debt' IS NOT NULL
               AND params->>'cargo' IS NOT NULL
             ORDER BY block_number ASC, log_index ASC",
        )
        .bind(chain_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}
