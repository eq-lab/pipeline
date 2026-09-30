-- Migration: KYB review lifecycle (Issue #1274).
--
-- `lps.kyb_status` gains `ChangesRequested`, the state a trustee returns an LP
-- to for correction — the only thing that reopens a record once it has been
-- submitted. Four nullable columns record the submission and the latest
-- verdict; there is no history table, because only the latest decision is
-- retained (spec § KYB Review Lifecycle) — a second verdict overwrites the
-- first with no trace anywhere, which is a deliberate product decision, not
-- an omission.
--
-- All four columns are nullable with no backfill: an LP that has never been
-- submitted has no submission time, and NULL is the honest value for every
-- row that predates this migration.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference
-- only, and it will fail on any row already holding 'ChangesRequested':
--   ALTER TABLE lps DROP CONSTRAINT IF EXISTS lps_kyb_status_check;
--   ALTER TABLE lps ADD CONSTRAINT lps_kyb_status_check
--       CHECK (kyb_status IN ('NotStarted', 'InProgress', 'UnderReview', 'Passed', 'Failed'));
--   ALTER TABLE lps DROP COLUMN IF EXISTS kyb_submitted_at;
--   ALTER TABLE lps DROP COLUMN IF EXISTS kyb_decided_by;
--   ALTER TABLE lps DROP COLUMN IF EXISTS kyb_decided_at;
--   ALTER TABLE lps DROP COLUMN IF EXISTS kyb_decision_reason;

ALTER TABLE lps DROP CONSTRAINT IF EXISTS lps_kyb_status_check;
ALTER TABLE lps ADD CONSTRAINT lps_kyb_status_check
    CHECK (kyb_status IN ('NotStarted', 'InProgress', 'UnderReview',
                          'ChangesRequested', 'Passed', 'Failed'));

ALTER TABLE lps
    ADD COLUMN IF NOT EXISTS kyb_submitted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS kyb_decided_by      TEXT,
    ADD COLUMN IF NOT EXISTS kyb_decided_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS kyb_decision_reason TEXT;
