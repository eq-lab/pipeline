-- Migration: add `price_provider` to `loan_asset_prices`.
--
-- Previously `loan_asset_prices` held one USD series per asset (PK
-- `(asset, timestamp)`), and the asset_price_collector skipped any asset that was
-- configured with more than one provider. That made it impossible for the same
-- collateral asset to be valued by two different providers (e.g. `static` on one
-- loan and `metal_price` on another).
--
-- Keying the series by `(asset, price_provider, timestamp)` lets each
-- `(asset, provider)` pair carry its own independent series, so the collector no
-- longer needs the conflict/skip rule and readers value each loan by *its own*
-- provider's price.
--
-- Existing rows predate the column; they can only have come from the single
-- provider the old conflict-skip rule allowed for that asset, so they default to
-- `'static'` (the sole provider shipped before this change). The default is dropped
-- immediately after backfill so all future inserts must name a provider explicitly.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP INDEX loan_asset_prices_asset_prov_ts_idx;
--   ALTER TABLE loan_asset_prices DROP CONSTRAINT loan_asset_prices_pkey;
--   ALTER TABLE loan_asset_prices ADD PRIMARY KEY (asset, timestamp);
--   CREATE INDEX loan_asset_prices_asset_ts_idx ON loan_asset_prices (asset, timestamp DESC);
--   ALTER TABLE loan_asset_prices DROP COLUMN price_provider;

ALTER TABLE loan_asset_prices
    ADD COLUMN price_provider TEXT NOT NULL DEFAULT 'static';
ALTER TABLE loan_asset_prices
    ALTER COLUMN price_provider DROP DEFAULT;

ALTER TABLE loan_asset_prices DROP CONSTRAINT loan_asset_prices_pkey;
ALTER TABLE loan_asset_prices ADD PRIMARY KEY (asset, price_provider, timestamp);

DROP INDEX IF EXISTS loan_asset_prices_asset_ts_idx;
CREATE INDEX loan_asset_prices_asset_prov_ts_idx
    ON loan_asset_prices (asset, price_provider, timestamp DESC);
