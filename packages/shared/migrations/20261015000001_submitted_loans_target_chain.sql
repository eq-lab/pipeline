-- Migration: submissions carry a target chain (epic #1521, issue #1529).
-- Spec: docs/product-specs/api-authorization-loan-submission.md.
--
-- target_chain_id is the chain a submission is meant to be drawn on. It is set at
-- submission, kept on resubmit, and routes the LoanDrawn link: a draw links a
-- submission only when the draw chain equals target_chain_id. chain_id / loan_id stay
-- the drawn pointer (NULL until drawn).
--
-- Backfill: drawn rows get target_chain_id = chain_id. Rows that are not drawn get the
-- session setting pipeline.default_chain_id, which the shared migration runner
-- (shared::migrations::run) sets from DEFAULT_CHAIN_ID in both the API and the worker.
-- If such rows exist and the setting is absent, the migration fails.
--
-- Pre-flight: the migration stops when one (chain_id, loan_id) is linked to two
-- submissions. List the offenders with:
--   SELECT chain_id, loan_id, array_agg(id ORDER BY id) AS submission_ids
--     FROM submitted_loans WHERE loan_id IS NOT NULL
--    GROUP BY chain_id, loan_id HAVING count(*) > 1;
--
-- Rollback: run all statements in ONE transaction, together with rolling back the
-- application images (old images do not know target_chain_id):
--   DROP INDEX submitted_loans_target_chain_idx;
--   DROP INDEX submitted_loans_chain_loan_uk;
--   CREATE INDEX submitted_loans_loan_lookup_idx ON submitted_loans (chain_id, loan_id);
--   ALTER TABLE submitted_loans DROP CONSTRAINT submitted_loans_link_on_target_ck;
--   ALTER TABLE submitted_loans DROP COLUMN target_chain_id;
--   DELETE FROM _sqlx_migrations WHERE version = 20261015000001;

ALTER TABLE submitted_loans ADD COLUMN target_chain_id BIGINT;

DO $$
DECLARE
    dups TEXT;
BEGIN
    SELECT string_agg(
               format('(chain_id=%s, loan_id=%s) -> submissions %s', chain_id, loan_id, ids),
               '; ')
      INTO dups
      FROM (
          SELECT chain_id, loan_id, string_agg(id::text, ',' ORDER BY id) AS ids
            FROM submitted_loans
           WHERE loan_id IS NOT NULL
           GROUP BY chain_id, loan_id
          HAVING count(*) > 1
      ) d;
    IF dups IS NOT NULL THEN
        RAISE EXCEPTION 'submitted_loans has a (chain_id, loan_id) linked to more than one submission: %. Unlink the wrong rows (UPDATE submitted_loans SET chain_id = NULL, loan_id = NULL WHERE id = <id>) and rerun.', dups;
    END IF;
END $$;

UPDATE submitted_loans SET target_chain_id = chain_id WHERE chain_id IS NOT NULL;

DO $$
DECLARE
    v BIGINT;
    n BIGINT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM submitted_loans WHERE target_chain_id IS NULL) THEN
        RETURN;
    END IF;
    v := NULLIF(current_setting('pipeline.default_chain_id', true), '')::bigint;
    IF v IS NULL THEN
        RAISE EXCEPTION 'submitted_loans.target_chain_id backfill needs DEFAULT_CHAIN_ID: rows have no drawn chain and pipeline.default_chain_id is unset; set DEFAULT_CHAIN_ID for the migrating service';
    END IF;
    UPDATE submitted_loans SET target_chain_id = v WHERE target_chain_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'submitted_loans.target_chain_id: % undrawn rows defaulted to chain %', n, v;
END $$;

ALTER TABLE submitted_loans ALTER COLUMN target_chain_id SET NOT NULL;

ALTER TABLE submitted_loans ADD CONSTRAINT submitted_loans_link_on_target_ck
    CHECK (chain_id IS NULL OR chain_id = target_chain_id);

DROP INDEX submitted_loans_loan_lookup_idx;
CREATE UNIQUE INDEX submitted_loans_chain_loan_uk
    ON submitted_loans (chain_id, loan_id) WHERE loan_id IS NOT NULL;

CREATE INDEX submitted_loans_target_chain_idx ON submitted_loans (target_chain_id, created_at DESC);
