-- Migration: loan_assays — append-only assay records (independent lab).
--
-- Part of the collateral-valuation record (see 20260708000001). A new certificate
-- is a new row; the latest by effective_at wins. Append-only is the audit trail
-- the spec requires (document fraud is a primary loss driver) — DB-level REVOKE of
-- UPDATE/DELETE is deferred to a follow-up migration.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE loan_assays;

CREATE TABLE loan_assays (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chain_id        BIGINT        NOT NULL,
    loan_id         NUMERIC(78,0) NOT NULL,
    assay_status    TEXT          NOT NULL
                    CHECK (assay_status IN ('Provisional', 'Final', 'UmpirePending')),
    moisture_pct    NUMERIC,
    assays          JSONB         NOT NULL,               -- [{"metal":"gold","grade_g_per_t":"50"}]
    deleterious     JSONB         NOT NULL DEFAULT '[]',  -- [{"element":"arsenic","level":"2.0","unit":"Pct"}]
    certificate_uri TEXT,                                 -- IPFS pointer / hash
    effective_at    TIMESTAMPTZ   NOT NULL,
    recorded_by     TEXT          NOT NULL,               -- operator identity (audit)
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX loan_assays_latest_idx ON loan_assays (chain_id, loan_id, effective_at DESC);
