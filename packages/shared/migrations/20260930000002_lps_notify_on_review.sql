-- Migration: `lps.notify_on_review` (Issue #1377).
--
-- The preference lives on `lps`, not `accounts`: it is about a decision made
-- on an entity, one account owns at most one LP, and the address it is
-- delivered to is `lps.contact_email` (spec § Review Notifications).
--
-- `NOT NULL DEFAULT false` backfills every existing row to opt-out, which is
-- also the value an insert takes when the caller sends no preference. The
-- `DEFAULT` stays on the column permanently for that second reason, not only
-- for the backfill.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference
-- only:
--   ALTER TABLE lps DROP COLUMN IF EXISTS notify_on_review;
ALTER TABLE lps
    ADD COLUMN IF NOT EXISTS notify_on_review BOOLEAN NOT NULL DEFAULT false;
