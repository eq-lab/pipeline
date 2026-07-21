-- Migration: loan_fee_schedule keyed by submitted_loan_id.
--
-- Same rationale as `loan_collateral_valuations_submission_link`
-- (20260721000001): the loan-book submission endpoint (`POST /v1/loan-book/loan`)
-- is gaining a new fee-schedule input field, written into this table at
-- submission time — before `chain_id`/`loan_id` exist. Key the table on
-- `submitted_loan_id` instead: one schedule per submission. `submitted_loans`
-- already carries its own `(chain_id, loan_id)` pointer, set once the loan is
-- drawn (see `submitted_loans_loan_lookup_idx`, migration
-- `20260713000001_submitted_loans_onchain_link`) — anything needing the on-chain
-- identity joins through there rather than duplicating it here.
--
-- Existing rows predate the submission flow (backfilled from `loan_parameters` for
-- loans drawn with no prior submission — `link_drawn`'s own doc comment calls that
-- a normal case) and have no `submitted_loan_id` to attach to. They are discarded:
-- fee schedule data now exists only for loans that went through the submission
-- endpoint. No other table references `loan_fee_schedule` by foreign key, so this
-- is safe.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   ALTER TABLE loan_fee_schedule
--     DROP CONSTRAINT loan_fee_schedule_pkey,
--     ADD COLUMN chain_id BIGINT NOT NULL,
--     ADD COLUMN loan_id  NUMERIC(78,0) NOT NULL,
--     ADD PRIMARY KEY (chain_id, loan_id),
--     ALTER COLUMN submitted_loan_id DROP NOT NULL;

DELETE FROM loan_fee_schedule;

ALTER TABLE loan_fee_schedule
    DROP CONSTRAINT loan_fee_schedule_pkey,
    DROP COLUMN chain_id,
    DROP COLUMN loan_id,
    ADD COLUMN submitted_loan_id BIGINT NOT NULL REFERENCES submitted_loans (id) PRIMARY KEY;
