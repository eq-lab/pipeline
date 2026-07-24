-- Migration: bank_transactions — manually-entered bank-account ledger.
--
-- Backs `trust_account` on GET /v1/capital-allocation (#924): trust_account =
-- sum(deposits) - sum(withdrawals) - sum(fees). The trust account is one real-world
-- bank account for the whole protocol, not a per-chain concept, so this table has no
-- chain_id/loan_id column — mirrors loan_asset_prices, which is similarly global.
--
-- Append-only, same audit rationale as loan_assays/loan_offtake_terms (#914): a
-- bookkeeping correction is a new offsetting entry, never an edit. DB-level REVOKE of
-- UPDATE/DELETE is deferred, matching those tables' own precedent (TD-45).
--
-- `amount` is a plain dollar figure, not base-6/on-chain-scaled — a bank transaction
-- has no on-chain native scale to normalize against. `capital_allocation`'s API
-- handler scales this only when combining it with other, base-6 buckets.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE bank_transactions;

CREATE TABLE bank_transactions (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_type  TEXT        NOT NULL CHECK (transaction_type IN ('Deposit', 'Withdrawal', 'Fee')),
    amount            NUMERIC     NOT NULL CHECK (amount >= 0),
    payment_reference TEXT,
    occurred_at       TIMESTAMPTZ NOT NULL,
    recorded_by       TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bank_transactions_occurred_at_idx ON bank_transactions (occurred_at DESC);
