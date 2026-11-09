// spec: docs/references/security-registry-events.md#projection-tables
use std::collections::HashMap;

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;

use crate::security_registry::{
    ConsentRow, ContractView, DocRow, InspectionRow, InspectionView, LoanProjection, LoanView,
    LotRow, MarginCallEventRow, RecordEventLedgers, RecordRow, RecordView, RegistryStateRow,
    SecurityEventRow, Snapshot, TermsRow, ValuationRow,
};

pub const LIST_LOAN_EVENTS_SQL: &str = "SELECT id, event_name, block_number, log_index,
            block_timestamp, tx_hash, params
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND event_name = ANY($3)
       AND params->>'loan_id' = $4
     ORDER BY block_number, log_index";

pub const LIST_CONTRACT_EVENTS_SQL: &str = "SELECT id, event_name, block_number, log_index,
            block_timestamp, tx_hash, params
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND event_name = ANY($3)
     ORDER BY block_number, log_index";

pub const MAX_LOG_ID_SQL: &str = "SELECT COALESCE(MAX(id), 0)
     FROM contract_logs
     WHERE chain_id = $1 AND contract_address = $2";

pub const GET_PROJECTION_STATE_SQL: &str =
    "SELECT projection_version, projected_log_id, projected_snapshot_at
     FROM security_registry_state
     WHERE chain_id = $1 AND contract_address = $2";

pub const MAX_SNAPSHOT_FETCHED_AT_SQL: &str = "SELECT MAX(fetched_at)
     FROM security_view_snapshots
     WHERE chain_id = $1 AND contract_address = $2";

pub const LIST_DIRTY_LOANS_SQL: &str = "SELECT (params->>'loan_id')::bigint AS loan_id
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND id > $3
       AND event_name = ANY($5)
       AND params->>'loan_id' IS NOT NULL
     UNION
     SELECT loan_id
     FROM security_view_snapshots
     WHERE chain_id = $1
       AND contract_address = $2
       AND loan_id IS NOT NULL
       AND ($4::timestamptz IS NULL OR fetched_at > $4)
     ORDER BY loan_id";

pub const LIST_ALL_LOANS_SQL: &str = "SELECT (params->>'loan_id')::bigint AS loan_id
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND event_name = ANY($3)
       AND params->>'loan_id' IS NOT NULL
     UNION
     SELECT loan_id
     FROM security_view_snapshots
     WHERE chain_id = $1
       AND contract_address = $2
       AND loan_id IS NOT NULL
     ORDER BY loan_id";

pub const LIST_SNAPSHOTS_FOR_LOAN_SQL: &str = "SELECT kind, entity_id, as_of_ledger, payload
     FROM security_view_snapshots
     WHERE chain_id = $1
       AND contract_address = $2
       AND loan_id = $3
       AND kind <> 'contract'";

pub const GET_CONTRACT_SNAPSHOT_SQL: &str = "SELECT as_of_ledger, payload
     FROM security_view_snapshots
     WHERE chain_id = $1
       AND contract_address = $2
       AND kind = 'contract'
       AND entity_id = 0";

pub const UPSERT_SNAPSHOT_SQL: &str = "INSERT INTO security_view_snapshots
         (chain_id, contract_address, kind, entity_id, loan_id, as_of_ledger, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (chain_id, contract_address, kind, entity_id) DO UPDATE
        SET loan_id = EXCLUDED.loan_id,
            as_of_ledger = EXCLUDED.as_of_ledger,
            payload = EXCLUDED.payload,
            fetched_at = now()
        WHERE EXCLUDED.as_of_ledger > security_view_snapshots.as_of_ledger";

pub const LIST_SNAPSHOT_LEDGERS_SQL: &str = "SELECT kind, entity_id, as_of_ledger
     FROM security_view_snapshots
     WHERE chain_id = $1 AND contract_address = $2";

pub const LIST_RECORD_EVENT_LEDGERS_SQL: &str = "SELECT rid,
            MAX(block_number) FILTER (WHERE event_name = ANY($4)) AS opaque_ledger,
            COALESCE(BOOL_OR(event_name = 'SecurityRecordRegistered'), false) AS registered
     FROM (
         SELECT (params->>'record_id')::bigint AS rid, event_name, block_number
         FROM contract_logs
         WHERE chain_id = $1
           AND contract_address = $2
           AND event_name = ANY($3)
           AND params->>'record_id' IS NOT NULL
         UNION ALL
         SELECT (params->>'to_record_id')::bigint, event_name, block_number
         FROM contract_logs
         WHERE chain_id = $1
           AND contract_address = $2
           AND event_name = 'SecurityRecordHandedOver'
           AND params->>'to_record_id' IS NOT NULL
     ) t
     GROUP BY rid
     ORDER BY rid";

pub const LIST_INSPECTION_IDS_SQL: &str =
    "SELECT DISTINCT (params->>'inspection_id')::bigint AS inspection_id
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND event_name = 'SecurityInspectionRecorded'
       AND params->>'inspection_id' IS NOT NULL
     ORDER BY inspection_id";

pub const LIST_KNOWN_LOANS_SQL: &str = "SELECT loan_id FROM (
         SELECT (params->>'loan_id')::bigint AS loan_id
         FROM contract_logs
         WHERE chain_id = $1
           AND contract_address = $2
           AND event_name = ANY($4)
           AND params->>'loan_id' IS NOT NULL
         UNION
         SELECT loan_id
         FROM security_view_snapshots
         WHERE chain_id = $1
           AND contract_address = $2
           AND loan_id IS NOT NULL
         UNION
         SELECT (params->>'loan_id')::bigint
         FROM contract_logs
         WHERE chain_id = $1
           AND contract_address = $3
           AND event_name = 'LoanDrawn'
           AND params->>'loan_id' IS NOT NULL
     ) k
     ORDER BY loan_id";

pub const LIST_LOANS_WITH_TERMS_EVENT_SQL: &str =
    "SELECT DISTINCT (params->>'loan_id')::bigint AS loan_id
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND event_name = 'SecurityTermsSet'
       AND params->>'loan_id' IS NOT NULL
     ORDER BY loan_id";

pub const LIST_RECORD_LOANS_SQL: &str = "SELECT (params->>'record_id')::bigint AS record_id,
            (params->>'loan_id')::bigint AS loan_id
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND event_name = 'SecurityRecordRegistered'
       AND params->>'record_id' IS NOT NULL
       AND params->>'loan_id' IS NOT NULL
     UNION
     SELECT entity_id, loan_id
     FROM security_view_snapshots
     WHERE chain_id = $1
       AND contract_address = $2
       AND kind = 'record'
       AND loan_id IS NOT NULL";

pub const DELETE_LOAN_RECORDS_SQL: &str =
    "DELETE FROM security_records WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3";
pub const DELETE_LOAN_DOCS_SQL: &str =
    "DELETE FROM security_record_docs WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3";
pub const DELETE_LOAN_TERMS_SQL: &str =
    "DELETE FROM security_terms WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3";
pub const DELETE_LOAN_MARGIN_EVENTS_SQL: &str = "DELETE FROM security_margin_call_events
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3";
pub const DELETE_LOAN_INSPECTIONS_SQL: &str = "DELETE FROM security_inspections
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3";
pub const DELETE_LOAN_LOTS_SQL: &str =
    "DELETE FROM security_lots WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3";
pub const DELETE_LOAN_CONSENTS_SQL: &str = "DELETE FROM security_extension_consents
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3";

pub const INSERT_TERMS_SQL: &str = "INSERT INTO security_terms
         (chain_id, contract_address, loan_id, advance_ratio_bps, margin_call_ratio_bps,
          cure_period, price_stale_after, payment_term, grace_period, default_rate,
          attestation_interval, inspection_interval, tolerance_bps, grade_tolerance_bps,
          margin_call_at, set_ledger, complete)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)";

pub const INSERT_RECORD_SQL: &str = "INSERT INTO security_records
         (chain_id, contract_address, record_id, loan_id, lot_id, protection, commodity, unit,
          reference_quantity, reference_grade, region, site_hash, control_kind,
          control_reference, perfection, release_condition, status, perfected_at,
          attested_by, attested_at, flagged_by, mark_value_per_unit, mark_at, mark_benchmark,
          mark_report_hash, registered_ledger, closed_ledger, release_reason_hash,
          released_by_consent, complete, needs_view, view_ledger)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)";

pub const INSERT_DOC_SQL: &str = "INSERT INTO security_record_docs
         (chain_id, contract_address, record_id, position, loan_id, kind, sha256, source, ledger)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)";

pub const INSERT_MARGIN_EVENT_SQL: &str = "INSERT INTO security_margin_call_events
         (chain_id, contract_address, block_number, log_index, loan_id, kind, ltv_bps,
          margin_call_ratio_bps, cure_by, block_timestamp, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)";

pub const INSERT_INSPECTION_SQL: &str = "INSERT INTO security_inspections
         (chain_id, contract_address, inspection_id, loan_id, record_id, lot_id, inspector, kind,
          inspected_at, region, site_hash, quantity, grade, certificate_hash, certificate_no,
          entered_by, entered_at, approved_by, approved_at, variance_reference_bps,
          variance_previous_bps, variance_grade_bps, flagged, resolution,
          resolution_reason_hash, resolved_at, recorded_ledger, approved_ledger, complete,
          needs_view)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)";

pub const INSERT_LOT_SQL: &str = "INSERT INTO security_lots
         (chain_id, contract_address, lot_id, loan_id, latest_inspection_id,
          latest_inspected_at, latest_quantity, complete)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)";

pub const INSERT_CONSENT_SQL: &str = "INSERT INTO security_extension_consents
         (chain_id, contract_address, loan_id, position, consent_hash, new_maturity, ledger,
          block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)";

pub const UPSERT_REGISTRY_STATE_SQL: &str = "INSERT INTO security_registry_state
         (chain_id, contract_address, paused, inspectors, loan_registry, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (chain_id, contract_address) DO UPDATE
        SET paused = EXCLUDED.paused,
            inspectors = EXCLUDED.inspectors,
            loan_registry = EXCLUDED.loan_registry,
            updated_at = now()";

pub const UPDATE_PROJECTION_WATERMARK_SQL: &str = "INSERT INTO security_registry_state
         (chain_id, contract_address, projection_version, projected_log_id,
          projected_snapshot_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (chain_id, contract_address) DO UPDATE
        SET projection_version = EXCLUDED.projection_version,
            projected_log_id = EXCLUDED.projected_log_id,
            projected_snapshot_at = EXCLUDED.projected_snapshot_at,
            updated_at = now()";

pub const LIST_VALUATION_CANDIDATES_SQL: &str = "SELECT t.loan_id,
            v.source_log_id,
            v.fetched_at,
            v.debt,
            COALESCE(l.latest_log_id, 0) AS latest_log_id
     FROM security_terms t
     LEFT JOIN security_loan_valuations v
       ON v.chain_id = t.chain_id
      AND v.contract_address = t.contract_address
      AND v.loan_id = t.loan_id
     LEFT JOIN (
         SELECT params->>'loan_id' AS loan_key, MAX(id) AS latest_log_id
         FROM contract_logs
         WHERE chain_id = $1
           AND contract_address = ANY($3)
           AND params->>'loan_id' IS NOT NULL
         GROUP BY params->>'loan_id'
     ) l ON l.loan_key = t.loan_id::text
     WHERE t.chain_id = $1
       AND t.contract_address = $2
     ORDER BY t.loan_id";

pub const UPSERT_VALUATION_SQL: &str = "INSERT INTO security_loan_valuations
         (chain_id, contract_address, loan_id, value, stale_value, flagged_value, debt,
          coverage_bps, ltv_bps, margin_call_at, cure_by, price_stale, counted_records,
          detail_ledger, loan_registry, outstanding, accrued_interest, money_ledger,
          source_log_id, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, now())
     ON CONFLICT (chain_id, contract_address, loan_id) DO UPDATE
        SET value = EXCLUDED.value,
            stale_value = EXCLUDED.stale_value,
            flagged_value = EXCLUDED.flagged_value,
            debt = EXCLUDED.debt,
            coverage_bps = EXCLUDED.coverage_bps,
            ltv_bps = EXCLUDED.ltv_bps,
            margin_call_at = EXCLUDED.margin_call_at,
            cure_by = EXCLUDED.cure_by,
            price_stale = EXCLUDED.price_stale,
            counted_records = EXCLUDED.counted_records,
            detail_ledger = EXCLUDED.detail_ledger,
            loan_registry = EXCLUDED.loan_registry,
            outstanding = EXCLUDED.outstanding,
            accrued_interest = EXCLUDED.accrued_interest,
            money_ledger = EXCLUDED.money_ledger,
            source_log_id = EXCLUDED.source_log_id,
            fetched_at = now()";

pub const SECURITY_READ_TX_SQL: &str = "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY";

pub const GET_TERMS_SQL: &str = "SELECT loan_id, advance_ratio_bps, margin_call_ratio_bps,
            cure_period, price_stale_after, payment_term, grace_period, default_rate,
            attestation_interval, inspection_interval, tolerance_bps, grade_tolerance_bps,
            margin_call_at, set_ledger, complete
     FROM security_terms
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3";

pub const LIST_OPEN_MARGIN_CALL_LOANS_SQL: &str = "SELECT loan_id
     FROM security_terms
     WHERE chain_id = $1 AND contract_address = $2 AND margin_call_at <> 0
     ORDER BY loan_id";

pub const LIST_RECORDS_FOR_LOAN_SQL: &str = "SELECT record_id, loan_id, lot_id, protection,
            commodity, unit, reference_quantity, reference_grade, region, site_hash,
            control_kind, control_reference, perfection, release_condition, status,
            perfected_at, attested_by, attested_at, flagged_by, mark_value_per_unit, mark_at,
            mark_benchmark, mark_report_hash, registered_ledger, closed_ledger,
            release_reason_hash, released_by_consent, complete, needs_view, view_ledger
     FROM security_records
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3
     ORDER BY record_id";

pub const LIST_DOCS_FOR_LOAN_SQL: &str = "SELECT record_id, position, loan_id, kind, sha256,
            source, ledger
     FROM security_record_docs
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3
     ORDER BY record_id, position";

pub const LIST_INSPECTIONS_FOR_LOAN_SQL: &str = "SELECT inspection_id, loan_id, record_id, lot_id,
            inspector, kind, inspected_at, region, site_hash, quantity, grade,
            certificate_hash, certificate_no, entered_by, entered_at, approved_by, approved_at,
            variance_reference_bps, variance_previous_bps, variance_grade_bps, flagged,
            resolution, resolution_reason_hash, resolved_at, recorded_ledger, approved_ledger,
            complete, needs_view
     FROM security_inspections
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3
     ORDER BY record_id, inspection_id";

pub const LIST_LOTS_FOR_LOAN_SQL: &str = "SELECT lot_id, loan_id, latest_inspection_id,
            latest_inspected_at, latest_quantity, complete
     FROM security_lots
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3
     ORDER BY lot_id";

pub const LIST_MARGIN_EVENTS_FOR_LOAN_SQL: &str = "SELECT block_number,
            log_index::bigint AS log_index, loan_id, kind, ltv_bps, margin_call_ratio_bps,
            cure_by, block_timestamp, tx_hash
     FROM security_margin_call_events
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3
     ORDER BY block_number, log_index";

pub const LIST_CONSENTS_FOR_LOAN_SQL: &str = "SELECT loan_id, position, consent_hash,
            new_maturity, ledger, block_timestamp
     FROM security_extension_consents
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3
     ORDER BY position";

pub const GET_REGISTRY_STATE_SQL: &str = "SELECT paused, inspectors, loan_registry,
            projected_log_id
     FROM security_registry_state
     WHERE chain_id = $1 AND contract_address = $2";

pub const GET_VALUATION_SQL: &str = "SELECT loan_id, value, stale_value, flagged_value, debt,
            coverage_bps, ltv_bps, margin_call_at, cure_by, price_stale, counted_records,
            detail_ledger, loan_registry, outstanding, accrued_interest, money_ledger,
            source_log_id, fetched_at
     FROM security_loan_valuations
     WHERE chain_id = $1 AND contract_address = $2 AND loan_id = $3";

pub const LOAN_LOG_WATERMARKS_SQL: &str = "SELECT
            COALESCE(MAX(id) FILTER (WHERE contract_address = $2), 0) AS sr_log_id,
            COALESCE(MAX(id), 0) AS valuation_log_id
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = ANY($4)
       AND params @> jsonb_build_object('loan_id', $3::text)";

pub const LIST_SALE_REPAYMENTS_SQL: &str = "SELECT r.params, r.tx_hash, r.block_timestamp,
            rev.block_timestamp AS reversed_at
     FROM contract_logs r
     LEFT JOIN LATERAL (
         SELECT v.block_timestamp
         FROM contract_logs v
         WHERE v.chain_id = r.chain_id
           AND v.contract_address = r.contract_address
           AND v.event_name = 'CashRepaymentReversed'
           AND v.params->>'loan_id' = r.params->>'loan_id'
           AND v.params->>'repayment_id' = r.params->>'repayment_id'
         ORDER BY v.block_number, v.log_index
         LIMIT 1
     ) rev ON TRUE
     WHERE r.chain_id = $1
       AND r.event_name = 'CashRepaid'
       AND (r.params @> jsonb_build_object('loan_id', $2::text)
            OR r.params @> jsonb_build_object('loan_id', $2::bigint))
       AND r.params->>'sale_id' = ANY($3)
       AND EXISTS (
           SELECT 1
           FROM contract_logs e
           WHERE e.chain_id = r.chain_id
             AND e.contract_address = $4
             AND e.event_name IN ('SecurityEnforcementStarted', 'SecurityRecordEnforced')
             AND e.params @> jsonb_build_object('loan_id', $2::text,
                                                'record_id', r.params->>'sale_id')
             AND (e.block_number, e.log_index) <= (r.block_number, r.log_index)
       )
     ORDER BY r.block_number, r.log_index";

pub type ValuationTuple = (
    i64,
    Option<i64>,
    Option<DateTime<Utc>>,
    Option<BigDecimal>,
    i64,
);

pub type EventTuple = (i64, String, i64, i32, i64, String, Value);

pub fn event_row(t: EventTuple) -> SecurityEventRow {
    SecurityEventRow {
        id: t.0,
        event_name: t.1,
        block_number: t.2,
        log_index: i64::from(t.3),
        block_timestamp: t.4,
        tx_hash: t.5,
        params: t.6,
    }
}

#[derive(Debug, Clone, Default)]
pub struct LoanSnapshots {
    pub records: HashMap<u32, Snapshot<RecordView>>,
    pub inspections: HashMap<u32, Snapshot<InspectionView>>,
    pub loan: Option<Snapshot<LoanView>>,
}

#[derive(Debug, Clone, Default)]
pub struct SnapshotLedgers {
    pub records: HashMap<u32, i64>,
    pub inspections: HashMap<u32, i64>,
    pub loans: HashMap<u32, i64>,
    pub contract: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ValuationCandidate {
    pub loan_id: u32,
    pub source_log_id: Option<i64>,
    pub fetched_at: Option<DateTime<Utc>>,
    pub debt: Option<BigDecimal>,
    pub latest_log_id: i64,
}

fn to_u32(v: i64) -> Option<u32> {
    u32::try_from(v).ok()
}

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct SaleRepaymentRow {
    pub params: Value,
    pub tx_hash: String,
    pub block_timestamp: i64,
    pub reversed_at: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct LoanSecurityRows {
    pub loan_status: Option<String>,
    pub terms: Option<TermsRow>,
    pub records: Vec<RecordRow>,
    pub docs: Vec<DocRow>,
    pub inspections: Vec<InspectionRow>,
    pub lots: Vec<LotRow>,
    pub margin_events: Vec<MarginCallEventRow>,
    pub consents: Vec<ConsentRow>,
    pub registry: Option<(RegistryStateRow, i64)>,
    pub valuation: Option<(ValuationRow, DateTime<Utc>)>,
    pub sr_log_id: i64,
    pub valuation_log_id: i64,
    pub repayments: Vec<SaleRepaymentRow>,
}

#[derive(sqlx::FromRow)]
struct RegistryStateWithWatermark {
    #[sqlx(flatten)]
    state: RegistryStateRow,
    projected_log_id: i64,
}

#[derive(sqlx::FromRow)]
struct ValuationWithFetchedAt {
    #[sqlx(flatten)]
    valuation: ValuationRow,
    fetched_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct SecurityRegistryRepo {
    pub pool: PgPool,
}

impl SecurityRegistryRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_loan_events(
        &self,
        chain_id: i64,
        contract: &str,
        loan_id: u32,
    ) -> anyhow::Result<Vec<SecurityEventRow>> {
        let rows: Vec<EventTuple> = sqlx::query_as(LIST_LOAN_EVENTS_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(names(&crate::security_registry::SECURITY_LOAN_EVENT_NAMES))
            .bind(loan_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(event_row).collect())
    }

    pub async fn list_contract_events(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<Vec<SecurityEventRow>> {
        let rows: Vec<EventTuple> = sqlx::query_as(LIST_CONTRACT_EVENTS_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(names(
                &crate::security_registry::SECURITY_CONTRACT_EVENT_NAMES,
            ))
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(event_row).collect())
    }

    pub async fn max_log_id(&self, chain_id: i64, contract: &str) -> anyhow::Result<i64> {
        let (id,): (i64,) = sqlx::query_as(MAX_LOG_ID_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_one(&self.pool)
            .await?;
        Ok(id)
    }

    pub async fn get_projection_state(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<Option<(i32, i64, Option<DateTime<Utc>>)>> {
        let row = sqlx::query_as(GET_PROJECTION_STATE_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row)
    }

    pub async fn max_snapshot_fetched_at(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<Option<DateTime<Utc>>> {
        let (at,): (Option<DateTime<Utc>>,) = sqlx::query_as(MAX_SNAPSHOT_FETCHED_AT_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_one(&self.pool)
            .await?;
        Ok(at)
    }

    pub async fn list_dirty_loans(
        &self,
        chain_id: i64,
        contract: &str,
        after_log_id: i64,
        snapshot_at: Option<DateTime<Utc>>,
    ) -> anyhow::Result<Vec<u32>> {
        let rows: Vec<(i64,)> = sqlx::query_as(LIST_DIRTY_LOANS_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(after_log_id)
            .bind(snapshot_at)
            .bind(names(&crate::security_registry::SECURITY_LOAN_EVENT_NAMES))
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().filter_map(|(l,)| to_u32(l)).collect())
    }

    pub async fn list_all_loans(&self, chain_id: i64, contract: &str) -> anyhow::Result<Vec<u32>> {
        let rows: Vec<(i64,)> = sqlx::query_as(LIST_ALL_LOANS_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(names(&crate::security_registry::SECURITY_LOAN_EVENT_NAMES))
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().filter_map(|(l,)| to_u32(l)).collect())
    }

    pub async fn list_loan_snapshots(
        &self,
        chain_id: i64,
        contract: &str,
        loan_id: u32,
    ) -> anyhow::Result<LoanSnapshots> {
        let rows: Vec<(String, i64, i64, Value)> = sqlx::query_as(LIST_SNAPSHOTS_FOR_LOAN_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(i64::from(loan_id))
            .fetch_all(&self.pool)
            .await?;
        let mut out = LoanSnapshots::default();
        for (kind, entity_id, as_of_ledger, payload) in rows {
            let Some(id) = to_u32(entity_id) else {
                continue;
            };
            let parsed = match kind.as_str() {
                "record" => serde_json::from_value(payload)
                    .map(|view| {
                        out.records.insert(id, Snapshot { as_of_ledger, view });
                    })
                    .map_err(|e| e.to_string()),
                "inspection" => serde_json::from_value(payload)
                    .map(|view| {
                        out.inspections.insert(id, Snapshot { as_of_ledger, view });
                    })
                    .map_err(|e| e.to_string()),
                "loan" => serde_json::from_value(payload)
                    .map(|view| out.loan = Some(Snapshot { as_of_ledger, view }))
                    .map_err(|e| e.to_string()),
                _ => Ok(()),
            };
            if let Err(e) = parsed {
                tracing::warn!(kind, entity_id, error = %e, "security snapshot payload unreadable; ignored");
            }
        }
        Ok(out)
    }

    pub async fn get_contract_snapshot(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<Option<Snapshot<ContractView>>> {
        let row: Option<(i64, Value)> = sqlx::query_as(GET_CONTRACT_SNAPSHOT_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.and_then(|(as_of_ledger, payload)| {
            serde_json::from_value(payload)
                .ok()
                .map(|view| Snapshot { as_of_ledger, view })
        }))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn upsert_snapshot(
        &self,
        chain_id: i64,
        contract: &str,
        kind: &str,
        entity_id: i64,
        loan_id: Option<i64>,
        as_of_ledger: i64,
        payload: &Value,
    ) -> anyhow::Result<bool> {
        let result = sqlx::query(UPSERT_SNAPSHOT_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(kind)
            .bind(entity_id)
            .bind(loan_id)
            .bind(as_of_ledger)
            .bind(payload)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_snapshot_ledgers(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<SnapshotLedgers> {
        let rows: Vec<(String, i64, i64)> = sqlx::query_as(LIST_SNAPSHOT_LEDGERS_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_all(&self.pool)
            .await?;
        let mut out = SnapshotLedgers::default();
        for (kind, entity_id, ledger) in rows {
            match (kind.as_str(), to_u32(entity_id)) {
                ("record", Some(id)) => {
                    out.records.insert(id, ledger);
                }
                ("inspection", Some(id)) => {
                    out.inspections.insert(id, ledger);
                }
                ("loan", Some(id)) => {
                    out.loans.insert(id, ledger);
                }
                ("contract", _) => out.contract = Some(ledger),
                _ => {}
            }
        }
        Ok(out)
    }

    pub async fn list_record_event_ledgers(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<Vec<RecordEventLedgers>> {
        let rows: Vec<(i64, Option<i64>, bool)> = sqlx::query_as(LIST_RECORD_EVENT_LEDGERS_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(names(
                &crate::security_registry::SECURITY_RECORD_EVENT_NAMES,
            ))
            .bind(names(
                &crate::security_registry::SECURITY_OPAQUE_RECORD_EVENT_NAMES,
            ))
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .filter_map(|(id, opaque_ledger, registered)| {
                to_u32(id).map(|record_id| RecordEventLedgers {
                    record_id,
                    opaque_ledger,
                    registered,
                })
            })
            .collect())
    }

    pub async fn list_inspection_ids(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<Vec<u32>> {
        let rows: Vec<(i64,)> = sqlx::query_as(LIST_INSPECTION_IDS_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().filter_map(|(i,)| to_u32(i)).collect())
    }

    pub async fn list_known_loans(
        &self,
        chain_id: i64,
        contract: &str,
        loan_registry: Option<&str>,
    ) -> anyhow::Result<Vec<u32>> {
        let rows: Vec<(i64,)> = sqlx::query_as(LIST_KNOWN_LOANS_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(loan_registry)
            .bind(names(&crate::security_registry::SECURITY_LOAN_EVENT_NAMES))
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().filter_map(|(l,)| to_u32(l)).collect())
    }

    pub async fn list_loans_with_terms_event(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<Vec<u32>> {
        let rows: Vec<(i64,)> = sqlx::query_as(LIST_LOANS_WITH_TERMS_EVENT_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().filter_map(|(l,)| to_u32(l)).collect())
    }

    pub async fn list_open_margin_call_loans(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<Vec<i64>> {
        let rows: Vec<(i64,)> = sqlx::query_as(LIST_OPEN_MARGIN_CALL_LOANS_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(|(l,)| l).collect())
    }

    pub async fn list_record_loans(
        &self,
        chain_id: i64,
        contract: &str,
    ) -> anyhow::Result<HashMap<u32, i64>> {
        let rows: Vec<(i64, i64)> = sqlx::query_as(LIST_RECORD_LOANS_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .filter_map(|(r, l)| to_u32(r).map(|r| (r, l)))
            .collect())
    }

    pub async fn replace_loan_projection(
        &self,
        chain_id: i64,
        contract: &str,
        loan_id: u32,
        p: &LoanProjection,
    ) -> anyhow::Result<()> {
        let loan = i64::from(loan_id);
        let mut tx = self.pool.begin().await?;
        for sql in [
            DELETE_LOAN_RECORDS_SQL,
            DELETE_LOAN_DOCS_SQL,
            DELETE_LOAN_TERMS_SQL,
            DELETE_LOAN_MARGIN_EVENTS_SQL,
            DELETE_LOAN_INSPECTIONS_SQL,
            DELETE_LOAN_LOTS_SQL,
            DELETE_LOAN_CONSENTS_SQL,
        ] {
            sqlx::query(sql)
                .bind(chain_id)
                .bind(contract)
                .bind(loan)
                .execute(&mut *tx)
                .await?;
        }
        if let Some(t) = &p.terms {
            sqlx::query(INSERT_TERMS_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(t.loan_id)
                .bind(t.advance_ratio_bps)
                .bind(t.margin_call_ratio_bps)
                .bind(&t.cure_period)
                .bind(&t.price_stale_after)
                .bind(&t.payment_term)
                .bind(&t.grace_period)
                .bind(t.default_rate)
                .bind(&t.attestation_interval)
                .bind(&t.inspection_interval)
                .bind(t.tolerance_bps)
                .bind(t.grade_tolerance_bps)
                .bind(&t.margin_call_at)
                .bind(t.set_ledger)
                .bind(t.complete)
                .execute(&mut *tx)
                .await?;
        }
        for r in &p.records {
            sqlx::query(INSERT_RECORD_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(r.record_id)
                .bind(r.loan_id)
                .bind(r.lot_id)
                .bind(&r.protection)
                .bind(&r.commodity)
                .bind(&r.unit)
                .bind(&r.reference_quantity)
                .bind(&r.reference_grade)
                .bind(&r.region)
                .bind(&r.site_hash)
                .bind(&r.control_kind)
                .bind(&r.control_reference)
                .bind(&r.perfection)
                .bind(&r.release_condition)
                .bind(&r.status)
                .bind(&r.perfected_at)
                .bind(&r.attested_by)
                .bind(&r.attested_at)
                .bind(r.flagged_by)
                .bind(&r.mark_value_per_unit)
                .bind(&r.mark_at)
                .bind(&r.mark_benchmark)
                .bind(&r.mark_report_hash)
                .bind(r.registered_ledger)
                .bind(r.closed_ledger)
                .bind(&r.release_reason_hash)
                .bind(r.released_by_consent)
                .bind(r.complete)
                .bind(r.needs_view)
                .bind(r.view_ledger)
                .execute(&mut *tx)
                .await?;
        }
        for d in &p.docs {
            sqlx::query(INSERT_DOC_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(d.record_id)
                .bind(d.position)
                .bind(d.loan_id)
                .bind(&d.kind)
                .bind(&d.sha256)
                .bind(&d.source)
                .bind(d.ledger)
                .execute(&mut *tx)
                .await?;
        }
        for m in &p.margin_events {
            sqlx::query(INSERT_MARGIN_EVENT_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(m.block_number)
                .bind(i32::try_from(m.log_index).unwrap_or(i32::MAX))
                .bind(m.loan_id)
                .bind(&m.kind)
                .bind(m.ltv_bps)
                .bind(m.margin_call_ratio_bps)
                .bind(&m.cure_by)
                .bind(m.block_timestamp)
                .bind(&m.tx_hash)
                .execute(&mut *tx)
                .await?;
        }
        for i in &p.inspections {
            sqlx::query(INSERT_INSPECTION_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(i.inspection_id)
                .bind(i.loan_id)
                .bind(i.record_id)
                .bind(i.lot_id)
                .bind(&i.inspector)
                .bind(&i.kind)
                .bind(&i.inspected_at)
                .bind(&i.region)
                .bind(&i.site_hash)
                .bind(&i.quantity)
                .bind(&i.grade)
                .bind(&i.certificate_hash)
                .bind(&i.certificate_no)
                .bind(&i.entered_by)
                .bind(&i.entered_at)
                .bind(&i.approved_by)
                .bind(&i.approved_at)
                .bind(i.variance_reference_bps)
                .bind(i.variance_previous_bps)
                .bind(i.variance_grade_bps)
                .bind(i.flagged)
                .bind(&i.resolution)
                .bind(&i.resolution_reason_hash)
                .bind(&i.resolved_at)
                .bind(i.recorded_ledger)
                .bind(i.approved_ledger)
                .bind(i.complete)
                .bind(i.needs_view)
                .execute(&mut *tx)
                .await?;
        }
        for l in &p.lots {
            sqlx::query(INSERT_LOT_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(l.lot_id)
                .bind(l.loan_id)
                .bind(l.latest_inspection_id)
                .bind(&l.latest_inspected_at)
                .bind(&l.latest_quantity)
                .bind(l.complete)
                .execute(&mut *tx)
                .await?;
        }
        for c in &p.consents {
            sqlx::query(INSERT_CONSENT_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(c.loan_id)
                .bind(c.position)
                .bind(&c.consent_hash)
                .bind(&c.new_maturity)
                .bind(c.ledger)
                .bind(c.block_timestamp)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn upsert_registry_state(
        &self,
        chain_id: i64,
        contract: &str,
        state: &RegistryStateRow,
    ) -> anyhow::Result<()> {
        sqlx::query(UPSERT_REGISTRY_STATE_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(state.paused)
            .bind(&state.inspectors)
            .bind(&state.loan_registry)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_projection_watermark(
        &self,
        chain_id: i64,
        contract: &str,
        version: i32,
        log_id: i64,
        snapshot_at: Option<DateTime<Utc>>,
    ) -> anyhow::Result<()> {
        sqlx::query(UPDATE_PROJECTION_WATERMARK_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(version)
            .bind(log_id)
            .bind(snapshot_at)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_valuation_candidates(
        &self,
        chain_id: i64,
        contract: &str,
        log_contracts: &[String],
    ) -> anyhow::Result<Vec<ValuationCandidate>> {
        let rows: Vec<ValuationTuple> = sqlx::query_as(LIST_VALUATION_CANDIDATES_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(log_contracts)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .filter_map(|(loan, source_log_id, fetched_at, debt, latest_log_id)| {
                to_u32(loan).map(|loan_id| ValuationCandidate {
                    loan_id,
                    source_log_id,
                    fetched_at,
                    debt,
                    latest_log_id,
                })
            })
            .collect())
    }

    pub async fn load_loan_security(
        &self,
        chain_id: i64,
        contract: &str,
        loan_id: u32,
        configured_loan_registry: &str,
    ) -> anyhow::Result<LoanSecurityRows> {
        let loan = i64::from(loan_id);
        let mut tx = self.pool.begin().await?;
        sqlx::query(SECURITY_READ_TX_SQL).execute(&mut *tx).await?;
        let terms = sqlx::query_as::<_, TermsRow>(GET_TERMS_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(loan)
            .fetch_optional(&mut *tx)
            .await?;
        let records = sqlx::query_as::<_, RecordRow>(LIST_RECORDS_FOR_LOAN_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(loan)
            .fetch_all(&mut *tx)
            .await?;
        let docs = sqlx::query_as::<_, DocRow>(LIST_DOCS_FOR_LOAN_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(loan)
            .fetch_all(&mut *tx)
            .await?;
        let inspections = sqlx::query_as::<_, InspectionRow>(LIST_INSPECTIONS_FOR_LOAN_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(loan)
            .fetch_all(&mut *tx)
            .await?;
        let lots = sqlx::query_as::<_, LotRow>(LIST_LOTS_FOR_LOAN_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(loan)
            .fetch_all(&mut *tx)
            .await?;
        let margin_events =
            sqlx::query_as::<_, MarginCallEventRow>(LIST_MARGIN_EVENTS_FOR_LOAN_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(loan)
                .fetch_all(&mut *tx)
                .await?;
        let consents = sqlx::query_as::<_, ConsentRow>(LIST_CONSENTS_FOR_LOAN_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(loan)
            .fetch_all(&mut *tx)
            .await?;
        let registry = sqlx::query_as::<_, RegistryStateWithWatermark>(GET_REGISTRY_STATE_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_optional(&mut *tx)
            .await?
            .map(|r| (r.state, r.projected_log_id));
        let valuation = sqlx::query_as::<_, ValuationWithFetchedAt>(GET_VALUATION_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(loan)
            .fetch_optional(&mut *tx)
            .await?
            .map(|v| (v.valuation, v.fetched_at));
        let mut log_contracts = vec![contract.to_owned()];
        if let Some((v, _)) = &valuation {
            log_contracts.push(v.loan_registry.clone());
        }
        let (sr_log_id, valuation_log_id): (i64, i64) = sqlx::query_as(LOAN_LOG_WATERMARKS_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(loan_id.to_string())
            .bind(&log_contracts)
            .fetch_one(&mut *tx)
            .await?;
        let loan_registry = valuation
            .as_ref()
            .map(|(v, _)| v.loan_registry.clone())
            .or_else(|| registry.as_ref().and_then(|(s, _)| s.loan_registry.clone()))
            .unwrap_or_else(|| configured_loan_registry.to_owned());
        if loan_registry != configured_loan_registry {
            tracing::warn!(
                projected = %loan_registry,
                configured = configured_loan_registry,
                "security projection loan registry differs from the configured one"
            );
        }
        let loan_status = crate::contract_logs_repo::ContractLogsRepo::new(self.pool.clone())
            .latest_status_by_loans(
                &mut *tx,
                chain_id,
                &loan_registry,
                &[BigDecimal::from(loan_id)],
            )
            .await?
            .into_iter()
            .next()
            .map(|(_, status)| status);
        let sale_ids: Vec<String> = records.iter().map(|r| r.record_id.to_string()).collect();
        let repayments = if sale_ids.is_empty() {
            Vec::new()
        } else {
            sqlx::query_as::<_, SaleRepaymentRow>(LIST_SALE_REPAYMENTS_SQL)
                .bind(chain_id)
                .bind(loan_id.to_string())
                .bind(&sale_ids)
                .bind(contract)
                .fetch_all(&mut *tx)
                .await?
        };
        tx.commit().await?;
        Ok(LoanSecurityRows {
            loan_status,
            terms,
            records,
            docs,
            inspections,
            lots,
            margin_events,
            consents,
            registry,
            valuation,
            sr_log_id,
            valuation_log_id,
            repayments,
        })
    }

    pub async fn upsert_valuation(
        &self,
        chain_id: i64,
        contract: &str,
        v: &ValuationRow,
    ) -> anyhow::Result<()> {
        sqlx::query(UPSERT_VALUATION_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(v.loan_id)
            .bind(&v.value)
            .bind(&v.stale_value)
            .bind(&v.flagged_value)
            .bind(&v.debt)
            .bind(v.coverage_bps)
            .bind(v.ltv_bps)
            .bind(&v.margin_call_at)
            .bind(&v.cure_by)
            .bind(v.price_stale)
            .bind(&v.counted_records)
            .bind(v.detail_ledger)
            .bind(&v.loan_registry)
            .bind(&v.outstanding)
            .bind(&v.accrued_interest)
            .bind(v.money_ledger)
            .bind(v.source_log_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
