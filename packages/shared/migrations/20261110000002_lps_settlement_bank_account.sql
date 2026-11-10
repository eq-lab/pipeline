-- Migration: LP settlement bank account for USD wire-outs (#1812).
-- Spec: docs/product-specs/kyb-lp-verification.md#settlement-bank-account.
--
-- One nullable JSONB account per LP, written inline with the KYB profile while the record is open.
-- Optional keys must be present (as JSON null): jsonb_typeof of a missing key is NULL and a CHECK passes
-- on NULL, so COALESCE(..., 'missing') is what rejects a missing key.
--
-- Rollback:
-- ALTER TABLE lps DROP CONSTRAINT lps_settlement_bank_account_shape_ck;
-- ALTER TABLE lps DROP COLUMN settlement_bank_account;
-- DELETE FROM _sqlx_migrations WHERE version = 20261110000002;

ALTER TABLE lps ADD COLUMN settlement_bank_account JSONB;

ALTER TABLE lps ADD CONSTRAINT lps_settlement_bank_account_shape_ck CHECK (
    settlement_bank_account IS NULL OR (
        jsonb_typeof(settlement_bank_account) = 'object'
        AND jsonb_typeof(settlement_bank_account->'account_holder_name') IS NOT DISTINCT FROM 'string'
        AND jsonb_typeof(settlement_bank_account->'bank_name') IS NOT DISTINCT FROM 'string'
        AND COALESCE(jsonb_typeof(settlement_bank_account->'bank_address'), 'missing') IN ('string', 'null')
        AND COALESCE(jsonb_typeof(settlement_bank_account->'account_number'), 'missing') IN ('string', 'null')
        AND COALESCE(jsonb_typeof(settlement_bank_account->'iban'), 'missing') IN ('string', 'null')
        AND COALESCE(jsonb_typeof(settlement_bank_account->'swift_bic_code'), 'missing') IN ('string', 'null')
        AND COALESCE(jsonb_typeof(settlement_bank_account->'routing_number'), 'missing') IN ('string', 'null')
        AND settlement_bank_account - ARRAY['account_holder_name','bank_name','bank_address','account_number','iban','swift_bic_code','routing_number'] = '{}'::jsonb
    )
);
