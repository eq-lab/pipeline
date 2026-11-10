-- Issue #1839: a recorded wire may link to the issued payment reference it quoted.
-- Spec: docs/product-specs/deposits.md#wire-matching-by-payment-reference
-- The composite FK (requested_bank_details_id, lp_id) makes a cross-LP link impossible at the
-- DB level; a NULL link (hand attribution) is not checked (MATCH SIMPLE). No backfill: existing
-- deposits stay unlinked. Additive only.
--
-- Rollback:
--   DROP INDEX idx_lp_bank_deposits_requested_bank_details_id;
--   ALTER TABLE lp_bank_deposits DROP CONSTRAINT lp_bank_deposits_requested_bank_details_fk,
--       DROP COLUMN requested_bank_details_id;
--   ALTER TABLE lp_requested_bank_details DROP CONSTRAINT lp_requested_bank_details_id_lp_id_key;

ALTER TABLE lp_requested_bank_details
    ADD CONSTRAINT lp_requested_bank_details_id_lp_id_key UNIQUE (id, lp_id);

ALTER TABLE lp_bank_deposits
    ADD COLUMN requested_bank_details_id BIGINT,
    ADD CONSTRAINT lp_bank_deposits_requested_bank_details_fk
        FOREIGN KEY (requested_bank_details_id, lp_id)
        REFERENCES lp_requested_bank_details (id, lp_id);

CREATE INDEX idx_lp_bank_deposits_requested_bank_details_id
    ON lp_bank_deposits (requested_bank_details_id)
    WHERE requested_bank_details_id IS NOT NULL;
