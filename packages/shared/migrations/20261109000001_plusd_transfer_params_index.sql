-- Migration: partial GIN index for the PLUSD holder lookup on PlusdTransfer rows (#1865).
-- Spec: docs/product-specs/lp-total-balance.md.
--
-- Rollback:
-- DROP INDEX IF EXISTS idx_contract_logs_plusd_transfer_params;

CREATE INDEX IF NOT EXISTS idx_contract_logs_plusd_transfer_params
    ON contract_logs USING GIN (params jsonb_path_ops)
    WHERE event_name = 'PlusdTransfer';
