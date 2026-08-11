-- Migration: guard `collateral_valuation_config.price_provider` against unknown keys.
--
-- Part of #1023 (guard against non-market price providers resolving in
-- production). `price_provider` selects the `PriceProvider` impl the collector
-- resolves at runtime (`packages/shared/src/price_provider.rs`); until now it was
-- a plain `TEXT NOT NULL` with no constraint, unlike `valuation_mode` and
-- `default_haircut_pct` on the same table.
--
-- This adds a `CHECK` mirroring the `valuation_mode` CHECK immediately above it.
-- The provider key set now lives in two places — this CHECK and the `PROVIDERS`
-- table in `price_provider.rs` — and they must be kept in sync when a provider is
-- added or removed; this mirrors the existing `valuation_mode` enum/CHECK coupling
-- on the same table.
--
-- Per the resolved design decision on #1023, this migration is CHECK-only: it does
-- not scan or flag any surviving `static` rows in `loan_asset_prices` or
-- `loan_collateral_valuations`. Those tables are covered instead by the
-- submission-time validation, the `price_provider_for` resolution guard, and the
-- worker startup assertion — not by a data migration. `loan_collateral_valuations`
-- specifically has no CHECK because existing pure test fixtures use arbitrary
-- provider strings that never reach the database.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   ALTER TABLE collateral_valuation_config
--       DROP CONSTRAINT collateral_valuation_config_price_provider_check;

ALTER TABLE collateral_valuation_config
    ADD CONSTRAINT collateral_valuation_config_price_provider_check
    CHECK (price_provider IN ('static', 'metal_price'));
