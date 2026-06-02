-- Issue #442: per-event loan state lives in contract_logs.params (JSONB snapshot).
-- The standalone loan_details table from Issue #363 is no longer used; drop it.
-- (loan_history was never shipped; the in-progress migration is rewritten here.)
--
-- contract_logs is truncated here because the params JSONB shape changed:
-- previously rows held thin event-specific payloads (parser-emitted fields only);
-- now every loan-related row must carry { loan_id, event, snapshot } where
-- "snapshot" is the full per-event LoanSnapshot object. Pre-consolidation rows
-- lack the "snapshot" key and would cause serde errors in list_latest_loan_snapshots.
-- Operators must re-index from start_block after this migration (standard runbook).
--
-- Historical note: the on-chain LoanDrawn event was previously indexed as 'LoanMinted'.
-- The rename was corrected in the indexer; no UPDATE is needed here because the
-- TRUNCATE below removes all pre-consolidation rows.
TRUNCATE contract_logs, log_collector_state;

DROP TABLE IF EXISTS loan_details CASCADE;
DROP TABLE IF EXISTS loan_history CASCADE;
