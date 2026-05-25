-- Off-chain materialisation of LoanRegistry's `ImmutableLoanData` JSON fetched from
-- each LoanMinted event's metadataURI. Mirrors only the immutable fields of the
-- Solidity-described struct (which lives off-chain — see TD-9 in tech-debt-tracker.md
-- and the active exec plan for the design rationale).
--
-- Lifecycle (status / closed_at / closure_reason) is intentionally NOT stored here:
-- the API derives the current state from `contract_logs` (LoanStatusUpdated,
-- LoanClosed, LoanDefaulted). The holder is also recoverable from `contract_logs`
-- (the LoanMinted event row carries it in `params.holder`).
--
-- Invariant under the current "never skip loan_details" policy: every `contract_logs`
-- row with event_name='LoanMinted' has a matching `loan_details` row, committed in the
-- same transaction. If the off-chain JSON cannot be fetched, the indexer's outer
-- transaction rolls back and the entire batch is retried on the next polling cycle.
-- See TD-8 for the trade-off (forward-progress vs strict consistency).

CREATE TABLE loan_details (
    chain_id                    BIGINT       NOT NULL,
    loan_id                     NUMERIC(78,0) NOT NULL,
    originator                  TEXT         NOT NULL,
    borrower_id                 TEXT         NOT NULL,
    commodity                   TEXT         NOT NULL,
    corridor                    TEXT         NOT NULL,
    original_facility_size      NUMERIC(78,0) NOT NULL,
    original_senior_tranche     NUMERIC(78,0) NOT NULL,
    original_equity_tranche     NUMERIC(78,0) NOT NULL,
    original_offtaker_price     NUMERIC(78,0) NOT NULL,
    senior_interest_rate_bps    INTEGER      NOT NULL,
    origination_date            BIGINT       NOT NULL,
    original_maturity_date      BIGINT       NOT NULL,
    governing_law               TEXT         NOT NULL,
    metadata_uri                TEXT,
    indexed_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, loan_id)
);

CREATE INDEX loan_details_origination_idx ON loan_details (origination_date);
