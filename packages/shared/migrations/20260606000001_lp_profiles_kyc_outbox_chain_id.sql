-- Migration: add chain_id to lp_profiles and kyc_outbox, shard both tables by chain.
--
-- Decision: Q1=B — shard lp_profiles and kyc_outbox by chain_id.
-- Rationale: defense-in-depth per chain; regulator-orderable per chain;
--            per-chain audit isolation.
-- See docs/design-docs/multi-chain-kyc-sharding.md for full rationale.
--
-- Backfill strategy
-- -----------------
-- The deployment running this migration today is single-chain. The backfill
-- value is *derived* from `contract_logs` at apply time, NOT hard-coded:
--
--   * If contract_logs contains exactly one distinct chain_id → use it.
--   * If contract_logs is empty (fresh deploy) → use 1 as the fallback
--     (matches the historical API_CHAIN_ID default; harmless because there
--     are no rows in lp_profiles / kyc_outbox to mislabel).
--   * If contract_logs already has more than one distinct chain_id → the
--     migration aborts. Backfill is ambiguous and must be done manually.
--
-- This avoids the "deployed on a testnet with DEFAULT_CHAIN_ID=11155111 but
-- migration silently labels every row with chain_id=1" footgun.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   ALTER TABLE lp_profiles DROP CONSTRAINT lp_profiles_pkey;
--   ALTER TABLE lp_profiles ADD PRIMARY KEY (wallet_address);
--   ALTER TABLE lp_profiles DROP COLUMN chain_id;
--   DROP INDEX idx_lp_profiles_wallet;
--   ALTER TABLE kyc_outbox DROP COLUMN chain_id;
--   DROP INDEX idx_kyc_outbox_chain_unprocessed;

-- ── Step 1: add chain_id columns (nullable for now, to be backfilled) ────────

ALTER TABLE lp_profiles ADD COLUMN chain_id BIGINT;
ALTER TABLE kyc_outbox  ADD COLUMN chain_id BIGINT;

-- ── Step 2: derive and apply backfill, with assertion ───────────────────────

DO $$
DECLARE
    distinct_chains INT;
    inferred_chain_id BIGINT;
BEGIN
    SELECT COUNT(DISTINCT chain_id) INTO distinct_chains FROM contract_logs;

    IF distinct_chains > 1 THEN
        RAISE EXCEPTION
            'Backfill ambiguous: contract_logs has % distinct chain_ids. '
            'This migration assumes a single-chain deployment as its starting point. '
            'Pre-shard lp_profiles and kyc_outbox manually before applying this migration.',
            distinct_chains;
    END IF;

    SELECT MIN(chain_id) INTO inferred_chain_id FROM contract_logs;

    -- Fresh deploys (empty contract_logs) get the historical default of 1.
    -- There are no rows in lp_profiles or kyc_outbox to mislabel in that case.
    inferred_chain_id := COALESCE(inferred_chain_id, 1);

    EXECUTE format('UPDATE lp_profiles SET chain_id = %L WHERE chain_id IS NULL', inferred_chain_id);
    EXECUTE format('UPDATE kyc_outbox  SET chain_id = %L WHERE chain_id IS NULL', inferred_chain_id);

    RAISE NOTICE 'Backfilled chain_id = % for lp_profiles and kyc_outbox', inferred_chain_id;
END $$;

-- ── Step 3: enforce NOT NULL now that backfill is complete ──────────────────

ALTER TABLE lp_profiles ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE kyc_outbox  ALTER COLUMN chain_id SET NOT NULL;

-- ── Step 4: swap lp_profiles primary key to (chain_id, wallet_address) ──────

ALTER TABLE lp_profiles DROP CONSTRAINT lp_profiles_pkey;
ALTER TABLE lp_profiles ADD PRIMARY KEY (chain_id, wallet_address);

-- Retain a secondary index on wallet_address alone so cross-chain wallet
-- lookups (e.g. analytics.rs aggregating activity for a wallet across chains)
-- remain fast.
CREATE INDEX idx_lp_profiles_wallet ON lp_profiles (wallet_address);

-- ── Step 5: kyc_outbox stays keyed on its BIGSERIAL id ──────────────────────
--
-- The kyc_outbox.id (BIGSERIAL) is already globally unique, so widening the
-- PK to include chain_id is not needed for uniqueness. chain_id is a data
-- column on every row, used by consumers to route updates to the correct
-- (chain_id, wallet_address) profile row.
--
-- Add a chain-scoped partial index for queue drain queries.

CREATE INDEX idx_kyc_outbox_chain_unprocessed
    ON kyc_outbox (chain_id, created_at)
    WHERE processed_at IS NULL;
