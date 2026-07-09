-- Migration: loan_collateral_valuations — the per-loan valuation anchor.
--
-- Part of the collateral-valuation record (see 20260708000001). One row per loan,
-- keyed by (chain_id, loan_id): on-chain loan ids can collide across chains, so
-- identity is chain-scoped, matching contract_logs / lp_profiles.
--
-- Intended to be upserted by the indexer on LoanDrawn — commodity comes from the
-- parsed loan metadata; mode/asset/provider/haircut are resolved from
-- collateral_valuation_config, per-loan overridable. Existing loans are backfilled
-- from loan_parameters in migration 20260708000006.
--
-- No computed-state table accompanies this: collateral value and CCR are a pure
-- function of the latest inputs + the price series (loan_asset_prices) + the loan
-- snapshot denominator (contract_logs), so they are recomputed on demand.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE loan_collateral_valuations;

CREATE TABLE loan_collateral_valuations (
    chain_id       BIGINT        NOT NULL,
    loan_id        NUMERIC(78,0) NOT NULL,
    commodity      TEXT          NOT NULL,
    valuation_mode TEXT          NOT NULL
                   CHECK (valuation_mode IN ('StandardGoods', 'MetalConcentrate')),
    asset          TEXT          NOT NULL,
    price_provider TEXT          NOT NULL,
    haircut_pct    NUMERIC       NOT NULL
                   CHECK (haircut_pct >= 0 AND haircut_pct <= 1),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, loan_id)
);
