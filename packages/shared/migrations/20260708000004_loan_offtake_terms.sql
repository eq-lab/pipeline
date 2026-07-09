-- Migration: loan_offtake_terms — append-only commercial terms (signed offtake).
--
-- Part of the collateral-valuation record (see 20260708000001). A new/amended
-- offtake is a new row; the latest by effective_at wins. Append-only for the same
-- audit reason as loan_assays. Quotational period / pricing reference / incoterm
-- live here (offtake-owned, can be amended), not on the anchor.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE loan_offtake_terms;

CREATE TABLE loan_offtake_terms (
    id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chain_id                 BIGINT        NOT NULL,
    loan_id                  NUMERIC(78,0) NOT NULL,
    payable_terms            JSONB NOT NULL,              -- [{"metal":"gold","payable_pct":"0.80","min_deduction_g_per_t":"1"}]
    treatment_charge_per_dmt NUMERIC NOT NULL DEFAULT 0,
    refining_charges         JSONB NOT NULL DEFAULT '[]', -- [{"metal":"gold","rc_per_oz":"6"}]
    penalty_schedule         JSONB NOT NULL DEFAULT '[]', -- [{"element":"arsenic","threshold":"0.2","step":"0.1","rate_per_dmt":"5","escalating":false}]
    realisation_costs        NUMERIC NOT NULL DEFAULT 0,
    quotational_period       TEXT,                        -- e.g. "2 MAMA"
    pricing_reference        TEXT,                        -- e.g. "LBMA Gold PM over the QP"
    incoterm                 TEXT,                        -- FOB | CFR | CIF
    effective_at             TIMESTAMPTZ   NOT NULL,
    recorded_by              TEXT          NOT NULL,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX loan_offtake_terms_latest_idx ON loan_offtake_terms (chain_id, loan_id, effective_at DESC);
