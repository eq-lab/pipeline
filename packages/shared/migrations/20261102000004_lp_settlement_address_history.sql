-- Migration: append-only settlement-address link history per LP (#1831).
-- Spec: docs/product-specs/kyb-lp-verification.md#link-history.
--
-- Backfill: one row per address currently set. chain_id and linked_by_account_id stay NULL (the migration cannot know
-- the verify chain_id or who linked), signer_address is NULL for legacy unproven Stellar links, and created_at is
-- the *_linked_at value (address_linked_at falls back to updated_at if a hand edit left it NULL).
--
-- The three NOT VALID checks make every new row carry chain_id, signer_address and linked_by_account_id while legacy
-- rows are exempt. The table is insert-only, so Postgres never re-checks them. Never VALIDATE these constraints.
--
-- Rollback:
-- DROP TABLE lp_settlement_address_history;

CREATE TABLE lp_settlement_address_history (
    id                      BIGSERIAL   PRIMARY KEY,
    lp_id                   BIGINT      NOT NULL REFERENCES lps(id),
    chain_kind              TEXT        NOT NULL
        CONSTRAINT lp_settlement_address_history_kind_ck CHECK (chain_kind IN ('stellar', 'evm')),
    chain_id                BIGINT,
    address                 TEXT        NOT NULL,
    signer_address          TEXT,
    previous_address        TEXT,
    previous_signer_address TEXT,
    linked_by_account_id    UUID        REFERENCES accounts(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lp_settlement_address_history_lp_created_idx
    ON lp_settlement_address_history (lp_id, created_at);

INSERT INTO lp_settlement_address_history (lp_id, chain_kind, address, signer_address, created_at)
SELECT id, 'stellar', stellar_address, stellar_signer_address, COALESCE(address_linked_at, updated_at)
  FROM lps WHERE stellar_address IS NOT NULL;

INSERT INTO lp_settlement_address_history (lp_id, chain_kind, address, signer_address, created_at)
SELECT id, 'evm', evm_address, evm_signer_address, evm_address_linked_at
  FROM lps WHERE evm_address IS NOT NULL;

ALTER TABLE lp_settlement_address_history
    ADD CONSTRAINT lp_settlement_address_history_chain_id_nn CHECK (chain_id IS NOT NULL) NOT VALID,
    ADD CONSTRAINT lp_settlement_address_history_signer_nn CHECK (signer_address IS NOT NULL) NOT VALID,
    ADD CONSTRAINT lp_settlement_address_history_linked_by_nn CHECK (linked_by_account_id IS NOT NULL) NOT VALID;
