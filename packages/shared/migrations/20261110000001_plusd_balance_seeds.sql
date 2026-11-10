-- Migration: on-chain PLUSD balance reads of Stellar holders, anchoring the plusd_balance fold (#1878).
-- Spec: docs/references/backend.md#plusd-balance-seed.
--
-- Rollback:
-- DROP TABLE plusd_balance_seeds;

CREATE TABLE IF NOT EXISTS plusd_balance_seeds (
    chain_id        BIGINT      NOT NULL,
    token_address   TEXT        NOT NULL,
    holder          TEXT        NOT NULL,
    as_of_ledger    BIGINT      NOT NULL,
    as_of_timestamp BIGINT      NOT NULL,
    balance         NUMERIC     NOT NULL CHECK (balance >= 0),
    kind            TEXT        NOT NULL CHECK (kind IN ('initial', 'reanchor')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, token_address, holder, as_of_ledger)
);
