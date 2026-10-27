-- Migration: one vault per chain (issue #1613).
-- Spec: docs/references/backend.md (GET /v1/positions/history, single vault per chain).
--
-- vaults is the source of truth for the chain's current sPLUSD vault. Per chain the
-- vault with the newest share_prices sample is kept (share_prices.vault_address matched to
-- vaults.address case-insensitively), falling back to the highest id when the chain has no
-- samples; the other vaults rows of the chain are deleted. share_prices / position_events
-- rows stay, they are just no longer read for the chain. The deleted rows are config-like:
-- the price poller re-upserts the chain's vault on start.
--
-- Rollback: run in ONE transaction, together with rolling back the application images
-- (old images assume several vaults per chain). Deleted vaults rows are not restored; to
-- bring one back, INSERT it with its (chain_id, address, name, asset_decimals, share_decimals):
--   ALTER TABLE vaults DROP CONSTRAINT vaults_chain_id_uk;
--   DELETE FROM _sqlx_migrations WHERE version = 20261027000001;

DELETE FROM vaults v
 USING (
     SELECT DISTINCT ON (v.chain_id) v.chain_id, v.id AS keep_id
       FROM vaults v
       LEFT JOIN LATERAL (
           SELECT max(sp.block_timestamp) AS last_ts
             FROM share_prices sp
            WHERE sp.chain_id = v.chain_id
              AND lower(sp.vault_address) = lower(v.address)
       ) s ON true
      ORDER BY v.chain_id, s.last_ts DESC NULLS LAST, v.id DESC
 ) k
 WHERE v.chain_id = k.chain_id
   AND v.id <> k.keep_id;

ALTER TABLE vaults ADD CONSTRAINT vaults_chain_id_uk UNIQUE (chain_id);
