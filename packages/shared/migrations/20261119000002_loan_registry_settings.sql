-- spec: docs/references/backend.md#loanregistry-settings-sync
--
-- Rollback:
--   DROP TABLE loan_registry_settings;
--   DELETE FROM _sqlx_migrations WHERE version = 20261119000002;

CREATE TABLE IF NOT EXISTS loan_registry_settings (
    chain_id         BIGINT      NOT NULL,
    contract_address TEXT        NOT NULL,
    max_fee_bps      BIGINT      NOT NULL CHECK (max_fee_bps BETWEEN 0 AND 4294967295),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address)
);
