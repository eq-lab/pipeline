-- Migration: backfill loan_collateral_valuations from loan_parameters.
--
-- Final step of the collateral-valuation record (see 20260708000001). Existing
-- loans (manually populated in loan_parameters) become anchor rows in
-- loan_collateral_valuations. loan_parameters is NOT dropped: its rows are reused here and
-- both coexist until the API loan-book read and the worker asset_price_collector
-- are repointed at loan_collateral_valuations; the drop happens in a later migration once
-- nothing reads loan_parameters.
--
-- Mapping decisions:
--   * chain_id  -> DEFAULT_CHAIN_ID (1). loan_parameters predates chain sharding;
--     matches the lp_profiles / kyc_outbox backfill convention.
--   * commodity -> asset, the closest available label (loan_parameters has no
--     commodity); onboarding/operators can refine it later.
--   * valuation_mode -> StandardGoods — the price*multiplier model these rows used;
--     concentrate needs assay/offtake data that does not exist yet.
--   * asset, price_provider -> carried over verbatim.
--   * haircut_pct -> (1 - discount): the old collateral was price*discount, so
--     (1 - haircut) = discount preserves that multiplier. The new standard-goods
--     formula multiplies by quantity too, so recomputed values will differ until
--     quantity reports arrive — this preserves intent, not the amount.
--   * created_at / updated_at -> carried over for audit continuity.
--
-- Idempotent (ON CONFLICT DO NOTHING) so a re-run cannot duplicate anchors.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DELETE FROM loan_collateral_valuations lv
--   USING loan_parameters lp
--   WHERE lv.chain_id = 1 AND lv.loan_id = lp.loan_id;

INSERT INTO loan_collateral_valuations
    (chain_id, loan_id, commodity, valuation_mode, asset, price_provider, haircut_pct, created_at, updated_at)
SELECT
    1,
    loan_id,
    asset,
    'StandardGoods',
    asset,
    price_provider,
    (1 - discount),
    created_at,
    updated_at
FROM loan_parameters
ON CONFLICT (chain_id, loan_id) DO NOTHING;
