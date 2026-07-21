-- Migration: loan_fee_schedule — the per-loan protocol fee schedule, moved off
-- loan_parameters into its own table.
--
-- Fees are a debt-side economic term: they govern how an incoming offtaker payment is
-- carved into senior principal, the net senior coupon, the three fee allocations, and
-- the equity residual (the repayment waterfall — see docs/product-specs/yield.md
-- "Waterfall components"). That has nothing to do with valuing the collateral, so the
-- schedule lives in a dedicated table rather than riding on loan_parameters (being
-- dropped) or the collateral-valuation anchor.
--
-- Keyed (chain_id, loan_id) to match the modern per-loan tables (contract_logs,
-- loan_collateral_valuations, …); loan_parameters was loan_id-only only because it
-- predated chain sharding. The backfill maps those legacy rows to chain_id 1
-- (DEFAULT_CHAIN_ID), matching the loan_collateral_valuations / lp_profiles backfill
-- convention.
--
-- All three rates are basis points (1 bp = 1/10_000):
--   * mgmt_fee_rate_bps  — annualised management fee, applied to senior_deployed × (tenor/365)
--   * oet_alloc_rate_bps — annualised OET allocation, applied to senior_deployed × (tenor/365)
--   * perf_fee_rate_bps  — performance fee as a fraction of (gross interest − management fee),
--                          e.g. 2000 = 20% (NOT annualised; no tenor factor)
--
-- Default 0: a loan with no row carves out no fees (all gross interest flows to the net
-- senior coupon) until a schedule is configured. Backfill is idempotent
-- (ON CONFLICT DO NOTHING) so a re-run cannot duplicate rows.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE loan_fee_schedule;

CREATE TABLE loan_fee_schedule (
    chain_id           BIGINT        NOT NULL,
    loan_id            NUMERIC(78,0) NOT NULL,
    mgmt_fee_rate_bps  INTEGER NOT NULL DEFAULT 0 CHECK (mgmt_fee_rate_bps  >= 0),
    perf_fee_rate_bps  INTEGER NOT NULL DEFAULT 0 CHECK (perf_fee_rate_bps  >= 0 AND perf_fee_rate_bps <= 10000),
    oet_alloc_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (oet_alloc_rate_bps >= 0),
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, loan_id)
);

INSERT INTO loan_fee_schedule
    (chain_id, loan_id, mgmt_fee_rate_bps, perf_fee_rate_bps, oet_alloc_rate_bps, created_at, updated_at)
SELECT
    1,
    loan_id,
    mgmt_fee_rate_bps,
    perf_fee_rate_bps,
    oet_alloc_rate_bps,
    created_at,
    updated_at
FROM loan_parameters
ON CONFLICT (chain_id, loan_id) DO NOTHING;
