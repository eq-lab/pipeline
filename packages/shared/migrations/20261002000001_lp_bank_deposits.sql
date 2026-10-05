-- Migration: lp_bank_deposits — the trustee's record of wires received from an
-- LP (#1413, epic #1269 point 3); drops the superseded `bank_transactions`.
--
-- `bank_transactions` (recreated by the 2026-09-17 migration after #1029 dropped
-- the original #924 ledger) had exactly one writer, `POST /v1/lp-ledger/deposits`,
-- and no reader at all: no frontend calls it, the worker does not exist yet, and
-- `GET /v1/capital-allocation` has sourced `trust_account` from
-- `loan_capital_transfers` since #1029. It therefore holds dev/test data only —
-- the same basis on which #1029 already dropped it once — so this is a replace,
-- not a parallel table, and incoming wires keep a single source of truth.
--
-- Shape differences from `bank_transactions`:
--   * no `transaction_type` — this table is deposits only. `Withdrawal`/`Fee`
--     had no writer and no reader; the Withdraw flow (#1285) brings its own.
--   * `lp_id` is NOT NULL. It was nullable for the unidentified-wire queue
--     described in that migration's comment and never built (TD-73); when that
--     queue arrives it is a table of unattributed arrivals, not a NULL row here.
--   * no `idempotency_key`. Dropped by the agreed column set (#1413 decision 1),
--     which removes the 409 double-click guard — logged as TD-113.
--   * `amount` is NUMERIC(20,2), matching `lp_ledger.delta`. The old unscaled
--     NUMERIC could round differently from its paired ledger row, which is what
--     `routes::lp_ledger`'s MAX_AMOUNT_SCALE comment was guarding against.
--
-- `lp_ledger` is untouched and still the append-only claim ledger. For
-- `source = 'Wire'` its `source_ref` now points at `lp_bank_deposits.id`; it was
-- never a real FK (a USDC-sourced row points into a different table), so only
-- the meaning moves.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only.
-- Recreates the dropped table's shape; rows are not restorable:
--   DROP TABLE lp_bank_deposits;
--   CREATE TABLE bank_transactions (
--       id                BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--       transaction_type  TEXT        NOT NULL CHECK (transaction_type IN ('Deposit', 'Withdrawal', 'Fee')),
--       amount            NUMERIC     NOT NULL CHECK (amount >= 0),
--       payment_reference TEXT,
--       occurred_at       TIMESTAMPTZ NOT NULL,
--       recorded_by       TEXT        NOT NULL,
--       created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
--       lp_id             BIGINT      REFERENCES lps(id),
--       idempotency_key   UUID        UNIQUE
--   );
--   CREATE INDEX bank_transactions_occurred_at_idx ON bank_transactions (occurred_at DESC);
--   CREATE INDEX idx_bank_transactions_lp_id ON bank_transactions (lp_id);

CREATE TABLE lp_bank_deposits (
    id                BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lp_id             BIGINT         NOT NULL REFERENCES lps(id),
    amount            NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
    payment_reference TEXT,
    occurred_at       TIMESTAMPTZ    NOT NULL,
    recorded_by       TEXT           NOT NULL,
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_lp_bank_deposits_lp_id_occurred_at ON lp_bank_deposits (lp_id, occurred_at DESC);

DROP TABLE bank_transactions;
