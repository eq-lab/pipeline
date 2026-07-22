-- Migration: fold quantity into loan_collateral_valuations; drop loan_quantity_reports.
--
-- loan_quantity_reports (20260708000005) was meant to be an append-only trustee-feed
-- table for physical quantity, but no write path was ever built for it — the repo's own
-- doc comment called it out as read-only, "writes arrive later with the operator-input
-- endpoints", and those endpoints never landed. Every environment therefore has zero
-- rows in it.
--
-- Quantity is now captured directly on the valuation anchor, alongside
-- commodity/valuation_mode/asset/price_provider/haircut_pct, at loan-submission time via
-- `POST /v1/loan-book/loan` (see `CollateralValuationInput` / `insert_pending`) — the same
-- authorship model every other anchor field already uses, rather than a separate
-- append-only history.
--
-- Existing anchors (if any) predate this field and have no quantity data to backfill from
-- (loan_quantity_reports has never been written to), so they are discarded — same
-- rationale as 20260721000001's submission-link migration.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   ALTER TABLE loan_collateral_valuations DROP COLUMN quantity_dmt;
--   CREATE TABLE loan_quantity_reports ( -- see 20260708000005
--       id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--       chain_id     BIGINT        NOT NULL,
--       loan_id      NUMERIC(78,0) NOT NULL,
--       quantity_dmt NUMERIC       NOT NULL CHECK (quantity_dmt >= 0),
--       location     JSONB,
--       reported_at  TIMESTAMPTZ   NOT NULL,
--       recorded_by  TEXT          NOT NULL,
--       created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
--   );
--   CREATE INDEX loan_quantity_reports_latest_idx ON loan_quantity_reports (chain_id, loan_id, reported_at DESC);

DELETE FROM loan_collateral_valuations;

ALTER TABLE loan_collateral_valuations
    ADD COLUMN quantity_dmt NUMERIC NOT NULL CHECK (quantity_dmt >= 0);

DROP TABLE loan_quantity_reports;
