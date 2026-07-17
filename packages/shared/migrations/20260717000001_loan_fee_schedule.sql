-- Migration: per-loan protocol fee schedule on loan_parameters.
--
-- Backs the repayment waterfall endpoint (`GET /v1/loan-book/{loan_id}/waterfall`).
-- The waterfall decomposes an incoming offtaker payment into senior principal, the
-- net senior coupon, the three fee carve-outs, and the equity residual (see
-- docs/product-specs/yield.md "Waterfall components" and trustee-dashboard.md flow
-- note A). Those carve-outs need a per-loan fee schedule, which lives here alongside
-- the loan's other economic parameter (`discount`).
--
-- All three rates are basis points (1 bp = 1/10_000):
--   * mgmt_fee_rate_bps  — annualised management fee, applied to senior_deployed × (tenor/365)
--   * oet_alloc_rate_bps — annualised OET allocation, applied to senior_deployed × (tenor/365)
--   * perf_fee_rate_bps  — performance fee as a fraction of (gross interest − management fee),
--                          e.g. 2000 = 20% (NOT annualised; no tenor factor)
--
-- Default 0: existing rows stay valid and yield zero fees (all gross interest flows
-- to the net senior coupon) until a fee schedule is configured per loan. We seed 0
-- rather than inventing protocol fee figures.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   ALTER TABLE loan_parameters
--     DROP COLUMN mgmt_fee_rate_bps,
--     DROP COLUMN perf_fee_rate_bps,
--     DROP COLUMN oet_alloc_rate_bps;

ALTER TABLE loan_parameters
    ADD COLUMN mgmt_fee_rate_bps  INTEGER NOT NULL DEFAULT 0 CHECK (mgmt_fee_rate_bps  >= 0),
    ADD COLUMN perf_fee_rate_bps  INTEGER NOT NULL DEFAULT 0 CHECK (perf_fee_rate_bps  >= 0 AND perf_fee_rate_bps <= 10000),
    ADD COLUMN oet_alloc_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (oet_alloc_rate_bps >= 0);
