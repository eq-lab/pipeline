-- Migration: loan_parameters + loan_asset_prices — backing tables for the
-- asset_price_collector worker job.
--
-- `loan_parameters` holds, per loan, the collateral asset and the price provider
-- key used to value it. The collector job reads the **distinct (asset,
-- price_provider)** set from this table; how rows are populated (manual/seed/other
-- flow) is out of scope for the job. If the same asset appears with conflicting
-- providers, the job logs and skips that asset.
--
-- `loan_asset_prices` is the rolling, retained series of USD prices per asset.
-- One row per (asset, timestamp) grid point; inserts are idempotent
-- (ON CONFLICT (asset, timestamp) DO NOTHING). Retention keeps a bounded window.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE loan_asset_prices;
--   DROP TABLE loan_parameters;

CREATE TABLE loan_parameters (
    loan_id        NUMERIC(78,0) PRIMARY KEY,
    discount       NUMERIC       NOT NULL CHECK (discount >= 0 AND discount <= 1),
    asset          TEXT          NOT NULL,
    price_provider TEXT          NOT NULL,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE loan_asset_prices (
    asset     TEXT        NOT NULL,
    price_usd NUMERIC     NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (asset, timestamp)
);

CREATE INDEX loan_asset_prices_asset_ts_idx
    ON loan_asset_prices (asset, timestamp DESC);
