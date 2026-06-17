-- Seed the testnet sPLUSD (staked_pipeline_usd) vault row for the Stellar price-poller.
--
-- Issue #568: Stellar/Soroban price-poller for staked_pipeline_usd vault.
--
-- chain_id   = 99000001 (Stellar testnet sentinel)
-- address    = Strkey C… form verbatim (uppercase — consistent with how Soroban contracts
--              are addressed; position_repo queries use LOWER(vault_address) = LOWER($2)
--              so identity-preserving for the uppercase canonical form).
-- name       = 'sPLUSD'
-- asset_decimals  = 7  (PLUSD is a SAC — Stellar Asset Contracts use 7 decimals by protocol
--                       convention; confirmed against the live SAC:
--                       stellar contract invoke \
--                         --id CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN \
--                         --network testnet -- decimals
--                       Expected output: 7)
-- share_decimals  = 7  (vault decimals_offset = 0 per deployments/config.json:15,
--                       so Vault::decimals(e) = underlying_decimals + offset = 7 + 0 = 7)
--
-- ON CONFLICT DO NOTHING makes re-runs idempotent.

INSERT INTO vaults (chain_id, address, name, asset_decimals, share_decimals)
VALUES (99000001, 'CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5', 'sPLUSD', 7, 7)
ON CONFLICT (chain_id, address) DO NOTHING;
