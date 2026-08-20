-- sPLUSD share-transfer tracking — complete per-user share balance history.
--
-- Until now the per-user share ledger lived only on `StakingDeposit` /
-- `StakingWithdrawal` rows, each carrying a running `shares_balance` for a
-- single `owner`. Peer-to-peer share transfers (SEP-41 `transfer` on the
-- StakedPipelineUSD vault, indexed as `ShareTransfer`) were not tracked at all,
-- so any holder who sent or received shares had a stale balance.
--
-- A transfer changes *two* balances, and `contract_logs` permits exactly one
-- row per on-chain event (UNIQUE (chain_id, contract_address, block_number,
-- log_index)). A `ShareTransfer` row therefore carries both sides:
-- `shares_balance_from` / `avg_buy_share_price_from` for the sender and
-- `shares_balance_to` / `avg_buy_share_price_to` for the receiver.
--
-- `position_events` normalises all three row shapes into one row per
-- (holder, event) so every consumer — the indexer's running-balance lookup in
-- `compute_position_fields` and `PositionRepo`'s summaries — reads a single flat
-- shape instead of branching on `event_name` in each query.
--
-- Note on self-transfers (from = to): both UNION arms emit a row with the same
-- holder and the same (block_number, log_index). The indexer writes the
-- unchanged balance to both sides in that case, so the duplicate rows agree and
-- an arbitrary tie-break is harmless.
CREATE VIEW position_events AS

-- Staking rows: exactly one holder per row.
-- The CASE branch matches legacy Stellar `StakingDeposit` rows that predate
-- EVM-parity normalisation in the parser: they lack `owner` and store the share
-- holder under `from` instead. Scoped to `StakingDeposit` because a
-- withdrawal's `receiver`/`from` is not a safe proxy for `owner`.
SELECT
    chain_id,
    contract_address,
    block_number,
    log_index,
    block_timestamp,
    LOWER(COALESCE(
        params->>'owner',
        CASE WHEN event_name = 'StakingDeposit' THEN params->>'from' END
    ))                                              AS holder,
    (params->>'shares_balance')::numeric            AS shares_balance,
    (params->>'avg_buy_share_price')::numeric       AS avg_buy_share_price,
    COALESCE((params->>'realized_pnl')::numeric, 0) AS realized_pnl
FROM contract_logs
WHERE event_name IN ('StakingDeposit', 'StakingWithdrawal')
  AND params ? 'shares_balance'

UNION ALL

-- ShareTransfer, sender side. Carry-over basis: a transfer is not an economic
-- disposal, so the sender's average buy price is unchanged and nothing is
-- realized.
SELECT
    chain_id,
    contract_address,
    block_number,
    log_index,
    block_timestamp,
    LOWER(params->>'from'),
    (params->>'shares_balance_from')::numeric,
    (params->>'avg_buy_share_price_from')::numeric,
    0
FROM contract_logs
WHERE event_name = 'ShareTransfer'
  AND params ? 'shares_balance_from'

UNION ALL

-- ShareTransfer, receiver side. The receiver inherits the sender's basis,
-- weighted into any position they already held.
SELECT
    chain_id,
    contract_address,
    block_number,
    log_index,
    block_timestamp,
    LOWER(params->>'to'),
    (params->>'shares_balance_to')::numeric,
    (params->>'avg_buy_share_price_to')::numeric,
    0
FROM contract_logs
WHERE event_name = 'ShareTransfer'
  AND params ? 'shares_balance_to';

-- The running-balance lookup runs once per indexed position event, so both
-- transfer sides get a partial index matching the view's access pattern
-- (latest row for one holder on one vault).
CREATE INDEX idx_contract_logs_share_transfer_from
    ON contract_logs (
        chain_id,
        LOWER(contract_address),
        LOWER(params->>'from'),
        block_number DESC,
        log_index DESC
    )
    WHERE event_name = 'ShareTransfer';

CREATE INDEX idx_contract_logs_share_transfer_to
    ON contract_logs (
        chain_id,
        LOWER(contract_address),
        LOWER(params->>'to'),
        block_number DESC,
        log_index DESC
    )
    WHERE event_name = 'ShareTransfer';
