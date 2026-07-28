-- Migration: submitted_loans_changes_requested — add a third, non-final review
-- outcome to the loan-submission review workflow (#949).
--
-- Lifecycle becomes: InReview (on insert) → Approved | Rejected | ChangesRequested.
-- `Approved` and `Rejected` remain terminal (no further review accepted). A
-- submission left `ChangesRequested` can still be reviewed again, moving to
-- `Approved`, `Rejected`, or back to `ChangesRequested` (repeated rounds allowed).
-- Like `Rejected`, `ChangesRequested` MUST carry a `reason`. Each new review
-- decision overwrites the single `reason` column — there is no history of prior
-- feedback text (confirmed acceptable; no audit trail in scope).
--
-- The original `status` CHECK was declared inline (unnamed), so Postgres assigned
-- it a system-generated name. Rather than hardcode that name, look it up via
-- `pg_constraint` so this migration is robust to naming drift.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   ALTER TABLE submitted_loans DROP CONSTRAINT submitted_loans_reason_ck;
--   ALTER TABLE submitted_loans ADD CONSTRAINT submitted_loans_reason_ck CHECK (
--       (status = 'Rejected' AND reason IS NOT NULL) OR
--       (status <> 'Rejected' AND reason IS NULL)
--   );
--   -- (status CHECK would need to be re-added under its original generated name,
--   -- which is not recoverable after this migration drops it by lookup.)

DO $$
DECLARE
    status_check_name text;
BEGIN
    SELECT con.conname
      INTO status_check_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE rel.relname = 'submitted_loans'
       AND con.contype = 'c'
       AND con.conname <> 'submitted_loans_reason_ck'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%';

    IF status_check_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE submitted_loans DROP CONSTRAINT %I', status_check_name);
    END IF;
END $$;

ALTER TABLE submitted_loans
    ADD CONSTRAINT submitted_loans_status_check
    CHECK (status IN ('InReview', 'Approved', 'Rejected', 'ChangesRequested'));

ALTER TABLE submitted_loans DROP CONSTRAINT submitted_loans_reason_ck;

ALTER TABLE submitted_loans ADD CONSTRAINT submitted_loans_reason_ck CHECK (
    (status IN ('Rejected', 'ChangesRequested') AND reason IS NOT NULL) OR
    (status NOT IN ('Rejected', 'ChangesRequested') AND reason IS NULL)
);
