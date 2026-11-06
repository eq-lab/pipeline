-- Migration: view seed of a Stellar Pocket for defaults indexed before the pocket key was set (#1789).
-- Spec: docs/references/backend.md#stellar-pocket-indexing.
--
-- Rollback:
-- DROP TABLE pocket_seeds;

CREATE TABLE IF NOT EXISTS pocket_seeds (
    chain_id           BIGINT      NOT NULL,
    pocket_address     TEXT        NOT NULL,
    loan_id            NUMERIC     NOT NULL,
    as_of_ledger       BIGINT      NOT NULL,
    snapshot_ledger    BIGINT      NOT NULL,
    supply_at_snapshot NUMERIC     NOT NULL,
    held               NUMERIC     NOT NULL,
    released_total     NUMERIC     NOT NULL,
    burned_total       NUMERIC     NOT NULL,
    claimed_total      NUMERIC     NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, pocket_address, loan_id)
);
