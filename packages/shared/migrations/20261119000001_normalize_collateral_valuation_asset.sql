-- spec: docs/product-specs/collateral-valuation.md#per-loan-valuation-record
--
-- Rollback: no-op, the original spelling is not recoverable and is not needed.
--   DELETE FROM _sqlx_migrations WHERE version = 20261119000001;

UPDATE loan_collateral_valuations
SET asset = upper(btrim(asset)), updated_at = now()
WHERE asset <> upper(btrim(asset));

UPDATE loan_collateral_valuations
SET price_provider = lower(btrim(price_provider)), updated_at = now()
WHERE price_provider <> lower(btrim(price_provider));
