-- Migration: loan_quantity_reports — append-only quantity/location (trustee feed).
--
-- Part of the collateral-valuation record (see 20260708000001). Physical quantity
-- has no on-chain source (loan economics are monetary; the on-chain location
-- update carries no tonnage), so it must be stored here. A new report is a new
-- row; the latest by reported_at wins. Also the home for the CMA-reported figure
-- behind the >3% discrepancy alert.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE loan_quantity_reports;

CREATE TABLE loan_quantity_reports (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chain_id     BIGINT        NOT NULL,
    loan_id      NUMERIC(78,0) NOT NULL,
    quantity_dmt NUMERIC       NOT NULL CHECK (quantity_dmt >= 0),  -- original less delivered
    location     JSONB,
    reported_at  TIMESTAMPTZ   NOT NULL,
    recorded_by  TEXT          NOT NULL,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX loan_quantity_reports_latest_idx ON loan_quantity_reports (chain_id, loan_id, reported_at DESC);
