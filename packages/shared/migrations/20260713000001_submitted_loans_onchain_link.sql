-- Migration: thin bridge from an off-chain submission to its on-chain loan.
--
-- Approach A ("two worlds, thin bridge"): `submitted_loans` stays the off-chain
-- review record (the `loan_data` JSONB payload is untouched). We add only a
-- read-only pointer to the on-chain loan, set once by the indexer when the matching
-- loan is drawn. On-chain *state* (status, CCR, repayment, …) is NOT copied here —
-- it stays in `contract_logs` and is derived at read time by joining on the pointer.
--
-- The link is matched by `metadata_uri` (the only field shared by the submission and
-- the on-chain snapshot; the draw tx is submitted client-side, so no backend id
-- passthrough is possible). `metadata_uri` lives inside the `loan_data` payload.
--
-- Additive and non-destructive: existing rows get NULL pointers, then the one-time
-- backfill below links any submission whose loan was *already* drawn before this
-- migration. Ongoing linking stays with the indexer (`link_drawn` on `LoanDrawn`).
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP INDEX submitted_loans_loan_lookup_idx;
--   DROP INDEX submitted_loans_metadata_uri_unlinked_uk;
--   ALTER TABLE submitted_loans DROP COLUMN loan_id, DROP COLUMN chain_id;

ALTER TABLE submitted_loans
    ADD COLUMN chain_id BIGINT,
    ADD COLUMN loan_id  NUMERIC(78,0);

-- One-time backfill: link existing pre-drawn submissions to loans that were already
-- drawn and indexed before this migration. The draw-time on-chain metadata URI lives
-- in the `LoanDrawn` snapshot (`params->'snapshot'->>'metadata_uri_onchain'`, resolved
-- by the indexer via tokenURI) — the same value the submitter recorded. This mirrors
-- exactly what `link_drawn` would set on a re-index, so operators don't have to
-- re-index just to pick up historical links. No-op on a fresh DB (no LoanDrawn rows
-- exist at migration time; runtime draws are linked by the indexer going forward).
UPDATE submitted_loans s
SET chain_id = d.chain_id,
    loan_id  = d.loan_id,
    updated_at = now()
FROM (
    SELECT chain_id,
           (params->>'loan_id')::numeric               AS loan_id,
           params->'snapshot'->>'metadata_uri_onchain' AS uri
    FROM contract_logs
    WHERE event_name = 'LoanDrawn'
) d
WHERE s.loan_id IS NULL
  AND d.uri IS NOT NULL
  AND s.loan_data->>'metadata_uri' = d.uri;

-- Unambiguous link target: at most one *unlinked* submission per metadata_uri, so
-- the indexer's match (WHERE loan_data->>'metadata_uri' = ? AND loan_id IS NULL)
-- resolves to a single row. Expression index over the JSONB payload field. Created
-- AFTER the backfill so it validates the post-backfill state.
CREATE UNIQUE INDEX submitted_loans_metadata_uri_unlinked_uk
    ON submitted_loans ((loan_data->>'metadata_uri')) WHERE loan_id IS NULL;

-- Reverse lookup: linked submission by its on-chain identity.
CREATE INDEX submitted_loans_loan_lookup_idx
    ON submitted_loans (chain_id, loan_id);
