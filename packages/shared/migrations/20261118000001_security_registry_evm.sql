-- Migration: EVM SecurityRegistry fields on the SecurityRegistry projection tables (#1938).
-- Spec: docs/references/security-registry-events.md#projection-tables.
-- Additive and nullable: Stellar rows keep NULL in every new column.
--
-- Rollback:
-- ALTER TABLE security_loan_valuations DROP COLUMN default_breach_at;
-- ALTER TABLE security_margin_call_events DROP COLUMN default_ratio_bps;
-- ALTER TABLE security_terms DROP COLUMN default_breach_at, DROP COLUMN originator_fee_rate,
--   DROP COLUMN default_ratio_bps;

ALTER TABLE security_terms
    ADD COLUMN IF NOT EXISTS default_ratio_bps   BIGINT  NULL,
    ADD COLUMN IF NOT EXISTS originator_fee_rate BIGINT  NULL,
    ADD COLUMN IF NOT EXISTS default_breach_at   NUMERIC NULL;

ALTER TABLE security_margin_call_events
    ADD COLUMN IF NOT EXISTS default_ratio_bps BIGINT NULL;

ALTER TABLE security_loan_valuations
    ADD COLUMN IF NOT EXISTS default_breach_at NUMERIC NULL;
