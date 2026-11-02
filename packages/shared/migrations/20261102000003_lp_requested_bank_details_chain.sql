-- Migration: payment references record the chain and receiver they were issued for (#1824).
-- Spec: docs/product-specs/deposits.md#lp-funding-details.
--
-- Legacy rows: chain_id stays NULL, because the migration cannot know which configured chain id is the Stellar
-- chain (the kind comes from CHAIN_<id>_TYPE env). receiver_address is backfilled from lps.stellar_address: the
-- #1815 gate required Passed plus a Stellar address, and Passed fixes that address, so the current value is the one
-- in force when the reference was issued.
--
-- Both columns are nullable with NOT VALID CHECKs: every new row must carry both, legacy rows are exempt. The table
-- is insert-only, so Postgres never re-checks the legacy rows. Never VALIDATE these constraints.
--
-- Rollback:
-- ALTER TABLE lp_requested_bank_details
--     DROP CONSTRAINT lp_requested_bank_details_receiver_nn,
--     DROP CONSTRAINT lp_requested_bank_details_chain_id_nn,
--     DROP COLUMN receiver_address,
--     DROP COLUMN chain_id;

ALTER TABLE lp_requested_bank_details ADD COLUMN chain_id BIGINT, ADD COLUMN receiver_address TEXT;

UPDATE lp_requested_bank_details r SET receiver_address = l.stellar_address
  FROM lps l WHERE l.id = r.lp_id AND r.receiver_address IS NULL;

ALTER TABLE lp_requested_bank_details
    ADD CONSTRAINT lp_requested_bank_details_chain_id_nn CHECK (chain_id IS NOT NULL) NOT VALID,
    ADD CONSTRAINT lp_requested_bank_details_receiver_nn CHECK (receiver_address IS NOT NULL) NOT VALID;
