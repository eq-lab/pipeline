-- Migration: loan_capital_transfers — Trustee-entered per-loan capital movement record.
--
-- Backs the reworked GET /v1/capital-allocation buckets (#1027): for each drawn
-- loan a Trustee records what has actually moved on the cash rails —
--   * is_loan_deployed        — gates the loan's senior tranche into `deployed`
--                               (together with the active-window check);
--   * on/off_ramp_transferred — confirmed ramp amounts, subtracted from the gross
--                               approved custody↔ramp flow to form `in_transit`;
--   * trust_account_deposit / trust_account_withdrawal — feed `trust_account` as
--                               sum(deposits) − sum(withdrawals), per chain.
--
-- One row per (chain_id, loan_id); written only via the Trustee-only full-upsert
-- POST /v1/loan-book/{loan_id}/transfers. Absence of a row means "nothing recorded
-- yet" (flag false, all amounts 0) — the API serves defaults, no seeding on
-- LoanDrawn (unlike loan_disbursement).
--
-- Amounts are plain dollar figures, not base-6/on-chain-scaled (same rationale as
-- bank_transactions): cash-rail movements have no on-chain native scale. The
-- capital-allocation handler scales them only when combining with base-6 buckets.
-- Individual amounts are non-negative (sign is implied by the column name);
-- derived bucket values may still go negative and are deliberately not clamped.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE loan_capital_transfers;

CREATE TABLE loan_capital_transfers (
    chain_id                 BIGINT        NOT NULL,
    loan_id                  NUMERIC(78,0) NOT NULL,
    is_loan_deployed         BOOLEAN       NOT NULL DEFAULT FALSE,
    on_ramp_transferred      NUMERIC       NOT NULL DEFAULT 0 CHECK (on_ramp_transferred >= 0),
    off_ramp_transferred     NUMERIC       NOT NULL DEFAULT 0 CHECK (off_ramp_transferred >= 0),
    trust_account_deposit    NUMERIC       NOT NULL DEFAULT 0 CHECK (trust_account_deposit >= 0),
    trust_account_withdrawal NUMERIC       NOT NULL DEFAULT 0 CHECK (trust_account_withdrawal >= 0),
    -- The authenticated Trustee (JWT `sub`) who last wrote the record.
    recorded_by              TEXT          NOT NULL,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, loan_id)
);
