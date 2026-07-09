-- Migration: collateral_valuation_config — policy map for collateral valuation.
--
-- Part of the off-chain per-loan valuation record from
-- docs/product-specs/collateral-valuation.md (split across migrations
-- 20260708000001..000006, one per table plus the loan_parameters reuse).
--
-- Small, slowly-changing reference table. Resolves a commodity to its valuation
-- mode, price-feed asset/provider, and default haircut at loan onboarding, and is
-- the source of truth for which price feeds the collector must poll. Seeded by
-- migration / governance; not seeded here (populated when onboarding wiring lands).
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE collateral_valuation_config;

CREATE TABLE collateral_valuation_config (
    commodity           TEXT PRIMARY KEY,                 -- e.g. gold_pyrite_concentrate
    valuation_mode      TEXT NOT NULL
                        CHECK (valuation_mode IN ('StandardGoods', 'MetalConcentrate')),
    asset               TEXT NOT NULL,                    -- headline symbol for the price feed
    price_provider      TEXT NOT NULL,                    -- selects the PriceProvider impl
    default_haircut_pct NUMERIC NOT NULL
                        CHECK (default_haircut_pct >= 0 AND default_haircut_pct <= 1),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
