-- Migration: system-wide bank details and per-request LP payment references (#1815, settles #1311/#1700).
-- Spec: docs/product-specs/deposits.md#lp-funding-details.
--
-- system_configuration holds one system-wide record per type; system_bank_details is the trust account's
-- receiving bank details, seeded empty and set by hand. A key test on JSONB must use IS NOT DISTINCT FROM,
-- because jsonb_typeof of a missing key is NULL and a CHECK passes on NULL.
--
-- lp_requested_bank_details is a history table: every GET /v1/lps/me/payment-details inserts a new row, nothing
-- is reused or updated, lp_id is not unique. payment_details is PL-XXXX-XXXX-XXXX (Crockford base32, 60 random
-- bits) and is NOT lp_bank_deposits.payment_reference, the bank's per-wire reference.
--
-- Rollback:
-- DROP TABLE lp_requested_bank_details;
-- DROP TABLE system_configuration;

CREATE TABLE system_configuration (
    type  TEXT  PRIMARY KEY
                CONSTRAINT system_configuration_type_ck CHECK (type IN ('system_bank_details')),
    value JSONB NOT NULL,
    CONSTRAINT system_configuration_bank_details_shape_ck CHECK (
        type <> 'system_bank_details' OR (
            jsonb_typeof(value) = 'object'
            AND jsonb_typeof(value->'company_name')   IS NOT DISTINCT FROM 'string'
            AND jsonb_typeof(value->'bank_name')      IS NOT DISTINCT FROM 'string'
            AND jsonb_typeof(value->'bank_address')   IS NOT DISTINCT FROM 'string'
            AND jsonb_typeof(value->'account_number') IS NOT DISTINCT FROM 'string'
            AND jsonb_typeof(value->'iban')           IS NOT DISTINCT FROM 'string'
            AND jsonb_typeof(value->'swift_bic_code') IS NOT DISTINCT FROM 'string'
        )
    )
);

INSERT INTO system_configuration (type, value) VALUES (
    'system_bank_details',
    '{"company_name": "", "bank_name": "", "bank_address": "", "account_number": "", "iban": "", "swift_bic_code": ""}'
);

CREATE TABLE lp_requested_bank_details (
    id              BIGSERIAL    PRIMARY KEY,
    lp_id           BIGINT       NOT NULL REFERENCES lps(id),
    payment_details VARCHAR(140) NOT NULL
                    CONSTRAINT lp_requested_bank_details_payment_details_key UNIQUE
                    CONSTRAINT lp_requested_bank_details_payment_details_ck
                        CHECK (payment_details ~ '^[A-Z0-9-]{1,140}$'),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_lp_requested_bank_details_lp_id_created_at
    ON lp_requested_bank_details (lp_id, created_at DESC);
