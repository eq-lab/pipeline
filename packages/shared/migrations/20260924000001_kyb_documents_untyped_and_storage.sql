-- Migration: kyb_documents becomes untyped, and gains the columns real file
-- storage needs (Issue #1267).
--
-- `doc_type`/`subject` are dropped. A KYB document is now simply a file
-- belonging to an LP: there is no controlled vocabulary and no per-person tag.
-- This matches the shipped frontend, which collects a flat `File[]` and has no
-- notion of a document type; `KYB_DOCUMENT_REQUIREMENTS` is prose telling the
-- applicant what to prepare, not a set of slots.
--
-- The slot model goes with them. `idx_kyb_documents_current` was keyed on
-- (lp_id, doc_type, COALESCE(subject, '')), and the supersede-then-insert in
-- `KybDocumentRepo::upload` existed purely to keep one live row per slot. With
-- no slots there is nothing to version against, so `is_current` is dropped too
-- and replacing a document becomes delete-then-upload.
--
-- `file_ref` now holds the object key in the DigitalOcean Spaces bucket
-- (`lps/<lp_id>/<uuid>.<ext>`) rather than a caller-supplied string, so
-- `original_filename` is what tells a reviewer what a file is.
--
-- Dropping rather than deprecating is safe: no upload transport ever shipped —
-- `POST /v1/lps/{id}/documents` took a `file_ref` to an already-stored file
-- that nothing produced — so any existing rows are test data.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   ALTER TABLE kyb_documents
--       DROP COLUMN original_filename,
--       DROP COLUMN size_bytes,
--       DROP COLUMN content_type,
--       ADD COLUMN doc_type TEXT NOT NULL DEFAULT '',
--       ADD COLUMN subject TEXT,
--       ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT TRUE;
--   CREATE UNIQUE INDEX idx_kyb_documents_current
--       ON kyb_documents (lp_id, doc_type, COALESCE(subject, '')) WHERE is_current;

DROP INDEX IF EXISTS idx_kyb_documents_current;
DROP INDEX IF EXISTS idx_kyb_documents_pending_review;

ALTER TABLE kyb_documents
    DROP CONSTRAINT IF EXISTS kyb_documents_doc_type_check,
    DROP COLUMN IF EXISTS doc_type,
    DROP COLUMN IF EXISTS subject,
    DROP COLUMN IF EXISTS is_current;

ALTER TABLE kyb_documents
    ADD COLUMN original_filename TEXT   NOT NULL DEFAULT '',
    ADD COLUMN size_bytes        BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN content_type      TEXT   NOT NULL DEFAULT '';

ALTER TABLE kyb_documents
    ALTER COLUMN original_filename DROP DEFAULT,
    ALTER COLUMN size_bytes        DROP DEFAULT,
    ALTER COLUMN content_type      DROP DEFAULT;

ALTER TABLE kyb_documents
    ADD CONSTRAINT kyb_documents_size_bytes_positive_ck CHECK (size_bytes > 0);

-- Rebuilt without the `is_current` predicate: every row is now live until it is
-- deleted outright, so "awaiting review" is `status = 'Provided'` alone.
CREATE INDEX idx_kyb_documents_pending_review
    ON kyb_documents (created_at)
    WHERE status = 'Provided';
