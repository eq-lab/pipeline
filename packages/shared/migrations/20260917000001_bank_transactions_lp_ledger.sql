-- Migration: bank_transactions (recreated), lp_ledger — LP wire-deposit matching
-- and the append-only claim ledger that backs the mint (#11).
--
-- `bank_transactions` was dropped in #1029 once `loan_capital_transfers` took
-- over its only consumer (trust_account on capital-allocation). It is
-- recreated here in its original shape (#924) plus two columns for this
-- feature:
--   * lp_id            — which LP's wire this is; NULL means unidentified and
--                         the row sits in the matching queue (#11) until an
--                         operator assigns it.
--   * idempotency_key   — unique key supplied by the caller so a double-click
--                         on deposit entry cannot create two rows for the same
--                         wire.
--
-- `lp_ledger` is the append-only record of every movement of an LP's claim
-- (deposits, distributions, redemptions, write-downs, manual corrections).
-- Rows are never updated or deleted; corrections are posted as new rows with
-- reason = 'Correction'. `source` records which funding rail the movement
-- came in on (Wire vs USDC) — `source_ref` points at the row in that rail's
-- own table (`bank_transactions.id` for Wire) but is intentionally not a
-- foreign key since a USDC-sourced row points at a loan repayment id in a
-- different table instead. `dealing_date` is the date the movement is priced
-- at, which may differ from `created_at` (insert time) when a movement is
-- entered late. `reconciled_at` is a bookkeeping-only marker for later tying
-- a row to a bank statement — it does not gate the mint. `stellar_tx_hash` is
-- filled in by the mint (#11) once the on-chain leg lands; NULL until then.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE lp_ledger;
--   DROP TABLE bank_transactions;

CREATE TABLE bank_transactions (
    id                BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_type  TEXT        NOT NULL CHECK (transaction_type IN ('Deposit', 'Withdrawal', 'Fee')),
    amount            NUMERIC     NOT NULL CHECK (amount >= 0),
    payment_reference TEXT,
    occurred_at       TIMESTAMPTZ NOT NULL,
    recorded_by       TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    lp_id             BIGINT      REFERENCES lps(id),
    idempotency_key   UUID        UNIQUE
);

CREATE INDEX bank_transactions_occurred_at_idx ON bank_transactions (occurred_at DESC);
CREATE INDEX idx_bank_transactions_lp_id ON bank_transactions (lp_id);

CREATE TABLE lp_ledger (
    id               BIGSERIAL   PRIMARY KEY,
    lp_id            BIGINT      NOT NULL REFERENCES lps(id),
    delta            NUMERIC(20, 2) NOT NULL,
    reason           TEXT        NOT NULL
                          CHECK (reason IN ('Deposit', 'InterestDistribution', 'Redemption', 'WriteDown', 'Correction')),
    source           TEXT        NOT NULL CHECK (source IN ('Wire', 'USDC')),
    source_ref       BIGINT,
    dealing_date     TIMESTAMPTZ NOT NULL,
    recorded_by      TEXT        NOT NULL,
    reconciled_at    TIMESTAMPTZ,
    stellar_tx_hash  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lp_ledger_lp_id ON lp_ledger (lp_id);
CREATE INDEX idx_lp_ledger_dealing_date ON lp_ledger (dealing_date);
