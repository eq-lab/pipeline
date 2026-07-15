-- Migration: loan_disbursement — per-loan USDC off-ramp completion flag.
--
-- Backs the `Disbursing` loan status. When a loan is drawn on-chain the cash-rail
-- USDC off-ramp is not yet complete, so the loan defaults to `Disbursing`
-- (`off_ramp_complete = FALSE`). A trustee flips the flag via
-- `POST /v1/loan-book/{loan_id}/disbursement/complete` once the off-ramp settles,
-- at which point the API surfaces the loan's live on-chain status again.
--
-- Absence of a row is treated as NOT complete (Disbursing) by the API, matching the
-- "default after draw" semantics; the worker inserts a row (defaulting to FALSE) on
-- every `LoanDrawn` event.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE loan_disbursement;

CREATE TABLE loan_disbursement (
    chain_id          BIGINT        NOT NULL,
    loan_id           NUMERIC(78,0) NOT NULL,
    off_ramp_complete BOOLEAN       NOT NULL DEFAULT FALSE,
    -- Set together with off_ramp_complete = TRUE; NULL while Disbursing.
    completed_at      TIMESTAMPTZ,
    -- The authenticated operator (JWT `sub`) who marked the off-ramp complete.
    completed_by      TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, loan_id),
    -- `completed_at` is present iff the off-ramp is complete.
    CONSTRAINT loan_disbursement_complete_ck
        CHECK (off_ramp_complete = (completed_at IS NOT NULL))
);

-- Seed every already-drawn loan as NOT complete (Disbursing). The current DB is
-- test/dev data, so starting existing loans in Disbursing is intentional — a
-- trustee flips each one via the API. Drop/adjust this backfill before any
-- production deployment where existing loans have already been disbursed.
INSERT INTO loan_disbursement (chain_id, loan_id)
SELECT DISTINCT chain_id, (params->>'loan_id')::numeric
FROM contract_logs
WHERE event_name = 'LoanDrawn'
ON CONFLICT (chain_id, loan_id) DO NOTHING;
