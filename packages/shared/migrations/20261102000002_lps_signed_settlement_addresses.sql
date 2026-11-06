-- Migration: signed settlement addresses, one per chain kind (#1824, closes TD-57).
-- Spec: docs/product-specs/kyb-lp-verification.md#settlement-address.
--
-- lps keeps stellar_address / address_linked_at and gains stellar_signer_address plus an EVM trio. Stellar addresses
-- linked before this migration are kept with a NULL stellar_signer_address, meaning unproven; nothing is cleared. So
-- the only Stellar constraint is signer-needs-address: a full pairing CHECK would fail every later UPDATE of a legacy
-- row, since Postgres re-checks constraints on each written row. The EVM trio is new, so it is checked as a unit.
--
-- lp_address_challenges holds one live link challenge per (lp_id, chain_id); it is consumed by DELETE ... RETURNING.
--
-- Rollback:
-- DROP TABLE lp_address_challenges;
-- ALTER TABLE lps
--     DROP CONSTRAINT lps_evm_link_complete_ck,
--     DROP CONSTRAINT lps_stellar_signer_needs_address_ck,
--     DROP COLUMN evm_address_linked_at,
--     DROP COLUMN evm_signer_address,
--     DROP COLUMN evm_address,
--     DROP COLUMN stellar_signer_address;

ALTER TABLE lps
    ADD COLUMN stellar_signer_address TEXT
        CONSTRAINT lps_stellar_signer_address_ck CHECK (stellar_signer_address IS NULL OR stellar_signer_address ~ '^G[A-Z2-7]{55}$'),
    ADD COLUMN evm_address TEXT
        CONSTRAINT lps_evm_address_key UNIQUE
        CONSTRAINT lps_evm_address_ck CHECK (evm_address IS NULL OR evm_address ~ '^0x[0-9a-f]{40}$'),
    ADD COLUMN evm_signer_address TEXT
        CONSTRAINT lps_evm_signer_address_ck CHECK (evm_signer_address IS NULL OR evm_signer_address ~ '^0x[0-9a-f]{40}$'),
    ADD COLUMN evm_address_linked_at TIMESTAMPTZ;

ALTER TABLE lps
    ADD CONSTRAINT lps_stellar_signer_needs_address_ck CHECK (stellar_signer_address IS NULL OR stellar_address IS NOT NULL),
    ADD CONSTRAINT lps_evm_link_complete_ck CHECK ((evm_address IS NULL) = (evm_signer_address IS NULL)
                                               AND (evm_address IS NULL) = (evm_address_linked_at IS NULL));

CREATE TABLE lp_address_challenges (
    lp_id          BIGINT      NOT NULL REFERENCES lps(id),
    chain_id       BIGINT      NOT NULL,
    address        TEXT        NOT NULL,
    signer_address TEXT        NOT NULL,
    nonce          TEXT        NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lp_id, chain_id)
);
