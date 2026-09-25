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

-- Existing rows cannot survive this change, so they go first.
--
-- The old `POST /v1/lps/{id}/documents` did insert rows — it recorded a
-- caller-supplied `file_ref` to a file no upload transport ever produced. Those
-- rows point at nothing: there was no bucket, so there are no bytes, and the
-- backfilled `original_filename`/`content_type` would be empty, which would make
-- `GET /v1/lps/me` presign objects that do not exist. Keeping them would also
-- abort this migration outright — `size_bytes` backfills to 0 and the CHECK
-- below is validated against existing rows, so the deploy would roll back.
--
-- Safe because no such row can be real: a document is only meaningful once its
-- bytes are in Spaces, and nothing could put them there before this migration.
--
-- One caveat before running this anywhere with history: the review endpoint
-- (`POST /v1/lps/{id}/documents/{doc}/review`) did ship, so a row may carry a
-- `status`/`reject_reason`/`reviewed_by` that somebody actually entered during
-- QA. The bytes behind it never existed, so the row is not recoverable in any
-- useful sense — but migrations here are forward-only, so run
-- `SELECT count(*) FROM kyb_documents` on each target first if that review
-- history is worth capturing before it goes.
DELETE FROM kyb_documents;

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
